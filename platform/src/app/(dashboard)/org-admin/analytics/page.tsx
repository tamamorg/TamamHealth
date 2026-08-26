'use client';

/**
 * Organization usage analytics, on the shared admin console kit (sadb-*) —
 * the org-scoped sibling of /admin/analytics, which reads the same
 * /api/usage endpoints and draws the same charts platform-wide. Restyled
 * from the hand-rolled dash-card layout 2026-08-21 so both consoles speak
 * one design language: KPI tile row, sadb cards, KV rows for the top-N
 * lists, and the activity log as a grid list whose header row survives an
 * empty result.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Activity } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import { tooltipStyle as chartTooltipStyle, axisTick, AreaGradients } from '@/components/ChartCard';
import {
  SadbPage, SadbPanelHeader, SadbKpiTile, SadbCard, SadbKvRow, SadbGridList, SadbGridRow,
} from '@/components/admin/sadb-ui';

interface UsageSummary {
  dau: number;
  wau: number;
  sessionCount: number;
  eventCount: number;
  dauTrend: Array<{ date: string; users: number; events: number }>;
  topPaths: Array<{ path: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  perUser: Array<{ userId: string; username?: string; events: number }>;
}

interface UsageEventRow {
  _id: string;
  eventName: string;
  path: string;
  element?: string;
  username?: string;
  userId?: string;
  ts: string;
}

/* Date · User · Action · Path */
const EVENT_GRID = 'minmax(150px, 0.9fr) minmax(120px, 0.8fr) minmax(160px, 1.1fr) minmax(160px, 1.1fr)';

export default function OrgAdminAnalyticsPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.role !== 'org_admin' && currentUser.role !== 'super_admin') return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const orgQ =
          currentUser.role === 'super_admin' && currentUser.orgId
            ? `?orgId=${encodeURIComponent(currentUser.orgId)}&days=30`
            : '?days=30';
        const [sumRes, evRes] = await Promise.all([
          fetch(`/api/usage/summary${orgQ}`),
          fetch('/api/usage/events?limit=50'),
        ]);
        if (!cancelled && sumRes.ok) {
          setUsage(await sumRes.json());
        }
        if (!cancelled && evRes.ok) {
          const body = await evRes.json() as { events?: UsageEventRow[] };
          setEvents(body.events || []);
        }
      } catch {
        /* leave empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const orgName = currentUser?.organization?.name || t('orgAnalytics.yourOrganization');

  function renderDauChart() {
    if (loading) {
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
    <SadbPage roles={['org_admin', 'super_admin']}>
      <SadbPanelHeader
        title={t('orgAnalytics.topBarTitle')}
        note={t('orgAnalytics.subtitle', { org: orgName })}
      />

      {/* ═══ 30-day usage vitals ═══ */}
      <div className="sadb-kpi-row" data-tour="org-analytics-stats">
        <SadbKpiTile label={t('analytics.dau')} value={loading || !usage ? '—' : usage.dau.toLocaleString()} />
        <SadbKpiTile label={t('analytics.wau')} value={loading || !usage ? '—' : usage.wau.toLocaleString()} />
        <SadbKpiTile label={t('analytics.sessions')} value={loading || !usage ? '—' : usage.sessionCount.toLocaleString()} />
        <SadbKpiTile label={t('analytics.events')} value={loading || !usage ? '—' : usage.eventCount.toLocaleString()} />
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <SadbCard title={t('analytics.topActions')} meta={t('analytics.last30Days')}>
          <div className="p-2">
            {!usage?.topActions?.length ? (
              <p className="sadb-empty">{t('analytics.noDataShort')}</p>
            ) : (
              usage.topActions.slice(0, 10).map(row => (
                <SadbKvRow
                  key={row.action}
                  label={<span className="truncate block">{row.action}</span>}
                  value={row.count.toLocaleString()}
                />
              ))
            )}
          </div>
        </SadbCard>

        <SadbCard title={t('orgAdmin.userActivityLog')} meta={`${events.length}`}>
          <SadbGridList
            template={EVENT_GRID}
            minWidth={560}
            head={[t('orgAnalytics.colDate'), t('analytics.colUsers'), t('analytics.colAction'), t('analytics.colPath')]}
            empty={t('analytics.noDataShort')}
          >
            {events.map(ev => (
              <SadbGridRow key={ev._id} template={EVENT_GRID}>
                <span className="sadb-tenant-sub" style={{ whiteSpace: 'nowrap' }}>
                  {ev.ts ? new Date(ev.ts).toLocaleString() : '—'}
                </span>
                <span className="truncate">{ev.username || ev.userId || '—'}</span>
                <span className="truncate">{ev.element || ev.eventName}</span>
                <span className="sadb-tenant-sub font-mono truncate">{ev.path}</span>
              </SadbGridRow>
            ))}
          </SadbGridList>
        </SadbCard>
      </div>
    </SadbPage>
  );
}
