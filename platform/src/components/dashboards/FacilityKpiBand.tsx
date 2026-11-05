'use client';

/**
 * The headline figures of a facility register (leave, shifts, payroll, assets,
 * inquiries, blood stock, controlled drugs, emergency plans) as the management
 * KPI band: SadbKpiTile's label, value and a detail line saying what the figure
 * is made of, plus a trend wherever the loaded records carry a date to compare.
 *
 * It replaces the dot-count legend that sat in each list's header: the same
 * counts, drawn once and the same way on every register.
 */

import { useRouter } from 'next/navigation';
import { SadbKpiTile, trendBetween, type SadbTrendValue } from '@/components/admin/sadb-ui';

export interface FacilityKpi {
  key: string;
  label: string;
  value: React.ReactNode;
  /** What the figure is made of. Every tile carries one. */
  detail: React.ReactNode;
  /** The detail is a warning (something needs a decision). */
  warn?: boolean;
  trend?: SadbTrendValue;
  /** Page that owns the figure, when it is not the page the band is on. */
  href?: string;
}

export default function FacilityKpiBand({ tiles }: { tiles: FacilityKpi[] }) {
  const router = useRouter();
  return (
    <div className="sadb-kpi-row" style={{ flexShrink: 0 }}>
      {tiles.map(k => (
        <SadbKpiTile
          key={k.key}
          label={k.label}
          value={k.value}
          delta={k.detail}
          deltaTone={k.warn ? 'warn' : undefined}
          trend={k.trend}
          onClick={k.href ? () => router.push(k.href as string) : undefined}
        />
      ))}
    </div>
  );
}

/**
 * Records dated in the last 7 days against the 7 before, for a list whose
 * records carry a date. `label` names what was counted ("requested", "received").
 */
export function weekOverWeek<T>(
  items: readonly T[],
  dateOf: (item: T) => string | undefined,
  label: string,
  good: 'up' | 'down' = 'up',
  t?: (key: string, vars?: Record<string, string | number>) => string,
): SadbTrendValue {
  const nowMs = Date.now();
  let thisWeek = 0;
  let lastWeek = 0;
  for (const item of items) {
    const raw = dateOf(item);
    const at = raw ? new Date(raw).getTime() : NaN;
    if (at >= nowMs - 7 * 86400000 && at <= nowMs + 86400000) thisWeek++;
    else if (at >= nowMs - 14 * 86400000 && at < nowMs - 7 * 86400000) lastWeek++;
  }
  return { direction: trendBetween(thisWeek, lastWeek), label: t ? t('kpi.weekVsLast', { thisWeek, lastWeek, label }) : `${thisWeek} ${label} this week vs ${lastWeek} last`, good };
}
