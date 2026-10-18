'use client';

/**
 * Reported issues — the triage queue for staff issue reports, shown as the
 * second tab of `/inquiries` to the roles that triage patient inquiries.
 *
 * Same list surface and row language as the inquiry queue; the status pill
 * carries every action (triage rungs, assignment, writing a response the
 * reporter will see).
 */

import { useCallback, useMemo, useState } from 'react';
import EhrListHeader, { LIST_STAT_COLORS, type EhrListHeaderTab } from '@/components/ehr/EhrListHeader';
import RowStatusSelect, { type RowStatusOption } from '@/components/ehr/RowStatusSelect';
import Modal from '@/components/Modal';
import Select from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/context';
import { messagesDB } from '@/lib/db';
import type { MessageDoc } from '@/lib/db-types';
import { formatCompactDateTime } from '@/lib/format-utils';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { usePouchLiveReload } from '@/lib/hooks/usePouchLiveReload';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { avatarTint, initials } from '@/lib/patient-utils';
import { ROLE_LABEL } from '@/lib/role-display';
import { DETAILS_MAX, ISSUE_STATUSES, deriveIssueStatus, summariseIssues, type IssueStatus } from '../issue-rules';
import { ISSUE_SEVERITY_INK, ISSUE_STATUS_TOKENS } from './issue-status-tokens';

const ASSIGN_ME = '__assign-me';
const UNASSIGN = '__unassign';
const RESPOND = '__respond';

/** What a row's pill offers, by status. The current state is never offered. */
export function issueRowActions(
  message: Pick<MessageDoc, 'issueStatus' | 'issueAssignedToId'>,
  userId: string | undefined,
  t: (key: string) => string,
): RowStatusOption[] {
  const status = deriveIssueStatus(message);
  const moves: Array<[IssueStatus, string]> =
    status === 'new' ? [['in_progress', 'issues.action.startWork'], ['resolved', 'issues.action.resolve'], ['closed', 'issues.action.close']]
      : status === 'in_progress' ? [['resolved', 'issues.action.resolve'], ['closed', 'issues.action.close']]
        : status === 'resolved' ? [['closed', 'issues.action.close'], ['in_progress', 'issues.action.reopen']]
          : [['in_progress', 'issues.action.reopen']];
  const mine = !!userId && message.issueAssignedToId === userId;
  return [
    ...moves.map(([value, key]) => ({ value, label: t(key) })),
    ...(!mine ? [{ value: ASSIGN_ME, label: t('issues.action.assignMe'), group: t('issues.groupAssignment') }] : []),
    ...(message.issueAssignedToId ? [{ value: UNASSIGN, label: t('issues.action.unassign'), group: t('issues.groupAssignment') }] : []),
    { value: RESPOND, label: t('issues.action.respond'), group: t('issues.groupResponse') },
  ];
}

export default function IssueReportsQueue({
  tabs,
  onTabChange,
}: {
  tabs: EhrListHeaderTab[];
  onTabChange: (key: string) => void;
}) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();

  const [issues, setIssues] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<IssueStatus | 'all'>('all');
  const [responding, setResponding] = useState<MessageDoc | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!scope) return;
    try {
      const { getIssueReports } = await import('../services/issue-report-service');
      setIssues(await getIssueReports(scope));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload<MessageDoc>({
    load,
    database: messagesDB,
    includeDocs: true,
    shouldReload: change => !change.doc || change.doc.messageKind === 'issue_report',
    enabled: !!scope,
  });

  const summary = useMemo(() => summariseIssues(issues), [issues]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter(m => {
      if (statusFilter !== 'all' && deriveIssueStatus(m) !== statusFilter) return false;
      if (!q) return true;
      return `${m.subject || ''} ${m.body || ''} ${m.fromDoctorName || ''}`.toLowerCase().includes(q);
    });
  }, [issues, search, statusFilter]);

  const apply = async (report: MessageDoc, update: Parameters<typeof import('../services/issue-report-service').updateIssueReport>[1]) => {
    if (!currentUser || !scope) return false;
    const { updateIssueReport } = await import('../services/issue-report-service');
    const updated = await updateIssueReport(
      report._id, update, { id: currentUser._id, name: currentUser.name, role: currentUser.role }, scope,
    ).catch(() => null);
    if (!updated) { showToast(t('issues.updateFailed'), 'error'); return false; }
    setIssues(prev => prev.map(m => (m._id === updated._id ? updated : m)));
    showToast(t('issues.updated'), 'success');
    return true;
  };

  const onRowAction = (report: MessageDoc, value: string) => {
    if (value === RESPOND) { setResponding(report); setNoteDraft(report.issueResolutionNote || ''); return; }
    if (value === ASSIGN_ME && currentUser) { void apply(report, { assignedTo: { id: currentUser._id, name: currentUser.name } }); return; }
    if (value === UNASSIGN) { void apply(report, { assignedTo: null }); return; }
    if ((ISSUE_STATUSES as readonly string[]).includes(value)) void apply(report, { status: value as IssueStatus });
  };

  const saveResponse = async () => {
    if (!responding) return;
    setSaving(true);
    const ok = await apply(responding, { resolutionNote: noteDraft });
    setSaving(false);
    if (ok) setResponding(null);
  };

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }}>
        <EhrListHeader
          title={t('issues.queueTitle')}
          count={summary.total}
          tabs={tabs}
          activeTab="issues"
          onTabChange={onTabChange}
          tabsAriaLabel={t('issues.tabsAria')}
          stats={[
            { label: t('issues.status.new'), value: summary.byStatus.new, color: LIST_STAT_COLORS.amber },
            { label: t('issues.status.in_progress'), value: summary.byStatus.in_progress, color: LIST_STAT_COLORS.blue },
            { label: t('issues.status.resolved'), value: summary.byStatus.resolved, color: LIST_STAT_COLORS.green },
          ]}
          search={{
            value: search,
            onChange: setSearch,
            placeholder: t('issues.searchPlaceholder'),
            ariaLabel: t('issues.searchAria'),
            filters: {
              activeCount: statusFilter === 'all' ? 0 : 1,
              onClear: () => setStatusFilter('all'),
              panelWidth: 280,
              children: (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('issues.filterStatus')}</span>
                  <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value as IssueStatus | 'all')} className="w-full text-sm py-2 px-3" aria-label={t('issues.filterStatus')}>
                    <option value="all">{t('issues.filterAll')}</option>
                    {ISSUE_STATUSES.map(s => <option key={s} value={s}>{t(`issues.status.${s}`)}</option>)}
                  </Select>
                </label>
              ),
            },
          }}
        />

        <div className="appointment-card-surface patients-list-surface">
          <div className="appointment-card-flow">
            <div className="appointment-card-head" aria-hidden="true">
              <span>{t('issues.colReporter')}</span>
              <span>{t('issues.colReport')}</span>
              <span>{t('issues.colReported')}</span>
              <span>{t('issues.colOwner')}</span>
              <span>{t('issues.colStatus')}</span>
            </div>

            {loading && <div className="appointment-card-empty">{t('issues.loading')}</div>}
            {!loading && loadFailed && (
              <div className="appointment-card-empty" style={{ gap: 10 }}>
                <p style={{ color: 'var(--color-danger-text)' }}>{t('issues.loadFailed')}</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>{t('issues.retry')}</button>
              </div>
            )}
            {!loading && !loadFailed && issues.length === 0 && <div className="appointment-card-empty">{t('issues.queueEmpty')}</div>}
            {!loading && !loadFailed && issues.length > 0 && filtered.length === 0 && (
              <div className="appointment-card-empty">{t('issues.noMatch')}</div>
            )}
            {!loading && !loadFailed && filtered.map(m => {
              const status = deriveIssueStatus(m);
              const tok = ISSUE_STATUS_TOKENS[status];
              const roleLabel = m.issueReporterRole ? (ROLE_LABEL[m.issueReporterRole as keyof typeof ROLE_LABEL] || m.issueReporterRole) : '';
              const kind = [
                m.issueCategory ? t(`issues.category.${m.issueCategory}`) : null,
                m.issuePage || null,
              ].filter(Boolean).join(' · ');
              return (
                <div key={m._id} className="ehr-appointment-row appointment-card-row" style={{ cursor: 'default' }}>
                  <div className="ehr-appointment-identity">
                    <div className="ehr-patient-icon" style={avatarTint(m.fromDoctorName || m._id)}>{initials(m.fromDoctorName)}</div>
                    <div className="ehr-appointment-main appointment-card-patient">
                      <strong>{m.fromDoctorName}</strong>
                      <p>{[roleLabel, m.fromHospitalName].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                  <div className="appointment-card-provider">
                    <strong>{m.subject}</strong>
                    <span title={m.body || undefined}>{m.body}</span>
                    {kind && <span>{kind}</span>}
                  </div>
                  <div className="ehr-appointment-time">
                    <strong>{formatCompactDateTime(m.sentAt || m.createdAt)}</strong>
                    {m.issueSeverity && (
                      <span style={{ color: ISSUE_SEVERITY_INK[m.issueSeverity], fontWeight: m.issueSeverity === 'critical' ? 700 : undefined }}>
                        {t(`issues.severity.${m.issueSeverity}`)}
                      </span>
                    )}
                  </div>
                  <div className="appointment-card-provider">
                    <strong>{m.issueAssignedToName || t('issues.unassigned')}</strong>
                    <span>{m.issueAssignedToName ? t('issues.owner') : t('issues.needsOwner')}</span>
                  </div>
                  <div className="appointment-card-status">
                    <RowStatusSelect
                      label={t(`issues.status.${status}`)}
                      value={status}
                      ariaLabel={t('issues.triageAria', { summary: m.subject || '' })}
                      style={{ borderColor: tok.border, background: tok.bg, color: tok.color }}
                      options={issueRowActions(m, currentUser?._id, t)}
                      onSelect={value => onRowAction(m, value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {responding && (
        <Modal className="tamam-dialog" onClose={() => !saving && setResponding(null)} width={520} labelledBy="issue-response-title">
          <div className="modal-panel p-6 space-y-4">
            <h2 id="issue-response-title" className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t('issues.responseTitle')}</h2>
            <p className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{responding.subject}</p>
            <textarea
              rows={5}
              value={noteDraft}
              maxLength={DETAILS_MAX}
              onChange={e => setNoteDraft(e.target.value)}
              aria-label={t('issues.responseTitle')}
              className="w-full"
            />
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{t('issues.responseHint')}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setResponding(null)}>{t('issues.cancel')}</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void saveResponse()}>{t('issues.saveResponse')}</button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}
