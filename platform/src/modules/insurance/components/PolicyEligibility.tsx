'use client';
import { useEffect, useState } from 'react';
import type { EligibilityCheckDoc } from '@/lib/db-types-payments';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { BILLING } from '@/lib/sync/write-permissions';
import EligibilityBadge from '@/components/payments/EligibilityBadge';
import { checkEligibility, getLatestEligibility } from '@/lib/services/payment-service';

export default function PolicyEligibility({ patientId, policyId, facilityId, orgId, editable }: {
  patientId: string; policyId: string; facilityId: string; orgId?: string; editable?: boolean;
}) {
  const { t } = useTranslation();
  const scope = useDataScope();
  const [check, setCheck] = useState<EligibilityCheckDoc | null>(null);
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<'phone' | 'portal' | 'written'>('phone');
  const [decision, setDecision] = useState<'verified' | 'denied'>('verified');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getLatestEligibility(patientId, scope, policyId).then(value => { if (!cancelled) setCheck(value); })
      .catch(() => { if (!cancelled) setMessage(t('insuranceFlow.failed')); });
    return () => { cancelled = true; };
  }, [patientId, policyId, scope, revision, t]);
  async function save(manual: boolean) {
    setBusy(true); setMessage('');
    try {
      if (!scope) throw new Error('INSURANCE_FORBIDDEN');
      await checkEligibility({ patientId, policyId, facilityId, orgId, checkedBy: scope?.userId || '',
        manualEvidence: manual ? { reference, method, decision, expiresAt: new Date(expiry).toISOString() } : undefined }, scope);
      setRevision(value => value + 1); setMessage(t(manual ? 'insuranceFlow.evidenceSaved' : 'insuranceFlow.estimateSaved'));
    } catch { setMessage(t('insuranceFlow.failed')); }
    finally { setBusy(false); }
  }
  const status = check && ['verified', 'cached'].includes(check.status) && (!check.expiresAt || Date.parse(check.expiresAt) <= Date.now()) ? 'expired' : check?.status || 'none';
  return <div className="space-y-2 mt-2">
    <EligibilityBadge status={status} compact />
    {check && <p>{t('insuranceFlow.checkedAt', { date: check.checkDate })}{check.expiresAt ? ` · ${t('insuranceFlow.expiresAt', { date: check.expiresAt })}` : ''}</p>}
    {check?.verificationReference && <p>{t('insuranceFlow.manualReference', { reference: check.verificationReference })}</p>}
    <p>{t('insuranceFlow.noGuarantee')}</p>
    {editable && scope && BILLING.includes(scope.role) && <details>
      <summary>{t('insuranceFlow.coverageEvidence')}</summary>
      <div className="space-y-2">
        <button type="button" disabled={busy} onClick={() => void save(false)}>{t('insuranceFlow.localEstimate')}</button>
        <label>{t('insuranceFlow.reference')}<input maxLength={160} value={reference} onChange={e => setReference(e.target.value)} /></label>
        <label>{t('insuranceFlow.method')}<select value={method} onChange={e => setMethod(e.target.value as typeof method)}>
          <option value="phone">{t('insuranceFlow.phone')}</option><option value="portal">{t('insuranceFlow.portal')}</option><option value="written">{t('insuranceFlow.written')}</option>
        </select></label>
        <label>{t('insuranceFlow.decision')}<select value={decision} onChange={e => setDecision(e.target.value as typeof decision)}>
          <option value="verified">{t('insuranceFlow.covered')}</option><option value="denied">{t('insuranceFlow.notCovered')}</option>
        </select></label>
        <label>{t('insuranceFlow.expiry')}<input type="datetime-local" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
        <button type="button" disabled={busy || !reference.trim() || !expiry} onClick={() => void save(true)}>{t('insuranceFlow.saveEvidence')}</button>
      </div>
    </details>}
    {message && <p role="status">{message}</p>}
  </div>;
}
