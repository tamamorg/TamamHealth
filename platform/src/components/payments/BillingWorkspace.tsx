'use client';

/**
 * Billing & Claims — one workspace for the money side of a facility, rendered
 * by both /payments and /payments/claims (the two used to be separate screens
 * that loaded the same documents and disagreed about the totals).
 *
 * Shape:
 *   head        — title + Collect payment
 *   overview    — the three dashboard cards (cash flow · counts · trend)
 *   analytics   — service line, payer mix, plans, A/R aging (collapsed)
 *   verification— payments awaiting a finance decision (only when non-empty)
 *   work queue  — Accounts | Claims tabs over one toolbar: search, filters,
 *                 and an Actions menu; each row carries its own action menu
 *
 * ACCESS: /payments/claims is an explicit-grant route — a cashier reaches
 * /payments but must not see claims — so the Claims tab, its data and its
 * actions are all gated on `isPathAllowed(role, '/payments/claims')` rather
 * than on which URL the user arrived through.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  X, Wallet, Activity, AlertCircle, ExternalLink, Receipt, Shield, Clock, Banknote,
  RotateCcw, Ban, AlertTriangle, Search, Users,
} from '@/components/icons/lucide';
import { useApp } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { SearchInput, FilterTabs, type FilterOption } from '@/components/filters';
import EhrRailMenu, { type RailMenuItem } from '@/components/ehr/EhrRailMenu';
import BillingOverviewCards from '@/components/payments/BillingOverviewCards';
import BillingFilterMenu, { type FilterField } from '@/components/payments/BillingFilterMenu';
import ClaimsPanel, { claimFilterOptions, filterClaims, PAYER_LABEL_KEYS } from '@/components/payments/ClaimsPanel';
import Modal from '@/components/Modal';
import PaymentPanel from '@/components/payments/PaymentPanel';
import { getMethodConfig } from '@/lib/payment-method-config';
import { toIsoDate, todayIso } from '@/lib/date-utils';
import { isPathAllowed } from '@/lib/role-routes';
import type { PaymentDoc, ClaimDoc, PaymentPlanDoc, PaymentMethodType } from '@/lib/db-types-payments';
import type { BillingDoc } from '@/lib/db-types-billing';
import type { EncounterDoc } from '@/lib/db-types';
import { formatMoney } from '@/lib/format-utils';
import { shortenPersonName } from '@/lib/patient-utils';
import '@/components/billing/billing.css';

// Encounter statuses that represent a clinically-finished visit — used to spot
// visits that closed out without ever generating a bill (see `unbilledEncounters`).
const ENCOUNTER_COMPLETION_STATUSES = new Set([
  'discharged', 'discharged_with_referral', 'discharged_with_pending_items',
]);

export type WorkspaceTab = 'accounts' | 'claims';

/** Balance filter for the accounts queue. */
const BALANCE_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All accounts' },
  { value: 'outstanding', label: 'Outstanding only' },
  { value: 'settled', label: 'Settled only' },
];

/** Last-activity window, in days ('any' = no cut-off). */
const ACTIVITY_OPTIONS: FilterOption[] = [
  { value: 'any', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

/**
 * What an account's Status chip should say. The queue used to answer this with
 * one boolean — balance > 0 → "Outstanding", else "Paid" — which called an
 * account that had paid most of its charges exactly the same thing as one that
 * has paid nothing, and labelled a patient who was never charged "Paid". The
 * three states match the bill chips (`STATUS_CHIP` in billing-utils) so a row
 * and the invoices inside its popup use one vocabulary.
 */
function accountStatus(line: PatientLine): { label: string; chip: string } {
  if (line.outstanding <= 0) {
    if (line.totalCollected > 0) return { label: 'Paid', chip: 'bl-chip--paid' };
    // Nothing owed and nothing taken — a registered account with no activity.
    return { label: 'No charges', chip: 'bl-chip--waived' };
  }
  if (line.totalCollected > 0) return { label: 'Partial', chip: 'bl-chip--partial' };
  return { label: 'Unpaid', chip: 'bl-chip--unpaid' };
}

interface PatientLine {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  totalCharged: number;
  totalCollected: number;
  outstanding: number;
  lastActivity?: string;       // ISO timestamp
  paymentCount: number;
  openClaims: number;
  activePlans: number;
}

interface PaymentsData {
  payments: PaymentDoc[];
  claims: ClaimDoc[];
  plans: PaymentPlanDoc[];
  bills: BillingDoc[];
  // Used only to derive the "unbilled encounters" tile below — completed
  // encounters that never produced a bill.
  encounters: EncounterDoc[];
}

/** Downloads `rows` as a CSV, matching the list-page download elsewhere. */
function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function BillingWorkspace({ initialTab = 'accounts' }: { initialTab?: WorkspaceTab }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser, globalSearch, setGlobalSearch } = useApp();
  const [data, setData] = useState<PaymentsData>({ payments: [], claims: [], plans: [], bills: [], encounters: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Text search comes from the shared global search state, surfaced as the
  // work queue's own search box (it filters whichever tab is open).
  const search = globalSearch;

  // Claims are an explicit grant, not something inherited from /payments.
  const canSeeClaims = !!currentUser && isPathAllowed(currentUser.role, '/payments/claims');

  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [balanceFilter, setBalanceFilter] = useState('all');
  const [activityFilter, setActivityFilter] = useState('any');
  const [claimStatusFilter, setClaimStatusFilter] = useState('all');
  const [claimPayerFilter, setClaimPayerFilter] = useState('all');

  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [payingLine, setPayingLine] = useState<PatientLine | null>(null);
  // Inline "Collect payment" launcher: a header button opens a patient picker,
  // and choosing a patient drops straight into the record-payment panel.
  const [collectPickerOpen, setCollectPickerOpen] = useState(false);
  const [collectSearch, setCollectSearch] = useState('');
  // Owned here rather than in ClaimsPanel so the Actions menu can open it.
  const [newClaimOpen, setNewClaimOpen] = useState(false);
  // Deeper financial analytics (service-line breakdown, payer mix, plans, A/R
  // aging) live behind a toggle so the work queue — the page's actual job —
  // keeps the viewport. Collapsed by default.
  // Installment recording for a payment plan (folded in from the old Plans page).
  const [recordPlanFor, setRecordPlanFor] = useState<PaymentPlanDoc | null>(null);
  const [planAmount, setPlanAmount] = useState('');
  const [planNotes, setPlanNotes] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  // Undo a recorded payment — Void (reverse) or Refund. Money is sensitive, so
  // both go through a confirm dialog and the existing audited services.
  const [reverseFor, setReverseFor] = useState<{ payment: PaymentDoc; mode: 'void' | 'refund' } | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  const scope = useMemo(() => (
    currentUser ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role } : undefined
  ), [currentUser]);

  const loadData = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    setError('');
    try {
      const [{ getAllPayments, getAllClaims, getAllPaymentPlans }, { getAllBills }, { getAllEncounters }] = await Promise.all([
        import('@/lib/services/payment-service'),
        import('@/lib/services/billing-service'),
        import('@/lib/services/encounter-service'),
      ]);
      const [payments, claims, plans, bills, encounters] = await Promise.all([
        getAllPayments(scope),
        getAllClaims(scope),
        getAllPaymentPlans(scope),
        getAllBills(scope),
        getAllEncounters(scope),
      ]);
      setData({ payments: payments || [], claims: claims || [], plans: plans || [], bills: bills || [], encounters: encounters || [] });
    } catch (err) {
      console.error('Error loading payments data:', err);
      setError(t('payments.errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { loadData(); }, [loadData]);

  // A role without the claims grant must never land on (or be left holding)
  // the claims tab, whichever route mounted this.
  useEffect(() => {
    if (!canSeeClaims && tab === 'claims') setTab('accounts');
  }, [canSeeClaims, tab]);

  // Keep ?tab= in the URL so a refresh, a bookmark or a back button returns to
  // the queue the user was working.
  const switchTab = useCallback((next: WorkspaceTab) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (next === 'accounts') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  // ── Pending verification queue ─────────────────────────────────────
  // Pay-by-link (cash/bank) and patient-portal payments are written with
  // status 'pending' awaiting finance review. Card/mobile-money pendings are
  // normally reconciled by the provider webhook — anything still here needs a
  // human decision. Approve posts it (and credits the patient ledger); reject
  // marks it failed with a note.
  const { showToast } = useToast();
  const pendingPayments = useMemo(
    () => data.payments.filter(p => p.status === 'pending')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [data.payments],
  );
  const [pendingBusy, setPendingBusy] = useState<string | null>(null);

  const resolvePending = useCallback(async (p: PaymentDoc, approve: boolean) => {
    if (!p.reference) {
      showToast('This payment has no reference and cannot be transitioned — contact support', 'error');
      return;
    }
    setPendingBusy(p._id);
    try {
      const { updatePaymentStatus } = await import('@/lib/services/payment-service');
      const updated = await updatePaymentStatus(
        p.reference,
        approve ? 'posted' : 'failed',
        approve ? undefined : { reason: `Rejected in verification by ${currentUser?.name || 'finance'}` },
      );
      if (!updated) throw new Error('Payment not found by reference');
      showToast(approve ? `Payment ${p.reference} approved and posted` : `Payment ${p.reference} rejected`, 'success');
      await loadData();
    } catch (err) {
      console.error('Pending payment resolution failed:', err);
      showToast('Could not update the payment — try again', 'error');
    } finally {
      setPendingBusy(null);
    }
  }, [currentUser?.name, loadData, showToast]);

  // ── Aggregate by patient ───────────────────────────────────────────
  const patientLines: PatientLine[] = useMemo(() => {
    const byPatient = new Map<string, PatientLine>();

    const ensure = (id: string, name: string, hospitalNumber?: string): PatientLine => {
      if (!byPatient.has(id)) {
        byPatient.set(id, {
          patientId: id,
          patientName: name,
          hospitalNumber,
          totalCharged: 0,
          totalCollected: 0,
          outstanding: 0,
          paymentCount: 0,
          openClaims: 0,
          activePlans: 0,
        });
      }
      return byPatient.get(id)!;
    };

    // Bills give us the canonical totals
    for (const b of data.bills) {
      const line = ensure(b.patientId, b.patientName, b.hospitalNumber);
      line.totalCharged += b.totalAmount || 0;
      line.totalCollected += b.amountPaid || 0;
      line.outstanding += b.balanceDue || 0;
      const when = b.encounterDate || b.updatedAt || b.createdAt;
      if (!line.lastActivity || (when && when > line.lastActivity)) line.lastActivity = when;
    }

    for (const p of data.payments) {
      if (p.status !== 'posted') continue;
      const line = ensure(p.patientId, p.patientName);
      line.paymentCount += 1;
      const when = p.processedAt;
      if (!line.lastActivity || (when && when > line.lastActivity)) line.lastActivity = when;
      // If we have no bill totals at all for this patient, surface payments
      // as collected so the row isn't blank.
      if (line.totalCollected === 0 && line.totalCharged === 0) {
        line.totalCollected = p.amount;
      }
    }

    for (const c of data.claims) {
      if (c.status === 'paid' || c.status === 'denied') continue;
      const line = ensure(c.patientId, c.patientName);
      line.openClaims += 1;
    }

    for (const pl of data.plans) {
      if (pl.status !== 'active') continue;
      const line = ensure(pl.patientId, pl.patientName);
      line.activePlans += 1;
    }

    return Array.from(byPatient.values()).sort((a, b) => {
      // Outstanding patients first, then by recent activity
      if ((b.outstanding > 0 ? 1 : 0) !== (a.outstanding > 0 ? 1 : 0)) {
        return (b.outstanding > 0 ? 1 : 0) - (a.outstanding > 0 ? 1 : 0);
      }
      if (b.outstanding !== a.outstanding) return b.outstanding - a.outstanding;
      return (b.lastActivity || '').localeCompare(a.lastActivity || '');
    });
  }, [data.bills, data.payments, data.claims, data.plans]);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff = activityFilter === 'any' ? 0 : Date.now() - Number(activityFilter) * 86_400_000;
    return patientLines.filter(l => {
      if (balanceFilter === 'outstanding' && !(l.outstanding > 0)) return false;
      if (balanceFilter === 'settled' && l.outstanding > 0) return false;
      if (cutoff && (!l.lastActivity || new Date(l.lastActivity).getTime() < cutoff)) return false;
      if (!q) return true;
      return l.patientName.toLowerCase().includes(q) ||
        (l.hospitalNumber || '').toLowerCase().includes(q);
    });
  }, [patientLines, search, balanceFilter, activityFilter]);

  // Claims the workspace is allowed to show at all, then the toolbar's cut.
  const visibleClaims = useMemo(() => (canSeeClaims ? data.claims : []), [canSeeClaims, data.claims]);
  const filteredClaims = useMemo(
    () => filterClaims(visibleClaims, { search, status: claimStatusFilter, payer: claimPayerFilter }),
    [visibleClaims, search, claimStatusFilter, claimPayerFilter],
  );

  const outstandingPatients = useMemo(() => patientLines.filter(l => l.outstanding > 0).length, [patientLines]);

  const filtersActive = tab === 'accounts'
    ? balanceFilter !== 'all' || activityFilter !== 'any'
    : claimStatusFilter !== 'all' || claimPayerFilter !== 'all';

  // Both tabs' filters go behind one funnel icon in the toolbar — the fields
  // swap with the tab, the control stays put.
  const filterFields: FilterField[] = useMemo(() => {
    if (tab === 'claims') {
      const options = claimFilterOptions(visibleClaims, t);
      return [
        { key: 'status', label: 'Claim status', value: claimStatusFilter, neutralValue: 'all', options: options.status, onChange: setClaimStatusFilter },
        { key: 'payer', label: 'Payer', value: claimPayerFilter, neutralValue: 'all', options: options.payer, onChange: setClaimPayerFilter },
      ];
    }
    return [
      { key: 'balance', label: 'Balance', value: balanceFilter, neutralValue: 'all', options: BALANCE_OPTIONS, onChange: setBalanceFilter },
      { key: 'activity', label: 'Last activity', value: activityFilter, neutralValue: 'any', options: ACTIVITY_OPTIONS, onChange: setActivityFilter },
    ];
  }, [tab, visibleClaims, t, claimStatusFilter, claimPayerFilter, balanceFilter, activityFilter]);

  const clearFilters = useCallback(() => {
    setBalanceFilter('all');
    setActivityFilter('any');
    setClaimStatusFilter('all');
    setClaimPayerFilter('all');
    setGlobalSearch('');
  }, [setGlobalSearch]);

  // ── Today's collections by payment method ──────────────────────────
  // Real posted payments only, grouped by method, for the local calendar day
  // (matches the cashier's shift, not UTC — see date-conventions memory).
  const todayCollections = useMemo(() => {
    const todayIso = toIsoDate(new Date());
    const byMethod = new Map<PaymentMethodType, number>();
    let total = 0;
    for (const p of data.payments) {
      if (p.status !== 'posted' || !p.processedAt) continue;
      if (toIsoDate(new Date(p.processedAt)) !== todayIso) continue;
      byMethod.set(p.method, (byMethod.get(p.method) || 0) + p.amount);
      total += p.amount;
    }
    return { byMethod, total };
  }, [data.payments]);

  // Unbilled encounters — clinically-completed visits (discharged, in the
  // last 30 days) whose encounter id never shows up on any bill. Best-effort:
  // facilities that don't bill per-encounter (fee-free public sites) will
  // just show 0 here rather than a misleading count.
  const unbilledEncounters = useMemo(() => {
    const billedEncounterIds = new Set(data.bills.map(b => b.encounterId).filter(Boolean) as string[]);
    const cutoff = Date.now() - 30 * 86_400_000;
    return data.encounters.filter(e => {
      if (!ENCOUNTER_COMPLETION_STATUSES.has(e.status)) return false;
      const closed = e.closedAt || e.startedAt;
      if (!closed || new Date(closed).getTime() < cutoff) return false;
      return !billedEncounterIds.has(e._id);
    }).length;
  }, [data.encounters, data.bills]);

  // Derive the open patient's line from the live aggregates so the drawer's
  // balance/totals refresh automatically after a payment is recorded.
  const selectedLine = useMemo(
    () => (selectedPatientId ? patientLines.find(l => l.patientId === selectedPatientId) || null : null),
    [selectedPatientId, patientLines],
  );

  // Deep link: front-desk checkout routes here with ?patientId= to open that
  // patient's billing drawer directly instead of the unfiltered ledger.
  const patientIdParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || patientIdParamRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const patientId = params.get('patientId');
    if (!patientId) return;
    if (!patientLines.some(l => l.patientId === patientId)) return;
    patientIdParamRef.current = true;
    setSelectedPatientId(patientId);
    params.delete('patientId');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [patientLines]);

  // Deep link the other way: ?tab=claims lands straight on the claims queue.
  const tabParamRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || tabParamRef.current) return;
    tabParamRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('tab');
    if (requested === 'claims' || requested === 'accounts') setTab(requested);
    const requestedStatus = params.get('status');
    if (requestedStatus && ['draft', 'submitted', 'accepted', 'partial', 'paid', 'denied', 'appealed'].includes(requestedStatus)) {
      setClaimStatusFilter(requestedStatus);
    }
  }, []);

  // Export whatever the toolbar is currently showing — the rows on screen, not
  // the whole store, so a filtered view exports as filtered.
  const exportCurrentView = useCallback(() => {
    const stamp = todayIso();
    if (tab === 'claims') {
      downloadCsv(
        `claims-${stamp}.csv`,
        ['Claim', 'Patient', 'Payer', 'Payer type', 'Billed', 'Allowed', 'Paid', 'Status', 'Submitted'],
        filteredClaims.map(c => [
          c.claimNumber || c._id,
          c.patientName,
          c.payerName,
          t(PAYER_LABEL_KEYS[c.payerType]) || c.payerType,
          c.totalBilled || 0,
          c.totalAllowed || 0,
          c.totalApproved || 0,
          t(`claims.status_${c.status}`),
          c.submittedDate ? c.submittedDate.slice(0, 10) : '',
        ]),
      );
    } else {
      downloadCsv(
        `patient-accounts-${stamp}.csv`,
        ['Patient', 'Patient ID', 'Charged', 'Collected', 'Balance', 'Payments', 'Open claims', 'Active plans', 'Last activity'],
        filteredAccounts.map(l => [
          l.patientName,
          l.hospitalNumber || '',
          l.totalCharged,
          l.totalCollected,
          l.outstanding,
          l.paymentCount,
          l.openClaims,
          l.activePlans,
          l.lastActivity ? l.lastActivity.slice(0, 10) : '',
        ]),
      );
    }
    showToast('Export downloaded', 'success');
  }, [tab, filteredClaims, filteredAccounts, t, showToast]);

  /** The accounts queue's columns, in order. Widths are equal by layout
   *  (`bl-table--even`); this list only decides order and alignment. */
  const accountColumns = useMemo(() => [
    { label: t('payments.colPatient'), align: 'left' as const },
    { label: 'Patient ID', align: 'left' as const },
    { label: t('payments.colPayments'), align: 'right' as const },
    // Claims count only for roles that can act on claims — for a cashier the
    // column is always empty by construction.
    ...(canSeeClaims ? [{ label: t('payments.colClaims'), align: 'right' as const }] : []),
    { label: t('payments.colPlans'), align: 'right' as const },
    { label: t('payments.colLastActivity'), align: 'left' as const },
    { label: t('payments.colBalance'), align: 'right' as const },
    // Last column, and the Actions button sits directly above it — the pills
    // line up under that button rather than drifting to the column's far left.
    { label: 'Status', align: 'right' as const },
  ], [t, canSeeClaims]);

  // The work queue's Actions menu — create, export, reset, reload, in that
  // order: the two that write come first, the three that only redraw follow.
  // Ordering carries that grouping now; the menu no longer renders headings.
  const actionItems: RailMenuItem[] = useMemo(() => {
    const items: RailMenuItem[] = [
      {
        key: 'collect',
        label: t('billing.collectPayment'),
        onSelect: () => { setCollectSearch(''); setCollectPickerOpen(true); },
      },
    ];
    if (canSeeClaims) {
      items.push({
        key: 'new-claim',
        label: 'New insurance claim',
        onSelect: () => { switchTab('claims'); setNewClaimOpen(true); },
      });
    }
    // The invoice-level bill list lost its nav row when bills were given a
    // single nav home — this is now how a biller gets to it.
    if (currentUser && isPathAllowed(currentUser.role, '/billing')) {
      items.push({
        key: 'bill-list',
        label: 'Open the bill list',
        onSelect: () => router.push('/billing'),
      });
    }
    // The assisted-portal view — the patient's own bills and payment methods,
    // opened by the person at the till so the two can look at them together.
    // It is a real, role-gated screen (`/payments/portal` is granted to the
    // cashier and the biller) that nothing in the product linked to: no nav
    // row, no button, no redirect. It could only be reached by typing the URL,
    // which means in practice it could not be reached at all.
    if (currentUser && isPathAllowed(currentUser.role, '/payments/portal')) {
      items.push({
        key: 'patient-portal',
        label: t('billing.openPatientPortal'),
        onSelect: () => router.push('/payments/portal'),
      });
    }
    items.push(
      {
        key: 'export',
        label: `Export ${tab === 'claims' ? 'claims' : 'accounts'} (CSV)`,
        onSelect: exportCurrentView,
      },
      {
        key: 'clear',
        label: 'Clear filters & search',
        disabled: !filtersActive && !search,
        onSelect: clearFilters,
      },
      {
        key: 'refresh',
        label: 'Refresh data',
        onSelect: () => { loadData(); },
      },
    );
    return items;
  }, [t, canSeeClaims, tab, exportCurrentView, filtersActive, search, clearFilters, loadData, switchTab, currentUser, router]);

  // Record an installment against a payment plan (folded in from the old
  // standalone Plans page so the cashier manages plans from the same screen).
  const handleRecordPlanPayment = async () => {
    if (!recordPlanFor) return;
    const amount = parseFloat(planAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setSavingPlan(true);
    try {
      const { recordPlanPayment } = await import('@/lib/services/payment-service');
      const installmentNumber = recordPlanFor.monthlyAmount > 0
        ? Math.floor(recordPlanFor.paidToDate / recordPlanFor.monthlyAmount) + 1
        : 1;
      const paymentId = `PAY-${Date.now()}`;
      await recordPlanPayment(recordPlanFor._id, installmentNumber, paymentId, amount);
      setRecordPlanFor(null);
      setPlanAmount('');
      setPlanNotes('');
      loadData();
    } catch (err) {
      console.error('Failed to record plan payment:', err);
    } finally {
      setSavingPlan(false);
    }
  };

  // Confirm + perform a payment reversal. Void uses reversePayment (status →
  // reversed); Refund uses issueRefund. Both write an audit trail in-service.
  const handleConfirmReverse = async () => {
    if (!reverseFor) return;
    const reason = reverseReason.trim();
    if (!reason) return;
    setReversing(true);
    try {
      const { reversePayment, issueRefund } = await import('@/lib/services/payment-service');
      const p = reverseFor.payment;
      if (reverseFor.mode === 'void') {
        await reversePayment(p._id, reason, currentUser?._id || 'system', currentUser?.name || 'System');
      } else {
        await issueRefund({
          paymentId: p._id,
          patientId: p.patientId,
          patientName: p.patientName,
          amount: p.amount,
          currency: p.currency,
          method: p.method,
          reason,
          processedBy: currentUser?._id || 'system',
          processedByName: currentUser?.name || 'System',
          facilityId: p.facilityId || currentUser?.hospitalId || '',
          orgId: p.orgId ?? currentUser?.orgId,
        });
      }
      setReverseFor(null);
      setReverseReason('');
      loadData();
    } catch (err) {
      console.error('Failed to reverse payment:', err);
    } finally {
      setReversing(false);
    }
  };

  if (loading) {
    return (
      <main className="page-container page-enter">
        <div className="bl-root">
          <div className="bl-loading">
            <Activity size={30} style={{ animation: 'spin 1s linear infinite' }} />
            <span>{t('payments.loading')}</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      {/* The page scrolls rather than pinning itself to the viewport: the
          queue used to be squeezed to nothing whenever the analytics panel was
          expanded on a short screen, with no way to scroll it back. */}
      <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
        <div className="bl-root" style={{ flex: 1, minHeight: 0 }}>
          {error && (
            <div className="bl-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <AlertCircle size={16} style={{ color: 'var(--color-danger, #D92B20)', flexShrink: 0 }} />
              <span className="bl-danger" style={{ fontSize: 13 }}>{error}</span>
            </div>
          )}

          {/* No page-head band: the rail already says which module this is, and
              the work queue below titles itself ("Patient accounts" / "Claims
              Management"). Collect Payment lives in the queue toolbar's Actions
              menu — it had a button beside that menu as well, which was the
              same command twice in adjacent controls. */}

          {/* ── The three overview cards. They are the whole visual summary:
              the flat "collected today" strip that used to sit here is folded
              into the middle card, with the per-method split one click away in
              the payment history. ── */}
          <BillingOverviewCards
            payments={data.payments}
            claims={visibleClaims}
            bills={data.bills}
            collectedToday={todayCollections.total}
            todayByMethod={todayCollections.byMethod}
            outstandingPatients={outstandingPatients}
            unbilledEncounters={unbilledEncounters}
            showClaims={canSeeClaims}
          />

          {/* Pending verification queue — payments awaiting a finance decision.
              Rendered only when something needs review, so the page stays clean. */}
          {pendingPayments.length > 0 && (
            <div className="bl-card" data-tour="pending-queue">
              <div className="bl-card-head">
                <h2 className="bl-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Clock size={16} style={{ color: 'var(--color-warning-text)' }} />
                  Pending verification
                  <span className="bl-chip bl-chip--partial">{pendingPayments.length}</span>
                </h2>
                <p className="bl-card-sub">Approving posts the payment and credits the patient&rsquo;s balance.</p>
                <span className="bl-underline" />
              </div>
              <div className="bl-table-wrap">
                <table className="bl-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th>Reference</th>
                      <th>Method</th>
                      <th>Submitted</th>
                      <th className="bl-right">Amount</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPayments.map(p => (
                      <tr key={p._id}>
                        <td style={{ fontWeight: 600 }}>{shortenPersonName(p.patientName)}</td>
                        <td className="bl-muted" style={{ fontFamily: 'monospace' }}>{p.reference}</td>
                        <td>{getMethodConfig(p.method).label}</td>
                        <td className="bl-muted" style={{ whiteSpace: 'nowrap' }}>
                          {p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}
                        </td>
                        <td className="bl-num bl-right" style={{ fontWeight: 700 }}>{formatMoney(p.amount)} {p.currency}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => resolvePending(p, true)}
                              disabled={pendingBusy === p._id}
                              className="bl-btn bl-btn--primary"
                              style={{ padding: '5px 12px', fontSize: 12 }}
                            >
                              <Banknote size={14} /> {pendingBusy === p._id ? 'Working…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              onClick={() => resolvePending(p, false)}
                              disabled={pendingBusy === p._id}
                              className="bl-btn bl-btn--outline"
                              style={{ padding: '5px 12px', fontSize: 12, borderColor: 'var(--color-danger)', color: 'var(--color-danger-text)' }}
                            >
                              <Ban size={14} /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Work queue — accounts and claims share one card, one toolbar and
              one search box; the tabs decide which rows and which filters. ── */}
          {/* A floor rather than a share of the viewport — the table always has
              room for a useful number of rows, and the page scrolls past it. */}
          <div className="bl-card" data-tour="work-queue" style={{ flex: 1, minHeight: 320, display: 'flex', flexDirection: 'column' }}>
            <div className="bl-card-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <h2 className="bl-card-title">{tab === 'claims' ? t('claims.title') : 'Patient accounts'}</h2>
                <span className="bl-underline" />
              </div>
              {canSeeClaims && (
                <FilterTabs
                  ariaLabel="Billing work queue"
                  size="sm"
                  active={tab}
                  onChange={key => switchTab(key as WorkspaceTab)}
                  tabs={[
                    { key: 'accounts', label: 'Accounts', count: patientLines.length, icon: Users },
                    { key: 'claims', label: 'Claims', count: data.claims.length, icon: Shield },
                  ]}
                  className="mb-3"
                />
              )}
            </div>

            {/* Search · filters · actions — one row, wrapping on narrow screens. */}
            <div className="bl-toolbar">
              <div className="bl-search">
                <Search size={16} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setGlobalSearch(e.target.value)}
                  placeholder={tab === 'claims' ? 'Search claim, patient or payer…' : t('payments.searchPlaceholder')}
                  aria-label={tab === 'claims' ? 'Search claims' : t('payments.searchPlaceholder')}
                />
              </div>
              <BillingFilterMenu fields={filterFields} />
              <EhrRailMenu
                variant="primary"
                label="Actions"
                ariaLabel="Billing actions"
                align="right"
                items={actionItems}
              />
            </div>

            {tab === 'claims' ? (
              <ClaimsPanel
                claims={visibleClaims}
                visibleClaims={filteredClaims}
                onChanged={loadData}
                newClaimOpen={newClaimOpen}
                setNewClaimOpen={setNewClaimOpen}
              />
            ) : filteredAccounts.length === 0 ? (
              <div className="bl-empty">
                <Wallet size={34} />
                <h3>{search || filtersActive ? t('payments.noPatientsMatch') : t('payments.noBillingActivity')}</h3>
              </div>
            ) : (
              <div style={{ overflow: 'auto', flex: 1, minHeight: 0, marginTop: 12 }}>
                <table className="bl-table bl-table--even bl-table--rows-open" style={{ minWidth: 940 }}>
                  {/* `bl-table--even` is table-layout: fixed — every column
                      takes an equal share of the full width, and none of them
                      reflow as rows load. */}
                  <thead>
                    <tr>
                      {accountColumns.map(h => (
                        <th
                          key={h.label}
                          className={h.align === 'right' ? 'bl-right' : undefined}
                          style={{ position: 'sticky', top: 0, zIndex: 1 }}
                        >
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.map(line => {
                      const owing = line.outstanding > 0;
                      const status = accountStatus(line);
                      const isRealPatient = line.patientId && !line.patientId.startsWith('demo-') && !line.patientId.includes('_demo');
                      return (
                        <tr
                          key={line.patientId}
                          onClick={() => setSelectedPatientId(line.patientId)}
                          tabIndex={0}
                          aria-label={`Open account for ${shortenPersonName(line.patientName)}`}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPatientId(line.patientId); } }}
                        >
                          <td>
                            {isRealPatient ? (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); router.push(`/patients/${line.patientId}?tab=billing`); }}
                                className="bl-link"
                                style={{ fontWeight: 600 }}
                              >
                                {shortenPersonName(line.patientName)}
                              </button>
                            ) : (
                              <span style={{ fontWeight: 600 }}>{shortenPersonName(line.patientName)}</span>
                            )}
                          </td>
                          <td>
                            {isRealPatient && line.hospitalNumber ? (
                              <button
                                type="button"
                                onClick={e => { e.stopPropagation(); router.push(`/patients/${line.patientId}?tab=billing`); }}
                                className="bl-link"
                              >
                                {line.hospitalNumber}
                              </button>
                            ) : (
                              <span className="bl-muted">{line.hospitalNumber || '—'}</span>
                            )}
                          </td>
                          <td className="bl-num bl-right">{line.paymentCount > 0 ? line.paymentCount : '—'}</td>
                          {canSeeClaims && <td className="bl-num bl-right">{line.openClaims > 0 ? line.openClaims : '—'}</td>}
                          <td className="bl-num bl-right">{line.activePlans > 0 ? line.activePlans : '—'}</td>
                          <td className="bl-muted" style={{ whiteSpace: 'nowrap' }}>
                            {line.lastActivity ? new Date(line.lastActivity).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                          </td>
                          <td className="bl-num bl-right" style={{ fontWeight: 700, color: owing ? 'var(--color-danger-text)' : 'var(--color-success-text)' }}>
                            {formatMoney(owing ? line.outstanding : line.totalCollected)}
                          </td>
                          <td className="bl-right">
                            <span className={`bl-chip ${status.chip}`}>{status.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Account detail — centered modal */}
      {selectedLine && (
        <PatientBillingDetail
          line={selectedLine}
          payments={data.payments.filter(p => p.patientId === selectedLine.patientId)}
          claims={visibleClaims.filter(c => c.patientId === selectedLine.patientId)}
          plans={data.plans.filter(p => p.patientId === selectedLine.patientId)}
          bills={data.bills.filter(b => b.patientId === selectedLine.patientId)}
          showClaims={canSeeClaims}
          onClose={() => setSelectedPatientId(null)}
          onRecordPayment={() => setPayingLine(selectedLine)}
          onRecordPlanPayment={(plan) => { setRecordPlanFor(plan); setPlanAmount(''); setPlanNotes(''); }}
          onReversePayment={(payment, mode) => { setReverseFor({ payment, mode }); setReverseReason(''); }}
        />
      )}

      {/* Confirm a payment reversal (Void or Refund) — money is sensitive, so the
          biller must state a reason; the action runs through the audited service. */}
      {reverseFor && (
        <Modal onClose={() => { if (!reversing) setReverseFor(null); }} width={420} labelledBy="bl-reverse-title">
          <div className="bl-root bl-modal-body">
            <div className="bl-modal-head">
              <h3 className="bl-modal-title" id="bl-reverse-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} style={{ color: 'var(--color-danger-text)' }} />
                {reverseFor.mode === 'void' ? t('action.reverse') : t('action.undo')}
              </h3>
            </div>
            <div className="bl-fee-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
              <div className="bl-fee-row">
                <div className="min-w-0">
                  <div className="bl-fee-name">{shortenPersonName(reverseFor.payment.patientName)}</div>
                  <div className="bl-fee-cat">
                    {getMethodConfig(reverseFor.payment.method).label}
                    {reverseFor.payment.reference && <span style={{ fontFamily: 'monospace' }}> · {reverseFor.payment.reference}</span>}
                  </div>
                </div>
                <span className="bl-num" style={{ fontWeight: 700, color: 'var(--color-danger-text)' }}>{formatMoney(reverseFor.payment.amount)}</span>
              </div>
            </div>
            <div className="bl-field">
              <label htmlFor="bl-reverse-reason">{t('billing.reason')}</label>
              <textarea
                id="bl-reverse-reason"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                rows={2}
                autoFocus
              />
            </div>
            <div className="bl-modal-actions">
              <button type="button" onClick={() => setReverseFor(null)} disabled={reversing} className="bl-btn bl-btn--ghost">{t('action.cancel')}</button>
              <button
                type="button"
                onClick={handleConfirmReverse}
                disabled={!reverseReason.trim() || reversing}
                className="bl-btn bl-btn--dark"
                style={{ background: 'var(--color-danger)' }}
              >
                {reverseFor.mode === 'void' ? <Ban size={16} /> : <RotateCcw size={16} />}
                {t('action.confirm')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Collect-payment patient picker (opened from the header button) */}
      {collectPickerOpen && (
        <Modal onClose={() => setCollectPickerOpen(false)} width={460}>
          <div className="bl-root" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div className="px-5 py-4 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--ehr-border, #E2E6EB)' }}>
              <div className="flex items-center gap-2">
                <Banknote size={18} style={{ color: 'var(--bl-teal)' }} />
                <h2 className="bl-modal-title">{t('billing.collectPayment')}</h2>
              </div>
              <button
                type="button"
                onClick={() => setCollectPickerOpen(false)}
                aria-label="Close"
                style={{
                  background: 'transparent', border: '1px solid var(--ehr-border, #E2E6EB)', borderRadius: 6,
                  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-3">
              <SearchInput value={collectSearch} onChange={setCollectSearch} placeholder={t('payments.searchPlaceholder')} />
              <div className="mt-2" style={{ maxHeight: 360, overflowY: 'auto' }}>
                {(() => {
                  const q = collectSearch.trim().toLowerCase();
                  const list = patientLines
                    .filter(l => l.outstanding > 0)
                    .filter(l => !q || l.patientName.toLowerCase().includes(q) || (l.hospitalNumber || '').toLowerCase().includes(q))
                    .sort((a, b) => b.outstanding - a.outstanding);
                  if (list.length === 0) {
                    return <p className="bl-muted" style={{ textAlign: 'center', fontSize: 12.5, padding: '32px 0' }}>{t('payments.noOutstanding')}</p>;
                  }
                  return (
                    <div className="bl-fee-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
                      {list.map(line => (
                        <button
                          key={line.patientId}
                          type="button"
                          onClick={() => { setPayingLine(line); setCollectPickerOpen(false); }}
                          className="bl-fee-row"
                          style={{ width: '100%', border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', textAlign: 'start' }}
                        >
                          <div className="min-w-0">
                            <div className="bl-fee-name">{shortenPersonName(line.patientName)}</div>
                            {line.hospitalNumber && <div className="bl-fee-cat" style={{ fontFamily: 'monospace' }}>{line.hospitalNumber}</div>}
                          </div>
                          <span className="bl-num" style={{ fontWeight: 700, color: 'var(--color-danger-text)' }}>{formatMoney(line.outstanding)}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Record-payment form (cash / mobile money / card / insurance) */}
      {payingLine && (
        <PaymentPanel
          patientId={payingLine.patientId}
          patientName={payingLine.patientName}
          amountDue={payingLine.outstanding}
          onCancel={() => setPayingLine(null)}
          onSuccess={() => { setPayingLine(null); loadData(); }}
        />
      )}

      {/* Record an installment against a payment plan */}
      {recordPlanFor && (
        <Modal onClose={() => setRecordPlanFor(null)} width={440}>
          <div className="bl-root bl-modal-body">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Receipt size={18} style={{ color: 'var(--bl-teal)' }} />
                <div>
                  <h3 className="bl-modal-title">{t('plans.recordPayment')}</h3>
                  <p className="bl-card-sub" style={{ margin: '2px 0 0' }}>{recordPlanFor.patientName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRecordPlanFor(null)}
                aria-label="Close"
                style={{
                  background: 'transparent', border: '1px solid var(--ehr-border, #E2E6EB)', borderRadius: 6,
                  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="bl-field">
              <label htmlFor="bl-plan-amount">{t('plans.paymentAmountLabel')}</label>
              <input
                id="bl-plan-amount"
                type="number"
                value={planAmount}
                onChange={(e) => setPlanAmount(e.target.value)}
                placeholder={t('plans.paymentAmountPlaceholder')}
                autoFocus
              />
            </div>
            <div className="bl-field">
              <label htmlFor="bl-plan-notes">{t('plans.notesLabel')}</label>
              <textarea
                id="bl-plan-notes"
                value={planNotes}
                onChange={(e) => setPlanNotes(e.target.value)}
                placeholder={t('plans.notesPlaceholder')}
                rows={3}
              />
            </div>
            <div className="bl-modal-actions">
              <button type="button" onClick={() => setRecordPlanFor(null)} className="bl-btn bl-btn--ghost">{t('action.cancel')}</button>
              <button
                type="button"
                onClick={handleRecordPlanPayment}
                disabled={!planAmount || savingPlan}
                className="bl-btn bl-btn--primary"
              >
                <Receipt size={16} />
                {t('plans.recordPayment')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ═══ Detail drawer ═══════════════════════════════════════════════════

function PatientBillingDetail({ line, payments, claims, plans, bills, showClaims, onClose, onRecordPayment, onRecordPlanPayment, onReversePayment }: {
  line: PatientLine;
  payments: PaymentDoc[];
  claims: ClaimDoc[];
  plans: PaymentPlanDoc[];
  bills: BillingDoc[];
  showClaims: boolean;
  onClose: () => void;
  onRecordPayment: () => void;
  onRecordPlanPayment: (plan: PaymentPlanDoc) => void;
  onReversePayment: (payment: PaymentDoc, mode: 'void' | 'refund') => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  // Saved payment methods (loaded on demand)
  const [methods, setMethods] = useState<{ id: string; label: string; type: string; brand?: string; isDefault: boolean }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getDB } = await import('@/lib/db');
        const db = getDB('tamamhealth_saved_payment_methods');
        const all = await db.allDocs({ include_docs: true });
        if (cancelled) return;
        const docs = all.rows
          .map(r => r.doc as { _id: string; type?: string; patientId?: string; methodType?: string; label?: string; cardBrand?: string; isDefault?: boolean })
          .filter(d => d && d.type === 'saved_payment_method' && d.patientId === line.patientId);
        setMethods(docs.map(d => ({
          id: d._id,
          label: d.label || (d.methodType || t('payments.methodFallback')),
          type: d.methodType || 'unknown',
          brand: d.cardBrand,
          isDefault: !!d.isDefault,
        })));
      } catch {
        if (!cancelled) setMethods([]);
      }
    })();
    return () => { cancelled = true; };
  }, [line.patientId]);

  const sortedPayments = [...payments].sort((a, b) => (b.processedAt || '').localeCompare(a.processedAt || ''));
  const owing = line.outstanding > 0;

  return (
    <Modal onClose={onClose} width={600} labelledBy="billing-detail-name">
      <div
        className="bl-root"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 32px)',
        }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b flex items-start justify-between gap-3 modal-headband" style={{ borderColor: 'var(--ehr-border, #E2E6EB)' }}>
          <div>
            <button
              onClick={() => router.push(`/patients/${line.patientId}?tab=billing`)}
              className="bl-link"
              style={{ fontSize: 16 }}
              title={t('payments.openPatientRecord')}
            >
              <span id="billing-detail-name">{shortenPersonName(line.patientName)}</span>
            </button>
            {line.hospitalNumber && (
              <div className="bl-id-tag" style={{ marginTop: 4, display: 'inline-block' }}>{line.hospitalNumber}</div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: '1px solid var(--ehr-border, #E2E6EB)', borderRadius: 6,
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance summary — flat, no gradient tint; colour carries the state. */}
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--ehr-border, #E2E6EB)' }}>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <span className="bl-stat-label" style={{ color: owing ? 'var(--color-danger-text)' : 'var(--color-success-text)' }}>
                {owing ? t('billing.outstandingBalance') : t('billing.accountStatus')}
              </span>
              <span className="bl-stat-value" style={{ fontSize: 22, color: owing ? 'var(--color-danger-text)' : 'var(--color-success-text)' }}>
                {owing ? formatMoney(line.outstanding) : t('billing.paidInFull')}
              </span>
            </div>
            <div className="bl-muted" style={{ fontSize: 11, textAlign: 'end' }}>
              <div>{t('payments.charged')}: <span style={{ color: 'var(--ehr-text, #113055)', fontFamily: 'monospace' }}>{formatMoney(line.totalCharged)}</span></div>
              <div>{t('payments.collected')}: <span style={{ color: 'var(--color-success-text)', fontFamily: 'monospace' }}>{formatMoney(line.totalCollected)}</span></div>
            </div>
          </div>
        </div>

        {/* Scrollable account sections */}
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>

        {/* Saved payment methods */}
        <Section title={t('payments.paymentMethods')} icon={<Shield className="w-4 h-4" />} count={methods.length}>
          {methods.length === 0 ? (
            <Empty>{t('payments.noSavedMethods')}</Empty>
          ) : (
            <div className="bl-fee-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
              {methods.map(m => {
                const cfg = getMethodConfig(m.type as Parameters<typeof getMethodConfig>[0]);
                const MIcon = cfg.icon;
                return (
                  <div key={m.id} className="bl-fee-row">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <MIcon size={16} style={{ color: cfg.color, flexShrink: 0 }} />
                      <div className="min-w-0">
                        <div className="bl-fee-name">{m.label}</div>
                        {m.brand && <div className="bl-fee-cat">{m.brand}</div>}
                      </div>
                    </div>
                    {m.isDefault && <span className="bl-chip bl-chip--ontime">{t('payments.default')}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Bills */}
        <Section title={t('payments.invoices')} icon={<Receipt className="w-4 h-4" />} count={bills.length}>
          {bills.length === 0 ? (
            <Empty>{t('payments.noInvoices')}</Empty>
          ) : (
            <div className="bl-fee-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
              {bills.map(b => (
                <div key={b._id} className="bl-fee-row">
                  <div className="min-w-0">
                    <div className="bl-fee-name">{b.invoiceNumber || b._id.slice(-8)}</div>
                    <div className="bl-fee-cat">{(b.encounterDate || b.createdAt).slice(0, 10)} · {b.facilityName}</div>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <div className="bl-num" style={{ fontWeight: 600, color: 'var(--ehr-text, #113055)' }}>{formatMoney(b.totalAmount)}</div>
                    <div style={{ fontSize: 10.5, color: b.balanceDue > 0 ? 'var(--color-danger-text)' : 'var(--color-success-text)' }}>
                      {b.balanceDue > 0 ? t('payments.amountDue', { amount: formatMoney(b.balanceDue) }) : t('payments.paid')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Payment history */}
        <Section title={t('payments.paymentHistory')} icon={<Clock className="w-4 h-4" />} count={sortedPayments.length}>
          {sortedPayments.length === 0 ? (
            <Empty>{t('payments.noPaymentsYet')}</Empty>
          ) : (
            <div className="bl-fee-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
              {sortedPayments.map(p => {
                const cfg = getMethodConfig(p.method);
                const MIcon = cfg.icon;
                const reversed = p.status === 'reversed' || p.status === 'refunded';
                return (
                  <div key={p._id} className="bl-fee-row" style={{ alignItems: 'flex-start' }}>
                    <div className="flex items-start gap-2.5 min-w-0">
                      <MIcon size={15} style={{ color: cfg.color, marginTop: 2, flexShrink: 0 }} />
                      <div className="min-w-0">
                        <div className="bl-fee-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {cfg.label}
                          {reversed && <span className="bl-chip bl-chip--cancelled">{p.status}</span>}
                        </div>
                        <div className="bl-fee-cat">
                          {p.reference && <span style={{ fontFamily: 'monospace' }}>{p.reference} · </span>}
                          {new Date(p.processedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </div>
                        {(p.mobileMoneyPhone || p.cardLast4) && (
                          <div className="bl-fee-cat">
                            {p.mobileMoneyPhone && <span>{p.mobileMoneyPhone}</span>}
                            {p.cardLast4 && <span>•••• {p.cardLast4}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span
                        className="bl-num"
                        style={{ fontWeight: 700, color: reversed ? 'var(--color-danger-text)' : 'var(--color-success-text)', textDecoration: reversed ? 'line-through' : 'none' }}
                      >
                        {formatMoney(p.amount)}
                      </span>
                      {/* Undo a recorded payment — Void reverses it, Refund gives money
                          back. Both go through a confirm dialog + audited service. */}
                      {!reversed && p.status === 'posted' && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => onReversePayment(p, 'void')}
                            className="bl-btn bl-btn--ghost"
                            style={{ padding: '3px 8px', fontSize: 11 }}
                          >
                            <Ban className="w-3 h-3" /> {t('action.reverse')}
                          </button>
                          <button
                            onClick={() => onReversePayment(p, 'refund')}
                            className="bl-btn bl-btn--outline"
                            style={{ padding: '3px 8px', fontSize: 11, borderColor: 'var(--color-danger)', color: 'var(--color-danger-text)' }}
                          >
                            <RotateCcw className="w-3 h-3" /> {t('action.undo')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Insurance claims — hidden for roles without the claims grant. */}
        {showClaims && (
          <Section title={t('billing.insuranceClaims')} icon={<Shield className="w-4 h-4" />} count={claims.length}>
            {claims.length === 0 ? (
              <Empty>{t('payments.noClaims')}</Empty>
            ) : (
              <div className="bl-fee-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
                {claims.map(c => (
                  <div key={c._id} className="bl-fee-row">
                    <div className="min-w-0">
                      <div className="bl-fee-name">{c.payerName}</div>
                      <div className="bl-fee-cat">
                        {c.claimNumber && <span style={{ fontFamily: 'monospace' }}>{c.claimNumber} · </span>}
                        {c.submittedDate ? t('payments.submittedOn', { date: c.submittedDate.slice(0, 10) }) : t('payments.draft')}
                      </div>
                    </div>
                    <span className={`bl-chip ${c.status === 'paid' ? 'bl-chip--paid' : c.status === 'denied' ? 'bl-chip--unpaid' : 'bl-chip--partial'}`}>
                      {c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* Payment plans */}
        <Section title={t('billing.paymentPlans')} icon={<Wallet className="w-4 h-4" />} count={plans.length}>
          {plans.length === 0 ? (
            <Empty>{t('payments.noPaymentPlans')}</Empty>
          ) : (
            <div className="bl-fee-list" style={{ maxHeight: 'none', overflow: 'visible' }}>
              {plans.map((p, idx) => {
                const planOutstanding = Math.max(0, p.totalBalance - p.paidToDate);
                return (
                  <div
                    key={p._id}
                    style={{ padding: '9px 12px', borderBottom: idx === plans.length - 1 ? 'none' : '1px solid var(--ehr-border-soft, #ECEEF1)' }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="bl-fee-name">
                          {t('payments.planMonthly', { amount: formatMoney(p.monthlyAmount), months: p.termMonths })}
                        </div>
                        <div className="bl-fee-cat">
                          {p.startDate.slice(0, 10)} → {p.endDate.slice(0, 10)} · {p.apr === 0 ? t('payments.interestFree') : t('payments.aprValue', { apr: p.apr })}
                        </div>
                      </div>
                      <span className={`bl-chip ${p.status === 'completed' ? 'bl-chip--paid' : p.status === 'active' ? 'bl-chip--partial' : 'bl-chip--unpaid'}`}>
                        {p.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-2 pt-2" style={{ borderTop: '1px solid var(--ehr-border-soft, #ECEEF1)' }}>
                      <div className="bl-fee-cat">
                        {t('payments.paid')}: <span style={{ color: 'var(--color-success-text)' }}>{formatMoney(p.paidToDate)}</span>
                        {' · '}{t('billing.kpiOutstanding')}: <span style={{ color: planOutstanding > 0 ? 'var(--color-danger-text)' : 'var(--ehr-text-body, #3C5574)' }}>{formatMoney(planOutstanding)}</span>
                      </div>
                      {p.status === 'active' && (
                        <button
                          onClick={() => onRecordPlanPayment(p)}
                          className="bl-btn bl-btn--outline"
                          style={{ padding: '4px 10px', fontSize: 11.5 }}
                        >
                          <Receipt className="w-3.5 h-3.5" />
                          {t('plans.recordPayment')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        </div>{/* /scrollable account sections */}

        {/* Footer actions */}
        <div className="px-5 py-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--ehr-border, #E2E6EB)' }}>
          <button onClick={() => router.push(`/patients/${line.patientId}?tab=billing`)} className="bl-btn bl-btn--outline" style={{ flex: 1 }}>
            {t('payments.openPatientRecord')} <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRecordPayment}
            className="bl-btn bl-btn--primary"
            style={{ flex: 1 }}
          >
            <Banknote className="w-4 h-4" /> {t('billing.collectPayment')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Section({ title, icon, count, children }: { title: string; icon: React.ReactNode; count: number; children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--ehr-border, #E2E6EB)' }}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'transparent', color: 'var(--bl-teal)' }}>
            {icon}
          </div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ehr-text-title, #113055)' }}>{title}</h3>
        </div>
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ehr-muted, #5D728B)' }}>{count}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] py-3 px-2" style={{ color: 'var(--ehr-muted, #5D728B)' }}>{children}</div>
  );
}
