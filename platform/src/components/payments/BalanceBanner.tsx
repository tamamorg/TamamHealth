'use client';

import { useState, useEffect } from 'react';
import { DollarSign, AlertTriangle, Calendar, CreditCard } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useDataScope } from '@/lib/hooks/useDataScope';

interface BalanceBannerProps {
  patientId: string;
  compact?: boolean;
  onPayClick?: () => void;
}

interface Summary {
  totalBalance: number;
  overdueBalance: number;
  activePlanBalance: number;
  nextPlanPaymentDate?: string;
  nextPlanPaymentAmount?: number;
  collectionStage: string;
}

export default function BalanceBanner({ patientId, compact, onPayClick }: BalanceBannerProps) {
  const { t } = useTranslation();
  const scope = useDataScope();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!scope) { setSummary(null); return; }
    (async () => {
      try {
        const { getPatientFinancialSummary } = await import('@/lib/services/payment-service');
        const data = await getPatientFinancialSummary(patientId, scope);
        setSummary(data);
      } catch { /* offline fallback */ }
    })();
  }, [patientId, scope]);

  if (!summary || summary.totalBalance === 0) return null;

  const isOverdue = summary.overdueBalance > 0;
  const bannerColor = isOverdue ? 'var(--error)' : 'var(--accent)';

  if (compact) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600,
        color: bannerColor,
        background: `color-mix(in srgb, ${bannerColor} 10%, transparent)`,
      }}>
        <DollarSign size={12} />
        {t('balanceBanner.amountSsp', { amount: summary.totalBalance.toLocaleString() })}
        {isOverdue && <AlertTriangle size={11} />}
      </span>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      padding: '12px 16px', borderRadius: 12,
      background: `color-mix(in srgb, ${bannerColor} 6%, var(--bg-card))`,
      border: `1px solid color-mix(in srgb, ${bannerColor} 20%, transparent)`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span className="icon-box-sm" style={{ color: 'var(--success)' }}>
          <DollarSign size={16} />
        </span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: bannerColor }}>
            {t('balanceBanner.balanceSsp', { amount: summary.totalBalance.toLocaleString() })}
          </div>
          {isOverdue && (
            <div style={{ fontSize: 11, color: 'var(--error)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="icon-box-sm" style={{ color: 'var(--error)', width: 20, height: 20 }}>
                <AlertTriangle size={10} />
              </span>
              {t('balanceBanner.overdueSsp', { amount: summary.overdueBalance.toLocaleString() })}
            </div>
          )}
        </div>
      </div>

      <hr className="section-divider" />

      {summary.nextPlanPaymentDate && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="icon-box-sm" style={{ color: 'var(--indigo, #1174b4)', width: 20, height: 20 }}>
            <Calendar size={11} />
          </span>
          {t('balanceBanner.nextPlanPayment', { amount: (summary.nextPlanPaymentAmount ?? 0).toLocaleString(), date: summary.nextPlanPaymentDate })}
        </div>
      )}

      {onPayClick && (
        <button
          onClick={onPayClick}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 16px', borderRadius: 20, border: 'none',
            background: bannerColor, color: '#fff',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          <span className="icon-box-sm" style={{ color: 'var(--teal, #2191D0)', width: 22, height: 22 }}>
            <CreditCard size={13} />
          </span>
          {t('billing.collectPayment')}
        </button>
      )}
    </div>
  );
}
