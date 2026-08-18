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
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOrganizations } from '@/lib/hooks/useOrganizations';
import { useToast } from '@/components/Toast';
import Modal from '@/components/Modal';
import type { AuditLogDoc } from '@/lib/db-types';
import { EhrListFilters } from '@/components/ehr/EhrListHeader';
import { FilterSelect } from '@/components/filters';
import { X } from '@/components/icons/lucide';
import { SaTable, classifyAuditRisk, formatWhen, type SaSeverity } from '@/components/admin/sa-ui';
import { SadbPage, SadbCard, SadbChip, SadbSearch, SadbKvRow, SEVERITY_CHIP } from '@/components/admin/sadb-ui';

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
  const { showToast } = useToast();
  const { organizations } = useOrganizations();
  const [logs, setLogs] = useState<AuditLogDoc[]>([]);
  const [loading, setLoading] = useState(true);
  // The row the reviewer opened — the dialog shows the full entry.
  const [selected, setSelected] = useState<{ log: AuditLogDoc; risk: SaSeverity } | null>(null);

  const [range, setRange] = useState<RangeFilter>('7d');
  const [successFilter, setSuccessFilter] = useState<SuccessFilter>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [orgFilter, setOrgFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { getRecentAuditLogs } = await import('@/lib/services/audit-service');
        const data = await getRecentAuditLogs(1000);
        if (mounted) setLogs(data);
      } catch (err) {
        console.error('Failed to load audit logs:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const org of organizations) m.set(org._id, org.name);
    return m;
  }, [organizations]);

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
      if (orgFilter !== 'all' && log.orgId !== orgFilter) return false;
      if (q) {
        const haystack = `${log.action} ${log.username || ''} ${log.details || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [inRange, successFilter, riskFilter, orgFilter, search]);

  const exportCsv = () => {
    const header = ['timestamp', 'user', 'org', 'action', 'details', 'success', 'risk'];
    const lines = [header.join(',')];
    for (const { log, risk } of filtered) {
      lines.push([
        csvCell(log.createdAt || ''),
        csvCell(log.username || log.userId || ''),
        csvCell(orgNameById.get(log.orgId || '') || log.orgId || ''),
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
    a.download = `audit-evidence-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const activeFilterCount =
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
        <div className="sadb-search-row">
          <SadbSearch value={search} onChange={setSearch} placeholder="Search action, user, or details…" ariaLabel="Search audit log" />
          <button type="button" className="btn btn-primary btn-sm flex-shrink-0" onClick={exportCsv}>Export evidence (CSV)</button>
          <EhrListFilters activeCount={activeFilterCount} onClear={() => { setSuccessFilter('all'); setRiskFilter('all'); setOrgFilter('all'); setRange('7d'); }}>
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
          </EhrListFilters>
        </div>
        {/* No pager: every matching event lives in one scroll area, and the
            head's "Showing X of Y" meta states the count. */}
        <div style={{ maxHeight: 620, overflowY: 'auto' }}>
          <SaTable
            columns={['When', 'User', 'Org', 'Action', 'Detail', 'Result', 'Risk']}
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
                <td>{formatWhen(log.createdAt)}</td>
                <td><strong>{log.username || log.userId || 'System'}</strong></td>
                <td>{orgNameById.get(log.orgId || '') || (log.orgId ? log.orgId : '—')}</td>
                <td>{log.action}</td>
                <td>{log.details || '—'}</td>
                <td><SadbChip tone={log.success ? 'green' : 'red'}>{log.success ? 'Success' : 'Failure'}</SadbChip></td>
                <td><SadbChip tone={SEVERITY_CHIP[risk]}>{risk.toUpperCase()}</SadbChip></td>
              </tr>
            ))}
          </SaTable>
        </div>
      </SadbCard>

      {selected && (
        <AuditEntryDialog
          log={selected.log}
          risk={selected.risk}
          orgName={orgNameById.get(selected.log.orgId || '')}
          onClose={() => setSelected(null)}
          onFilterUser={() => {
            setSearch(selected.log.username || selected.log.userId || '');
            setSuccessFilter('all'); setRiskFilter('all');
            setSelected(null);
          }}
          onOpenPatient={selected.log.patientId
            ? () => router.push(`/patients/${selected.log.patientId}`)
            : undefined}
          onOpenUser={(selected.log.username || selected.log.userId)
            ? () => router.push(`/admin/users?q=${encodeURIComponent(selected.log.username || selected.log.userId || '')}`)
            : undefined}
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
  log, risk, orgName, onClose, onFilterUser, onOpenPatient, onOpenUser, onCopyJson,
}: {
  log: AuditLogDoc;
  risk: SaSeverity;
  orgName?: string;
  onClose: () => void;
  onFilterUser: () => void;
  onOpenPatient?: () => void;
  onOpenUser?: () => void;
  onCopyJson: () => void;
}) {
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
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
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
        </div>

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

        {/* Next steps — where an investigation goes from one log line. */}
        <div className="sadb-modal-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', borderTop: '1px solid var(--border-light)', paddingTop: 14, marginTop: 0 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onFilterUser}>Show this user&apos;s activity</button>
          {onOpenUser && <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenUser}>View in User Management</button>}
          {onOpenPatient && <button type="button" className="btn btn-secondary btn-sm" onClick={onOpenPatient}>Open patient chart</button>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCopyJson}>Copy entry JSON</button>
        </div>
      </div>
    </Modal>
  );
}
