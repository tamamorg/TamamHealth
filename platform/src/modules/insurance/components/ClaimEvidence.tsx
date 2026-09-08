'use client';
import { useState } from 'react';
import type { ClaimDoc } from '@/lib/db-types-payments';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { recordClaimReceipt, recordClaimSettlement } from '../services/insurance-workflow-service';

export default function ClaimEvidence({ claim, onChanged }: { claim: ClaimDoc; onChanged: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const scope = useDataScope();
  const [reference, setReference] = useState(claim.settlement?.reference || '');
  const [method, setMethod] = useState<'portal' | 'written'>('portal');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const receipt = ['queued', 'submitted'].includes(claim.status);
  const settlement = ['approved', 'partial'].includes(claim.status) && (claim.totalApproved || 0) > 0
    && Boolean(claim.adjudicationKey && claim.payerReceipt);
  async function save() {
    setBusy(true); setMessage('');
    try {
      if (!scope) throw new Error('INSURANCE_FORBIDDEN');
      if (receipt) await recordClaimReceipt(claim._id, reference, method, scope);
      else await recordClaimSettlement(claim._id, reference, scope);
      await onChanged(); setReference('');
    } catch { setMessage(t('insuranceFlow.failed')); }
    finally { setBusy(false); }
  }
  return <section className="px-5 py-4 space-y-3">
    <p>{t('insuranceFlow.noConnector')}</p>
    {claim.payerReceipt && <p>{t('insuranceFlow.receiptRecorded', { reference: claim.payerReceipt.reference })}</p>}
    {claim.settlement && <p>{t('insuranceFlow.settlementRecorded', { reference: claim.settlement.reference })}</p>}
    {(receipt || settlement) && <>
      <label>{t('insuranceFlow.reference')}<input value={reference} maxLength={160} onChange={e => setReference(e.target.value)} disabled={busy} /></label>
      {receipt && <label>{t('insuranceFlow.method')}<select value={method} onChange={e => setMethod(e.target.value as 'portal' | 'written')} disabled={busy}>
        <option value="portal">{t('insuranceFlow.portal')}</option><option value="written">{t('insuranceFlow.written')}</option>
      </select></label>}
      <p>{t(receipt ? 'insuranceFlow.receiptHelp' : 'insuranceFlow.settlementHelp')}</p>
      <button className="bl-btn bl-btn--outline" disabled={busy || !reference.trim()} onClick={() => void save()}>{t(receipt ? 'insuranceFlow.recordReceipt' : 'insuranceFlow.recordSettlement')}</button>
    </>}
    {message && <p role="alert">{message}</p>}
  </section>;
}
