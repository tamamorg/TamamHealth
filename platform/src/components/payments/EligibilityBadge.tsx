'use client';

import { Shield, ShieldAlert, ShieldOff, ShieldQuestion, ShieldCheck } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface EligibilityBadgeProps {
  status: 'verified' | 'unverified' | 'expired' | 'denied' | 'cached' | 'none';
  compact?: boolean;
}

const statusConfig = {
  verified:   { labelKey: 'eligibility.verified',    color: 'var(--success)',  icon: ShieldCheck },
  cached:     { labelKey: 'eligibility.cached',      color: 'var(--success)',  icon: ShieldCheck },
  unverified: { labelKey: 'eligibility.unverified',  color: 'var(--warning)',  icon: ShieldQuestion },
  expired:    { labelKey: 'eligibility.expired',     color: 'var(--error)',    icon: ShieldAlert },
  denied:     { labelKey: 'eligibility.denied',      color: 'var(--error)',    icon: ShieldOff },
  none:       { labelKey: 'eligibility.noInsurance', color: 'var(--text-muted)', icon: Shield },
};

export default function EligibilityBadge({ status, compact }: EligibilityBadgeProps) {
  const { t } = useTranslation();
  const config = statusConfig[status] || statusConfig.none;
  const Icon = config.icon;

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: compact ? '2px 8px' : '4px 12px',
      borderRadius: 0,
      fontSize: compact ? 11 : 12,
      fontWeight: 600,
      color: config.color,
      background: `color-mix(in srgb, ${config.color} 12%, transparent)`,
      whiteSpace: 'nowrap',
    }}>
      <Icon size={compact ? 12 : 14} />
      {!compact && t(config.labelKey)}
    </span>
  );
}
