'use client';

import { useState, useEffect } from 'react';
import {
  CreditCard, Phone, Banknote,
  CheckCircle2,
  Receipt,
} from '@/components/icons/lucide';
import type { PatientDoc } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatMoney } from '@/lib/format-utils';
import { IS_DEMO, readPatientPortalSession, patientPortalFetch } from '@/lib/patient-portal-session';
import { shortDate, type ChipTone } from '@/components/patient-portal/shared';

/* ═════════════════════════════════════════
   BILLING & PAYMENTS TAB
   ═════════════════════════════════════════ */
// View model the UI renders against. We derive this from the real
// `BillingDoc` records in PouchDB rather than baking in a hardcoded array
// — the previous implementation rendered fake invoices ("B-2026-001"…)
// and the "Pay" flow returned a fake `TBN-…` reference without persisting
// anything, which was dishonest UX (the patient thought they had paid).
type BillItem = {
  id: string;          // The BillingDoc _id sent to the patient-portal payment API.
  invoiceNumber: string;
  date: string;
  description: string;
  department: string;
  amount: number;
  paid: number;
  /** Sliced from BillingDoc.status; 'overdue' is computed from dueDate. */
  status: 'paid' | 'partial' | 'unpaid' | 'overdue';
};

type UiPaymentMethod = 'mpesa' | 'mtn' | 'airtel' | 'card' | 'bank';

export function BillingTab({ patient, sessionToken }: { patient: PatientDoc; sessionToken: string }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'bills' | 'method' | 'confirm' | 'success'>('bills');
  const [selectedBills, setSelectedBills] = useState<string[]>([]);
  const [payMethod, setPayMethod] = useState<UiPaymentMethod | null>(null);
  const [payPhone, setPayPhone] = useState(patient.phone || '');

  // Real bill data, loaded from PouchDB. `null` = still loading; `[]` = no
  // bills on file. Distinguishing these lets us show a loading skeleton vs.
  // an empty-state card.
  const [bills, setBills] = useState<BillItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Org-configured bank-transfer instructions (set on the org-admin branding
  // page). When present we show the real details; otherwise we fall back to a
  // "contact billing" message rather than a hardcoded account number.
  const [bankDetails, setBankDetails] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!patient.orgId) { setBankDetails(null); return; }
    (async () => {
      try {
        const { getOrganizationById } = await import('@/lib/services/organization-service');
        const org = await getOrganizationById(patient.orgId!);
        if (!cancelled) setBankDetails(org?.bankDetails?.trim() || null);
      } catch (err) {
        console.error('[patient-portal/billing] org load failed', err);
        if (!cancelled) setBankDetails(null);
      }
    })();
    return () => { cancelled = true; };
  }, [patient.orgId]);

  // Last-payment metadata for the success screen — populated by the actual
  // recordPayment response so the reference shown is the one that ended up
  // in the bill's payments[] array.
  const [lastPayment, setLastPayment] = useState<{
    reference: string;
    amount: number;
    billCount: number;
    failedBillIds: string[];
  } | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // Derive the UI status from the underlying BillingDoc plus dueDate so the
  // patient sees "overdue" on bills past due, even when the doc itself just
  // says "pending".
  const deriveStatus = (
    docStatus: string,
    totalAmount: number,
    amountPaid: number,
    encounterDate: string,
  ): BillItem['status'] => {
    if (docStatus === 'paid' || amountPaid >= totalAmount) return 'paid';
    if (docStatus === 'partial' || (amountPaid > 0 && amountPaid < totalAmount)) return 'partial';
    // Treat anything older than 30 days with non-zero balance as 'overdue'
    // for display purposes. The model has no explicit dueDate field today.
    if (encounterDate) {
      const ageMs = Date.now() - new Date(encounterDate).getTime();
      if (ageMs > 30 * 24 * 60 * 60 * 1000) return 'overdue';
    }
    return 'unpaid';
  };

  useEffect(() => {
    let cancelled = false;
    setBills(null);
    setLoadError(null);
    (async () => {
      try {
        const session = readPatientPortalSession();
        if (!session) throw new Error('Missing patient session');
        const { bills: docs } = await patientPortalFetch<{ bills: Array<{
          _id: string;
          invoiceNumber?: string;
          encounterDate?: string;
          createdAt?: string;
          facilityName?: string;
          items?: Array<{ description: string; category: string }>;
          totalAmount: number;
          amountPaid: number;
          status: string;
        }> }>('/api/patient-portal/billing', session.token);
        if (cancelled) return;
        const mapped: BillItem[] = docs
          .map(d => ({
            id: d._id,
            invoiceNumber: d.invoiceNumber || d._id,
            date: (d.encounterDate || d.createdAt || '').slice(0, 10),
            description:
              (d.items && d.items.length > 0
                ? d.items.map(i => i.description).slice(0, 2).join(', ')
                : null) || t('patientPortal.visitAt', { facility: d.facilityName || t('patientPortal.facilityFallback') }),
            department:
              (d.items && d.items[0] ? d.items[0].category : 'Services').toString(),
            amount: d.totalAmount,
            paid: d.amountPaid,
            status: deriveStatus(d.status, d.totalAmount, d.amountPaid, d.encounterDate || d.createdAt || ''),
          }))
          .sort((a, b) => b.date.localeCompare(a.date));
        setBills(mapped);
      } catch (err) {
        console.error('[patient-portal/billing] load failed', err);
        if (!cancelled) {
          setBills([]);
          setLoadError(t('patientPortal.billsLoadError'));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [patient._id, t]);

  const safeBills = bills || [];
  const totalBilled = safeBills.reduce((s, b) => s + b.amount, 0);
  const totalOwed = safeBills.reduce((s, b) => s + (b.amount - b.paid), 0);
  const totalPaid = safeBills.reduce((s, b) => s + b.paid, 0);
  const totalOverdue = safeBills.filter(b => b.status === 'overdue').reduce((s, b) => s + (b.amount - b.paid), 0);
  const outstandingBills = safeBills.filter(b => b.amount - b.paid > 0);
  const selectedTotal = safeBills.filter(b => selectedBills.includes(b.id)).reduce((s, b) => s + (b.amount - b.paid), 0);

  const billChip = (s: BillItem['status']): { tone: ChipTone; label: string } => {
    switch (s) {
      case 'paid': return { tone: 'green', label: 'Paid' };
      case 'partial': return { tone: 'yellow', label: 'Partial' };
      case 'overdue': return { tone: 'red', label: t('patientPortal.overdue') };
      default: return { tone: 'blue', label: 'Unpaid' };
    }
  };

  const paymentMethods: { key: UiPaymentMethod; name: string; icon: typeof Phone; desc: string; color: string }[] = [
    { key: 'mpesa', name: 'M-Pesa', icon: Phone, desc: t('patientPortal.payViaMpesa'), color: '#0FA06A' },
    { key: 'mtn', name: 'MTN Mobile Money', icon: Phone, desc: t('patientPortal.payViaMtn'), color: '#FFD2A6' },
    { key: 'airtel', name: 'Airtel Money', icon: Phone, desc: t('patientPortal.payViaAirtel'), color: '#E03127' },
    { key: 'card', name: t('patientPortal.cardPayment'), icon: CreditCard, desc: t('patientPortal.payViaCard'), color: 'var(--accent-primary)' },
    { key: 'bank', name: t('patientPortal.bankTransfer'), icon: Banknote, desc: t('patientPortal.payViaBank'), color: 'var(--color-success-text)' },
  ];

  // Map the UI-level payment buttons onto the canonical PaymentMethod values
  // accepted by the patient-portal payment API.
  const toCanonicalMethod = (m: UiPaymentMethod): 'mobile_money' | 'bank_transfer' | 'cash' => {
    if (m === 'mpesa' || m === 'mtn' || m === 'airtel') return 'mobile_money';
    if (m === 'card' || m === 'bank') return 'bank_transfer';
    return 'cash';
  };

  // Submit a patient-entered payment for every selected bill. The server stores
  // these as pending finance review; this screen only reflects the submitted
  // intent, then refreshes billing from the server when possible.
  const submitPayment = async () => {
    if (!payMethod || paying) return;
    setPaying(true);
    setPayError(null);

    try {
      const canonicalMethod = toCanonicalMethod(payMethod);
      const referenceBase = `TBN-${Date.now().toString(36).toUpperCase()}`;
      if (!sessionToken) throw new Error('Missing patient session');

      const updates: Array<{ id: string; amount: number; ok: boolean }> = [];
      for (const billId of selectedBills) {
        const bill = safeBills.find(b => b.id === billId);
        if (!bill) continue;
        const remaining = bill.amount - bill.paid;
        if (remaining <= 0) continue;
        try {
          await patientPortalFetch<{ ok: boolean; id: string }>(
            '/api/patient-portal/payments',
            sessionToken,
            {
              method: 'POST',
              body: JSON.stringify({
                invoiceId: billId,
                amount: remaining,
                method: canonicalMethod,
                reference: referenceBase,
                mobileMoneyPhone: payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel'
                  ? payPhone
                  : undefined,
                notes: payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel'
                  ? `Patient portal — ${payMethod} from ${payPhone}`
                  : `Patient portal — ${payMethod}`,
              }),
            }
          );
          updates.push({ id: billId, amount: remaining, ok: true });
        } catch {
          updates.push({ id: billId, amount: remaining, ok: false });
        }
      }

      const failed = updates.filter(u => !u.ok);
      const paidTotal = updates.filter(u => u.ok).reduce((s, u) => s + u.amount, 0);

      if (updates.length === 0 || updates.every(u => !u.ok)) {
        setPayError(t('patientPortal.paymentRecordError'));
        setPaying(false);
        return;
      }

      // Refresh the in-memory bills list from the source of truth so the UI
      // reflects the new amountPaid / balanceDue / status.
      try {
        const { bills: docs } = await patientPortalFetch<{ bills: Array<{
          _id: string;
          invoiceNumber?: string;
          encounterDate?: string;
          createdAt?: string;
          facilityName?: string;
          items?: Array<{ description: string; category: string }>;
          totalAmount: number;
          amountPaid: number;
          status: string;
        }> }>('/api/patient-portal/billing', sessionToken);
        setBills(docs
          .map(d => ({
            id: d._id,
            invoiceNumber: d.invoiceNumber || d._id,
            date: (d.encounterDate || d.createdAt || '').slice(0, 10),
            description:
              (d.items && d.items.length > 0
                ? d.items.map(i => i.description).slice(0, 2).join(', ')
                : null) || t('patientPortal.visitAt', { facility: d.facilityName || t('patientPortal.facilityFallback') }),
            department: (d.items && d.items[0] ? d.items[0].category : 'Services').toString(),
            amount: d.totalAmount,
            paid: d.amountPaid,
            status: deriveStatus(d.status, d.totalAmount, d.amountPaid, d.encounterDate || d.createdAt || ''),
          }))
          .sort((a, b) => b.date.localeCompare(a.date)));
      } catch { /* refresh is best-effort; the success screen still renders */ }

      setLastPayment({
        reference: referenceBase,
        amount: paidTotal,
        billCount: updates.filter(u => u.ok).length,
        failedBillIds: failed.map(f => f.id),
      });
      setStep('success');
    } catch (err) {
      console.error('[patient-portal/billing] payment failed', err);
      setPayError(t('patientPortal.paymentGenericError'));
    } finally {
      setPaying(false);
    }
  };

  if (step === 'success') {
    const refNum = lastPayment?.reference || '';
    const paidAmount = lastPayment?.amount ?? 0;
    const billCount = lastPayment?.billCount ?? 0;
    const failedCount = lastPayment?.failedBillIds.length ?? 0;
    return (
      <div className="pp-narrow" style={{ textAlign: 'center' }}>
        <div className="pp-card" style={{ padding: '36px 28px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--color-success-bg)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: 'var(--color-success-text)' }}>
            <CheckCircle2 size={30} />
          </div>
          <h3 style={{ margin: '0 0 6px', fontFamily: 'var(--font-condensed)', fontSize: 19, fontWeight: 600, color: 'var(--text-primary)' }}>{t('patientPortal.paymentRecorded')}</h3>
          <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
            {payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel'
              ? t('patientPortal.successMobilePrompt')
              : payMethod === 'card'
              ? t('patientPortal.successCardRedirect')
              : t('patientPortal.successBankTransfer')}
          </p>
          {failedCount > 0 && (
            <div style={{ padding: 10, borderRadius: 8, marginBottom: 14, background: 'rgba(158, 27, 20,0.06)', border: '1px solid rgba(158, 27, 20,0.3)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-danger-text)', fontWeight: 600 }}>
                {t('patientPortal.billsNotUpdated', { count: failedCount })}
              </p>
            </div>
          )}
          <div className="pp-row-detail-box" style={{ textAlign: 'start', marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              <div><p className="pp-field-label">{t('patientPortal.reference')}</p><p className="pp-field-value" style={{ fontFamily: 'var(--font-platform-mono)', fontWeight: 600 }}>{refNum}</p></div>
              <div><p className="pp-field-label">{t('portal.amount')}</p><p className="pp-field-value" style={{ fontWeight: 600 }}>{formatMoney(paidAmount)}</p></div>
              <div><p className="pp-field-label">{t('portal.method')}</p><p className="pp-field-value">{paymentMethods.find(m => m.key === payMethod)?.name}</p></div>
              <div><p className="pp-field-label">{t('patientPortal.bills')}</p><p className="pp-field-value">{t('patientPortal.itemCount', { count: billCount })}</p></div>
            </div>
            {payMethod === 'bank' && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
                <p style={{ margin: '0 0 6px', fontFamily: 'var(--font-condensed)', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-success-text)' }}>{t('patientPortal.bankTransferDetails')}</p>
                {bankDetails ? (
                  <>
                    {bankDetails.split('\n').map((line, i) => (
                      <p key={i} style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>{line}</p>
                    ))}
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.refLabel')} <strong>{refNum}</strong></p>
                  </>
                ) : IS_DEMO ? (
                  <>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.bankLabel')} <strong>KCB Bank South Sudan</strong></p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.accountLabel')} <strong>720-184-2930</strong></p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.nameLabel')} <strong>TamamHealth Health Services</strong></p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.refLabel')} <strong>{refNum}</strong></p>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)' }}>{t('patientPortal.bankTransferContactBilling')}</p>
                )}
              </div>
            )}
          </div>
          <button type="button" className="pp-btn pp-btn-primary" onClick={() => { setStep('bills'); setSelectedBills([]); setPayMethod(null); setLastPayment(null); }}>{t('patientPortal.done')}</button>
        </div>
      </div>
    );
  }

  if (step === 'confirm') {
    const method = paymentMethods.find(m => m.key === payMethod)!;
    return (
      <div className="pp-narrow">
        <button type="button" className="pp-back-link" onClick={() => setStep('method')}>← {t('action.back')}</button>
        <div className="pp-card" style={{ padding: 18 }}>
          <h3 style={{ margin: '0 0 14px', fontFamily: 'var(--font-condensed)', fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{t('patientPortal.confirmPayment')}</h3>
          <div className="pp-row-detail-box" style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
              <div><p className="pp-field-label">{t('patientPortal.totalAmount')}</p><p className="pp-field-value" style={{ fontWeight: 600 }}>{formatMoney(selectedTotal)}</p></div>
              <div><p className="pp-field-label">{t('patientPortal.paymentMethod')}</p><p className="pp-field-value">{method.name}</p></div>
              <div><p className="pp-field-label">{t('patientPortal.items')}</p><p className="pp-field-value">{t('patientPortal.billCount', { count: selectedBills.length })}</p></div>
              {(payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
                <div><p className="pp-field-label">{t('patient.phone')}</p><p className="pp-field-value">{payPhone}</p></div>
              )}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <p className="pp-field-label" style={{ margin: '0 0 6px' }}>{t('patientPortal.billsIncluded')}</p>
            {safeBills.filter(b => selectedBills.includes(b.id)).map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-light)' }}>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{b.description}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(b.amount - b.paid)}</span>
              </div>
            ))}
          </div>
          {(payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--color-info-bg)', border: '1px solid var(--color-info-border)', marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-primary)', fontWeight: 600 }}>{t('patientPortal.paymentPromptNotice', { phone: payPhone })}</p>
            </div>
          )}
          {payError && (
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(158, 27, 20,0.06)', border: '1px solid rgba(158, 27, 20,0.3)', marginBottom: 14 }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-danger-text)', fontWeight: 600 }}>{payError}</p>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="pp-btn pp-btn-secondary" style={{ flex: 1 }} onClick={() => setStep('method')} disabled={paying}>{t('action.cancel')}</button>
            <button type="button" className="pp-btn pp-btn-primary" style={{ flex: 1 }} onClick={() => { void submitPayment(); }} disabled={paying}>
              {paying ? t('patientPortal.recording') : t('patientPortal.payAmount', { amount: `${selectedTotal.toLocaleString()} SSP` })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'method') {
    return (
      <div className="pp-narrow">
        <button type="button" className="pp-back-link" onClick={() => setStep('bills')}>← {t('portal.backToBillsBtn')}</button>
        <div className="pp-card" style={{ padding: 18 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-condensed)', fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{t('portal.choosePaymentMethod')}</h3>
          <p style={{ margin: '4px 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>{t('patientPortal.totalLabel')} <strong style={{ color: 'var(--text-primary)' }}>{formatMoney(selectedTotal)}</strong> {t('patientPortal.forBills', { count: selectedBills.length })}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {paymentMethods.map(m => {
              const on = payMethod === m.key;
              return (
                <button key={m.key} type="button" onClick={() => setPayMethod(m.key)} style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 14px',
                  borderRadius: 8, border: on ? '1px solid var(--accent-primary)' : '1px solid var(--border-light)',
                  boxShadow: on ? 'inset 0 0 0 1px var(--accent-primary)' : 'none',
                  background: on ? 'var(--color-info-bg)' : 'var(--bg-card-solid)',
                  cursor: 'pointer', textAlign: 'start', fontFamily: 'var(--font-platform)',
                }}>
                  <span style={{ width: 34, height: 34, borderRadius: 8, background: `color-mix(in srgb, ${m.color} 12%, transparent)`, display: 'grid', placeItems: 'center', flexShrink: 0, color: m.color }}>
                    <m.icon size={16} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{m.name}</b>
                    <small style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)' }}>{m.desc}</small>
                  </span>
                  {on && <CheckCircle2 size={18} color="var(--accent-primary)" />}
                </button>
              );
            })}
          </div>
          {payMethod && (payMethod === 'mpesa' || payMethod === 'mtn' || payMethod === 'airtel') && (
            <div style={{ marginBottom: 16 }}>
              <p className="pp-field-label" style={{ margin: '0 0 4px' }}>{t('patientPortal.phoneNumber')}</p>
              <input type="tel" value={payPhone} onChange={e => setPayPhone(e.target.value)} placeholder={t('patientPortal.payPhonePlaceholder')}
                style={{ width: '100%', height: 38, padding: '0 13px', borderRadius: 8, border: '1px solid var(--border-light)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'var(--font-platform)' }} />
            </div>
          )}
          <button type="button" className="pp-btn pp-btn-primary" style={{ width: '100%' }} onClick={() => payMethod && setStep('confirm')} disabled={!payMethod}>
            {t('patientPortal.continueToConfirm')}
          </button>
        </div>
      </div>
    );
  }

  /* Bills list (default step) */
  const isLoading = bills === null;

  const header = (
    <div className="pp-head">
      <div>
        <h1>{t('patientPortal.tabBilling')}</h1>
        <p className="pp-head-note">Bills from your visits, and how to pay them.</p>
      </div>
    </div>
  );

  // Loading skeleton — keeps the page visually quiet until the PouchDB query
  // resolves, instead of flashing an empty state.
  if (isLoading) {
    return (
      <div>
        {header}
        <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('patientPortal.loadingBills')}</p>
        </div>
      </div>
    );
  }

  // Hard-error state (PouchDB query threw). Loadable but useless without
  // the data, so we surface this rather than pretending all bills are
  // settled.
  if (loadError && safeBills.length === 0) {
    return (
      <div>
        {header}
        <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
          <Receipt size={44} style={{ color: 'var(--color-danger-text)', opacity: 0.6, margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{loadError}</p>
        </div>
      </div>
    );
  }

  // Friendly empty state — distinguishes "no bills on file" from a load
  // error, so a brand-new patient doesn't see scary copy.
  if (safeBills.length === 0) {
    return (
      <div>
        {header}
        <div className="pp-card" style={{ textAlign: 'center', padding: 40 }}>
          <Receipt size={44} style={{ color: '#94A2B3', opacity: 0.5, margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>{t('patientPortal.noBillsOnFile')}</p>
        </div>
      </div>
    );
  }

  const stats = [
    { label: t('patientPortal.totalBilled'), value: formatMoney(totalBilled), color: 'var(--text-primary)' },
    { label: t('portal.totalPaid'), value: formatMoney(totalPaid), color: 'var(--color-success-text)' },
    { label: t('patientPortal.outstanding'), value: formatMoney(totalOwed), color: totalOwed > 0 ? 'var(--color-warning-text)' : 'var(--text-primary)' },
    { label: t('patientPortal.overdue'), value: formatMoney(totalOverdue), color: totalOverdue > 0 ? 'var(--color-danger-text)' : 'var(--text-primary)' },
  ];

  return (
    <div>
      {header}

      <div className="pp-tiles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        {stats.map(s => (
          <div key={s.label} className="pp-tile">
            <p className="pp-tile-label">{s.label}</p>
            <p className="pp-tile-value" style={{ fontSize: 20, color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="pp-grid2">
        {/* Bills */}
        <div className="pp-card">
          <div className="pp-card-head"><h2>{t('portal.yourBills')}</h2></div>
          {safeBills.map(bill => {
            const remaining = bill.amount - bill.paid;
            const chip = billChip(bill.status);
            return (
              <div key={bill.id} className="pp-row">
                <div className="pp-row-main">
                  <b style={{ fontSize: 13 }}>{bill.description}</b>
                  <span style={{ fontSize: 11.5 }}>{bill.department} · {shortDate(bill.date)}{bill.status === 'partial' ? ` · ${formatMoney(bill.paid)} paid` : ''}</span>
                </div>
                <span style={{ flex: 'none', fontFamily: 'var(--font-condensed)', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
                  {formatMoney(remaining > 0 ? remaining : bill.amount)}
                </span>
                {remaining > 0 && bill.status !== 'unpaid' && (
                  <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                )}
                {remaining > 0 ? (
                  <button type="button" className="pp-row-pay"
                    onClick={() => { setSelectedBills([bill.id]); setStep('method'); }}>
                    Pay
                  </button>
                ) : (
                  <span className={`pp-chip pp-chip--${chip.tone}`}>{chip.label}</span>
                )}
              </div>
            );
          })}
          {outstandingBills.length > 1 && (
            <button type="button" className="pp-card-foot"
              onClick={() => { setSelectedBills(outstandingBills.map(b => b.id)); setStep('method'); }}>
              Pay all outstanding — {formatMoney(totalOwed)} ›
            </button>
          )}
        </div>

        {/* Accepted payment methods */}
        <div className="pp-card" style={{ alignSelf: 'start' }}>
          <div className="pp-card-head"><h2>{t('portal.acceptedPaymentMethods')}</h2></div>
          {paymentMethods.map(m => (
            <div key={m.key} className="pp-row">
              <span style={{ flex: 'none', width: 34, height: 34, display: 'grid', placeItems: 'center', background: 'var(--color-info-bg)', borderRadius: 8, color: 'var(--accent-text)' }}>
                <m.icon size={16} strokeWidth={1.7} />
              </span>
              <div className="pp-row-main">
                <b style={{ fontSize: 13 }}>{m.name}</b>
                <span style={{ fontSize: 11.5 }}>{m.desc}</span>
              </div>
            </div>
          ))}
          <div style={{ padding: '10px 14px' }}>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--ehr-muted)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-muted)' }}>{t('patientPortal.needHelpLabel')}</strong> {t('patientPortal.needHelpBody')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
