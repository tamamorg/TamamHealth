'use client';

/**
 * The three overview cards that head the merged Billing & Claims workspace,
 * drawn in the dashboard card language the org-admin and super-admin
 * dashboards use (`dash-card` shell, tinted tone tiles, `ChartCard`):
 *
 *   1. Cash Flow          — donut of received vs pending + the two amounts
 *   2. Billing at a glance — the icon stat list (invoices, bills, claims)
 *   3. Collections trend   — ChartCard with line/area/bar + a period select
 *
 * Every figure is derived from the same docs the queues below render, so the
 * cards and the tables can never disagree. Deeper breakdowns (service line,
 * payer mix, A/R aging, plans) stay behind the workspace's analytics toggle —
 * these three answer "what came in, what is owed, which way is it trending?".
 */

import { useMemo } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ChartCard, { tooltipStyle, axisTick, type ChartPeriod } from '@/components/ChartCard';
import { CashFlowDonut } from '@/components/dashboards/_FacilityCharts';
import { AlertTriangle, Banknote, Clock, Receipt, Shield, Users, Wallet } from '@/components/icons/lucide';
import { toIsoDate, addDays } from '@/components/ehr/EhrMiniCalendar';
import { getMethodConfig } from '@/lib/payment-method-config';
import { formatMoney } from '@/lib/format-utils';
import type { ClaimDoc, PaymentDoc, PaymentMethodType } from '@/lib/db-types-payments';
import type { BillingDoc } from '@/lib/db-types-billing';

/* Same hues as the facility/org dashboards so a user moving between them
   reads the identical colour for the identical meaning. */
const CASH_RECEIVED = '#0ca30c';
const CASH_PENDING = 'var(--color-warning)';
const CASH_PENDING_TEXT = 'var(--color-warning)'; // legible amber for text on a light card
const CHART_BLUE = '#2a78d6';
const CHART_TEAL = '#007d79';
const RED = 'var(--color-danger)';
const PURPLE = '#7847EB';

/** Bills that no longer represent money owed — excluded from "pending". */
const CLOSED_BILL_STATUSES = new Set(['waived', 'cancelled']);

const PERIOD_DAYS: Record<ChartPeriod, number> = { week: 7, month: 30, quarter: 90, year: 365 };

/** Compact money tick — full precision stays in the tooltip. */
function compactAmount(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

function StatRow({ icon, label, value, sub, tone, last }: {
  icon: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  /** Small caption under the label — e.g. today's split by payment method. */
  sub?: React.ReactNode;
  tone?: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 py-2"
      style={last ? undefined : { borderBottom: '1px solid var(--border-light)' }}
    >
      <div className="icon-box-sm">{icon}</div>
      <span className="flex-1 min-w-0">
        <span className="text-[13px] block truncate" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        {sub && <span className="text-[10.5px] block truncate" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
      </span>
      <span className="text-base font-bold tabular-nums whitespace-nowrap" style={{ color: tone || 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

export interface BillingOverviewCardsProps {
  payments: PaymentDoc[];
  claims: ClaimDoc[];
  bills: BillingDoc[];
  /** Posted collections for the local calendar day — the cashier's shift total. */
  collectedToday: number;
  /** That total split by payment method, shown as the row's caption. */
  todayByMethod: Map<PaymentMethodType, number>;
  /** Patients carrying a balance — counted from the account rows below. */
  outstandingPatients: number;
  /** Completed visits in the last 30 days that never produced a bill. */
  unbilledEncounters: number;
  /** False for roles without claims access (cashier): hides the claims row/series. */
  showClaims: boolean;
}

export default function BillingOverviewCards({
  payments, claims, bills, collectedToday, todayByMethod, outstandingPatients, unbilledEncounters, showClaims,
}: BillingOverviewCardsProps) {
  const cash = useMemo(() => {
    let received = 0;
    let pending = 0;
    for (const b of bills) {
      received += b.amountPaid || 0;
      if (!CLOSED_BILL_STATUSES.has(b.status)) pending += b.balanceDue || 0;
    }
    // Sites that collect without raising bills would otherwise show an empty
    // ring — fall back to what was actually posted.
    if (received === 0 && pending === 0) {
      received = payments.reduce((sum, p) => (p.status === 'posted' ? sum + p.amount : sum), 0);
    }
    return { received, pending, total: received + pending };
  }, [bills, payments]);

  const counts = useMemo(() => {
    const pendingBills = bills.filter(b => (b.balanceDue ?? 0) > 0).length;
    return {
      invoices: bills.length,
      pending: pendingBills,
      paid: bills.length - pendingBills,
      openClaims: claims.filter(c => c.status !== 'paid' && c.status !== 'denied').length,
    };
  }, [bills, claims]);

  // "Cash SSP 24,000 · m-GURUSH SSP 20,000" — the per-method figures the old
  // stat strip carried, kept as the caption on the day's total.
  const methodSplit = useMemo(() => {
    const parts = Array.from(todayByMethod.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([method, amount]) => `${getMethodConfig(method).shortLabel} ${formatMoney(amount)}`);
    return parts.length ? parts.join(' · ') : undefined;
  }, [todayByMethod]);

  const cashSlices = useMemo(() => [
    { name: 'Received', value: cash.received, color: CASH_RECEIVED },
    { name: 'Pending', value: cash.pending, color: CASH_PENDING },
  ].filter(d => d.value > 0), [cash]);

  // Daily series builder — posted collections against claims billed, over the
  // window the period select asks for.
  const trendFor = useMemo(() => (period: ChartPeriod) => {
    const days = PERIOD_DAYS[period] ?? 30;
    const collected = new Map<string, number>();
    for (const p of payments) {
      if (p.status !== 'posted' || !p.processedAt) continue;
      const iso = toIsoDate(new Date(p.processedAt));
      collected.set(iso, (collected.get(iso) || 0) + p.amount);
    }
    const claimed = new Map<string, number>();
    for (const c of claims) {
      const when = c.submittedDate || c.createdAt;
      if (!when) continue;
      const iso = toIsoDate(new Date(when));
      claimed.set(iso, (claimed.get(iso) || 0) + (c.totalBilled || 0));
    }
    const today = new Date();
    return Array.from({ length: days }, (_, i) => {
      const d = addDays(today, -(days - 1 - i));
      const iso = toIsoDate(d);
      return {
        day: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        collected: collected.get(iso) || 0,
        claimed: claimed.get(iso) || 0,
      };
    });
  }, [payments, claims]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

      {/* ── 1. Cash Flow — the ring carries the weight, the amounts caption it ── */}
      <div className="dash-card overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <Wallet className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Cash Flow</span>
          <span className="text-[11px] ml-auto" style={{ color: 'var(--text-muted)' }}>All invoices</span>
        </div>
        <div className="flex items-center gap-3 p-4">
          <div className="relative flex-shrink-0" style={{ width: 124, height: 124 }}>
            <CashFlowDonut data={cashSlices} />
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2">
              <span className="text-[12px] font-bold leading-tight text-center" style={{ color: 'var(--text-primary)' }}>
                {formatMoney(cash.total)}
              </span>
              <span className="text-[9px] uppercase tracking-wide leading-tight mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Total invoiced
              </span>
            </div>
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(12,163,12,0.10)', border: '1px solid rgba(12,163,12,0.28)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>Received</p>
              <p className="text-[13px] font-bold truncate leading-tight mt-0.5" style={{ color: CASH_RECEIVED }}>{formatMoney(cash.received)}</p>
            </div>
            <div className="rounded-xl px-3 py-2" style={{ background: 'rgba(237,161,0,0.12)', border: '1px solid rgba(237,161,0,0.35)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-wide leading-tight" style={{ color: 'var(--text-muted)' }}>Pending</p>
              <p className="text-[13px] font-bold truncate leading-tight mt-0.5" style={{ color: CASH_PENDING_TEXT }}>{formatMoney(cash.pending)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. The stat list — the counts (and the shift's takings) that used
              to be flat strips above the cards ── */}
      <div className="dash-card overflow-hidden">
        <div className="px-4 py-3 flex flex-col justify-center h-full">
          <StatRow
            icon={<Banknote className="w-4 h-4" style={{ color: CASH_RECEIVED }} />}
            label={<>Collected <b>Today</b></>}
            sub={methodSplit}
            value={formatMoney(collectedToday)}
            tone={collectedToday > 0 ? CASH_RECEIVED : undefined}
          />
          <StatRow
            icon={<Receipt className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />}
            label={<>Total <b>Invoices</b></>}
            sub={`${counts.paid} paid`}
            value={counts.invoices}
          />
          <StatRow
            icon={<Clock className="w-4 h-4" style={{ color: CASH_PENDING_TEXT }} />}
            label={<>Pending <b>Bills</b></>}
            value={counts.pending}
          />
          <StatRow
            icon={<Users className="w-4 h-4" style={{ color: RED }} />}
            label={<>Outstanding <b>Patients</b></>}
            value={outstandingPatients}
          />
          {showClaims && (
            <StatRow
              icon={<Shield className="w-4 h-4" style={{ color: PURPLE }} />}
              label={<>Open <b>Claims</b></>}
              value={counts.openClaims}
            />
          )}
          <StatRow
            icon={<AlertTriangle className="w-4 h-4" style={{ color: unbilledEncounters > 0 ? RED : 'var(--text-muted)' }} />}
            label={<>Unbilled <b>Encounters</b> · 30d</>}
            value={unbilledEncounters}
            last
          />
        </div>
      </div>

      {/* ── 3. The trend — collections against what was billed to payers ── */}
      <ChartCard
        title={showClaims ? 'Collections & Claims' : 'Daily Collections'}
        defaultType="line"
        defaultPeriod="month"
        periods={['week', 'month', 'quarter']}
        className="dash-card"
      >
        {({ chartType, period }) => {
          const data = trendFor(period);
          const series = showClaims
            ? [
                { key: 'collected', name: 'Collected', color: CHART_TEAL },
                { key: 'claimed', name: 'Claimed', color: CHART_BLUE },
              ]
            : [{ key: 'collected', name: 'Collected', color: CHART_TEAL }];
          const axes = (
            <>
              <CartesianGrid stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} width={40} tickFormatter={compactAmount} />
              <Tooltip {...tooltipStyle} formatter={(v: number | undefined) => formatMoney(v ?? 0)} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                formatter={(value: React.ReactNode) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>}
              />
            </>
          );
          if (chartType === 'bar') {
            return (
              <ResponsiveContainer width="100%" height={208}>
                <BarChart data={data} margin={{ top: 5, right: 5, left: -6, bottom: 0 }} barCategoryGap="28%">
                  {axes}
                  {series.map(s => (
                    <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            );
          }
          if (chartType === 'area') {
            return (
              <ResponsiveContainer width="100%" height={208}>
                <AreaChart data={data} margin={{ top: 5, right: 5, left: -6, bottom: 0 }}>
                  {axes}
                  {series.map(s => (
                    <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            );
          }
          return (
            <ResponsiveContainer width="100%" height={208}>
              <LineChart data={data} margin={{ top: 5, right: 5, left: -6, bottom: 0 }}>
                {axes}
                {series.map(s => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          );
        }}
      </ChartCard>
    </div>
  );
}
