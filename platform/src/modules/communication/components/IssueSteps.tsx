'use client';

/**
 * The five steps a reported issue moves through — Reported, Acknowledged,
 * In progress, Resolved, Closed — with the date each was reached. Shared by
 * the triage slider and the reporter's own list, so both read the same way.
 */
import type { MessageDoc } from '@/lib/db-types';
import { formatCompactDateTime } from '@/lib/format-utils';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { ISSUE_STATUSES, deriveIssueStatus, issueStepIndex, type IssueStatus } from '../issue-rules';
import './issue-inbox.css';

/** When the report last reached each step, from its trail ('new' = when it was sent). */
export function issueStepTimes(report: Pick<MessageDoc, 'issueHistory' | 'sentAt' | 'createdAt'>): Partial<Record<IssueStatus, string>> {
  const times: Partial<Record<IssueStatus, string>> = { new: report.sentAt || report.createdAt };
  for (const entry of report.issueHistory || []) {
    if (entry.kind === 'status' && entry.status) times[entry.status] = entry.at;
  }
  return times;
}

export default function IssueSteps({ report, compact = false }: {
  report: Pick<MessageDoc, 'issueStatus' | 'issueHistory' | 'sentAt' | 'createdAt'>;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const status = deriveIssueStatus(report);
  const current = issueStepIndex(status);
  const times = issueStepTimes(report);
  return (
    <ol className={`issue-steps${compact ? ' issue-steps--compact' : ''}`} aria-label={t('issues.stepsAria')}>
      {ISSUE_STATUSES.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'upcoming';
        const at = i <= current ? times[step] : undefined;
        return (
          <li key={step} className={`issue-step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="issue-step-dot" aria-hidden="true" />
            <span className="issue-step-label">{t(`issues.step.${step}`)}</span>
            {!compact && at && <span className="issue-step-time">{formatCompactDateTime(at)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
