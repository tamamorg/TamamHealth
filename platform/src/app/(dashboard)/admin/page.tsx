'use client';

/**
 * Super-admin Platform Dashboard — the command center, drawn per the
 * "Super Admin Dashboard.dc.html" design (sadb-* namespace in globals.css):
 * greeting + Command Center eyebrow, a clickable KPI tile row, readiness
 * donut with the two signals that move it, business snapshot, the activity
 * trend with line/area/bar pills, the tenant health matrix as a grid list,
 * and the risk / watchlist / sync cards.
 *
 * It still answers "is the platform healthy today?" in one screen. Every
 * number comes from real local stores (PouchDB docs, audit log, sync events,
 * conflicts API) — nothing simulated; the design's demo deltas are replaced
 * by ones we can actually compute (quarter onboarding from createdAt, the
 * platform/tenant user split, today's peak encounter hour).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { apiFetch } from '@/lib/api-fetch';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useHospitals } from '@/lib/hooks/useHospitals';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { tooltipStyle, axisTick } from '@/components/ChartCard';
import { classifyAuditRisk, formatWhen, type SaSeverity } from '@/components/admin/sa-ui';
import { useBackupStatus } from '@/lib/hooks/useBackupStatus';
import Modal from '@/components/Modal';
import {
  Area, Bar, CartesianGrid, ComposedChart, Legend, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChevronRight, Search, X } from '@/components/icons/lucide';
import type { AuditLogDoc, EncounterDoc, OrganizationDoc, UserDoc } from '@/lib/db-types';

type Tone = 'ok' | 'warn' | 'danger' | 'muted';

/* Design chip/signal tones, keyed by the platform's four signal tones. */
const TONE_CHIP: Record<Tone, string> = {
  ok: 'sadb-chip--green', warn: 'sadb-chip--yellow', danger: 'sadb-chip--red', muted: 'sadb-chip--neutral',
};
const TONE_SIGNAL: Record<Tone, string> = {
  ok: 'sadb-signal--green', warn: 'sadb-signal--yellow', danger: 'sadb-signal--red', muted: '',
};
/* Readiness arc stroke — fill rung of each tone (the design's #0A6E4A green). */
const TONE_STROKE: Record<Tone, string> = {
  ok: 'var(--color-success-800)', warn: 'var(--color-warning-600)',
  danger: 'var(--color-danger-500)', muted: 'var(--text-muted)',
};

const SEVERITY_TONE: Record<SaSeverity, Tone> = {
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

function onboardedLabel(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

interface RiskRow {
  token: string;
  severity: SaSeverity;
  title: string;
  detail: string;
  when?: string;
  href: string;
}

interface DashboardPreview {
  title: string;
  context: string;
  details: Array<{ label: string; value: ReactNode }>;
  href: string;
}

function PreviewDialog({ preview, onClose, onOpen }: {
  preview: DashboardPreview;
  onClose: () => void;
  onOpen: () => void;
}) {
  const titleId = 'admin-dashboard-preview-title';
  return (
    <Modal onClose={onClose} width={520} labelledBy={titleId}>
      <div className="modal-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="sadb-card-meta">{preview.context}</p>
            <h2 id={titleId} className="text-lg font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{preview.title}</h2>
          </div>
          <button type="button" className="p-2 rounded-lg flex-shrink-0" onClick={onClose} aria-label="Close preview">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="py-5">
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
            {preview.details.map(detail => (
              <div key={detail.label} className="sadb-kv" style={{ padding: '12px 14px' }}>
                <span>{detail.label}</span>
                <span className="sadb-kv-value">{detail.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-4" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={onOpen}>Open full page</button>
        </div>
      </div>
    </Modal>
  );
}

function CardHead({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="sadb-card-head">
      <h3 className="sadb-card-title">{title}</h3>
      {(meta || action) && (
        <div className="flex items-center gap-3">
          {meta && <span className="sadb-card-meta">{meta}</span>}
          {action}
        </div>
      )}
    </div>
  );
}

function KvRow({ label, value, valueClass, chip, chipClass }: {
  label: string; value?: ReactNode; valueClass?: string; chip?: string; chipClass?: string;
}) {
  return (
    <div className="sadb-kv">
      <span>{label}</span>
      {chip
        ? <span className={`sadb-chip ${chipClass ?? 'sadb-chip--neutral'}`}>{chip}</span>
        : <span className={`sadb-kv-value ${valueClass ?? ''}`}>{value}</span>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previewOpenedHere = useRef(false);
  const { currentUser } = useAuth();
  const { organizations } = useOrganizations();
  const { hospitals } = useHospitals();
  const { config } = usePlatformConfig();

  const [users, setUsers] = useState<UserDoc[]>([]);
  const [patientAgg, setPatientAgg] = useState({ total: 0, newThisWeek: 0, byOrg: new Map<string, number>() });
  const [encounters, setEncounters] = useState<EncounterDoc[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);
  const [syncStats, setSyncStats] = useState({ total: 0, pending: 0, synced: 0, failed: 0, oldestPending: undefined as string | undefined });
  const [conflictCount, setConflictCount] = useState(0);
  const [dhis2, setDhis2] = useState<{ configured: boolean; host: string; lastPush?: string }>({ configured: false, host: 'Not configured' });
  const [loading, setLoading] = useState(true);
  const [tenantSearch, setTenantSearch] = useState('');
  const [chartMode, setChartMode] = useState<'line' | 'area' | 'bar'>('area');

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
        const weekAgo = Date.now() - 7 * 86400000;
        let newThisWeek = 0;
        for (const p of allPatients) {
          if (p.orgId) byOrg.set(p.orgId, (byOrg.get(p.orgId) || 0) + 1);
          if (p.createdAt && new Date(p.createdAt).getTime() >= weekAgo) newThisWeek++;
        }
        setPatientAgg({ total: allPatients.length, newThisWeek, byOrg });
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

  /* Busiest hour of today, for the Encounters KPI delta line. */
  const encounterPeak = useMemo(() => {
    const byHour = new Map<number, number>();
    for (const e of encounters) {
      const iso = e.createdAt || e.startedAt || '';
      if (!iso || dayKey(iso) !== todayKey) continue;
      const h = new Date(iso).getHours();
      byHour.set(h, (byHour.get(h) || 0) + 1);
    }
    let hour = -1, perHour = 0;
    for (const [h, n] of byHour) if (n > perHour) { perHour = n; hour = h; }
    return hour >= 0 ? { hour, perHour } : null;
  }, [encounters, todayKey]);

  const syncRate = syncStats.total > 0 ? Math.round((syncStats.synced / syncStats.total) * 100) : 100;
  const syncTone: Tone = syncStats.failed > 0 ? 'danger' : syncStats.pending > 0 ? 'warn' : 'ok';

  // One source, three-way state (KAN-117). This previously read a localStorage
  // key nothing ever wrote and treated its absence as `Infinity` hours old —
  // reporting the backup as definitively overdue, a measured-sounding claim
  // about something never measured.
  const rpoHours = config?.superAdminPolicies?.backupRpoHours ?? 24;
  const backupStatus = useBackupStatus(rpoHours);
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
        token: `risk:audit:${log._id}`,
        severity: classifyAuditRisk(log.action, log.success),
        title: `Audit failure — ${log.action}`,
        detail: log.username ? `${log.username} · ${log.details}` : log.details,
        when: log.createdAt,
        href: `/admin/audit?log=${encodeURIComponent(log._id)}`,
      });
    }
    if (syncStats.failed > 0) {
      rows.push({ token: 'risk:sync', severity: 'high', title: `${syncStats.failed} sync job${syncStats.failed === 1 ? '' : 's'} failed`, detail: 'Replication to country node', href: '/admin/sync' });
    }
    if (conflictCount > 0) {
      rows.push({ token: 'risk:conflicts', severity: 'medium', title: `${conflictCount} unresolved data conflict${conflictCount === 1 ? '' : 's'}`, detail: 'Reconciliation queue', href: '/admin/conflicts' });
    }
    for (const org of suspendedOrgs) {
      rows.push({ token: `risk:org:${org._id}`, severity: 'medium', title: `Tenant ${org.subscriptionStatus === 'cancelled' ? 'cancelled' : 'suspended'} — ${org.name}`, detail: `${org.subscriptionPlan} plan`, href: `/admin/organizations?org=${encodeURIComponent(org._id)}` });
    }
    if (backupOverdue) {
      rows.push({
        token: 'risk:backup',
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
        token: 'risk:backup',
        severity: 'medium',
        title: 'Backup status unknown',
        detail: `Nothing has reported a backup · RPO ${rpoHours}h`,
        href: '/admin/security',
      });
    }
    if (config?.maintenanceMode) {
      rows.push({ token: 'risk:maintenance', severity: 'medium', title: 'Maintenance mode is ON', detail: 'Tenant access is restricted', href: '/admin/config' });
    }
    for (const org of trialOrgs) {
      // Billing has no tenant-focus contract yet, so this remains a broad
      // aggregate destination rather than carrying a query param it ignores.
      rows.push({ token: `risk:trial:${org._id}`, severity: 'low', title: `Trial tenant — ${org.name}`, detail: `${org.maxUsers} seat limit`, href: '/admin/billing' });
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
        };
      });
  }, [organizations, users, hospitals, tenantSearch]);

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

  /* Failures ride a hidden second axis (the design draws them ×100) so one
     failed login is visible next to a thousand encounters; the tooltip still
     reports the raw counts. */
  const failAxisMax = useMemo(
    () => Math.ceil(Math.max(4, ...trend.map(t => t.failures)) * 1.4),
    [trend],
  );

  /* KPI deltas we can actually compute. */
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime();
  const newOrgsQuarter = organizations.filter(o => o.createdAt && new Date(o.createdAt).getTime() >= quarterStart).length;
  const newFacilitiesQuarter = hospitals.filter(h => h.createdAt && new Date(h.createdAt).getTime() >= quarterStart).length;
  const offlineFacilities = hospitals.filter(h => h.syncStatus === 'offline').length;
  const platformUsers = users.filter(u => !u.orgId).length;

  const licensedSeats = organizations.reduce((sum, o) => sum + (o.maxUsers || 0), 0);

  const statusTone = (s: string): Tone =>
    s === 'active' ? 'ok' : s === 'trial' ? 'warn' : s === 'suspended' || s === 'cancelled' ? 'danger' : 'muted';

  const openRiskTone: Tone = riskQueue.some(r => r.severity === 'critical' || r.severity === 'high')
    ? 'danger'
    : riskQueue.length ? 'warn' : 'ok';

  /* Per-tenant sync: share of the tenant's facilities currently online —
     the honest per-tenant proxy while sync stats are only tracked globally. */
  const tenantSync = (row: { org: OrganizationDoc; facilities: number; offline: number }): { label: string; color: string } => {
    if (statusTone(row.org.subscriptionStatus) === 'danger' || row.facilities === 0) {
      return { label: '—', color: 'var(--text-muted)' };
    }
    const pct = Math.round(((row.facilities - row.offline) / row.facilities) * 100);
    return { label: `${pct}%`, color: pct < 95 ? 'var(--color-warning-700)' : 'var(--color-success-800)' };
  };

  const kpis: Array<{ key: string; label: string; value: string; delta: string; deltaClass?: string; href?: string }> = [
    {
      key: 'organizations',
      label: 'Organizations',
      value: String(organizations.length),
      delta: newOrgsQuarter > 0 ? `+${newOrgsQuarter} this quarter` : `${activeOrgs.length} active · ${trialOrgs.length} trial`,
      deltaClass: newOrgsQuarter > 0 ? 'is-up' : undefined,
      href: '/admin/organizations',
    },
    {
      key: 'facilities',
      label: 'Facilities',
      value: String(hospitals.length),
      delta: offlineFacilities > 0 ? `${offlineFacilities} offline` : newFacilitiesQuarter > 0 ? `+${newFacilitiesQuarter} this quarter` : `across ${organizations.length} organizations`,
      deltaClass: offlineFacilities > 0 ? 'is-warn' : newFacilitiesQuarter > 0 ? 'is-up' : undefined,
      href: '/admin/organizations',
    },
    {
      key: 'users',
      label: 'Users',
      value: loading ? '…' : users.length.toLocaleString(),
      delta: `${platformUsers} platform · ${users.length - platformUsers} tenant`,
      href: '/admin/users',
    },
    {
      key: 'patients',
      label: 'Patients',
      value: loading ? '…' : patientAgg.total.toLocaleString(),
      delta: patientAgg.newThisWeek > 0 ? `+${patientAgg.newThisWeek} this week` : 'Tenant-scoped registry',
      deltaClass: patientAgg.newThisWeek > 0 ? 'is-up' : undefined,
      // No platform-level patient registry to open — the registry is tenant-scoped.
    },
    {
      key: 'encounters',
      label: 'Encounters today',
      value: loading ? '…' : encountersToday.toLocaleString(),
      delta: encounterPeak ? `peak ${String(encounterPeak.hour).padStart(2, '0')}:00 · ${encounterPeak.perHour}/h` : 'None recorded yet',
      href: '/admin/analytics',
    },
  ];

  // The URL carries only stable, non-sensitive identifiers. All display copy
  // is resolved again from the current scoped dashboard data, so stale or
  // fabricated tokens cannot manufacture a preview.
  const previewToken = searchParams.get('preview');
  const preview: DashboardPreview | null = (() => {
    if (!previewToken) return null;
    if (previewToken.startsWith('kpi:')) {
      const kpi = kpis.find(item => `kpi:${item.key}` === previewToken && item.href);
      return kpi ? {
        title: kpi.label,
        context: 'Platform metric',
        details: [
          { label: 'Current value', value: kpi.value },
          { label: 'Context', value: kpi.delta },
        ],
        href: kpi.href!,
      } : null;
    }
    if (previewToken === 'signal:risk') {
      return {
        title: 'Platform risk',
        context: 'Readiness signal',
        details: [
          { label: 'Open risks', value: riskQueue.length },
          { label: 'Audit failures', value: `${failedAudits.length} in the last 7 days` },
        ],
        href: '/admin/risk',
      };
    }
    if (previewToken.startsWith('tenant:')) {
      const orgId = previewToken.slice('tenant:'.length);
      const org = organizations.find(item => item._id === orgId);
      if (!org) return null;
      const orgFacilities = hospitals.filter(item => item.orgId === orgId);
      const row = {
        org,
        users: users.filter(item => item.orgId === orgId).length,
        facilities: orgFacilities.length,
        offline: orgFacilities.filter(item => item.syncStatus === 'offline').length,
      };
      const sync = tenantSync(row);
      return {
        title: org.name,
        context: 'Tenant health',
        details: [
          { label: 'Plan', value: org.subscriptionPlan },
          { label: 'Status', value: org.subscriptionStatus },
          { label: 'Facilities', value: `${row.facilities} / ${org.maxHospitals}` },
          { label: 'Users', value: `${row.users} / ${org.maxUsers}` },
          { label: 'Sync', value: sync.label },
        ],
        href: `/admin/organizations?org=${encodeURIComponent(org._id)}`,
      };
    }
    if (previewToken.startsWith('risk:')) {
      const row = riskQueue.find(item => item.token === previewToken);
      return row ? {
        title: row.title,
        context: `${row.severity} risk`,
        details: [
          { label: 'Details', value: row.detail },
          ...(row.when ? [{ label: 'Recorded', value: formatWhen(row.when) }] : []),
        ],
        href: row.href,
      } : null;
    }
    if (previewToken.startsWith('audit:')) {
      const auditId = previewToken.slice('audit:'.length);
      const log = highRiskAudits.find(item => item._id === auditId);
      return log ? {
        title: log.action,
        context: 'Security watchlist',
        details: [
          { label: 'Actor', value: log.username || 'system' },
          { label: 'Details', value: log.details },
          { label: 'Recorded', value: formatWhen(log.createdAt) },
        ],
        href: `/admin/audit?log=${encodeURIComponent(log._id)}`,
      } : null;
    }
    return null;
  })();

  const openPreview = (token: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('preview', token);
    previewOpenedHere.current = true;
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const closePreview = () => {
    if (previewOpenedHere.current) {
      previewOpenedHere.current = false;
      router.back();
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete('preview');
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  const CIRC = 2 * Math.PI * 38;

  const legendProps = {
    iconType: 'circle' as const,
    iconSize: 8,
    wrapperStyle: { fontSize: 11, paddingTop: 4 },
    formatter: (value: ReactNode) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>,
  };

  if (!currentUser || currentUser.role !== 'super_admin') return null;

  const openFullPage = (target: DashboardPreview) => {
    previewOpenedHere.current = false;
    router.push(target.href);
  };

  return (
    <main className="page-container page-enter sadb-scope">
      <div className="sadb-page">

        {/* ═══ KPI tile row ═══ */}
        <div className="sadb-kpi-row">
          {kpis.map(k => {
            const body = (
              <>
                <p className="sadb-kpi-label">{k.label}</p>
                <p className="sadb-kpi-value">{k.value}</p>
                <p className={`sadb-kpi-delta ${k.deltaClass ?? ''}`}>{k.delta}</p>
              </>
            );
            return k.href
              ? <button key={k.key} type="button" className="sadb-kpi" onClick={() => openPreview(`kpi:${k.key}`)}>{body}</button>
              : <div key={k.label} className="sadb-kpi">{body}</div>;
          })}
        </div>

        {/* ═══ ROW 2 — Readiness · Business snapshot · Activity trend ═══ */}
        <div className="sadb-row-2">

          {/* Platform readiness — donut + the two signals that move it */}
          <div className="sadb-card">
            <div className="sadb-card-head">
              <h3 className="sadb-card-title">Platform readiness</h3>
              <span className={`sadb-chip ${TONE_CHIP[readinessTone]}`}>
                {readinessTone === 'ok' ? 'Steady' : 'Attention required'}
              </span>
            </div>
            <div className="sadb-readiness-body">
              <svg width={92} height={92} viewBox="0 0 92 92" className="flex-shrink-0" role="img" aria-label={`Platform readiness ${readiness}%`}>
                <circle cx={46} cy={46} r={38} fill="none" stroke="var(--ehr-row-rule, #F1F3F5)" strokeWidth={9} />
                <circle
                  cx={46} cy={46} r={38} fill="none"
                  stroke={TONE_STROKE[readinessTone]} strokeWidth={9} strokeLinecap="round"
                  strokeDasharray={`${((readiness / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(2)}`}
                  transform="rotate(-90 46 46)"
                />
                <text x={46} y={44} textAnchor="middle" fontFamily="var(--font-condensed)" fontSize={21} fontWeight={700} fill="var(--text-primary)">
                  {loading ? '…' : `${readiness}%`}
                </text>
                <text x={46} y={59} textAnchor="middle" fontSize={8.5} letterSpacing={1} fill="var(--text-muted)">READINESS</text>
              </svg>
              <div className="sadb-readiness-signals">
                <button type="button" className={`sadb-signal ${TONE_SIGNAL[openRiskTone]}`} onClick={() => openPreview('signal:risk')}>
                  <b>{riskQueue.length ? `${riskQueue.length} open risk${riskQueue.length === 1 ? '' : 's'}` : 'No open risks'}</b>
                  <span>{failedAudits.length} audit failure{failedAudits.length === 1 ? '' : 's'} · last 7 days</span>
                </button>
                <div className={`sadb-signal ${TONE_SIGNAL[syncTone]}`}>
                  <b>Sync health {syncRate}%</b>
                  <span>{syncStats.pending} pending · {syncStats.failed} failed · {syncStats.total.toLocaleString()} events</span>
                </div>
              </div>
            </div>
          </div>

          {/* Business snapshot */}
          <div className="sadb-card">
            <CardHead
              title="Business snapshot"
              action={<button type="button" className="sadb-head-link" onClick={() => router.push('/admin/billing')}>Billing ›</button>}
            />
            <KvRow label="Active subscriptions" value={organizations.filter(o => o.subscriptionStatus === 'active').length} />
            <KvRow label="Trials" value={trialOrgs.length} />
            <KvRow label="Suspended / cancelled" value={suspendedOrgs.length} valueClass={suspendedOrgs.length > 0 ? 'is-warn' : undefined} />
            <KvRow label="Seats in use" value={loading ? '…' : `${users.length} / ${licensedSeats}`} />
          </div>

          {/* Platform activity — encounters vs audit failures, last 14 days */}
          <div className="sadb-card" style={{ minWidth: 0 }}>
            <div className="sadb-card-head">
              <div className="flex items-baseline gap-2 min-w-0">
                <h3 className="sadb-card-title">Platform activity</h3>
                <span className="sadb-card-meta whitespace-nowrap">Encounters vs audit failures · 14 days</span>
              </div>
              <div className="flex gap-1">
                {(['line', 'area', 'bar'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`sadb-pill${chartMode === m ? ' is-active' : ''}`}
                    aria-pressed={chartMode === m}
                    onClick={() => setChartMode(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-3 pt-3 pb-1">
              <ResponsiveContainer width="100%" height={196}>
                <ComposedChart data={trend} margin={{ top: 5, right: 5, left: -6, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid stroke="var(--border-light)" vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" />
                  <YAxis
                    tickLine={false} axisLine={false} tick={axisTick} width={34} allowDecimals={false}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(v))}
                  />
                  <YAxis yAxisId="failures" hide domain={[0, failAxisMax]} />
                  <Tooltip {...tooltipStyle} />
                  <Legend {...legendProps} />
                  {chartMode === 'bar' ? (
                    <Bar dataKey="encounters" name="Encounters" fill="var(--accent-primary)" fillOpacity={0.55} maxBarSize={26} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  ) : chartMode === 'area' ? (
                    <Area type="monotone" dataKey="encounters" name="Encounters" stroke="var(--accent-primary)" strokeWidth={2} fill="var(--accent-primary)" fillOpacity={0.14} isAnimationActive={false} />
                  ) : (
                    <Line type="monotone" dataKey="encounters" name="Encounters" stroke="var(--accent-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  )}
                  <Line yAxisId="failures" type="monotone" dataKey="failures" name="Audit failures" stroke="var(--color-danger-500)" strokeWidth={1.8} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* ═══ Tenant health matrix ═══ */}
        <div className="sadb-card">
          <div className="sadb-card-head" style={{ padding: '12px 16px' }}>
            <h3 className="sadb-card-title">Tenant health matrix</h3>
            <div className="sadb-legend">
              <span><i style={{ background: 'var(--text-muted)' }} />Organizations ({organizations.length})</span>
              <span><i style={{ background: 'var(--color-success-800)' }} />Active ({activeOrgs.length})</span>
              <span><i style={{ background: 'var(--color-warning-600)' }} />Trial ({trialOrgs.length})</span>
              <span><i style={{ background: 'var(--color-danger-500)' }} />Suspended ({suspendedOrgs.length})</span>
            </div>
          </div>
          <div className="sadb-search-row">
            <label className="sadb-search">
              <Search className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              <input
                value={tenantSearch}
                onChange={e => setTenantSearch(e.target.value)}
                placeholder="Search tenants by name, plan, or status…"
                aria-label="Search tenants"
              />
            </label>
            <button type="button" className="btn btn-secondary btn-sm flex-shrink-0" onClick={() => router.push('/admin/organizations')}>
              Manage tenants
            </button>
          </div>
          <div className="sadb-tenant-scroll show-scrollbar">
            <div>
              {/* The column-header row stays rendered even when the list is empty. */}
              <div className="sadb-tenant-grid sadb-tenant-grid--head">
                <span>Organization</span><span>Plan</span><span>Facilities</span><span>Users</span><span>Sync</span>
                <span style={{ textAlign: 'end' }}>Status</span>
              </div>
              {tenantMatrix.map(row => {
                const sync = tenantSync(row);
                const onboarded = onboardedLabel(row.org.createdAt);
                const orgKind = row.org.orgType === 'public' ? 'Public' : 'Private';
                return (
                  <button
                    key={row.org._id}
                    type="button"
                    className="sadb-tenant-grid sadb-tenant-row"
                    onClick={() => openPreview(`tenant:${row.org._id}`)}
                  >
                    <span className="min-w-0">
                      <span className="sadb-tenant-name truncate">{row.org.name}</span>
                      <span className="sadb-tenant-sub truncate">
                        {orgKind}{onboarded ? ` · onboarded ${onboarded}` : row.org.country ? ` · ${row.org.country}` : ''}
                      </span>
                    </span>
                    <span className="capitalize">{row.org.subscriptionPlan}</span>
                    <span className="sadb-tenant-num">{row.facilities} / {row.org.maxHospitals}</span>
                    <span className="sadb-tenant-num">{row.users} / {row.org.maxUsers}</span>
                    <span style={{ color: sync.color }}>{sync.label}</span>
                    <span style={{ textAlign: 'end' }}>
                      <span className={`sadb-chip ${TONE_CHIP[statusTone(row.org.subscriptionStatus)]}`}>{row.org.subscriptionStatus}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          {tenantMatrix.length === 0 && (
            <p className="sadb-empty">
              {organizations.length === 0 ? 'No organizations yet.' : `No tenants match "${tenantSearch}".`}
            </p>
          )}
        </div>

        {/* ═══ ROW 3 — Risk queue · Security watchlist · Sync & interop ═══ */}
        <div className="sadb-row-3">

          <div className="sadb-card">
            <CardHead title="Risk & incident queue" meta={`${riskQueue.length} open`} />
            {riskQueue.length === 0 ? (
              <p className="sadb-empty">No open risk signals — platform steady.</p>
            ) : riskQueue.map(row => (
              <button key={row.token} type="button" className="sadb-queue-row" onClick={() => openPreview(row.token)}>
                <span className={`sadb-chip ${TONE_CHIP[SEVERITY_TONE[row.severity]]}`}>{row.severity}</span>
                <span className="sadb-queue-copy">
                  <span className="sadb-queue-title">{row.title}</span>
                  <span className="sadb-queue-sub">{row.detail}</span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
              </button>
            ))}
          </div>

          <div className="sadb-card">
            <CardHead title="Security watchlist" meta="High-risk actions · 7d" />
            {highRiskAudits.length === 0 ? (
              <p className="sadb-empty">No high-risk actions recorded this week.</p>
            ) : highRiskAudits.map(log => (
              <button key={log._id} type="button" className="sadb-queue-row" onClick={() => openPreview(`audit:${log._id}`)}>
                <span className="sadb-queue-copy">
                  <span className="sadb-queue-title">{log.action}</span>
                  <span className="sadb-queue-sub">{log.username || 'system'} · {log.details}</span>
                </span>
                <time className="sadb-queue-when">{formatWhen(log.createdAt)}</time>
              </button>
            ))}
          </div>

          <div className="sadb-card">
            <CardHead
              title="Sync & interoperability"
              action={<button type="button" className="sadb-head-link" onClick={() => router.push('/admin/sync')}>Open ›</button>}
            />
            <KvRow
              label="Replication"
              chip={syncStats.failed > 0 ? 'Failing' : syncStats.pending > 0 ? 'Backlog' : 'Healthy'}
              chipClass={TONE_CHIP[syncTone]}
            />
            <KvRow label="Pending events" value={syncStats.pending} />
            <KvRow label="Failed events" value={syncStats.failed} valueClass={syncStats.failed > 0 ? 'is-warn' : undefined} />
            <KvRow
              label="Last DHIS2 push"
              chip={dhis2.configured ? (dhis2.lastPush ? formatWhen(dhis2.lastPush) : 'Never') : 'Not configured'}
              chipClass={dhis2.configured && dhis2.lastPush ? 'sadb-chip--green' : 'sadb-chip--neutral'}
            />
          </div>
        </div>
      </div>
      {preview && (
        <PreviewDialog preview={preview} onClose={closePreview} onOpen={() => openFullPage(preview)} />
      )}
    </main>
  );
}
