'use client';

/**
 * The overview that heads the merged Billing & Claims workspace: the KPI
 * band, then two cards drawn in the patient chart's frame (hairline, white,
 * 16px titles, labelled Select fields in place of chart-type pills):
 *
 *   1. Cash flow         — donut of received vs pending + the two amounts
 *   2. Collections trend — line/area/bar of collected vs claimed, with Chart
 *                          type and Period fields
 *
 * Every figure is derived from the same docs the queues below render, so the
 * cards and the tables can never disagree. Deeper breakdowns (service line,
 * payer mix, A/R aging, plans) stay behind the workspace's analytics toggle —
 * these answer "what came in, what is owed, which way is it trending?".
 */

import { useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { tooltipStyle, axisTick, type ChartPeriod, type ChartType } from '@/components/ChartCard';
import Select from '@/components/Select';
import { CashFlowDonut } from '@/components/dashboards/_FacilityCharts';
import { SadbKpiTile, trendBetween } from '@/components/admin/sadb-ui';
import './billing-kpis.css';
import { addDays } from '@/components/ehr/EhrMiniCalendar';
import { toIsoDate } from '@/lib/date-utils';
import { getMethodConfig } from '@/lib/payment-method-config';
import { formatMoney } from '@/lib/format-utils';
import type { ClaimDoc, PaymentDoc, PaymentMethodType } from '@/lib/db-types-payments';
import type { BillingDoc } from '@/lib/db-types-billing';

/* Same hues as the facility/org dashboards so a user moving between them
   reads the identical colour for the identical meaning. */
const CASH_RECEIVED = 'var(--color-success)';
const CASH_PENDING = 'var(--color-warning)';
const CHART_BLUE = 'var(--chart-1)';
const CHART_TEAL = 'var(--chart-4)';

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

  const { t } = useTranslation();
  const [chartType, setChartType] = useState<ChartType>('line');
  const [period, setPeriod] = useState<ChartPeriod>('month');

  /* Today's and yesterday's posted takings, by the local calendar day, for
     the trend on Collected today. */
  const dayTotals = useMemo(() => {
    const today = toIsoDate(new Date());
    const yesterday = toIsoDate(addDays(new Date(), -1));
    let a = 0; let y = 0;
    for (const p of payments) {
      if (p.status !== 'posted' || !p.processedAt) continue;
      const day = toIsoDate(new Date(p.processedAt));
      if (day === today) a += p.amount;
      else if (day === yesterday) y += p.amount;
    }
    return { today: a, yesterday: y };
  }, [payments]);

  /* Invoices raised this week against the week before. */
  const invoiceWeeks = useMemo(() => {
    const now = Date.now();
    let thisWeek = 0; let lastWeek = 0;
    for (const b of bills) {
      const at = b.createdAt ? new Date(b.createdAt).getTime() : NaN;
      if (at >= now - 7 * 86400000) thisWeek++;
      else if (at >= now - 14 * 86400000) lastWeek++;
    }
    return { thisWeek, lastWeek };
  }, [bills]);

  /* Claims raised this week against the week before. */
  const claimWeeks = useMemo(() => {
    const now = Date.now();
    let thisWeek = 0; let lastWeek = 0;
    for (const c of claims) {
      const when = c.submittedDate || c.createdAt;
      const at = when ? new Date(when).getTime() : NaN;
      if (at >= now - 7 * 86400000) thisWeek++;
      else if (at >= now - 14 * 86400000) lastWeek++;
    }
    return { thisWeek, lastWeek };
  }, [claims]);

  // "Cash SSP 24,000 · m-GURUSH SSP 20,000" — the per-method figures the old
  // stat strip carried, kept as the caption on the day's total.
  const methodSplit = useMemo(() => {
    const parts = Array.from(todayByMethod.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([method, amount]) => `${getMethodConfig(method).shortLabel} ${formatMoney(amount)}`);
    return parts.length ? parts.join(' · ') : undefined;
  }, [todayByMethod]);

  const cashSlices = useMemo(() => [
    { name: t('billing.ovReceived'), value: cash.received, color: CASH_RECEIVED },
    { name: t('billing.ovPending'), value: cash.pending, color: CASH_PENDING },
  ].filter(d => d.value > 0), [cash, t]);

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
    <>
    {/* ── The figures, as the management KPI band (2026-11-04): label, value,
          what it is made of, and which way it moved where the records carry a
          date. They were a six-row "Billing summary" list in the middle card;
          the cash-flow ring and the collections trend keep the row below. ── */}
    <div className="sadb-kpi-row bl-kpis" data-tour="billing-overview-kpis">
      <SadbKpiTile
        label={t('billing.kpiCollectedToday')}
        value={formatMoney(collectedToday)}
        delta={methodSplit ?? t('billing.kpiNoPaymentsToday')}
        trend={{ direction: trendBetween(dayTotals.today, dayTotals.yesterday), label: t('billing.kpiVsYesterday', { amount: formatMoney(dayTotals.yesterday) }) }}
      />
      <SadbKpiTile
        label={t('billing.kpiInvoices')}
        value={counts.invoices.toLocaleString()}
        delta={t('billing.kpiInvoicesDetail', { paid: counts.paid, pending: counts.pending })}
        trend={{ direction: trendBetween(invoiceWeeks.thisWeek, invoiceWeeks.lastWeek), label: t('billing.kpiThisWeekVsLast', { thisWeek: invoiceWeeks.thisWeek, lastWeek: invoiceWeeks.lastWeek }) }}
      />
      <SadbKpiTile
        label={t('billing.kpiOutstandingPatients')}
        value={outstandingPatients.toLocaleString()}
        delta={t('billing.kpiOwed', { amount: formatMoney(cash.pending) })}
        deltaTone={outstandingPatients > 0 ? 'warn' : undefined}
      />
      {showClaims && (
        <SadbKpiTile
          label={t('billing.kpiOpenClaims')}
          value={counts.openClaims.toLocaleString()}
          delta={t('billing.kpiOpenClaimsDetail')}
          trend={{ direction: trendBetween(claimWeeks.thisWeek, claimWeeks.lastWeek), label: t('billing.kpiClaimsWeekVsLast', { thisWeek: claimWeeks.thisWeek, lastWeek: claimWeeks.lastWeek }) }}
        />
      )}
      <SadbKpiTile
        label={t('billing.kpiUnbilled')}
        value={unbilledEncounters.toLocaleString()}
        delta={t('billing.kpiUnbilledDetail')}
        deltaTone={unbilledEncounters > 0 ? 'warn' : undefined}
      />
    </div>

    <div className="bl-overview-cards" data-tour="billing-overview">

      {/* ── 1. Cash flow: the ring carries the weight, the amounts caption it ── */}
      <section className="bl-ov-card">
        <header className="bl-ov-head">
          <h2 className="bl-ov-title">{t('billing.ovCashFlow')}</h2>
          <span className="bl-ov-meta">{t('billing.ovAllInvoices')}</span>
        </header>
        <div className="bl-ov-cash">
          <div className="bl-ov-ring">
            <CashFlowDonut data={cashSlices} />
            <div className="bl-ov-ring-label">
              <span className="bl-ov-ring-value">{formatMoney(cash.total)}</span>
              <span className="bl-ov-ring-cap">{t('billing.ovTotalInvoiced')}</span>
            </div>
          </div>
          <dl className="bl-ov-legend">
            <div>
              <dt><span className="bl-ov-dot" style={{ background: CASH_RECEIVED }} />{t('billing.ovReceived')}</dt>
              <dd>{formatMoney(cash.received)}</dd>
            </div>
            <div>
              <dt><span className="bl-ov-dot" style={{ background: CASH_PENDING }} />{t('billing.ovPending')}</dt>
              <dd>{formatMoney(cash.pending)}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── 2. The trend: collections against what was billed to payers ── */}
      <section className="bl-ov-card">
        <header className="bl-ov-head">
          <h2 className="bl-ov-title">{showClaims ? t('billing.ovCollectionsClaims') : t('billing.ovDailyCollections')}</h2>
          <div className="bl-ov-fields">
            <label className="bl-ov-field">
              <span>{t('billing.ovChartType')}</span>
              <Select value={chartType} onChange={e => setChartType(e.target.value as ChartType)} data-action="billing-chart-type">
                <option value="line">{t('billing.ovTypeLine')}</option>
                <option value="area">{t('billing.ovTypeArea')}</option>
                <option value="bar">{t('billing.ovTypeBar')}</option>
              </Select>
            </label>
            <label className="bl-ov-field">
              <span>{t('billing.ovPeriod')}</span>
              <Select value={period} onChange={e => setPeriod(e.target.value as ChartPeriod)} data-action="billing-chart-period">
                <option value="week">{t('billing.ovPeriodWeek')}</option>
                <option value="month">{t('billing.ovPeriodMonth')}</option>
                <option value="quarter">{t('billing.ovPeriodQuarter')}</option>
              </Select>
            </label>
          </div>
        </header>
        <div className="bl-ov-chart">
        {(() => {
          const data = trendFor(period);
          const series = showClaims
            ? [
                { key: 'collected', name: t('billing.ovCollected'), color: CHART_TEAL },
                { key: 'claimed', name: t('billing.ovClaimed'), color: CHART_BLUE },
              ]
            : [{ key: 'collected', name: t('billing.ovCollected'), color: CHART_TEAL }];
          const axes = (
            <>
              <CartesianGrid stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} width={40} tickFormatter={compactAmount} />
              <Tooltip {...tooltipStyle} formatter={(v: number | undefined) => formatMoney(v ?? 0)} />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
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
        })()}
        </div>
      </section>
    </div>
    </>
  );
}
