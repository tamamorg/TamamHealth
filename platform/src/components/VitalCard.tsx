import type { ReactNode } from 'react';
import { type IconName } from '@/components/icons';
import {
  Heart, Activity, Thermometer, Droplet, Wind, Weight, Ruler, AlertTriangle,
  type LucideIcon,
} from '@/components/icons/lucide';
import {
  getVitalStatus,
  getBloodPressureStatus,
  getVitalHint,
  SEVERITY_TOKENS,
  type VitalKey,
  type VitalSeverity,
} from '@/lib/clinical-guidelines';

// Map the chart's semantic icon names to clean outline (lucide) glyphs.
const VITAL_GLYPHS: Partial<Record<IconName, LucideIcon>> = {
  heart: Heart,
  bloodPressure: Activity,
  thermometer: Thermometer,
  oxygen: Droplet,
  lungs: Wind,
  weight: Weight,
  patient: Ruler,
  alert: AlertTriangle,
};

interface VitalCardProps {
  // 'bp' is a composite (pass systolic/diastolic).
  // 'none' opts out of threshold coloring — use for non-clinical readings
  // like weight/height where there's no universal alarm range.
  vitalKey: VitalKey | 'bp' | 'none';
  icon: IconName;
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  systolic?: number;
  diastolic?: number;
  trend?: { delta: string; direction: 'up' | 'down' | 'flat' };
  subtitle?: ReactNode;
  className?: string;
}

// A single vital-reading tile. The tile's tint + border + badge are all
// driven by clinical thresholds — a normal reading reads as a quiet neutral
// tile, a warning reads amber, a danger reads red with an inset ring.
export function VitalCard({
  vitalKey, icon, label, value, unit, systolic, diastolic, trend, subtitle, className,
}: VitalCardProps) {
  const severity: VitalSeverity =
    vitalKey === 'bp'
      ? getBloodPressureStatus(systolic, diastolic)
      : vitalKey === 'none'
      ? 'normal'
      : getVitalStatus(vitalKey, typeof value === 'number' ? value : Number(value));
  const tokens = SEVERITY_TOKENS[severity];
  const hint =
    vitalKey === 'bp'
      ? (severity === 'danger' ? 'Hypertensive' : severity === 'warning' ? 'Elevated' : null)
      : vitalKey === 'none'
      ? null
      : getVitalHint(vitalKey, typeof value === 'number' ? value : Number(value));

  const display = vitalKey === 'bp'
    ? (systolic != null && diastolic != null ? `${systolic}/${diastolic}` : '—')
    : (value != null && value !== '' ? String(value) : '—');

  return (
    <div
      className={`vital-card ${className || ''}`}
      style={{
        background: tokens.tile,
        border: `1px solid ${tokens.tileBorder}`,
        borderRadius: 12,
        padding: 14,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: 'none',
      }}
    >
      {/* Enlarged icon, left-aligned */}
      <div
        style={{
          width: 52, height: 52, borderRadius: 12, flexShrink: 0,
          background: severity === 'normal' ? 'var(--accent-light)' : tokens.badge,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {(() => {
          const Glyph = VITAL_GLYPHS[icon] ?? Activity;
          return <Glyph size={26} color={tokens.accent} strokeWidth={2} />;
        })()}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Label */}
        <div
          style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: severity === 'normal' ? 'var(--text-muted)' : tokens.accent,
            marginBottom: 4,
          }}
        >
          {label}
        </div>

        {/* Value + unit */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <div
            style={{
              fontSize: 22, fontWeight: 800, letterSpacing: -0.4,
              color: tokens.text,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.05,
            }}
          >
            {display}
          </div>
          {unit && display !== '—' && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>{unit}</div>
          )}
        </div>

        {/* Status / trend — plain text (no pill chrome) so the row scans cleanly.
            Severity-tinted color carries the meaning. */}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, minHeight: 14 }}>
          {hint ? (
            <span
              style={{
                fontSize: 11.5, fontWeight: 700, letterSpacing: 0.1,
                color: tokens.accent,
              }}
            >
              {hint}
            </span>
          ) : vitalKey !== 'none' ? (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-success-text)' }}>Normal</span>
          ) : null}
          {trend && (
            <span
              style={{
                fontSize: 11, fontWeight: 700,
                color: trend.direction === 'up' ? 'var(--color-success-text)' : trend.direction === 'down' ? 'var(--color-danger-text)' : 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {trend.direction === 'up' ? '+' : trend.direction === 'down' ? '−' : ''}{trend.delta}
            </span>
          )}
          {subtitle && (
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{subtitle}</span>
          )}
        </div>
      </div>

      {/* Alarm flag — corner badge for abnormal readings */}
      {severity !== 'normal' && (
        <div
          aria-label={severity === 'danger' ? 'Abnormal — critical' : 'Abnormal'}
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 22, height: 22, borderRadius: 7,
            background: tokens.badge,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <AlertTriangle size={13} color={tokens.accent} strokeWidth={2} />
        </div>
      )}
    </div>
  );
}

export default VitalCard;
