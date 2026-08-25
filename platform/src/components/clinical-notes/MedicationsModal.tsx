'use client';

/**
 * Medications popup — opened by clicking the Medications section of a note.
 *
 * Left: the working medication list split Active / Discontinued / Not
 * Administered, the "no known medications" attestation, the reconciliation
 * status, and the row actions (Renew / Discontinue / Mark as Error / Cancel
 * Rx). Renewing runs the same interaction check as any new prescription.
 *
 * Right: the patient's network medication history (their prescriptions across
 * facilities in the shared record) behind an explicit consent gate. The gate
 * is real, not decorative: the answer — either way — is written to the
 * patient record with who obtained it and when, because looking at another
 * facility's prescribing without recorded consent is exactly the kind of PHI
 * access an audit asks about.
 *
 * The gate is answered on EVERY open. The last recorded answer pre-fills the
 * form and is shown for context, but it never unlocks the panel by itself —
 * otherwise a consent obtained by one clinician would silently open the
 * history for whoever opens this dialog next.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Info, Plus, X } from '@/components/icons/lucide';
import PrescribeModal from './prescribe/PrescribeModal';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { filterByScope } from '@/lib/services/data-scope';
import { pharmacyStage, pharmacyStageLabel } from '@/lib/pharmacy-workflow';
import type { PrescriptionStatus } from '@/lib/clinical-flow/order-lifecycles';
import type { PatientDoc, PrescriptionDoc } from '@/lib/db-types';
import './clinical-notes.css';
import Select from '@/components/Select';
import { stopsClickPropagation } from '@/lib/a11y';

/** Ordered but never given: held, stockout-referred, or recalled. */
const NOT_ADMINISTERED_STAGES = new Set<PrescriptionStatus>([
  'held_awaiting_clarification', 'stockout_partial_referred', 'dispensing_error_recalled',
]);

type MedTab = 'active' | 'discontinued' | 'not_administered';

const TAB_LABELS: Record<MedTab, string> = {
  active: 'Active',
  discontinued: 'Discontinued',
  not_administered: 'Not Administered',
};

const LIST_HEADINGS: Record<MedTab, string> = {
  active: 'Active Medications',
  discontinued: 'Discontinued Medications',
  not_administered: 'Not Administered',
};

const RECONCILIATION_OPTIONS = [
  'Reconciled with patient',
  'Partially reconciled',
  'Patient unable to confirm',
];

function bucketOf(rx: PrescriptionDoc): MedTab {
  if (rx.status === 'discontinued') return 'discontinued';
  return NOT_ADMINISTERED_STAGES.has(pharmacyStage(rx)) ? 'not_administered' : 'active';
}

interface MedicationsModalProps {
  patientId: string;
  patientName: string;
  currentUser: {
    _id: string; name?: string; username?: string;
    orgId?: string; hospitalId?: string; hospitalName?: string;
  } | null;
  /** The visit a renewal/entry written here belongs to, when opened from a note. */
  encounterId?: string;
  onClose: () => void;
}

export default function MedicationsModal({
  patientId, patientName, currentUser, encounterId, onClose,
}: MedicationsModalProps) {
  const { showToast } = useToast();
  const scope = useDataScope();
  const [showPrescribe, setShowPrescribe] = useState(false);
  const userName = currentUser?.name || currentUser?.username || 'Unknown user';

  const [prescriptions, setPrescriptions] = useState<PrescriptionDoc[]>([]);
  const [patient, setPatient] = useState<PatientDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<MedTab>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The consent question lives in its own dialog stacked over this one.
  const [consentPromptOpen, setConsentPromptOpen] = useState(false);
  // The history only unlocks after consent is answered "yes" in THIS dialog.
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  // "+ Med List": record a medication the patient reports taking.
  const [showAddMed, setShowAddMed] = useState(false);
  const [addMed, setAddMed] = useState({ medication: '', dose: '', frequency: '' });

  const load = useCallback(async () => {
    const { getPrescriptionsByPatient } = await import('@/lib/services/prescription-service');
    const { getPatientById } = await import('@/lib/services/patient-service');
    // Org-scoped only, not facility-scoped: the right-hand panel is a
    // deliberate cross-facility view (see file header) so it must stop at the
    // tenant boundary but must not be narrowed to one facility.
    const orgScope = scope ? { ...scope, hospitalId: undefined } : undefined;
    const [rx, pt] = await Promise.all([
      getPrescriptionsByPatient(patientId, orgScope),
      getPatientById(patientId),
    ]);
    rx.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    setPrescriptions(rx);
    setPatient(pt);
    setLoading(false);
  }, [patientId, scope]);

  useEffect(() => { void load(); }, [load]);

  // The working med list (left) is this facility's own record, same as the
  // chart's Medications tab — narrower than the org-wide network history (right).
  const facilityRx = useMemo(
    () => (scope ? filterByScope(prescriptions, scope) : prescriptions),
    [prescriptions, scope],
  );

  const counts = useMemo(() => {
    const c: Record<MedTab, number> = { active: 0, discontinued: 0, not_administered: 0 };
    for (const rx of facilityRx) c[bucketOf(rx)] += 1;
    return c;
  }, [facilityRx]);

  const rows = useMemo(
    () => facilityRx.filter(rx => bucketOf(rx) === tab),
    [facilityRx, tab],
  );
  const selected = rows.find(rx => rx._id === selectedId) || null;

  const savePatient = useCallback(async (patch: Partial<PatientDoc>) => {
    const { updatePatient } = await import('@/lib/services/patient-service');
    const updated = await updatePatient(patientId, patch);
    if (updated) setPatient(updated);
    return updated;
  }, [patientId]);

  // ── Row actions ─────────────────────────────────────────────────────────
  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (err) {
      showToast(err instanceof Error ? err.message : 'The change could not be saved.', 'error');
    } finally { setBusy(false); }
  };

  const stopFields = (reason: string) => ({
    status: 'discontinued' as const,
    stoppedAt: new Date().toISOString(),
    stoppedBy: currentUser?._id,
    stoppedByName: userName,
    stoppedSource: 'clinician' as const,
    stoppedReason: reason,
  });

  const handleRenew = () => selected && withBusy(async () => {
    const { createPrescription } = await import('@/lib/services/prescription-service');
    const result = await createPrescription({
      patientId,
      patientName,
      encounterId,
      medication: selected.medication,
      dose: selected.dose,
      route: selected.route,
      frequency: selected.frequency,
      duration: selected.duration,
      prescribedBy: userName,
      status: 'pending',
      orderStatus: 'prescribed',
      orgId: currentUser?.orgId,
      hospitalId: currentUser?.hospitalId,
      hospitalName: currentUser?.hospitalName,
    } as Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>);
    if (result.allergyWarnings?.length) {
      showToast(
        `ALLERGY ALERT — renewed against a recorded allergy: ${result.allergyWarnings
          .map(a => `${a.allergy} → ${a.medication}`)
          .join(', ')}. Review before sending.`,
        'error',
      );
    } else if (result.interactionWarnings?.hasInteractions) {
      showToast(`Renewed with interaction warning: ${result.interactionWarnings.interactions.map(i => `${i.drug1} ↔ ${i.drug2}`).join(', ')}`, 'error');
    } else {
      showToast(`${selected.medication} renewed.`, 'success');
    }
    await load();
    setSelectedId(null);
  });

  const handleDiscontinue = () => selected && withBusy(async () => {
    const reason = window.prompt('Reason for discontinuing (optional):') ?? '';
    const { updatePrescription } = await import('@/lib/services/prescription-service');
    await updatePrescription(selected._id, stopFields(reason.trim() || 'Discontinued at medications review'));
    showToast(`${selected.medication} discontinued.`, 'success');
    await load();
    setSelectedId(null);
  });

  const handleMarkError = () => selected && withBusy(async () => {
    const { updatePrescription } = await import('@/lib/services/prescription-service');
    await updatePrescription(selected._id, { orderStatus: 'dispensing_error_recalled' });
    showToast(`${selected.medication} marked as a dispensing error.`, 'success');
    await load();
    setSelectedId(null);
  });

  const handleCancelRx = () => selected && withBusy(async () => {
    const { updatePrescription } = await import('@/lib/services/prescription-service');
    await updatePrescription(selected._id, stopFields('Prescription cancelled (ordered in error)'));
    showToast(`${selected.medication} cancelled.`, 'success');
    await load();
    setSelectedId(null);
  });

  const handleAddMed = () => withBusy(async () => {
    if (!addMed.medication.trim() || !addMed.dose.trim() || !addMed.frequency.trim()) {
      showToast('Medication, dose and frequency are required.', 'error');
      return;
    }
    const { createPrescription } = await import('@/lib/services/prescription-service');
    await createPrescription({
      patientId,
      patientName,
      encounterId,
      medication: addMed.medication.trim(),
      dose: addMed.dose.trim(),
      route: '',
      frequency: addMed.frequency.trim(),
      duration: '',
      prescribedBy: `${userName} (med list entry)`,
      status: 'pending',
      orderStatus: 'prescribed',
      orgId: currentUser?.orgId,
      hospitalId: currentUser?.hospitalId,
      hospitalName: currentUser?.hospitalName,
    } as Omit<PrescriptionDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>);
    showToast(`${addMed.medication.trim()} added to the med list.`, 'success');
    setAddMed({ medication: '', dose: '', frequency: '' });
    setShowAddMed(false);
    await load();
  });

  // ── Consent gate ────────────────────────────────────────────────────────
  const consent = patient?.medHistoryConsent;
  const showHistory = consentConfirmed && consent?.granted === true;

  // Either answer is written to the patient record with who and when — the
  // audit trail is the point — then the popup closes and the panel reflects it.
  const answerConsent = (granted: boolean) => withBusy(async () => {
    await savePatient({
      medHistoryConsent: {
        granted,
        byId: currentUser?._id,
        byName: userName,
        at: new Date().toISOString(),
      },
    });
    setConsentConfirmed(granted);
    setConsentPromptOpen(false);
  });

  const shortDate = (iso?: string) => (iso ? iso.slice(0, 10) : '');

  return (
    <Modal onClose={onClose} width={1120} align="top" labelledBy="cn-meds-title">
      <div className="cn-meds">
        <div className="cn-meds-header">
          <h2 className="cn-meds-title" id="cn-meds-title">Medications</h2>
          <button type="button" className="cn-meds-close" onClick={onClose} aria-label="Close medications">
            <X size={18} />
          </button>
        </div>

        <div className="cn-meds-body">
          {/* ── Working med list ── */}
          <div className="cn-meds-left">
            <div className="cn-meds-controlrow">
              <div className="cn-segmented" aria-label="Medication lists">
                {(Object.keys(TAB_LABELS) as MedTab[]).map(key => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={tab === key}
                    onClick={() => { setTab(key); setSelectedId(null); }}
                  >
                    {TAB_LABELS[key]}{counts[key] > 0 ? ` · ${counts[key]}` : ''}
                  </button>
                ))}
              </div>
              <div className="cn-meds-adders">
                <button type="button" className="cn-btn" onClick={() => setShowPrescribe(true)}>
                  <Plus size={13} /> Prescription
                </button>
                <button type="button" className="cn-btn" onClick={() => setShowAddMed(v => !v)} aria-expanded={showAddMed}>
                  <Plus size={13} /> Med List
                </button>
              </div>
            </div>

            <label className="cn-meds-nkm">
              <input
                type="checkbox"
                checked={Boolean(patient?.noKnownMedications)}
                disabled={busy || counts.active > 0}
                title={counts.active > 0 ? 'The patient has active medications' : undefined}
                onChange={e => void savePatient({ noKnownMedications: e.target.checked })}
              />
              No known medications
            </label>

            <label className="cn-meds-reconcile">
              <span>Medication reconciliation</span>
              <Select
                className="cn-select"
                value={patient?.medReconciliation || ''}
                disabled={busy}
                onChange={e => void savePatient({
                  medReconciliation: e.target.value || undefined,
                  medReconciliationAt: e.target.value ? new Date().toISOString() : undefined,
                })}
              >
                <option value="" />
                {RECONCILIATION_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </Select>
              {patient?.medReconciliation && patient.medReconciliationAt && (
                <span className="cn-meds-reconcile-at">recorded {shortDate(patient.medReconciliationAt)}</span>
              )}
            </label>

            {showAddMed && (
              // Same labeled-field language as the Prescribe form (.cn-rx-field),
              // so this reads as a form rather than a strip of bare boxes.
              <div className="cn-meds-add">
                <label className="cn-rx-field">
                  Medication
                  <input className="cn-input" placeholder="e.g. Amoxicillin" value={addMed.medication}
                    onChange={e => setAddMed(m => ({ ...m, medication: e.target.value }))} />
                </label>
                <label className="cn-rx-field">
                  Dose
                  <input className="cn-input" placeholder="500mg" value={addMed.dose}
                    onChange={e => setAddMed(m => ({ ...m, dose: e.target.value }))} />
                </label>
                <label className="cn-rx-field">
                  Frequency
                  <input className="cn-input" placeholder="TDS" value={addMed.frequency}
                    onChange={e => setAddMed(m => ({ ...m, frequency: e.target.value }))} />
                </label>
                <button type="button" className="cn-btn cn-btn-primary" onClick={handleAddMed} disabled={busy}>Add</button>
              </div>
            )}

            <h3 className="cn-meds-listhead">{LIST_HEADINGS[tab]}</h3>
            <div className="cn-meds-list" role="listbox" aria-label={LIST_HEADINGS[tab]}>
              {loading && <p className="cn-card-empty">Loading medications…</p>}
              {!loading && rows.length === 0 && (
                <p className="cn-card-empty">
                  {tab === 'active' && patient?.noKnownMedications
                    ? 'No known medications recorded for this patient.'
                    : `No ${LIST_HEADINGS[tab].toLowerCase()} for this patient.`}
                </p>
              )}
              {rows.map(rx => (
                <div
                  key={rx._id}
                  role="option"
                  aria-selected={selectedId === rx._id}
                  tabIndex={0}
                  className={`cn-meds-row${selectedId === rx._id ? ' is-selected' : ''}`}
                  onClick={() => setSelectedId(prev => (prev === rx._id ? null : rx._id))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(prev => (prev === rx._id ? null : rx._id));
                    }
                  }}
                >
                  <div className="cn-meds-row-main">
                    <strong>{rx.medication}</strong>
                    <span>{[rx.dose, rx.route, rx.frequency, rx.duration].filter(Boolean).join(' · ')}</span>
                    <span className="cn-meds-row-meta">
                      {rx.prescribedBy || 'Prescriber not recorded'} · {shortDate(rx.createdAt)}
                      {rx.status === 'discontinued' && rx.stoppedReason ? ` · ${rx.stoppedReason}` : ''}
                    </span>
                  </div>
                  <span className="cn-meds-row-stage">
                    {rx.status === 'discontinued' ? 'Stopped' : pharmacyStageLabel(pharmacyStage(rx))}
                  </span>
                </div>
              ))}
            </div>

            <div className="cn-meds-footer">
              <button type="button" className="cn-btn" onClick={handleRenew} disabled={busy || !selected}>Renew</button>
              <button type="button" className="cn-btn" onClick={handleDiscontinue} disabled={busy || !selected || selected.status === 'discontinued'}>Discontinue</button>
              <button type="button" className="cn-btn" onClick={handleMarkError} disabled={busy || !selected}>Mark as Error</button>
              <button type="button" className="cn-btn" onClick={handleCancelRx} disabled={busy || !selected || selected.status === 'discontinued'}>Cancel Rx</button>
              <button type="button" className="cn-btn" onClick={onClose}>Close</button>
            </div>
          </div>

          {/* ── Network history behind the consent gate ── */}
          <div className="cn-meds-right">
            <h3 className="cn-meds-histhead">
              Med History via TamamHealth Network
              <span title="Prescriptions recorded for this patient across facilities in the shared record."><Info size={14} /></span>
            </h3>

            {/* No standing consent furniture: the panel rests as a quiet
                empty state, and the consent dialog appears only when the
                clinician acts — asking to see the history. */}
            {!showHistory && (
              <div className="cn-meds-histlock">
                <p className="cn-card-empty">
                  History from the shared record appears here once the patient consents.
                </p>
                <button
                  type="button"
                  className="cn-btn"
                  onClick={() => setConsentPromptOpen(true)}
                  disabled={busy || loading}
                >
                  View history
                </button>
              </div>
            )}

            {showHistory && (
              <div className="cn-meds-history">
                <p className="cn-consent-note cn-consent-note-granted">
                  <Check size={13} aria-hidden /> Consent obtained — recorded by {consent?.byName || 'staff'} on {shortDate(consent?.at)}.{' '}
                  <button type="button" className="cn-card-head-action" onClick={() => setConsentConfirmed(false)}>
                    Change
                  </button>
                </p>
                {prescriptions.length === 0 && (
                  <p className="cn-card-empty">No medication history found in the network record.</p>
                )}
                {prescriptions.map(rx => (
                  <div key={rx._id} className="cn-meds-histrow">
                    <span className="cn-meds-histdate">{shortDate(rx.createdAt)}</span>
                    <span className="cn-meds-histmed">
                      {rx.medication}{rx.dose ? ` ${rx.dose}` : ''}
                      <span className="cn-meds-row-meta"> · {rx.prescribedBy || 'Prescriber not recorded'}</span>
                    </span>
                    <span className="cn-meds-row-stage">
                      {rx.status === 'discontinued' ? 'Stopped' : pharmacyStageLabel(pharmacyStage(rx))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Consent question as its own dialog on top of the medications one.
          Yes/No answer directly — no radio-then-save two-step. */}
      {consentPromptOpen && (
        <Modal onClose={() => setConsentPromptOpen(false)} width={520} labelledBy="cn-consent-title">
          {/* `modal-panel` is load-bearing: it is one of the surface classes the
              global auto-blue-header rule excludes — without it this dialog
              (headings + buttons only) matches as one giant title bar and
              paints blue end to end. */}
          <div className="cn-consent-pop modal-panel" {...stopsClickPropagation}>
            <div className="cn-meds-header">
              <h2 className="cn-meds-title" id="cn-consent-title">Obtain Consent from Patient</h2>
              <button type="button" className="cn-meds-close" onClick={() => setConsentPromptOpen(false)} aria-label="Close consent">
                <X size={18} />
              </button>
            </div>
            <div className="cn-consent-pop-body">
              <p>
                You can view medication history retrieved from the TamamHealth shared record for
                this patient. You must obtain consent before viewing this information.
              </p>
              <p>
                Disclaimer: Certain information may not be available or accurate in this report,
                including medications the patient asked not to be disclosed, over-the-counter
                medicines, or records from facilities outside the network. The provider should
                independently verify medication history with the patient.
              </p>
              <p className="cn-consent-question">
                Does the patient consent to viewing their medication history?
              </p>
              {consent && (
                <p className="cn-consent-note">
                  Last answer: consent {consent.granted ? 'granted' : 'declined'} — recorded by{' '}
                  {consent.byName || 'staff'} on {shortDate(consent.at)}.
                </p>
              )}
            </div>
            <div className="cn-consent-pop-actions">
              <button type="button" className="cn-btn" onClick={() => answerConsent(false)} disabled={busy}>
                No — declined
              </button>
              <button type="button" className="cn-btn cn-consent-yes" onClick={() => answerConsent(true)} disabled={busy}>
                <Check size={13} /> Yes — consent given
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showPrescribe && (
        <PrescribeModal
          patientId={patientId}
          patientName={patientName}
          currentUser={currentUser}
          onClose={() => setShowPrescribe(false)}
          onPrescribed={() => void load()}
        />
      )}
    </Modal>
  );
}
