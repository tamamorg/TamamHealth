'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, CalendarClock,
  Receipt, Printer, Search,
  ShieldCheck, RotateCcw, RefreshCw,
  Send, Copy, Check, ExternalLink,
} from '@/components/icons/lucide';
import { PaymentPanel, PaymentPlanWizard } from '@/components/payments';
import { useSuperbill, SuperbillPicker, SuperbillDraft } from '@/components/patients/SuperbillPanel';
import '@/components/billing/billing.css';
import InsurancePolicyModal from '@/components/payments/InsurancePolicyModal';
import Modal from '@/components/Modal';
import { getMethodConfig } from '@/lib/payment-method-config';
import { apiFetch } from '@/lib/api-fetch';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import { formatMoney } from '@/lib/format-utils';
import type { PatientDoc } from '@/lib/db-types';
import type {
  PaymentDoc, ChargeDoc, PaymentPlanDoc, InsurancePolicyDoc, RefundDoc, LedgerEntryDoc,
  AdjustmentType,
} from '@/lib/db-types-payments';
import Select from '@/components/Select';
import { escapeHtml, openIsolatedHtmlWindow } from '@/lib/safe-html';
import { useDataScope } from '@/lib/hooks/useDataScope';

const ADJUSTMENT_TYPES: AdjustmentType[] = ['write_off', 'bad_debt', 'charity', 'denial', 'contractual', 'correction'];
const BILLING_ROLES = ['cashier', 'biller', 'org_admin', 'medical_superintendent', 'super_admin'];

/**
 * Maps ChargeStatus onto the billing module's chip colors (bl-chip--unpaid/
 * partial/paid/waived/cancelled) so the Charges table reads with the same
 * "what's owed" vocabulary as the bill detail page's line items.
 */
const CHARGE_CHIP_CLASS: Record<string, string> = {
  pending: 'bl-chip--unpaid', submitted: 'bl-chip--partial', approved: 'bl-chip--paid',
  denied: 'bl-chip--unpaid', appealed: 'bl-chip--partial', voided: 'bl-chip--cancelled',
};
function statusChipClass(status: string): string {
  return `bl-chip ${CHARGE_CHIP_CLASS[status] || 'bl-chip--waived'}`;
}

interface BillingTabProps {
  patient: PatientDoc;
  patientBalance: number;
  showPaymentPanel: boolean;
  showPlanWizard: boolean;
  setShowPaymentPanel: (v: boolean) => void;
  setShowPlanWizard: (v: boolean) => void;
  reloadPayments: () => void;
  /** Encounter the superbill's charges post against, when the chart has one. */
  superbillEncounterId?: string;
  /** Registration facility's display name, for the posted superbill. */
  hospitalName?: string;
}

interface FinancialOverview {
  totalCharged: number;
  totalPaid: number;
  totalDiscount: number;
  totalRefunds: number;
  insurancePaid: number;
  selfPaid: number;
  payments: PaymentDoc[];
  charges: ChargeDoc[];
  plans: PaymentPlanDoc[];
  policies: InsurancePolicyDoc[];
}

interface CreatedPaymentLink {
  linkId: string;
  url: string;
  amount: number;
  currency: string;
  description: string;
  expiresAt: string;
  status: 'active' | 'expired' | 'used';
  createdAt: string;
  patientId: string;
}

/**
 * Builds a dedicated printable account statement (patient header, open bills,
 * payments, running balance) — used by the "Print statement" quick action so
 * it doesn't just dump the whole dashboard page via window.print(). Mirrors
 * the print-window technique in receipt-service.ts's printReceipt().
 */
function buildStatementHTML(opts: {
  patientName: string;
  hospitalNumber?: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  facilityName?: string;
  preparedBy?: string;
  overview: FinancialOverview;
  balance: number;
}): string {
  const { patientName, hospitalNumber, dateOfBirth, gender, phone, facilityName, preparedBy, overview, balance } = opts;
  const currency = overview.payments[0]?.currency || 'SSP';
  const generatedAt = new Date();
  const fmt = (n: number) => `${n.toLocaleString()} ${currency}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const e = escapeHtml;

  const chargeRows = overview.charges.length === 0
    ? `<tr><td colspan="4" class="empty">No open bills on file</td></tr>`
    : overview.charges.map(c => `
      <tr>
        <td>${e(fmtDate(c.serviceDate))}</td>
        <td>${e(c.description)}${c.category ? ` <span class="muted">· ${e(c.category)}</span>` : ''}</td>
        <td><span class="pill">${e(c.status)}</span></td>
        <td class="num">${e(fmt(c.billedAmount))}</td>
      </tr>`).join('');

  const paymentRows = overview.payments.length === 0
    ? `<tr><td colspan="4" class="empty">No payments recorded</td></tr>`
    : overview.payments.map(p => `
      <tr>
        <td>${e(fmtDate(p.processedAt))}</td>
        <td>${e(getMethodConfig(p.method).label)}</td>
        <td>${e(p.reference || '—')}</td>
        <td class="num pos">${e(fmt(p.amount))}</td>
      </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Account Statement — ${e(patientName)}</title>
<style>
  @page { margin: 14mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; color: #08573A; background: #fff; max-width: 720px; margin: 0 auto; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 2px solid var(--accent-primary); margin-bottom: 16px; }
  .header h1 { font-size: 18px; font-weight: 800; color: var(--accent-hover); }
  .header p { font-size: 11px; color: #5d728b; margin-top: 2px; }
  .doc-title { text-align: right; }
  .doc-title .label { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent-primary); }
  .doc-title .date { font-size: 11px; color: #5d728b; margin-top: 2px; }
  .patient-block { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; padding: 12px 14px; background: #fafbfc; border-radius: 8px; margin-bottom: 20px; }
  .patient-block .field .label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #5d728b; letter-spacing: 0.4px; }
  .patient-block .field .value { font-size: 12.5px; font-weight: 600; margin-top: 2px; }
  h2.section { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent-hover); margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.4px; color: #5d728b; padding: 6px 8px; border-bottom: 1px solid #e2e6eb; }
  td { padding: 7px 8px; border-bottom: 1px solid #f1f3f5; vertical-align: top; }
  td.num { text-align: right; font-weight: 600; white-space: nowrap; }
  td.pos { color: #0B8557; }
  td.empty { text-align: center; color: #94a2b3; padding: 14px 8px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; background: #f1f3f5; color: #3C5574; text-transform: capitalize; }
  .muted { color: #94a2b3; font-size: 11px; }
  .summary { margin-top: 20px; margin-left: auto; width: 260px; }
  .summary .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12.5px; }
  .summary .row.total { border-top: 2px solid var(--accent-primary); margin-top: 6px; padding-top: 8px; font-size: 15px; font-weight: 800; color: var(--accent-hover); }
  .footer { text-align: center; margin-top: 28px; padding-top: 12px; border-top: 1px dashed #cfd6dd; }
  .footer p { font-size: 10px; color: #5d728b; line-height: 1.6; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${e(facilityName || 'TamamHealth Health Facility')}</h1>
      <p>Digital Health Records — Powered by TamamHealth</p>
    </div>
    <div class="doc-title">
      <div class="label">Account Statement</div>
      <div class="date">Generated ${e(generatedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}</div>
    </div>
  </div>

  <div class="patient-block">
    <div class="field"><div class="label">Patient</div><div class="value">${e(patientName)}</div></div>
    <div class="field"><div class="label">Hospital #</div><div class="value">${e(hospitalNumber || '—')}</div></div>
    <div class="field"><div class="label">Date of Birth</div><div class="value">${e(dateOfBirth ? fmtDate(dateOfBirth) : '—')}</div></div>
    <div class="field"><div class="label">Gender</div><div class="value">${e(gender || '—')}</div></div>
    <div class="field"><div class="label">Phone</div><div class="value">${e(phone || '—')}</div></div>
    <div class="field"><div class="label">Prepared By</div><div class="value">${e(preparedBy || '—')}</div></div>
  </div>

  <h2 class="section">Open Bills</h2>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th>Status</th><th style="text-align:right">Billed</th></tr></thead>
    <tbody>${chargeRows}</tbody>
  </table>

  <h2 class="section">Payments</h2>
  <table>
    <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${paymentRows}</tbody>
  </table>

  <div class="summary">
    <div class="row"><span>Total Charged</span><span>${e(fmt(overview.totalCharged))}</span></div>
    <div class="row"><span>Insurance Paid</span><span>${e(fmt(overview.insurancePaid))}</span></div>
    <div class="row"><span>Self Paid</span><span>${e(fmt(overview.selfPaid))}</span></div>
    <div class="row total"><span>Balance Due</span><span>${e(fmt(balance))}</span></div>
  </div>

  <div class="footer">
    <p>This statement was electronically generated and reflects the account as of the date above.<br>For questions, contact the billing desk.</p>
  </div>
</body>
</html>`;
}

export default function BillingTab({
  patient, patientBalance, showPaymentPanel, showPlanWizard,
  setShowPaymentPanel, setShowPlanWizard, reloadPayments,
  superbillEncounterId, hospitalName,
}: BillingTabProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();
  const [data, setData] = useState<FinancialOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [chargeSearch, setChargeSearch] = useState('');

  const patientName = `${patient.firstName} ${patient.surname}`;
  const canManageBilling = BILLING_ROLES.includes(currentUser?.role ?? '');
  const facilityId = currentUser?.hospitalId ?? '';
  const orgId = currentUser?.orgId;

  // ─── Refund ───
  const [showRefund, setShowRefund] = useState(false);
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundAmount, setRefundAmount] = useState(0);
  const [refundReason, setRefundReason] = useState('');
  const [processingRefund, setProcessingRefund] = useState(false);

  const refundablePayments = (data?.payments ?? []).filter(p => p.method !== 'insurance' && p.method !== 'waiver');
  const selectedRefundPayment = refundablePayments.find(p => p._id === refundPaymentId);

  const openRefund = () => {
    const first = refundablePayments[0];
    setRefundPaymentId(first?._id ?? '');
    setRefundAmount(first?.amount ?? 0);
    setRefundReason('');
    setShowRefund(true);
  };

  const handleRefundPaymentChange = (id: string) => {
    setRefundPaymentId(id);
    const p = refundablePayments.find(x => x._id === id);
    setRefundAmount(p?.amount ?? 0);
  };

  const handleIssueRefund = async () => {
    if (!selectedRefundPayment) { showToast(t('billing.selectPayment') || 'Select a payment to refund', 'error'); return; }
    if (!refundReason.trim()) { showToast(t('billing.reasonRequired') || 'A reason is required', 'error'); return; }
    if (refundAmount <= 0 || refundAmount > selectedRefundPayment.amount) {
      showToast(t('billing.invalidRefundAmount') || 'Refund amount must be between 0 and the payment amount', 'error');
      return;
    }
    setProcessingRefund(true);
    try {
      const svc = await import('@/lib/services/payment-service');
      await svc.issueRefund({
        paymentId: selectedRefundPayment._id,
        patientId: patient._id,
        patientName,
        amount: refundAmount,
        currency: selectedRefundPayment.currency,
        method: selectedRefundPayment.method,
        reason: refundReason.trim(),
        processedBy: currentUser?._id ?? '',
        processedByName: currentUser?.name ?? '',
        facilityId,
        orgId,
      });
      showToast(t('billing.refundIssued') || 'Refund issued', 'success');
      setShowRefund(false);
      reloadPayments();
      loadAll();
    } catch (err) {
      console.error('Failed to issue refund:', err);
      showToast(t('billing.refundFailed') || 'Failed to issue refund', 'error');
    }
    setProcessingRefund(false);
  };

  // ─── Adjustment / write-off ───
  const [showAdjustment, setShowAdjustment] = useState(false);
  const [adjForm, setAdjForm] = useState<{ adjustmentType: AdjustmentType; amount: number; reason: string; reasonCode: string }>({
    adjustmentType: 'write_off', amount: 0, reason: '', reasonCode: '',
  });
  const [processingAdj, setProcessingAdj] = useState(false);

  const handleCreateAdjustment = async () => {
    if (!adjForm.reason.trim()) { showToast(t('billing.reasonRequired') || 'A reason is required', 'error'); return; }
    if (adjForm.amount <= 0) { showToast(t('billing.invalidAmount') || 'Enter a valid amount', 'error'); return; }
    setProcessingAdj(true);
    try {
      const svc = await import('@/lib/services/payment-service');
      await svc.createAdjustment({
        patientId: patient._id,
        adjustmentType: adjForm.adjustmentType,
        amount: adjForm.amount,
        reason: adjForm.reason.trim(),
        reasonCode: adjForm.reasonCode.trim() || undefined,
        approvedBy: currentUser?._id ?? '',
        approvedByName: currentUser?.name ?? '',
        facilityId,
        orgId,
      });
      showToast(t('billing.adjustmentCreated') || 'Adjustment recorded', 'success');
      setShowAdjustment(false);
      setAdjForm({ adjustmentType: 'write_off', amount: 0, reason: '', reasonCode: '' });
      reloadPayments();
      loadAll();
    } catch (err) {
      console.error('Failed to create adjustment:', err);
      showToast(t('billing.adjustmentFailed') || 'Failed to record adjustment', 'error');
    }
    setProcessingAdj(false);
  };

  // ─── Insurance policy add ───
  // Editing/verifying individual policies used to live in a standalone
  // "Insurance Coverage" card (InsuranceSnapshot). That card is gone —
  // coverage is now a single stat in the money-summary strip — so only the
  // "add a policy" action (surfaced in the action bar) still has a home here.
  const [insuranceModalOpen, setInsuranceModalOpen] = useState(false);
  const handleInsuranceSaved = () => {
    setInsuranceModalOpen(false);
    loadAll();
  };

  // ─── Send payment link ───
  const [showPaymentLink, setShowPaymentLink] = useState(false);
  const [linkAmount, setLinkAmount] = useState(0);
  const [linkDescription, setLinkDescription] = useState('');
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [createdLink, setCreatedLink] = useState<CreatedPaymentLink | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const openPaymentLink = () => {
    setLinkAmount(Math.max(0, Math.round(patientBalance)));
    setLinkDescription('');
    setLinkError(null);
    setCreatedLink(null);
    setLinkCopied(false);
    setShowPaymentLink(true);
  };

  const handleCreatePaymentLink = async () => {
    if (!linkAmount || linkAmount <= 0) {
      setLinkError(t('billing.invalidAmount') || 'Enter a valid amount');
      return;
    }
    if (!linkDescription.trim()) {
      setLinkError(t('billing.reasonRequired') || 'A description is required');
      return;
    }
    setCreatingLink(true);
    setLinkError(null);
    try {
      const res = await apiFetch('/api/payment-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patient._id, amount: linkAmount, description: linkDescription.trim() }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLinkError(payload.error || t('billing.paymentLinkFailed') || 'Failed to create payment link');
        setCreatingLink(false);
        return;
      }
      setCreatedLink(payload as CreatedPaymentLink);
    } catch (err) {
      console.error('Failed to create payment link:', err);
      setLinkError(t('billing.paymentLinkFailed') || 'Could not reach the server. Please try again.');
    }
    setCreatingLink(false);
  };

  const handleCopyPaymentLink = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink.url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      showToast(t('billing.copyFailed') || 'Could not copy link', 'error');
    }
  };

  // ─── Print statement ───
  const handlePrintStatement = () => {
    if (!data) return;
    const html = buildStatementHTML({
      patientName,
      hospitalNumber: patient.hospitalNumber,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      phone: patient.phone,
      facilityName: currentUser?.hospitalName || currentUser?.hospital?.name,
      preparedBy: currentUser?.name,
      overview: data,
      balance: patientBalance,
    });
    openIsolatedHtmlWindow(html, 'width=480,height=720', true);
  };

  const loadAll = useCallback(async () => {
    if (!scope) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const [paymentSvc, ledgerSvc] = await Promise.all([
        import('@/lib/services/payment-service'),
        import('@/lib/services/ledger-service'),
      ]);

      const [payments, charges, plans, policies, refunds, ledgerEntries] = await Promise.all([
        paymentSvc.getPaymentsByPatient(patient._id, scope),
        paymentSvc.getChargesByPatient(patient._id, scope).catch(() => [] as ChargeDoc[]),
        paymentSvc.getPaymentPlansByPatient(patient._id, scope),
        paymentSvc.getPatientInsurancePolicies(patient._id, scope),
        paymentSvc.getRefundsByPatient(patient._id, scope).catch(() => [] as RefundDoc[]),
        ledgerSvc.getPatientLedger(patient._id, undefined, scope).catch(() => [] as LedgerEntryDoc[]),
      ]);

      const totalCharged = charges.reduce((s: number, c: ChargeDoc) => s + c.billedAmount, 0);
      const postedPayments = payments.filter((p: PaymentDoc) => p.status === 'posted');
      const totalPaid = postedPayments.reduce((s: number, p: PaymentDoc) => s + p.amount, 0);
      const insurancePaid = postedPayments
        .filter((p: PaymentDoc) => p.method === 'insurance')
        .reduce((s: number, p: PaymentDoc) => s + p.amount, 0);
      const selfPaid = totalPaid - insurancePaid;
      // Discount = adjustments/write-offs posted to the ledger (stored as
      // negative "credit" entries there); folding the ledger in here — as a
      // totals figure — instead of rendering it as its own list.
      const totalDiscount = ledgerEntries
        .filter((e: LedgerEntryDoc) => e.entryType === 'adjustment' || e.entryType === 'write_off')
        .reduce((s: number, e: LedgerEntryDoc) => s + Math.abs(e.amount), 0);
      const totalRefunds = refunds
        .filter((r: RefundDoc) => r.status === 'processed')
        .reduce((s: number, r: RefundDoc) => s + r.amount, 0);

      setData({
        totalCharged,
        totalPaid,
        totalDiscount,
        totalRefunds,
        insurancePaid,
        selfPaid,
        payments: postedPayments.sort((a: PaymentDoc, b: PaymentDoc) =>
          new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime()
        ),
        charges,
        plans,
        policies,
      });
    } catch (err) {
      console.error('Failed to load billing data:', err);
      setData({
        totalCharged: 0, totalPaid: 0, totalDiscount: 0, totalRefunds: 0, insurancePaid: 0, selfPaid: 0,
        payments: [], charges: [], plans: [], policies: [],
      });
    }
    setLoading(false);
  }, [patient._id, scope]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Superbill state lives here so its picker can sit on the Charges toolbar
  // while the draft ticket renders directly above the charges it prices.
  // Posting creates a bill, which billing-service mirrors into the ledger — so
  // reload the tab's ledger-derived figures and the header balance, which the
  // standalone panel left stale until the chart was reopened. (The Charges
  // table itself lists ChargeDocs; a posted superbill lands as a bill, and
  // shows up under Billing rather than as rows here.)
  const superbill = useSuperbill({
    patient,
    encounterId: superbillEncounterId,
    hospitalName,
    onPosted: (message) => {
      showToast(message, 'success');
      loadAll();
      reloadPayments();
    },
  });

  if (loading) {
    return (
      <div className="bl-root">
        <div className="bl-loading">
          <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--ehr-border, #E2E6EB)', borderTopColor: 'var(--bl-teal)' }} />
          {t('billing.loadingBillingInfo')}
        </div>
      </div>
    );
  }

  const d = data!;
  const activePlan = d.plans.find(p => p.status === 'active');
  const hasInsurance = d.policies.length > 0;
  const primaryPolicy = d.policies.find(p => p.isPrimary) || d.policies[0];
  const lastPayment = d.payments[0];

  // "Search this table" — same client-side filter the bill detail page uses
  // for its line items, scoped to description/category.
  const chargeQuery = chargeSearch.trim().toLowerCase();
  const visibleCharges = d.charges.filter(c => !chargeQuery
    || c.description.toLowerCase().includes(chargeQuery)
    || c.category.toLowerCase().includes(chargeQuery));
  const addInsuranceLabel = t('insuranceSnapshot.addInsurance') || 'Add insurance';

  return (
    <div className="bl-root">
      {/* ─── Money summary ───
          The chart header (visible on every tab) already carries the
          patient's live balance as a clickable chip, so this strip doesn't
          repeat it as a second banner — it adds the account's other facts
          (what's charged/paid, coverage, last payment, plan state) in the
          flat label-above-value language the bill detail page uses. Insurance
          and payment-plan progress used to be their own cards; now they're
          one stat each here instead of a fourth and fifth retelling. */}
      <div className="bl-stats">
        <div>
          <span className="bl-stat-label">{t('billing.totalBilled')}</span>
          <span className="bl-stat-value">{formatMoney(d.totalCharged)}</span>
        </div>
        <div>
          <span className="bl-stat-label">{t('billing.totalPaid')}</span>
          <span className="bl-stat-value">{formatMoney(d.totalPaid)}</span>
        </div>
        <div>
          <span className="bl-stat-label">{t('billing.outstandingBalance')}</span>
          <span className={`bl-stat-value ${patientBalance > 0 ? 'bl-stat-value--danger' : 'bl-stat-value--good'}`}>
            {formatMoney(patientBalance)}
          </span>
        </div>
        <div>
          <span className="bl-stat-label">{t('billing.insuranceCoverage')}</span>
          <span className="bl-stat-value" style={{ fontSize: 16 }}>
            {hasInsurance ? primaryPolicy.payerName : (t('billing.selfPayNoInsurance') || 'Self-pay')}
          </span>
        </div>
        <div>
          <span className="bl-stat-label">{t('billing.lastPayment')}</span>
          <span className="bl-stat-value" style={{ fontSize: 16 }}>
            {lastPayment ? new Date(lastPayment.processedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
          </span>
        </div>
        <div>
          <span className="bl-stat-label">{t('billing.paymentPlanLabel')}</span>
          <span className="bl-stat-value" style={{ fontSize: 16 }}>
            {activePlan ? t('billing.monthPlan', { count: activePlan.termMonths }) : '—'}
          </span>
          {activePlan && (
            <span className="bl-stat-sub">{t('billing.remaining', { amount: formatMoney(activePlan.remainingBalance) })}</span>
          )}
        </div>
      </div>

      {/* ─── Charges ─── */}
      <div className="bl-card">
        <div className="bl-card-head">
          <h2 className="bl-card-title">Charges</h2>
          <p className="bl-card-sub">Items billed to this patient across all encounters</p>
          <span className="bl-underline" />
        </div>
        {/* ─── Toolbar ───
            Same shape as the appointments list header: the table's search box
            takes the row, then the superbill service picker (the one control
            that writes new rows into this table), then the account actions as
            38px square `listpage-icon-btn`s (label lives in title/aria-label)
            with the one filled primary last. */}
        <div className="bl-toolbar">
          <div className="bl-search">
            <Search size={16} />
            <input
              type="text"
              value={chargeSearch}
              onChange={e => setChargeSearch(e.target.value)}
              placeholder="Search this table"
              aria-label="Search charges"
            />
          </div>
          <SuperbillPicker sb={superbill} />
          <button
            type="button"
            className="listpage-icon-btn"
            onClick={() => setInsuranceModalOpen(true)}
            title={addInsuranceLabel}
            aria-label={addInsuranceLabel}
          >
            <ShieldCheck size={16} />
          </button>
          <button
            type="button"
            className="listpage-icon-btn"
            onClick={() => setShowPlanWizard(true)}
            title={t('billing.createPaymentPlan')}
            aria-label={t('billing.createPaymentPlan')}
          >
            <CalendarClock size={16} />
          </button>
          <button
            type="button"
            className="listpage-icon-btn"
            onClick={handlePrintStatement}
            title={t('billing.printStatement')}
            aria-label={t('billing.printStatement')}
          >
            <Printer size={16} />
          </button>
          <button
            type="button"
            className="listpage-icon-btn"
            onClick={openPaymentLink}
            title={t('billing.sendPaymentLink')}
            aria-label={t('billing.sendPaymentLink')}
          >
            <Send size={16} />
          </button>
          {canManageBilling && (
            <>
              <button
                type="button"
                className="listpage-icon-btn"
                onClick={openRefund}
                title={t('billing.issueRefund')}
                aria-label={t('billing.issueRefund')}
              >
                <RotateCcw size={16} />
              </button>
              <button
                type="button"
                className="listpage-icon-btn bl-icon-btn--danger"
                onClick={() => setShowAdjustment(true)}
                title={t('billing.adjustmentWriteOff')}
                aria-label={t('billing.adjustmentWriteOff')}
              >
                <RefreshCw size={16} />
              </button>
            </>
          )}
          <button
            type="button"
            className="listpage-icon-btn listpage-icon-btn-primary"
            onClick={() => setShowPaymentPanel(true)}
            title={t('billing.collectPayment')}
            aria-label={t('billing.collectPayment')}
          >
            <Wallet size={16} />
          </button>
        </div>
        <SuperbillDraft sb={superbill} />
        {d.charges.length === 0 ? (
          <div className="bl-empty">
            <Receipt size={28} />
            <p>{t('billing.noChargesRecorded')}</p>
          </div>
        ) : (
          <div className="bl-table-wrap">
            <table className="bl-table">
              <thead>
                <tr>
                  <th>Number</th><th>Charge</th><th>Category</th><th>Status</th><th>Date</th><th className="bl-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleCharges.length === 0 ? (
                  <tr><td colSpan={6} className="bl-muted" style={{ textAlign: 'center', padding: 24 }}>No charges match your search.</td></tr>
                ) : visibleCharges.map((charge, idx) => (
                  <tr key={charge._id}>
                    <td className="bl-num">{idx + 1}</td>
                    <td>{charge.description}</td>
                    <td className="bl-muted">{charge.category}</td>
                    <td><span className={statusChipClass(charge.status)}>{charge.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(charge.serviceDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="bl-num bl-right">{formatMoney(charge.billedAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Payments ───
          Full width: the running totals column the bill detail page carries
          alongside this list is dropped here, since the summary strip above
          already states billed/paid/outstanding for the whole account. */}
      <div className="bl-card">
        <div className="bl-pay-single">
          <h2 className="bl-card-title">Payments</h2>
          <span className="bl-underline" />

          {d.payments.length === 0 ? (
            <div className="bl-empty">
              <h3>{t('billing.noPaymentsRecorded')}</h3>
              <p>Payments recorded for this patient will appear here.</p>
            </div>
          ) : (
            <div className="bl-table-wrap">
              <table className="bl-table">
                <thead>
                  <tr><th>Date</th><th>Method</th><th>Reference</th><th>Received by</th><th className="bl-right">Amount</th></tr>
                </thead>
                <tbody>
                  {d.payments.map(pmt => (
                    <tr key={pmt._id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{new Date(pmt.processedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td>{getMethodConfig(pmt.method).label}</td>
                      <td className="bl-muted">{pmt.reference || '—'}</td>
                      <td>{pmt.processedByName}</td>
                      <td className="bl-num bl-right">{formatMoney(pmt.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ─── Payment Panel Modal ─── */}
      {showPaymentPanel && (
        <PaymentPanel
          patientId={patient._id}
          patientName={`${patient.firstName} ${patient.surname}`}
          amountDue={patientBalance}
          onSuccess={() => { setShowPaymentPanel(false); reloadPayments(); loadAll(); }}
          onCancel={() => setShowPaymentPanel(false)}
        />
      )}

      {/* ─── Plan Wizard Modal ─── */}
      {showPlanWizard && (
        <PaymentPlanWizard
          patientId={patient._id}
          patientName={`${patient.firstName} ${patient.surname}`}
          balance={patientBalance}
          encounterIds={[]}
          onComplete={() => { setShowPlanWizard(false); reloadPayments(); loadAll(); }}
          onCancel={() => setShowPlanWizard(false)}
        />
      )}

      {/* ─── Issue Refund Modal ─── */}
      {showRefund && (
        <Modal onClose={() => setShowRefund(false)} width={460} labelledBy="bl-refund-title">
          <div className="bl-root bl-modal-body">
            <div className="bl-modal-head">
              <h3 className="bl-modal-title" id="bl-refund-title">{t('billing.issueRefund')}</h3>
            </div>
            {refundablePayments.length === 0 ? (
              <div className="bl-empty" style={{ padding: '20px 0' }}>
                <p>{t('billing.noRefundablePayments')}</p>
              </div>
            ) : (
              <>
                <div className="bl-field">
                  <label htmlFor="bl-refund-payment">{t('billing.payment')}</label>
                  <Select id="bl-refund-payment" value={refundPaymentId} onChange={e => handleRefundPaymentChange(e.target.value)}>
                    {refundablePayments.map(p => (
                      <option key={p._id} value={p._id}>
                        {formatMoney(p.amount)} · {getMethodConfig(p.method).label} · {new Date(p.processedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="bl-field">
                  <label htmlFor="bl-refund-amount">{t('billing.refundAmount')}</label>
                  <input
                    id="bl-refund-amount"
                    type="number"
                    min={0}
                    max={selectedRefundPayment?.amount ?? 0}
                    value={refundAmount || ''}
                    onChange={e => setRefundAmount(parseFloat(e.target.value) || 0)}
                  />
                  {selectedRefundPayment && (
                    <span className="bl-muted" style={{ fontSize: 11 }}>
                      {t('billing.maxRefund', { amount: formatMoney(selectedRefundPayment.amount) })}
                    </span>
                  )}
                </div>
                <div className="bl-field">
                  <label htmlFor="bl-refund-reason">{t('billing.reason')}</label>
                  <textarea id="bl-refund-reason" rows={2} value={refundReason} onChange={e => setRefundReason(e.target.value)} placeholder={t('billing.reasonPlaceholder')} />
                </div>
              </>
            )}
            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" onClick={() => setShowRefund(false)}>{t('common.cancel')}</button>
              <button type="button" className="bl-btn bl-btn--primary" onClick={handleIssueRefund} disabled={processingRefund || refundablePayments.length === 0}>
                {processingRefund ? t('common.processing') : t('billing.issueRefund')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Adjustment / Write-off Modal ─── */}
      {showAdjustment && (
        <Modal onClose={() => setShowAdjustment(false)} width={460} labelledBy="bl-adj-title">
          <div className="bl-root bl-modal-body">
            <div className="bl-modal-head">
              <h3 className="bl-modal-title" id="bl-adj-title">{t('billing.adjustmentWriteOff')}</h3>
            </div>
            <div className="bl-field">
              <label htmlFor="bl-adj-type">{t('billing.adjustmentType')}</label>
              <Select id="bl-adj-type" value={adjForm.adjustmentType} onChange={e => setAdjForm({ ...adjForm, adjustmentType: e.target.value as AdjustmentType })}>
                {ADJUSTMENT_TYPES.map(at => <option key={at} value={at}>{at.replace(/_/g, ' ')}</option>)}
              </Select>
            </div>
            <div className="bl-field">
              <label htmlFor="bl-adj-amount">{t('billing.amount')}</label>
              <input id="bl-adj-amount" type="number" min={0} value={adjForm.amount || ''} onChange={e => setAdjForm({ ...adjForm, amount: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="bl-field">
              <label htmlFor="bl-adj-reasoncode">{t('billing.reasonCode')}</label>
              <input id="bl-adj-reasoncode" type="text" value={adjForm.reasonCode} onChange={e => setAdjForm({ ...adjForm, reasonCode: e.target.value })} placeholder={t('common.optional')} />
            </div>
            <div className="bl-field">
              <label htmlFor="bl-adj-reason">{t('billing.reason')}</label>
              <textarea id="bl-adj-reason" rows={2} value={adjForm.reason} onChange={e => setAdjForm({ ...adjForm, reason: e.target.value })} placeholder={t('billing.reasonPlaceholder')} />
            </div>
            <div className="bl-modal-actions">
              <button type="button" className="bl-btn bl-btn--ghost" onClick={() => setShowAdjustment(false)}>{t('common.cancel')}</button>
              <button type="button" className="bl-btn bl-btn--primary" onClick={handleCreateAdjustment} disabled={processingAdj}>
                {processingAdj ? t('common.processing') : t('common.save')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Add Insurance Policy Modal ─── */}
      {insuranceModalOpen && (
        <InsurancePolicyModal
          patientId={patient._id}
          policy={null}
          facilityId={facilityId}
          orgId={orgId}
          createdBy={currentUser?._id}
          onClose={() => setInsuranceModalOpen(false)}
          onSaved={handleInsuranceSaved}
        />
      )}

      {/* ─── Send Payment Link Modal ───
          billing.sendPaymentLink was missing from en.ts, so `t()` returned the
          raw key verbatim (the `|| 'fallback'` guards never fire — t() only
          returns falsy when the key itself is empty). That left this button,
          and every string in this modal, showing dot-path keys on screen.
          Key added to en.ts; the whole modal restyled to the bl- language
          while fixing it. */}
      {showPaymentLink && (
        <Modal onClose={() => setShowPaymentLink(false)} width={440} labelledBy="bl-link-title">
          <div className="bl-root bl-modal-body">
            <div className="bl-modal-head">
              <h3 className="bl-modal-title" id="bl-link-title">{t('billing.sendPaymentLink')}</h3>
            </div>

            {!createdLink ? (
              <>
                <div className="bl-field">
                  <label htmlFor="bl-link-amount">{t('billing.amount')}</label>
                  <input
                    id="bl-link-amount"
                    type="number" min={0} value={linkAmount || ''}
                    onChange={e => setLinkAmount(parseFloat(e.target.value) || 0)}
                  />
                </div>
                <div className="bl-field">
                  <label htmlFor="bl-link-desc">{t('billing.reason')}</label>
                  <textarea
                    id="bl-link-desc"
                    rows={2} value={linkDescription} onChange={e => setLinkDescription(e.target.value)}
                    placeholder={t('billing.paymentLinkDescPlaceholder')}
                  />
                </div>
                {linkError && <p className="bl-danger" style={{ fontSize: 12, margin: 0 }}>{linkError}</p>}
                <div className="bl-modal-actions">
                  <button type="button" className="bl-btn bl-btn--ghost" onClick={() => setShowPaymentLink(false)}>{t('common.cancel')}</button>
                  <button type="button" className="bl-btn bl-btn--primary" onClick={handleCreatePaymentLink} disabled={creatingLink}>
                    {creatingLink ? t('common.processing') : t('billing.generateLink')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <dl className="bl-totals">
                  <div className="bl-totals-row"><dt>{t('billing.amount')}</dt><dd>{formatMoney(createdLink.amount, { currency: createdLink.currency })}</dd></div>
                  <div className="bl-totals-row">
                    <dt>{t('billing.expires')}</dt>
                    <dd>{new Date(createdLink.expiresAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</dd>
                  </div>
                </dl>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 6, background: 'var(--ehr-page-bg, #F5F8FB)', border: '1px solid var(--ehr-border, #E2E6EB)',
                }}>
                  <ExternalLink size={14} className="bl-muted" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: 'var(--ehr-text, #113055)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {createdLink.url}
                  </span>
                  <button type="button" className="bl-btn bl-btn--outline" style={{ padding: '4px 10px', fontSize: 11 }} onClick={handleCopyPaymentLink} title={t('billing.copyLink')}>
                    {linkCopied ? <Check size={12} /> : <Copy size={12} />}
                    {linkCopied ? t('billing.copied') : t('billing.copy')}
                  </button>
                </div>
                <div className="bl-modal-actions">
                  <button type="button" className="bl-btn bl-btn--primary" onClick={() => setShowPaymentLink(false)}>{t('common.done')}</button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
