'use client';

/**
 * Raise an internal transfer of care ownership.
 *
 * The form is deliberately more work than a dropdown: transfer type, reason,
 * hand-off notes and a checklist the sender ticks before the Send button
 * unlocks. Every one of those is a field the receiving clinician needs and
 * would otherwise have to chase, and the checklist is the record that the
 * medication list and open tasks were actually looked at — the two things most
 * often dropped at a hand-off.
 */
import { useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import { useRouter } from 'next/navigation';
import { expandHref } from '@/lib/navigation/expand-to-page';
import { useAuth } from '@/lib/context';
import { useUsers } from '@/lib/hooks/useUsers';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePatientTransfers } from '@/lib/hooks/usePatientTransfers';
import { defaultChecklist } from '@/lib/services/patient-transfer-service';
import { canRequestTransfer } from '@/lib/services/patient-transfer-permissions';
import type {
  PatientDoc, PatientTransferType, PatientTransferUrgency, PatientTransferChecklistItem,
} from '@/lib/db-types';
import { patientFullName } from '@/lib/patient-utils';
import {
  ArrowRightLeft, ArrowRight, Check, AlertTriangle, Maximize2, X, Building2, Hospital,
  Timer, Users, Clock, Siren,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

type IconCmp = typeof ArrowRight;

/**
 * The three ownership models, each with its own tint.
 *
 * The colour is doing real work: these three options change who is legally
 * responsible for the patient, and reading them as three identical blue
 * outlines is exactly how the wrong one gets picked. Blue = you hand over,
 * amber = time-boxed, iris = shared.
 */
const TRANSFER_TYPES: Array<{
  v: PatientTransferType; label: string; blurb: string; icon: IconCmp; tint: string;
}> = [
  {
    v: 'permanent',
    label: 'Permanent',
    blurb: 'They take over as owner.',
    icon: ArrowRight,
    tint: 'var(--accent-primary)',
  },
  {
    v: 'temporary',
    label: 'Temporary',
    blurb: 'They cover until the end date.',
    icon: Timer,
    tint: 'var(--color-warning)',
  },
  {
    v: 'shared_care',
    label: 'Shared care',
    blurb: 'They join. You stay owner.',
    icon: Users,
    tint: 'var(--accent-purple)',
  },
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

const TRANSFER_SCOPES: Array<{
  v: TransferScope; label: string; blurb: string; icon: IconCmp;
}> = [
  {
    v: 'internal',
    label: 'Internal',
    blurb: 'Another clinician or department in this facility.',
    icon: Building2,
  },
  {
    v: 'external',
    label: 'External',
    blurb: 'Another facility — the patient leaves your site.',
    icon: Hospital,
  },
];

const URGENCIES: Array<{
  v: PatientTransferUrgency; label: string; sla: string; icon: IconCmp; tint: string;
}> = [
  { v: 'routine', label: 'Routine', sla: '48h', icon: Clock, tint: 'var(--color-success)' },
  { v: 'urgent', label: 'Urgent', sla: '12h', icon: Timer, tint: 'var(--color-warning)' },
  { v: 'emergency', label: 'Emergency', sla: '2h', icon: Siren, tint: 'var(--color-danger)' },
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
   * 'page' drops the dialog frame so `/transfers/new` can host the same form —
   * this popup's Expand control routes there. The header stays: it names the
   * patient and who currently holds the chart, which the request is about.
   */
  presentation?: 'modal' | 'page';
}) {
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
  const [checklist, setChecklist] = useState<PatientTransferChecklistItem[]>(defaultChecklist());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFacility = hospitals.find(h => h._id === facilityId);
  const destinationOrgId = selectedFacility?.orgId;

  // Mirror the server's rule rather than approximating it: this is the same
  // function `/api/patient-transfers` runs, so the form never offers a Send
  // that the API would reject.
  const permission = useMemo(() => {
    if (!currentUser) return { allowed: false, reason: 'Not signed in.' };
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
  }, [currentUser, patient, scope, destinationOrgId]);

  const candidates = useMemo(() => users
    .filter(u => u.isActive !== false)
    .filter(u => !currentUser?.hospitalId || u.hospitalId === currentUser.hospitalId)
    .filter(u => !currentUser?.orgId || u.orgId === currentUser.orgId)
    .filter(u => RECEIVING_ROLES.has(u.role))
    .filter(u => u._id !== patient.assignedDoctor)
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')), [users, patient.assignedDoctor, currentUser?.hospitalId, currentUser?.orgId]);

  const departments = useMemo(() => Array.from(
    new Set(users.filter(u => (!currentUser?.hospitalId || u.hospitalId === currentUser.hospitalId)
      && (!currentUser?.orgId || u.orgId === currentUser.orgId))
      .map(u => u.department).filter((d): d is string => Boolean(d))),
  ).sort(), [users, currentUser?.hospitalId, currentUser?.orgId]);

  const selectedProvider = candidates.find(u => u._id === providerId);
  const outstanding = checklist.filter(i => i.required && !i.done);
  const requiredTotal = checklist.filter(i => i.required).length;
  const requiredDone = requiredTotal - outstanding.length;
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
    && outstanding.length === 0
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

  const toggleChecklist = (key: string) => {
    setChecklist(prev => prev.map(i => (i.key === key ? { ...i, done: !i.done } : i)));
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
              orgId: selectedFacility?.orgId ?? currentUser?.orgId,
            }
          : {
              providerId: providerId || undefined,
              providerName: selectedProvider?.name,
              department: department || selectedProvider?.department || undefined,
              facilityId: currentUser?.hospitalId,
              facilityName: currentUser?.hospital?.name || currentUser?.hospitalName,
              orgId: currentUser?.orgId,
            },
        reason: reason.trim(),
        transferType,
        urgency,
        handoffNotes: handoffNotes.trim() || undefined,
        checklist,
        effectiveAt: scheduled && effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        asDraft,
      });
      onTransferred?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not raise the transfer');
    } finally {
      setBusy(false);
    }
  };

  const currentOwner = patient.assignedDoctorName
    || patient.assignedDepartment
    || 'No one currently assigned';

  const scopeBlurb = TRANSFER_SCOPES.find(s => s.v === scope)?.blurb;
  const activeUrgency = URGENCIES.find(u => u.v === urgency);

  const panel = (
      <div className={presentation === 'page' ? 'xfer xfer--page' : 'card-elevated xfer'}>
        <header className="xfer-head">
          <span className="xfer-head-icon"><ArrowRightLeft /></span>
          <div className="min-w-0">
            <h2 id="transfer-modal-title" className="xfer-title">Transfer patient</h2>
            <p className="xfer-sub">
              {patientFullName(patient)} · with <strong>{currentOwner}</strong>
            </p>
          </div>
          {presentation === 'modal' && (
            <>
              {/* The same pair every create popup carries. They sit in this
                  header rather than PopupHeader's band because `xfer-head`
                  already carries the patient line the request is about. */}
              <button
                onClick={() => { onClose(); router.push(expandHref(`/transfers/new?patient=${encodeURIComponent(patient._id)}`)); }}
                className="xfer-close"
                aria-label="Open full page"
                title="Open full page"
                data-action="popup-expand"
              >
                <Maximize2 />
              </button>
              <button onClick={onClose} className="xfer-close" aria-label="Close" data-action="popup-close">
                <X />
              </button>
            </>
          )}
        </header>

        <div className="xfer-body">
          {!permission.allowed && (
            <div className="xfer-banner xfer-banner--danger">
              <AlertTriangle />
              <span>{permission.reason}</span>
            </div>
          )}

          {/* Scope — where the patient is going. Asked BEFORE the ownership
              question because it decides which destination fields apply. The
              blurb lives on one shared hint line rather than on both cards, so
              only the option in play is explaining itself. */}
          <fieldset>
            <legend className="xfer-sec-label">Destination</legend>
            <div className="xfer-seg">
              {TRANSFER_SCOPES.map(sc => (
                <button
                  key={sc.v}
                  type="button"
                  onClick={() => changeScope(sc.v)}
                  aria-pressed={scope === sc.v}
                >
                  <sc.icon />
                  {sc.label}
                </button>
              ))}
            </div>
            <p className="xfer-hint mt-1.5">{scopeBlurb}</p>
          </fieldset>

          {/* Destination fields follow the scope, so the form can never collect
              a contradictory destination. */}
          {scope === 'internal' ? (
            <div className="xfer-grid">
              <label className="xfer-field">
                Provider
                <Select
                  className="form-input"
                  value={providerId}
                  onChange={e => setProviderId(e.target.value)}
                >
                  <option value="">— Any in department —</option>
                  {candidates.map(u => (
                    <option key={u._id} value={u._id}>
                      {u.name}{u.specialty ? ` · ${u.specialty}` : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="xfer-field">
                Department
                <Select
                  className="form-input"
                  value={department}
                  onChange={e => setDepartment(e.target.value)}
                >
                  <option value="">— Unchanged —</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </Select>
              </label>
            </div>
          ) : (
            <label className="xfer-field">
              <span>Receiving facility <span className="xfer-req">*</span></span>
              <Select
                className="form-input"
                value={facilityId}
                onChange={e => setFacilityId(e.target.value)}
              >
                <option value="">— Select a facility —</option>
                {hospitals
                  .filter(h => h._id !== currentUser?.hospitalId)
                  .map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
              </Select>
            </label>
          )}
          {!hasDestination && (
            <p className="xfer-hint -mt-2">
              {scope === 'external'
                ? 'Pick the facility the patient is going to.'
                : 'Pick a provider, a department, or both.'}
            </p>
          )}
          {scope === 'external' && selectedFacility && destinationOrgId
            && destinationOrgId !== currentUser?.orgId && (
            <div className="xfer-banner xfer-banner--warn">
              <AlertTriangle />
              <span>
                Different organisation — needs cross-organisation transfer rights.
              </span>
            </div>
          )}

          <fieldset>
            <legend className="xfer-sec-label">Type of transfer</legend>
            <div className="xfer-opts">
              {TRANSFER_TYPES.map(t => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setTransferType(t.v)}
                  aria-pressed={transferType === t.v}
                  className="xfer-opt"
                  style={{ ['--tint' as string]: t.tint }}
                >
                  <span className="xfer-opt-ico"><t.icon /></span>
                  <span>
                    <span className="xfer-opt-t">{t.label}</span>
                    <span className="xfer-opt-b block">{t.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* Urgency — the SLA rides inside each pill, so the acknowledgement
              window is visible for all three instead of only the chosen one. */}
          <div>
            <div className="xfer-sec-label">
              Urgency
              {activeUrgency && (
                <span className="xfer-meter" style={{ color: activeUrgency.tint }}>
                  acknowledge within {activeUrgency.sla}
                </span>
              )}
            </div>
            <div className="xfer-pills">
              {URGENCIES.map(u => (
                <button
                  key={u.v}
                  type="button"
                  onClick={() => setUrgency(u.v)}
                  aria-pressed={urgency === u.v}
                  className="xfer-pill"
                  style={{ ['--tint' as string]: u.tint }}
                >
                  <u.icon />
                  {u.label}
                  <small>{u.sla}</small>
                </button>
              ))}
            </div>
          </div>

          {/* Scheduling + expiry */}
          <div className="xfer-grid">
            <div className="xfer-field">
              <label className="xfer-inline-check">
                <input
                  type="checkbox"
                  checked={scheduled}
                  onChange={e => {
                    setScheduled(e.target.checked);
                    if (e.target.checked && !effectiveAt) {
                      setEffectiveAt(toLocalInputValue(new Date(Date.now() + 86_400_000)));
                    }
                  }}
                />
                Schedule for later
              </label>
              {scheduled && (
                <>
                  <input
                    type="datetime-local"
                    className="form-input"
                    value={effectiveAt}
                    onChange={e => setEffectiveAt(e.target.value)}
                  />
                  <p className="xfer-hint">Ownership moves on this date, once accepted.</p>
                </>
              )}
            </div>
            {needsEndDate && (
              <label className="xfer-field">
                <span>
                  {transferType === 'temporary' ? 'Care returns to you on' : 'Access ends on'}
                  <span className="xfer-req"> *</span>
                </span>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                />
              </label>
            )}
          </div>

          {/* Reason + notes */}
          <label className="xfer-field">
            <span>Reason<span className="xfer-req"> *</span></span>
            <input
              className="form-input"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Requires paediatric cardiology follow-up"
            />
          </label>
          <label className="xfer-field">
            Hand-off notes
            <textarea
              className="form-input"
              rows={2}
              value={handoffNotes}
              onChange={e => setHandoffNotes(e.target.value)}
              placeholder="Anything they must know before taking over."
            />
          </label>

          {/* Checklist — chips rather than a stacked list: each one turns green
              on tick, so how much is left reads at a glance instead of from a
              sentence underneath. */}
          <div className="xfer-check-card">
            <div className="xfer-sec-label">
              Hand-off checklist
              <span className="xfer-meter">
                <span className="xfer-meter-track">
                  <span
                    className="xfer-meter-fill"
                    data-pending={outstanding.length > 0}
                    style={{ width: `${(requiredDone / requiredTotal) * 100}%` }}
                  />
                </span>
                {requiredDone}/{requiredTotal} required
              </span>
            </div>
            <div className="xfer-checks">
              {checklist.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className="xfer-check"
                  data-done={item.done}
                  data-required={Boolean(item.required)}
                  aria-pressed={item.done}
                  onClick={() => toggleChecklist(item.key)}
                >
                  <span className="xfer-check-box">{item.done && <Check />}</span>
                  <span>{item.label}</span>
                  {item.required && <span className="xfer-check-req">req</span>}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="xfer-banner xfer-banner--danger">
              <AlertTriangle />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="xfer-foot">
          <p className="xfer-foot-note">
            {outstanding.length > 0
              ? `${outstanding.length} required item${outstanding.length === 1 ? '' : 's'} left — you can still save a draft.`
              : `Stays with ${currentOwner} until accepted · every change is logged.`}
          </p>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => submit(true)}
            disabled={busy || !permission.allowed || !hasDestination || !reason.trim()}
          >
            Save draft
          </button>
          <button
            className="btn btn-primary"
            onClick={() => submit(false)}
            disabled={!canSend}
          >
            <Check className="w-3.5 h-3.5" />
            {transferType === 'shared_care' ? 'Request shared care' : 'Send request'}
          </button>
        </div>
      </div>
  );

  if (presentation === 'page') return panel;

  return (
    <Modal onClose={onClose} width={720} align="top" labelledBy="transfer-modal-title">
      {/* `card-elevated` supplies the opaque surface. Without it the dialog is
          transparent — the shared Modal only styles the backdrop, leaving the
          panel background to the caller — and the dimmed page showed straight
          through this form, making it unreadable. */}
      {panel}
    </Modal>
  );
}
