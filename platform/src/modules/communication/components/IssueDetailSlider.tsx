'use client';

/**
 * One reported issue, worked in a slider: where it stands (the five steps),
 * what was reported, triage (owner, severity, kind), a reply the reporter
 * sees, a note only staff see, and everything that has happened to it.
 * The footer moves it one step forward — Acknowledge, Start work, Mark
 * resolved, Close — or reopens a closed one.
 */
import { useMemo, useState } from 'react';
import FormSlider from '@/components/overlay/FormSlider';
import Select from '@/components/Select';
import type { MessageDoc } from '@/lib/db-types';
import { formatCompactDateTime } from '@/lib/format-utils';
import { useUsers } from '@/lib/hooks/useUsers';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ROLE_LABEL } from '@/lib/role-display';
import {
  DETAILS_MAX, ISSUE_CATEGORIES, ISSUE_NEXT_STEP, ISSUE_SEVERITIES, canTriageIssues, deriveIssueStatus,
  type IssueCategory, type IssueHistoryEntry, type IssueSeverity, type IssueStatus,
} from '../issue-rules';
import IssueSteps from './IssueSteps';
import './issue-inbox.css';

export interface IssueSliderUpdate {
  status?: IssueStatus;
  assignedTo?: { id: string; name: string } | null;
  severity?: IssueSeverity;
  category?: IssueCategory;
  reply?: string;
  note?: string;
}

/** One line of the activity trail, in words. */
export function describeIssueEntry(entry: IssueHistoryEntry, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const who = entry.byName || t('issues.someone');
  switch (entry.kind) {
    case 'status': return t('issues.history.status', { who, status: t(`issues.step.${entry.status}`) });
    case 'assign': return entry.assignee
      ? t('issues.history.assign', { who, name: entry.assignee })
      : t('issues.history.unassign', { who });
    case 'reply': return t('issues.history.reply', { who });
    case 'note': return t('issues.history.note', { who });
    case 'triage': {
      const [field, value] = (entry.note || '').split(':');
      return field === 'severity'
        ? t('issues.history.severity', { who, value: t(`issues.severity.${value}`) })
        : t('issues.history.category', { who, value: t(`issues.category.${value}`) });
    }
    default: return who;
  }
}

export default function IssueDetailSlider({ report, currentUser, saving, onUpdate, onClose }: {
  report: MessageDoc;
  currentUser: { _id: string; name: string } | null;
  saving: boolean;
  /** Resolves true when the change was saved. */
  onUpdate: (update: IssueSliderUpdate) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { users } = useUsers();
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');

  const status = deriveIssueStatus(report);
  const next = ISSUE_NEXT_STEP[status];
  const roleLabel = report.issueReporterRole
    ? (ROLE_LABEL[report.issueReporterRole as keyof typeof ROLE_LABEL] || report.issueReporterRole)
    : '';

  /** People who can work the issue queue, by name. */
  const owners = useMemo(
    () => users
      .filter(u => u.isActive !== false && canTriageIssues(u.role))
      .map(u => ({ id: u._id, name: u.name || u.username }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  );
  const ownerValue = report.issueAssignedToId || '';
  const ownerListed = !ownerValue || owners.some(o => o.id === ownerValue);

  const history = [...(report.issueHistory || [])].reverse();

  const sendReply = async () => {
    if (await onUpdate({ reply })) setReply('');
  };
  const addNote = async () => {
    if (await onUpdate({ note })) setNote('');
  };

  return (
    <FormSlider
      title={report.subject || t('issues.queueTitle')}
      subtitle={[report.fromDoctorName, roleLabel, report.fromHospitalName].filter(Boolean).join(' · ')}
      width={560}
      onClose={onClose}
      busy={saving}
      footer={<>
        {status === 'resolved' || status === 'closed'
          ? <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => void onUpdate({ status: 'in_progress' })}>{t('issues.action.reopen')}</button>
          : <button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>{t('issues.closePanel')}</button>}
        {next
          ? <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void onUpdate({ status: next.to })}>{t(next.actionKey)}</button>
          : <button type="button" className="btn btn-primary" disabled={saving} onClick={onClose}>{t('issues.closePanel')}</button>}
      </>}
    >
      <div className="issue-detail">
        <section className="issue-detail-section">
          <IssueSteps report={report} />
        </section>

        <section className="issue-detail-section">
          <h3>{t('issues.detail.report')}</h3>
          <dl className="issue-detail-facts">
            <div><dt>{t('issues.detail.reportedBy')}</dt><dd>{[report.fromDoctorName, roleLabel].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt>{t('issues.detail.facility')}</dt><dd>{report.fromHospitalName || '—'}</dd></div>
            <div><dt>{t('issues.detail.when')}</dt><dd>{formatCompactDateTime(report.sentAt || report.createdAt)}</dd></div>
            <div><dt>{t('issues.pageLabel')}</dt><dd>{report.issuePage || t('issues.pageNone')}</dd></div>
          </dl>
          <p className="issue-detail-body">{report.body}</p>
        </section>

        <section className="issue-detail-section">
          <h3>{t('issues.detail.triage')}</h3>
          <div className="issue-detail-fields">
            <label>
              <span>{t('issues.detail.owner')}</span>
              <Select
                value={ownerValue}
                disabled={saving}
                onChange={e => {
                  const id = e.target.value;
                  const owner = owners.find(o => o.id === id);
                  void onUpdate({ assignedTo: owner ? { id: owner.id, name: owner.name } : null });
                }}
              >
                <option value="">{t('issues.unassigned')}</option>
                {!ownerListed && <option value={ownerValue}>{report.issueAssignedToName}</option>}
                {owners.map(o => <option key={o.id} value={o.id}>{o.id === currentUser?._id ? `${o.name} (${t('issues.you')})` : o.name}</option>)}
              </Select>
            </label>
            <label>
              <span>{t('issues.detail.severity')}</span>
              <Select value={report.issueSeverity || 'medium'} disabled={saving} onChange={e => void onUpdate({ severity: e.target.value as IssueSeverity })}>
                {ISSUE_SEVERITIES.map(s => <option key={s} value={s}>{t(`issues.severity.${s}`)}</option>)}
              </Select>
            </label>
            <label>
              <span>{t('issues.categoryLabel')}</span>
              <Select value={report.issueCategory || 'other'} disabled={saving} onChange={e => void onUpdate({ category: e.target.value as IssueCategory })}>
                {ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{t(`issues.category.${c}`)}</option>)}
              </Select>
            </label>
          </div>
        </section>

        <section className="issue-detail-section">
          <h3>{t('issues.detail.reply')}</h3>
          {report.issueResolutionNote && (
            <p className="issue-detail-latest"><b>{t('issues.detail.latestReply')}</b> {report.issueResolutionNote}</p>
          )}
          <textarea
            rows={1}
            value={reply}
            maxLength={DETAILS_MAX}
            onChange={e => setReply(e.target.value)}
            aria-label={t('issues.detail.reply')}
            placeholder={t('issues.detail.replyPlaceholder')}
          />
          <div className="issue-detail-row">
            <span className="issue-detail-hint">{t('issues.responseHint')}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving || !reply.trim()} onClick={() => void sendReply()}>{t('issues.detail.sendReply')}</button>
          </div>
        </section>

        <section className="issue-detail-section">
          <h3>{t('issues.detail.note')}</h3>
          <textarea
            rows={1}
            value={note}
            maxLength={DETAILS_MAX}
            onChange={e => setNote(e.target.value)}
            aria-label={t('issues.detail.note')}
            placeholder={t('issues.detail.notePlaceholder')}
          />
          <div className="issue-detail-row">
            <span className="issue-detail-hint">{t('issues.detail.noteHint')}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={saving || !note.trim()} onClick={() => void addNote()}>{t('issues.detail.addNote')}</button>
          </div>
        </section>

        <section className="issue-detail-section">
          <h3>{t('issues.detail.activity')}</h3>
          <ol className="issue-activity">
            {history.map((entry, i) => (
              <li key={`${entry.at}-${i}`} className={`issue-activity-item is-${entry.kind}`}>
                <span className="issue-activity-line">{describeIssueEntry(entry, t)}</span>
                <span className="issue-activity-time">{formatCompactDateTime(entry.at)}</span>
                {(entry.kind === 'reply' || entry.kind === 'note') && entry.note && <p className="issue-activity-text">{entry.note}</p>}
              </li>
            ))}
            <li className="issue-activity-item is-reported">
              <span className="issue-activity-line">{t('issues.history.reported', { who: report.fromDoctorName || t('issues.someone') })}</span>
              <span className="issue-activity-time">{formatCompactDateTime(report.sentAt || report.createdAt)}</span>
            </li>
          </ol>
        </section>
      </div>
    </FormSlider>
  );
}
