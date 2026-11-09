'use client';

/**
 * Super-admin → Audit Logs (sadb-* design language, migrated per
 * docs/SUPER-ADMIN-DESIGN-PLAN.md § Phase 1).
 * Filterable, paginated view over the real audit_log store, with a
 * client-side CSV export of whatever is currently filtered (for evidence
 * requests / compliance reviews). Every row opens a full-entry dialog —
 * the table shows the reviewer's summary columns, the dialog shows every
 * structured field (IP, route, resource, patient, query) plus the next
 * steps an investigation actually takes from a log line.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useUsers } from '@/lib/hooks/useUsers';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import { DialogBody, DialogFooter, DialogFrame, DialogHeader } from '@/components/overlay/Dialog';
import type { AuditLogDoc, RiskResolutionDoc } from '@/lib/db-types';
import { FilterSelect } from '@/components/filters';
import { X } from '@/components/icons/lucide';
import { getRiskResolutions, indexResolutions } from '@/lib/services/risk-resolution-service';
import { reopenRisk, resolveRisk } from '@/lib/services/risk-resolution-client';
import { SaTable, classifyAuditRisk, formatAuditAction, formatWhen, type SaSeverity } from '@/components/admin/sa-ui';
import { SadbPage, SadbCard, SadbChip, SadbSearch, SadbKvRow, SEVERITY_CHIP } from '@/components/admin/sadb-ui';
import { todayIso } from '@/lib/date-utils';
import { stopsClickPropagation } from '@/lib/a11y';
import { useNow } from '@/lib/hooks/useNow';
import { useTranslation } from '@/lib/i18n/useTranslation';

type RangeFilter = '24h' | '7d' | '30d' | 'all';
type SuccessFilter = 'all' | 'success' | 'failure';
type RiskFilter = 'all' | SaSeverity;

const SEVERITIES: SaSeverity[] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_KEY: Record<SaSeverity, string> = {
  critical: 'admin.healthCritical',
  high: 'epidemic.severityHigh',
  medium: 'syncConflicts.riskFilter_medium',
  low: 'epidemic.severityLow',
};

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};

function csvCell(v: string): string {
  // Formula-injection guard before RFC 4180 quoting: an apostrophe keeps a cell
  // a spreadsheet would execute (leading =, +, -, @) as plain text.
  const text = /^[\t\r ]*[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function AuditLogsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const scope = useDataScope();
  const { showToast } = useToast();
  const { organizations } = useOrganizations();
  const { users } = useUsers();
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [loading, setLoading] = useState(true);
  // The row the reviewer opened — the dialog shows the full entry.
  const [selected, setSelected] = useState<{ log: AuditLogDoc; risk: SaSeverity } | null>(null);
  const focusHandledRef = useRef(false);

  const [range, setRange] = useState<RangeFilter>('7d');
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [orgFilter, setOrgFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');
  /**
   * "Show this user's activity" — a real scope, not a search term.
   *
   * It used to write the username into the free-text box, which matched the
   * action/username/details haystack: an admin who *acted on* a user showed up
   * inside that user's "activity", and an entry carrying only a `userId` (no
   * username) matched nothing at all, so the log reported that a user with
   * plenty of history had none. Both identifiers are kept and either one
   * matching is enough.
   */
  const [userScope, setUserScope] = useState<{ id?: string; name?: string } | null>(null);
  const [resolutions, setResolutions] = useState<RiskResolutionDoc[]>([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getRecentAuditLogs } = await import('@/lib/services/audit-service');
        const [data, saved] = await Promise.all([getRecentAuditLogs(1000, scope), getRiskResolutions()]);
        if (mounted) { setLogs(data); setResolutions(saved); }
      } catch (err) {
        console.error('Failed to load audit logs:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [scope]);

  useEffect(() => {
    if (logs.length === 0 || focusHandledRef.current) return;
    const focusId = new URLSearchParams(window.location.search).get('log');
    focusHandledRef.current = true;
    if (!focusId) return;
    const log = logs.find(entry => entry._id === focusId);
    if (log) setSelected({ log, risk: classifyAuditRisk(log.action, log.success) });
  }, [logs]);

  const resolutionIndex = useMemo(() => indexResolutions(resolutions), [resolutions]);

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const org of organizations) m.set(org._id, org.name);
    return m;
  }, [organizations]);

  const userByIdentity = useMemo(() => {
    const index = new Map<string, (typeof users)[number]>();
    for (const user of users) {
      index.set(`id:${user._id}`, user);
      index.set(`name:${user.username}`, user);
    }
    return index;
  }, [users]);

  /** Older and login audit entries did not persist `orgId`. Recover the
   * actor's tenant from the staff directory so the identity cell and Org
   * column do not silently lose scope. */
  const userForLog = useCallback((log: AuditLogDoc) => (
    (log.userId ? userByIdentity.get(`id:${log.userId}`) : undefined)
    ?? (log.username ? userByIdentity.get(`name:${log.username}`) : undefined)
  ), [userByIdentity]);

  const orgIdForLog = useCallback((log: AuditLogDoc) => (
    log.orgId || userForLog(log)?.orgId
  ), [userForLog]);

  const orgNameForLog = useCallback((log: AuditLogDoc) => {
    const user = userForLog(log);
    const orgId = log.orgId || user?.orgId;
    return (orgId ? orgNameById.get(orgId) : undefined)
      || user?.orgName
      || (user?.role === 'super_admin' || log.username === 'superadmin'
        ? t('adminMgmt.platformAdministration')
        : t('adminMgmt.orgUnavailable'));
  }, [orgNameById, userForLog, t]);

  const withRisk = useMemo(
    () => logs.map(log => ({ log, risk: classifyAuditRisk(log.action, log.success) })),
    [logs]
  );

  const now = useNow();
  const inRange = useMemo(() => {
    if (range === 'all') return withRisk;
    const cutoff = now - RANGE_MS[range];
    return withRisk.filter(({ log }) => {
      const t = log.createdAt ? new Date(log.createdAt).getTime() : 0;
      return t >= cutoff;
    });
  }, [withRisk, range, now]);

  const stats = useMemo(() => {
    const failures = inRange.filter(({ log }) => !log.success).length;
    const highRisk = inRange.filter(({ risk }) => risk === 'critical' || risk === 'high').length;
    const users = new Set(inRange.map(({ log }) => log.userId || log.username || 'unknown'));
    return { events: inRange.length, failures, highRisk, users: users.size };
  }, [inRange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inRange.filter(({ log, risk }) => {
      if (successFilter === 'success' && !log.success) return false;
      if (successFilter === 'failure' && log.success) return false;
      if (riskFilter !== 'all' && risk !== riskFilter) return false;
      if (orgFilter !== 'all' && orgIdForLog(log) !== orgFilter) return false;
      if (userScope) {
        const byId = !!userScope.id && log.userId === userScope.id;
        const byName = !!userScope.name && log.username === userScope.name;
        if (!byId && !byName) return false;
      }
      if (q) {
        const haystack = `${log.action} ${formatAuditAction(log.action)} ${log.username || ''} ${orgNameForLog(log)} ${log.details || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [inRange, successFilter, riskFilter, orgFilter, search, userScope, orgIdForLog, orgNameForLog]);

  const exportCsv = () => {
    const header = ['timestamp', 'user', 'org', 'action', 'details', 'success', 'risk'];
    const lines = [header.join(',')];
    for (const { log, risk } of filtered) {
      lines.push([
        csvCell(log.createdAt || ''),
        csvCell(log.username || log.userId || ''),
        csvCell(orgNameForLog(log)),
        csvCell(log.action),
        csvCell(log.details || ''),
        csvCell(String(log.success)),
        csvCell(risk),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-evidence-${todayIso()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const scopeFilterCount = userScope ? 1 : 0;
  const activeFilterCount = scopeFilterCount +
    (successFilter !== 'all' ? 1 : 0) +
    (riskFilter !== 'all' ? 1 : 0) +
    (orgFilter !== 'all' ? 1 : 0) +
    (range !== '7d' ? 1 : 0);

  return (
    <SadbPage>
      <SadbCard
        title={t('ui.auditLogs')}
        meta={t('adminMgmt.nOfMEvents', { shown: filtered.length, total: inRange.length })}
        action={
          <div className="sadb-legend">
            <span><i style={{ background: stats.failures ? 'var(--color-danger-500)' : 'var(--text-muted)' }} />{t('ui.failures')}{stats.failures})</span>
            <span><i style={{ background: stats.highRisk ? 'var(--color-danger-500)' : 'var(--color-warning-600)' }} />{t('ui.highRisk')}{stats.highRisk})</span>
            <span><i style={{ background: 'var(--text-muted)' }} />{t('ui.distinctUsers')}{stats.users})</span>
          </div>
        }
      >
        <div className="sadb-search-row sadb-search-row--table-aligned">
          <SadbSearch
            value={search} onChange={setSearch}
            placeholder={t('ui.searchActionUserOrDetails')} ariaLabel={t('adminMgmt.searchAuditLog')}
            filters={{
              activeCount: activeFilterCount,
              onClear: () => { setSuccessFilter('all'); setRiskFilter('all'); setOrgFilter('all'); setRange('7d'); setUserScope(null); },
              children: (
                <>
                <FilterSelect
                  label={t('lab.result')}
                  value={successFilter}
                  onChange={value => setSuccessFilter(value as SuccessFilter)}
                  neutralValue="all"
                  size="sm"
                  options={[{ value: 'all', label: t('adminMgmt.allResults') }, { value: 'success', label: t('admin.statusSuccess') }, { value: 'failure', label: t('ui.failure') }]}
                />
                <FilterSelect
                  label={t('routeContext.risk')}
                  value={riskFilter}
                  onChange={value => setRiskFilter(value as RiskFilter)}
                  neutralValue="all"
                  size="sm"
                  options={[{ value: 'all', label: t('adminMgmt.allRisk') }, ...SEVERITIES.map(s => ({ value: s, label: t(SEVERITY_KEY[s]) }))]}
                />
                <FilterSelect
                  label={t('adminBilling.colOrganization')}
                  value={orgFilter}
                  onChange={setOrgFilter}
                  neutralValue="all"
                  size="sm"
                  options={[{ value: 'all', label: t('management.allOrganizations') }, ...organizations.map(org => ({ value: org._id, label: org.name }))]}
                />
                <FilterSelect
                  label={t('ui.dateRange')}
                  value={range}
                  onChange={value => setRange(value as RangeFilter)}
                  neutralValue="7d"
                  size="sm"
                  options={[
                    { value: '24h', label: t('adminMgmt.last24h') },
                    { value: '7d', label: t('adminMgmt.last7d') },
                    { value: '30d', label: t('analytics.last30Days') },
                    { value: 'all', label: t('adminMgmt.allTime') },
                  ]}
                />
                </>
              ),
            }}
          />
          {/* The scope is a visible, removable state — not an invisible filter
              and not text silently typed into the search box on the reviewer's
              behalf, which is what it used to be. */}
          {userScope && (
            <button
              type="button"
              className="btn btn-secondary btn-sm flex-shrink-0"
              onClick={() => setUserScope(null)}
              title={t('ui.showEveryUserAgain')}
            >
              {t('ui.activity')} {userScope.name || userScope.id} <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="button" className="tm-ghost-btn flex-shrink-0" onClick={exportCsv}>{t('adminMgmt.exportCsv')}</button>
        </div>
        {/* No pager: every matching event lives in the page's own scroll, and the
            head's "Showing X of Y" meta states the count. */}
        <div className="sadb-edge-aligned-table" style={{ overflowX: 'auto' }}>
          <SaTable
            columns={[
              t('admin.colUser'), t('transfers.when'), t('adminMgmt.colOrg'), t('admin.colAction'),
              t('adminUsers.activityDetail'), t('lab.result'), t('routeContext.risk'), t('issues.action.resolve'),
            ]}
            empty={loading ? t('adminMgmt.loadingAuditLogs') : t('adminMgmt.noAuditMatch')}
          >
            {filtered.map(({ log, risk }) => (
              <tr
                key={log._id}
                tabIndex={0}
                aria-label={t('adminMgmt.openAuditEntry', { action: formatAuditAction(log.action) })}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected({ log, risk })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected({ log, risk }); } }}
              >
                <td>
                  <span className="min-w-0">
                    <span className="sadb-tenant-name truncate">{log.username || log.userId || t('admin.systemUser')}</span>
                    <span className="sadb-tenant-sub truncate">{orgNameForLog(log)}</span>
                  </span>
                </td>
                <td>{formatWhen(log.createdAt)}</td>
                <td>{orgNameForLog(log)}</td>
                <td>{formatAuditAction(log.action)}</td>
                <td>{log.details || '—'}</td>
                <td><SadbChip tone={log.success ? 'green' : 'red'}>{log.success ? t('admin.statusSuccess') : t('ui.failure')}</SadbChip></td>
                <td><SadbChip tone={SEVERITY_CHIP[risk]}>{t(SEVERITY_KEY[risk])}</SadbChip></td>
                <td>
                  {log.success ? (
                    <span className="sadb-table-action-state">{t('ui.notNeeded')}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm sadb-table-action"
                      onClick={event => {
                        event.stopPropagation();
                        setSelected({ log, risk });
                      }}
                      onKeyDown={event => event.stopPropagation()}
                      aria-label={t(resolutionIndex.has(`audit-${log._id}`) ? 'adminMgmt.reviewResolvedAuditRisk' : 'adminMgmt.resolveAuditRisk', { action: log.action })}
                    >
                      {resolutionIndex.has(`audit-${log._id}`) ? t('ui.resolved') : t('issues.action.resolve')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </SaTable>
        </div>
      </SadbCard>

      {selected && (
        <AuditEntryDialog
          log={selected.log}
          risk={selected.risk}
          orgName={orgNameForLog(selected.log)}
          onClose={() => setSelected(null)}
          onFilterUser={() => {
            // Scope to the account, then get out of the way: the result/risk
            // filters and the seven-day window would each hide part of the
            // very thing the reviewer just asked to see. The search box is
            // left alone — it is the reviewer's, not this button's.
            setUserScope({ id: selected.log.userId, name: selected.log.username });
            setSuccessFilter('all'); setRiskFilter('all'); setOrgFilter('all'); setRange('all');
            setSelected(null);
          }}
          onOpenPatient={selected.log.patientId
            ? () => router.push(`/patients/${selected.log.patientId}`)
            : undefined}
          onOpenUser={(selected.log.username || selected.log.userId)
            ? () => router.push(`/admin/users?q=${encodeURIComponent(selected.log.username || selected.log.userId || '')}`)
            : undefined}
          resolution={resolutionIndex.get(`audit-${selected.log._id}`)}
          onResolve={async note => {
            try {
              await resolveRisk({
                riskId: `audit-${selected.log._id}`,
                signature: selected.log._id,
                severity: selected.risk,
                source: 'Audit',
                signal: selected.log.action,
                note,
              });
              setResolutions(await getRiskResolutions());
              showToast(t('msg.entryResolvedAndRemovedFrom'), 'success');
            } catch (err) {
              console.error('Failed to resolve audit risk:', err);
              showToast(t('msg.resolutionNotSavedTryAgain'), 'error');
            }
          }}
          onReopen={async () => {
            try {
              await reopenRisk(`audit-${selected.log._id}`);
              setResolutions(await getRiskResolutions());
              showToast(t('msg.entryReopenedAndReturnedTo'), 'success');
            } catch (err) {
              console.error('Failed to reopen audit risk:', err);
              showToast(t('msg.entryNotReopenedTryAgain'), 'error');
            }
          }}
          onCopyJson={async () => {
            try {
              await navigator.clipboard.writeText(JSON.stringify(selected.log, null, 2));
              showToast(t('msg.auditEntryCopiedAsJson'), 'success');
            } catch {
              showToast(t('msg.notCopiedThisBrowserBlocked'), 'error');
            }
          }}
        />
      )}
    </SadbPage>
  );
}

/** One field row in the entry dialog. Empty values render nothing — the
 *  dialog states what the entry knows, not a wall of dashes. */
function EntryKv({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <SadbKvRow
      label={label}
      value={
        <span style={{
          fontWeight: 600,
          fontSize: 13,
          overflowWrap: 'anywhere',
          textAlign: 'end',
          fontFamily: mono ? 'var(--font-mono, ui-monospace, monospace)' : undefined,
        }}>
          {value}
        </span>
      }
    />
  );
}

function AuditEntryDialog({
  log, risk, orgName, resolution, onClose, onFilterUser, onOpenPatient, onOpenUser, onResolve, onReopen, onCopyJson,
}: {
  log: AuditLogDoc;
  risk: SaSeverity;
  orgName?: string;
  onClose: () => void;
  /** Present when this entry has already been marked resolved. */
  resolution?: RiskResolutionDoc;
  onFilterUser: () => void;
  onOpenPatient?: () => void;
  onOpenUser?: () => void;
  onResolve: (note?: string) => void | Promise<void>;
  onReopen: () => void | Promise<void>;
  onCopyJson: () => void;
}) {
  const { t } = useTranslation();
  const [noteDraft, setNoteDraft] = useState('');
  const when = log.createdAt
    ? `${new Date(log.createdAt).toLocaleString()} (${formatWhen(log.createdAt)})`
    : undefined;
  return (
    <Modal onClose={onClose} width={640} labelledBy="audit-entry-title">
      {/* Clicks inside a portal still bubble through React to the row that
          opened it; stop them here so the row does not re-open the entry. */}
      <div style={{ display: 'contents' }} {...stopsClickPropagation}>
      <DialogFrame>
        <DialogHeader titleId="audit-entry-title" title={formatAuditAction(log.action)} description={when} onClose={onClose} />
        <DialogBody>
        <div className="flex items-center flex-wrap gap-2" style={{ margin: '0 0 16px' }}>
          {log.success ? <SadbChip tone="green">{t('admin.statusSuccess')}</SadbChip> : <SadbChip tone="red">{t('ui.failure')}</SadbChip>}
          <SadbChip tone={SEVERITY_CHIP[risk]}>{t('adminMgmt.riskChip', { level: t(SEVERITY_KEY[risk]) })}</SadbChip>
          {resolution && <SadbChip tone="green">{t('ui.resolved')}</SadbChip>}
        </div>

        {resolution && (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 16px' }}>
            {t('conflicts.actionResolved')} {formatWhen(resolution.resolvedAt)}
            {resolution.resolvedByName ? t('adminMgmt.resolvedByName', { name: resolution.resolvedByName }) : ''}
            {resolution.note ? ` — ${resolution.note}` : ''}
          </p>
        )}

        {/* Full details line first — it is the sentence the row truncated. */}
        {log.details && (
          <p style={{ fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '0 0 16px', padding: '10px 12px', background: 'var(--overlay-subtle)', borderRadius: 0 }}>
            {log.details}
          </p>
        )}

        <div style={{ border: '1px solid var(--border-light)', borderRadius: 0, marginBottom: 16 }}>
          <EntryKv label={t('admin.colUser')} value={log.username || log.userId || t('admin.systemUser')} />
          <EntryKv label={t('ui.userId')} value={log.userId} mono />
          <EntryKv label={t('adminUsers.colRole')} value={log.role} />
          <EntryKv label={t('adminBilling.colOrganization')} value={orgName || log.orgId} />
          <EntryKv label={t('births.colFacility')} value={log.hospitalId} mono />
          <EntryKv label={t('ui.ipAddress')} value={log.ip} mono />
          <EntryKv label={t('consultation.rxRoute')} value={log.route} mono />
          <EntryKv label={t('ui.resourceType')} value={log.resourceType} />
          <EntryKv label={t('ui.resourceId')} value={log.resourceId} mono />
          <EntryKv label={t('appointments.labelPatient')} value={log.patientId} mono />
          <EntryKv label={t('ui.searchQuery')} value={log.query} mono />
          <EntryKv label={t('ui.recordsReturned')} value={log.resultCount} />
          <EntryKv label={t('ui.entryId')} value={log._id} mono />
        </div>

        {/* An optional line on what was done, written before resolving. It
            lands on the resolution record and shows in the Risk Center's
            Resolved list, which is where the next reviewer will look. */}
        {!log.success && !resolution && (
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="audit-resolve-note" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              {t('ui.whatWasDoneAboutIt')}
            </label>
            <textarea rows={1}
              id="audit-resolve-note"
              className="sadb-modal-input"
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder={t('ui.eGResetTheAccount')}
            />
          </div>
        )}

        </DialogBody>
        {/* Next steps — where an investigation goes from one log line. The
            look-elsewhere links sit on the strip above; the decision itself
            (resolve or reopen) takes the action bar. */}
        <DialogFooter
          start={(
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onFilterUser}>{t('ui.showThisUserSActivity')}</button>
              {onOpenUser && <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenUser}>{t('adminMgmt.viewUserAccount')}</button>}
              {onOpenPatient && <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenPatient}>{t('referrals.openPatientChart')}</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={onCopyJson}>{t('ui.copyEntryJson')}</button>
            </div>
          )}
        >
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('action.close')}</button>
          {/* Only failures reach the Risk Center, so only failures can be
              resolved from here — offering it on a successful entry would
              imply a queue row that does not exist. */}
          {!log.success && (resolution
            ? <button type="button" className="btn btn-primary" onClick={() => onReopen()}>{t('ui.reopenRisk')}</button>
            : <button type="button" className="btn btn-primary" onClick={() => onResolve(noteDraft)}>{t('issues.action.resolve')}</button>
          )}
        </DialogFooter>
      </DialogFrame>
      </div>
    </Modal>
  );
}
