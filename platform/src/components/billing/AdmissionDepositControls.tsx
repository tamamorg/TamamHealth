'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { AdmissionDoc } from '@/lib/db-types-ward';
import type { PaymentRecord } from '@/lib/db-types-billing';
import type { PaymentMethodType } from '@/lib/db-types-payments';

export default function AdmissionDepositControls({ admissionId }: { admissionId: string }) {
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { t } = useTranslation();
  const [admission, setAdmission] = useState<AdmissionDoc | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [method, setMethod] = useState<PaymentMethodType>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowed = ['super_admin', 'org_admin', 'hospital_manager', 'medical_superintendent', 'cashier', 'medical_biller'].includes(currentUser?.role || '');
  const load = useCallback(async () => {
    if (!scope) return;
    const { getAdmissionById } = await import('@/lib/services/ward-service');
    const row = await getAdmissionById(admissionId, scope);
    setAdmission(row);
    if (!row) return;
    const { getBillById } = await import('@/lib/services/billing-service');
    const bill = row.admissionDepositBillId ? await getBillById(row.admissionDepositBillId) : null;
    setPayments(bill?.payments ?? []);
  }, [admissionId, scope]);
  useEffect(() => { void load().catch(cause => setError(String(cause))); }, [load]);
  const run = async (action: 'refund' | 'forfeit' | 'waive' | 'issue' | 'refresh') => {
    if (!scope || !currentUser || !admission) return;
    setBusy(true); setError('');
    try {
      const service = await import('@/lib/services/ward-service');
      const actor = { id: currentUser._id, name: currentUser.name };
      if (action === 'refresh') await service.ensureAdmissionDepositBill(admissionId, scope);
      else if (action === 'issue') {
        const pending = admission.admissionDepositPendingRefund;
        await service.refundAdmissionDeposit({ admissionId, scope, actor, paymentId: pending?.paymentId || paymentId, amount: pending?.amount ?? Number(amount), method: pending?.method ?? method, reason: pending?.reason || reason });
      } else await service.assessAdmissionDeposit({ admissionId, scope, actor, decision: action, reason, refundAmount: amount ? Number(amount) : undefined });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { await load().catch(cause => setError(String(cause))); setBusy(false); }
  };
  if (!allowed || !admission) return null;
  return <section className="ehr-card p-4 space-y-3">
    <h3>{t('deposit.controls')}</h3>
    <p>{t(`ward.depositStatus.${admission.admissionDepositStatus || 'due'}`)} · {admission.admissionDepositPaid ?? 0} / {admission.admissionDepositRequired} {admission.tariffCurrency}</p>
    <label>{t('deposit.reason')}<input className="form-input" value={reason} onChange={event => setReason(event.target.value)} /></label>
    <label>{t('deposit.amount')}<input className="form-input" type="number" min="0" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
    <label>{t('deposit.payment')}<select className="form-input" value={paymentId} onChange={event => setPaymentId(event.target.value)}><option value="">{t('deposit.select')}</option>{payments.map(payment => <option key={payment.id} value={payment.id}>{payment.reference || payment.id} · {payment.amount} {admission.tariffCurrency}</option>)}</select></label>
    <div className="flex flex-wrap gap-2">
      <label>{t('deposit.method')}<select className="form-input" value={method} onChange={event => setMethod(event.target.value as PaymentMethodType)}>{(['cash', 'mobile_money', 'bank_transfer'] as const).map(value => <option key={value} value={value}>{t(`deposit.method.${value}`)}</option>)}</select></label>
      <button className="btn btn-secondary" disabled={busy} onClick={() => void run('refresh')}>{t('deposit.refresh')}</button>
      {(['refund', 'forfeit', 'waive'] as const).map(action => <button key={action} className="btn btn-secondary" disabled={busy || !reason.trim() || !!admission.admissionDepositPendingRefund} onClick={() => void run(action)}>{t(`deposit.${action}`)}</button>)}
      {admission.admissionDepositStatus === 'refund_due' && <button className="btn btn-primary" disabled={busy || (!admission.admissionDepositPendingRefund && (!paymentId || !reason.trim() || Number(amount) <= 0))} onClick={() => void run('issue')}>{t('deposit.issue')}</button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
