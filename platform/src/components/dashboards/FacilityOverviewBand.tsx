'use client';

/**
 * The organization/facility headline band that sits above the Facility
 * Management work queue.
 *
 * This *is* the former standalone "Org Overview" page (`/org-admin`, deleted):
 * its five headline KPIs and its four operational-status tiles moved here so an
 * org admin reads ONE dashboard instead of switching between two screens that
 * each held half the picture — the queue knew about staff, inquiries and leave,
 * the overview knew about facilities, visits, inpatients, revenue and stock,
 * and neither could answer "how is the organization doing today".
 *
 * Kept in its own file behind a pure builder (`buildOverviewBand`) so the
 * numbers are unit-testable without a DOM — same shape as `buildFacilityOverview`
 * in FacilityManagementDashboard.
 *
 * Every tile is previewable, never a bare navigation: the host dashboard owns a
 * single `?preview=<key>` param and one dialog, so browser Back closes a preview
 * exactly as it does for the Facility Overview rail metrics.
 */

import { formatMoney } from '@/lib/format-utils';
import {
  Building2, Users, CalendarClock, BedDouble, DollarSign,
  Wallet, Package, Receipt, type LucideIcon,
} from '@/components/icons/lucide';

export interface OverviewBillingSummary {
  totalRevenue: number;
  totalOutstanding: number;
  totalWaived: number;
  billCount: number;
  paidCount: number;
  pendingCount: number;
  currency: string;
}

export interface OverviewStockAlerts {
  low: number;
  critical: number;
  expired: number;
}

/** 14-point stat-tile sparkline: de-emphasis line, current day as an accent
 *  dot with a 2px surface ring. The dot is HTML-positioned so the stretched
 *  SVG never distorts it. Decorative — the tile's value/sub text carry the data. */
export function Sparkline({ points, accent, height = 26 }: { points: number[]; accent: string; height?: number }) {
  const width = 100;
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const stepX = width / (points.length - 1);
  const yFor = (v: number) => height - 2 - (v / max) * (height - 4);
  const path = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${yFor(v).toFixed(1)}`)
    .join(' ');
  const lastY = yFor(points[points.length - 1]);
  return (
    <div className="relative w-full" style={{ height }} aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <path d={path} fill="none" stroke="var(--text-muted)" strokeOpacity={0.4} strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute w-2 h-2 rounded-full"
        style={{ background: accent, right: -3, top: lastY, transform: 'translateY(-50%)', boxShadow: '0 0 0 2px var(--bg-card-solid)' }}
      />
    </div>
  );
}

/** Single-ratio meter: severity-colored fill on a lighter track of the same hue. */
export function MeterBar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, background: `color-mix(in srgb, ${color} 16%, transparent)` }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color, transition: 'width 0.3s ease' }} />
    </div>
  );
}

/** Part-to-whole segment bar with 2px surface gaps; counts are labeled in the
 *  tile's detail line, so color is never the only channel. */
export function SegmentBar({ segments, height = 6 }: { segments: { value: number; color: string }[]; height?: number }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return <div className="w-full rounded-full" style={{ height, background: 'var(--overlay-light)' }} aria-hidden="true" />;
  }
  return (
    <div className="w-full flex" style={{ height, gap: 2 }} aria-hidden="true">
      {segments.filter(s => s.value > 0).map((s, i) => (
        <div key={i} className="rounded-full" style={{ flexGrow: s.value, minWidth: 6, background: s.color }} />
      ))}
    </div>
  );
}

/** Stat-tile contract: label · value · optional signed delta vs yesterday ·
 *  optional 14-day trend (sparkline) or single-ratio meter. */
export interface OverviewKpi {
  key: string;
  label: string;
  value: string;
  /** The line under the figure, reused as the preview dialog's detail. */
  sub: string;
  /** Where the preview's "Open full page" lands. */
  href: string;
  icon: LucideIcon;
  color: string;
  delta?: { text: string; color: string };
  trend?: number[];
  trendCaption?: string;
  meterPct?: number;
}

export interface OverviewStatusTile {
  key: string;
  label: string;
  value: string | number;
  detail: string;
  href: string;
  icon: LucideIcon;
  tone: 'ok' | 'warning' | 'danger';
  segments?: { value: number; color: string }[];
  meterPct?: number;
}

export interface OverviewBand {
  kpis: OverviewKpi[];
  statusTiles: OverviewStatusTile[];
}

export interface OverviewBandInput {
  /** Local calendar day (YYYY-MM-DD). `appointmentDate` is a calendar day, not
   *  a UTC instant, so today's visits are matched against this. */
  today: string;
  /** UTC day slice. Admission/discharge/payment timestamps are stored as
   *  `new Date().toISOString()`, so they are sliced the same way here. */
  todayUtc: string;
  /** The 14 local calendar days ending at `today`, oldest first. */
  last14Local: string[];
  /** The 14 UTC days ending at `todayUtc`, oldest first. */
  last14Utc: string[];
  hospitals: { _id: string }[];
  appointments: { appointmentDate: string }[];
  admissions: { admissionDate?: string; dischargeDate?: string }[];
  activeAdmissionCount: number;
  users: { isActive?: boolean }[];
  /** True once the users fetch has failed with nothing cached — the staff tile
   *  must read as "unknown" (—), never as a quiet zero. Same rule the Facility
   *  Overview rail metrics follow. */
  usersUnavailable: boolean;
  /** The one staff list this role has (`usersHrefForRole`). */
  usersHref: string;
  payments: { amount: number; status: string; processedAt: string }[];
  claims: { status: string }[];
  stockAlerts: OverviewStockAlerts;
  billing: OverviewBillingSummary | null;
  totalBeds: number;
  availableBeds: number;
  occupancyRate: number;
  /** The organization's own primary colour, when it has one. */
  brandColor: string;
}

/**
 * Pure combiner: every input is an already-resolved, already-scoped value, so
 * this only exercises the assembling logic (counts, series, hrefs, tones) and
 * never data fetching or tenancy filtering.
 */
export function buildOverviewBand(input: OverviewBandInput): OverviewBand {
  const {
    today, todayUtc, last14Local, last14Utc, hospitals, appointments, admissions,
    activeAdmissionCount, users, usersUnavailable, usersHref, payments, claims,
    stockAlerts, billing, totalBeds, availableBeds, occupancyRate, brandColor,
  } = input;

  const currency = billing?.currency || 'SSP';

  const todaysVisits = appointments.filter(a => a.appointmentDate === today).length;
  const admissionsToday = admissions.filter(a => (a.admissionDate || '').slice(0, 10) === todayUtc).length;
  const dischargesToday = admissions.filter(a => (a.dischargeDate || '').slice(0, 10) === todayUtc).length;

  const activeUsers = users.filter(u => u.isActive !== false);
  const inactiveCount = users.length - activeUsers.length;
  const activeStaffPct = users.length > 0 ? (activeUsers.length / users.length) * 100 : 0;

  const revenueToday = payments
    .filter(p => p.status === 'posted' && (p.processedAt || '').slice(0, 10) === todayUtc)
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const pendingClaims = claims.filter(c => c.status === 'submitted');
  const totalStockAlerts = stockAlerts.low + stockAlerts.critical + stockAlerts.expired;

  // ── 14-day trend series ──
  const visitsByDay = new Map<string, number>();
  for (const a of appointments) visitsByDay.set(a.appointmentDate, (visitsByDay.get(a.appointmentDate) || 0) + 1);
  const visitsSeries = last14Local.map(d => visitsByDay.get(d) || 0);
  const visitsYesterday = visitsSeries[visitsSeries.length - 2] ?? 0;
  const visitsDelta = todaysVisits - visitsYesterday;

  // Inpatient census per day: admitted on/before the day and not yet discharged.
  const censusSeries = last14Utc.map(day => admissions.filter(a => {
    const admitted = (a.admissionDate || '').slice(0, 10);
    const discharged = (a.dischargeDate || '').slice(0, 10);
    return admitted && admitted <= day && (!discharged || discharged > day);
  }).length);

  const revenueByDay = new Map<string, number>();
  for (const p of payments) {
    if (p.status !== 'posted') continue;
    const day = (p.processedAt || '').slice(0, 10);
    revenueByDay.set(day, (revenueByDay.get(day) || 0) + (p.amount || 0));
  }
  const revenueSeries = last14Utc.map(d => revenueByDay.get(d) || 0);
  const revenueYesterday = revenueSeries[revenueSeries.length - 2] ?? 0;
  const revenueDelta = revenueToday - revenueYesterday;

  const kpis: OverviewKpi[] = [
    {
      key: 'kpi-facilities',
      label: 'Active Facilities',
      value: hospitals.length.toLocaleString(),
      sub: `${hospitals.length === 1 ? '1 facility' : `${hospitals.length} facilities`} in your organization`,
      href: '/hospitals',
      icon: Building2,
      color: brandColor,
    },
    {
      key: 'kpi-visits',
      label: "Today's Visits",
      value: todaysVisits.toLocaleString(),
      sub: 'Appointments scheduled today, across facilities',
      // The appointments page has no date deep-link param, so this lands on the
      // module itself rather than emitting a query nothing reads.
      href: '/appointments',
      icon: CalendarClock,
      color: 'var(--accent-primary)',
      delta: { text: `${visitsDelta > 0 ? '+' : ''}${visitsDelta} vs yesterday`, color: 'var(--text-muted)' },
      trend: visitsSeries,
      trendCaption: 'Visits per day, last 14 days',
    },
    {
      key: 'kpi-inpatients',
      label: 'Current Inpatients',
      value: activeAdmissionCount.toLocaleString(),
      sub: `${admissionsToday} admitted · ${dischargesToday} discharged today`,
      href: '/wards',
      icon: BedDouble,
      color: 'var(--chart-3)',
      trend: censusSeries,
      trendCaption: 'Inpatient census, last 14 days',
    },
    {
      key: 'kpi-staff-active',
      label: 'Staff Accounts Active',
      value: usersUnavailable ? '—' : activeUsers.length.toLocaleString(),
      sub: usersUnavailable
        ? 'Staff accounts could not be loaded'
        : `${inactiveCount} inactive account${inactiveCount === 1 ? '' : 's'}`,
      // The one staff list this role has — the same destination Total Staff,
      // Total Doctors and Total Nurses use, so every staff figure on the
      // dashboard lands on the roster instead of dead-ending in a dialog.
      href: usersHref,
      icon: Users,
      color: '#369FDA',
      meterPct: usersUnavailable ? 0 : activeStaffPct,
    },
    {
      key: 'kpi-revenue',
      label: 'Revenue Collected Today',
      value: formatMoney(revenueToday, { currency }),
      sub: `${formatMoney(billing?.totalOutstanding, { currency })} outstanding org-wide`,
      href: '/payments',
      icon: DollarSign,
      color: 'var(--color-success)',
      delta: {
        text: `${revenueDelta > 0 ? '+' : revenueDelta < 0 ? '−' : ''}${formatMoney(Math.abs(revenueDelta), { currency })} vs yesterday`,
        color: revenueDelta > 0 ? 'var(--color-success)' : revenueDelta < 0 ? 'var(--color-danger)' : 'var(--text-muted)',
      },
      trend: revenueSeries,
      trendCaption: 'Revenue posted per day, last 14 days',
    },
  ];

  // Each tile carries a small part-to-whole visual under the figure: a segment
  // bar for the stock breakdown, meters for the single ratios. The detail line
  // spells out every count, so color never carries the data alone.
  const statusTiles: OverviewStatusTile[] = [
    {
      key: 'ops-stock',
      label: 'Pharmacy Stock Alerts',
      value: totalStockAlerts,
      detail: `${stockAlerts.critical} critical · ${stockAlerts.low} low · ${stockAlerts.expired} expired`,
      icon: Package,
      tone: totalStockAlerts > 0 ? 'warning' : 'ok',
      href: '/pharmacy?panel=stock',
      segments: [
        { value: stockAlerts.critical, color: 'var(--color-danger)' },
        { value: stockAlerts.low, color: 'var(--color-warning)' },
        { value: stockAlerts.expired, color: 'var(--text-muted)' },
      ],
    },
    {
      key: 'ops-claims',
      label: 'Pending Claims',
      value: pendingClaims.length,
      detail: `${claims.length} total claims submitted`,
      icon: Receipt,
      tone: pendingClaims.length > 0 ? 'warning' : 'ok',
      href: '/payments/claims?status=submitted',
      meterPct: claims.length > 0 ? (pendingClaims.length / claims.length) * 100 : 0,
    },
    {
      key: 'ops-billing',
      label: 'Outstanding Balance',
      value: formatMoney(billing?.totalOutstanding, { currency }),
      detail: `${billing?.pendingCount ?? 0} of ${billing?.billCount ?? 0} bills pending or partial`,
      icon: Wallet,
      tone: (billing?.totalOutstanding ?? 0) > 0 ? 'warning' : 'ok',
      href: '/payments',
      meterPct: billing && billing.billCount > 0 ? (billing.pendingCount / billing.billCount) * 100 : 0,
    },
    {
      key: 'ops-beds',
      label: 'Bed Capacity',
      value: `${occupancyRate}%`,
      detail: `${availableBeds} available of ${totalBeds} beds`,
      icon: BedDouble,
      tone: occupancyRate >= 90 ? 'danger' : occupancyRate >= 75 ? 'warning' : 'ok',
      href: '/wards',
      meterPct: occupancyRate,
    },
  ];

  return { kpis, statusTiles };
}

/** Flattens the band into the host dashboard's previewable-item shape, so one
 *  `?preview=` param and one dialog serve the band and the rail alike. */
export function overviewBandPreviewItems(band: OverviewBand): {
  key: string; label: string; value: string | number; href: string; detail: string;
}[] {
  return [
    ...band.kpis.map(k => ({ key: k.key, label: k.label, value: k.value, href: k.href, detail: k.sub })),
    ...band.statusTiles.map(t => ({ key: t.key, label: t.label, value: t.value, href: t.href, detail: t.detail })),
  ];
}

export default function FacilityOverviewBand({ band, onPreview }: {
  band: OverviewBand;
  /** Opens the shared preview dialog for a tile key. Tiles never navigate on
   *  click — "Open full page" inside the dialog is the explicit action. */
  onPreview: (key: string) => void;
}) {
  return (
    <div data-tour="org-overview-band">
      {/* ═══ KPI tiles ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3">
        {band.kpis.map(card => {
          const Icon = card.icon;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => onPreview(card.key)}
              className="dash-card flex flex-col text-start transition-all hover:opacity-90"
              style={{ padding: '14px 16px' }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="icon-box-sm">
                  <Icon className="w-3.5 h-3.5" style={{ color: card.color }} />
                </div>
                <span className="kpi-card-title">{card.label}</span>
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <div className="stat-value text-2xl" style={{ color: 'var(--text-primary)', lineHeight: 1, fontWeight: 800 }}>
                  {card.value}
                </div>
                {card.delta && (
                  <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: card.delta.color }}>{card.delta.text}</span>
                )}
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>{card.sub}</p>
              {card.trend && (
                <div className="mt-2" title={card.trendCaption}>
                  <Sparkline points={card.trend} accent={card.color} />
                </div>
              )}
              {card.meterPct !== undefined && (
                <div className="mt-3">
                  <MeterBar pct={card.meterPct} color={card.color} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ Operational status strip ═══ */}
      <div className="dash-card overflow-hidden mb-3">
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Operational Status</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
          {band.statusTiles.map(tile => {
            const Icon = tile.icon;
            const toneColor = tile.tone === 'danger' ? 'var(--color-danger)' : tile.tone === 'warning' ? 'var(--color-warning)' : 'var(--color-success)';
            const toneBg = tile.tone === 'danger' ? 'rgba(229,46,66,0.08)' : tile.tone === 'warning' ? 'rgba(237,161,0,0.10)' : 'rgba(12,163,12,0.08)';
            return (
              <button
                key={tile.key}
                type="button"
                onClick={() => onPreview(tile.key)}
                className="text-start rounded-xl p-3 transition-all hover:opacity-90"
                style={{ background: toneBg, border: `1px solid ${toneColor}33` }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="w-4 h-4" style={{ color: toneColor }} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{tile.label}</span>
                </div>
                <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{tile.value}</div>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{tile.detail}</p>
                <div className="mt-2.5">
                  {tile.segments
                    ? <SegmentBar segments={tile.segments} />
                    : <MeterBar pct={tile.meterPct ?? 0} color={toneColor} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
