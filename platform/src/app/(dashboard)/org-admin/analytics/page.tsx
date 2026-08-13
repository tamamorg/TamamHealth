'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Activity, Users, BarChart3, LayoutDashboard } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts';
import ChartCard, { tooltipStyle as chartTooltipStyle, axisTick, AreaGradients } from '@/components/ChartCard';

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

export default function OrgAdminAnalyticsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useApp();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<UsageEventRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (currentUser && currentUser.role !== 'org_admin' && currentUser.role !== 'super_admin') {
      router.push('/dashboard');
    }
  }, [currentUser, router]);

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

  if (!currentUser || (currentUser.role !== 'org_admin' && currentUser.role !== 'super_admin')) {
    return null;
  }

  const orgName = currentUser.organization?.name || t('orgAnalytics.yourOrganization');

  return (
    <main className="page-container page-enter">
      <div className="dash-card mb-4" style={{ padding: '16px 20px' }}>
        <span style={{ fontFamily: 'var(--font-platform)', fontWeight: 500, fontSize: 24, color: 'var(--text-primary)' }}>
          {t('orgAnalytics.topBarTitle')}
        </span>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {t('orgAnalytics.subtitle', { org: orgName })}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {[
          { label: t('analytics.dau'), value: usage?.dau, icon: Users, color: 'var(--accent-primary)' },
          { label: t('analytics.wau'), value: usage?.wau, icon: Activity, color: 'var(--accent-primary)' },
          { label: t('analytics.sessions'), value: usage?.sessionCount, icon: LayoutDashboard, color: 'var(--color-success-text)' },
          { label: t('analytics.events'), value: usage?.eventCount, icon: BarChart3, color: 'var(--color-warning-text)' },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="dash-card" style={{ padding: '14px 16px' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="icon-box-sm">
                  <Icon className="w-3.5 h-3.5" style={{ color: stat.color }} />
                </div>
                <span className="kpi-card-title">{stat.label}</span>
              </div>
              <div className="stat-value text-3xl" style={{ color: 'var(--text-primary)', lineHeight: 1, fontWeight: 800 }}>
                {loading || stat.value === undefined ? '—' : Number(stat.value).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ChartCard title={t('analytics.dauTrend')} defaultType="area" defaultPeriod="month">
          {() => {
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
          }}
        </ChartCard>

        <div className="dash-card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('analytics.topModules')}</h3>
          </div>
          <div className="p-4 space-y-2">
            {(usage?.topPaths || []).slice(0, 8).map((row) => (
              <div key={row.path} className="flex justify-between gap-2 text-xs">
                <span className="truncate font-mono" style={{ color: 'var(--text-secondary)' }}>{row.path}</span>
                <span className="font-bold">{row.count}</span>
              </div>
            ))}
            {!usage?.topPaths?.length && (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{t('analytics.noDataShort')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="dash-card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('analytics.topActions')}</h3>
          </div>
          <div className="p-4 space-y-2">
            {(usage?.topActions || []).slice(0, 10).map((row) => (
              <div key={row.action} className="flex justify-between gap-2 text-xs">
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{row.action}</span>
                <span className="font-bold">{row.count}</span>
              </div>
            ))}
            {!usage?.topActions?.length && (
              <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{t('analytics.noDataShort')}</p>
            )}
          </div>
        </div>

        <div className="dash-card overflow-hidden">
          <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('orgAdmin.userActivityLog')}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  {[t('orgAnalytics.colDate'), t('analytics.colUsers'), t('analytics.colAction'), t('analytics.colPath')].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev._id} style={{ borderBottom: '1px solid var(--border-light)' }}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      {ev.ts ? new Date(ev.ts).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {ev.username || ev.userId || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs truncate max-w-[160px]" style={{ color: 'var(--text-primary)' }}>
                      {ev.element || ev.eventName}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono truncate max-w-[140px]" style={{ color: 'var(--text-muted)' }}>
                      {ev.path}
                    </td>
                  </tr>
                ))}
                {!events.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t('analytics.noDataShort')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
