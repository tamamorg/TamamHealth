'use client';

/**
 * Super-admin Platform Dashboard — the command center, drawn per the
 * "Super Admin Dashboard.dc.html" design (sadb-* namespace in globals.css):
 * greeting + Command Center eyebrow, a clickable KPI tile row, readiness
 * donut with the two signals that move it, business snapshot, and sync &
 * interoperability.
 *
 * The lists this screen used to duplicate now live only where they are
 * actually worked: the risk & incident queue on /admin/risk (Risk Center),
 * the high-risk security watchlist on /admin/security (Security &
 * Compliance → Security watchlist), and the tenant health matrix on
 * /admin/organizations, where a row click can actually edit or deactivate
 * the tenant. The dashboard keeps the signals those lists produce — the
 * Organizations KPI tile is the way in — not a second copy of the lists, and
 * the 14-day encounters-vs-audit-failures trend it used to draw now lives on
 * /admin/analytics.
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
import { formatWhen } from '@/components/admin/sa-ui';
import { buildRiskRows, readinessFromRisks } from '@/components/admin/risk-signals';
import { getRiskResolutions, indexResolutions, isRiskResolved } from '@/lib/services/risk-resolution-service';
import { SadbChip, SadbGridList, SadbGridRow, statusChip } from '@/components/admin/sadb-ui';
import { OrgFacilities, ORG_GRID_TEMPLATE } from '@/components/admin/TenantTree';
import { useBackupStatus } from '@/lib/hooks/useBackupStatus';
import Modal from '@/components/Modal';
import { ChevronDown, ChevronRight, X } from '@/components/icons/lucide';
import type {
  AuditLogDoc, ConflictQueueDoc, EncounterDoc, HospitalDoc, RiskResolutionDoc, SyncEventDoc, UserDoc,
} from '@/lib/db-types';

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


function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  /* The conflict documents, not just their count: the risk queue is derived
     from the same rows the Risk Center derives, and a count cannot be turned
     back into rows. */
  const [conflicts, setConflicts] = useState<ConflictQueueDoc[]>([]);
  const [pendingSyncEvents, setPendingSyncEvents] = useState<SyncEventDoc[]>([]);
  const [riskResolutions, setRiskResolutions] = useState<RiskResolutionDoc[]>([]);
  const [dhis2, setDhis2] = useState<{ configured: boolean; host: string; lastPush?: string }>({ configured: false, host: 'Not configured' });
  const [loading, setLoading] = useState(true);
  /* Which tenant rows have their facility list open. A set, not a single id:
     comparing two tenants' sites is the reason to open them at all. */
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

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
        const [allUsers, allPatients, allEncounters, logs, sync, resolutions] = await Promise.all([
          getAllUsers(), getAllPatients(), getAllEncounters(), getRecentAuditLogs(500), getSyncEventStats(),
          getRiskResolutions(),
        ]);
        if (cancelled) return;
        setRiskResolutions(resolutions);
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
        if (sync.failed > 0) {
          const { getPendingSyncEvents } = await import('@/lib/services/sync-event-service');
          const backlog = await getPendingSyncEvents(200);
          if (!cancelled) setPendingSyncEvents(backlog);
        }
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
          const list = Array.isArray(data.conflicts) ? data.conflicts : Array.isArray(data) ? data : [];
          if (!cancelled) setConflicts(list as ConflictQueueDoc[]);
        }
      } catch { /* offline — conflicts stay empty */ }
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

  /* The open-risk queue, derived exactly as /admin/risk derives it — same
     module, same rows, minus anything an operator has resolved there.
     Previously this screen kept its own parallel tally (the first three audit
     failures, a flat +1 for sync, one per suspended tenant) and scored
     readiness from a third set of weights again, so the donut, this card, and
     the Risk Center could each report a different number for one platform. */
  const openRisks = useMemo(() => {
    const rows = buildRiskRows({
      auditLogs,
      syncFailed: syncStats.failed,
      pendingSyncEvents,
      conflicts,
      organizations,
      maintenanceMode: !!config?.maintenanceMode,
      configUpdatedAt: config?.updatedAt,
      backupRpoHours: config?.superAdminPolicies?.backupRpoHours,
      backupAgeHours: backupStatus?.ageHours ?? null,
      backupLastAt: backupStatus?.lastBackupAt,
    });
    const index = indexResolutions(riskResolutions);
    return rows.filter(r => !isRiskResolved(index, r.id, r.signature));
  }, [auditLogs, syncStats.failed, pendingSyncEvents, conflicts, organizations, config, backupStatus, riskResolutions]);

  const readiness = readinessFromRisks(openRisks);
  const readinessTone: Tone = readiness >= 88 ? 'ok' : readiness >= 70 ? 'warn' : 'danger';

  /* KPI deltas we can actually compute. */
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).getTime();
  const newOrgsQuarter = organizations.filter(o => o.createdAt && new Date(o.createdAt).getTime() >= quarterStart).length;
  const newFacilitiesQuarter = hospitals.filter(h => h.createdAt && new Date(h.createdAt).getTime() >= quarterStart).length;
  const offlineFacilities = hospitals.filter(h => h.syncStatus === 'offline').length;
  const platformUsers = users.filter(u => !u.orgId).length;

  const licensedSeats = organizations.reduce((sum, o) => sum + (o.maxUsers || 0), 0);

  /* Per-tenant rollups for the organizations card. Every one of these comes
     from data this page already loaded for the KPI row — the card adds no
     queries, it just stops throwing the per-org breakdown away. */
  const facilitiesByOrg = useMemo(() => {
    const map = new Map<string, HospitalDoc[]>();
    for (const h of hospitals) {
      if (!h.orgId) continue;
      const list = map.get(h.orgId);
      if (list) list.push(h);
      else map.set(h.orgId, [h]);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [hospitals]);

  const usersByOrg = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) if (u.orgId) map.set(u.orgId, (map.get(u.orgId) || 0) + 1);
    return map;
  }, [users]);

  /* Accounts per facility. Both attachments count — `hospitalId` is the home
     site and `facilityIds` the extra ones a user covers — deduplicated per
     user, since a home site listed again among the extras is one account at
     one facility, not two. */
  const usersByFacility = useMemo(() => {
    const map = new Map<string, UserDoc[]>();
    for (const u of users) {
      const ids = new Set<string>();
      if (u.hospitalId) ids.add(u.hospitalId);
      for (const id of u.facilityIds || []) ids.add(id);
      for (const id of ids) {
        const list = map.get(id);
        if (list) list.push(u); else map.set(id, [u]);
      }
    }
    return map;
  }, [users]);

  const orgRows = useMemo(
    () => [...organizations].sort((a, b) => a.name.localeCompare(b.name)),
    [organizations],
  );

  const toggleOrg = (id: string) => setExpandedOrgs(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });

  const openRiskTone: Tone = openRisks.some(r => r.severity === 'critical' || r.severity === 'high')
    ? 'danger'
    : openRisks.length ? 'warn' : 'ok';

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
          { label: 'Open risks', value: openRisks.length },
          { label: 'Audit failures', value: `${failedAudits.length} in the last 7 days` },
        ],
        href: '/admin/risk',
      };
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

  const CIRC = 2 * Math.PI * 50;

  if (!currentUser || currentUser.role !== 'super_admin') return null;

  const openFullPage = (target: DashboardPreview) => {
    previewOpenedHere.current = false;
    router.push(target.href);
  };

  /* The page is a flex column so the last card can claim whatever height the
     rows above leave and scroll its own list inside it rather than growing the
     page. .page-container keeps its overflow-y: auto, which is what saves a
     short viewport: the card cannot shrink past its min-height, so the page
     scrolls instead of squeezing it away. */
  return (
    <main className="page-container page-enter sadb-scope" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="sadb-page" style={{ flex: '1 1 auto', minHeight: 0 }}>

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

        {/* ═══ ROW 2 — Readiness · Business snapshot · Sync & interop ═══ */}
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
              <svg width={124} height={124} viewBox="0 0 124 124" className="flex-shrink-0" role="img" aria-label={`Platform readiness ${readiness}%`}>
                <circle cx={62} cy={62} r={50} fill="none" stroke="var(--ehr-row-rule, #F1F3F5)" strokeWidth={11} />
                <circle
                  cx={62} cy={62} r={50} fill="none"
                  stroke={TONE_STROKE[readinessTone]} strokeWidth={11} strokeLinecap="round"
                  strokeDasharray={`${((readiness / 100) * CIRC).toFixed(1)} ${CIRC.toFixed(2)}`}
                  transform="rotate(-90 62 62)"
                />
                <text x={62} y={59} textAnchor="middle" fontFamily="var(--font-condensed)" fontSize={28} fontWeight={700} fill="var(--text-primary)">
                  {loading ? '…' : `${readiness}%`}
                </text>
                <text x={62} y={77} textAnchor="middle" fontSize={9.5} letterSpacing={1.2} fill="var(--text-muted)">READINESS</text>
              </svg>
              <div className="sadb-readiness-signals">
                <button type="button" className={`sadb-signal ${TONE_SIGNAL[openRiskTone]}`} onClick={() => openPreview('signal:risk')}>
                  <b>{openRisks.length ? `${openRisks.length} open risk${openRisks.length === 1 ? '' : 's'}` : 'No open risks'}</b>
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

          {/* Sync & interoperability — replication posture at a glance; the
              queue, job runners, and DHIS2 controls live on /admin/sync. */}
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

        {/* ═══ ROW 3 — Every tenant, and the facilities behind each ═══
            The KPI row counts organizations and facilities; this says which.
            Rows expand in place rather than linking away, because "which sites
            does this tenant actually run" is the question a count raises and
            the one the console could not answer without leaving the page. */}
        <div className="sadb-card" style={{ flex: '1 1 auto', minHeight: 200 }}>
          <CardHead
            title="Organizations"
            meta={loading ? undefined : `${activeOrgs.length} active · ${trialOrgs.length} trial · ${suspendedOrgs.length} suspended`}
            action={<button type="button" className="sadb-head-link" onClick={() => router.push('/admin/organizations')}>Manage ›</button>}
          />
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <SadbGridList
              template={ORG_GRID_TEMPLATE}
              minWidth={880}
              head={['Organization', 'Plan', 'Facilities', 'Users', 'Patients', 'Status']}
              alignEndLast
              empty={loading ? 'Loading tenants…' : 'No organizations on this platform yet.'}
            >
              {orgRows.map(org => {
                const facilities = facilitiesByOrg.get(org._id) || [];
                const open = expandedOrgs.has(org._id);
                const onboarded = org.createdAt ? new Date(org.createdAt) : null;
                const onboardedLabel = onboarded && !isNaN(onboarded.getTime())
                  ? onboarded.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
                  : null;
                return (
                  <div key={org._id}>
                    <SadbGridRow template={ORG_GRID_TEMPLATE} onClick={() => toggleOrg(org._id)} ariaExpanded={open}>
                      <span className="min-w-0 flex items-center gap-2">
                        {open
                          ? <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                          : <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />}
                        <span className="min-w-0">
                          <span className="sadb-tenant-name truncate" style={{ color: org.isActive ? undefined : 'var(--text-muted)' }}>
                            {org.name}
                          </span>
                          <span className="sadb-tenant-sub truncate">
                            {org.orgType === 'public' ? 'Public' : 'Private'}{onboardedLabel ? ` · onboarded ${onboardedLabel}` : ''}
                          </span>
                        </span>
                      </span>
                      <span className="capitalize">{org.subscriptionPlan}</span>
                      <span className="sadb-tenant-num">{facilities.length} / {org.maxHospitals}</span>
                      <span className="sadb-tenant-num">{loading ? '…' : `${usersByOrg.get(org._id) || 0} / ${org.maxUsers}`}</span>
                      <span className="sadb-tenant-num">{loading ? '…' : (patientAgg.byOrg.get(org._id) || 0).toLocaleString()}</span>
                      <span style={{ textAlign: 'end' }}>
                        <SadbChip tone={statusChip(org.subscriptionStatus)}>{org.subscriptionStatus}</SadbChip>
                      </span>
                    </SadbGridRow>
                    {open && (
                      <OrgFacilities
                        facilities={facilities}
                        usersByFacility={usersByFacility}
                        loading={loading}
                        onOpen={id => router.push(`/hospitals/${id}/manage`)}
                      />
                    )}
                  </div>
                );
              })}
            </SadbGridList>
          </div>
        </div>

      </div>
      {preview && (
        <PreviewDialog preview={preview} onClose={closePreview} onOpen={() => openFullPage(preview)} />
      )}
    </main>
  );
}
