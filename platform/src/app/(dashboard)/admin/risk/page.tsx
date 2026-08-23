'use client';

import { useBackupStatus } from '@/lib/hooks/useBackupStatus';

/**
 * Super-admin → Risk Center.
 *
 * Unifies open risk signals from every subsystem into a single queue: no
 * fabricated owners or due-dates — each row is derived from a real service
 * call by `buildRiskRows`, the same derivation the dashboard scores its
 * readiness donut from, so the two screens cannot disagree about what is open.
 *
 * The queue is also *workable*. Because every row is derived, nothing here used
 * to be clearable: an operator who fixed the problem had no way to say so, and
 * a signal whose source never changes — a failed login last Tuesday — sat in
 * the queue until it aged out on its own. Resolving writes a small record
 * against that occurrence (see `risk-resolution-service`), which drops the row
 * out of Open, into Resolved, and out of the dashboard's readiness cost.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FilterSelect } from '@/components/filters';
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import { apiFetch } from '@/lib/api-fetch';
import type { AuditLogDoc, ConflictQueueDoc, RiskResolutionDoc, SyncEventDoc } from '@/lib/db-types';
import {
  SaTable, formatWhen,
  type SaSeverity,
} from '@/components/admin/sa-ui';
import { buildRiskRows, type RiskRow, type RiskSource } from '@/components/admin/risk-signals';
import {
  getRiskResolutions, indexResolutions, isRiskResolved, reopenRisk, resolveRisks,
  type ResolveRiskInput,
} from '@/lib/services/risk-resolution-service';
import { SadbPage, SadbCard, SadbSearch, SadbChip, SadbTabs, SEVERITY_CHIP } from '@/components/admin/sadb-ui';

const SOURCE_HREF: Record<RiskSource, string> = {
  Audit: '/admin/audit',
  Sync: '/admin/sync',
  Data: '/admin/conflicts',
  Tenants: '/admin/organizations',
  Continuity: '/admin/system',
  Platform: '/admin/system',
};

/** Where a row goes when you click it. Audit rows open the exact entry rather
 *  than the log's front page — the whole point of the row is that one event. */
function rowHref(row: RiskRow): string {
  if (row.source === 'Audit') return `/admin/audit?log=${encodeURIComponent(row.id.slice('audit-'.length))}`;
  return SOURCE_HREF[row.source];
}

const SEVERITIES: SaSeverity[] = ['critical', 'high', 'medium', 'low'];
const SOURCES: RiskSource[] = ['Audit', 'Sync', 'Data', 'Tenants', 'Continuity', 'Platform'];

export default function RiskCenterPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const { organizations } = useOrganizations();
  const { config } = usePlatformConfig();

  const [auditLogs, setAuditLogs] = useState<AuditLogDoc[]>([]);
  const [syncFailed, setSyncFailed] = useState(0);
  const [pendingSyncEvents, setPendingSyncEvents] = useState<SyncEventDoc[]>([]);
  const [conflicts, setConflicts] = useState<ConflictQueueDoc[]>([]);
  const [resolutions, setResolutions] = useState<RiskResolutionDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [severityFilter, setSeverityFilter] = useState<'all' | SaSeverity>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | RiskSource>('all');
  const [search, setSearch] = useState('');
  /** Rows queued for the resolve dialog — one row, or everything shown. */
  const [resolving, setResolving] = useState<RiskRow[] | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const reloadResolutions = useCallback(async () => {
    setResolutions(await getRiskResolutions());
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [{ getRecentAuditLogs }, { getSyncEventStats, getPendingSyncEvents }] = await Promise.all([
          import('@/lib/services/audit-service'),
          import('@/lib/services/sync-event-service'),
        ]);
        const [logs, stats, saved] = await Promise.all([
          getRecentAuditLogs(1000),
          getSyncEventStats(),
          getRiskResolutions(),
        ]);
        if (!mounted) return;
        setAuditLogs(logs);
        setSyncFailed(stats.failed);
        setResolutions(saved);
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

  const rows = useMemo(() => buildRiskRows({
    auditLogs,
    syncFailed,
    pendingSyncEvents,
    conflicts,
    organizations,
    maintenanceMode: !!config?.maintenanceMode,
    configUpdatedAt: config?.updatedAt,
    backupRpoHours: config?.superAdminPolicies?.backupRpoHours,
    backupAgeHours: backupStatus?.ageHours ?? null,
    backupLastAt: backupStatus?.lastBackupAt,
  }), [auditLogs, syncFailed, pendingSyncEvents, conflicts, organizations, config, backupStatus]);

  const resolutionIndex = useMemo(() => indexResolutions(resolutions), [resolutions]);

  /* Open = derived and not resolved. Resolved reads from the resolution
     records rather than the derived rows, so a signal whose source has since
     cleared still shows what was done about it instead of vanishing. */
  const openRows = useMemo(
    () => rows.filter(r => !isRiskResolved(resolutionIndex, r.id, r.signature)),
    [rows, resolutionIndex],
  );
  const resolvedDocs = useMemo(
    () => [...resolutions].sort((a, b) => (b.resolvedAt || '').localeCompare(a.resolvedAt || '')),
    [resolutions],
  );

  /* The Filters popover is gone — the search box is the filter — so severity
     and source have to be part of what a search matches, or "critical" and
     "sync" would have stopped narrowing anything when the popover went. */
  const matches = useCallback((severity: SaSeverity, source: string, haystack: string) => {
    const q = search.trim().toLowerCase();
    if (severityFilter !== 'all' && severity !== severityFilter) return false;
    if (sourceFilter !== 'all' && source !== sourceFilter) return false;
    if (q && !`${haystack} ${severity} ${source}`.toLowerCase().includes(q)) return false;
    return true;
  }, [search, severityFilter, sourceFilter]);

  const filteredOpen = useMemo(
    () => openRows.filter(r => matches(r.severity, r.source, `${r.signal} ${r.detail} ${r.source}`)),
    [openRows, matches],
  );
  const filteredResolved = useMemo(
    () => resolvedDocs.filter(d => matches(d.severity, d.source, `${d.signal} ${d.note || ''} ${d.source}`)),
    [resolvedDocs, matches],
  );

  const counts = useMemo(() => {
    const c: Record<SaSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of openRows) c[r.severity]++;
    return c;
  }, [openRows]);

  // Filters live in a popover (same control as wards/hospitals/org users)
  // rather than as full-width selects stacked above the table.
  const activeFilterCount = (severityFilter !== 'all' ? 1 : 0) + (sourceFilter !== 'all' ? 1 : 0);

  const actor = { _id: currentUser?._id, username: currentUser?.username, name: currentUser?.name };

  const confirmResolve = async () => {
    if (!resolving) return;
    setSaving(true);
    try {
      const inputs: ResolveRiskInput[] = resolving.map(r => ({
        riskId: r.id,
        signature: r.signature,
        severity: r.severity,
        source: r.source,
        signal: r.signal,
        note,
      }));
      const { resolved, failed } = await resolveRisks(inputs, actor);
      await reloadResolutions();
      setResolving(null);
      setNote('');
      if (failed > 0) {
        showToast(`Resolved ${resolved.length}; ${failed} could not be saved.`, 'error');
      } else {
        showToast(`Resolved ${resolved.length} risk signal${resolved.length === 1 ? '' : 's'}.`, 'success');
      }
    } catch (err) {
      console.error('Failed to resolve risks:', err);
      showToast('Could not save the resolution.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async (doc: RiskResolutionDoc) => {
    try {
      await reopenRisk(doc.riskId, actor);
      await reloadResolutions();
      showToast('Risk reopened.', 'success');
    } catch (err) {
      console.error('Failed to reopen risk:', err);
      showToast('Could not reopen this risk.', 'error');
    }
  };

  return (
    <SadbPage>
      <SadbCard
        title="Risk & incident queue"
        action={
          <>
            <SadbTabs
              ariaLabel="Risk queue view"
              active={tab}
              onChange={key => setTab(key as 'open' | 'resolved')}
              tabs={[
                { key: 'open', label: 'Open', count: openRows.length },
                { key: 'resolved', label: 'Resolved', count: resolvedDocs.length },
              ]}
            />
            <div className="sadb-legend">
              <span><i style={{ background: 'var(--color-danger-500)' }} />Critical ({counts.critical})</span>
              <span><i style={{ background: 'var(--color-danger-500)' }} />High ({counts.high})</span>
              <span><i style={{ background: 'var(--color-warning-600)' }} />Medium ({counts.medium})</span>
              <span><i style={{ background: 'var(--text-muted)' }} />Low ({counts.low})</span>
            </div>
          </>
        }
      >
        <div className="sadb-search-row">
          <SadbSearch value={search} onChange={setSearch} placeholder="Search signal or detail…" ariaLabel="Search risk signals" />
          {/* Deliberately "all shown", not "all": whatever the filters have
              narrowed to is what an operator has actually just looked at. */}
          {tab === 'open' && filteredOpen.length > 0 && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setNote(''); setResolving(filteredOpen); }}>
              Resolve all shown ({filteredOpen.length})
            </button>
          )}
        </div>

        {tab === 'open' ? (
          <SaTable
            columns={[
              { label: 'Severity', w: 0.8 }, { label: 'Signal', w: 1.6 }, { label: 'Source', w: 0.9 },
              { label: 'Detail', w: 2.2 }, { label: 'Age', w: 0.7 }, { label: 'Status', w: 0.9 },
              { label: '', w: 0.5 },
            ]}
            empty={loading ? 'Loading risk signals…' : 'No open risk signals — the platform is clean.'}
          >
            {filteredOpen.map(r => (
              <tr key={r.id} onClick={() => router.push(rowHref(r))} style={{ cursor: 'pointer' }}>
                <td><SadbChip tone={SEVERITY_CHIP[r.severity]}>{r.severity.toUpperCase()}</SadbChip></td>
                <td><strong>{r.signal}</strong></td>
                <td>{r.source}</td>
                <td>{r.detail}</td>
                <td>{formatWhen(r.when)}</td>
                <td>{r.status}</td>
                <td onClick={e => e.stopPropagation()} style={{ textAlign: 'end' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setNote(''); setResolving([r]); }}
                  >
                    Resolve
                  </button>
                </td>
              </tr>
            ))}
          </SaTable>
        ) : (
          <SaTable
            columns={[
              { label: 'Severity', w: 0.8 }, { label: 'Signal', w: 1.6 }, { label: 'Source', w: 0.9 },
              { label: 'What was done', w: 2.2 }, { label: 'Resolved', w: 0.9 }, { label: 'By', w: 0.9 },
              { label: '', w: 0.5 },
            ]}
            empty={loading ? 'Loading…' : 'Nothing has been resolved yet.'}
          >
            {filteredResolved.map(d => (
              <tr key={d._id}>
                <td><SadbChip tone={SEVERITY_CHIP[d.severity]}>{d.severity.toUpperCase()}</SadbChip></td>
                <td><strong>{d.signal}</strong></td>
                <td>{d.source}</td>
                <td>{d.note || <span style={{ color: 'var(--text-muted)' }}>Acknowledged, no note</span>}</td>
                <td>{formatWhen(d.resolvedAt)}</td>
                <td>{d.resolvedByName || '—'}</td>
                <td style={{ textAlign: 'end' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleReopen(d)}>
                    Reopen
                  </button>
                </td>
              </tr>
            ))}
          </SaTable>
        )}
      </SadbCard>

      {resolving && (
        <Modal onClose={() => setResolving(null)} width={480} labelledBy="resolve-risk-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="resolve-risk-title" className="sadb-modal-title">
                {resolving.length === 1 ? 'Resolve this risk' : `Resolve ${resolving.length} risks`}
              </h2>
              <p className="sadb-modal-sub">
                {resolving.length === 1
                  ? resolving[0].signal
                  : `${resolving.length} signals currently shown in the queue.`}
                {' '}Resolving records that it has been dealt with — it does not change the
                underlying data. If the condition happens again it comes back on its own.
              </p>
            </div>
            <label htmlFor="resolve-risk-note" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              What was done (optional)
            </label>
            <textarea
              id="resolve-risk-note"
              className="sadb-modal-input"
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Reset the account and confirmed the login succeeded"
            />
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setResolving(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmResolve} disabled={saving}>
                {saving ? 'Saving…' : resolving.length === 1 ? 'Resolve' : `Resolve ${resolving.length}`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </SadbPage>
  );
}
