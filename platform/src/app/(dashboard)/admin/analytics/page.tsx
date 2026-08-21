'use client';

/**
 * Super-admin → Platform Analytics.
 *
 * Reduced 2026-08-21 from twelve cards to four. What went, and why:
 *
 *  - "Growth Trend (Simulated)" multiplied today's totals by a rising factor
 *    across six hardcoded month labels. There is no historical timeseries
 *    source, so in demo mode it drew fabricated growth and outside it drew a
 *    flat zero line. Neither is information an operator can act on.
 *  - "Patients per Organization" and "Users per Organization" were bar charts
 *    of the same two numbers the Organization Metrics table already carries,
 *    and they stop being readable past a handful of tenants.
 *  - The Plans and Status donuts were two cards for a legend; the table's own
 *    Plan and Status columns say it per row, and the card head now carries the
 *    status mix in one line.
 *  - "Top Actions" ranked `element || eventName`, and only eight elements in
 *    the whole app carry a `data-track` attribute — so it was dominated by
 *    session bookkeeping (already the Sessions tile) and generic DOM
 *    descriptors like `button|type=button`. Restore it once the interactions
 *    worth counting are actually annotated.
 *  - "Activity by Organization" listed raw org ids. Its numbers are now the
 *    Events column of the Organization Metrics table, resolved to org names.
 *
 * It deliberately does NOT grow a Sync column: /admin/organizations owns
 * tenant health (facilities, seats, sync, status), this screen owns tenant
 * usage (patients, users, events). Two tables that differ are worth more than
 * two tables that nearly match.
 */

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { Activity } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Line, AreaChart, Area, CartesianGrid, ComposedChart, Legend,
} from 'recharts';
import { tooltipStyle as chartTooltipStyle, axisTick, AreaGradients } from '@/components/ChartCard';
import {
  SadbPage, SadbCard, SadbKpiTile, SadbPanelHeader, SadbGridList, SadbGridRow, SadbKvRow, SadbChip, statusChip,
} from '@/components/admin/sadb-ui';

/** Local day bucket — the trend is read the way a operator reads a calendar,
 *  in local days, not UTC slices. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dailySeries(dates: string[], days: number): Array<{ day: string; count: number }> {
  const counts = new Map<string, number>();
  for (const iso of dates) {
    if (iso) counts.set(dayKey(iso), (counts.get(dayKey(iso)) || 0) + 1);
  }
  const today = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i));
    const key = dayKey(d.toISOString());
    return { day: key, count: counts.get(key) || 0 };
  });
}

interface OrgDataPoint {
  orgId: string;
  name: string;
  patients: number;
  users: number;
  color: string;
}

interface UsageSummary {
  dau: number;
  wau: number;
  sessionCount: number;
  eventCount: number;
  dauTrend: Array<{ date: string; users: number; events: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  perOrg?: Array<{ orgId: string; users: number; events: number }>;
}

/** Organization · Patients · Users · Events · Plan · Status. */
const ORG_TABLE_TEMPLATE = 'minmax(180px, 1.6fr) repeat(5, minmax(90px, 1fr))';

export default function AdminAnalyticsPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { organizations, loading: orgsLoading, getStats } = useOrganizations();

  const [orgData, setOrgData] = useState<OrgDataPoint[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [activity, setActivity] = useState<{ encounters: string[]; failures: string[] } | null>(null);

  // Load per-org stats — parallelised (was a sequential for-await loop).
  useEffect(() => {
    if (organizations.length === 0) return;
    let cancelled = false;
    (async () => {
      setDataLoading(true);
      const dataPoints = await Promise.all(organizations.map(async (org): Promise<OrgDataPoint> => {
        const name = org.name.length > 18 ? org.name.slice(0, 16) + '...' : org.name;
        try {
          const stats = await getStats(org._id);
          return { orgId: org._id, name, patients: stats.patientCount, users: stats.userCount, color: org.primaryColor || 'var(--color-success)' };
        } catch {
          return { orgId: org._id, name, patients: 0, users: 0, color: org.primaryColor || 'var(--color-success)' };
        }
      }));
      if (!cancelled) {
        setOrgData(dataPoints);
        setDataLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [organizations, getStats]);

  useEffect(() => {
    if (!currentUser || currentUser.role !== 'super_admin') return;
    let cancelled = false;
    (async () => {
      setUsageLoading(true);
      try {
        const res = await fetch('/api/usage/summary?days=30');
        if (res.ok) {
          const data = await res.json() as UsageSummary;
          if (!cancelled) setUsage(data);
        }
      } catch {
        /* ignore — usage panel stays empty */
      } finally {
        if (!cancelled) setUsageLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  // Platform activity — encounters against failed privileged actions, read
  // from the same local stores the super-admin dashboard reads (this card
  // used to live there; Analytics is where trends belong).
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'super_admin') return;
    let cancelled = false;
    (async () => {
      try {
        const [{ getAllEncounters }, { getRecentAuditLogs }] = await Promise.all([
          import('@/lib/services/encounter-service'),
          import('@/lib/services/audit-service'),
        ]);
        const [encounters, logs] = await Promise.all([getAllEncounters(), getRecentAuditLogs(1000)]);
        if (cancelled) return;
        setActivity({
          encounters: encounters.map(e => e.createdAt || e.startedAt || '').filter(Boolean),
          failures: logs.filter(l => l.success === false).map(l => l.createdAt).filter(Boolean),
        });
      } catch (err) {
        console.error('Failed to load platform activity:', err);
        if (!cancelled) setActivity({ encounters: [], failures: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const activityTrend = useMemo(() => {
    const enc = dailySeries(activity?.encounters || [], 14);
    const fails = dailySeries(activity?.failures || [], 14);
    return enc.map((p, i) => ({
      day: new Date(`${p.day}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      encounters: p.count,
      failures: fails[i]?.count || 0,
    }));
  }, [activity]);

  /* Failures ride a hidden second axis (drawn against their own scale) so one
     failed login stays visible next to a thousand encounters; the tooltip
     still reports the raw counts. */
  const failAxisMax = useMemo(
    () => Math.ceil(Math.max(4, ...activityTrend.map(t => t.failures)) * 1.4),
    [activityTrend],
  );

  /** Per-org lookup keyed by org id (was a positional orgData[i] join, which
   *  broke silently the moment the two arrays fell out of order). */
  const orgDataById = useMemo(() => new Map(orgData.map(d => [d.orgId, d] as const)), [orgData]);

  /* Per-org event counts, folded in from what used to be its own "Activity by
     Organization" card. Events raised by platform-level users carry no orgId
     and land in usage's `(none)` bucket — they belong to no tenant row, so the
     column intentionally does not sum to the Events tile. */
  const eventsByOrg = useMemo(
    () => new Map((usage?.perOrg || []).map(r => [r.orgId, r.events] as const)),
    [usage],
  );

  const totalUsersAll = orgData.reduce((s, d) => s + d.users, 0);
  const totalPatientsAll = orgData.reduce((s, d) => s + d.patients, 0);

  /* Status mix for the table's head — what the Status donut used to draw,
     in the legend strip /admin/organizations already uses. */
  const statusMix = [
    { label: t('analytics.statusActive'), count: organizations.filter(o => o.subscriptionStatus === 'active').length, color: 'var(--color-success-800)' },
    { label: t('analytics.statusTrial'), count: organizations.filter(o => o.subscriptionStatus === 'trial').length, color: 'var(--color-warning-600)' },
    { label: t('analytics.statusSuspended'), count: organizations.filter(o => o.subscriptionStatus === 'suspended' || o.subscriptionStatus === 'cancelled').length, color: 'var(--color-danger-500)' },
  ];

  function renderActivityChart() {
    if (!activity) {
      return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('analytics.loadingChartData')}</p></div>;
    }
    if (activity.encounters.length === 0 && activity.failures.length === 0) {
      return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('analytics.noActivityYet')}</p></div>;
    }
    return (
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={activityTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} barCategoryGap="28%">
          <CartesianGrid stroke="var(--border-light)" vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
          <YAxis
            tickLine={false} axisLine={false} tick={axisTick} width={38} allowDecimals={false}
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(v))}
          />
          <YAxis yAxisId="failures" hide domain={[0, failAxisMax]} />
          <Tooltip {...chartTooltipStyle} />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          <Area type="monotone" dataKey="encounters" name={t('analytics.legendEncounters')} stroke="var(--accent-primary)" strokeWidth={2} fill="var(--accent-primary)" fillOpacity={0.14} isAnimationActive={false} />
          <Line yAxisId="failures" type="monotone" dataKey="failures" name={t('analytics.legendAuditFailures')} stroke="var(--color-danger-500)" strokeWidth={1.8} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  function renderDauChart() {
    if (usageLoading) {
      return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('analytics.loadingChartData')}</p></div>;
    }
    if (!usage?.dauTrend?.length || usage.dauTrend.every(d => !d.users && !d.events)) {
      return (
        <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon={Activity} title={t('analytics.noUsageYet')} message={t('analytics.noDataShort')} />
        </div>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={usage.dauTrend} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <AreaGradients />
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
          <XAxis dataKey="date" tick={axisTick} tickFormatter={(v: string) => v.slice(5)} />
          <YAxis tick={axisTick} />
          <Tooltip {...chartTooltipStyle} />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          <Area type="monotone" dataKey="users" name={t('analytics.legendUsers')} stroke="var(--accent-primary)" fill="url(#grad1)" strokeWidth={2} />
          <Area type="monotone" dataKey="events" name={t('analytics.events')} stroke="var(--color-success)" fill="var(--color-success)" fillOpacity={0.12} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <SadbPage>
      <SadbPanelHeader title={t('analytics.title')} />

      {/* One vitals row — platform totals and the 30-day usage window that used
          to sit in a second "Usage" row further down the page. */}
      <div className="sadb-kpi-row">
        <SadbKpiTile label={t('analytics.totalOrganizations')} value={organizations.length.toLocaleString()} />
        <SadbKpiTile label={t('analytics.totalUsers')} value={totalUsersAll.toLocaleString()} />
        <SadbKpiTile label={t('patients.kpiTotalPatients')} value={totalPatientsAll.toLocaleString()} />
        <SadbKpiTile label={t('analytics.sessions30d')} value={usage ? usage.sessionCount.toLocaleString() : '—'} />
        <SadbKpiTile label={t('analytics.events30d')} value={usage ? usage.eventCount.toLocaleString() : '—'} />
      </div>

      {/* Platform activity — real encounters vs failed privileged actions.
          Moved here from the super-admin dashboard, which now carries sync &
          interoperability in that slot. */}
      <SadbCard title={t('analytics.platformActivity')} meta={t('analytics.platformActivityMeta')}>
        <div className="px-3 pt-3 pb-1">{renderActivityChart()}</div>
      </SadbCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <SadbCard
          title={t('analytics.dauTrend')}
          meta={usage
            ? `${t('analytics.dau')} ${usage.dau} · ${t('analytics.wau')} ${usage.wau} · ${t('analytics.last30Days')}`
            : t('analytics.last30Days')}
        >
          <div className="px-3 pt-3 pb-1">{renderDauChart()}</div>
        </SadbCard>

        <SadbCard title={t('analytics.topModules')} meta={t('analytics.last30Days')}>
          <div className="p-2">
            {!usage?.topPaths?.length ? (
              <p className="sadb-empty">{t('analytics.noDataShort')}</p>
            ) : (
              usage.topPaths.slice(0, 8).map(row => (
                <SadbKvRow
                  key={row.path}
                  label={<span className="font-mono truncate block">{row.path}</span>}
                  value={row.count.toLocaleString()}
                />
              ))
            )}
          </div>
        </SadbCard>
      </div>

      {/* Per-org metrics — the one place tenant numbers are compared, now
          carrying the usage column that used to be its own card. */}
      <SadbCard
        title={t('analytics.organizationMetrics')}
        action={
          <div className="sadb-legend">
            <span><i style={{ background: 'var(--text-muted)' }} />{t('analytics.legendOrganizations')} ({organizations.length})</span>
            {statusMix.map(s => (
              <span key={s.label}><i style={{ background: s.color }} />{s.label} ({s.count})</span>
            ))}
          </div>
        }
      >
        <SadbGridList
          template={ORG_TABLE_TEMPLATE}
          minWidth={720}
          head={[
            t('analytics.colOrganization'), t('analytics.colPatients'), t('analytics.colUsers'),
            t('analytics.colEvents30d'), t('analytics.colPlan'),
            t('analytics.colStatus'),
          ]}
          alignEndLast
          empty={dataLoading || orgsLoading ? t('analytics.loadingChartData') : t('status.noData')}
        >
          {organizations.map(org => {
            const data = orgDataById.get(org._id);
            const events = eventsByOrg.get(org._id);
            return (
              <SadbGridRow key={org._id} template={ORG_TABLE_TEMPLATE}>
                <span className="min-w-0 flex items-center gap-2">
                  <span
                    className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                    style={{ background: org.primaryColor }}
                  >
                    {org.name.charAt(0)}
                  </span>
                  <span className="sadb-tenant-name truncate">{org.name}</span>
                </span>
                <span className="sadb-tenant-num" style={{ color: 'var(--color-success-text)' }}>{data ? data.patients.toLocaleString() : '…'}</span>
                <span className="sadb-tenant-num" style={{ color: 'var(--accent-primary)' }}>{data ? data.users.toLocaleString() : '…'}</span>
                <span className="sadb-tenant-num">{usageLoading ? '…' : (events ?? 0).toLocaleString()}</span>
                <span className="capitalize">{org.subscriptionPlan}</span>
                <span style={{ textAlign: 'end' }}>
                  <SadbChip tone={statusChip(org.subscriptionStatus)}>{org.subscriptionStatus}</SadbChip>
                </span>
              </SadbGridRow>
            );
          })}
        </SadbGridList>
      </SadbCard>
    </SadbPage>
  );
}
