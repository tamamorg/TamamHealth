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
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { usePlatformConfig } from '@/lib/hooks/usePlatformConfig';
import type { AuditLogDoc, RiskResolutionDoc, SyncEventDoc } from '@/lib/db-types';
import {
  SaTable, formatWhen,
  type SaSeverity,
} from '@/components/admin/sa-ui';
import {
  buildRiskRows, riskGuidance, severityCounts, totalCount, type RiskRow, type RiskSource,
} from '@/components/admin/risk-signals';
import { useOpenConflicts } from '@/lib/hooks/useOpenConflicts';
import {
  getRiskResolutions, indexResolutions, isRiskResolved, reopenRisk, resolveRisks,
  type ResolveRiskInput,
} from '@/lib/services/risk-resolution-service';
import { SadbPage, SadbCard, SadbSearch, SadbChip, SadbTabs, SEVERITY_CHIP } from '@/components/admin/sadb-ui';
import { humanizeStatus } from '@/lib/format-utils';
import { useUrlView } from '@/lib/navigation/use-url-view';

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

/** Rows rendered per page. A real backlog can be thousands of rows (a conflict
 *  storm queues one per affected record); the table paginates rather than
 *  mounting a <tr> per row, which otherwise renders as one janky, unscrollable
 *  table the size of the backlog. */
const PAGE_SIZE = 50;

/** The most rows a single "Resolve all shown" click may clear. Resolving is a
 *  bulk mutation of a safety queue that tells every other operator the signals
 *  were handled; past this the operator must narrow the filter and review,
 *  rather than one-click-resolving thousands of rows nobody has read. */
const MAX_BULK_RESOLVE = 200;

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
  /* The conflicts feed is fetched through the shared hook the dashboard also
     uses, so a slow or failed load can no longer leave this page silently
     reporting "clean" while /admin reports thousands — and `conflictStatus`
     lets the queue say the count is degraded instead of hiding it. */
  const { conflicts, status: conflictStatus, reload: reloadConflicts } = useOpenConflicts();
  const [resolutions, setResolutions] = useState<RiskResolutionDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // In the URL (?view=) so Back returns to the tab the user was on.
  const [tab, setTab] = useUrlView(['open', 'resolved'] as const, 'open');
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

  const counts = useMemo(() => severityCounts(openRows), [openRows]);
  /* The Open tab badge is these four severities added back up, not a separate
     `openRows.length`. They are the same number, but computing the badge from
     the same tally the legend shows means the two cannot drift apart the way
     the "8,237 open / High 6,236 · Low 1" report showed them doing. */
  const openTotal = totalCount(counts);

  /* Reset to the first page whenever the visible set changes underfoot — a new
     tab or a new search (search is the only filter now). Done as a render-time reset keyed off
     the view rather than an effect, so it lands before paint (no flash of a
     stale page) and without a cascading extra render. */
  const [page, setPage] = useState(0);
  const viewKey = `${tab}|${search}`;
  const [pagedView, setPagedView] = useState(viewKey);
  if (pagedView !== viewKey) {
    setPagedView(viewKey);
    setPage(0);
  }

  const activeList = tab === 'open' ? filteredOpen : filteredResolved;
  const pageCount = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE));
  // A data reload can shrink the list under the page the operator is on; clamp
  // rather than show an empty page for a queue that still has rows.
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pagedOpen = useMemo(
    () => filteredOpen.slice(pageStart, pageStart + PAGE_SIZE),
    [filteredOpen, pageStart],
  );
  const pagedResolved = useMemo(
    () => filteredResolved.slice(pageStart, pageStart + PAGE_SIZE),
    [filteredResolved, pageStart],
  );

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
        showToast(t('msg.resolvedNotSavedTryThose', { count: resolved.length, failed }), 'error');
      } else {
        showToast(t(resolved.length === 1 ? 'msg.riskSignalResolved' : 'msg.riskSignalsResolved', { count: resolved.length }), 'success');
      }
    } catch (err) {
      console.error('Failed to resolve risks:', err);
      showToast(t('msg.resolutionNotSavedTryAgain'), 'error');
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
      showToast(t('msg.riskSignalReopened'), 'success');
    } catch (err) {
      console.error('Failed to reopen risk:', err);
      showToast(t('msg.riskSignalNotReopenedTry'), 'error');
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
                { key: 'open', label: 'Open', count: openTotal },
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
        {/* The conflicts feed feeds the open count. When it fails to load the
            count is understated, so the queue says so and offers a retry rather
            than presenting a quietly-low number as a clean platform. */}
        {conflictStatus === 'error' && (
          <div
            role="status"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              padding: '8px 12px', marginBottom: 12, borderRadius: 8,
              background: 'var(--overlay-subtle)',
              borderInlineStart: '3px solid var(--color-warning-600)',
              fontSize: 13, color: 'var(--text-primary)',
            }}
          >
            <span>{t('riskCenter.conflictsUnavailable')}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={reloadConflicts}>
              {t('riskCenter.retry')}
            </button>
          </div>
        )}

        <div className="sadb-search-row sadb-search-row--table-aligned">
          <SadbSearch value={search} onChange={setSearch} placeholder="Search signal or detail…" ariaLabel="Search risk signals" />
          {/* Deliberately "all shown", not "all": whatever the filters have
              narrowed to is what an operator has actually just looked at. Past
              MAX_BULK_RESOLVE the one-click bulk is withheld — clearing a safety
              queue thousands of rows at a time, sight unseen, is exactly what a
              backlog of 6,000+ conflicts makes possible and dangerous. */}
          {tab === 'open' && filteredOpen.length > 0 && (
            filteredOpen.length > MAX_BULK_RESOLVE ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>
                {t('riskCenter.bulkCapped', { max: MAX_BULK_RESOLVE })}
              </span>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openResolveDialog(filteredOpen)}>
                Resolve all shown ({filteredOpen.length})
              </button>
            )
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
              {pagedOpen.map(r => (
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
                  <td>{humanizeStatus(r.status)}</td>
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
              {pagedResolved.map(d => (
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

        {/* The queue is paginated so a genuine backlog of thousands of rows does
            not mount as one table. */}
        {pageCount > 1 && (
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              gap: 12, padding: '10px 2px 2px', fontSize: 13, color: 'var(--text-muted)',
            }}
          >
            <span>
              {(pageStart + 1).toLocaleString()}–{Math.min(pageStart + PAGE_SIZE, activeList.length).toLocaleString()} of {activeList.length.toLocaleString()}
            </span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage <= 0}
                aria-label="Previous page"
              >
                Prev
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                disabled={safePage >= pageCount - 1}
                aria-label="Next page"
              >
                Next
              </button>
            </span>
          </div>
        )}
      </SadbCard>

      {/* The queue's only action surface. A row opens this; the signal is read
          here in full and the resolution is confirmed here, so nothing clears
          on a single click into a dense table. */}
      {resolving && (
        <Modal onClose={() => setResolving(null)} width={480} labelledBy="resolve-risk-title">
          <DialogFrame>
            <DialogHeader
              titleId="resolve-risk-title"
              title={<>{single ? single.signal : `Resolve ${resolving.length} risks`}</>}
              descriptionId="resolve-risk-title-desc"
              description={<>{single
                  ? 'Resolve this signal?'
                  : `${resolving.length} signals currently shown in the queue.`}
                {' '}Resolving records that it has been dealt with — it does not change the
                underlying data. If the condition happens again it comes back on its own.</>}
              onClose={() => setResolving(null)}
            />
            <DialogBody tight>

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
                  <div className="sadb-kv"><span>Status</span><span className="sadb-kv-value">{humanizeStatus(single.status)}</span></div>
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
            </DialogBody>
            {/* The row used to be a link to the subsystem it came from. That
                navigation lives here now, so opening the popup costs nothing. */}
            <DialogFooter
              start={single && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => router.push(rowHref(single))}
                  disabled={saving}
                >
                  Open in {single.source}
                </button>
              )}
            >
              <button type="button" className="btn btn-secondary" onClick={() => setResolving(null)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmResolve} disabled={saving}>
                {saving ? 'Saving…' : single ? 'Resolve' : `Resolve ${resolving.length}`}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}

      {/* Reopening puts a signal back in front of every operator, so it is
          asked for the same way resolving is rather than firing from a row. */}
      {reopening && (
        <Modal onClose={() => setReopening(null)} width={480} labelledBy="reopen-risk-title">
          <DialogFrame>
            <DialogHeader
              titleId="reopen-risk-title"
              title={reopening.signal}
              descriptionId="reopen-risk-title-desc"
              description="Reopen this signal? It goes back into the Open queue and counts against the readiness score again. The record of what was done is kept."
              onClose={() => setReopening(null)}
            />
            <DialogBody tight>
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
            </DialogBody>
            <DialogFooter>
              <button type="button" className="btn btn-secondary" onClick={() => setReopening(null)} disabled={reopenBusy}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmReopen} disabled={reopenBusy}>
                {reopenBusy ? 'Reopening…' : 'Reopen'}
              </button>
            </DialogFooter>
          </DialogFrame>
        </Modal>
      )}
    </SadbPage>
  );
}
