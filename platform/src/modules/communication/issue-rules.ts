/**
 * Staff issue-report rules the service and the screens must agree on.
 *
 * Pure and store-free, so a client component can import them without pulling
 * the data layer behind it (the same split as message-rules.ts). The service
 * enforces these; the UI uses them to label, filter and decide what to offer.
 */
import type { MessageDoc } from '@/lib/db-types';
import { isPathAllowed } from '@/lib/role-routes';

export const ISSUE_STATUSES = ['new', 'in_progress', 'resolved', 'closed'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_CATEGORIES = ['bug', 'wrong_data', 'access', 'sync', 'performance', 'other'] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

const OPEN_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>(['new', 'in_progress']);

export const SUMMARY_MAX = 140;
export const DETAILS_MAX = 4000;

export function isIssueReport(message: Pick<MessageDoc, 'messageKind'>): boolean {
  return message.messageKind === 'issue_report';
}

/** Triage state; absent or unrecognised reads as 'new' so nothing drops out of every filter. */
export function deriveIssueStatus(message: Pick<MessageDoc, 'issueStatus'>): IssueStatus {
  const raw = message.issueStatus;
  return raw && (ISSUE_STATUSES as readonly string[]).includes(raw) ? raw : 'new';
}

export function isOpenIssue(message: Pick<MessageDoc, 'issueStatus'>): boolean {
  return OPEN_STATUSES.has(deriveIssueStatus(message));
}

/** Whether a role works the issue queue. Same grant as patient inquiries. */
export function canTriageIssues(role: string | undefined): boolean {
  return !!role && isPathAllowed(role, '/inquiries');
}

/**
 * The path a report was filed from, reduced to what is safe to keep: no
 * origin, no query string or hash (a search box can put a patient's name in
 * the URL), and only something that looks like an app route.
 */
export function sanitiseIssuePage(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let path = raw.trim();
  try {
    if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    return undefined;
  }
  path = path.split(/[?#]/)[0];
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 200) return undefined;
  if (path === '/report-issue' || path.startsWith('/report-issue/')) return undefined;
  return path;
}


export interface IssueSummary {
  total: number;
  open: number;
  byStatus: Record<IssueStatus, number>;
}

export function summariseIssues(messages: MessageDoc[]): IssueSummary {
  const byStatus: Record<IssueStatus, number> = { new: 0, in_progress: 0, resolved: 0, closed: 0 };
  let open = 0;
  for (const m of messages) {
    const status = deriveIssueStatus(m);
    byStatus[status] += 1;
    if (OPEN_STATUSES.has(status)) open += 1;
  }
  return { total: messages.length, open, byStatus };
}

