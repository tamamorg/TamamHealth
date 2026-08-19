'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/context';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { TrendingUp, Activity } from '@/components/icons/lucide';
import EmptyState from '@/components/EmptyState';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, CartesianGrid, Legend
} from 'recharts';
import { tooltipStyle as chartTooltipStyle, axisTick, AreaGradients } from '@/components/ChartCard';
import {
  SadbPage, SadbCard, SadbKpiTile, SadbPanelHeader, SadbGridList, SadbGridRow, SadbKvRow, SadbChip, statusChip,
} from '@/components/admin/sadb-ui';

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

type ChartMode = 'line' | 'area' | 'bar';

const ORG_TABLE_TEMPLATE = 'minmax(180px, 1.6fr) repeat(4, minmax(90px, 1fr))';
const ACTIVITY_TABLE_TEMPLATE = 'minmax(140px, 1.6fr) repeat(2, minmax(80px, 1fr))';

/** The dashboard's line/area/bar chart-mode pills (see /admin's "Platform
 *  activity" card) — the sadb replacement for ChartCard's own head, which
 *  clashes with the sadb card chrome. */
function ChartModePills({ mode, onChange }: { mode: ChartMode; onChange: (m: ChartMode) => void }) {
  return (
    <div className="flex gap-1">
      {(['line', 'area', 'bar'] as const).map(m => (
        <button
          key={m}
          type="button"
          className={`sadb-pill${mode === m ? ' is-active' : ''}`}
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { organizations, loading: orgsLoading, getStats } = useOrganizations();

  const [orgData, setOrgData] = useState<OrgDataPoint[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [orgChartMode, setOrgChartMode] = useState<ChartMode>('bar');
  const [growthChartMode, setGrowthChartMode] = useState<ChartMode>('line');
  const [usersChartMode, setUsersChartMode] = useState<ChartMode>('bar');

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

  /** Per-org lookup keyed by org id (was a positional orgData[i] join, which
   *  broke silently the moment the two arrays fell out of order). */
  const orgDataById = useMemo(() => new Map(orgData.map(d => [d.orgId, d] as const)), [orgData]);

  // Plan distribution data for pie chart.
  const planDistribution = [
    { name: t('analytics.planBasic'), value: organizations.filter(o => o.subscriptionPlan === 'basic').length, color: 'var(--text-muted)' },
    { name: t('analytics.planProfessional'), value: organizations.filter(o => o.subscriptionPlan === 'professional').length, color: 'var(--accent-primary)' },
    { name: t('analytics.planEnterprise'), value: organizations.filter(o => o.subscriptionPlan === 'enterprise').length, color: 'var(--accent-purple)' },
  ].filter(d => d.value > 0);

  // Status distribution for pie chart.
  const statusDistribution = [
    { name: t('analytics.statusActive'), value: organizations.filter(o => o.subscriptionStatus === 'active').length, color: 'var(--color-success)' },
    { name: t('analytics.statusTrial'), value: organizations.filter(o => o.subscriptionStatus === 'trial').length, color: 'var(--color-warning)' },
    { name: t('analytics.statusSuspended'), value: organizations.filter(o => o.subscriptionStatus === 'suspended').length, color: 'var(--color-danger)' },
    { name: t('analytics.statusCancelled'), value: organizations.filter(o => o.subscriptionStatus === 'cancelled').length, color: 'var(--text-muted)' },
  ].filter(d => d.value > 0);

  const totalUsersAll = orgData.reduce((s, d) => s + d.users, 0);
  const totalPatientsAll = orgData.reduce((s, d) => s + d.patients, 0);
  const avgPatientsPerOrg = organizations.length > 0 ? Math.round(totalPatientsAll / organizations.length) : 0;

  // Growth chart. There is no historical timeseries source yet, so in demo
  // mode we synthesize a smoothly-rising curve from the current totals so the
  // chart is not empty. In production this collapses to a flat zero line —
  // an empty chart is far less harmful than fabricated growth statistics
  // shown to operators making trend decisions.
  const months = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'];
  const showSyntheticGrowth = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
  const growthData = months.map((month, i) => {
    if (!showSyntheticGrowth) {
      return { month, users: 0, patients: 0, organizations: 0 };
    }
    const factor = 0.5 + (i * 0.1);
    return {
      month,
      users: Math.round(totalUsersAll * factor) || Math.round((i + 1) * 5),
      patients: Math.round(totalPatientsAll * factor) || Math.round((i + 1) * 20),
      organizations: Math.round(organizations.length * (0.6 + i * 0.08)) || (i + 1),
    };
  });

  function renderPatientsChart(mode: ChartMode) {
    if (dataLoading || orgsLoading) {
      return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('analytics.loadingChartData')}</p></div>;
    }
    if (orgData.length === 0) {
      return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('status.noData')}</p></div>;
    }
    const commonProps = { data: orgData, margin: { top: 5, right: 10, left: 0, bottom: 5 } };
    if (mode === 'area') {
      return (
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart {...commonProps}>
            <AreaGradients />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey="name" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip {...chartTooltipStyle} />
            <Area type="monotone" dataKey="patients" stroke="var(--accent-primary)" fill="url(#grad1)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (mode === 'line') {
      return (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey="name" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip {...chartTooltipStyle} />
            <Line type="monotone" dataKey="patients" stroke="var(--accent-primary)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart {...commonProps}>
          <XAxis dataKey="name" tick={axisTick} />
          <YAxis tick={axisTick} />
          <Tooltip {...chartTooltipStyle} />
          <Bar dataKey="patients" fill="var(--accent-primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  function renderGrowthChart(mode: ChartMode) {
    if (growthData.length === 0 || growthData.every(d => !d.users && !d.patients && !d.organizations)) {
      return (
        <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon={TrendingUp} title="No data yet" message="No growth data to display for this period." />
        </div>
      );
    }
    const commonProps = { data: growthData, margin: { top: 5, right: 10, left: 0, bottom: 5 } };
    const lines = [
      { key: 'users', color: 'var(--accent-primary)', name: t('analytics.legendUsers') },
      { key: 'patients', color: 'var(--color-success-text)', name: t('analytics.legendPatients') },
      { key: 'organizations', color: 'var(--accent-purple)', name: t('analytics.legendOrganizations') },
    ];
    if (mode === 'area') {
      return (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart {...commonProps}>
            <AreaGradients />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey="month" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip {...chartTooltipStyle} />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            {lines.map(l => <Area key={l.key} type="monotone" dataKey={l.key} stroke={l.color} fill={l.color} fillOpacity={0.12} strokeWidth={2} name={l.name} />)}
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (mode === 'bar') {
      return (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey="month" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip {...chartTooltipStyle} />
            <Legend wrapperStyle={{ fontSize: '11px' }} />
            {lines.map(l => <Bar key={l.key} dataKey={l.key} fill={l.color} radius={[3, 3, 0, 0]} name={l.name} />)}
          </BarChart>
        </ResponsiveContainer>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={260}>
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
          <XAxis dataKey="month" tick={axisTick} />
          <YAxis tick={axisTick} />
          <Tooltip {...chartTooltipStyle} />
          <Legend wrapperStyle={{ fontSize: '11px' }} />
          {lines.map(l => <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={2} dot={{ r: 3 }} name={l.name} />)}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  function renderUsersChart(mode: ChartMode) {
    if (dataLoading || orgsLoading) {
      return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('status.loading')}</p></div>;
    }
    if (orgData.length === 0) {
      return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('status.noData')}</p></div>;
    }
    const commonProps = { data: orgData, margin: { top: 5, right: 10, left: 0, bottom: 5 } };
    if (mode === 'area') {
      return (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart {...commonProps}>
            <AreaGradients color1="var(--color-warning)" />
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey="name" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip {...chartTooltipStyle} />
            <Area type="monotone" dataKey="users" stroke="var(--color-warning)" fill="url(#grad1)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (mode === 'line') {
      return (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey="name" tick={axisTick} />
            <YAxis tick={axisTick} />
            <Tooltip {...chartTooltipStyle} />
            <Line type="monotone" dataKey="users" stroke="var(--color-warning)" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart {...commonProps}>
          <XAxis dataKey="name" tick={axisTick} />
          <YAxis tick={axisTick} />
          <Tooltip {...chartTooltipStyle} />
          <Bar dataKey="users" fill="var(--color-warning)" radius={[4, 4, 0, 0]} />
        </BarChart>
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

      {/* Summary KPIs */}
      <div className="sadb-kpi-row">
        <SadbKpiTile label={t('analytics.totalOrganizations')} value={organizations.length.toLocaleString()} />
        <SadbKpiTile label={t('analytics.totalUsers')} value={totalUsersAll.toLocaleString()} />
        <SadbKpiTile label={t('patients.kpiTotalPatients')} value={totalPatientsAll.toLocaleString()} />
        <SadbKpiTile label={t('analytics.avgPatientsPerOrg')} value={avgPatientsPerOrg.toLocaleString()} />
      </div>

      {/* Charts row 1: patients-per-org chart + plan/status pies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        <SadbCard
          className="lg:col-span-2"
          title={t('analytics.patientsPerOrganization')}
          action={<ChartModePills mode={orgChartMode} onChange={setOrgChartMode} />}
        >
          <div className="px-3 pt-3 pb-1">{renderPatientsChart(orgChartMode)}</div>
        </SadbCard>

        <div className="flex flex-col gap-3.5">
          <SadbCard title={t('analytics.plansHeading')}>
            <div className="p-4">
              {planDistribution.length === 0 ? (
                <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{t('analytics.noDataShort')}</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={120} height={120}>
                    <PieChart>
                      <Pie data={planDistribution} dataKey="value" cx="50%" cy="50%" outerRadius={50} innerRadius={30}>
                        {planDistribution.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="data-row-divider-sm">
                    {planDistribution.map(d => (
                      <div key={d.name} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                        <span className="text-xs font-bold" style={{ color: d.color }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SadbCard>

          <SadbCard title={t('analytics.statusHeading')}>
            <div className="p-4">
              {statusDistribution.length === 0 ? (
                <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>{t('analytics.noDataShort')}</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width={120} height={120}>
                    <PieChart>
                      <Pie data={statusDistribution} dataKey="value" cx="50%" cy="50%" outerRadius={50} innerRadius={30}>
                        {statusDistribution.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="data-row-divider-sm">
                    {statusDistribution.map(d => (
                      <div key={d.name} className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                        <span className="text-xs font-bold" style={{ color: d.color }}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SadbCard>
        </div>
      </div>

      {/* Charts row 2: growth trend (simulated, demo-mode gated) + users-per-org */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <SadbCard
          title={t('analytics.growthTrendSimulated')}
          action={<ChartModePills mode={growthChartMode} onChange={setGrowthChartMode} />}
        >
          <div className="px-3 pt-3 pb-1">{renderGrowthChart(growthChartMode)}</div>
        </SadbCard>

        <SadbCard
          title={t('analytics.usersPerOrganization')}
          action={<ChartModePills mode={usersChartMode} onChange={setUsersChartMode} />}
        >
          <div className="px-3 pt-3 pb-1">{renderUsersChart(usersChartMode)}</div>
        </SadbCard>
      </div>

      {/* Per-org metrics */}
      <SadbCard title={t('analytics.organizationMetrics')} meta={`${organizations.length} organizations`}>
        <SadbGridList
          template={ORG_TABLE_TEMPLATE}
          minWidth={640}
          head={[t('analytics.colOrganization'), t('analytics.colPatients'), t('analytics.colUsers'), t('analytics.colPlan'), t('analytics.colStatus')]}
          empty={t('status.noData')}
        >
          {organizations.map(org => {
            const data = orgDataById.get(org._id);
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
                <span className="capitalize">{org.subscriptionPlan}</span>
                <span><SadbChip tone={statusChip(org.subscriptionStatus)}>{org.subscriptionStatus}</SadbChip></span>
              </SadbGridRow>
            );
          })}
        </SadbGridList>
      </SadbCard>

      {/* Usage metrics (real interaction data) */}
      <SadbPanelHeader title={t('analytics.usageHeading')} />

      <div className="sadb-kpi-row">
        <SadbKpiTile label={t('analytics.dau')} value={usage ? usage.dau.toLocaleString() : '—'} />
        <SadbKpiTile label={t('analytics.wau')} value={usage ? usage.wau.toLocaleString() : '—'} />
        <SadbKpiTile label={t('analytics.sessions')} value={usage ? usage.sessionCount.toLocaleString() : '—'} />
        <SadbKpiTile label={t('analytics.events')} value={usage ? usage.eventCount.toLocaleString() : '—'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <SadbCard title={t('analytics.dauTrend')} meta="Last 30 days">
          <div className="px-3 pt-3 pb-1">{renderDauChart()}</div>
        </SadbCard>

        <SadbCard title={t('analytics.topModules')}>
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
        <SadbCard title={t('analytics.topActions')}>
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

        <SadbCard title={t('analytics.perOrgActivity')} meta={`${usage?.perOrg?.length ?? 0} organizations`}>
          <SadbGridList
            template={ACTIVITY_TABLE_TEMPLATE}
            minWidth={360}
            head={[t('analytics.colOrgId'), t('analytics.colUsers'), t('analytics.colEvents')]}
            empty={t('analytics.noDataShort')}
          >
            {(usage?.perOrg || []).slice(0, 12).map(row => (
              <SadbGridRow key={row.orgId} template={ACTIVITY_TABLE_TEMPLATE}>
                <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{row.orgId}</span>
                <span className="sadb-tenant-num" style={{ color: 'var(--accent-primary)' }}>{row.users.toLocaleString()}</span>
                <span className="sadb-tenant-num">{row.events.toLocaleString()}</span>
              </SadbGridRow>
            ))}
          </SadbGridList>
        </SadbCard>
      </div>
    </SadbPage>
  );
}
