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
 *    of two numbers a table already carries, and they stop being readable past
 *    a handful of tenants.
 *  - The Plans and Status donuts were two cards for a legend; a per-tenant
 *    table's own Plan and Status columns say it per row.
 *  - "Top Actions" ranked `element || eventName`, and only eight elements in
 *    the whole app carry a `data-track` attribute — so it was dominated by
 *    session bookkeeping (already the Sessions tile) and generic DOM
 *    descriptors like `button|type=button`. Restore it once the interactions
 *    worth counting are actually annotated.
 *  - "Activity by Organization" listed raw org ids, which name no tenant.
 *  - The "Organization Metrics" table went 2026-08-21. The super-admin
 *    dashboard now opens on a per-tenant Organizations card — patients, users,
 *    seats, plan, status, and each tenant's facilities — so this was the same
 *    roster read twice, one screen apart, from two different sources.
 *
 * What is left is what only this screen does: platform totals and trends over
 * time. Per-tenant rosters belong to /admin (the dashboard card) and tenant
 * health to /admin/organizations.
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
  SadbPage, SadbCard, SadbKpiTile, SadbPanelHeader, SadbKvRow,
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

export default function AdminAnalyticsPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { organizations, getStats } = useOrganizations();

  const [orgData, setOrgData] = useState<OrgDataPoint[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [activity, setActivity] = useState<{ encounters: string[]; failures: string[] } | null>(null);

  // Load per-org stats — parallelised (was a sequential for-await loop).
  useEffect(() => {
    if (organizations.length === 0) return;
    let cancelled = false;
    (async () => {
      const dataPoints = await Promise.all(organizations.map(async (org): Promise<OrgDataPoint> => {
        const name = org.name.length > 18 ? org.name.slice(0, 16) + '...' : org.name;
        try {
          const stats = await getStats(org._id);
          return { orgId: org._id, name, patients: stats.patientCount, users: stats.userCount, color: org.primaryColor || 'var(--color-success)' };
        } catch {
          return { orgId: org._id, name, patients: 0, users: 0, color: org.primaryColor || 'var(--color-success)' };
        }
      }));
      if (!cancelled) setOrgData(dataPoints);
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

  const totalUsersAll = orgData.reduce((s, d) => s + d.users, 0);
  const totalPatientsAll = orgData.reduce((s, d) => s + d.patients, 0);

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
          <Area type="monotone" dataKey="encounters" name={t('analytics.legendEncounters')} stroke="var(--accent-primary)" strokeWidth={2} fill="var(--accent-primary)" fillOpacity={0.14} isAnimationActive animationDuration={420} animationEasing="ease-out" />
          <Line yAxisId="failures" type="monotone" dataKey="failures" name={t('analytics.legendAuditFailures')} stroke="var(--color-danger-500)" strokeWidth={1.8} strokeDasharray="4 3" dot={false} isAnimationActive animationDuration={420} animationEasing="ease-out" />
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

    </SadbPage>
  );
}
