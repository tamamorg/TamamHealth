'use client';

import { useState, useEffect } from 'react';
import Modal from '@/components/Modal';
import { X, CheckCircle2, ArrowRight, Loader2 } from '@/components/icons/lucide';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { formatMoney } from '@/lib/format-utils';
import { stopsClickPropagation } from '@/lib/a11y';

interface PaymentPlanWizardProps {
  patientId: string;
  patientName: string;
  balance: number;
  encounterIds: string[];
  currency?: string;
  onComplete: (planId: string) => void;
  onCancel: () => void;
}

export default function PaymentPlanWizard({
  patientId, patientName, balance: balanceProp, encounterIds, currency = 'SSP', onComplete, onCancel
}: PaymentPlanWizardProps) {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [termMonths, setTermMonths] = useState(3);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [balance, setBalance] = useState(balanceProp);

  // Self-load balance if not provided
  useEffect(() => {
    if (balanceProp > 0) return;
    (async () => {
      try {
        const { getPatientBalance } = await import('@/lib/services/ledger-service');
        const bal = await getPatientBalance(patientId);
        if (bal > 0) setBalance(bal);
      } catch { /* offline fallback */ }
    })();
  }, [patientId, balanceProp]);

  const monthlyAmount = Math.ceil((balance / termMonths) * 100) / 100;
  const terms = [3, 6, 9, 12];

  const handleCreate = async () => {
    setProcessing(true);
    try {
      const { createPaymentPlan } = await import('@/lib/services/payment-service');
      const plan = await createPaymentPlan({
        patientId,
        patientName,
        totalBalance: balance,
        termMonths,
        encounterIds,
        createdByStaff: currentUser?._id || 'system',
        createdByStaffName: currentUser ? currentUser.name : 'System',
        facilityId: currentUser?.hospitalId || '',
        orgId: currentUser?.orgId,
      });
      setSuccess(true);
      setTimeout(() => onComplete(plan._id), 1500);
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    return (
      <Modal onClose={onCancel} width={360}>
        <div className="modal-content" style={{ padding: 48, textAlign: 'center', maxWidth: 360 }}>
          <CheckCircle2 size={64} style={{ color: 'var(--success)', marginBottom: 16 }} />
          <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>{t('payments.planCreated')}</h3>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
            {t('payments.planCreatedSummary', { amount: monthlyAmount.toLocaleString(), currency, months: termMonths })}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onCancel} width={440}>
      <div className="modal-content" style={{ maxWidth: 440 }} {...stopsClickPropagation}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-medium)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t('payments.paymentPlan')}</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{t('payments.patientStep', { name: patientName, step })}</p>
          </div>
          <button onClick={onCancel} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
            <X size={44} />
          </button>
        </div>

        {/* Balance */}
        <div style={{ padding: '16px 20px', background: 'var(--bg-secondary)', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t('payments.totalBalance')}</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(balance, { currency })}</div>
        </div>

        <div style={{ padding: 20 }}>
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('payments.chooseTermLength')}</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {terms.map(term => (
                  <button key={term} onClick={() => setTermMonths(term)} style={{
                    padding: '16px 8px', borderRadius: 12, textAlign: 'center', cursor: 'pointer',
                    border: termMonths === term ? '2px solid var(--accent)' : '1px solid var(--border-medium)',
                    background: termMonths === term ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                  }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: termMonths === term ? 'var(--accent)' : 'var(--text-primary)' }}>{term}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('time.months')}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: 'var(--text-muted)' }}>
                      {t('payments.perMonth', { amount: Math.ceil(balance / term).toLocaleString() })}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => setStep(2)} style={{
                marginTop: 8, padding: '12px 0', borderRadius: 10, border: 'none',
                background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {t('payments.reviewPlan')} <ArrowRight size={14} />
              </button>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('payments.monthlyPayment')}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{formatMoney(monthlyAmount, { currency })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('payments.term')}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t('payments.termMonths', { months: termMonths })}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('payments.interestRate')}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)' }}>{t('payments.zeroApr')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('payments.firstPaymentDue')}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {(() => { const d = new Date(); d.setMonth(d.getMonth() + 1); d.setDate(1); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); })()}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setStep(1)} style={{
                  flex: 1, padding: '12px 0', borderRadius: 10, border: '1px solid var(--border-medium)',
                  background: 'transparent', color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}>{t('action.back')}</button>
                <button onClick={handleCreate} disabled={processing} style={{
                  flex: 2, padding: '12px 0', borderRadius: 10, border: 'none',
                  background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600,
                  cursor: 'pointer', opacity: processing ? 0.7 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  {processing ? <><Loader2 size={14} className="animate-spin" /> {t('payments.creating')}</> : t('payments.createPlan')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
