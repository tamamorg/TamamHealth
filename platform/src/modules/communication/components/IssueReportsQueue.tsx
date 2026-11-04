'use client';

/**
 * Reported issues — the inbox for problems staff report from their account
 * menu ("Report a problem"). It is the whole of `/inquiries` for the
 * management roles that open it.
 *
 * Lanes by step (Open, then each of the five steps, then All); a row opens
 * the issue in a slider with its steps, triage, replies, staff notes and
 * activity; the status pill offers the quick moves without opening it.
 */

import { useCallback, useMemo, useState } from 'react';
import EhrListHeader, { LIST_STAT_COLORS } from '@/components/ehr/EhrListHeader';
import RowStatusSelect, { type RowStatusOption } from '@/components/ehr/RowStatusSelect';
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
import {
  ISSUE_CATEGORIES, ISSUE_NEXT_STEP, ISSUE_SEVERITIES, ISSUE_STATUSES, deriveIssueStatus, isOpenIssue, summariseIssues,
  type IssueCategory, type IssueSeverity, type IssueStatus,
} from '../issue-rules';
import IssueDetailSlider, { type IssueSliderUpdate } from './IssueDetailSlider';
import { ISSUE_SEVERITY_INK, ISSUE_STATUS_TOKENS } from './issue-status-tokens';
import './issue-inbox.css';

const ASSIGN_ME = '__assign-me';
const UNASSIGN = '__unassign';
const OPEN_DETAIL = '__open';

type Lane = 'open' | IssueStatus | 'all';
const LANES: Lane[] = ['open', ...ISSUE_STATUSES, 'all'];

/** What a row's pill offers: the next step, reopen, assignment, and the full view. */
export function issueRowActions(
  message: Pick<MessageDoc, 'issueStatus' | 'issueAssignedToId'>,
  userId: string | undefined,
  t: (key: string) => string,
): RowStatusOption[] {
  const status = deriveIssueStatus(message);
  const next = ISSUE_NEXT_STEP[status];
  const moves: RowStatusOption[] = [];
  if (next) moves.push({ value: next.to, label: t(next.actionKey) });
  if (status !== 'closed' && next?.to !== 'closed') moves.push({ value: 'closed', label: t('issues.action.close') });
  if (status === 'resolved' || status === 'closed') moves.push({ value: 'in_progress', label: t('issues.action.reopen') });
  const mine = !!userId && message.issueAssignedToId === userId;
  return [
    ...moves,
    ...(!mine ? [{ value: ASSIGN_ME, label: t('issues.action.assignMe'), group: t('issues.groupAssignment') }] : []),
    ...(message.issueAssignedToId ? [{ value: UNASSIGN, label: t('issues.action.unassign'), group: t('issues.groupAssignment') }] : []),
    { value: OPEN_DETAIL, label: t('issues.action.open'), group: t('issues.groupResponse') },
  ];
}

export default function IssueReportsQueue() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { showToast } = useToast();

  const [issues, setIssues] = useState<MessageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [lane, setLane] = useState<Lane>('open');
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | 'all'>('all');
  const [ownerFilter, setOwnerFilter] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
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
  const laneCount = (l: Lane) => (l === 'open' ? summary.open : l === 'all' ? summary.total : summary.byStatus[l]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter(m => {
      const status = deriveIssueStatus(m);
      if (lane === 'open' ? !isOpenIssue(m) : lane !== 'all' && status !== lane) return false;
      if (severityFilter !== 'all' && m.issueSeverity !== severityFilter) return false;
      if (categoryFilter !== 'all' && m.issueCategory !== categoryFilter) return false;
      if (ownerFilter === 'mine' && m.issueAssignedToId !== currentUser?._id) return false;
      if (ownerFilter === 'unassigned' && m.issueAssignedToId) return false;
      if (!q) return true;
      return `${m.subject || ''} ${m.body || ''} ${m.fromDoctorName || ''} ${m.fromHospitalName || ''}`.toLowerCase().includes(q);
    });
  }, [issues, search, lane, severityFilter, categoryFilter, ownerFilter, currentUser?._id]);

  const activeFilters = (severityFilter !== 'all' ? 1 : 0) + (categoryFilter !== 'all' ? 1 : 0) + (ownerFilter !== 'all' ? 1 : 0);

  const apply = async (report: MessageDoc, update: IssueSliderUpdate): Promise<boolean> => {
    if (!currentUser || !scope) return false;
    setSaving(true);
    const { updateIssueReport } = await import('../services/issue-report-service');
    const updated = await updateIssueReport(
      report._id, update, { id: currentUser._id, name: currentUser.name, role: currentUser.role }, scope,
    ).catch(() => null);
    setSaving(false);
    if (!updated) { showToast(t('issues.updateFailed'), 'error'); return false; }
    setIssues(prev => prev.map(m => (m._id === updated._id ? updated : m)));
    showToast(t('issues.updated'), 'success');
    return true;
  };

  const onRowAction = (report: MessageDoc, value: string) => {
    if (value === OPEN_DETAIL) { setOpenId(report._id); return; }
    if (value === ASSIGN_ME && currentUser) { void apply(report, { assignedTo: { id: currentUser._id, name: currentUser.name } }); return; }
    if (value === UNASSIGN) { void apply(report, { assignedTo: null }); return; }
    if ((ISSUE_STATUSES as readonly string[]).includes(value)) void apply(report, { status: value as IssueStatus });
  };

  const openReport = openId ? issues.find(m => m._id === openId) ?? null : null;

  return (
    <main className="page-container page-enter" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div className="card-elevated overflow-hidden flex flex-col" style={{ flex: 1, minHeight: 0 }} data-tour="issues-list">
        <EhrListHeader
          title={t('issues.queueTitle')}
          count={summary.total}
          tabs={LANES.map(l => ({ key: l, label: t(`issues.lane.${l}`), count: laneCount(l) }))}
          activeTab={lane}
          onTabChange={key => setLane(key as Lane)}
          tabsAriaLabel={t('issues.lanesAria')}
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
              activeCount: activeFilters,
              onClear: () => { setSeverityFilter('all'); setCategoryFilter('all'); setOwnerFilter('all'); },
              panelWidth: 320,
              children: (
                <>
                  <label>
                    <span>{t('issues.detail.owner')}</span>
                    <Select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value as typeof ownerFilter)}>
                      <option value="all">{t('issues.filterAnyone')}</option>
                      <option value="mine">{t('issues.filterMine')}</option>
                      <option value="unassigned">{t('issues.unassigned')}</option>
                    </Select>
                  </label>
                  <label>
                    <span>{t('issues.detail.severity')}</span>
                    <Select value={severityFilter} onChange={e => setSeverityFilter(e.target.value as IssueSeverity | 'all')}>
                      <option value="all">{t('issues.filterAllSeverities')}</option>
                      {ISSUE_SEVERITIES.map(s => <option key={s} value={s}>{t(`issues.severity.${s}`)}</option>)}
                    </Select>
                  </label>
                  <label>
                    <span>{t('issues.categoryLabel')}</span>
                    <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value as IssueCategory | 'all')}>
                      <option value="all">{t('issues.filterAllKinds')}</option>
                      {ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{t(`issues.category.${c}`)}</option>)}
                    </Select>
                  </label>
                </>
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
              const kind = [m.issueCategory ? t(`issues.category.${m.issueCategory}`) : null, m.issuePage || null].filter(Boolean).join(' · ');
              return (
                // The row opens the issue; the status pill is its own control
                // and stops the click from reaching the row.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                <div
                  key={m._id}
                  className="ehr-appointment-row appointment-card-row"
                  onClick={event => {
                    if ((event.target as HTMLElement).closest('button, select, a, [role="menu"]')) return;
                    setOpenId(m._id);
                  }}
                >
                  <div className="ehr-appointment-identity">
                    <div className="ehr-patient-icon" style={avatarTint(m.fromDoctorName || m._id)}>{initials(m.fromDoctorName)}</div>
                    <div className="ehr-appointment-main appointment-card-patient">
                      <button type="button" className="ehr-queue-name" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', textAlign: 'start', cursor: 'pointer' }} onClick={() => setOpenId(m._id)}>
                        <strong>{m.fromDoctorName}</strong>
                      </button>
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
                      subject={m.subject}
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

      {openReport && (
        <IssueDetailSlider
          report={openReport}
          currentUser={currentUser ? { _id: currentUser._id, name: currentUser.name } : null}
          saving={saving}
          onUpdate={update => apply(openReport, update)}
          onClose={() => setOpenId(null)}
        />
      )}
    </main>
  );
}
