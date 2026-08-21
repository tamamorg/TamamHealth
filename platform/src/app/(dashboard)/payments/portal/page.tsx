'use client';

import { useState, useEffect, useMemo } from 'react';
import DemoModeBanner from '@/components/DemoModeBanner';
import {
  CreditCard, Smartphone, Building2, CheckCircle,
  Shield, Receipt, ChevronLeft,
  ArrowRight, Wallet, Copy, Check, Loader2, AlertCircle
} from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { BillingDoc } from '@/lib/db-types-billing';
import type { PaymentMethodType, PaymentStatus } from '@/lib/db-types-payments';
import { formatMoney } from '@/lib/format-utils';
import '@/components/billing/billing.css';

// Demo gate. In production (NEXT_PUBLIC_DEMO_MODE=false) the portal never
// shows fake invoices or the hardcoded Equity Bank account — empty state
// instead, and bank details fall back to a "contact billing" placeholder.
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

// Shape the portal renders against — independent of underlying BillingDoc so
// we can keep the demo fallback when a patient has no real bills yet.
// Carries patientId/patientName/facilityId/currency through from the source
// BillingDoc — currentUser here is the *staff* member running this
// assisted-portal flow (see role-routes.ts: only cashier/medical_biller can
// reach /payments/portal), never the patient, so a recorded payment MUST be
// attributed using the bill's own patient/facility, not currentUser.
interface PortalBill {
  id: string;
  patientId: string;
  patientName: string;
  facilityId?: string;
  currency?: string;
  date: string;
  description: string;
  amount: number;
  paid: number;
  status: 'unpaid' | 'partial' | 'paid';
}

const billStatus = (totalAmount: number, paid: number): PortalBill['status'] =>
  paid >= totalAmount ? 'paid' : paid > 0 ? 'partial' : 'unpaid';

const fromBillingDoc = (b: BillingDoc): PortalBill => ({
  id: b.invoiceNumber || b._id,
  patientId: b.patientId,
  patientName: b.patientName,
  facilityId: b.facilityId,
  currency: b.currency,
  date: (b.encounterDate || (b as { createdAt?: string }).createdAt || '').slice(0, 10),
  description:
    (b.items && b.items.length > 0 ? b.items.map(i => i.description).slice(0, 2).join(', ') : null)
    || `Visit at ${b.facilityName}`,
  amount: b.totalAmount,
  paid: b.amountPaid,
  status: billStatus(b.totalAmount, b.amountPaid),
});

// Demo bills have no real patient behind them — tag them with a stable,
// clearly-demo patient id/name so a "recorded" demo payment never gets
// silently attributed to a real person.
const DEMO_PATIENT_ID = 'demo-patient-portal';
const DEMO_PATIENT_NAME = 'Demo Patient';

/* ═══════════════════════════════════════════════════════════════
   Patient Payment Portal
   Self-service interface for patients to view bills, make
   payments via mobile money/card/bank, and manage payment plans.
   ═══════════════════════════════════════════════════════════════ */

// Demo fallback — only shown when the patient has no real bills on file
// (e.g. brand-new account or local-only deploy without seeded data).
const DEMO_BILLS: PortalBill[] = [
  { id: 'INV-DEMO-0041', patientId: DEMO_PATIENT_ID, patientName: DEMO_PATIENT_NAME, date: '2026-04-10', description: 'General Consultation + Lab Work', amount: 15000, paid: 0, status: 'unpaid' },
  { id: 'INV-DEMO-0038', patientId: DEMO_PATIENT_ID, patientName: DEMO_PATIENT_NAME, date: '2026-04-03', description: 'Follow-up Visit — Dr. Achol', amount: 8000, paid: 8000, status: 'paid' },
  { id: 'INV-DEMO-0032', patientId: DEMO_PATIENT_ID, patientName: DEMO_PATIENT_NAME, date: '2026-03-20', description: 'X-Ray + Radiology Report', amount: 24000, paid: 12000, status: 'partial' },
  { id: 'INV-DEMO-0025', patientId: DEMO_PATIENT_ID, patientName: DEMO_PATIENT_NAME, date: '2026-03-10', description: 'Pharmacy — Antibiotics (5-day)', amount: 4000, paid: 4000, status: 'paid' },
  { id: 'INV-DEMO-0019', patientId: DEMO_PATIENT_ID, patientName: DEMO_PATIENT_NAME, date: '2026-02-28', description: 'Emergency Visit + Sutures', amount: 36000, paid: 36000, status: 'paid' },
];

type PaymentMethod = 'mgurush' | 'mpesa' | 'mtn' | 'airtel' | 'card' | 'bank';

// There is no live payment-gateway integration wired up for this portal (no
// Flutterwave/M-Pesa/Airtel redirect or webhook exists for it) — every method
// here is recorded as a `pending` PaymentDoc awaiting finance verification,
// exactly like the pay-by-link (`/api/checkout`) and patient-token
// (`/api/patient-portal/payments`) flows do. This map only translates the
// portal's UI method keys onto the canonical PaymentMethodType union so the
// recorded payment is reconcilable with the rest of the system.
const METHOD_TO_PAYMENT_TYPE: Record<PaymentMethod, PaymentMethodType> = {
  mgurush: 'm_gurush',
  mpesa: 'mpesa',
  mtn: 'mtn_momo',
  airtel: 'airtel',
  card: 'card',
  bank: 'bank_transfer',
};

// Bank-transfer instructions are sourced from the org's `bankDetails` settings
// field (set by the org admin on the branding page). When the org hasn't filled
// it in, real production deploys show a "contact billing" placeholder so we
// never hand patients a fake account number; demo mode keeps a canned Equity
// Bank example so the flow still has something to show.
const BANK_INSTRUCTIONS_DEMO = 'Bank: Equity Bank South Sudan\nAccount: 0012345678901\nBranch: Juba Main\nReference: Your Invoice #';
const BANK_INSTRUCTIONS_FALLBACK = 'Contact billing for payment instructions.';

const resolveBankInstructions = (bankDetails?: string): string =>
  (bankDetails && bankDetails.trim())
    ? bankDetails.trim()
    : (IS_DEMO ? BANK_INSTRUCTIONS_DEMO : BANK_INSTRUCTIONS_FALLBACK);

type PaymentMethodDef = { id: PaymentMethod; label: string; desc: string; icon: typeof Smartphone; color: string; instructions: string };

const buildPaymentMethods = (bankDetails?: string): PaymentMethodDef[] => [
  { id: 'mgurush', label: 'm-GURUSH', desc: 'Pay via m-GURUSH (South Sudan)', icon: Smartphone, color: '#1E90FF', instructions: 'Dial *158# > Pay Bill\nBusiness Number: TamamHealth\nReference: Your Invoice #' },
  { id: 'mpesa', label: 'M-Pesa', desc: 'Pay via Safaricom M-Pesa', icon: Smartphone, color: '#0FA06A', instructions: 'Go to M-Pesa > Lipa na M-Pesa > Pay Bill\nBusiness Number: 247247\nAccount: Your Invoice #' },
  { id: 'mtn', label: 'MTN Mobile Money', desc: 'Pay via MTN MoMo', icon: Smartphone, color: '#FFD2A6', instructions: 'Dial *165# > Pay Bill\nMerchant Code: TamamHealth\nReference: Your Invoice #' },
  { id: 'airtel', label: 'Airtel Money', desc: 'Pay via Airtel Money', icon: Smartphone, color: '#E03127', instructions: 'Dial *185# > Pay Bill\nBusiness Name: TamamHealth HEALTH\nReference: Your Invoice #' },
  { id: 'card', label: 'Visa / Mastercard', desc: 'Card payment (manually verified)', icon: CreditCard, color: '#1174b4', instructions: 'Enter your card details with our billing team, or provide a transaction reference. The charge is recorded here and verified by finance before it posts.' },
  // Literal hex (the --accent-primary value), not the CSS var — the icon
  // tint below concatenates a hex alpha suffix onto this string, which only
  // works for a hex literal.
  { id: 'bank', label: 'Bank Transfer', desc: 'Direct bank deposit', icon: Building2, color: 'var(--accent-primary)', instructions: resolveBankInstructions(bankDetails) },
];

export default function PatientPortalPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  // This is the assisted-collection portal (cashier/medical_biller only, see
  // role-routes.ts) — currentUser is the staff member running it, not the
  // patient, so their own org/facility must gate which bills this can see or
  // settle, the same as every other staff-facing billing screen.
  const scope = useDataScope();
  const [selectedBill, setSelectedBill] = useState<PortalBill | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentStep, setPaymentStep] = useState<'select' | 'method' | 'confirm' | 'success'>('select');
  const [copied, setCopied] = useState(false);
  // Persisting the payment (writing the PouchDB doc) before we can show the
  // success step — surface a spinner + a real error if the write fails.
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState('');
  const [completedReference, setCompletedReference] = useState('');

  // Bank-transfer instructions come from the org's configured bankDetails
  // (set on the org-admin branding page). Falls back to a "contact billing"
  // placeholder (or the demo example under IS_DEMO) when unset.
  const orgBankDetails = currentUser?.organization?.bankDetails;
  const PAYMENT_METHODS = useMemo(() => buildPaymentMethods(orgBankDetails), [orgBankDetails]);

  // Load real bills for the signed-in patient. Falls back to demo data when
  // the patient has no charges on file so the portal still has something
  // useful to show.
  const [realBills, setRealBills] = useState<PortalBill[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const patientId = (currentUser as { patientId?: string; _id?: string } | null)?.patientId
      || (currentUser as { _id?: string } | null)?._id;
    if (!patientId) { setRealBills([]); return; }
    (async () => {
      try {
        const { getBillsByPatient } = await import('@/lib/services/billing-service');
        const docs = await getBillsByPatient(patientId, scope);
        if (cancelled) return;
        const sorted = docs
          .map(fromBillingDoc)
          .sort((a, b) => b.date.localeCompare(a.date));
        setRealBills(sorted);
      } catch (err) {
        console.error('[PatientPortal] Failed to load bills', err);
        if (!cancelled) setRealBills([]);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser, scope]);

  // Use real bills when present; in demo mode fall back to canned invoices
  // so the portal still has something to show. In production we render an
  // empty state instead of fake bills.
  const usingDemo = IS_DEMO && (!realBills || realBills.length === 0);
  const bills: PortalBill[] = realBills && realBills.length > 0
    ? realBills
    : (IS_DEMO ? DEMO_BILLS : []);

  const totalOwed = bills.reduce((sum, b) => sum + (b.amount - b.paid), 0);
  const totalPaid = bills.reduce((sum, b) => sum + b.paid, 0);
  const unpaidBills = bills.filter(b => b.status !== 'paid');

  const handlePayBill = (bill: PortalBill) => {
    setSelectedBill(bill);
    setPaymentAmount(String(bill.amount - bill.paid));
    setPaymentStep('method');
    setPaymentMethod(null);
  };

  const handleConfirmPayment = () => {
    // Guard against zero / negative / non-numeric / over-balance amounts. The
    // input is a free-form number field — without this the patient could
    // submit a SSP 0 receipt or an amount larger than what's owed.
    const numericAmount = Number(paymentAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return;
    if (selectedBill && numericAmount > selectedBill.amount - selectedBill.paid + 0.001) return;
    setPaymentStep('confirm');
  };

  const handleCompletePayment = async () => {
    if (!selectedBill || !paymentMethod || completing) return;
    const numericAmount = Number(paymentAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setCompleteError('Enter a valid amount before continuing.');
      return;
    }
    if (!selectedBill.patientId) {
      setCompleteError('Unable to identify the patient for this bill — please reopen it from the bill list.');
      return;
    }

    setCompleting(true);
    setCompleteError('');
    try {
      // No live payment-gateway (Flutterwave/M-Pesa/Airtel) redirect or
      // webhook is wired up for this portal, so we can't claim the money has
      // actually arrived. Every method here writes a `pending` PaymentDoc —
      // the same shape/semantics the pay-by-link (`/api/checkout`) and
      // patient-token (`/api/patient-portal/payments`) routes already use —
      // and finance must approve it (Payments page → Pending verification)
      // before it posts. This mirrors those routes rather than calling
      // `collectPayment` (which posts immediately), since we have no
      // confirmation that funds actually moved.
      const { paymentsDB } = await import('@/lib/db');
      const db = paymentsDB();
      const now = new Date().toISOString();
      const uuid = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reference = `PORTAL-${uuid.slice(0, 8).toUpperCase()}`;

      const doc = {
        _id: `pmt-${uuid.slice(0, 10)}`,
        type: 'payment' as const,
        patientId: selectedBill.patientId,
        patientName: selectedBill.patientName || currentUser?.name || t('portal.patient'),
        method: METHOD_TO_PAYMENT_TYPE[paymentMethod],
        amount: numericAmount,
        currency: selectedBill.currency || 'SSP',
        reference,
        status: 'pending' as PaymentStatus,
        processedAt: now,
        processedBy: currentUser?._id || 'patient-portal',
        processedByName: currentUser?.name || 'Patient portal',
        notes: `[PATIENT_PORTAL] pending_verification — awaiting finance approval. Invoice ${selectedBill.id}.`,
        facilityId: selectedBill.facilityId || currentUser?.hospitalId || '',
        orgId: currentUser?.orgId,
        createdAt: now,
        updatedAt: now,
        createdBy: currentUser?._id || 'patient-portal',
      };

      const resp = await db.put(doc);

      const { logAuditSafe } = await import('@/lib/services/audit-service');
      await logAuditSafe(
        'PATIENT_SUBMIT_PAYMENT', doc.processedBy, doc.processedByName,
        `Portal payment ${doc._id} for ${doc.amount} ${doc.currency} from ${doc.patientName} (ref: ${reference}, pending finance approval)`
      );

      const { emitSyncEvent } = await import('@/lib/services/sync-event-service');
      emitSyncEvent({
        resourceType: 'payment',
        resourceId: doc._id,
        operation: 'create',
        resourceVersion: resp.rev,
        orgId: doc.orgId,
        hospitalId: doc.facilityId,
      });

      setCompletedReference(reference);
      setPaymentStep('success');
    } catch (err) {
      console.error('[PatientPortal] Failed to record payment', err);
      setCompleteError('Could not record the payment. Please try again.');
    } finally {
      setCompleting(false);
    }
  };

  const handleCopyRef = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const resetPayment = () => {
    setSelectedBill(null);
    setPaymentMethod(null);
    setPaymentAmount('');
    setPaymentStep('select');
    setCompleteError('');
    setCompletedReference('');
  };

  return (
    <>
      <main className="page-container page-enter">
      <div className="bl-root">

        {usingDemo && realBills !== null && <DemoModeBanner />}

        {/* ── Welcome + balance strip — plain, no gradient hero. Patient-facing
             surfaces follow the same "white panel, 1px border" rule as staff
             billing screens. ── */}
        <div className="bl-page-head">
          <div>
            <h1 className="bl-title">{t('portal.welcome', { name: currentUser?.name || t('portal.patient') })}</h1>
            <p className="bl-muted" style={{ margin: '2px 0 0', fontSize: 12.5 }}>{t('portal.welcomeSubtitle')}</p>
          </div>
        </div>

        <div className="bl-stats">
          <div>
            <span className="bl-stat-label">{t('billing.colBalanceDue')}</span>
            <span className={`bl-stat-value${totalOwed > 0 ? ' bl-stat-value--danger' : ' bl-stat-value--good'}`}>{formatMoney(totalOwed)}</span>
          </div>
          <div>
            <span className="bl-stat-label">{t('portal.totalPaid')}</span>
            <span className="bl-stat-value bl-stat-value--good">{formatMoney(totalPaid)}</span>
          </div>
        </div>

        {/* Main Content */}
        {paymentStep === 'select' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
            {/* Bills list */}
            <div className="bl-card" data-tour="portal-bills">
              <div className="bl-card-head">
                <h2 className="bl-card-title">{t('portal.yourBills')}</h2>
                <span className="bl-underline" />
              </div>
              {bills.length === 0 && realBills !== null ? (
                <div className="bl-empty">
                  <Receipt size={34} />
                  <h3>{t('portal.noBills')}</h3>
                </div>
              ) : (
                <div className="bl-table-wrap">
                  <table className="bl-table">
                    <thead>
                      <tr>
                        <th>Bill</th>
                        <th>Date</th>
                        <th className="bl-right">Amount</th>
                        <th>Status</th>
                        <th aria-label="Pay" />
                      </tr>
                    </thead>
                    <tbody>
                      {bills.map(bill => {
                        const remaining = bill.amount - bill.paid;
                        const isPaid = bill.status === 'paid';
                        return (
                          <tr key={bill.id}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{bill.description}</div>
                              <div className="bl-muted" style={{ fontSize: 11.5 }}>{bill.id}</div>
                            </td>
                            <td className="bl-muted" style={{ whiteSpace: 'nowrap' }}>
                              {new Date(bill.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                            <td className="bl-num bl-right">{formatMoney(bill.amount)}</td>
                            <td>
                              <span className={`bl-chip bl-chip--${bill.status}`}>
                                {isPaid ? t('portal.paid') : bill.status === 'partial' ? t('claims.status_partial') : t('portal.unpaid')}
                              </span>
                              {bill.status === 'partial' && (
                                <div className="bl-muted" style={{ fontSize: 11, marginTop: 3 }}>
                                  {t('portal.remaining', { amount: formatMoney(remaining) })}
                                </div>
                              )}
                            </td>
                            <td>
                              {!isPaid && (
                                <button type="button" className="bl-btn bl-btn--primary" onClick={() => handlePayBill(bill)}>
                                  {t('portal.pay')} <ArrowRight size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right sidebar — payment summary + quick pay */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Quick pay all */}
              {totalOwed > 0 && (
                <div className="bl-section">
                  <div className="bl-section-head" style={{ marginBottom: 4 }}>
                    <h2 className="bl-section-title">{t('portal.payOutstandingBalance')}</h2>
                  </div>
                  <p className="bl-muted" style={{ fontSize: 12, margin: '10px 0 16px' }}>
                    {unpaidBills.length > 1
                      ? t('portal.payAllBillsPlural', { count: unpaidBills.length })
                      : t('portal.payAllBills', { count: unpaidBills.length })}
                  </p>
                  <div style={{
                    background: 'var(--ehr-page-bg, #F5F8FB)', border: '1px solid var(--ehr-border, #E2E6EB)',
                    borderRadius: 6, padding: '14px 18px', textAlign: 'center', marginBottom: 16,
                  }}>
                    <span className="bl-stat-label">{t('portal.totalDue')}</span>
                    <span className="bl-stat-value" style={{ fontSize: 22 }}>{formatMoney(totalOwed)}</span>
                  </div>
                  <button
                    type="button"
                    className="bl-btn bl-btn--primary"
                    style={{ width: '100%' }}
                    onClick={() => {
                      // All bills in this portal session belong to the same
                      // patient (they came from one getBillsByPatient query),
                      // so any unpaid bill's identity fields are representative.
                      const rep = unpaidBills[0] || bills[0];
                      setSelectedBill({
                        id: 'ALL',
                        patientId: rep?.patientId || '',
                        patientName: rep?.patientName || '',
                        facilityId: rep?.facilityId,
                        currency: rep?.currency,
                        date: '', description: t('portal.allOutstandingBills'), amount: totalOwed, paid: 0, status: 'unpaid',
                      });
                      setPaymentAmount(String(totalOwed));
                      setPaymentStep('method');
                    }}
                  >
                    <Wallet size={16} /> {t('portal.payAllNow')}
                  </button>
                </div>
              )}

              {/* Accepted payment methods */}
              <div className="bl-section">
                <div className="bl-section-head">
                  <h2 className="bl-section-title">{t('portal.acceptedPaymentMethods')}</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {PAYMENT_METHODS.map(m => {
                    const Icon = m.icon;
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* globals.css force-strips `background`/`box-shadow` (both
                            !important) on any div/span whose only child is a lone
                            svg — an icon-wrapper reset. Wrapping the icon in a span
                            defeats that :has(>svg:only-child) match so this tint
                            survives; the span itself is a harmless no-op for layout. */}
                        <div style={{
                          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                          background: `${m.color}14`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {/* The Icon shim reads a `color` prop, not inherited CSS
                              color — a wrapping div's `color` style has no effect. */}
                          <span><Icon size={14} color={m.color} /></span>
                        </div>
                        <div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ehr-text-title, #113055)' }}>{m.label}</div>
                          <div className="bl-muted" style={{ fontSize: '0.625rem' }}>{m.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Security note */}
              <div className="bl-section" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Shield size={30} color="var(--ehr-muted, #5D728B)" style={{ flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ehr-text-title, #113055)' }}>{t('portal.securePayments')}</div>
                  <div className="bl-muted" style={{ fontSize: '0.625rem' }}>{t('portal.securePaymentsDesc')}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════ PAYMENT METHOD SELECTION ══════════════ */}
        {paymentStep === 'method' && selectedBill && (
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <button type="button" className="bl-btn bl-btn--link" onClick={resetPayment} style={{ marginBottom: 16, padding: '0 0 4px' }}>
              <ChevronLeft size={15} /> {t('portal.backToBills')}
            </button>

            {/* Bill summary */}
            <div className="bl-card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px' }}>
                <div>
                  <div className="bl-muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{selectedBill.id}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ehr-text-title, #113055)' }}>{selectedBill.description}</div>
                </div>
                <div style={{ textAlign: 'end' }}>
                  <span className="bl-stat-label">{t('portal.amountToPay')}</span>
                  <span className="bl-stat-value" style={{ fontSize: 20 }}>{formatMoney(Number(paymentAmount))}</span>
                </div>
              </div>
            </div>

            {/* Custom amount */}
            <div className="bl-card" style={{ marginBottom: 16, padding: '16px 20px' }}>
              <div className="bl-field">
                <label htmlFor="portal-amount">{t('portal.paymentAmountSsp')}</label>
                <input
                  id="portal-amount"
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  style={{ fontSize: 16, fontWeight: 700 }}
                />
              </div>
            </div>

            {/* Payment method cards — selection shown by border, not a fill,
                so the "no fills on surfaces" rule holds even mid-selection. */}
            <h3 className="bl-card-title" style={{ marginBottom: 12 }}>{t('portal.choosePaymentMethod')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {PAYMENT_METHODS.map(m => {
                const Icon = m.icon;
                const isSelected = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    className="bl-card"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 18px',
                      borderColor: isSelected ? m.color : undefined,
                      borderWidth: isSelected ? 2 : 1,
                      cursor: 'pointer', textAlign: 'start', width: '100%',
                    }}
                  >
                    {/* Icon wrapped in a span — see the globals.css note above. */}
                    <div style={{
                      width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                      background: `${m.color}14`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span><Icon size={16} color={m.color} /></span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--ehr-text-title, #113055)' }}>{m.label}</div>
                      <div className="bl-muted" style={{ fontSize: '0.6875rem' }}>{m.desc}</div>
                    </div>
                    {isSelected && (
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span><Check size={12} color="#fff" /></span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="bl-btn bl-btn--primary"
              style={{ width: '100%' }}
              onClick={handleConfirmPayment}
              disabled={!paymentMethod || !paymentAmount}
            >
              {t('portal.continueToPayment')}
            </button>
          </div>
        )}

        {/* ══════════════ PAYMENT CONFIRMATION ══════════════ */}
        {paymentStep === 'confirm' && selectedBill && paymentMethod && (
          <div style={{ maxWidth: 560, margin: '0 auto' }}>
            <button type="button" className="bl-btn bl-btn--link" onClick={() => setPaymentStep('method')} style={{ marginBottom: 16, padding: '0 0 4px' }}>
              <ChevronLeft size={15} /> {t('portal.backToMethodSelection')}
            </button>

            {(() => {
              const method = PAYMENT_METHODS.find(m => m.id === paymentMethod)!;
              const Icon = method.icon;
              return (
                <div className="bl-card">
                  {/* Header — plain surface; the method's colour lives only in
                      the small icon chip (the bl-home-icon convention), not a
                      full-width tint. */}
                  <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--ehr-border, #E2E6EB)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                        background: `${method.color}14`, // icon wrapped in a span — see globals.css note above
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span><Icon size={22} color={method.color} /></span>
                      </div>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ehr-text-title, #113055)' }}>{t('portal.payWith', { method: method.label })}</div>
                        <div className="bl-muted" style={{ fontSize: 12 }}>{method.desc}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', padding: '10px 0 2px' }}>
                      <span className="bl-stat-label">{t('portal.amount')}</span>
                      <span className="bl-stat-value" style={{ fontSize: 26 }}>{formatMoney(Number(paymentAmount))}</span>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div style={{ padding: '20px 24px' }}>
                    <h4 className="bl-card-title" style={{ marginBottom: 10 }}>{t('portal.paymentInstructions')}</h4>
                    <div style={{
                      background: 'var(--ehr-page-bg, #F5F8FB)', borderRadius: 6, padding: '14px 16px',
                      border: '1px solid var(--ehr-border, #E2E6EB)', marginBottom: 18,
                    }}>
                      {method.instructions.split('\n').map((line, i) => (
                        <div key={i} style={{
                          fontSize: 13, color: 'var(--ehr-text, #113055)', lineHeight: 1.8,
                          fontFamily: line.includes(':') ? 'var(--font-platform-mono)' : 'inherit',
                        }}>
                          {line}
                        </div>
                      ))}
                    </div>

                    {/* Reference to copy */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'var(--ehr-page-bg, #F5F8FB)', borderRadius: 6, padding: '10px 14px',
                      border: '1px solid var(--ehr-border, #E2E6EB)', marginBottom: 20,
                    }}>
                      <div>
                        <div className="bl-muted" style={{ fontSize: 11, marginBottom: 2 }}>{t('lab.reference')}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ehr-text-title, #113055)', fontFamily: 'var(--font-platform-mono)' }}>
                          {selectedBill.id}
                        </div>
                      </div>
                      <button type="button" className="bl-btn bl-btn--outline" onClick={() => handleCopyRef(selectedBill.id)} style={{ padding: '6px 12px', fontSize: 11.5 }}>
                        {copied ? <><Check size={12} /> {t('portal.copied')}</> : <><Copy size={12} /> {t('portal.copy')}</>}
                      </button>
                    </div>

                    {completeError && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'var(--ehr-panel, #fff)', border: '1px solid var(--color-danger, #D92B20)',
                        borderRadius: 6, padding: '10px 14px', marginBottom: 14,
                      }}>
                        <AlertCircle size={16} color="var(--color-danger, #D92B20)" style={{ flexShrink: 0 }} />
                        <span className="bl-danger" style={{ fontSize: 12.5 }}>{completeError}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      className="bl-btn bl-btn--primary"
                      style={{ width: '100%' }}
                      onClick={handleCompletePayment}
                      disabled={completing}
                    >
                      {completing && <Loader2 size={16} className="animate-spin" />}
                      {completing
                        ? 'Recording…'
                        : (paymentMethod === 'card' ? 'Record card payment (pending verification)' : t('portal.sentPayment'))}
                    </button>

                    <p className="bl-muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                      {t('portal.confirmTiming')}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══════════════ SUCCESS ══════════════ */}
        {paymentStep === 'success' && (
          <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
            <div className="bl-card" style={{ padding: '40px 36px' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', margin: '0 auto 18px',
                background: 'rgba(11, 133, 87, 0.10)', // icon wrapped in a span — see globals.css note above
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span><CheckCircle size={32} color="var(--color-success-text)" /></span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ehr-text-title, #113055)', margin: '0 0 8px' }}>
                {t('portal.paymentSubmitted')}
              </h2>
              <p className="bl-muted" style={{ fontSize: 13, margin: '0 0 22px', lineHeight: 1.6 }}>
                {t('portal.paymentSubmittedDescPre')}<strong>{formatMoney(Number(paymentAmount))}</strong>{t('portal.paymentSubmittedDescPost')}
              </p>

              <dl className="bl-totals" style={{
                background: 'var(--ehr-page-bg, #F5F8FB)', borderRadius: 6, padding: '14px 18px',
                marginBottom: 22, border: '1px solid var(--ehr-border, #E2E6EB)', textAlign: 'start',
              }}>
                <div className="bl-totals-row"><dt>{t('lab.reference')}</dt><dd style={{ fontFamily: 'var(--font-platform-mono)' }}>{selectedBill?.id}</dd></div>
                <div className="bl-totals-row"><dt>{t('portal.amount')}</dt><dd>{formatMoney(Number(paymentAmount))}</dd></div>
                <div className="bl-totals-row"><dt>{t('portal.method')}</dt><dd>{PAYMENT_METHODS.find(m => m.id === paymentMethod)?.label}</dd></div>
              </dl>

              <button type="button" className="bl-btn bl-btn--primary" onClick={resetPayment}>
                {t('portal.backToBillsBtn')}
              </button>
            </div>
          </div>
        )}

      </div>
      </main>
    </>
  );
}
