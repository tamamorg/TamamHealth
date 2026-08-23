'use client';

/**
 * PatientDispenseModal — one patient's prescriptions and the dispensing steps,
 * in a dialog.
 *
 * The clinician dashboard's "Dispense" action used to hand off to the pharmacy
 * workbench (`/dashboard/pharmacy?patientId=…`): a whole role dashboard —
 * queue lanes, KPI cards, stock charts — loaded to answer one question about
 * one patient, and the clinician lost their worklist to get there. The work
 * itself is small: read what was prescribed, and take the one step that order
 * is up to. That fits in a dialog over the page they were already on.
 *
 * The workflow is the pharmacy queue's, unchanged: `pharmacyStage()` decides
 * where an order sits, and only the step that is actually actionable now is
 * offered. Dispensing goes through the same `dispenseMedication()` transaction
 * the pharmacy page and the API route use — stock gate, FEFO batch decrement,
 * controlled-substance register and prescription update all land or all roll
 * back — so a dispense from here is not a lighter-weight dispense.
 */

import { useCallback, useMemo, useState } from 'react';
import { estimateCourseQuantity } from '@/lib/pharmacy/course-quantity';
import Modal from '@/components/Modal';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useToast } from '@/components/Toast';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import { useUsers } from '@/lib/hooks/useUsers';
import { usePatientBalances } from '@/lib/hooks/usePatientBalances';
import { medicationMatches } from '@/lib/services/dispensing-service';
import { checkNewPrescription, type DrugInteraction } from '@/lib/services/drug-interaction-service';
import { formatMoney, formatRxSig } from '@/lib/format-utils';
import {
  pharmacyStage, pharmacyStageLabel, pharmacyStageTone,
} from '@/lib/pharmacy-workflow';
import type { PrescriptionDoc, PharmacyInventoryDoc } from '@/lib/db-types';
import type { PrescriptionStatus } from '@/lib/clinical-flow/order-lifecycles';
import {
  AlertOctagon, Check, CheckCircle2, ClipboardList, Clock, Loader2, Pill, ShieldCheck, X,
  type LucideIcon,
} from '@/components/icons/lucide';
import Select from '@/components/Select';

type StepKey = 'received' | 'review' | 'checked' | 'payment' | 'dispensed' | 'counseled' | 'cleared';

/** Orders that still need something done to them. */
const DONE_STAGES = new Set<PrescriptionStatus>(['complete']);

const SEVERITY_STYLE: Record<DrugInteraction['severity'], { bg: string; border: string; text: string; label: string }> = {
  contraindicated: { bg: 'var(--color-danger-bg)', border: 'var(--color-danger-border)', text: 'var(--color-danger-text)', label: 'Contraindicated' },
  serious: { bg: 'var(--color-danger-bg)', border: 'var(--color-danger-border)', text: 'var(--color-danger-text)', label: 'Serious' },
  moderate: { bg: 'var(--color-warning-bg)', border: 'var(--color-warning-border)', text: 'var(--color-warning-text)', label: 'Moderate' },
};

/** Stage pill colours, keyed by the tone `pharmacyStageTone()` returns. */
const STAGE_PILL: Record<ReturnType<typeof pharmacyStageTone>, React.CSSProperties> = {
  scheduled: { background: 'var(--overlay-subtle)', color: 'var(--text-secondary)' },
  ready: { background: 'rgba(33,145,208,0.12)', color: 'var(--accent-primary)' },
  active: { background: 'rgba(33,145,208,0.12)', color: 'var(--accent-primary)' },
  done: { background: 'rgba(14, 148, 99,0.12)', color: 'var(--color-success)' },
  warning: { background: 'rgba(230, 114, 0,0.12)', color: 'var(--color-warning)' },
  danger: { background: 'rgba(217, 43, 32,0.12)', color: 'var(--color-danger)' },
};

/** Portal modal + the shared panel chrome (title, close), which `Modal` itself
 *  does not carry — every caller supplies its own. */
function Panel({ title, onClose, width, children }: {
  title: string;
  onClose: () => void;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <Modal onClose={onClose} width={width}>
      <div className="modal-panel" style={{ maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10 }}>
          <h2 className="truncate" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'var(--overlay-subtle)', border: 'none', cursor: 'pointer',
              width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0,
            }}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </Modal>
  );
}

export default function PatientDispenseModal({
  patientId,
  patientName,
  onClose,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { prescriptions, advance, dispense } = usePrescriptions();
  const { items: inventory } = usePharmacyInventory();
  const { users } = useUsers();

  const [confirmTarget, setConfirmTarget] = useState<{ rx: PrescriptionDoc; inv: PharmacyInventoryDoc; qty: number } | null>(null);
  const [witnessId, setWitnessId] = useState('');
  const [dispensing, setDispensing] = useState(false);

  // The payment step needs what the patient actually owes, which lives in the
  // ledger rather than on the prescription. Shared fail-closed gate: 'loading'
  // and 'error' both read as unknown, never as a fabricated cleared balance —
  // see usePatientBalances for why that distinction matters here.
  const { balanceFor, isKnownFor, isClearedFor, confirmCleared } = usePatientBalances([patientId]);

  const rows = useMemo(
    () => prescriptions
      .filter(rx => rx.patientId === patientId && rx.status !== 'discontinued')
      .sort((a, b) => {
        const aDone = DONE_STAGES.has(pharmacyStage(a)) ? 1 : 0;
        const bDone = DONE_STAGES.has(pharmacyStage(b)) ? 1 : 0;
        return aDone - bDone || (b.createdAt || '').localeCompare(a.createdAt || '');
      }),
    [prescriptions, patientId],
  );

  // Same match the pharmacy queue uses: brand/generic aware, this facility
  // only, in-stock only, soonest expiry first (FEFO).
  const facilityId = currentUser?.hospitalId;
  const findInventoryFor = useCallback((medication: string) =>
    inventory
      .filter(i => medicationMatches(medication, i.medicationName))
      .filter(i => !facilityId || i.hospitalId === facilityId)
      .filter(i => (i.stockLevel || 0) > 0)
      .sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999'))[0],
  [inventory, facilityId]);

  const interactionsFor = useCallback((rx: PrescriptionDoc): DrugInteraction[] => {
    const others = rows.filter(r => r._id !== rx._id).map(r => r.medication);
    return checkNewPrescription(rx.medication, others).interactions;
  }, [rows]);

  const advanceRx = async (rx: PrescriptionDoc, to: PrescriptionStatus, message: string) => {
    try {
      await advance(rx._id, to);
      showToast(message, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update prescription workflow.', 'error');
    }
  };

  const startReview = (rx: PrescriptionDoc) => {
    const stage = pharmacyStage(rx);
    const next: PrescriptionStatus = stage === 'prescribed' ? 'received_in_pharmacy_queue' : 'under_review';
    void advanceRx(rx, next, `${rx.medication} moved to pharmacist review.`);
  };

  const clearForDispense = (rx: PrescriptionDoc) => {
    const qty = estimateCourseQuantity(rx);
    const inv = findInventoryFor(rx.medication);
    const interactions = interactionsFor(rx);
    if (interactions.some(i => i.severity === 'contraindicated' || i.severity === 'serious')) {
      void advanceRx(rx, 'held_awaiting_clarification', 'Held for prescriber clarification because of a serious interaction.');
      return;
    }
    if (!inv || inv.stockLevel < qty) {
      void advanceRx(rx, 'stockout_partial_referred', `Stockout recorded: ${inv?.stockLevel ?? 0} ${inv?.unit || 'unit(s)'} available.`);
      return;
    }
    void advanceRx(rx, 'cleared_for_dispensing', `${rx.medication} cleared. Send patient for payment if a balance remains.`);
  };

  // No navigation from here — that is the point of the dialog. The outstanding
  // amount is what the person at this screen needs in order to act.
  const flagPayment = (rx: PrescriptionDoc) => {
    showToast(`Payment due for ${rx.patientName}: ${formatMoney(balanceFor(patientId))}. Send the patient to the cashier before dispensing.`, 'error');
  };

  const startDispense = (rx: PrescriptionDoc) => {
    if (pharmacyStage(rx) !== 'cleared_for_dispensing') {
      showToast('Check and clear the medication order before dispensing.', 'error');
      return;
    }
    // Checked before the cleared/outstanding branch: an unknown balance is
    // not "not cleared", it is "we don't know" — the honest message is
    // different, and treating it as owed would misreport a ledger outage as
    // the patient's debt.
    if (!isKnownFor(patientId)) {
      showToast('Balance unavailable — verify before dispensing.', 'error');
      return;
    }
    if (!isClearedFor(patientId)) {
      flagPayment(rx);
      return;
    }
    const qty = estimateCourseQuantity(rx);
    const inv = findInventoryFor(rx.medication);
    if (!inv || inv.stockLevel < qty) {
      showToast(`Insufficient stock: ${inv?.stockLevel ?? 0} ${inv?.unit || 'unit(s)'} available, ${qty} needed for the full course.`, 'error');
      return;
    }
    setWitnessId('');
    setConfirmTarget({ rx, inv, qty });
  };

  const confirmDispense = async () => {
    if (!confirmTarget) return;
    const { rx, inv, qty } = confirmTarget;
    const requiresWitness = !!(inv.controlledSchedule || inv.requiresWitness);
    let witness: { id: string; name: string } | null = null;
    if (requiresWitness) {
      const w = users.find(u => u._id === witnessId);
      if (!w) {
        showToast('Select a witnessing staff member.', 'error');
        return;
      }
      witness = { id: w._id, name: w.name };
    }

    setDispensing(true);
    try {
      // Live re-read, immediately before the write it gates: the balance the
      // UI last rendered may be several renders (or a whole review step)
      // stale. confirmCleared also refreshes the cached balance so a later
      // render of this same modal reflects it.
      const clearance = await confirmCleared(patientId);
      if (!clearance.cleared) {
        showToast(
          clearance.reason === 'outstanding'
            ? `Payment due for ${rx.patientName}: ${formatMoney(clearance.balance)}. Send the patient to the cashier before dispensing.`
            : 'Balance unavailable — could not verify payment before dispensing.',
          'error',
        );
        return;
      }
      const result = await dispense({
        prescription: rx,
        quantity: qty,
        dispenserId: currentUser?._id || '',
        dispenserName: currentUser?.name || currentUser?.username || '',
        facilityId: currentUser?.hospitalId || '',
        facilityName: currentUser?.hospitalName,
        orgId: currentUser?.orgId,
        witnessId: witness?.id,
        witnessName: witness?.name,
      });
      const batches = result.allocations.map(a => a.batchNumber).join(', ');
      showToast(
        result.outcome === 'partial'
          ? `Partial fill: ${result.quantityDispensed} ${inv.unit} of ${rx.medication} from batch ${batches}. Order stays open.`
          : t('pharmacy.dispensedToast', { medication: rx.medication, patient: rx.patientName }),
        result.outcome === 'partial' ? 'error' : 'success',
      );
      setConfirmTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('pharmacy.dispenseMarkFailed'), 'error');
    } finally {
      setDispensing(false);
    }
  };

  /** The one step this order is up to, in the words the pharmacy queue uses. */
  const stepFor = (rx: PrescriptionDoc) => {
    const stage = pharmacyStage(rx);
    const inv = findInventoryFor(rx.medication);
    const qty = estimateCourseQuantity(rx);
    const stockOk = !!inv && inv.stockLevel >= qty;
    // isClearedFor fails closed on an unknown balance — the fabricated
    // `useState(0)` this replaced made isFinanciallyCleared(0) read true
    // while the real fetch was still in flight or had failed, so a payment
    // step could complete itself and the row's action mislabelled as
    // "Dispense" instead of "Send to cashier".
    const paymentClear = isClearedFor(patientId);
    const balanceKnown = isKnownFor(patientId);
    const completed = {
      received: stage !== 'prescribed',
      review: !['prescribed', 'received_in_pharmacy_queue'].includes(stage),
      checked: ['cleared_for_dispensing', 'dispensed', 'counseled', 'complete'].includes(stage),
      payment: ['dispensed', 'counseled', 'complete'].includes(stage) || (stage === 'cleared_for_dispensing' && paymentClear),
      dispensed: ['dispensed', 'counseled', 'complete'].includes(stage),
      counseled: ['counseled', 'complete'].includes(stage),
      cleared: stage === 'complete',
    };
    const key: StepKey | '' =
      !completed.received ? 'received' :
      !completed.review ? 'review' :
      !completed.checked ? 'checked' :
      !completed.payment ? 'payment' :
      !completed.dispensed ? 'dispensed' :
      !completed.counseled ? 'counseled' :
      !completed.cleared ? 'cleared' :
      '';
    if (!key) return null;

    const copy: Record<StepKey, { note: string; icon: LucideIcon; label: string; onClick: () => void }> = {
      received: { note: rx.prescribedBy ? `Ordered by ${rx.prescribedBy}` : 'Waiting in pharmacy queue', icon: ClipboardList, label: 'Receive order', onClick: () => startReview(rx) },
      review: { note: 'Confirm dose, frequency, patient, allergies and interactions.', icon: ClipboardList, label: 'Check order', onClick: () => startReview(rx) },
      checked: { note: stockOk ? `${inv?.stockLevel ?? qty} ${inv?.unit || 'unit(s)'} available — ${qty} needed` : `Stock issue: ${inv?.stockLevel ?? 0} available, ${qty} needed`, icon: ShieldCheck, label: 'Clear stock and safety', onClick: () => clearForDispense(rx) },
      payment: {
        note: !balanceKnown
          ? 'Balance unavailable — verify before dispensing'
          : paymentClear ? 'Payment clear or no charge' : `${formatMoney(balanceFor(patientId))} outstanding`,
        icon: Clock, label: 'Send to cashier', onClick: () => flagPayment(rx),
      },
      dispensed: { note: 'Issue the full course and update inventory.', icon: Pill, label: t('pharmacy.dispense'), onClick: () => startDispense(rx) },
      counseled: { note: 'Explain dose, timing, side effects and return precautions.', icon: CheckCircle2, label: 'Record counseling', onClick: () => void advanceRx(rx, 'counseled', `Counseling recorded for ${rx.patientName}.`) },
      cleared: { note: 'Medication workflow complete.', icon: Check, label: 'Complete pharmacy visit', onClick: () => void advanceRx(rx, 'complete', `${rx.medication} workflow completed.`) },
    };
    return copy[key];
  };

  return (
    <>
      <Panel onClose={onClose} title={`Dispense · ${patientName}`} width={720}>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No active prescriptions for this patient.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map(rx => {
              const stage = pharmacyStage(rx);
              const inv = findInventoryFor(rx.medication);
              const qty = estimateCourseQuantity(rx);
              const step = stepFor(rx);
              const stockOk = !!inv && inv.stockLevel >= qty;
              return (
                <div
                  key={rx._id}
                  className="rounded-xl p-3"
                  style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-light)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="text-sm block" style={{ color: 'var(--text-primary)' }}>{rx.medication}</strong>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatRxSig(rx)} · {qty} {inv?.unit || 'unit(s)'}
                      </p>
                    </div>
                    {/* Styled here rather than with `.ehr-queue-pill`: the
                        dialog portals to <body>, outside the `.tamam-ehr-app`
                        scope that rule lives in, so the pill arrived as bare
                        text. */}
                    <span
                      className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
                      style={STAGE_PILL[pharmacyStageTone(stage)]}
                    >
                      {pharmacyStageLabel(stage)}
                    </span>
                  </div>

                  <div className="rounded-lg p-2.5 mt-2.5" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
                    <span className="block font-semibold uppercase tracking-wider text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>Stock &amp; batch</span>
                    {inv ? (
                      <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
                        <strong style={{ color: stockOk ? 'var(--color-success-text)' : 'var(--color-danger-text)' }}>{inv.stockLevel} {inv.unit}</strong> available
                        {inv.batchNumber ? ` · batch ${inv.batchNumber}` : ''}
                        {inv.expiryDate ? ` · exp ${inv.expiryDate}` : ''}
                        {inv.controlledSchedule || inv.requiresWitness ? ' · Controlled substance' : ''}
                      </p>
                    ) : (
                      <p className="text-xs" style={{ color: 'var(--color-danger-text)' }}>No matching inventory found for {rx.medication}.</p>
                    )}
                  </div>

                  {/* Only the actionable step, with its action — not a receipt
                      of all seven stages. */}
                  <div className="flex items-center justify-between gap-3 mt-2.5">
                    <p className="text-xs min-w-0" style={{ color: 'var(--text-secondary)' }}>
                      {step ? step.note : 'Pharmacy workflow complete.'}
                    </p>
                    {step && (
                      <button
                        type="button"
                        onClick={step.onClick}
                        className="flex items-center gap-1.5 px-3 h-[32px] rounded-lg text-[12px] font-semibold flex-shrink-0 text-white"
                        style={{ background: 'var(--accent-primary)' }}
                      >
                        <step.icon className="w-4 h-4" style={{ stroke: '#fff', color: '#fff' }} aria-hidden />
                        {step.label}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {confirmTarget && (
        <DispenseConfirm
          rx={confirmTarget.rx}
          inv={confirmTarget.inv}
          qty={confirmTarget.qty}
          interactions={interactionsFor(confirmTarget.rx)}
          witnessId={witnessId}
          onWitnessChange={setWitnessId}
          witnesses={users.filter(u => u._id !== currentUser?._id)}
          confirming={dispensing}
          onConfirm={confirmDispense}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </>
  );
}

/**
 * The confirm step: what is about to be handed over, any real interaction
 * warning from the patient's other active orders, and — for a controlled or
 * witnessed drug — a witness picker that gates the button.
 */
function DispenseConfirm({
  rx, inv, qty, interactions, witnesses, witnessId, onWitnessChange, onConfirm, onCancel, confirming,
}: {
  rx: PrescriptionDoc;
  inv: PharmacyInventoryDoc;
  qty: number;
  interactions: DrugInteraction[];
  witnesses: { _id: string; name: string; role: string }[];
  witnessId: string;
  onWitnessChange: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
}) {
  const { t } = useTranslation();
  const requiresWitness = !!(inv.controlledSchedule || inv.requiresWitness);
  const canConfirm = !confirming && (!requiresWitness || !!witnessId);

  return (
    <Panel onClose={onCancel} title={t('pharmacy.confirmDispensing')} width={448}>
      {interactions.length > 0 && (
        <div className="mb-4 space-y-2">
          {interactions.map((inter, i) => {
            const style = SEVERITY_STYLE[inter.severity];
            return (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: style.bg, border: `1px solid ${style.border}` }}>
                <AlertOctagon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: style.text, stroke: style.text }} />
                <div>
                  <p className="text-xs font-bold" style={{ color: style.text }}>{style.label}: {inter.drug1} + {inter.drug2}</p>
                  <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{inter.description}</p>
                  <p className="text-[10px] italic mt-0.5" style={{ color: 'var(--text-muted)' }}>{inter.clinicalAdvice}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2 mb-4 p-3 rounded-xl" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
        {[
          [t('pharmacy.patient'), rx.patientName],
          [t('pharmacy.medication'), rx.medication],
          [t('pharmacy.dose'), formatRxSig(rx)],
          [t('pharmacy.prescriber'), rx.prescribedBy],
          ['Quantity', `${qty} ${inv.unit}`],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
            <span className="text-xs font-semibold text-end" style={{ color: 'var(--text-primary)' }}>{value}</span>
          </div>
        ))}
      </div>

      {requiresWitness && (
        <div className="mb-4 p-3 rounded-xl" style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertOctagon className="w-4 h-4" style={{ color: 'var(--color-warning)', stroke: 'var(--color-warning)' }} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-warning-text)' }}>
              Controlled substance{inv.controlledSchedule ? ` (Schedule ${inv.controlledSchedule})` : ''} — witness required
            </span>
          </div>
          <Select
            value={witnessId}
            onChange={e => onWitnessChange(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
          >
            <option value="">Select witnessing staff…</option>
            {witnesses.map(u => <option key={u._id} value={u._id}>{u.name} — {u.role}</option>)}
          </Select>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm font-bold"
          style={{ background: 'var(--overlay-subtle)', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
        >
          {t('action.cancel')}
        </button>
        <button
          type="button"
          onClick={() => canConfirm && onConfirm()}
          disabled={!canConfirm}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-white flex items-center justify-center gap-1.5"
          style={{ background: 'var(--color-success)', opacity: canConfirm ? 1 : 0.6 }}
        >
          {confirming
            ? <Loader2 className="w-4 h-4 animate-spin" style={{ stroke: '#fff' }} />
            : <Check className="w-4 h-4" style={{ stroke: '#fff' }} />}
          {t('pharmacy.dispense')}
        </button>
      </div>
    </Panel>
  );
}
