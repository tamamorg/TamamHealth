/**
 * Staff issue reports — "something is wrong with the system" from anyone who
 * uses it, triaged next to patient inquiries.
 *
 * A report is a `MessageDoc` with `messageKind: 'issue_report'`. Reusing the
 * messages database means it already replicates for every staff role, works
 * offline, is tenant-scoped by `orgId`, and its text (summary in `subject`,
 * details in `body`, `issueResolutionNote`) is encrypted at rest like any
 * message. It carries no patient and no conversation, so it can never surface
 * in a chart thread, staff chat or the patient inquiry queue; the org-wide
 * message reads skip it explicitly (message-service `getAllMessages`).
 *
 * Who triages: whoever may open `/inquiries` (role-routes is the one list).
 */
import { messagesDB } from '@/lib/db';
import type { MessageDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { filterByScope } from '@/lib/services/data-scope';
import { findByType } from '@/lib/services/db-query';
import {
  DETAILS_MAX, ISSUE_CATEGORIES, ISSUE_SEVERITIES, ISSUE_STATUSES, SUMMARY_MAX,
  canTriageIssues, sanitiseIssuePage,
  type IssueCategory, type IssueSeverity, type IssueStatus,
} from '@/modules/communication/issue-rules';

export {
  ISSUE_STATUSES, ISSUE_CATEGORIES, ISSUE_SEVERITIES, SUMMARY_MAX, DETAILS_MAX,
  isIssueReport, deriveIssueStatus, isOpenIssue, canTriageIssues, sanitiseIssuePage, summariseIssues,
  type IssueSummary, type IssueStatus, type IssueCategory, type IssueSeverity,
} from '@/modules/communication/issue-rules';

export interface IssueReporter {
  id: string;
  name: string;
  role: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

export interface CreateIssueReportInput {
  summary: string;
  details: string;
  category: IssueCategory;
  severity: IssueSeverity;
  page?: string | null;
}

export class IssueReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssueReportValidationError';
  }
}

/** File a report. Validates here, not only in the form, because every writer must. */
export async function createIssueReport(input: CreateIssueReportInput, reporter: IssueReporter): Promise<MessageDoc> {
  const summary = input.summary.trim();
  const details = input.details.trim();
  if (!summary) throw new IssueReportValidationError('Add a short summary of the problem.');
  if (summary.length > SUMMARY_MAX) throw new IssueReportValidationError(`Keep the summary under ${SUMMARY_MAX} characters.`);
  if (!details) throw new IssueReportValidationError('Describe what happened.');
  if (details.length > DETAILS_MAX) throw new IssueReportValidationError(`Keep the description under ${DETAILS_MAX} characters.`);
  if (!(ISSUE_CATEGORIES as readonly string[]).includes(input.category)) throw new IssueReportValidationError('Choose what kind of problem it is.');
  if (!(ISSUE_SEVERITIES as readonly string[]).includes(input.severity)) throw new IssueReportValidationError('Choose how much it is affecting your work.');
  if (!reporter.id) throw new IssueReportValidationError('Sign in again before reporting a problem.');

  const { createMessage } = await import('@/modules/communication/services/message-service');
  const now = new Date().toISOString();
  return createMessage({
    messageKind: 'issue_report',
    recipientType: 'staff',
    direction: 'staff_to_staff',
    // Never a patient: a report must not appear in any patient's thread, and
    // the reporter describes the problem in their own words instead.
    patientId: '',
    patientName: '',
    patientPhone: '',
    fromDoctorId: reporter.id,
    fromDoctorName: reporter.name,
    fromHospitalId: reporter.hospitalId,
    fromHospitalName: reporter.hospitalName || '',
    recipientHospitalId: reporter.hospitalId,
    recipientHospitalName: reporter.hospitalName,
    subject: summary,
    body: details,
    channel: 'app',
    sentAt: now,
    readBy: [reporter.id],
    orgId: reporter.orgId,
    issueStatus: 'new',
    issueCategory: input.category,
    issueSeverity: input.severity,
    issuePage: sanitiseIssuePage(input.page),
    issueReporterRole: reporter.role,
  });
}

async function readIssueReports(): Promise<MessageDoc[]> {
  const rows = await findByType<MessageDoc>(
    messagesDB(),
    'message',
    { messageKind: 'issue_report' },
    { indexFields: ['type', 'messageKind'] },
  );
  const { decryptMessage } = await import('@/modules/communication/services/message-service');
  const docs = await Promise.all(rows.map(decryptMessage));
  return docs.sort((a, b) => (b.sentAt || b.createdAt || '').localeCompare(a.sentAt || a.createdAt || ''));
}

/** The triage queue: every report in the reader's scope, newest first. */
export async function getIssueReports(scope: DataScope): Promise<MessageDoc[]> {
  return filterByScope(await readIssueReports(), scope);
}

/** What one person has reported, newest first — so they can see what became of it. */
export async function getMyIssueReports(userId: string): Promise<MessageDoc[]> {
  if (!userId) return [];
  return (await readIssueReports()).filter(m => m.fromDoctorId === userId);
}

export interface IssueUpdate {
  status?: IssueStatus;
  resolutionNote?: string;
  assignedTo?: { id: string; name: string } | null;
}

/**
 * Move a report through triage. Only a triage role may, and only on a report
 * in its scope; the reporter's own words (summary, details) are never touched.
 */
export async function updateIssueReport(
  id: string,
  update: IssueUpdate,
  actor: { id: string; name: string; role: string },
  scope: DataScope,
): Promise<MessageDoc | null> {
  if (!canTriageIssues(actor.role)) return null;
  const current = (await getIssueReports(scope)).find(m => m._id === id);
  if (!current) return null;
  const patch: Partial<MessageDoc> = {
    issueUpdatedAt: new Date().toISOString(),
    issueUpdatedByName: actor.name,
  };
  if (update.status) {
    if (!(ISSUE_STATUSES as readonly string[]).includes(update.status)) return null;
    patch.issueStatus = update.status;
  }
  if (update.resolutionNote !== undefined) {
    const note = update.resolutionNote.trim();
    if (note.length > DETAILS_MAX) return null;
    patch.issueResolutionNote = note || undefined;
  }
  if (update.assignedTo !== undefined) {
    patch.issueAssignedToId = update.assignedTo?.id;
    patch.issueAssignedToName = update.assignedTo?.name;
  }
  const { updateMessage } = await import('@/modules/communication/services/message-service');
  return updateMessage(id, patch);
}
