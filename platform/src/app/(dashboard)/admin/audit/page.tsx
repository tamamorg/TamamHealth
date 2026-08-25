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
import { useAuth } from '@/lib/context';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import type { AuditLogDoc, RiskResolutionDoc } from '@/lib/db-types';
import { FilterSelect } from '@/components/filters';
import { X } from '@/components/icons/lucide';
import {
  getRiskResolutions, indexResolutions, reopenRisk, resolveRisk,
} from '@/lib/services/risk-resolution-service';
import { SaTable, classifyAuditRisk, formatWhen, type SaSeverity } from '@/components/admin/sa-ui';
import { SadbPage, SadbCard, SadbChip, SadbSearch, SadbKvRow, SEVERITY_CHIP } from '@/components/admin/sadb-ui';
import { todayIso } from '@/lib/date-utils';
import { stopsClickPropagation } from '@/lib/a11y';

type RangeFilter = '24h' | '7d' | '30d' | 'all';
type SuccessFilter = 'all' | 'success' | 'failure';
type RiskFilter = 'all' | SaSeverity;

const SEVERITIES: SaSeverity[] = ['critical', 'high', 'medium', 'low'];

const RANGE_MS: Record<Exclude<RangeFilter, 'all'>, number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function AuditLogsPage() {
  const router = useRouter();
  const { currentUser } = useAuth();
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
        const [data, saved] = await Promise.all([getRecentAuditLogs(1000), getRiskResolutions()]);
        if (mounted) { setLogs(data); setResolutions(saved); }
      } catch (err) {
        console.error('Failed to load audit logs:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (logs.length === 0 || focusHandledRef.current) return;
    const focusId = new URLSearchParams(window.location.search).get('log');
    focusHandledRef.current = true;
    if (!focusId) return;
    const log = logs.find(entry => entry._id === focusId);
    if (log) setSelected({ log, risk: classifyAuditRisk(log.action, log.success) });
  }, [logs]);

  const resolutionIndex = useMemo(() => indexResolutions(resolutions), [resolutions]);
  const actor = { _id: currentUser?._id, username: currentUser?.username, name: currentUser?.name };

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
        ? 'Platform administration'
        : 'Organization unavailable');
  }, [orgNameById, userForLog]);

  const withRisk = useMemo(
    () => logs.map(log => ({ log, risk: classifyAuditRisk(log.action, log.success) })),
    [logs]
  );

  const inRange = useMemo(() => {
    if (range === 'all') return withRisk;
    const cutoff = Date.now() - RANGE_MS[range];
    return withRisk.filter(({ log }) => {
      const t = log.createdAt ? new Date(log.createdAt).getTime() : 0;
      return t >= cutoff;
    });
  }, [withRisk, range]);

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
        const haystack = `${log.action} ${log.username || ''} ${orgNameForLog(log)} ${log.details || ''}`.toLowerCase();
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
        title="Audit logs"
        meta={`${filtered.length} of ${inRange.length} events`}
        action={
          <div className="sadb-legend">
            <span><i style={{ background: stats.failures ? 'var(--color-danger-500)' : 'var(--text-muted)' }} />Failures ({stats.failures})</span>
            <span><i style={{ background: stats.highRisk ? 'var(--color-danger-500)' : 'var(--color-warning-600)' }} />High-risk ({stats.highRisk})</span>
            <span><i style={{ background: 'var(--text-muted)' }} />Distinct users ({stats.users})</span>
          </div>
        }
      >
        <div className="sadb-search-row sadb-search-row--table-aligned">
          <SadbSearch
            value={search} onChange={setSearch}
            placeholder="Search action, user, or details…" ariaLabel="Search audit log"
            filters={{
              activeCount: activeFilterCount,
              onClear: () => { setSuccessFilter('all'); setRiskFilter('all'); setOrgFilter('all'); setRange('7d'); setUserScope(null); },
              children: (
                <>
                <FilterSelect
                  label="Result"
                  value={successFilter}
                  onChange={value => setSuccessFilter(value as SuccessFilter)}
                  neutralValue="all"
                  size="sm"
                  options={[{ value: 'all', label: 'All results' }, { value: 'success', label: 'Success' }, { value: 'failure', label: 'Failure' }]}
                />
                <FilterSelect
                  label="Risk"
                  value={riskFilter}
                  onChange={value => setRiskFilter(value as RiskFilter)}
                  neutralValue="all"
                  size="sm"
                  options={[{ value: 'all', label: 'All risk' }, ...SEVERITIES.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]}
                />
                <FilterSelect
                  label="Organization"
                  value={orgFilter}
                  onChange={setOrgFilter}
                  neutralValue="all"
                  size="sm"
                  options={[{ value: 'all', label: 'All organizations' }, ...organizations.map(org => ({ value: org._id, label: org.name }))]}
                />
                <FilterSelect
                  label="Date range"
                  value={range}
                  onChange={value => setRange(value as RangeFilter)}
                  neutralValue="7d"
                  size="sm"
                  options={[
                    { value: '24h', label: 'Last 24h' },
                    { value: '7d', label: 'Last 7 days' },
                    { value: '30d', label: 'Last 30 days' },
                    { value: 'all', label: 'All time' },
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
              title="Show every user again"
            >
              Activity: {userScope.name || userScope.id} <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="button" className="btn btn-primary btn-sm flex-shrink-0" onClick={exportCsv}>Export evidence (CSV)</button>
        </div>
        {/* No pager: every matching event lives in one scroll area, and the
            head's "Showing X of Y" meta states the count. */}
        <div className="sadb-edge-aligned-table" style={{ maxHeight: 620, overflowY: 'auto' }}>
          <SaTable
            columns={[
              'User', 'When', 'Org', 'Action', 'Detail', 'Result', 'Risk', 'Resolve',
            ]}
            empty={loading ? 'Loading audit logs…' : 'No audit events match these filters.'}
          >
            {filtered.map(({ log, risk }) => (
              <tr
                key={log._id}
                tabIndex={0}
                aria-label={`Open audit entry: ${log.action}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected({ log, risk })}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected({ log, risk }); } }}
              >
                <td>
                  <span className="min-w-0">
                    <span className="sadb-tenant-name truncate">{log.username || log.userId || 'System'}</span>
                    <span className="sadb-tenant-sub truncate">{orgNameForLog(log)}</span>
                  </span>
                </td>
                <td>{formatWhen(log.createdAt)}</td>
                <td>{orgNameForLog(log)}</td>
                <td>{log.action}</td>
                <td>{log.details || '—'}</td>
                <td><SadbChip tone={log.success ? 'green' : 'red'}>{log.success ? 'Success' : 'Failure'}</SadbChip></td>
                <td><SadbChip tone={SEVERITY_CHIP[risk]}>{risk.toUpperCase()}</SadbChip></td>
                <td>
                  {log.success ? (
                    <span className="sadb-table-action-state">Not needed</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm sadb-table-action"
                      onClick={event => {
                        event.stopPropagation();
                        setSelected({ log, risk });
                      }}
                      onKeyDown={event => event.stopPropagation()}
                      aria-label={`${resolutionIndex.has(`audit-${log._id}`) ? 'Review resolved' : 'Resolve'} audit risk: ${log.action}`}
                    >
                      {resolutionIndex.has(`audit-${log._id}`) ? 'Resolved' : 'Resolve'}
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
              }, actor);
              setResolutions(await getRiskResolutions());
              showToast('Marked resolved — it has left the Risk Center queue.', 'success');
            } catch (err) {
              console.error('Failed to resolve audit risk:', err);
              showToast('Could not save the resolution.', 'error');
            }
          }}
          onReopen={async () => {
            try {
              await reopenRisk(`audit-${selected.log._id}`, actor);
              setResolutions(await getRiskResolutions());
              showToast('Reopened — it is back in the Risk Center queue.', 'success');
            } catch (err) {
              console.error('Failed to reopen audit risk:', err);
              showToast('Could not reopen this entry.', 'error');
            }
          }}
          onCopyJson={async () => {
            try {
              await navigator.clipboard.writeText(JSON.stringify(selected.log, null, 2));
              showToast('Audit entry copied as JSON.', 'success');
            } catch {
              showToast('Could not copy — clipboard unavailable.', 'error');
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
  const [noteDraft, setNoteDraft] = useState('');
  const when = log.createdAt
    ? `${new Date(log.createdAt).toLocaleString()} (${formatWhen(log.createdAt)})`
    : undefined;
  return (
    <Modal onClose={onClose} width={640} labelledBy="audit-entry-title">
      {/* `.modal-panel` keeps this whole surface on the flat card background —
          it's on the global dialog rule's exclusion list. The title row below
          is deliberately left OUT of that exclusion: it's the rule's intended
          trigger, auto-painting a blue header band (see the "Modal internals"
          block in globals.css) so this read-only dialog gets the design's
          navy title bar without hand-rolling one here. Everything else
          (chips, fields, actions) lives outside that row, on the white panel,
          styled with the sadb-* tokens. */}
      <div className="modal-panel" {...stopsClickPropagation}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="audit-entry-title" className="sadb-modal-title">{log.action}</h2>
            {when && <p className="sadb-modal-sub">{when}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ background: 'var(--overlay-subtle)' }} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center flex-wrap gap-2" style={{ margin: '16px 0' }}>
          {log.success ? <SadbChip tone="green">Success</SadbChip> : <SadbChip tone="red">Failure</SadbChip>}
          <SadbChip tone={SEVERITY_CHIP[risk]}>{risk.toUpperCase()} RISK</SadbChip>
          {resolution && <SadbChip tone="green">RESOLVED</SadbChip>}
        </div>

        {resolution && (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '0 0 16px' }}>
            Resolved {formatWhen(resolution.resolvedAt)}
            {resolution.resolvedByName ? ` by ${resolution.resolvedByName}` : ''}
            {resolution.note ? ` — ${resolution.note}` : ''}
          </p>
        )}

        {/* Full details line first — it is the sentence the row truncated. */}
        {log.details && (
          <p style={{ fontSize: 13.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: '0 0 16px', padding: '10px 12px', background: 'var(--overlay-subtle)', borderRadius: 10 }}>
            {log.details}
          </p>
        )}

        <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, marginBottom: 16 }}>
          <EntryKv label="User" value={log.username || log.userId || 'System'} />
          <EntryKv label="User id" value={log.userId} mono />
          <EntryKv label="Role" value={log.role} />
          <EntryKv label="Organization" value={orgName || log.orgId} />
          <EntryKv label="Facility" value={log.hospitalId} mono />
          <EntryKv label="IP address" value={log.ip} mono />
          <EntryKv label="Route" value={log.route} mono />
          <EntryKv label="Resource type" value={log.resourceType} />
          <EntryKv label="Resource id" value={log.resourceId} mono />
          <EntryKv label="Patient" value={log.patientId} mono />
          <EntryKv label="Search query" value={log.query} mono />
          <EntryKv label="Records returned" value={log.resultCount} />
          <EntryKv label="Entry id" value={log._id} mono />
        </div>

        {/* An optional line on what was done, written before resolving. It
            lands on the resolution record and shows in the Risk Center's
            Resolved list, which is where the next reviewer will look. */}
        {!log.success && !resolution && (
          <div style={{ marginBottom: 14 }}>
            <label htmlFor="audit-resolve-note" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              What was done about it (optional)
            </label>
            <input
              id="audit-resolve-note"
              className="sadb-modal-input"
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder="e.g. Reset the account and confirmed the next login succeeded"
            />
          </div>
        )}

        {/* Next steps — where an investigation goes from one log line. */}
        <div className="sadb-modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: 14, marginTop: 0 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onFilterUser}>Show this user&apos;s activity</button>
          {/* Only failures reach the Risk Center, so only failures can be
              resolved from here — offering it on a successful entry would
              imply a queue row that does not exist. */}
          {!log.success && (resolution
            ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onReopen()}>Reopen risk</button>
            : <button type="button" className="btn btn-primary btn-sm" onClick={() => onResolve(noteDraft)}>Mark resolved</button>
          )}
          {onOpenUser && <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenUser}>View in User Management</button>}
          {onOpenPatient && <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenPatient}>Open patient chart</button>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCopyJson}>Copy entry JSON</button>
        </div>
      </div>
    </Modal>
  );
}
