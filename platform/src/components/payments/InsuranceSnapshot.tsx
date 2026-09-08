'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Plus, Edit3 } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { PolicyEligibility } from '@/modules/insurance/client';
import { useDataScope } from '@/lib/hooks/useDataScope';

interface InsuranceSnapshotProps {
  patientId: string;
  editable?: boolean;
  onAddInsurance?: () => void;
  onEditInsurance?: (policyId: string) => void;
}

interface Policy {
  _id: string;
  payerType: string;
  payerName: string;
  memberId?: string;
  groupNumber?: string;
  isPrimary: boolean;
  effectiveDate: string;
  terminationDate?: string;
  copayAmount?: number;
  coinsurancePct?: number;
  donorCoverageType?: string;
  facilityId: string;
  orgId?: string;
}

export default function InsuranceSnapshot({ patientId, editable, onAddInsurance, onEditInsurance }: InsuranceSnapshotProps) {
  const { t } = useTranslation();
  const scope = useDataScope();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setPolicies([]);
    if (!scope) { setPolicies([]); setLoading(false); return; }
    try {
      const { getPatientInsurancePolicies } = await import('@/lib/services/payment-service');
      const pols = await getPatientInsurancePolicies(patientId, scope);
      if (sequence === loadSequence.current) setPolicies(pols);
    } catch { /* offline */ }
    if (sequence === loadSequence.current) setLoading(false);
  }, [patientId, scope]);

  useEffect(() => { void load(); return () => { loadSequence.current++; }; }, [load]);

  if (loading) {
    return <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>{t('insuranceSnapshot.loading')}</div>;
  }

  if (policies.length === 0) {
    return (
      <div style={{
        padding: 16, borderRadius: 12,
        border: '1px dashed var(--border-medium)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
          <span className="icon-box-sm" style={{ color: 'var(--teal, #2191D0)' }}>
            <Shield size={16} />
          </span>
          {t('insuranceSnapshot.noInsuranceSelfPay')}
        </div>
        {editable && onAddInsurance && (
          <button onClick={onAddInsurance} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 12px', borderRadius: 16, border: '1px solid var(--accent)',
            background: 'transparent', color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            <Plus size={12} /> {t('insuranceSnapshot.addInsurance')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="data-row-divider-sm" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {policies.map(policy => (
        <div key={policy._id} style={{
          padding: '12px 16px', borderRadius: 12,
          background: 'var(--bg-card)',
          border: `1px solid ${policy.isPrimary ? 'var(--accent)' : 'var(--border-medium)'}`,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{policy.payerName}</span>
              {policy.isPrimary && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('insuranceSnapshot.primary')}</span>
              )}

            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {policy.memberId && <span>{t('insuranceSnapshot.memberId', { id: policy.memberId })}</span>}
              {policy.copayAmount != null && <span>{t('insuranceSnapshot.copay', { amount: policy.copayAmount })}</span>}
              {policy.coinsurancePct != null && <span>{t('insuranceSnapshot.coinsurance', { pct: policy.coinsurancePct })}</span>}
              {policy.donorCoverageType && <span>{t('insuranceSnapshot.coverage', { type: policy.donorCoverageType })}</span>}
              <span>{t('insuranceSnapshot.effective', { date: policy.effectiveDate })}</span>
            </div>
          </div>
          <PolicyEligibility key={`${patientId}:${policy._id}`} patientId={patientId} policyId={policy._id} facilityId={policy.facilityId} orgId={policy.orgId} editable={editable} />
          {editable && onEditInsurance && (
            <button onClick={() => onEditInsurance(policy._id)} style={{
              background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4,
            }}>
              <Edit3 size={14} />
            </button>
          )}
        </div>
      ))}

      <hr className="section-divider" />

      {editable && onAddInsurance && (
        <button onClick={onAddInsurance} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          padding: '8px 0', borderRadius: 12, border: '1px dashed var(--border-medium)',
          background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
        }}>
          <Plus size={12} /> {t('insuranceSnapshot.addAnotherPlan')}
        </button>
      )}
    </div>
  );
}
