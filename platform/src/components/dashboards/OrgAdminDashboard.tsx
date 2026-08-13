'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { useUsers } from '@/lib/hooks/useUsers';
import { useAppointments } from '@/lib/hooks/useAppointments';
import { useWards } from '@/lib/hooks/useWards';
import { formatMoney } from '@/lib/format-utils';
import {
  Building2, Users, CalendarClock, BedDouble, DollarSign,
  Wallet, Package, Receipt, BarChart3, ChevronRight, Activity,
} from '@/components/icons/lucide';
import type { ClaimDoc } from '@/lib/db-types-payments';
import TransferInboxCard from '@/components/patients/TransferInboxCard';

/** Local-calendar-day ISO string (YYYY-MM-DD) — matches how appointmentDate
 *  is entered/stored (a calendar day, not a UTC instant). */
function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface BillingSummary {
  totalRevenue: number;
  totalOutstanding: number;
  totalWaived: number;
  billCount: number;
  paidCount: number;
  pendingCount: number;
  currency: string;
}

/** 14-point stat-tile sparkline: de-emphasis line, current day as an accent
 *  dot with a 2px surface ring. The dot is HTML-positioned so the stretched
 *  SVG never distorts it. Decorative — the tile's value/sub text carry the data. */
function Sparkline({ points, accent, height = 26 }: { points: number[]; accent: string; height?: number }) {
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
function MeterBar({ pct, color, height = 6 }: { pct: number; color: string; height?: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, background: `color-mix(in srgb, ${color} 16%, transparent)` }} aria-hidden="true">
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color, transition: 'width 0.3s ease' }} />
    </div>
  );
}

/** Part-to-whole segment bar with 2px surface gaps; counts are labeled in the
 *  tile's detail line, so color is never the only channel. */
function SegmentBar({ segments, height = 6 }: { segments: { value: number; color: string }[]; height?: number }) {
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

export default function OrgAdminDashboard() {
  const { currentUser } = useAuth();
  const router = useRouter();
  const scope = useDataScope();

  const brandColor = currentUser?.branding?.primaryColor || 'var(--accent-primary)';

  const { hospitals, loading: hospitalsLoading } = useHospitals();
  const { users, loading: usersLoading } = useUsers();
  const { appointments, loading: appointmentsLoading } = useAppointments();
  const {
    admissions, activeAdmissions, totalBeds, occupiedBeds, availableBeds, occupancyRate,
    loading: wardsLoading,
  } = useWards();

  // Billing/claims/pharmacy aren't covered by a shared live-reload hook yet —
  // loaded directly from services (same pattern as FacilityManagementDashboard),
  // scoped org-wide via DataScope (org_admin is an admin role, so filterByScope
  // skips the per-hospital narrowing and returns every facility in the org).
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [payments, setPayments] = useState<{ amount: number; status: string; processedAt: string }[]>([]);
  const [claims, setClaims] = useState<ClaimDoc[]>([]);
  const [stockAlerts, setStockAlerts] = useState({ low: 0, critical: 0, expired: 0 });
  const [financialsLoading, setFinancialsLoading] = useState(true);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      setFinancialsLoading(true);
      try {
        const [
          { getBillingSummary },
          { getAllPayments, getAllClaims },
          { getAllInventory, classifyStockStatus },
        ] = await Promise.all([
          import('@/lib/services/billing-service'),
          import('@/lib/services/payment-service'),
          import('@/lib/services/pharmacy-inventory-service'),
        ]);
        const [summary, paymentDocs, claimDocs, inventoryDocs] = await Promise.all([
          getBillingSummary(scope),
          getAllPayments(scope),
          getAllClaims(scope),
          getAllInventory(scope),
        ]);
        if (cancelled) return;
        setBilling(summary);
        setPayments(paymentDocs);
        setClaims(claimDocs);
        const risky = { low: 0, critical: 0, expired: 0 };
        for (const item of inventoryDocs) {
          const status = classifyStockStatus(item);
          if (status === 'low' || status === 'critical' || status === 'expired') risky[status] += 1;
        }
        setStockAlerts(risky);
      } catch (err) {
        console.error('Failed to load org financial/pharmacy data:', err);
      } finally {
        if (!cancelled) setFinancialsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [scope]);

  const loading = hospitalsLoading || usersLoading || appointmentsLoading || wardsLoading || financialsLoading;

  // ─── Derived, org-wide counts ───
  const today = toIsoDate(new Date());
  // Admission/discharge/payment timestamps are stored as new Date().toISOString()
  // (UTC instants) — sliced consistently the same way elsewhere (NurseDashboard).
  const todayUtc = new Date().toISOString().slice(0, 10);

  const todaysVisits = useMemo(
    () => appointments.filter(a => a.appointmentDate === today).length,
    [appointments, today],
  );

  const admissionsToday = useMemo(
    () => admissions.filter(a => (a.admissionDate || '').slice(0, 10) === todayUtc).length,
    [admissions, todayUtc],
  );
  const dischargesToday = useMemo(
    () => admissions.filter(a => (a.dischargeDate || '').slice(0, 10) === todayUtc).length,
    [admissions, todayUtc],
  );

  const activeUsers = useMemo(() => users.filter(u => u.isActive !== false), [users]);

  const revenueToday = useMemo(
    () => payments
      .filter(p => p.status === 'posted' && (p.processedAt || '').slice(0, 10) === todayUtc)
      .reduce((sum, p) => sum + (p.amount || 0), 0),
    [payments, todayUtc],
  );

  const pendingClaims = useMemo(() => claims.filter(c => c.status === 'submitted'), [claims]);

  const totalStockAlerts = stockAlerts.low + stockAlerts.critical + stockAlerts.expired;

  const currency = billing?.currency || 'SSP';

  // ─── 14-day trend series for the stat-tile sparklines ───
  // Local calendar days for appointments (appointmentDate is a calendar day);
  // UTC-instant slices for admission/payment timestamps — same split as the
  // headline counts above.
  const last14Local = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return toIsoDate(d);
  }), [today]); // eslint-disable-line react-hooks/exhaustive-deps -- re-derive when the calendar day changes
  const last14Utc = useMemo(() => Array.from({ length: 14 }, (_, i) =>
    new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
  ), [todayUtc]); // eslint-disable-line react-hooks/exhaustive-deps -- re-derive when the UTC day changes

  const visitsSeries = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const a of appointments) byDay.set(a.appointmentDate, (byDay.get(a.appointmentDate) || 0) + 1);
    return last14Local.map(d => byDay.get(d) || 0);
  }, [appointments, last14Local]);
  const visitsYesterday = visitsSeries[visitsSeries.length - 2] ?? 0;
  const visitsDelta = todaysVisits - visitsYesterday;

  // Inpatient census per day: admitted on/before the day and not yet discharged.
  const censusSeries = useMemo(() => last14Utc.map(day =>
    admissions.filter(a => {
      const admitted = (a.admissionDate || '').slice(0, 10);
      const discharged = (a.dischargeDate || '').slice(0, 10);
      return admitted && admitted <= day && (!discharged || discharged > day);
    }).length,
  ), [admissions, last14Utc]);

  const revenueSeries = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const p of payments) {
      if (p.status !== 'posted') continue;
      const day = (p.processedAt || '').slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + (p.amount || 0));
    }
    return last14Utc.map(d => byDay.get(d) || 0);
  }, [payments, last14Utc]);
  const revenueYesterday = revenueSeries[revenueSeries.length - 2] ?? 0;
  const revenueDelta = revenueToday - revenueYesterday;

  const activeStaffPct = users.length > 0 ? (activeUsers.length / users.length) * 100 : 0;

  if (!currentUser) return null;

  // Stat-tile contract: label · value · optional signed delta vs yesterday ·
  // optional 14-day trend (sparkline) or single-ratio meter. Facilities has no
  // meaningful daily trend, so it stays a plain figure rather than faking one.
  const kpis: {
    label: string; value: string; sub: string; icon: typeof Building2; color: string;
    delta?: { text: string; color: string };
    trend?: number[]; trendCaption?: string;
    meterPct?: number;
  }[] = [
    {
      label: 'Active Facilities',
      value: hospitals.length.toLocaleString(),
      sub: `${hospitals.length === 1 ? '1 facility' : `${hospitals.length} facilities`} in your organization`,
      icon: Building2,
      color: brandColor,
    },
    {
      label: "Today's Visits",
      value: todaysVisits.toLocaleString(),
      sub: 'Appointments scheduled today, across facilities',
      icon: CalendarClock,
      color: 'var(--accent-primary)',
      delta: { text: `${visitsDelta > 0 ? '+' : ''}${visitsDelta} vs yesterday`, color: 'var(--text-muted)' },
      trend: visitsSeries,
      trendCaption: 'Visits per day, last 14 days',
    },
    {
      label: 'Current Inpatients',
      value: activeAdmissions.length.toLocaleString(),
      sub: `${admissionsToday} admitted · ${dischargesToday} discharged today`,
      icon: BedDouble,
      color: '#8B5CF6',
      trend: censusSeries,
      trendCaption: 'Inpatient census, last 14 days',
    },
    {
      label: 'Staff Accounts Active',
      value: activeUsers.length.toLocaleString(),
      sub: `${users.length - activeUsers.length} inactive account${users.length - activeUsers.length === 1 ? '' : 's'}`,
      icon: Users,
      color: '#369FDA',
      meterPct: activeStaffPct,
    },
    {
      label: 'Revenue Collected Today',
      value: formatMoney(revenueToday, { currency }),
      sub: `${formatMoney(billing?.totalOutstanding, { currency })} outstanding org-wide`,
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
  const riskTiles: {
    key: string; label: string; value: string | number; detail: string;
    icon: typeof Package; tone: 'ok' | 'warning' | 'danger'; onClick: () => void;
    segments?: { value: number; color: string }[];
    meterPct?: number;
  }[] = [
    {
      key: 'stock',
      label: 'Pharmacy Stock Alerts',
      value: totalStockAlerts,
      detail: `${stockAlerts.critical} critical · ${stockAlerts.low} low · ${stockAlerts.expired} expired`,
      icon: Package,
      tone: totalStockAlerts > 0 ? 'warning' : 'ok',
      onClick: () => router.push('/pharmacy'),
      segments: [
        { value: stockAlerts.critical, color: 'var(--color-danger)' },
        { value: stockAlerts.low, color: 'var(--color-warning)' },
        { value: stockAlerts.expired, color: 'var(--text-muted)' },
      ],
    },
    {
      key: 'claims',
      label: 'Pending Claims',
      value: pendingClaims.length,
      detail: `${claims.length} total claims submitted`,
      icon: Receipt,
      tone: pendingClaims.length > 0 ? 'warning' : 'ok',
      onClick: () => router.push('/payments/claims'),
      meterPct: claims.length > 0 ? (pendingClaims.length / claims.length) * 100 : 0,
    },
    {
      key: 'billing',
      label: 'Outstanding Balance',
      value: formatMoney(billing?.totalOutstanding, { currency }),
      detail: `${billing?.pendingCount ?? 0} of ${billing?.billCount ?? 0} bills pending or partial`,
      icon: Wallet,
      tone: (billing?.totalOutstanding ?? 0) > 0 ? 'warning' : 'ok',
      onClick: () => router.push('/payments'),
      meterPct: billing && billing.billCount > 0 ? (billing.pendingCount / billing.billCount) * 100 : 0,
    },
    {
      key: 'beds',
      label: 'Bed Capacity',
      value: `${occupancyRate}%`,
      detail: `${availableBeds} available of ${totalBeds} beds`,
      icon: BedDouble,
      tone: occupancyRate >= 90 ? 'danger' : occupancyRate >= 75 ? 'warning' : 'ok',
      onClick: () => router.push('/wards'),
      meterPct: occupancyRate,
    },
  ];

  const shortcuts = [
    { label: 'Facilities', desc: 'Manage hospitals & clinics', icon: Building2, path: '/hospitals' },
    { label: 'Manage Users', desc: 'Staff accounts & access', icon: Users, path: '/org-admin/users' },
    { label: 'Analytics', desc: 'Usage & activity insights', icon: Activity, path: '/org-admin/analytics' },
    { label: 'Billing & Payments', desc: 'Cash flow, invoices', icon: Wallet, path: '/payments' },
    { label: 'Claims', desc: 'Insurance claim tracking', icon: Receipt, path: '/payments/claims' },
    { label: 'Reports', desc: 'Operational reporting', icon: BarChart3, path: '/reports' },
    { label: 'Service Pricing', desc: 'Fee schedules & pricing', icon: DollarSign, path: '/org-admin/pricing' },
  ];

  if (loading) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: brandColor }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="page-container page-enter">
        {/* ═══ KPI tiles ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4">
          {kpis.map(card => {
            const Icon = card.icon;
            return (
              <div key={card.label} className="dash-card flex flex-col" style={{ padding: '14px 16px' }}>
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
              </div>
            );
          })}
        </div>

        {/* ═══ TRANSFERS AWAITING A DECISION ═══
            Org admins hold accept + force, so facility-addressed transfers with
            no named receiver escalate to them. Renders an empty state when there
            is nothing outstanding. */}
        <div className="mb-4">
          <TransferInboxCard />
        </div>

        {/* ═══ Operational status strip ═══ */}
        <div className="dash-card overflow-hidden mb-4">
          <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Operational Status</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
            {riskTiles.map(tile => {
              const Icon = tile.icon;
              const toneColor = tile.tone === 'danger' ? 'var(--color-danger)' : tile.tone === 'warning' ? 'var(--color-warning)' : 'var(--color-success)';
              const toneBg = tile.tone === 'danger' ? 'rgba(229,46,66,0.08)' : tile.tone === 'warning' ? 'rgba(237,161,0,0.10)' : 'rgba(12,163,12,0.08)';
              return (
                <button
                  key={tile.key}
                  onClick={tile.onClick}
                  className="text-left rounded-xl p-3 transition-all hover:opacity-90"
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

        {/* ═══ Shortcuts ═══ */}
        <div className="dash-card overflow-hidden">
          <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Quick Actions</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
            {shortcuts.map(s => {
              const Icon = s.icon;
              return (
                <button
                  key={s.path}
                  onClick={() => router.push(s.path)}
                  className="flex items-center gap-3 rounded-xl p-3.5 text-left transition-all hover:opacity-90"
                  style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-light)' }}
                >
                  <div className="icon-box-sm flex-shrink-0">
                    <Icon className="w-4 h-4" style={{ color: brandColor }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{s.label}</span>
                    <span className="block text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{s.desc}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
