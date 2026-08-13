'use client';

import { useBackupStatus } from '@/lib/hooks/useBackupStatus';

/**
 * Super-admin → Risk Center.
 * Unifies open risk signals from every subsystem into a single queue: no
 * fabricated owners or due-dates — each row is derived from a real service
 * call, and severity is computed the same way the dashboard classifies it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import EhrListHeader, { EhrListFilters, LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import { FilterSelect } from '@/components/filters';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { apiFetch } from '@/lib/api-fetch';
import type { AuditLogDoc, ConflictQueueDoc, SyncEventDoc } from '@/lib/db-types';
import {
  SaPage, SaCard, SaPill, SaTable,
  classifyAuditRisk, SEVERITY_TONE, formatWhen,
  type SaSeverity,
} from '@/components/admin/sa-ui';

type Source = 'Audit' | 'Sync' | 'Data' | 'Tenants' | 'Continuity' | 'Platform';

interface RiskRow {
  id: string;
  severity: SaSeverity;
  signal: string;
  source: Source;
  detail: string;
  when?: string;
  status: string;
}

const SOURCE_HREF: Record<Source, string> = {
  Audit: '/admin/audit',
  Sync: '/admin/sync',
  Data: '/admin/conflicts',
  Tenants: '/admin/organizations',
  Continuity: '/admin/system',
  Platform: '/admin/system',
};

const SEVERITY_ORDER: Record<SaSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITIES: SaSeverity[] = ['critical', 'high', 'medium', 'low'];
const SOURCES: Source[] = ['Audit', 'Sync', 'Data', 'Tenants', 'Continuity', 'Platform'];

export default function RiskCenterPage() {
  const router = useRouter();
  const { organizations } = useOrganizations();
  const { config } = usePlatformConfig();

  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);
  const [syncFailed, setSyncFailed] = useState(0);
  const [pendingSyncEvents, setPendingSyncEvents] = useState<SyncEventDoc[]>([]);
  const [conflicts, setConflicts] = useState<ConflictQueueDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [severityFilter, setSeverityFilter] = useState<'all' | SaSeverity>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | Source>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [{ getRecentAuditLogs }, { getSyncEventStats, getPendingSyncEvents }] = await Promise.all([
          import('@/lib/services/audit-service'),
          import('@/lib/services/sync-event-service'),
        ]);
        const [logs, stats] = await Promise.all([
          getRecentAuditLogs(1000),
          getSyncEventStats(),
        ]);
        if (!mounted) return;
        setAuditLogs(logs);
        setSyncFailed(stats.failed);
        if (stats.failed > 0) {
          const pending = await getPendingSyncEvents(200);
          if (mounted) setPendingSyncEvents(pending);
        }
        try {
          const res = await apiFetch('/api/admin/conflicts?status=pending');
          if (res.ok && mounted) {
            const body = await res.json();
            setConflicts(Array.isArray(body.conflicts) ? body.conflicts : []);
          }
        } catch {
          // Conflicts feed is an additional signal; its absence shouldn't
          // block the rest of the risk queue from rendering.
        }
      } catch (err) {
        console.error('Failed to load risk signals:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Single source (KAN-117). This read a localStorage key nothing ever wrote
  // and returned null on absence, which dropped the backup risk row entirely —
  // so missing data produced a clean bill of health, while /admin reported the
  // same absence as a definite overdue backup.
  const backupStatus = useBackupStatus();
  const backupAgeHours = backupStatus?.ageHours ?? null;

  const rows: RiskRow[] = useMemo(() => {
    const out: RiskRow[] = [];
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;

    // (a) failed audit events, last 7 days
    for (const log of auditLogs) {
      if (log.success) continue;
      const t = log.createdAt ? new Date(log.createdAt).getTime() : 0;
      if (!t || t < cutoff) continue;
      out.push({
        id: `audit-${log._id}`,
        severity: classifyAuditRisk(log.action, log.success),
        signal: log.action,
        source: 'Audit',
        detail: log.details || log.username || 'No detail recorded',
        when: log.createdAt,
        status: 'failed',
      });
    }

    // (b) sync backlog — only surfaced once the aggregate stats show a real
    // failure count; rows are the currently pending backlog behind it.
    if (syncFailed > 0) {
      for (const ev of pendingSyncEvents) {
        out.push({
          id: `sync-${ev._id}`,
          severity: 'medium',
          signal: `${ev.operation} ${ev.resourceType}`,
          source: 'Sync',
          detail: `${ev.resourceId.slice(0, 24)} · ${ev.syncStatus}`,
          when: ev.occurredAt,
          status: ev.syncStatus,
        });
      }
    }

    // (c) pending conflicts
    for (const c of conflicts) {
      if (c.status !== 'pending') continue;
      out.push({
        id: `conflict-${c._id}`,
        severity: c.risk === 'high' ? 'high' : c.risk === 'medium' ? 'medium' : 'low',
        signal: `${c.resourceType} conflict`,
        source: 'Data',
        detail: `${c.losingRevs.length} competing revision${c.losingRevs.length === 1 ? '' : 's'}`,
        when: c.createdAt,
        status: 'pending',
      });
    }

    // (d) tenant risk
    for (const org of organizations) {
      if (org.subscriptionStatus === 'suspended' || org.subscriptionStatus === 'cancelled' || !org.isActive) {
        out.push({
          id: `org-status-${org._id}`,
          severity: 'medium',
          signal: `${org.name} — ${org.subscriptionStatus}`,
          source: 'Tenants',
          detail: org.isActive ? 'Subscription is not active' : 'Organization deactivated',
          when: org.updatedAt,
          status: org.subscriptionStatus,
        });
      } else if (org.subscriptionStatus === 'trial') {
        out.push({
          id: `org-trial-${org._id}`,
          severity: 'low',
          signal: `${org.name} — trial`,
          source: 'Tenants',
          detail: `${org.subscriptionPlan} plan on trial subscription`,
          when: org.createdAt,
          status: 'trial',
        });
      }
    }

    // (e) backup overdue vs policy RPO
    const rpo = config?.superAdminPolicies?.backupRpoHours;
    if (rpo) {
      if (backupAgeHours === null) {
        out.push({
          id: 'continuity-backup-missing',
          severity: 'high',
          signal: 'No backup on record',
          source: 'Continuity',
          detail: `Recovery point objective is ${rpo}h`,
          status: 'unknown',
        });
      } else if (backupAgeHours > rpo) {
        out.push({
          id: 'continuity-backup-overdue',
          severity: backupAgeHours > rpo * 2 ? 'high' : 'medium',
          signal: 'Backup overdue',
          source: 'Continuity',
          detail: `Last backup ${Math.round(backupAgeHours)}h ago, RPO is ${rpo}h`,
          status: 'overdue',
        });
      }
    }

    // (f) maintenance mode
    if (config?.maintenanceMode) {
      out.push({
        id: 'platform-maintenance',
        severity: 'low',
        signal: 'Maintenance mode is on',
        source: 'Platform',
        detail: 'Platform is restricted to admin-only access',
        status: 'on',
      });
    }

    out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    return out;
  }, [auditLogs, syncFailed, pendingSyncEvents, conflicts, organizations, config, backupAgeHours]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (severityFilter !== 'all' && r.severity !== severityFilter) return false;
      if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
      if (q && !`${r.signal} ${r.detail} ${r.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, severityFilter, sourceFilter, search]);

  const counts = useMemo(() => {
    const c: Record<SaSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of rows) c[r.severity]++;
    return c;
  }, [rows]);

  // Filters live in a popover (same control as wards/hospitals/org users)
  // rather than as full-width selects stacked above the table.
  const activeFilterCount = (severityFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0);

  return (
    <SaPage>
      <SaCard>
        <EhrListHeader
          title="Risk Center"
          stats={[
            { label: 'Showing', value: `${filtered.length} of ${rows.length}`, color: LIST_STAT_COLORS.muted },
            { label: 'Critical', value: counts.critical, color: 'var(--color-danger)' },
            { label: 'High', value: counts.high, color: 'var(--color-danger)' },
            { label: 'Medium', value: counts.medium, color: LIST_STAT_COLORS.amber },
            { label: 'Low', value: counts.low, color: LIST_STAT_COLORS.muted },
          ]}
          search={{ value: search, onChange: setSearch, placeholder: 'Search signal or detail…', ariaLabel: 'Search risk signals' }}
          actions={
            <EhrListFilters
              activeCount={activeFilterCount}
              onClear={() => { setSeverityFilter('all'); setSourceFilter('all'); }}
            >
              <FilterSelect
                label="Severity"
                value={severityFilter}
                onChange={value => setSeverityFilter(value as 'all' | SaSeverity)}
                neutralValue="all"
                size="sm"
                options={[{ value: 'all', label: 'All severities' }, ...SEVERITIES.map(x => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))]}
              />
              <FilterSelect
                label="Source"
                value={sourceFilter}
                onChange={value => setSourceFilter(value as 'all' | Source)}
                neutralValue="all"
                size="sm"
                options={[{ value: 'all', label: 'All sources' }, ...SOURCES.map(x => ({ value: x, label: x }))]}
              />
            </EhrListFilters>
          }
        />
        <SaTable
          columns={['Severity', 'Signal', 'Source', 'Detail', 'Age', 'Status']}
          empty={loading ? 'Loading risk signals…' : 'No open risk signals — the platform is clean.'}
        >
          {filtered.map(r => (
            <tr key={r.id} onClick={() => router.push(SOURCE_HREF[r.source])} style={{ cursor: 'pointer' }}>
              <td><SaPill tone={SEVERITY_TONE[r.severity]}>{r.severity.toUpperCase()}</SaPill></td>
              <td><strong>{r.signal}</strong></td>
              <td>{r.source}</td>
              <td>{r.detail}</td>
              <td>{formatWhen(r.when)}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </SaTable>
      </SaCard>
    </SaPage>
  );
}
