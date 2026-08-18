'use client';

import { useState, useMemo, useEffect, useRef, Fragment } from 'react';
import Modal from '@/components/Modal';
import PatientName from '@/components/PatientName';
import { Pill, AlertTriangle, Loader2, Plus, X, Printer, Calendar, ChevronRight, AlertOctagon, Filter, Download, Check, ExternalLink } from '@/components/icons/lucide';
import EhrListHeader, { EhrListHeaderButton, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/lib/context';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { usePharmacyInventory } from '@/lib/hooks/usePharmacyInventory';
import { usePatients } from '@/lib/hooks/usePatients';
import { useUsers } from '@/lib/hooks/useUsers';
import { useToast } from '@/components/Toast';
import { medications } from '@/lib/data/formulary';
import { classifyStockStatus } from '@/lib/services/pharmacy-inventory-service';
import { medicationMatches } from '@/lib/services/dispensing-service';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatMoney } from '@/lib/format-utils';
import { isActivePharmacyStage, pharmacyStage, pharmacyStageLabel } from '@/lib/pharmacy-workflow';
import { usePatientBalances } from '@/lib/hooks/usePatientBalances';
import type { PrescriptionStatus } from '@/lib/clinical-flow/order-lifecycles';
import { prescription as rxLifecycle } from '@/lib/clinical-flow/order-lifecycles';
import Select from '@/components/Select';

const UNITS = ['tablets', 'vials', 'bottles', 'sachets', 'tubes', 'ampoules', 'sachet', 'ml'];

type PharmacyTab = 'queue' | 'inventory' | 'reorder' | 'expiry' | 'overview' | 'patients';

/**
 * The prescription sig for display.
 *
 * Seeded and clinician-entered `dose` values often already carry the whole sig
 * ("1g QDS PRN x 5 days") while `frequency` and `duration` repeat those same
 * parts as separate fields. Concatenating all three printed the tail twice —
 * "1g QDS PRN x 5 days QDS PRN x 5 days" — which is both wrong and what made
 * the Dosage column the widest one on the page. Only append a part the dose
 * does not already state.
 */
function prescriptionSig(rx: { dose?: string; frequency?: string; duration?: string }): string {
  const dose = (rx.dose || '').trim();
  const stated = dose.toLowerCase();
  const extras = [rx.frequency?.trim(), rx.duration?.trim() ? `x ${rx.duration.trim()}` : '']
    .filter((part): part is string => !!part)
    .filter(part => !stated.includes(part.replace(/^x /i, '').toLowerCase()));
  return [dose, ...extras].filter(Boolean).join(' ');
}

export default function PharmacyPage() {
  const [activeTab, setActiveTab] = useState<PharmacyTab>('queue');
  // Per-column filters: queue table (q*) + inventory table (medication name).
  // Category / stock-status filtering now lives in the shared header + table
  // toolbar (categoryFilter / statusFilter below) rather than per-column funnels.
  const [colFilters, setColFilters] = useState({ qPatient: '', qMedication: '', qPrescribedBy: '', iMedication: '' });
  // Header "Filters" popover (category + stock status) — mirrors the patients
  // registry's Filters dropdown pattern, separate from the per-column funnels.
  const [showHeaderFilters, setShowHeaderFilters] = useState(false);
  const headerFilterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showHeaderFilters) return;
    const onDown = (e: MouseEvent) => { if (headerFilterRef.current && !headerFilterRef.current.contains(e.target as Node)) setShowHeaderFilters(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowHeaderFilters(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [showHeaderFilters]);
  // Patients tab — which patient's prescription view is open (patient _id)
  const [selectedPatient, setSelectedPatient] = useState<string | null>(null);
  const { globalSearch, setGlobalSearch, currentUser } = useApp();
  const searchParams = useSearchParams();
  // Deep link from a patient chart: /pharmacy?patient=<name> pre-filters via
  // the shared global search (combined with the table's own search below).
  useEffect(() => {
    const patientParam = searchParams?.get('patient');
    if (patientParam) setGlobalSearch(patientParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const { canDispense, canAccess } = usePermissions();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const router = useRouter();
  const { prescriptions: rxQueue, loading: rxLoading, dispense, markUnfilled, advance } = usePrescriptions();
  const { items: rawInventory, create: createInventory, update: updateInventory } = usePharmacyInventory();
  const { patients } = usePatients();
  const patientById = useMemo(() => new Map(patients.map(patient => [patient._id, patient])), [patients]);
  const { users } = useUsers();
  const [workflowRxId, setWorkflowRxId] = useState<string | null>(null);
  // Controlled-substance dispense awaiting a witness sign-off.
  const [dispenseTarget, setDispenseTarget] = useState<{ rx: typeof rxQueue[number]; inv: typeof rawInventory[number]; qty: number } | null>(null);
  const [witnessId, setWitnessId] = useState('');

  // ── Shared list-page toolbar state ──
  // Table search (the listpage-table-search input) takes priority over the
  // platform-wide global search, which mainly exists now for the ?patient=
  // deep link above.
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'adequate' | 'low' | 'critical' | 'expired'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const q = tableSearch || globalSearch;
  const anyColFilter = Object.values(colFilters).some(Boolean) || !!tableSearch || statusFilter !== 'all' || categoryFilter !== 'all';
  const clearColFilters = () => {
    setColFilters({ qPatient: '', qMedication: '', qPrescribedBy: '', iMedication: '' });
    setTableSearch('');
    setStatusFilter('all');
    setCategoryFilter('all');
  };
  // On the Patients tab, drop back to the search results whenever the query
  // changes (the table search drives the patient lookup now).
  useEffect(() => { setSelectedPatient(null); }, [tableSearch, globalSearch]);

  // Filtering lives in the header search + Filters popover (matching the
  // patients registry) — no per-column funnels.
  // Field style for the selects inside the header's Filters popover (mirrors
  // the patients registry's Filters panel fields).
  const popoverFieldStyle = { background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', color: 'var(--text-primary)', borderRadius: 8, minWidth: 0 } as const;
  const statusFilterRelevant = activeTab === 'inventory' || activeTab === 'reorder' || activeTab === 'expiry';
  const headerFilterCount = (categoryFilter !== 'all' ? 1 : 0) + (statusFilterRelevant && statusFilter !== 'all' ? 1 : 0);

  // Stock-in modal state
  const [showStockInModal, setShowStockInModal] = useState(false);
  const [stockForm, setStockForm] = useState({
    medicationName: '',
    category: 'General',
    stockLevel: 0,
    unit: 'tablets',
    reorderLevel: 50,
    batchNumber: '',
    expiryDate: '',
  });

  // Augment each inventory row with a live status classification (which
  // changes over time as stock drains or the expiry date passes).
  const inventory = useMemo(() =>
    rawInventory.map(item => ({ ...item, status: classifyStockStatus(item) })),
  [rawInventory]);

  // Shared fail-closed balance gate (src/lib/hooks/usePatientBalances.ts).
  // Previously this page fetched with a single `Promise.all` and a `.catch()`
  // that reset the WHOLE map to empty on any one patient's ledger hiccup —
  // so one bad read silently defaulted every patient on the queue to a "no
  // balance" 0, and `isFinanciallyCleared(0)` is true, waving every one of
  // them through the payment gate. The hook fetches per-patient with
  // `Promise.allSettled` and only ever marks a balance 'ready' once a real
  // read for THAT patient has landed.
  const rxPatientIds = useMemo(() => rxQueue.map(rx => rx.patientId), [rxQueue]);
  const { balanceFor, isKnownFor, isClearedFor, confirmCleared } = usePatientBalances(rxPatientIds);

  // Distinct medication categories present in the current inventory, for the
  // header's "filter by category" select.
  const categories = useMemo(() => Array.from(new Set(inventory.map(i => i.category))).sort(), [inventory]);

  // Find the inventory row for a medication at the current facility.
  // Same normalised match the dispensing transaction uses, so the button
  // state can never disagree with what the transaction will find. Returns the
  // earliest-expiring in-stock batch (FEFO), which is the one that will move.
  const findInventoryFor = (medication: string) =>
    inventory
      .filter(i => medicationMatches(medication, i.medicationName))
      .filter(i => !currentUser?.hospitalId || i.hospitalId === currentUser.hospitalId)
      .filter(i => (i.stockLevel || 0) > 0)
      .sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999'))[0];

  const stockOnHandFor = (medication: string) =>
    inventory
      .filter(i => medicationMatches(medication, i.medicationName))
      .filter(i => !currentUser?.hospitalId || i.hospitalId === currentUser.hospitalId)
      .reduce((sum, i) => sum + (i.stockLevel || 0), 0);

  const advanceRx = async (rx: typeof rxQueue[number], to: PrescriptionStatus, successMessage: string) => {
    try {
      await advance(rx._id, to);
      showToast(successMessage, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update prescription workflow.', 'error');
    }
  };

  const handleStartReview = (rx: typeof rxQueue[number]) => {
    const stage = pharmacyStage(rx);
    const next: PrescriptionStatus = stage === 'prescribed' ? 'received_in_pharmacy_queue' : 'under_review';
    advanceRx(rx, next, `${rx.medication} moved to pharmacist review.`);
  };

  const handleClearForDispense = (rx: typeof rxQueue[number]) => {
    const qty = rx.quantityToDispense || 1;
    const inv = findInventoryFor(rx.medication);
    if (!inv || inv.stockLevel < qty) {
      advanceRx(rx, 'stockout_partial_referred', `Stockout recorded: ${inv?.stockLevel ?? 0} ${inv?.unit || 'unit(s)'} available.`);
      return;
    }
    advanceRx(rx, 'cleared_for_dispensing', `${rx.medication} cleared. Send patient for payment if a balance remains.`);
  };

  const handlePaymentStep = (rx: typeof rxQueue[number]) => {
    if (canAccess('/payments') && rx.patientId) {
      router.push(`/payments?patientId=${rx.patientId}`);
      return;
    }
    const message = isKnownFor(rx.patientId)
      ? `Payment due for ${rx.patientName}: ${formatMoney(balanceFor(rx.patientId))}. Send the patient to cashier before dispensing.`
      : `Could not confirm ${rx.patientName}'s balance. Send the patient to cashier to verify before dispensing.`;
    showToast(message, 'error');
  };

  const handleCounsel = (rx: typeof rxQueue[number]) =>
    advanceRx(rx, 'counseled', `Counseling recorded for ${rx.patientName}.`);

  const handleComplete = (rx: typeof rxQueue[number]) =>
    advanceRx(rx, 'complete', `${rx.medication} workflow completed.`);

  // One call, one transaction. The stock gate, FEFO batch decrement, the
  // controlled-substance register entry and the prescription update all run
  // inside dispenseMedication(), which rolls back anything already applied if
  // a later step fails — so this can no longer leave stock moved with no
  // dispense record (or the reverse), which the old three-await sequence did.
  const doDispense = async (
    rx: typeof rxQueue[number],
    inv: typeof rawInventory[number] | undefined,
    qty: number,
    witness: { id: string; name: string } | null,
  ): Promise<boolean> => {
    // Live re-read of the ledger, immediately before the write it gates. The
    // on-screen balance (what handleDispense checked to decide whether to
    // even get here) can already be stale by the time this fires — a witness
    // pick, a slow click, or just queue time passing. confirmCleared also
    // refreshes the cached balance so the row reflects it on the next render.
    if (rx.patientId) {
      const clearance = await confirmCleared(rx.patientId);
      if (!clearance.cleared) {
        showToast(
          clearance.reason === 'outstanding'
            ? `Payment still due for ${rx.patientName}: ${formatMoney(clearance.balance)}. Send the patient to cashier before dispensing.`
            : `Could not confirm ${rx.patientName}'s balance — balance unavailable. Dispense cancelled.`,
          'error',
        );
        return false;
      }
    }
    try {
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
          ? `Partial fill: ${result.quantityDispensed} ${inv?.unit || 'unit(s)'} of ${rx.medication} from batch ${batches}. Order stays open for the balance.`
          : `${rx.medication} dispensed from batch ${batches}.`,
        result.outcome === 'partial' ? 'error' : 'success',
      );
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Dispense failed.', 'error');
      return false;
    }
  };

  /** Stock-out referral / prescriber clarification — the two non-dispense
   *  outcomes the lifecycle has always had but nothing could reach. */
  const markRxUnfilled = async (
    rx: typeof rxQueue[number],
    reason: 'stock_out' | 'clarification_requested',
  ) => {
    const note = window.prompt(
      reason === 'stock_out'
        ? 'Where is the patient being referred for this medicine?'
        : 'What needs clarifying with the prescriber?',
    );
    if (note === null) return;
    try {
      await markUnfilled(rx, reason, note.trim(), {
        id: currentUser?._id || '',
        name: currentUser?.name || currentUser?.username || '',
      });
      showToast(
        reason === 'stock_out'
          ? `${rx.medication} recorded as out of stock — order stays open.`
          : `${rx.medication} held pending prescriber clarification.`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record the outcome.', 'error');
    }
  };

  const handleDispense = async (rxId: string, overrideQty?: number) => {
    const rx = rxQueue.find(r => r._id === rxId);
    if (!rx) return;
    // Checked before the cleared/outstanding branch: an unresolved balance
    // (still loading, or the ledger fetch errored) is not "money owed" — it's
    // "we don't know" — and must not fall through to the stock check below.
    if (!isKnownFor(rx.patientId)) {
      showToast(`Could not confirm ${rx.patientName}'s balance — balance unavailable. Try again before dispensing.`, 'error');
      return;
    }
    if (!isClearedFor(rx.patientId)) {
      handlePaymentStep(rx);
      return;
    }
    const qty = overrideQty ?? ((rx.quantityToDispense || 1) - (rx.quantityDispensed || 0));
    const inv = findInventoryFor(rx.medication);
    // Clearance, stock and expiry are all re-checked inside the transaction
    // against live batch data — this only decides whether to collect a
    // witness signature first, so the modal isn't shown for nothing.
    if (inv?.controlledSchedule || inv?.requiresWitness) {
      setWitnessId('');
      setDispenseTarget({ rx, inv, qty });
      return;
    }
    await doDispense(rx, inv, qty, null);
  };

  const confirmControlledDispense = async () => {
    if (!dispenseTarget) return;
    const witness = users.find(u => u._id === witnessId);
    if (!witness) {
      showToast('Select a witnessing staff member.', 'error');
      return;
    }
    const ok = await doDispense(dispenseTarget.rx, dispenseTarget.inv, dispenseTarget.qty, { id: witness._id, name: witness.name });
    if (ok) setDispenseTarget(null);
  };

  /**
   * Explicit branch actions (KAN-39). `stockout_partial_referred` was only ever
   * reachable as a side effect of "Clear" finding the shelf empty, and
   * `held_awaiting_clarification` / `dispensing_error_recalled` were not
   * reachable from the UI at all — so three states the lifecycle defines could
   * never be entered by a pharmacist who needed them.
   */
  // Both outcomes capture WHY through recordUnfilled — a status flip alone
  // tells the next pharmacist nothing about where the patient was referred or
  // what the prescriber was asked.
  const handleHold = (rx: typeof rxQueue[number]) =>
    markRxUnfilled(rx, 'clarification_requested');

  const handleStockout = (rx: typeof rxQueue[number]) =>
    markRxUnfilled(rx, 'stock_out');

  const handleRecall = (rx: typeof rxQueue[number]) =>
    advanceRx(rx, 'dispensing_error_recalled', `${rx.medication} recalled — dispensing error logged. Re-check before re-issuing.`);

  /**
   * Secondary actions available alongside the main step action, gated on the
   * lifecycle so a pharmacist is never offered a transition the service layer
   * would reject.
   */
  const secondaryActionsFor = (rx: typeof rxQueue[number]): Array<{ label: string; onClick: () => void; tone?: 'danger' }> => {
    if (!canDispense) return [];
    const stage = pharmacyStage(rx);
    const out: Array<{ label: string; onClick: () => void; tone?: 'danger' }> = [];
    if (rxLifecycle.can(stage, 'held_awaiting_clarification')) {
      out.push({ label: 'Hold — query prescriber', onClick: () => handleHold(rx) });
    }
    if (rxLifecycle.can(stage, 'stockout_partial_referred')) {
      out.push({ label: 'Record stockout', onClick: () => handleStockout(rx) });
    }
    if (rxLifecycle.can(stage, 'dispensing_error_recalled')) {
      out.push({ label: 'Recall — dispensing error', onClick: () => handleRecall(rx), tone: 'danger' });
    }
    return out;
  };

  const workflowActionFor = (rx: typeof rxQueue[number]): { label?: string; onClick?: () => void; disabled?: boolean; disabledReason?: string } => {
    if (!canDispense) return {};
    const stage = pharmacyStage(rx);
    if (stage === 'prescribed') {
      return { label: 'Receive order', onClick: () => handleStartReview(rx) };
    }
    if (stage === 'received_in_pharmacy_queue') {
      return { label: 'Check order', onClick: () => handleStartReview(rx) };
    }
    if (stage === 'under_review' || stage === 'held_awaiting_clarification' || stage === 'stockout_partial_referred' || stage === 'clinician_consultation_in_progress') {
      return { label: 'Clear', onClick: () => handleClearForDispense(rx) };
    }
    if (stage === 'cleared_for_dispensing' && !isClearedFor(rx.patientId)) {
      return { label: canAccess('/payments') ? 'Collect payment' : 'Send to cashier', onClick: () => handlePaymentStep(rx) };
    }
    if (stage === 'cleared_for_dispensing') {
      // Stock position drives which dispense is on offer. A shelf that cannot
      // cover the full course is not a dead end any more: the pharmacist can
      // hand over what exists as a partial fill and the order stays open for
      // the balance. Only a genuinely empty shelf disables the button, and
      // "Record stockout" is the route forward there.
      const dispenseQty = (rx.quantityToDispense || 1) - (rx.quantityDispensed || 0);
      const onHand = stockOnHandFor(rx.medication);
      if (onHand <= 0) {
        return {
          label: t('pharmacy.dispense'),
          disabled: true,
          disabledReason: 'Out of stock — record a stockout referral instead.',
        };
      }
      if (onHand < dispenseQty) {
        return {
          label: `Dispense ${onHand} of ${dispenseQty}`,
          onClick: () => handleDispense(rx._id, onHand),
        };
      }
      return { label: t('pharmacy.dispense'), onClick: () => handleDispense(rx._id) };
    }
    if (stage === 'dispensed') {
      return { label: 'Counsel', onClick: () => handleCounsel(rx) };
    }
    if (stage === 'counseled') {
      return { label: 'Complete', onClick: () => handleComplete(rx) };
    }
    return {};
  };


  const renderWorkflowPopup = (rx: typeof rxQueue[number]) => {
    const stage = pharmacyStage(rx);
    const balance = balanceFor(rx.patientId);
    const balanceKnown = isKnownFor(rx.patientId);
    const inv = findInventoryFor(rx.medication);
    const qty = rx.quantityToDispense || 1;
    const stockOk = !!inv && inv.stockLevel >= qty;
    const paymentClear = isClearedFor(rx.patientId);
    const action = workflowActionFor(rx);
    const completed = {
      received: stage !== 'prescribed',
      review: !['prescribed', 'received_in_pharmacy_queue'].includes(stage),
      checked: ['cleared_for_dispensing', 'dispensed', 'counseled', 'complete'].includes(stage),
      payment: ['dispensed', 'counseled', 'complete'].includes(stage) || (stage === 'cleared_for_dispensing' && paymentClear),
      dispensed: ['dispensed', 'counseled', 'complete'].includes(stage),
      counseled: ['counseled', 'complete'].includes(stage),
      cleared: stage === 'complete',
    };
    const currentKey =
      !completed.received ? 'received' :
      !completed.review ? 'review' :
      !completed.checked ? 'checked' :
      !completed.payment ? 'payment' :
      !completed.dispensed ? 'dispensed' :
      !completed.counseled ? 'counseled' :
      !completed.cleared ? 'cleared' :
      '';
    const steps = [
      { key: 'received', label: 'Medication order received', note: rx.prescribedBy ? `Ordered by ${rx.prescribedBy}` : 'Waiting in pharmacy queue', done: completed.received },
      { key: 'review', label: 'Check medication order', note: 'Confirm dose, frequency, patient and allergies.', done: completed.review },
      { key: 'checked', label: 'Stock and safety clearance', note: stockOk ? `${qty} ${inv?.unit || 'unit(s)'} available` : `Stock issue: ${inv?.stockLevel ?? 0} available, ${qty} needed`, done: completed.checked },
      { key: 'payment', label: 'Receive / confirm payment', note: !balanceKnown ? 'Balance unavailable — verify before dispensing' : paymentClear ? 'Payment clear or no charge' : `${formatMoney(balance)} outstanding`, done: completed.payment },
      { key: 'dispensed', label: 'Dispense medication', note: 'Issue the full course and update inventory.', done: completed.dispensed },
      { key: 'counseled', label: 'Counsel patient', note: 'Explain dose, timing, side effects and return precautions.', done: completed.counseled },
      { key: 'cleared', label: 'Clear patient from pharmacy', note: 'Medication workflow complete.', done: completed.cleared },
    ];

    return (
      <div className="space-y-4">
        <div className="rounded-xl p-3" style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div><span className="block font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Ordered</span><strong>{rx.medication}</strong></div>
            <div><span className="block font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Dose</span><strong>{prescriptionSig(rx)}</strong></div>
            <div><span className="block font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Payment</span><strong style={{ color: paymentClear ? 'var(--color-success-text)' : 'var(--color-warning-text)' }}>{paymentClear ? 'Clear' : balanceKnown ? formatMoney(balance) : 'Unknown'}</strong></div>
            <div><span className="block font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stage</span><strong>{pharmacyStageLabel(stage)}</strong></div>
          </div>
          {rx.patientId && (
            <button
              type="button"
              className="btn btn-secondary btn-sm mt-3"
              onClick={() => router.push(`/patients/${rx.patientId}?tab=prescriptions`)}
              title={`Open ${rx.patientName}'s chart`}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open patient chart
            </button>
          )}
        </div>
        <div className="space-y-2">
          {steps.map((step, index) => {
            const isCurrent = step.key === currentKey;
            return (
              <div key={step.key} className="flex items-start gap-3 rounded-xl p-3" style={{
                background: isCurrent ? 'var(--bg-card)' : 'var(--overlay-subtle)',
                border: `1px solid ${isCurrent ? 'var(--accent-primary)' : 'var(--border-light)'}`,
              }}>
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{
                  background: step.done ? 'var(--color-success)' : isCurrent ? 'var(--accent-primary)' : 'var(--overlay-medium)',
                  color: step.done || isCurrent ? '#fff' : 'var(--text-muted)',
                }}>
                  {step.done ? <Check className="w-3.5 h-3.5" /> : index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{step.label}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{step.note}</p>
                </div>
              </div>
            );
          })}
        </div>
        {action.label && action.disabled && (
          <div className="space-y-1">
            <button type="button" className="btn btn-primary w-full" disabled title={action.disabledReason}>
              {action.label}
            </button>
            {action.disabledReason && (
              <p className="text-xs" style={{ color: 'var(--color-warning-text)' }}>{action.disabledReason}</p>
            )}
          </div>
        )}
        {secondaryActionsFor(rx).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {secondaryActionsFor(rx).map(secondary => (
              <button
                key={secondary.label}
                type="button"
                className="btn btn-secondary"
                style={secondary.tone === 'danger' ? { color: 'var(--color-danger-text)' } : undefined}
                onClick={secondary.onClick}
              >
                {secondary.label}
              </button>
            ))}
          </div>
        )}
        {action.label && action.onClick && (
          <button type="button" className="btn btn-primary w-full" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    );
  };

  const handleStockIn = async () => {
    if (!stockForm.medicationName.trim() || stockForm.stockLevel <= 0) {
      showToast(t('pharmacy.medAndStockRequired'), 'error');
      return;
    }
    if (!currentUser?.hospitalId) {
      showToast(t('pharmacy.noFacilityAssigned'), 'error');
      return;
    }
    try {
      await createInventory({
        hospitalId: currentUser.hospitalId,
        hospitalName: currentUser.hospitalName || '',
        medicationName: stockForm.medicationName.trim(),
        category: stockForm.category,
        stockLevel: stockForm.stockLevel,
        unit: stockForm.unit,
        reorderLevel: stockForm.reorderLevel,
        batchNumber: stockForm.batchNumber.trim() || `BN${Date.now().toString(36).toUpperCase()}`,
        expiryDate: stockForm.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        lastReceived: new Date().toISOString(),
        orgId: currentUser.orgId,
      });
      showToast(t('pharmacy.stockedMedication', { medication: stockForm.medicationName }), 'success');
      setShowStockInModal(false);
      setStockForm({ medicationName: '', category: 'General', stockLevel: 0, unit: 'tablets', reorderLevel: 50, batchNumber: '', expiryDate: '' });
    } catch (err) {
      console.error(err);
      showToast(t('pharmacy.saveStockReceiptFailed'), 'error');
    }
  };

  // Restock modal state — replaces the prompt() shortcut so users can also
  // record batch + expiry on a top-up, not just the quantity.
  const [restockTarget, setRestockTarget] = useState<{ id: string; name: string; unit: string } | null>(null);
  const [restockForm, setRestockForm] = useState({ qty: 0, batchNumber: '', expiryDate: '' });

  const openRestock = (itemId: string) => {
    const existing = inventory.find(i => i._id === itemId);
    if (!existing) return;
    setRestockTarget({ id: existing._id, name: existing.medicationName, unit: existing.unit });
    setRestockForm({ qty: 0, batchNumber: existing.batchNumber || '', expiryDate: existing.expiryDate || '' });
  };

  const handleRestock = async () => {
    if (!restockTarget || restockForm.qty <= 0) {
      showToast(t('pharmacy.enterQtyGreaterThanZero'), 'error');
      return;
    }
    const existing = inventory.find(i => i._id === restockTarget.id);
    if (!existing) { setRestockTarget(null); return; }
    try {
      await updateInventory(restockTarget.id, {
        stockLevel: existing.stockLevel + restockForm.qty,
        lastReceived: new Date().toISOString(),
        ...(restockForm.batchNumber.trim() ? { batchNumber: restockForm.batchNumber.trim() } : {}),
        ...(restockForm.expiryDate ? { expiryDate: restockForm.expiryDate } : {}),
      });
      showToast(t('pharmacy.addedToStockToast', { qty: restockForm.qty, unit: restockTarget.unit, name: restockTarget.name }), 'success');
      setRestockTarget(null);
    } catch (err) {
      console.error(err);
      showToast(t('pharmacy.updateStockFailed'), 'error');
    }
  };

  const pendingRx = rxQueue.filter(r => r.status === 'pending').length;
  const paymentDueCount = rxQueue.filter(r => pharmacyStage(r) === 'cleared_for_dispensing' && !isClearedFor(r.patientId)).length;
  const readyCount = rxQueue.filter(r => pharmacyStage(r) === 'cleared_for_dispensing' && isClearedFor(r.patientId)).length;
  const lowStock = inventory.filter(i => i.status === 'low' || i.status === 'critical').length;
  const totalDispensedToday = inventory.reduce((sum, i) => sum + (i.dispensedToday || 0), 0);

  const filteredInventory = inventory.filter(i => {
    if (q && !(i.medicationName.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()))) return false;
    if (colFilters.iMedication && !i.medicationName.toLowerCase().includes(colFilters.iMedication.toLowerCase())) return false;
    if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    return true;
  });

  const filteredQueue = rxQueue.filter(rx => {
    if (!isActivePharmacyStage(pharmacyStage(rx)) || rx.status === 'discontinued') return false;
    if (q && !(rx.patientName.toLowerCase().includes(q.toLowerCase()) || rx.medication.toLowerCase().includes(q.toLowerCase()) || rx.prescribedBy.toLowerCase().includes(q.toLowerCase()))) return false;
    if (colFilters.qPatient && !rx.patientName.toLowerCase().includes(colFilters.qPatient.toLowerCase())) return false;
    if (colFilters.qMedication && !rx.medication.toLowerCase().includes(colFilters.qMedication.toLowerCase())) return false;
    if (colFilters.qPrescribedBy && !rx.prescribedBy.toLowerCase().includes(colFilters.qPrescribedBy.toLowerCase())) return false;
    return true;
  }).sort((a, b) => {
    // Emergency/immediate meds (given before results) float to the top of the
    // pending queue so they're dispensed first.
    const rank = (r: typeof a) => {
      const stage = pharmacyStage(r);
      if (r.urgency === 'immediate') return 0;
      if (stage === 'received_in_pharmacy_queue') return 1;
      if (stage === 'under_review') return 2;
      if (stage === 'cleared_for_dispensing' && !isClearedFor(r.patientId)) return 3;
      if (stage === 'cleared_for_dispensing') return 4;
      if (stage === 'dispensed') return 5;
      return 6;
    };
    return rank(a) - rank(b);
  });

  // ── Derived data for the Reorder / Expiry / Overview / Patients tabs ──
  const todayStr = new Date().toISOString().slice(0, 10);
  const daysUntil = (date?: string) =>
    date ? Math.ceil((new Date(date).getTime() - new Date(todayStr).getTime()) / 86400000) : Infinity;

  // Reorder: anything at or below its reorder level (low or critical), neediest first.
  const reorderList = useMemo(() =>
    inventory
      .filter(i => i.status === 'low' || i.status === 'critical')
      .filter(i => !q || i.medicationName.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()))
      .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
      .filter(i => statusFilter === 'all' || i.status === statusFilter)
      .sort((a, b) => a.stockLevel - b.stockLevel),
  [inventory, q, categoryFilter, statusFilter]);

  // The order quantity a reorder line should request: enough to reach double
  // its reorder level, never less than the reorder level itself.
  const orderQtyFor = (item: typeof inventory[number]) => Math.max(item.reorderLevel * 2 - item.stockLevel, item.reorderLevel);

  // Expiry (FEFO): soonest-to-expire first.
  const expiryList = useMemo(() =>
    [...inventory]
      .filter(i => !q || i.medicationName.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase()))
      .filter(i => categoryFilter === 'all' || i.category === categoryFilter)
      .filter(i => statusFilter === 'all' || i.status === statusFilter)
      .sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || '')),
  [inventory, q, categoryFilter, statusFilter]);
  const expiredCount = inventory.filter(i => i.status === 'expired').length;
  const expiryStatusFor = (item: typeof inventory[number]) => {
    const days = daysUntil(item.expiryDate);
    const expired = item.status === 'expired' || days <= 0;
    const soon = !expired && days <= 90;
    return { days, expired, soon };
  };

  // Overview: aggregate item counts + stock by category.
  const categoryOverview = useMemo(() => {
    const map = new Map<string, { category: string; items: number; units: number; adequate: number; low: number; critical: number; expired: number }>();
    for (const i of inventory) {
      const c = map.get(i.category) || { category: i.category, items: 0, units: 0, adequate: 0, low: 0, critical: 0, expired: 0 };
      c.items += 1;
      c.units += i.stockLevel;
      c[i.status] += 1;
      map.set(i.category, c);
    }
    // Surface the categories that need attention first: most at-risk
    // (critical + expired + low) lines, then by units held.
    return [...map.values()]
      .filter(c => !q || c.category.toLowerCase().includes(q.toLowerCase()))
      .filter(c => categoryFilter === 'all' || c.category === categoryFilter)
      .sort((a, b) => {
        const riskA = a.critical + a.expired + a.low;
        const riskB = b.critical + b.expired + b.low;
        return riskB - riskA || b.units - a.units;
      });
  }, [inventory, q, categoryFilter]);
  const totalUnits = inventory.reduce((s, i) => s + i.stockLevel, 0);

  // Patients: search the real patient registry (name / hospital number / phone),
  // not just people who already have a prescription queued — so any patient is findable.
  const patientName = (p: typeof patients[number]) => [p.firstName, p.middleName, p.surname].filter(Boolean).join(' ');
  const rxFor = (p: typeof patients[number]) =>
    rxQueue.filter(r => r.patientId === p._id || r.patientName === patientName(p));
  const patientResults = useMemo(() => {
    const query = q.trim().toLowerCase();
    return patients
      .filter(p => !query ||
        patientName(p).toLowerCase().includes(query) ||
        (p.hospitalNumber || '').toLowerCase().includes(query) ||
        (p.phone || '').toLowerCase().includes(query))
      .sort((a, b) => patientName(a).localeCompare(patientName(b)))
      .slice(0, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patients, q, rxQueue]);
  const activePatient = selectedPatient ? patients.find(p => p._id === selectedPatient) : null;
  const activeRxs = activePatient ? rxFor(activePatient) : [];

  // Print a reorder / purchase order from the items currently needing restock.
  const handlePrintReorder = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const rows = reorderList.map(i =>
      `<tr><td>${i.medicationName}</td><td>${i.category}</td><td>${i.stockLevel} ${i.unit}</td><td>${i.reorderLevel}</td><td>${orderQtyFor(i)}</td></tr>`
    ).join('');
    w.document.write(`<html><head><title>${t('pharmacy.purchaseOrder')}</title><style>
      body{font-family:system-ui,sans-serif;padding:30px;} h1{font-size:18px;margin-bottom:4px;} h2{font-size:13px;color:#666;margin-bottom:18px;}
      table{width:100%;border-collapse:collapse;} th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:13px;} th{background:#f3f4f6;}
      .footer{margin-top:36px;font-size:12px;color:#888;}
    </style></head><body>
      <h1>${t('pharmacy.purchaseOrderRestock')}</h1>
      <h2>${currentUser?.hospitalName || ''} · ${new Date().toLocaleDateString('en-GB')}</h2>
      <table><thead><tr>
        <th>${t('pharmacy.medication')}</th><th>${t('pharmacy.category')}</th><th>${t('pharmacy.currentStock')}</th><th>${t('pharmacy.reorderLevel')}</th><th>${t('pharmacy.orderQty')}</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <div class="footer">${t('pharmacy.authorizedBy')}: _____________________ &nbsp;&nbsp; ${t('pharmacy.dateLabel')}: _____________________</div>
    </body></html>`);
    w.document.close();
    w.print();
  };

  // Export the rows currently visible on the active tab to CSV — mirrors the
  // patients/appointments list-page "Download" toolbar action.
  const handleDownloadCsv = () => {
    let header: string[] = [];
    let rows: (string | number)[][] = [];
    switch (activeTab) {
      case 'queue':
        header = [t('pharmacy.patient'), t('pharmacy.medication'), t('pharmacy.dosage'), t('pharmacy.prescribedBy'), t('pharmacy.time'), t('pharmacy.statusLabel'), 'Payment'];
        rows = filteredQueue.map(rx => [
          rx.patientName,
          rx.medication,
          prescriptionSig(rx),
          rx.prescribedBy,
          rx.createdAt ? new Date(rx.createdAt).toLocaleString('en-GB') : '',
          pharmacyStageLabel(pharmacyStage(rx)),
          isClearedFor(rx.patientId) ? 'Clear' : isKnownFor(rx.patientId) ? formatMoney(balanceFor(rx.patientId)) : 'Unknown',
        ]);
        break;
      case 'inventory':
        header = [t('pharmacy.medication'), t('pharmacy.category'), t('pharmacy.stockLabel'), t('pharmacy.reorderLevel'), t('pharmacy.statusLabel'), t('pharmacy.batchLabel'), t('pharmacy.expiry'), t('pharmacy.kpiDispensedToday')];
        rows = filteredInventory.map(i => [
          i.medicationName,
          i.category,
          `${i.stockLevel} ${i.unit}`,
          `${i.reorderLevel} ${i.unit}`,
          i.status === 'adequate' ? t('pharmacy.inStock') : t(`pharmacy.invStatus_${i.status}`),
          i.batchNumber,
          i.expiryDate,
          i.dispensedToday,
        ]);
        break;
      case 'reorder':
        header = [t('pharmacy.medication'), t('pharmacy.category'), t('pharmacy.stockLabel'), t('pharmacy.reorderLevel'), t('pharmacy.orderQty'), t('pharmacy.statusLabel')];
        rows = reorderList.map(i => [
          i.medicationName, i.category, `${i.stockLevel} ${i.unit}`, i.reorderLevel,
          `${orderQtyFor(i)} ${i.unit}`, t(`pharmacy.invStatus_${i.status}`),
        ]);
        break;
      case 'expiry':
        header = [t('pharmacy.medication'), t('pharmacy.batchLabel'), t('pharmacy.stockLabel'), t('pharmacy.expiry'), t('pharmacy.statusLabel')];
        rows = expiryList.map(i => {
          const { days, expired } = expiryStatusFor(i);
          return [
            i.medicationName, i.batchNumber, `${i.stockLevel} ${i.unit}`, i.expiryDate,
            expired ? t('pharmacy.expired') : t('pharmacy.daysLeft', { count: days }),
          ];
        });
        break;
      case 'overview':
        header = [t('pharmacy.category'), t('pharmacy.action'), t('pharmacy.stockLabel'), 'Adequate', 'Low', 'Critical', t('pharmacy.kpiExpired')];
        rows = categoryOverview.map(c => [c.category, c.items, c.units, c.adequate, c.low, c.critical, c.expired]);
        break;
      case 'patients':
        header = [t('pharmacy.patient'), t('patients.colHospitalNo'), 'Prescriptions on record', t('pharmacy.pending')];
        rows = patientResults.map(p => {
          const rxs = rxFor(p);
          return [patientName(p), p.hospitalNumber || '', rxs.length, rxs.filter(r => r.status === 'pending').length];
        });
        break;
    }
    const csv = [header, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pharmacy-${activeTab}-${todayStr}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const tabsConfig: { key: PharmacyTab; label: string }[] = [
    { key: 'queue', label: `${t('pharmacy.prescriptionQueue')} (${pendingRx})` },
    { key: 'overview', label: t('pharmacy.inventoryOverview') },
    { key: 'inventory', label: `${t('pharmacy.inventory')} (${inventory.length})${lowStock > 0 ? ` · ${lowStock} ${t('pharmacy.kpiLowStockItems')}` : ''}` },
    { key: 'reorder', label: `${t('pharmacy.reorderNeeded')} (${reorderList.length})` },
    { key: 'expiry', label: `${t('pharmacy.expiryTracker')}${expiredCount > 0 ? ` · ${expiredCount} ${t('pharmacy.kpiExpired')}` : ''}` },
    { key: 'patients', label: t('pharmacy.patientMedHistory') },
  ];

  const sectionTitles: Record<PharmacyTab, string> = {
    queue: t('pharmacy.prescriptionQueue'),
    overview: t('pharmacy.inventoryOverview'),
    inventory: t('pharmacy.medicationInventory'),
    reorder: t('pharmacy.reorderNeeded'),
    expiry: t('pharmacy.expiryTracker'),
    patients: t('pharmacy.patientMedHistory'),
  };

  return (
    <main className="page-container page-enter">
      {/* ═══ Table card ═══ */}
      <div className="card-elevated overflow-hidden">
        <EhrListHeader
          title={sectionTitles[activeTab]}
          stats={[
            { label: t('pharmacy.prescriptionQueue'), value: rxQueue.length, color: LIST_STAT_COLORS.muted },
            { label: t('pharmacy.pending'), value: pendingRx, color: LIST_STAT_COLORS.blue },
            { label: 'Payment due', value: paymentDueCount, color: LIST_STAT_COLORS.amber },
            { label: 'Ready', value: readyCount, color: LIST_STAT_COLORS.green },
            { label: t('pharmacy.kpiDispensedToday'), value: totalDispensedToday, color: LIST_STAT_COLORS.amber },
            { label: 'Low stock', value: lowStock, color: LIST_STAT_COLORS.green },
          ]}
          search={!(activeTab === 'patients' && activePatient) ? { value: tableSearch, onChange: setTableSearch, placeholder: 'Filter table', ariaLabel: 'Filter table' } : undefined}
          actions={
            <>
              {/* View switcher. Was a six-tab strip under the header, which ran
                  ~1400px wide and scrolled horizontally on anything narrower;
                  as a select it sits beside the search and the card title
                  already names the current view. Counts stay on the options. */}
              <Select
                value={activeTab}
                onChange={e => setActiveTab(e.target.value as PharmacyTab)}
                aria-label="Choose which pharmacy view to display"
                title="Choose which pharmacy view to display"
                style={{
                  height: 38,
                  width: 'auto',
                  maxWidth: 320,
                  flexShrink: 0,
                  // 8px, matching the square icon buttons beside it.
                  borderRadius: 8,
                  padding: '0 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--accent-primary)',
                }}
              >
                {tabsConfig.map(tab => (
                  <option key={tab.key} value={tab.key}>{tab.label}</option>
                ))}
              </Select>
              <div className="relative" ref={headerFilterRef}>
                <EhrListHeaderButton
                  onClick={() => setShowHeaderFilters(s => !s)}
                  active={headerFilterCount > 0}
                  ariaExpanded={showHeaderFilters}
                  ariaLabel={t('patients.filtersTitle')}
                >
                  <Filter className="w-4 h-4" />
                  {headerFilterCount > 0 && (
                    <span className="absolute inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold" style={{ top: -4, right: -4, background: 'var(--accent-primary)', color: '#fff' }}>
                      {headerFilterCount}
                    </span>
                  )}
                </EhrListHeaderButton>
                {showHeaderFilters && (
                  <div
                    className="absolute end-0 mt-2 rounded-2xl overflow-hidden z-50"
                    style={{ width: 'min(92vw, 420px)', background: 'var(--bg-card-solid)', border: '1px solid var(--border-medium)', boxShadow: 'var(--card-shadow-lg, 0 16px 48px rgba(0,0,0,0.2))' }}
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-light)' }}>
                      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('patients.filtersTitle')}</span>
                      <div className="flex items-center gap-2">
                        {headerFilterCount > 0 && (
                          <button type="button" onClick={() => { setCategoryFilter('all'); setStatusFilter('all'); }} className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{t('nurse.clearAllFilters')}</button>
                        )}
                        <button type="button" onClick={() => setShowHeaderFilters(false)} className="p-1 rounded hover:bg-[var(--overlay-subtle)]" aria-label={t('action.close')}>
                          <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      </div>
                    </div>
                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('pharmacy.category')}</span>
                        <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="w-full text-sm py-2 px-3" style={popoverFieldStyle}>
                          <option value="all">{t('patients.all')}</option>
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </Select>
                      </label>
                      {statusFilterRelevant && (
                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('pharmacy.statusLabel')}</span>
                          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full text-sm py-2 px-3" style={popoverFieldStyle}>
                            <option value="all">{t('patients.all')}</option>
                            <option value="adequate">{t('pharmacy.inStock')}</option>
                            <option value="low">{t('pharmacy.invStatus_low')}</option>
                            <option value="critical">{t('pharmacy.invStatus_critical')}</option>
                            <option value="expired">{t('pharmacy.invStatus_expired')}</option>
                          </Select>
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {anyColFilter && (
                <EhrListHeaderButton onClick={clearColFilters} ariaLabel={t('nurse.clearAllFilters')}>
                  <X className="w-4 h-4" />
                </EhrListHeaderButton>
              )}
              {!(activeTab === 'patients' && activePatient) && activeTab === 'reorder' && canDispense && reorderList.length > 0 && (
                <button type="button" onClick={handlePrintReorder} className="btn btn-primary btn-sm" style={{ gap: 6, height: 38 }}>
                  <Printer size={15} /> {t('pharmacy.generateOrder')}
                </button>
              )}
              {!(activeTab === 'patients' && activePatient) && (
                <EhrListHeaderButton onClick={handleDownloadCsv} ariaLabel="Download">
                  <Download className="w-4 h-4" />
                </EhrListHeaderButton>
              )}
              {canDispense && (
                <button data-tour="pharmacy-receive-stock" onClick={() => setShowStockInModal(true)} className="btn btn-primary" style={{ height: 38, whiteSpace: 'nowrap' }}>
                  <Plus className="w-4 h-4" /> {t('pharmacy.receiveStock')}
                </button>
              )}
            </>
          }
        />
        {activeTab === 'queue' && (
          rxLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          ) : (
            // Padded to the card's own 16px gutter so the first column lines up
            // with the search box above it, and given explicit column shares —
            // on auto layout Dosage grew to nearly a third of the row while
            // Time was squeezed onto two lines.
            <div className="ehr-list-scroll">
              <table className="data-table" style={{ minWidth: 900, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '21%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '9%' }} />
                </colgroup>
                <thead className="appointment-table-head">
                  <tr>
                    <th>{t('pharmacy.patient')}</th>
                    <th>{t('pharmacy.medication')}</th>
                    <th>{t('pharmacy.dosage')}</th>
                    <th>{t('pharmacy.prescribedBy')}</th>
                    <th>{t('pharmacy.time')}</th>
                    <th>{t('pharmacy.statusLabel')}</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {t('pharmacy.noPrescriptionsFound')}
                      </td>
                    </tr>
                  ) : filteredQueue.map(rx => {
                    const stage = pharmacyStage(rx);
                    const balance = balanceFor(rx.patientId);
                    const balanceKnown = isKnownFor(rx.patientId);
                    const paymentClear = isClearedFor(rx.patientId);
                    return (
                      <Fragment key={rx._id}>
                      <tr
                        className="cursor-pointer hover:bg-[var(--table-row-hover)]"
                        aria-expanded={workflowRxId === rx._id}
                        onClick={() => setWorkflowRxId(current => (current === rx._id ? null : rx._id))}
                      >
                        <td>
                          <PatientName
                            patient={patientById.get(rx.patientId)}
                            patientId={rx.patientId}
                            name={rx.patientName}
                            showAvatar
                            size={40}
                            secondaryText={patientById.get(rx.patientId)?.hospitalNumber || 'ID not recorded'}
                            nameClassName="text-sm"
                          />
                        </td>
                        <td className="text-sm">
                          {/* No per-row pill glyph: it was identical on every
                              row, so it carried no information and just pushed
                              the drug name off the column edge. */}
                          <div className="flex items-center gap-2">
                            {rx.medication}
                            {rx.urgency === 'immediate' && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: 'rgba(217,119,6,0.12)', color: 'var(--color-warning-text)' }}>Immediate</span>
                            )}
                          </div>
                        </td>
                        <td className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                          {prescriptionSig(rx)}
                        </td>
                        <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{rx.prescribedBy}</td>
                        <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          <div className="flex items-center gap-1.5">
                            {rx.createdAt ? new Date(rx.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </div>
                        </td>
                        <td>
                          <span className={`badge text-[10px] ${
                            stage === 'cleared_for_dispensing' ? 'badge-normal' :
                            stage === 'dispensed' || stage === 'counseled' ? 'badge-normal' :
                            stage === 'held_awaiting_clarification' || stage === 'stockout_partial_referred' ? 'badge-warning' :
                            'badge-warning'
                          }`}>
                            {pharmacyStageLabel(stage)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge text-[10px] ${paymentClear ? 'badge-normal' : 'badge-warning'}`}>
                            {paymentClear ? 'Clear' : balanceKnown ? formatMoney(balance) : 'Unknown'}
                          </span>
                        </td>
                      </tr>
                      {workflowRxId === rx._id && (
                        <tr className="ehr-table-detail-row">
                          <td colSpan={8}>
                            <div className="ehr-row-detail ehr-row-detail--table" role="region" aria-label={`${rx.patientName} — ${rx.medication}`}>
                              {renderWorkflowPopup(rx)}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {activeTab === 'inventory' && (
          <div className="ehr-list-scroll">
            <table className="data-table" style={{ minWidth: 1080 }}>
              <thead>
                <tr>
                  <th>{t('pharmacy.medication')}</th>
                  <th>{t('pharmacy.category')}</th>
                  <th>{t('pharmacy.stockLabel')}</th>
                  <th>{t('pharmacy.reorderLevel')}</th>
                  <th>{t('pharmacy.statusLabel')}</th>
                  <th>{t('pharmacy.batchLabel')}</th>
                  <th>{t('pharmacy.expiry')}</th>
                  <th>{t('pharmacy.kpiDispensedToday')}</th>
                  {canDispense && <th>{t('pharmacy.action')}</th>}
                </tr>
              </thead>
              <tbody>
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={canDispense ? 9 : 8} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {t('pharmacy.noInventoryItems')}
                    </td>
                  </tr>
                ) : filteredInventory.map(item => (
                  <tr key={item._id}>
                    {/* Icon dropped: stock state is already its own Status
                        column, so the glyph was a second, weaker copy of it. */}
                    <td className="font-semibold text-sm">{item.medicationName}</td>
                    <td><span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--overlay-medium)', color: 'var(--text-secondary)' }}>{item.category}</span></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm" style={{ color: item.status === 'critical' ? 'var(--color-danger-text)' : item.status === 'low' ? 'var(--color-warning-text)' : 'inherit' }}>
                          {item.stockLevel}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.unit}</span>
                      </div>
                      <div className="w-20 h-1.5 rounded-full mt-1" style={{ background: 'var(--overlay-medium)' }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(100, (item.stockLevel / Math.max(1, item.reorderLevel * 3)) * 100)}%`,
                          background: item.status === 'critical' ? 'var(--color-danger)' : item.status === 'low' ? 'var(--color-warning)' : 'var(--color-success)',
                        }} />
                      </div>
                    </td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.reorderLevel} {item.unit}</td>
                    <td>
                      <span className={`badge text-[10px] ${
                        item.status === 'adequate' ? 'badge-normal' :
                        item.status === 'low' ? 'badge-warning' :
                        'badge-emergency'
                      }`}>
                        {item.status === 'adequate' ? t('pharmacy.inStock') : t(`pharmacy.invStatus_${item.status}`)}
                      </span>
                    </td>
                    <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{item.batchNumber}</td>
                    <td className="text-xs" style={{ color: item.status === 'expired' ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>
                      {item.expiryDate}
                    </td>
                    <td className="text-center font-semibold text-sm">{item.dispensedToday}</td>
                    {canDispense && (
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openRestock(item._id)}>+ {t('pharmacy.receive')}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'reorder' && (
          <div className="ehr-list-scroll">
            <table className="data-table" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>{t('pharmacy.medication')}</th>
                  <th>{t('pharmacy.category')}</th>
                  <th>{t('pharmacy.stockLabel')}</th>
                  <th>{t('pharmacy.reorderLevel')}</th>
                  <th>{t('pharmacy.orderQty')}</th>
                  <th>{t('pharmacy.statusLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {reorderList.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.allStockAdequate')}</td></tr>
                ) : reorderList.map(item => (
                  <tr key={item._id}>
                    <td className="font-semibold text-sm">
                      <div className="flex items-center gap-2">
                        <div className="icon-box-sm">
                          {item.status === 'critical'
                            ? <AlertOctagon className="w-3.5 h-3.5" style={{ color: 'var(--color-danger)' }} />
                            : <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--color-warning-text)' }} />}
                        </div>
                        {item.medicationName}
                      </div>
                    </td>
                    <td><span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--overlay-medium)', color: 'var(--text-secondary)' }}>{item.category}</span></td>
                    <td className="font-semibold text-sm" style={{ color: item.status === 'critical' ? 'var(--color-danger-text)' : 'var(--color-warning-text)' }}>{item.stockLevel} <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{item.unit}</span></td>
                    <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.reorderLevel}</td>
                    <td className="font-semibold text-sm" style={{ color: 'var(--accent-primary)' }}>{orderQtyFor(item)} {item.unit}</td>
                    <td>
                      <span className={`badge text-[10px] ${item.status === 'low' ? 'badge-warning' : 'badge-emergency'}`}>
                        {t(`pharmacy.invStatus_${item.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'expiry' && (
          <div className="ehr-list-scroll">
            <table className="data-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th>{t('pharmacy.medication')}</th>
                  <th>{t('pharmacy.batchLabel')}</th>
                  <th>{t('pharmacy.stockLabel')}</th>
                  <th>{t('pharmacy.expiry')}</th>
                  <th>{t('pharmacy.statusLabel')}</th>
                </tr>
              </thead>
              <tbody>
                {expiryList.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.noInventoryItems')}</td></tr>
                ) : expiryList.map(item => {
                  const { days, expired, soon } = expiryStatusFor(item);
                  return (
                    <tr key={item._id}>
                      {/* Icon dropped: the same calendar on every row said
                          nothing the Expiry and Status columns don't already
                          say, in colour, further right. */}
                      <td className="font-semibold text-sm">{item.medicationName}</td>
                      <td className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{item.batchNumber}</td>
                      <td className="text-sm">{item.stockLevel} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.unit}</span></td>
                      <td className="text-xs" style={{ color: expired ? 'var(--color-danger-text)' : 'var(--text-muted)' }}>{item.expiryDate}</td>
                      <td>
                        <span className={`badge text-[10px] ${expired ? 'badge-emergency' : soon ? 'badge-warning' : 'badge-normal'}`}>
                          {expired ? t('pharmacy.expired') : t('pharmacy.daysLeft', { count: days })}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'overview' && (
          categoryOverview.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.noInventoryItems')}</p>
          ) : (
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="col-span-2 sm:col-span-3 text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                {totalUnits.toLocaleString()} {t('pharmacy.kpiTotalMeds')}
              </div>
              {categoryOverview.map(cat => {
                const okPct = cat.items ? Math.round((cat.adequate / cat.items) * 100) : 0;
                return (
                  <div key={cat.category} className="rounded-xl p-3" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>{cat.category}</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{
                        background: okPct > 80 ? 'rgba(74,222,128,0.15)' : okPct > 60 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
                        color: okPct > 80 ? 'var(--color-success-text)' : okPct > 60 ? 'var(--color-warning-text)' : 'var(--color-danger-text)',
                      }}>{okPct}%</span>
                    </div>
                    <p className="text-lg font-bold mb-1.5">{cat.units.toLocaleString()} <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.stockLabel')}</span></p>
                    <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'var(--border-light)' }}>
                      <div className="h-full rounded-full" style={{ width: `${okPct}%`, background: okPct > 80 ? 'var(--color-success)' : okPct > 60 ? 'var(--color-warning)' : 'var(--color-danger)' }} />
                    </div>
                    <div className="flex justify-between text-[9px]" style={{ color: 'var(--text-muted)' }}>
                      <span style={{ color: 'var(--color-success-text)' }}>{t('pharmacy.catOk', { count: cat.adequate })}</span>
                      <span style={{ color: 'var(--color-warning-text)' }}>{t('pharmacy.catLow', { count: cat.low })}</span>
                      <span style={{ color: 'var(--color-danger-text)' }}>{t('pharmacy.catCrit', { count: cat.critical + cat.expired })}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {activeTab === 'patients' && (
            patientResults.length === 0 ? (
              <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                {q ? t('pharmacy.noPatientsFound', { query: q }) : t('pharmacy.searchPatientPlaceholder')}
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border-light)' }}>
                {patientResults.map(p => {
                  const rxs = rxFor(p);
                  const pending = rxs.filter(r => isActivePharmacyStage(pharmacyStage(r)) && r.status !== 'discontinued').length;
                  return (
                    <button key={p._id} onClick={() => setSelectedPatient(p._id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-[var(--table-row-hover)]">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{patientName(p)}</p>
                        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {p.hospitalNumber}{rxs.length ? ` · ${t('pharmacy.prescriptionsOnRecord', { count: rxs.length })}` : ''}
                        </p>
                      </div>
                      {pending > 0 && (
                        <span className="badge badge-warning text-[10px]">{t('pharmacy.pendingBadge', { count: pending })}</span>
                      )}
                      <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  );
                })}
              </div>
            )
        )}
      </div>

      {activeTab === 'patients' && activePatient && (
        <Modal onClose={() => setSelectedPatient(null)} width={720} labelledBy="pharmacy-patient-med-history-title">
          <div className="modal-content card-elevated w-full overflow-hidden" style={{ maxHeight: 'calc(100vh - 48px)' }}>
            <div className="flex items-start justify-between gap-4 p-5" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="min-w-0">
                <h3 id="pharmacy-patient-med-history-title" className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {patientName(activePatient)}
                </h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {activePatient.hospitalNumber} · {t('pharmacy.prescriptionsOnRecord', { count: activeRxs.length })}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button className="btn btn-secondary btn-sm" onClick={() => router.push(`/patients/${activePatient._id}?tab=prescriptions`)}>{t('pharmacy.viewAll')}</button>
                <button onClick={() => setSelectedPatient(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label={t('action.close')}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {activeRxs.length === 0 ? (
              <p className="text-center py-10 px-5 text-sm" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.noPrescriptionsFound')}</p>
            ) : (
              <div className="overflow-auto" style={{ maxHeight: 'min(62vh, 520px)' }}>
                <table className="data-table" style={{ minWidth: 640 }}>
                  <thead className="appointment-table-head">
                    <tr>
                      <th>{t('pharmacy.medication')}</th>
                      <th>{t('pharmacy.dosage')}</th>
                      <th>{t('pharmacy.prescribedBy')}</th>
                      <th>{t('pharmacy.time')}</th>
                      <th>{t('pharmacy.statusLabel')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRxs.map(rx => {
                      const stage = pharmacyStage(rx);
                      return (
                        <tr key={rx._id}>
                          <td className="font-semibold text-sm">{rx.medication}</td>
                          <td className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{prescriptionSig(rx)}</td>
                          <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{rx.prescribedBy}</td>
                          <td className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{rx.createdAt ? new Date(rx.createdAt).toLocaleDateString('en-GB') : '—'}</td>
                          <td>
                            <span className={`badge text-[10px] ${stage === 'dispensed' || stage === 'counseled' || stage === 'complete' ? 'badge-normal' : 'badge-warning'}`}>
                              {pharmacyStageLabel(stage)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}


      {/* Stock-in modal */}
      {showStockInModal && (
        <Modal onClose={() => setShowStockInModal(false)}>
          <div className="modal-content card-elevated p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="icon-box-sm">
                  <Pill className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
                </div>
                <h3 className="text-base font-semibold">{t('pharmacy.receiveStock')}</h3>
              </div>
              <button onClick={() => setShowStockInModal(false)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <hr className="section-divider" />
            <div className="data-row-divider-sm">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.medication')}</label>
                <input
                  list="medication-list"
                  type="text"
                  value={stockForm.medicationName}
                  onChange={e => {
                    const med = medications.find(m => m.name === e.target.value);
                    setStockForm({ ...stockForm, medicationName: e.target.value, category: med?.category || stockForm.category });
                  }}
                  placeholder={t('pharmacy.medicationPlaceholder')}
                />
                <datalist id="medication-list">
                  {medications.map(m => <option key={m.name} value={m.name}>{m.category}</option>)}
                </datalist>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.quantity')}</label>
                  <input type="number" min={1} value={stockForm.stockLevel || ''} onChange={e => setStockForm({ ...stockForm, stockLevel: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.unit')}</label>
                  <Select value={stockForm.unit} onChange={e => setStockForm({ ...stockForm, unit: e.target.value })}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.reorderLevel')}</label>
                  <input type="number" min={0} value={stockForm.reorderLevel} onChange={e => setStockForm({ ...stockForm, reorderLevel: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.batchNumber')}</label>
                  <input type="text" value={stockForm.batchNumber} onChange={e => setStockForm({ ...stockForm, batchNumber: e.target.value })} placeholder={t('pharmacy.optional')} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.expiryDate')}</label>
                <input type="date" value={stockForm.expiryDate} onChange={e => setStockForm({ ...stockForm, expiryDate: e.target.value })} />
              </div>
            </div>
            <hr className="section-divider" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => setShowStockInModal(false)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
              <button onClick={handleStockIn} className="btn btn-primary flex-1">{t('pharmacy.saveStockReceipt')}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Restock modal — top up an existing inventory line with quantity + optional batch/expiry */}
      {restockTarget && (
        <Modal onClose={() => setRestockTarget(null)} width={448}>
          <div className="modal-content card-elevated p-6 w-full" style={{ maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold">{t('pharmacy.receiveStock')}</h3>
                <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{restockTarget.name}</p>
              </div>
              <button onClick={() => setRestockTarget(null)} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                  {t('pharmacy.quantityReceived', { unit: restockTarget.unit })} <span style={{ color: 'var(--color-danger-text)' }}>*</span>
                </label>
                <input
                  type="number"
                  min={1}
                  autoFocus
                  value={restockForm.qty || ''}
                  onChange={e => setRestockForm({ ...restockForm, qty: parseInt(e.target.value) || 0 })}
                  placeholder="0"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.batchNo')}</label>
                  <input
                    type="text"
                    value={restockForm.batchNumber}
                    onChange={e => setRestockForm({ ...restockForm, batchNumber: e.target.value })}
                    placeholder={t('pharmacy.autoGenerate')}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>{t('pharmacy.expiryDate')}</label>
                  <input
                    type="date"
                    value={restockForm.expiryDate}
                    onChange={e => setRestockForm({ ...restockForm, expiryDate: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {t('pharmacy.leaveBlankKeepExisting')}
              </p>
            </div>
            <hr className="section-divider" />
            <div className="flex gap-2 mt-2">
              <button onClick={() => setRestockTarget(null)} className="btn btn-secondary flex-1">{t('action.cancel')}</button>
              <button onClick={handleRestock} className="btn btn-primary flex-1">{t('pharmacy.addToStock')}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Controlled-substance witness sign-off before dispensing */}
      {dispenseTarget && (
        <Modal onClose={() => setDispenseTarget(null)}>
          <div className="modal-panel modal-panel--sm">
            <div className="flex items-center gap-2 mb-1">
              <AlertOctagon className="w-5 h-5" style={{ color: 'var(--color-warning)' }} />
              <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Controlled substance — witness required</h3>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Dispensing <strong>{dispenseTarget.qty} {dispenseTarget.inv.unit}</strong> of <strong>{dispenseTarget.inv.medicationName}</strong> (Schedule {dispenseTarget.inv.controlledSchedule}) to {dispenseTarget.rx.patientName}. A second staff member must witness this movement.
            </p>
            <label>Witnessing staff</label>
            <Select value={witnessId} onChange={e => setWitnessId(e.target.value)}>
              <option value="">Select witness…</option>
              {users.filter(u => u._id !== currentUser?._id).map(u => (
                <option key={u._id} value={u._id}>{u.name} — {u.role}</option>
              ))}
            </Select>
            <div className="flex gap-2 mt-5">
              <button className="btn btn-secondary flex-1" onClick={() => setDispenseTarget(null)}>Cancel</button>
              <button className="btn btn-primary flex-1" onClick={confirmControlledDispense} disabled={!witnessId}>Confirm &amp; dispense</button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
