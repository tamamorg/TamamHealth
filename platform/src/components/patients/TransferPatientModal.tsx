'use client';

/**
 * Raise an internal transfer of care ownership.
 *
 * The form is deliberately more work than a dropdown: transfer type, reason
 * and hand-off notes are each something the receiving clinician needs and
 * would otherwise have to chase.
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { expandHref } from '@/lib/navigation/expand-to-page';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePatientTransfers } from '@/lib/hooks/usePatientTransfers';
import { canRequestTransfer } from '@/lib/services/patient-transfer-permissions';
import type {
  PatientDoc, PatientTransferType, PatientTransferUrgency,
} from '@/lib/db-types';
import { patientFullName } from '@/lib/patient-utils';
import { ObfQuestion, ObfSection, ObfSelectField, ObfTextField } from '@/components/ehr/chart/panels/order-basket/ObfFields';
import { FormError } from '@/components/overlay/FormNotices';
import FormSlider from '@/components/overlay/FormSlider';
import NoticeToast from '@/components/overlay/NoticeToast';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';

/** The three ownership models: who is responsible for the patient afterwards. */
const TRANSFER_TYPES: Array<{ v: PatientTransferType; label: string; blurb: string }> = [
  { v: 'permanent', label: 'transfers.typePermanent', blurb: 'transfers.typePermanentBlurb' },
  { v: 'temporary', label: 'transfers.typeTemporary', blurb: 'transfers.typeTemporaryBlurb' },
  { v: 'shared_care', label: 'transfers.typeSharedCare', blurb: 'transfers.typeSharedCareBlurb' },
];

/**
 * Where the patient is going.
 *
 * This is a separate axis from `PatientTransferType` (permanent / temporary /
 * shared care), which describes the OWNERSHIP change. Scope describes the
 * DESTINATION, and the two combine freely — a temporary external transfer to a
 * referral hospital is as valid as a permanent internal one to another ward.
 *
 * Keeping them separate also stops the destination fields contradicting each
 * other: an internal transfer cannot name another facility, and an external one
 * cannot name a provider from this facility's staff list.
 */
type TransferScope = 'internal' | 'external';

const TRANSFER_SCOPES: Array<{ v: TransferScope; label: string; blurb: string }> = [
  { v: 'internal', label: 'transfers.scopeInternal', blurb: 'transfers.scopeInternalBlurb' },
  { v: 'external', label: 'transfers.scopeExternal', blurb: 'transfers.scopeExternalBlurb' },
];

const URGENCIES: Array<{ v: PatientTransferUrgency; label: string; sla: string }> = [
  { v: 'routine', label: 'transfers.urgencyRoutine', sla: '48h' },
  { v: 'urgent', label: 'transfers.urgencyUrgent', sla: '12h' },
  { v: 'emergency', label: 'transfers.urgencyEmergency', sla: '2h' },
];

/** Roles that can hold clinical ownership of a patient. */
const RECEIVING_ROLES = new Set([
  'doctor', 'clinician', 'clinical_officer', 'nurse', 'midwife',
  'medical_superintendent', 'nutritionist',
]);

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TransferPatientModal({
  patient,
  onClose,
  onTransferred,
  presentation = 'modal',
}: {
  patient: PatientDoc;
  onClose: () => void;
  onTransferred?: () => void;
  /**
   * 'page' drops the slider so `/transfers/new` can host the same form, which
   * is where the slider's Expand control goes.
   */
  presentation?: 'modal' | 'page';
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuth();
  const { users } = useUsers();
  const { hospitals } = useHospitals();
  const { request } = usePatientTransfers(patient._id);

  const [scope, setScope] = useState<TransferScope>('internal');
  const [transferType, setTransferType] = useState<PatientTransferType>('permanent');
  const [urgency, setUrgency] = useState<PatientTransferUrgency>('routine');
  const [providerId, setProviderId] = useState('');
  const [department, setDepartment] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [reason, setReason] = useState('');
  const [handoffNotes, setHandoffNotes] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [effectiveAt, setEffectiveAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFacility = hospitals.find(h => h._id === facilityId);
  const destinationOrgId = selectedFacility?.orgId;

  // Mirror the authoritative rule rather than approximating it: both the
  // local offline path and integration API use this capability function.
  const permission = useMemo(() => {
    if (!currentUser) return { allowed: false, reason: t('transfers.sessionEnded') };
    return canRequestTransfer(
      {
        sub: currentUser._id,
        username: currentUser.username,
        role: currentUser.role,
        name: currentUser.name || currentUser.username,
        hospitalId: currentUser.hospitalId,
        orgId: currentUser.orgId,
      },
      patient,
      // An external transfer can leave the organisation entirely, which is a
      // different authorisation question from moving a patient between wards.
      // Passing the real value means the form never offers a Send the API
      // would reject — and never blocks one it would allow.
      { crossOrg: scope === 'external' && Boolean(destinationOrgId) && destinationOrgId !== currentUser.orgId },
    );
  }, [currentUser, patient, scope, destinationOrgId, t]);

  // Read out of the user once so the memo below depends on the FIELD rather
  // than on the whole user object: a dependency list naming a property of an
  // object the body reads is narrower than the compiler can infer, and it
  // skips optimizing the component rather than guess.
  const myHospitalId = currentUser?.hospitalId;
  const myOrgId = currentUser?.orgId;
  const candidates = useMemo(() => users
    .filter(u => u.isActive !== false)
    .filter(u => !myHospitalId || u.hospitalId === myHospitalId)
    .filter(u => !myOrgId || u.orgId === myOrgId)
    .filter(u => RECEIVING_ROLES.has(u.role))
    .filter(u => u._id !== patient.assignedDoctor)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, patient.assignedDoctor, myHospitalId, myOrgId]);

  const departments = useMemo(() => Array.from(
    new Set(users.filter(u => (!myHospitalId || u.hospitalId === myHospitalId)
      && (!myOrgId || u.orgId === myOrgId))
      .map(u => u.department).filter((d): d is string => Boolean(d))),
  ).sort(), [users, myHospitalId, myOrgId]);

  const selectedProvider = candidates.find(u => u._id === providerId);
  // What counts as a destination depends on the scope. An external transfer
  // without a receiving facility is meaningless — the patient would be leaving
  // for nowhere — so the facility is required rather than merely one of three
  // interchangeable options.
  const hasDestination = scope === 'external'
    ? Boolean(facilityId)
    : Boolean(providerId || department);
  const needsEndDate = transferType !== 'permanent';
  const canSend = permission.allowed
    && hasDestination
    && reason.trim().length > 0
    && (!needsEndDate || Boolean(expiresAt))
    && !busy;

  /**
   * Switching scope clears the destination fields that no longer apply.
   *
   * Without this a user could pick a provider, switch to External, choose a
   * facility, and silently send a request naming a clinician who does not work
   * there — the receiving site would get a hand-off addressed to a stranger.
   */
  const changeScope = (next: TransferScope) => {
    setScope(next);
    if (next === 'external') {
      setProviderId('');
      setDepartment('');
    } else {
      setFacilityId('');
    }
  };

  const submit = async (asDraft: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await request(patient, {
        // Only the fields that belong to the chosen scope are sent, so the
        // stored request can never describe a destination that contradicts
        // itself (a provider at this site AND a different facility).
        to: scope === 'external'
          ? {
              facilityId: facilityId || undefined,
              facilityName: selectedFacility?.name,
              orgId: selectedFacility?.orgId ?? myOrgId,
            }
          : {
              providerId: providerId || undefined,
              providerName: selectedProvider?.name,
              department: department || selectedProvider?.department || undefined,
              facilityId: myHospitalId,
              facilityName: currentUser?.hospital?.name || currentUser?.hospitalName,
              orgId: myOrgId,
            },
        reason: reason.trim(),
        transferType,
        urgency,
        handoffNotes: handoffNotes.trim() || undefined,
        effectiveAt: scheduled && effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
        expiresAt: needsEndDate && expiresAt ? new Date(expiresAt).toISOString() : undefined,
        asDraft,
      });
      onTransferred?.();
      onClose();
    } catch (e) {
      setError(describeError(e, t('msg.transferRequestNotCreatedTry')));
    } finally {
      setBusy(false);
    }
  };

  const currentOwner = patient.assignedDoctorName
    || patient.assignedDepartment
    || t('transfers.noOneAssigned');

  const scopeBlurb = TRANSFER_SCOPES.find(s => s.v === scope)?.blurb;
  const typeBlurb = TRANSFER_TYPES.find(ty => ty.v === transferType)?.blurb;
  const activeSla = URGENCIES.find(u => u.v === urgency)?.sla;
  const fieldId = (name: string) => `transfer-${name}`;

  const sections = [
    {
      id: 'destination',
      label: t('transfers.destination'),
      body: (
        <>
          <ObfSelectField
            id={fieldId('scope')}
            label={t('transfers.scopeLabel')}
            value={scope}
            placeholder={null}
            options={TRANSFER_SCOPES.map(sc => ({ value: sc.v, label: t(sc.label) }))}
            onChange={value => changeScope(value as TransferScope)}
          />
          {scopeBlurb && <p className="obf-hint">{t(scopeBlurb)}</p>}
          {/* The fields follow the scope, so the form can never collect a
              contradictory destination. */}
          {scope === 'internal' ? (
            <div className="obf-row">
              <ObfSelectField
                id={fieldId('provider')}
                label={t('transfers.provider')}
                value={providerId}
                placeholder={t('transfers.anyInDepartment')}
                options={candidates.map(u => ({ value: u._id, label: `${u.name}${u.specialty ? ` · ${u.specialty}` : ''}` }))}
                onChange={setProviderId}
              />
              <ObfSelectField
                id={fieldId('department')}
                label={t('transfers.department')}
                value={department}
                placeholder={t('transfers.unchanged')}
                options={departments.map(d => ({ value: d, label: d }))}
                onChange={setDepartment}
              />
            </div>
          ) : (
            <ObfSelectField
              id={fieldId('facility')}
              label={t('transfers.receivingFacility')}
              required
              value={facilityId}
              placeholder={t('transfers.selectFacility')}
              options={hospitals.filter(h => h._id !== myHospitalId).map(h => ({ value: h._id, label: h.name }))}
              onChange={setFacilityId}
            />
          )}
          {!hasDestination && (
            <p className="obf-hint">{scope === 'external' ? t('transfers.pickFacility') : t('transfers.pickProvider')}</p>
          )}
          {scope === 'external' && selectedFacility && destinationOrgId && destinationOrgId !== myOrgId && (
            <NoticeToast tone="warning">{t('transfers.differentOrg')}</NoticeToast>
          )}
        </>
      ),
    },
    {
      id: 'type',
      label: t('transfers.detailsSection'),
      body: (
        <>
          <div className="obf-row">
            <ObfSelectField
              id={fieldId('type')}
              label={t('transfers.typeOfTransfer')}
              value={transferType}
              placeholder={null}
              options={TRANSFER_TYPES.map(ty => ({ value: ty.v, label: t(ty.label) }))}
              onChange={value => setTransferType(value as PatientTransferType)}
            />
            <ObfSelectField
              id={fieldId('urgency')}
              label={t('transfers.urgency')}
              value={urgency}
              placeholder={null}
              options={URGENCIES.map(u => ({ value: u.v, label: `${t(u.label)} · ${u.sla}` }))}
              onChange={value => setUrgency(value as PatientTransferUrgency)}
            />
          </div>
          <p className="obf-hint">
            {typeBlurb && t(typeBlurb)} {activeSla && t('transfers.acknowledgeWithin', { sla: activeSla })}
          </p>
          <div className="obf-row">
            <ObfSelectField
              id={fieldId('when')}
              label={t('transfers.when')}
              value={scheduled ? 'later' : 'accepted'}
              placeholder={null}
              options={[
                { value: 'accepted', label: t('transfers.whenAccepted') },
                { value: 'later', label: t('transfers.scheduleLater') },
              ]}
              onChange={value => {
                const later = value === 'later';
                setScheduled(later);
                if (later && !effectiveAt) setEffectiveAt(toLocalInputValue(new Date(Date.now() + 86_400_000)));
              }}
            />
            {scheduled && (
              <ObfQuestion label={t('transfers.scheduledFor')} htmlFor={fieldId('effective')}>
                <input
                  id={fieldId('effective')}
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={e => setEffectiveAt(e.target.value)}
                />
              </ObfQuestion>
            )}
          </div>
          {scheduled && <p className="obf-hint">{t('transfers.ownershipMoves')}</p>}
          {needsEndDate && (
            <ObfQuestion
              label={transferType === 'temporary' ? t('transfers.careReturns') : t('transfers.accessEnds')}
              required
              htmlFor={fieldId('expires')}
            >
              <input
                id={fieldId('expires')}
                type="datetime-local"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
              />
            </ObfQuestion>
          )}
        </>
      ),
    },
    {
      id: 'handoff',
      label: t('transfers.handoffSection'),
      body: (
        <>
          <ObfTextField
            id={fieldId('reason')}
            label={t('transfers.reason')}
            required
            value={reason}
            placeholder={t('transfers.reasonPlaceholder')}
            onChange={setReason}
          />
          <ObfTextField
            id={fieldId('notes')}
            label={t('transfers.handoffNotes')}
            multiline
            value={handoffNotes}
            placeholder={t('transfers.handoffPlaceholder')}
            onChange={setHandoffNotes}
          />
          <p className="obf-hint">{t('transfers.staysWith', { owner: currentOwner })}</p>
        </>
      ),
    },
  ];

  const form = (
    <div className="station-form-slider obk-root">
      <div className="obf-form">
        <div className="obf-form-body">
          <div className="obf-pad">
            {!permission.allowed && <NoticeToast tone="danger">{permission.reason}</NoticeToast>}
            {error && <FormError message={error} />}
            {sections.map(section => <ObfSection key={section.id} title={section.label}>{section.body}</ObfSection>)}
          </div>
        </div>
        <div className="obk-footer">
          <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={busy} onClick={onClose}>
            {t('action.cancel')}
          </button>
          <button
            type="button"
            className="obk-footer-btn obk-footer-btn--secondary"
            disabled={busy || !permission.allowed || !hasDestination || !reason.trim()}
            onClick={() => void submit(true)}
          >
            {t('transfers.saveDraft')}
          </button>
          <button
            type="button"
            className="obk-footer-btn obk-footer-btn--primary"
            disabled={!canSend}
            onClick={() => void submit(false)}
          >
            {transferType === 'shared_care' ? t('transfers.requestSharedCare') : t('transfers.sendRequest')}
          </button>
        </div>
      </div>
    </div>
  );

  if (presentation === 'page') return form;

  return (
    <FormSlider
      title={t('transfers.title')}
      subtitle={<>{patientFullName(patient)} · {t('transfers.with')} {currentOwner}</>}
      className="tamam-dialog"
      width={560}
      flush
      busy={busy}
      onClose={onClose}
      onExpand={() => { onClose(); router.push(expandHref(`/transfers/new?patient=${encodeURIComponent(patient._id)}`)); }}
    >
      {form}
    </FormSlider>
  );
}
