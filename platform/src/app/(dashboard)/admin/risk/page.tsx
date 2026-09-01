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
import { useAuth } from '@/lib/context';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useTranslation } from '@/lib/i18n/useTranslation';
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
import { buildRiskRows, riskGuidance, type RiskRow, type RiskSource } from '@/components/admin/risk-signals';
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

export default function RiskCenterPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  /* The console is otherwise English throughout, but the explanation block is
     the one part of it meant to be READ rather than scanned — so it is carried
     in both locales rather than half-translated. */
  const { t } = useTranslation();
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
  const [search, setSearch] = useState('');
  /** Rows queued for the resolve dialog — one row, or everything shown. */
  const [resolving, setResolving] = useState<RiskRow[] | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  /** The resolution queued for the reopen confirmation. */
  const [reopening, setReopening] = useState<RiskResolutionDoc | null>(null);
  const [reopenBusy, setReopenBusy] = useState(false);

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
          getRecentAuditLogs(1000, scope),
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
  }, [scope]);

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
     and source are part of what a search matches, or "critical" and "sync"
     would have stopped narrowing anything when the popover went. The
     popover's severity/source state went with it: held at 'all' with nothing
     left to set them, the two guards it fed could never fail. */
  const matches = useCallback((severity: SaSeverity, source: string, haystack: string) => {
    const q = search.trim().toLowerCase();
    if (q && !`${haystack} ${severity} ${source}`.toLowerCase().includes(q)) return false;
    return true;
  }, [search]);

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

  const confirmReopen = async () => {
    if (!reopening) return;
    setReopenBusy(true);
    try {
      await reopenRisk(reopening.riskId, actor);
      await reloadResolutions();
      setReopening(null);
      showToast('Risk reopened.', 'success');
    } catch (err) {
      console.error('Failed to reopen risk:', err);
      showToast('Could not reopen this risk.', 'error');
    } finally {
      setReopenBusy(false);
    }
  };

  /* Rows and their explicit Resolve controls both open the same confirmation
     surface. The table action makes the workflow discoverable without making
     a single click destructive: the signal only clears after confirmation. */
  const openResolveDialog = (rows: RiskRow[]) => { setNote(''); setResolving(rows); };

  /** The one row a popup opened from the table is about; null for the bulk. */
  const single = resolving && resolving.length === 1 ? resolving[0] : null;
  /* What that row means. A queue row is a condition and a severity; the
     operator deciding whether to resolve it needs to know what asserts it and
     what would actually clear it, or "Resolve" becomes the button you press to
     make the red thing stop. */
  const guidance = single ? riskGuidance(single) : undefined;

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
        <div className="sadb-search-row sadb-search-row--table-aligned">
          <SadbSearch value={search} onChange={setSearch} placeholder="Search signal or detail…" ariaLabel="Search risk signals" />
          {/* Deliberately "all shown", not "all": whatever the filters have
              narrowed to is what an operator has actually just looked at. */}
          {tab === 'open' && filteredOpen.length > 0 && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openResolveDialog(filteredOpen)}>
              Resolve all shown ({filteredOpen.length})
            </button>
          )}
        </div>

        <div className="sadb-edge-aligned-table">
          {tab === 'open' ? (
            <SaTable
              columns={[
                'Signal', 'Severity', 'Source', 'Detail', 'Age', 'Status', 'Resolve',
              ]}
              empty={loading ? 'Loading risk signals…' : 'No open risk signals — the platform is clean.'}
            >
              {filteredOpen.map(r => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  aria-label={`Open risk signal: ${r.signal}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => openResolveDialog([r])}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openResolveDialog([r]); } }}
                >
                  <td><strong>{r.signal}</strong></td>
                  <td><SadbChip tone={SEVERITY_CHIP[r.severity]}>{r.severity.toUpperCase()}</SadbChip></td>
                  <td>{r.source}</td>
                  <td>{r.detail}</td>
                  <td>{formatWhen(r.when)}</td>
                  <td>{r.status}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm sadb-table-action"
                      onClick={event => {
                        event.stopPropagation();
                        openResolveDialog([r]);
                      }}
                      onKeyDown={event => event.stopPropagation()}
                      aria-label={`Resolve risk signal: ${r.signal}`}
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
                'Signal', 'Severity', 'Source', 'What was done', 'Resolved', 'By',
              ]}
              empty={loading ? 'Loading…' : 'Nothing has been resolved yet.'}
            >
              {filteredResolved.map(d => (
                <tr
                  key={d._id}
                  tabIndex={0}
                  aria-label={`Open resolved risk signal: ${d.signal}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setReopening(d)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setReopening(d); } }}
                >
                  <td><strong>{d.signal}</strong></td>
                  <td><SadbChip tone={SEVERITY_CHIP[d.severity]}>{d.severity.toUpperCase()}</SadbChip></td>
                  <td>{d.source}</td>
                  <td>{d.note || <span style={{ color: 'var(--text-muted)' }}>Acknowledged, no note</span>}</td>
                  <td>{formatWhen(d.resolvedAt)}</td>
                  <td>{d.resolvedByName || '—'}</td>
                </tr>
              ))}
            </SaTable>
          )}
        </div>
      </SadbCard>

      {/* The queue's only action surface. A row opens this; the signal is read
          here in full and the resolution is confirmed here, so nothing clears
          on a single click into a dense table. */}
      {resolving && (
        <Modal onClose={() => setResolving(null)} width={480} labelledBy="resolve-risk-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="resolve-risk-title" className="sadb-modal-title">
                {single ? single.signal : `Resolve ${resolving.length} risks`}
              </h2>
              <p className="sadb-modal-sub">
                {single
                  ? 'Resolve this signal?'
                  : `${resolving.length} signals currently shown in the queue.`}
                {' '}Resolving records that it has been dealt with — it does not change the
                underlying data. If the condition happens again it comes back on its own.
              </p>
            </div>

            {single && (
              <>
                <p style={{
                  fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere', margin: '0 0 14px', padding: '10px 12px',
                  background: 'var(--overlay-subtle)', borderRadius: 10,
                }}>
                  {single.detail}
                </p>
                <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, marginBottom: 14 }}>
                  <div className="sadb-kv">
                    <span>Severity</span>
                    <SadbChip tone={SEVERITY_CHIP[single.severity]}>{single.severity.toUpperCase()}</SadbChip>
                  </div>
                  <div className="sadb-kv"><span>Source</span><span className="sadb-kv-value">{single.source}</span></div>
                  <div className="sadb-kv"><span>Status</span><span className="sadb-kv-value">{single.status}</span></div>
                  <div className="sadb-kv"><span>Age</span><span className="sadb-kv-value">{formatWhen(single.when)}</span></div>
                </div>
                {/* The row's own detail line above is the NUMBERS; this is the
                    sentence. Always open, never behind a disclosure: a reader
                    who knew what the signal meant would not have opened the
                    popup. */}
                {guidance && (
                  <section className="sadb-risk-explain" aria-label={t('riskGuide.meansHead')}>
                    <p className="sadb-risk-explain-head">{t('riskGuide.meansHead')}</p>
                    <p className="sadb-risk-explain-body">{t(guidance.meansKey)}</p>
                    {guidance.causeKeys.length > 0 && (
                      <>
                        <p className="sadb-risk-explain-head">
                          {t(guidance.causeKeys.length === 1 ? 'riskGuide.causeHead' : 'riskGuide.causesHead')}
                        </p>
                        <ul className="sadb-risk-explain-list">
                          {guidance.causeKeys.map(key => <li key={key}>{t(key)}</li>)}
                        </ul>
                      </>
                    )}
                    <p className="sadb-risk-explain-head">{t('riskGuide.clearsHead')}</p>
                    <p className="sadb-risk-explain-body">{t(guidance.clearsKey)}</p>
                  </section>
                )}
              </>
            )}

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
            {/* The row used to be a link to the subsystem it came from. That
                navigation lives here now, so opening the popup costs nothing. */}
            <div className="sadb-modal-actions" style={{ justifyContent: single ? 'space-between' : 'flex-end' }}>
              {single && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => router.push(rowHref(single))}
                  disabled={saving}
                >
                  Open in {single.source}
                </button>
              )}
              <span style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setResolving(null)} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={confirmResolve} disabled={saving}>
                  {saving ? 'Saving…' : single ? 'Resolve' : `Resolve ${resolving.length}`}
                </button>
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* Reopening puts a signal back in front of every operator, so it is
          asked for the same way resolving is rather than firing from a row. */}
      {reopening && (
        <Modal onClose={() => setReopening(null)} width={480} labelledBy="reopen-risk-title">
          <div className="sadb-modal">
            <div className="sadb-modal-copy">
              <h2 id="reopen-risk-title" className="sadb-modal-title">{reopening.signal}</h2>
              <p className="sadb-modal-sub">
                Reopen this signal? It goes back into the Open queue and counts against the
                readiness score again. The record of what was done is kept.
              </p>
            </div>
            <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, marginBottom: 14 }}>
              <div className="sadb-kv">
                <span>Severity</span>
                <SadbChip tone={SEVERITY_CHIP[reopening.severity]}>{reopening.severity.toUpperCase()}</SadbChip>
              </div>
              <div className="sadb-kv"><span>Source</span><span className="sadb-kv-value">{reopening.source}</span></div>
              <div className="sadb-kv"><span>Resolved</span><span className="sadb-kv-value">{formatWhen(reopening.resolvedAt)}</span></div>
              <div className="sadb-kv"><span>By</span><span className="sadb-kv-value">{reopening.resolvedByName || '—'}</span></div>
            </div>
            <p style={{
              fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere', margin: '0 0 4px', padding: '10px 12px',
              background: 'var(--overlay-subtle)', borderRadius: 10,
            }}>
              {reopening.note || 'Acknowledged, no note.'}
            </p>
            <div className="sadb-modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setReopening(null)} disabled={reopenBusy}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmReopen} disabled={reopenBusy}>
                {reopenBusy ? 'Reopening…' : 'Reopen'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </SadbPage>
  );
}
