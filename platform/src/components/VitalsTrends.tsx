'use client';

/**
 * VitalsTrends
 * ------------
 * Visual trend panel for a patient's key vital signs over time.
 *
 * Given a chronologically-sorted list of MedicalRecordDoc entries (any order;
 * this component will sort them ascending by date for the charts), it renders
 * a compact grid of sparkline-style charts for:
 *   - Blood pressure (systolic/diastolic)
 *   - Temperature
 *   - Heart rate (pulse)
 *   - Weight
 *   - Blood glucose (pulled from labResults if present)
 *
 * For each metric we compute:
 *   - The latest value
 *   - The previous value (for a direction arrow)
 *   - A simple anomaly flag if the latest reading is outside normal range
 *     or the last two readings both breach the threshold.
 */

import { useMemo } from 'react';
import dynamic from 'next/dynamic';

// recharts is ~80–100 KB and only ~half of patient charts show a trend line
// (a metric needs >= 2 readings). Deferring it keeps that weight off the
// initial payload on 2G/3G connections (KAN-66). ssr:false because recharts
// measures the DOM to size itself and cannot render on the server.
const VitalsSparkline = dynamic(() => import('./_VitalsSparkline'), {
  ssr: false,
  loading: () => <div style={{ width: '100%', height: 80 }} />,
});
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Activity } from '@/components/icons/lucide';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { MedicalRecordDoc } from '@/lib/db-types';

type TFn = (key: string, vars?: Record<string, string | number>) => string;

interface VitalsTrendsProps {
  records: MedicalRecordDoc[];
}

type TrendDirection = 'up' | 'down' | 'flat';
type TrendStatus = 'normal' | 'warning' | 'danger';

interface MetricPoint {
  date: string;
  label: string;
  value: number;
  // for BP we carry a secondary value
  secondary?: number;
}

interface MetricSummary {
  key: string;
  title: string;
  unit: string;
  /** chronological points, oldest first */
  points: MetricPoint[];
  latest: number | null;
  previous: number | null;
  direction: TrendDirection;
  status: TrendStatus;
  /** Normal range, for display */
  normalLabel: string;
  /** Normal band used for the chart reference area */
  normalRange?: [number, number];
  /** Optional message shown as a trend badge */
  message?: string;
  color: string;
}

function pctChange(curr: number, prev: number): number {
  if (prev === 0) return 0;
  return ((curr - prev) / prev) * 100;
}

function direction(curr: number | null, prev: number | null): TrendDirection {
  if (curr == null || prev == null) return 'flat';
  const diff = curr - prev;
  if (Math.abs(diff) < 0.01) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Build a MetricSummary for a single scalar vital. `selector` extracts the
 * numeric value from a record, or returns null to skip that record.
 */
function buildMetric(
  records: MedicalRecordDoc[],
  key: string,
  title: string,
  unit: string,
  color: string,
  normalRange: [number, number],
  normalLabel: string,
  selector: (rec: MedicalRecordDoc) => number | null,
  t: TFn,
): MetricSummary | null {
  const points: MetricPoint[] = records
    .map(r => {
      const v = selector(r);
      if (v == null || !Number.isFinite(v) || v === 0) return null;
      const d = r.consultedAt || r.visitDate || r.createdAt;
      return { date: d, label: formatDate(d), value: v } as MetricPoint;
    })
    .filter((p): p is MetricPoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) return null;

  const latest = points[points.length - 1].value;
  const previous = points.length > 1 ? points[points.length - 2].value : null;
  const dir = direction(latest, previous);

  // Anomaly detection:
  //   danger  → latest reading outside the normal range
  //   warning → latest is borderline (within 5% of limit) or trending toward a limit
  //   normal  → all good
  let status: TrendStatus = 'normal';
  let message: string | undefined;

  const [lo, hi] = normalRange;
  if (latest < lo || latest > hi) {
    status = 'danger';
    const reps = points.slice(-2).filter(p => p.value < lo || p.value > hi).length;
    message = reps >= 2
      ? (latest > hi ? t('vitalsTrends.repeatedlyAboveRange') : t('vitalsTrends.repeatedlyBelowRange'))
      : t('vitalsTrends.outOfRange');
  } else if (previous != null) {
    const pc = pctChange(latest, previous);
    if (Math.abs(pc) > 10) {
      status = 'warning';
      message = pc > 0
        ? t('vitalsTrends.risingPct', { pct: Math.abs(Math.round(pc)) })
        : t('vitalsTrends.fallingPct', { pct: Math.abs(Math.round(pc)) });
    }
  }

  return {
    key,
    title,
    unit,
    points,
    latest,
    previous,
    direction: dir,
    status,
    normalLabel,
    normalRange,
    message,
    color,
  };
}

/**
 * Blood pressure is a pair (systolic/diastolic). We build a separate summary
 * that plots both lines and flags hypertensive/hypotensive patterns.
 */
function buildBPMetric(records: MedicalRecordDoc[], t: TFn): MetricSummary | null {
  const points: MetricPoint[] = records
    .map(r => {
      const v = r.vitalSigns;
      if (!v || !v.systolic || !v.diastolic) return null;
      if (!Number.isFinite(v.systolic) || !Number.isFinite(v.diastolic)) return null;
      const d = r.consultedAt || r.visitDate || r.createdAt;
      return { date: d, label: formatDate(d), value: v.systolic, secondary: v.diastolic } as MetricPoint;
    })
    .filter((p): p is MetricPoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) return null;

  const latest = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const dir = direction(latest.value, previous?.value ?? null);

  let status: TrendStatus = 'normal';
  let message: string | undefined;

  // Hypertensive stage 1 (JNC 7): ≥140/90.  Hypotensive: ≤90/60.
  const sys = latest.value;
  const dia = latest.secondary ?? 0;
  if (sys >= 140 || dia >= 90) {
    status = 'danger';
    const repeat = points.slice(-2).every(p => p.value >= 140 || (p.secondary ?? 0) >= 90);
    message = repeat ? t('vitalsTrends.repeatedHypertensive') : t('vitalsTrends.elevatedBp');
  } else if (sys <= 90 || dia <= 60) {
    status = 'danger';
    message = t('vitalsTrends.lowBp');
  } else if (sys >= 130 || dia >= 85) {
    status = 'warning';
    message = t('vitalsTrends.approachingHypertensive');
  }

  return {
    key: 'bp',
    title: t('vitals.bloodPressure'),
    unit: 'mmHg',
    points,
    latest: sys,
    previous: previous?.value ?? null,
    direction: dir,
    status,
    normalLabel: '90–120 / 60–80',
    normalRange: [90, 120],
    message,
    color: 'var(--color-chart-1)',
  };
}

/**
 * Pull blood-glucose values from the labResults attached to a record.
 * This is a best-effort extraction because lab result strings are free form.
 */
function extractGlucose(rec: MedicalRecordDoc): number | null {
  const labs = rec.labResults || [];
  for (const lab of labs) {
    if (!lab.testName?.toLowerCase().includes('glucose')) continue;
    const match = String(lab.result || '').match(/(\d+(?:\.\d+)?)/);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

export default function VitalsTrends({ records }: VitalsTrendsProps) {
  const { t } = useTranslation();
  const metrics = useMemo<MetricSummary[]>(() => {
    const out: MetricSummary[] = [];
    const bp = buildBPMetric(records, t);
    if (bp) out.push(bp);

    const temp = buildMetric(
      records, 'temperature', t('vitals.temperature'), '°C', 'var(--color-warning)',
      [36.1, 37.5], '36.1–37.5°C',
      (r) => r.vitalSigns?.temperature ?? null,
      t,
    );
    if (temp) out.push(temp);

    const pulse = buildMetric(
      records, 'pulse', t('vitalsTrends.heartRate'), 'bpm', 'var(--color-danger)',
      [60, 100], '60–100 bpm',
      (r) => r.vitalSigns?.pulse ?? null,
      t,
    );
    if (pulse) out.push(pulse);

    const weight = buildMetric(
      records, 'weight', t('vitals.weight'), 'kg', 'var(--color-success)',
      // Weight has no universal normal range; treat anything as normal and
      // highlight only big swings via the warning path.
      [0, 500], '—',
      (r) => r.vitalSigns?.weight ?? null,
      t,
    );
    if (weight) out.push(weight);

    const spo2 = buildMetric(
      records, 'spo2', t('vitals.spo2'), '%', 'var(--color-purple-500)',
      [95, 100], '≥95%',
      (r) => r.vitalSigns?.oxygenSaturation ?? null,
      t,
    );
    if (spo2) out.push(spo2);

    const glucose = buildMetric(
      records, 'glucose', t('vitalsTrends.bloodGlucose'), 'mg/dL', 'var(--color-chart-6)',
      [70, 140], '70–140 mg/dL',
      extractGlucose,
      t,
    );
    if (glucose) out.push(glucose);

    return out;
  }, [records, t]);

  if (metrics.length === 0) {
    return (
      <div className="card-elevated p-6 text-center">
        <Activity className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('vitalsTrends.emptyState')}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {metrics.map(m => (
        <MetricCard key={m.key} metric={m} />
      ))}
    </div>
  );
}

function MetricCard({ metric }: { metric: MetricSummary }) {
  const { t } = useTranslation();
  const {
    title, unit, points, latest, previous, direction: dir, status, normalLabel, message, color, key,
  } = metric;

  const statusBg =
    status === 'danger' ? 'var(--color-danger-bg)' :
    status === 'warning' ? 'var(--color-warning-bg)' :
    'var(--color-success-bg)';
  const statusColor =
    status === 'danger' ? 'var(--color-danger)' :
    status === 'warning' ? 'var(--color-warning-700)' :
    'var(--color-success-text)';
  // The whole trend card picks up a tinted surface when a vital is off —
  // matches the Latest Vitals grid so readers never miss a red card.
  const cardSurface =
    status === 'danger'
      ? { background: 'var(--color-danger-bg)', border: '1px solid color-mix(in srgb, var(--color-danger) 32%, transparent)', boxShadow: 'none' }
      : status === 'warning'
      ? { background: 'var(--color-warning-bg)', border: '1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)', boxShadow: 'none' }
      : undefined;

  const Arrow = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;

  const latestDisplay = key === 'bp' && points.length > 0
    ? `${latest}/${points[points.length - 1].secondary ?? '-'}`
    : latest != null ? String(latest) : '—';
  const chartPoints = points.filter(point =>
    Number.isFinite(point.value) && (point.secondary === undefined || Number.isFinite(point.secondary)),
  );

  const changeLabel = (() => {
    if (latest == null || previous == null) return null;
    const delta = latest - previous;
    if (Math.abs(delta) < 0.01) return t('vitalsTrends.noChange');
    const sign = delta > 0 ? '+' : '';
    return `${sign}${delta.toFixed(Math.abs(delta) < 10 ? 1 : 0)} ${unit}`;
  })();

  return (
    <div className="card-elevated p-4 relative" style={cardSurface}>
      {status === 'danger' && <span className="data-tile__alarm-pulse" aria-hidden="true" />}
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {title}
          </p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-bold" style={{ color: status === 'danger' ? statusColor : 'var(--text-primary)' }}>
              {latestDisplay}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{unit}</span>
          </div>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {t('vitalsTrends.normalLabel', { range: normalLabel })}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full"
            style={{ background: statusBg, color: statusColor }}
          >
            {status === 'danger' && <AlertTriangle className="w-3 h-3" />}
            <Arrow className="w-3 h-3" />
            {changeLabel ?? t('vitalsTrends.baseline')}
          </span>
          {message && (
            <span className="text-[10px] font-semibold" style={{ color: statusColor }}>
              {message}
            </span>
          )}
        </div>
      </div>

      {chartPoints.length >= 2 ? (
      <div style={{ width: '100%', height: 80 }}>
        <VitalsSparkline
          points={chartPoints}
          color={color}
          statusColor={statusColor}
          unit={unit}
          title={title}
          normalRange={metric.normalRange}
          showSecondary={key === 'bp'}
        />
      </div>
      ) : (
        <div className="flex items-center justify-center" style={{ width: '100%', height: 80, color: 'var(--text-muted)', fontSize: 11 }}>
          {t('vitalsTrends.baseline')}
        </div>
      )}

      <div className="flex items-center justify-between mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <span>{chartPoints.length === 1 ? t('vitalsTrends.readingCountSingular', { count: chartPoints.length }) : t('vitalsTrends.readingCountPlural', { count: chartPoints.length })}</span>
        <span>{chartPoints[0]?.label || points[0].label} — {chartPoints[chartPoints.length - 1]?.label || points[points.length - 1].label}</span>
      </div>
    </div>
  );
}
