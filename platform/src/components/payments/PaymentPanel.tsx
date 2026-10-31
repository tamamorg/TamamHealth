'use client';

import { defaultCurrency } from '@/lib/country/country-pack';
import { useState, useEffect } from 'react';
import { Banknote, Smartphone, CreditCard, Building2, Shield, CheckCircle2, Loader2, Printer, Mail } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useSettings } from '@/lib/settings/SettingsProvider';
import { getRoleChoice } from '@/lib/settings/role-settings-store';
import { PAYOR_LABELS, type PaymentMethodKey } from '@/lib/settings/facility-settings';
import FormSlider from '@/components/overlay/FormSlider';
import { formatMoney } from '@/lib/format-utils';
import type { PaymentDoc } from '@/lib/db-types-payments';
import '@/components/billing/billing.css';
import Select from '@/components/Select';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { FormError } from '@/components/overlay/FormNotices';

interface PaymentPanelProps {
  patientId: string;
  patientName: string;
  /** Printed on the receipt as the patient's ID, in place of the record id. */
  hospitalNumber?: string;
  encounterId?: string;
  /** The billing line this is taken against, so the payment lands on it. */
  allocation?: { encounterId?: string; chargeId?: string };
  amountDue: number;
  currency?: string;
  onSuccess: (paymentId: string) => void;
  onCancel: () => void;
}

type TabType = 'cash' | 'mobile' | 'card' | 'bank' | 'insurance';

/** The settings row's label vocabulary → this panel's tabs. */
const PAYMENT_TAB_BY_CHOICE: Record<string, TabType> = {
  'Cash': 'cash',
  'Mobile money': 'mobile',
  'Insurance': 'insurance',
};

function defaultPaymentTab(): TabType {
  return PAYMENT_TAB_BY_CHOICE[getRoleChoice('pay.method', '')] ?? 'cash';
}

export default function PaymentPanel({
  patientId, patientName, hospitalNumber, encounterId, allocation, amountDue, currency = defaultCurrency(), onSuccess, onCancel
}: PaymentPanelProps) {
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { t } = useTranslation();
  const settings = useSettings();
  // Opens on the desk's own "Default payment method" (`pay.method`) — the most
  // common method at this window, so the usual case needs no extra click.
  const [tab, setTab] = useState<TabType>(defaultPaymentTab);
  const [amount, setAmount] = useState(amountDue > 0 ? amountDue.toString() : '');

  // Self-load balance if amountDue wasn't provided
  useEffect(() => {
    if (amountDue > 0 || !scope) return;
    (async () => {
      try {
        const { getPatientBalance } = await import('@/lib/services/ledger-service');
        const bal = await getPatientBalance(patientId, scope);
        if (bal > 0) setAmount(bal.toString());
      } catch { /* offline fallback */ }
    })();
  }, [patientId, amountDue, scope]);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      try {
        const { getPatientById } = await import('@/lib/services/patient-service');
        const patient = await getPatientById(patientId, scope);
        if (!cancelled) setEmailAddress((patient?.email || '').trim());
      } catch { /* leave empty: sending stays disabled with the note */ }
      finally { if (!cancelled) setEmailLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, [patientId, scope]);

  const [notes, setNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [paymentDoc, setPaymentDoc] = useState<PaymentDoc | null>(null);
  // The recipient is the patient's email on file and nothing else: the server
  // refuses any other address, so it is shown read-only rather than editable.
  const [emailAddress, setEmailAddress] = useState('');
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [showEmailInput, setShowEmailInput] = useState(false);

  // Cash fields
  const [receiptNumber, setReceiptNumber] = useState('');

  // Mobile Money fields
  const [mobileProvider, setMobileProvider] = useState<'mpesa' | 'airtel' | 'mtn_momo'>('mpesa');
  const [phone, setPhone] = useState('');
  const [mobileReference, setMobileReference] = useState('');

  // Card fields
  const [cardLast4, setCardLast4] = useState('');
  const [authCode, setAuthCode] = useState('');

  // Bank Transfer fields
  const [bankName, setBankName] = useState('');
  const [transferReference, setTransferReference] = useState('');
  const [transferDate, setTransferDate] = useState('');

  // Insurance / Waiver fields
  const [insuranceWaiverMode, setInsuranceWaiverMode] = useState<'insurance' | 'waiver'>('insurance');
  const [payerName, setPayerName] = useState('');
  const [claimReference, setClaimReference] = useState('');
  const [waiverReason, setWaiverReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');

  // Concrete payment methods are gated by the facility's enabled methods
  // (set in Facility Settings). The insurance/waiver path is always available
  // since it's a payor/exemption flow, not a tender type.
  const tabMethod: Record<TabType, PaymentMethodKey | null> = {
    cash: 'cash', mobile: 'mobile_money', card: 'card', bank: 'bank_transfer', insurance: null,
  };
  const allTabs: { key: TabType; label: string; icon: typeof Banknote }[] = [
    { key: 'cash', label: t('payments.methodCash'), icon: Banknote },
    { key: 'mobile', label: t('payments.methodMobileMoney'), icon: Smartphone },
    { key: 'card', label: t('payments.methodCard'), icon: CreditCard },
    { key: 'bank', label: t('payments.methodBankTransfer'), icon: Building2 },
    { key: 'insurance', label: t('payments.methodInsuranceWaiver'), icon: Shield },
  ];
  const tabs = allTabs.filter(tb => {
    const m = tabMethod[tb.key];
    return m === null || settings.paymentMethods.includes(m);
  });
  // If the active tab was disabled in settings, fall back to the first enabled.
  useEffect(() => {
    if (tabs.length && !tabs.some(tb => tb.key === tab)) setTab(tabs[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.paymentMethods]);

  const handleSubmit = async () => {
    const numAmount = parseFloat(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0) {
      setError(t('payments.errorValidAmount'));
      return;
    }

    // Validate tab-specific required fields
    if (tab === 'mobile' && !phone) {
      setError(t('payments.errorPhoneRequired'));
      return;
    }
    if (tab === 'mobile' && !mobileReference) {
      setError(t('payments.errorTransactionRefRequired'));
      return;
    }
    if (tab === 'card' && !cardLast4) {
      setError(t('payments.errorLast4Required'));
      return;
    }
    if (tab === 'bank' && !bankName) {
      setError(t('payments.errorBankNameRequired'));
      return;
    }
    if (tab === 'bank' && !transferReference) {
      setError(t('payments.errorTransferRefRequired'));
      return;
    }
    if (tab === 'bank' && !transferDate) {
      setError(t('payments.errorTransferDateRequired'));
      return;
    }
    if (tab === 'insurance' && !payerName) {
      setError(t('payments.errorPayerNameRequired'));
      return;
    }
    if (tab === 'insurance' && !claimReference) {
      setError(t('payments.errorClaimRefRequired'));
      return;
    }
    if (tab === 'insurance' && insuranceWaiverMode === 'waiver' && !waiverReason) {
      setError(t('payments.errorWaiverReasonRequired'));
      return;
    }
    if (tab === 'insurance' && insuranceWaiverMode === 'waiver' && !approvedBy) {
      setError(t('payments.errorApprovedByRequired'));
      return;
    }

    setProcessing(true);
    setError('');

    try {
      const { collectPayment } = await import('@/lib/services/payment-service');

      // Determine method and reference based on tab
      let method: 'cash' | 'mpesa' | 'airtel' | 'mtn_momo' | 'card' | 'bank_transfer' | 'waiver' | 'insurance';
      let reference: string | undefined;
      let mobileMoneyPhone: string | undefined;
      let cardLast4Digits: string | undefined;

      if (tab === 'cash') {
        method = 'cash';
        reference = receiptNumber || undefined;
      } else if (tab === 'mobile') {
        method = mobileProvider;
        reference = mobileReference;
        mobileMoneyPhone = phone;
      } else if (tab === 'card') {
        method = 'card';
        reference = authCode;
        cardLast4Digits = cardLast4;
      } else if (tab === 'bank') {
        method = 'bank_transfer';
        reference = `${bankName}:${transferReference}:${transferDate}`;
      } else {
        // Insurance/Waiver
        method = insuranceWaiverMode === 'insurance' ? 'insurance' : 'waiver';
        reference = insuranceWaiverMode === 'insurance' ? claimReference : waiverReason;
      }

      const pmt = await collectPayment({
        patientId,
        patientName,
        encounterId,
        method,
        amount: numAmount,
        currency,
        reference,
        mobileMoneyPhone,
        cardLast4: cardLast4Digits,
        allocations: allocation ? [{ encounterId: allocation.encounterId ?? '', chargeId: allocation.chargeId, amount: numAmount }] : undefined,
        notes: notes || undefined,
        processedBy: currentUser?._id || 'system',
        processedByName: currentUser ? currentUser.name : 'System',
        facilityId: currentUser?.hospitalId || '',
        orgId: currentUser?.orgId,
      });

      setPaymentDoc(pmt);
      setSuccess(true);
    } catch (err) {
      setError(t('payments.errorPaymentFailed'));
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const handlePrint = async () => {
    if (!paymentDoc) return;
    const { buildReceiptData, printReceipt } = await import('@/lib/services/receipt-service');
    const receipt = buildReceiptData(paymentDoc, currentUser?.hospital?.name || currentUser?.hospitalName, hospitalNumber);
    printReceipt(receipt);
  };

  const handleEmailReceipt = async () => {
    if (!paymentDoc || !emailAddress) return;
    setEmailSending(true);
    setEmailError(null);
    try {
      const { buildReceiptData, sendReceiptEmail } = await import('@/lib/services/receipt-service');
      const receipt = buildReceiptData(paymentDoc, currentUser?.hospital?.name || currentUser?.hospitalName, hospitalNumber);
      // sendReceiptEmail returns the API's honest `delivered` flag — only claim
      // "Sent" when the provider actually accepted the email.
      const result = await sendReceiptEmail(receipt, emailAddress, paymentDoc._id);
      if (result.delivered) {
        setEmailSent(true);
      } else {
        setEmailError(t(
          result.failure === 'forbidden' ? 'payments.emailErrForbidden'
          : result.failure === 'no_email' ? 'payments.emailErrNoEmail'
          : result.failure === 'rate_limited' ? 'payments.emailErrRateLimited'
          : result.failure === 'not_found' ? 'payments.emailErrNotFound'
          : 'payments.emailErrFailed',
        ));
      }
    } catch (err) {
      console.error(err);
      setEmailError(t('payments.emailErrFailed'));
    } finally {
      setEmailSending(false);
    }
  };

  if (success && paymentDoc) {
    const close = () => onSuccess(paymentDoc._id);
    return (
      <FormSlider
        title={t('payments.paymentRecorded')}
        subtitle={patientName}
        width={560}
        onClose={close}
        disableBackdropClose
        footer={<button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={close}>{t('payments.done')}</button>}
      >
        <div className="bl-root bl-receipt">
          <div className="bl-receipt-hero">
            <CheckCircle2 size={28} aria-hidden="true" />
            <strong>{formatMoney(parseFloat(amount), { currency })}</strong>
          </div>
          <dl className="bl-totals">
            {[
              { label: t('payments.receiptNumberLabel'), value: paymentDoc.reference || paymentDoc._id },
              { label: t('payments.dateLabel'), value: new Date(paymentDoc.processedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
              { label: t('payments.methodLabel'), value: tab === 'cash' ? t('payments.methodCash') : tab === 'mobile' ? (mobileProvider === 'mpesa' ? t('payments.methodMpesa') : mobileProvider === 'airtel' ? t('payments.methodAirtelMoney') : t('payments.methodMtnMomo')) : tab === 'card' ? t('payments.methodCard') : tab === 'bank' ? t('payments.methodBankTransfer') : insuranceWaiverMode === 'insurance' ? t('billing.insurance') : t('payments.methodWaiver') },
              { label: t('payments.processedByLabel'), value: paymentDoc.processedByName },
            ].map(row => <div key={row.label} className="bl-totals-row"><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
          </dl>
          <div className="bl-receipt-actions">
            <button type="button" className="bl-btn bl-btn--outline" onClick={handlePrint}>
              <Printer size={14} /> {t('payments.printReceipt')}
            </button>
            <button type="button" className="bl-btn bl-btn--outline" onClick={() => setShowEmailInput(!showEmailInput)}>
              <Mail size={14} /> {emailSent ? t('payments.sent') : t('payments.emailReceipt')}
            </button>
          </div>
          {showEmailInput && !emailSent && (
            <div className="bl-field bl-receipt-email">
              <input type="email" value={emailAddress} readOnly aria-label={t('payments.emailOnFile')}
                placeholder={emailLoaded ? t('payments.noPatientEmail') : ''}
              />
              <button type="button" className="bl-btn bl-btn--primary" disabled={emailSending || !emailAddress} onClick={handleEmailReceipt}>
                {emailSending ? t('payments.sending') : t('payments.send')}
              </button>
            </div>
          )}
          {showEmailInput && !emailSent && emailLoaded && !emailAddress && <p className="bl-muted bl-receipt-note">{t('payments.noPatientEmailNote')}</p>}
          {emailSent && <p className="bl-muted bl-receipt-note">{t('payments.receiptSentTo', { email: emailAddress })}</p>}
          {emailError && !emailSent && <p className="bl-danger bl-receipt-note">{emailError}</p>}
        </div>
      </FormSlider>
    );
  }

  return (
    <FormSlider
      title={t('billing.collectPayment')}
      subtitle={patientName}
      width={560}
      onClose={onCancel}
      footer={<>
          <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel}>{t('action.cancel')}</button>
          <button type="button" className="btn btn-primary" style={{ flex: 2 }} disabled={processing || !Number.isFinite(Number(amount)) || Number(amount) <= 0} onClick={handleSubmit}>
            {processing ? <><Loader2 size={14} className="animate-spin" /> {t('payments.processing')}</> : t('payments.recordAmount', { amount: (Number.isFinite(Number(amount)) ? Number(amount) : 0).toLocaleString(), currency })}
          </button>
      </>}
    >
      <div className="bl-root">
        {/* Scoped field styling. It sits after the header so the header
            stays the panel's first child — the popup header bar is matched
            structurally, and a leading <style> node displaced it. */}
        <style>{`
          .pp-pay input:not([type=checkbox]):not([type=radio]), .pp-pay select, .pp-pay textarea {
            width:100% !important; padding:11px 13px !important; border-radius:10px !important;
            border:1px solid var(--border-light) !important; background:var(--bg-card, #FFFFFF) !important;
            color:var(--text-primary) !important; font-size:14px !important;
            transition:border-color .15s, box-shadow .15s !important;
          }
          .pp-pay select { -webkit-appearance:none; appearance:none; background-image:none; }
          .pp-pay input:focus, .pp-pay select:focus, .pp-pay textarea:focus {
            outline:none !important; border-color:var(--accent-primary) !important;
            box-shadow:0 0 0 3px var(--accent-light) !important;
          }
          .pp-pay label { font-size:11px !important; font-weight:700 !important; letter-spacing:.03em; text-transform:uppercase; color:var(--text-muted) !important; }
          .pp-pay .pp-field-label { font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--text-muted); margin-bottom:8px; display:block; }
          /* The method chooser. Full width so it lines up with the amount and
             the fields under it, and sized like the panel's other inputs. */
          .pp-pay .pp-method-select {
            width:100%; min-height:42px; padding:0 12px; font-size:14px; font-weight:600;
            color:var(--text-primary); background:var(--bg-card, #FFFFFF);
            border:1px solid var(--border-light); border-radius:10px; cursor:pointer;
          }
          .pp-pay .pp-method-select:focus-visible { outline:2px solid var(--accent-primary); outline-offset:1px; }
        `}</style>

        {/* Amount hero — flat panel, no gradient wash: the figure itself is
            the emphasis, matching the billing module's plain label-above-
            value stat treatment. */}
        <div style={{ padding: '18px var(--dialog-gutter)', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-text)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('payments.amountDueLabel')}</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--accent-text)', letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{formatMoney(amountDue, { currency })}</div>
        </div>

        <div style={{ padding: '16px var(--dialog-gutter) 4px' }}>
          <div className="pp-payment-choices" role="group" aria-label={t('payments.methodLabel')}>
            {tabs.map(item => <button key={item.key} type="button" disabled={processing} aria-pressed={tab === item.key} onClick={() => setTab(item.key as TabType)}>
              <item.icon size={20} /><span>{item.label}</span>
            </button>)}
          </div>
          <p className="pp-payment-guidance">{t(`payments.steps.${tab === 'insurance' ? insuranceWaiverMode : tab}`)}</p>
        </div>

        {/* Form */}
        <div className="ehr-finance-dialog__body" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Amount */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.amountWithCurrency', { currency })}</label>
            <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 16, fontWeight: 600, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            />
          </div>

          {/* Tab-specific fields */}
          {tab === 'cash' && (
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.receiptNumberOptional')}</label>
              <input type="text" value={receiptNumber} onChange={e => setReceiptNumber(e.target.value)} placeholder={t('payments.receiptNumberPlaceholder')}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              />
            </div>
          )}

          {tab === 'mobile' && (
            <>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.provider')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['mpesa', 'airtel', 'mtn_momo'] as const).map(p => (
                    <button key={p} onClick={() => setMobileProvider(p)} style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: mobileProvider === p ? '2px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                      background: mobileProvider === p ? 'color-mix(in srgb, var(--accent-primary) 8%, transparent)' : 'transparent',
                      color: mobileProvider === p ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}>
                      {p === 'mpesa' ? t('payments.methodMpesa') : p === 'airtel' ? t('payments.methodAirtel') : t('payments.methodMtnMomo')}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.phoneNumber')}</label>
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+211 9XX XXX XXX"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.transactionReference')}</label>
                <input type="text" value={mobileReference} onChange={e => setMobileReference(e.target.value)} placeholder={t('payments.transactionReferencePlaceholder')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
            </>
          )}

          {tab === 'card' && (
            <>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.last4Digits')}</label>
                <input type="text" value={cardLast4} onChange={e => setCardLast4(e.target.value)} placeholder="1234" maxLength={4}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.authorizationCode')}</label>
                <input type="text" value={authCode} onChange={e => setAuthCode(e.target.value)} placeholder={t('payments.authorizationCodePlaceholder')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--accent-primary) 5%, transparent)', padding: '8px 12px', borderRadius: 6 }}>
                {t('payments.processedViaFlutterwave')}
              </div>
            </>
          )}

          {tab === 'bank' && (
            <>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.bankName')}</label>
                <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} placeholder={t('payments.bankNamePlaceholder')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.transferReference')}</label>
                <input type="text" value={transferReference} onChange={e => setTransferReference(e.target.value)} placeholder={t('payments.transferReferencePlaceholder')}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.dateOfTransfer')}</label>
                <input type="date" value={transferDate} onChange={e => setTransferDate(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                />
              </div>
            </>
          )}

          {tab === 'insurance' && (
            <>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>{t('payments.type')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['insurance', 'waiver'] as const).map(mode => (
                    <button key={mode} onClick={() => setInsuranceWaiverMode(mode)} style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      border: insuranceWaiverMode === mode ? '2px solid var(--accent-primary)' : '1px solid var(--border-medium)',
                      background: insuranceWaiverMode === mode ? 'color-mix(in srgb, var(--accent-primary) 8%, transparent)' : 'transparent',
                      color: insuranceWaiverMode === mode ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}>
                      {mode === 'insurance' ? t('billing.insurance') : t('payments.methodWaiver')}
                    </button>
                  ))}
                </div>
              </div>

              {insuranceWaiverMode === 'insurance' ? (
                <>
                  {settings.payors.filter(p => p !== 'out_of_pocket').length > 0 && (
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.payor')}</label>
                      <Select
                        value={payerName}
                        onChange={e => setPayerName(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                      >
                        <option value="">Select payor…</option>
                        {settings.payors.filter(p => p !== 'out_of_pocket').map(p => (
                          <option key={p} value={PAYOR_LABELS[p]}>{PAYOR_LABELS[p]}</option>
                        ))}
                      </Select>
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.payerName')}</label>
                    <input type="text" value={payerName} onChange={e => setPayerName(e.target.value)} placeholder={t('payments.payerNamePlaceholder')}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.claimReference')}</label>
                    <input type="text" value={claimReference} onChange={e => setClaimReference(e.target.value)} placeholder={t('payments.claimReferencePlaceholder')}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.reasonForWaiver')}</label>
                    <input type="text" value={waiverReason} onChange={e => setWaiverReason(e.target.value)} placeholder={t('payments.reasonForWaiverPlaceholder')}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('payments.approvedBy')}</label>
                    <input type="text" value={approvedBy} onChange={e => setApprovedBy(e.target.value)} placeholder={t('payments.approvedByPlaceholder')}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 14, background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                    />
                  </div>
                </>
              )}
            </>
          )}

          {/* Notes field (available on all tabs) */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}>{t('nurse.notesOptional')}</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('payments.notesPlaceholder')}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border-medium)', fontSize: 13, background: 'var(--bg-secondary)', color: 'var(--text-primary)', minHeight: 60, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>

          {error && <FormError message={error} />}
        </div>

        {/* Footer — flat bl-btn instead of the gradient-fill + drop-shadow
            "glow" button; the amount label already carries the emphasis. */}
      </div>
    </FormSlider>
  );
}
