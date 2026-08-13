'use client';

/**
 * Super-admin Platform Dashboard — the command center, drawn in the shared
 * dashboard language used by the organization-admin dashboard: greeting
 * header, `dash-card` rows, a ChartCard trend, and an EhrListHeader list.
 *
 * It still answers "is the platform healthy today?" in one screen: readiness
 * meter, platform totals, activity trend, tenant health matrix, risk queue,
 * security watchlist, sync/interop, business snapshot, quick commands. Every
 * number comes from real local stores (PouchDB docs, audit log, sync events,
 * conflicts API) — nothing simulated.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/context';
import { apiFetch } from '@/lib/api-fetch';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import DashboardGreetingHeader from '@/components/dashboard/DashboardGreetingHeader';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import ChartCard, { tooltipStyle, axisTick } from '@/components/ChartCard';
import { classifyAuditRisk, formatWhen, type SaSeverity } from '@/components/admin/sa-ui';
import { useBackupStatus } from '@/lib/hooks/useBackupStatus';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Legend,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, Building2, ChevronRight, HeartPulse, Server, Users,
} from '@/components/icons/lucide';
import type { AuditLogDoc, EncounterDoc, UserDoc } from '@/lib/db-types';

/* Shared chart palette (dataviz-validated, same hues as the other dashboards). */
const CHART_BLUE = '#2a78d6';
const CHART_RED = '#e34948';
const GREEN = '#199e70';
const AMBER = '#eda100';

type Tone = 'ok' | 'warn' | 'danger' | 'muted';

/* Tinted-surface tokens: the "Received / Pending" tile treatment from the
   org-admin Cash Flow card, generalised to the four platform tones. */
const TONE_STYLE: Record<Tone, { fill: string; text: string; tint: string; border: string }> = {
  ok: { fill: GREEN, text: '#167755', tint: 'rgba(25,158,112,0.10)', border: 'rgba(25,158,112,0.28)' },
  warn: { fill: AMBER, text: '#a16207', tint: 'rgba(237,161,0,0.12)', border: 'rgba(237,161,0,0.35)' },
  danger: { fill: CHART_RED, text: '#C24135', tint: 'rgba(227,73,72,0.10)', border: 'rgba(227,73,72,0.30)' },
  muted: { fill: 'var(--text-muted)', text: 'var(--text-secondary)', tint: 'var(--overlay-subtle)', border: 'var(--border-light)' },
};

const SEVERITY_PILL: Record<SaSeverity, Tone> = {
  critical: 'danger', high: 'danger', medium: 'warn', low: 'muted',
};

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

interface RiskRow {
  severity: SaSeverity;
  title: string;
  detail: string;
  when?: string;
  href: string;
}

/* ── Small presentational pieces (org-dashboard card anatomy) ───────── */

function CardHead({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div className="flex items-center gap-3">
        {meta && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{meta}</span>}
        {action}
      </div>
    </div>
  );
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONE_STYLE[tone];
  return (
    <span
      className="inline-flex items-center rounded-full text-[11px] font-bold px-2 py-0.5 capitalize whitespace-nowrap"
      style={{ background: t.tint, border: `1px solid ${t.border}`, color: t.text }}
    >
      {children}
    </span>
  );
}

function KvRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px]"
      style={last ? undefined : { borderBottom: '1px solid var(--border-light)' }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="font-bold tabular-nums text-right" style={{ color: 'var(--text-primary)' }}>{children}</span>
    </div>
  );
}

/** Row in the risk / watchlist queues — same anatomy as the org-admin lists. */
function QueueRow({ tone, tag, title, detail, when, onClick }: {
  tone: Tone; tag: string; title: string; detail: string; when?: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-5 py-2.5 text-left hover:bg-[var(--overlay-subtle)]"
      style={{ borderBottom: '1px solid var(--border-light)' }}
    >
      <Pill tone={tone}>{tag}</Pill>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>{title}</span>
        <span className="block text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{detail}</span>
      </span>
      {when && <time className="text-[11px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{formatWhen(when)}</time>}
      <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
    </button>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { organizations } = useOrganizations();
  const { hospitals } = useHospitals();
  const { config } = usePlatformConfig();

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [patientAgg, setPatientAgg] = useState({ total: 0, byOrg: new Map<string, number>() });
  const [encounters, setEncounters] = useState<EncounterDoc[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);
  const [syncStats, setSyncStats] = useState({ total: 0, pending: 0, synced: 0, failed: 0, oldestPending: undefined as string | undefined });
  const [conflictCount, setConflictCount] = useState(0);
  const [dhis2, setDhis2] = useState<{ configured: boolean; host: string; lastPush?: string }>({ configured: false, host: 'Not configured' });
  const [loading, setLoading] = useState(true);
  const [tenantSearch, setTenantSearch] = useState('');

  // Defense in depth on top of the Edge proxy check (SaPage used to own this).
  useEffect(() => {
    if (currentUser && currentUser.role !== 'super_admin') router.replace('/dashboard');
  }, [currentUser, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ getAllUsers }, { getAllPatients }, { getAllEncounters }, { getRecentAuditLogs }, { getSyncEventStats }] =
          await Promise.all([
            import('@/lib/services/user-service'),
            import('@/lib/services/patient-service'),
            import('@/lib/services/encounter-service'),
            import('@/lib/services/audit-service'),
            import('@/lib/services/sync-event-service'),
          ]);
        const [allUsers, allPatients, allEncounters, logs, sync] = await Promise.all([
          getAllUsers(), getAllPatients(), getAllEncounters(), getRecentAuditLogs(500), getSyncEventStats(),
        ]);
        if (cancelled) return;
        setUsers(allUsers);
        const byOrg = new Map<string, number>();
        for (const p of allPatients) {
          if (p.orgId) byOrg.set(p.orgId, (byOrg.get(p.orgId) || 0) + 1);
        }
        setPatientAgg({ total: allPatients.length, byOrg });
        setEncounters(allEncounters);
        setAuditLogs(logs);
        setSyncStats({ total: sync.total, pending: sync.pending, synced: sync.synced, failed: sync.failed, oldestPending: sync.oldestPending });
      } catch (err) {
        console.error('Failed to load platform dashboard data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    (async () => {
      try {
        const res = await apiFetch('/api/admin/conflicts?status=pending');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setConflictCount(Array.isArray(data.conflicts) ? data.conflicts.length : Array.isArray(data) ? data.length : 0);
        }
      } catch { /* offline — conflicts stay 0 */ }
    })();

    (async () => {
      try {
        const mod = await import('@/lib/services/dhis2-sync-log-service');
        const configured = mod.isDhis2Configured();
        const host = configured ? (mod.getDhis2BaseUrlHost() || 'Configured') : 'Not configured';
        const log = await mod.getDhis2SyncLog();
        if (!cancelled) setDhis2({ configured, host, lastPush: log.lastSyncedAt || log.lastAttemptAt });
      } catch { /* DHIS2 module unavailable */ }
    })();

    return () => { cancelled = true; };
  }, []);

  /* ── Derived signals ─────────────────────────────────────────────── */

  const activeOrgs = organizations.filter(o => o.isActive && o.subscriptionStatus !== 'suspended' && o.subscriptionStatus !== 'cancelled');
  const suspendedOrgs = organizations.filter(o => o.subscriptionStatus === 'suspended' || o.subscriptionStatus === 'cancelled' || !o.isActive);
  const trialOrgs = organizations.filter(o => o.subscriptionStatus === 'trial');

  const weekAgo = Date.now() - 7 * 86400000;
  const failedAudits = useMemo(
    () => auditLogs.filter(l => l.success === false && new Date(l.createdAt).getTime() >= weekAgo),
    [auditLogs, weekAgo],
  );
  const highRiskAudits = useMemo(
    () => auditLogs.filter(l => {
      const sev = classifyAuditRisk(l.action, l.success);
      return (sev === 'critical' || sev === 'high' || sev === 'medium') && new Date(l.createdAt).getTime() >= weekAgo;
    }).slice(0, 6),
    [auditLogs, weekAgo],
  );

  const todayKey = dayKey(new Date().toISOString());
  const encountersToday = useMemo(
    () => encounters.filter(e => dayKey(e.createdAt || e.startedAt || '') === todayKey).length,
    [encounters, todayKey],
  );

  const syncRate = syncStats.total > 0 ? Math.round((syncStats.synced / syncStats.total) * 100) : 100;
  const syncTone: Tone = syncStats.failed > 0 ? 'danger' : syncStats.pending > 0 ? 'warn' : 'ok';

  // One source, three-way state (KAN-117). This previously read a localStorage
  // key nothing ever wrote and treated its absence as `Infinity` hours old —
  // reporting the backup as definitively overdue, a measured-sounding claim
  // about something never measured.
  const rpoHours = config?.superAdminPolicies?.backupRpoHours ?? 24;
  const backupStatus = useBackupStatus(rpoHours);
  const backupAgeHours = backupStatus?.ageHours ?? null;
  const backupOverdue = backupStatus?.state === 'overdue';
  const backupUnknown = backupStatus?.state === 'unknown';

  const readiness = Math.max(0, Math.min(100,
    100
    - suspendedOrgs.length * 8
    - failedAudits.length * 5
    - syncStats.failed * 6
    - conflictCount * 4
    - (syncStats.pending > 0 ? 4 : 0)
    - (backupOverdue ? 6 : 0)
    - (config?.maintenanceMode ? 10 : 0),
  ));
  const readinessTone: Tone = readiness >= 88 ? 'ok' : readiness >= 70 ? 'warn' : 'danger';

  /* Risk & incident queue, worst first. */
  const riskQueue = useMemo(() => {
    const rows: RiskRow[] = [];
    for (const log of failedAudits.slice(0, 3)) {
      rows.push({
        severity: classifyAuditRisk(log.action, log.success),
        title: `Audit failure — ${log.action}`,
        detail: log.username ? `${log.username} · ${log.details}` : log.details,
        when: log.createdAt,
        href: '/admin/audit',
      });
    }
    if (syncStats.failed > 0) {
      rows.push({ severity: 'high', title: `${syncStats.failed} sync job${syncStats.failed === 1 ? '' : 's'} failed`, detail: 'Replication to country node', href: '/admin/sync' });
    }
    if (conflictCount > 0) {
      rows.push({ severity: 'medium', title: `${conflictCount} unresolved data conflict${conflictCount === 1 ? '' : 's'}`, detail: 'Reconciliation queue', href: '/admin/conflicts' });
    }
    for (const org of suspendedOrgs) {
      rows.push({ severity: 'medium', title: `Tenant ${org.subscriptionStatus === 'cancelled' ? 'cancelled' : 'suspended'} — ${org.name}`, detail: `${org.subscriptionPlan} plan`, href: '/admin/organizations' });
    }
    if (backupOverdue) {
      rows.push({
        severity: 'high',
        title: 'Backup overdue',
        detail: `Last backup ${formatWhen(backupStatus!.lastBackupAt!)} · RPO ${rpoHours}h`,
        href: '/admin/security',
      });
    } else if (backupUnknown) {
      // Distinct from overdue, and deliberately still a risk row: "we cannot
      // tell whether backups are running" is an operational problem worth an
      // administrator's attention — it is just not the same problem as a
      // backup that is known to be late.
      rows.push({
        severity: 'medium',
        title: 'Backup status unknown',
        detail: `Nothing has reported a backup · RPO ${rpoHours}h`,
        href: '/admin/security',
      });
    }
    if (config?.maintenanceMode) {
      rows.push({ severity: 'medium', title: 'Maintenance mode is ON', detail: 'Tenant access is restricted', href: '/admin/config' });
    }
    for (const org of trialOrgs) {
      rows.push({ severity: 'low', title: `Trial tenant — ${org.name}`, detail: `${org.maxUsers} seat limit`, href: '/admin/billing' });
    }
    const order: SaSeverity[] = ['critical', 'high', 'medium', 'low'];
    return rows.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)).slice(0, 8);
  }, [failedAudits, syncStats.failed, conflictCount, suspendedOrgs, trialOrgs, backupOverdue, backupUnknown, backupStatus, rpoHours, config?.maintenanceMode]);

  /* Tenant health matrix (searchable). */
  const tenantMatrix = useMemo(() => {
    const q = tenantSearch.trim().toLowerCase();
    return organizations
      .filter(org => !q || org.name.toLowerCase().includes(q) || org.subscriptionPlan.toLowerCase().includes(q) || org.subscriptionStatus.toLowerCase().includes(q))
      .map(org => {
        const orgFacilities = hospitals.filter(h => h.orgId === org._id);
        return {
          org,
          users: users.filter(u => u.orgId === org._id).length,
          facilities: orgFacilities.length,
          offline: orgFacilities.filter(h => h.syncStatus === 'offline').length,
          patients: patientAgg.byOrg.get(org._id) || 0,
          lastActivity: auditLogs.find(l => l.orgId === org._id)?.createdAt,
        };
      });
  }, [organizations, users, hospitals, auditLogs, patientAgg, tenantSearch]);

  /* 14-day activity trend (encounters vs audit failures). */
  const trend = useMemo(() => {
    const enc = dailySeries(encounters.map(e => e.createdAt || e.startedAt || '').filter(Boolean), 14);
    const fails = dailySeries(auditLogs.filter(l => !l.success).map(l => l.createdAt), 14);
    return enc.map((p, i) => ({
      day: new Date(`${p.day}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' }),
      encounters: p.count,
      failures: fails[i]?.count || 0,
    }));
  }, [encounters, auditLogs]);

  /* Business snapshot. */
  const licensedSeats = organizations.reduce((sum, o) => sum + (o.maxUsers || 0), 0);
  const planCounts = ['enterprise', 'professional', 'basic'].map(plan => ({
    plan,
    count: organizations.filter(o => o.subscriptionPlan === plan).length,
  })).filter(p => p.count > 0);

  const statusTone = (s: string): Tone =>
    s === 'active' ? 'ok' : s === 'trial' ? 'warn' : s === 'suspended' || s === 'cancelled' ? 'danger' : 'muted';

  const openRiskTone: Tone = riskQueue.some(r => r.severity === 'critical' || r.severity === 'high')
    ? 'danger'
    : riskQueue.length ? 'warn' : 'ok';

  // Readiness meter: filled arc in the tone colour, track a light step of the
  // same hue so the state reads across the whole ring.
  const readinessArc = [
    { name: 'Ready', value: readiness, color: TONE_STYLE[readinessTone].fill },
    { name: 'Gap', value: Math.max(0, 100 - readiness), color: TONE_STYLE[readinessTone].tint },
  ];

  const stat = (icon: ReactNode, label: ReactNode, value: number | string) => (
    <div className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div className="icon-box-sm">{icon}</div>
      <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );

  if (!currentUser || currentUser.role !== 'super_admin') return null;

  return (
    <main className="page-container page-enter">
      <DashboardGreetingHeader
        actions={(
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => router.push('/admin/audit')}>Audit logs</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => router.push('/admin/risk')}>Open Risk Center</button>
          </>
        )}
      />

      {/* The page scrolls as a whole (four card rows overflow the viewport), so
          rows size to their content rather than competing for leftover height. */}
      <div className="flex flex-col gap-3">

        {/* ═══ ROW 1 — Readiness · Platform totals · Activity trend ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

          {/* Platform readiness — meter + the two signals that move it */}
          <div className="dash-card overflow-hidden">
            <CardHead title="Platform Readiness" meta={readinessTone === 'ok' ? 'Steady' : readinessTone === 'warn' ? 'Watch list active' : 'Attention required'} />
            <div className="flex items-center gap-4 p-4">
              <div className="relative flex-shrink-0" style={{ width: 128, height: 128 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={readinessArc} dataKey="value" innerRadius={44} outerRadius={60} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                      {readinessArc.map(d => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-2xl font-bold leading-none" style={{ color: 'var(--text-primary)' }}>{loading ? '…' : readiness}</span>
                  <span className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>Readiness</span>
                </div>
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                <div className="rounded-xl p-2.5" style={{ background: TONE_STYLE[openRiskTone].tint, border: `1px solid ${TONE_STYLE[openRiskTone].border}` }}>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Open risks</p>
                  <p className="text-base font-bold" style={{ color: TONE_STYLE[openRiskTone].text }}>
                    {riskQueue.length} open <span className="text-[11px] font-semibold">· {failedAudits.length} audit failures 7d</span>
                  </p>
                </div>
                <div className="rounded-xl p-2.5" style={{ background: TONE_STYLE[syncTone].tint, border: `1px solid ${TONE_STYLE[syncTone].border}` }}>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Sync health</p>
                  <p className="text-base font-bold" style={{ color: TONE_STYLE[syncTone].text }}>
                    {syncRate}% <span className="text-[11px] font-semibold">· {syncStats.pending} pending · {syncStats.failed} failed</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Platform totals — the stat list, matching the org dashboard */}
          <div className="dash-card overflow-hidden">
            <div className="p-5 flex flex-col justify-center h-full">
              {stat(<Building2 className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} />, <>Total <b>Organizations</b></>, organizations.length)}
              {stat(<Server className="w-4 h-4" style={{ color: GREEN }} />, <>Total <b>Facilities</b></>, hospitals.length)}
              {stat(<Users className="w-4 h-4" style={{ color: '#7847EB' }} />, <>Total <b>Users</b></>, users.length.toLocaleString())}
              {stat(<HeartPulse className="w-4 h-4" style={{ color: '#FB923C' }} />, <>Total <b>Patients</b></>, patientAgg.total.toLocaleString())}
              <div className="flex items-center gap-3 pt-2.5">
                <div className="icon-box-sm"><Activity className="w-4 h-4" style={{ color: CHART_BLUE }} /></div>
                <span className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>Encounters <b>Today</b></span>
                <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{loading ? '…' : encountersToday}</span>
              </div>
            </div>
          </div>

          {/* Platform activity — encounters vs audit failures, last 14 days */}
          <ChartCard
            title="Platform Activity"
            subtitle="Encounters vs audit failures · 14 days"
            defaultType="area"
            periods={[]}
          >
            {({ chartType }) => {
              const series = [
                { key: 'encounters', name: 'Encounters', color: CHART_BLUE },
                { key: 'failures', name: 'Audit failures', color: CHART_RED },
              ];
              const legendProps = {
                iconType: 'circle' as const,
                iconSize: 8,
                wrapperStyle: { fontSize: 11, paddingTop: 4 },
                formatter: (value: ReactNode) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>,
              };
              const axes = (
                <>
                  <CartesianGrid stroke="var(--border-light)" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tickLine={false} axisLine={false} tick={axisTick} width={28} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} />
                  <Legend {...legendProps} />
                </>
              );
              if (chartType === 'bar') {
                return (
                  <ResponsiveContainer width="100%" height={208}>
                    <BarChart data={trend} margin={{ top: 5, right: 5, left: -10, bottom: 0 }} barCategoryGap="28%">
                      {axes}
                      {series.map(s => (
                        <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} maxBarSize={18} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                );
              }
              if (chartType === 'line') {
                return (
                  <ResponsiveContainer width="100%" height={208}>
                    <LineChart data={trend} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                      {axes}
                      {series.map(s => (
                        <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                );
              }
              return (
                <ResponsiveContainer width="100%" height={208}>
                  <AreaChart data={trend} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    {axes}
                    {series.map(s => (
                      <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              );
            }}
          </ChartCard>
        </div>

        {/* ═══ ROW 2 — Tenant health matrix ═══ */}
        <div className="dash-card overflow-hidden flex flex-col">
          <EhrListHeader
            title="Tenant Health Matrix"
            stats={[
              { label: 'Organizations', value: organizations.length, color: LIST_STAT_COLORS.muted },
              { label: 'Active', value: activeOrgs.length, color: LIST_STAT_COLORS.green },
              { label: 'Trial', value: trialOrgs.length, color: LIST_STAT_COLORS.amber },
              { label: 'Suspended', value: suspendedOrgs.length, color: LIST_STAT_COLORS.blue },
            ]}
            search={{ value: tenantSearch, onChange: setTenantSearch, placeholder: 'Search tenants by name, plan, or status…' }}
            actions={(
              <button type="button" className="btn btn-secondary btn-sm flex-shrink-0" onClick={() => router.push('/admin/organizations')}>
                Manage tenants
              </button>
            )}
          />
          <div className="show-scrollbar" style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 360 }}>
            {tenantMatrix.length === 0 ? (
              <p className="text-[13px] p-8 text-center" style={{ color: 'var(--text-muted)' }}>
                {organizations.length === 0 ? 'No organizations yet.' : 'No tenants match this search.'}
              </p>
            ) : (
              <table className="w-full" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    {['Organization', 'Status', 'Plan', 'Users', 'Facilities', 'Patients', 'Last activity'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tenantMatrix.map(row => (
                    <tr
                      key={row.org._id}
                      onClick={() => router.push('/admin/organizations')}
                      className="cursor-pointer hover:bg-[var(--overlay-subtle)]"
                      style={{ borderBottom: '1px solid var(--border-light)' }}
                    >
                      <td className="px-4 py-3 text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>{row.org.name}</td>
                      <td className="px-4 py-3"><Pill tone={statusTone(row.org.subscriptionStatus)}>{row.org.subscriptionStatus}</Pill></td>
                      <td className="px-4 py-3 text-[12px] capitalize" style={{ color: 'var(--text-secondary)' }}>{row.org.subscriptionPlan}</td>
                      <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>{row.users} / {row.org.maxUsers}</td>
                      <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        <span className="inline-flex items-center gap-1.5">
                          {row.facilities} / {row.org.maxHospitals}
                          {row.offline > 0 && <Pill tone="warn">{row.offline} offline</Pill>}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[12px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>{row.patients.toLocaleString()}</td>
                      <td className="px-4 py-3 text-[12px] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{formatWhen(row.lastActivity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ═══ ROW 3 — Risk queue · Security watchlist ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="dash-card overflow-hidden flex flex-col">
            <CardHead
              title="Risk & Incident Queue"
              meta={`${riskQueue.length} open`}
              action={(
                <button type="button" className="text-[12px] font-medium inline-flex items-center gap-0.5" style={{ color: 'var(--accent-primary)' }} onClick={() => router.push('/admin/risk')}>
                  All <ChevronRight className="w-3 h-3" />
                </button>
              )}
            />
            {riskQueue.length === 0 ? (
              <p className="text-[13px] p-8 text-center" style={{ color: 'var(--text-muted)' }}>No open risk signals — platform steady.</p>
            ) : riskQueue.map((row, i) => (
              <QueueRow
                key={`${row.title}-${i}`}
                tone={SEVERITY_PILL[row.severity]}
                tag={row.severity}
                title={row.title}
                detail={row.detail}
                when={row.when}
                onClick={() => router.push(row.href)}
              />
            ))}
          </div>

          <div className="dash-card overflow-hidden flex flex-col">
            <CardHead
              title="Security Watchlist"
              meta="High-risk actions · 7d"
              action={(
                <button type="button" className="text-[12px] font-medium inline-flex items-center gap-0.5" style={{ color: 'var(--accent-primary)' }} onClick={() => router.push('/admin/audit')}>
                  Audit <ChevronRight className="w-3 h-3" />
                </button>
              )}
            />
            {highRiskAudits.length === 0 ? (
              <p className="text-[13px] p-8 text-center" style={{ color: 'var(--text-muted)' }}>No high-risk actions recorded this week.</p>
            ) : highRiskAudits.map(log => (
              <QueueRow
                key={log._id}
                tone={log.success ? 'warn' : 'danger'}
                tag={log.success ? 'action' : 'failed'}
                title={log.action}
                detail={`${log.username || 'system'} · ${log.details}`}
                when={log.createdAt}
                onClick={() => router.push('/admin/audit')}
              />
            ))}
          </div>
        </div>

        {/* ═══ ROW 4 — Sync & interop · Business snapshot · Quick commands ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="dash-card overflow-hidden">
            <CardHead
              title="Sync & Interoperability"
              action={(
                <button type="button" className="text-[12px] font-medium inline-flex items-center gap-0.5" style={{ color: 'var(--accent-primary)' }} onClick={() => router.push('/admin/sync')}>
                  Open <ChevronRight className="w-3 h-3" />
                </button>
              )}
            />
            <KvRow label="Replication">
              <Pill tone={syncTone}>{syncStats.failed > 0 ? 'Failing' : syncStats.pending > 0 ? 'Backlog' : 'Healthy'}</Pill>
            </KvRow>
            <KvRow label="Pending events">{syncStats.pending}</KvRow>
            <KvRow label="Failed events">{syncStats.failed}</KvRow>
            <KvRow label="Oldest pending">{formatWhen(syncStats.oldestPending)}</KvRow>
            <KvRow label="DHIS2 endpoint">
              <Pill tone={dhis2.configured ? 'ok' : 'muted'}>{dhis2.host}</Pill>
            </KvRow>
            <KvRow label="Last DHIS2 push">{formatWhen(dhis2.lastPush)}</KvRow>
            <KvRow label="Data conflicts" last>{conflictCount}</KvRow>
          </div>

          <div className="dash-card overflow-hidden">
            <CardHead
              title="Business Snapshot"
              action={(
                <button type="button" className="text-[12px] font-medium inline-flex items-center gap-0.5" style={{ color: 'var(--accent-primary)' }} onClick={() => router.push('/admin/billing')}>
                  Billing <ChevronRight className="w-3 h-3" />
                </button>
              )}
            />
            <KvRow label="Active subscriptions">{organizations.filter(o => o.subscriptionStatus === 'active').length}</KvRow>
            <KvRow label="Trials">{trialOrgs.length}</KvRow>
            <KvRow label="Suspended / cancelled">{suspendedOrgs.length}</KvRow>
            <KvRow label="Seats in use" last={planCounts.length === 0}>{users.length} / {licensedSeats}</KvRow>
            {planCounts.map((p, i) => (
              <KvRow key={p.plan} label={`${p.plan.charAt(0).toUpperCase()}${p.plan.slice(1)} plan`} last={i === planCounts.length - 1}>
                {p.count}
              </KvRow>
            ))}
          </div>

          <div className="dash-card overflow-hidden">
            <CardHead title="Quick Commands" />
            <nav className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5" aria-label="Quick command navigation">
              {[
                { href: '/admin/risk', title: 'Risk Center', desc: 'Incidents & reviews' },
                { href: '/admin/audit', title: 'Audit Logs', desc: 'Evidence & export' },
                { href: '/admin/organizations', title: 'Organizations', desc: 'Tenant registry' },
                { href: '/admin/users', title: 'Users & Access', desc: 'Roles & accounts' },
                { href: '/admin/system', title: 'System Health', desc: 'Database stores' },
                { href: '/admin/security', title: 'Security', desc: 'Policies & posture' },
              ].map(cmd => (
                <Link
                  key={cmd.href}
                  href={cmd.href}
                  className="rounded-xl px-3 py-2.5 no-underline hover:border-[var(--accent-primary)]"
                  style={{ border: '1px solid var(--border-light)', background: 'var(--bg-card-solid)' }}
                >
                  <span className="block text-[12.5px] font-extrabold" style={{ color: '#015697' }}>{cmd.title}</span>
                  <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{cmd.desc}</span>
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </main>
  );
}
