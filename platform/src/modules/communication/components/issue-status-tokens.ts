import type { IssueSeverity, IssueStatus } from '../issue-rules';

/**
 * Status-pill palette for issue reports — the same flat tokens as the patient
 * inquiry pills, always shown with the text label, never colour alone.
 */
export const ISSUE_STATUS_TOKENS: Record<IssueStatus, { color: string; bg: string; border: string }> = {
  new: { color: 'var(--color-warning-text)', bg: 'rgba(254, 230, 151, 0.16)', border: 'rgba(254, 230, 151, 0.45)' },
  in_progress: { color: 'var(--accent-primary)', bg: 'rgba(33, 145, 208, 0.14)', border: 'rgba(33, 145, 208, 0.40)' },
  resolved: { color: 'var(--color-success-text)', bg: 'rgba(15, 160, 106, 0.12)', border: 'rgba(15, 160, 106, 0.40)' },
  closed: { color: 'var(--text-muted)', bg: 'var(--overlay-subtle)', border: 'var(--border-medium)' },
};

/** Ink for the severity line: the two that stop work read as alerts. */
export const ISSUE_SEVERITY_INK: Record<IssueSeverity, string> = {
  low: 'var(--text-muted)',
  medium: 'var(--text-secondary)',
  high: 'var(--color-warning-text)',
  critical: 'var(--color-danger-text)',
};
