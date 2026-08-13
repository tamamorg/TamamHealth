/**
 * Patient enquiries — the front-desk triage view over inbound patient
 * messages.
 *
 * There is no separate enquiry database. An enquiry IS a `MessageDoc` with
 * `direction === 'patient_to_staff'`, written by the patient portal. Giving
 * enquiries their own document type would create a second source of truth for
 * the same conversation, so triage state is instead carried on the message as
 * three optional fields (`enquiryStatus`, `enquiryAssignedToId/Name`).
 *
 * Why not reuse `MessageDoc.status`? That field means DELIVERY
 * ('sent' | 'delivered' | 'failed') and is written by the SMS gateway path.
 * Overloading it would make "answered" and "delivered" the same bit.
 *
 * Every message predating triage has no `enquiryStatus`, so ABSENT MUST READ
 * AS 'new' — that is `deriveEnquiryStatus`, and it is the only correct way to
 * read the field. Never compare `doc.enquiryStatus` directly.
 */

import type { MessageDoc } from '../db-types';
import type { DataScope } from './data-scope';

export const ENQUIRY_STATUSES = ['new', 'contacted', 'appointment_scheduled', 'closed'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  appointment_scheduled: 'Appointment scheduled',
  closed: 'Closed',
};

/** Statuses that still need someone to act. Drives the "Open inquiries" metric. */
const OPEN_STATUSES: ReadonlySet<EnquiryStatus> = new Set<EnquiryStatus>(['new', 'contacted']);

/**
 * Triage state of an enquiry. Messages written before triage existed carry no
 * `enquiryStatus`; they are untouched work, so they read as 'new'. An
 * unrecognised value (a newer client wrote a status this build doesn't know)
 * also falls back to 'new' rather than vanishing from every filter.
 */
export function deriveEnquiryStatus(message: Pick<MessageDoc, 'enquiryStatus'>): EnquiryStatus {
  const raw = message.enquiryStatus;
  return raw && (ENQUIRY_STATUSES as readonly string[]).includes(raw) ? raw : 'new';
}

export function isOpenEnquiry(message: Pick<MessageDoc, 'enquiryStatus'>): boolean {
  return OPEN_STATUSES.has(deriveEnquiryStatus(message));
}

/**
 * The enquiry's "type" column. The portal has no type picker, so the subject
 * line is the closest real signal — never invent a taxonomy the writer never
 * chose from.
 */
export function enquiryType(message: Pick<MessageDoc, 'subject'>): string {
  return message.subject?.trim() || 'General enquiry';
}

export function enquiryAssignee(message: Pick<MessageDoc, 'enquiryAssignedToName'>): string | null {
  return message.enquiryAssignedToName?.trim() || null;
}

/** Inbound patient enquiries, newest first. Scope is applied upstream. */
export async function getPatientEnquiries(scope?: DataScope): Promise<MessageDoc[]> {
  const { getInboundPatientMessages } = await import('./message-service');
  return getInboundPatientMessages(scope);
}

export interface EnquirySummary {
  total: number;
  open: number;
  byStatus: Record<EnquiryStatus, number>;
  /** ISO timestamp of the most recent enquiry, or null when there are none. */
  lastAt: string | null;
}

/**
 * Pure counter — takes an already-scoped list so the dashboard and the
 * enquiries page compute identical numbers from the same input.
 */
export function summariseEnquiries(messages: MessageDoc[]): EnquirySummary {
  const byStatus: Record<EnquiryStatus, number> = {
    new: 0, contacted: 0, appointment_scheduled: 0, closed: 0,
  };
  let open = 0;
  let lastAt: string | null = null;

  for (const m of messages) {
    const status = deriveEnquiryStatus(m);
    byStatus[status] += 1;
    if (OPEN_STATUSES.has(status)) open += 1;
    const at = m.sentAt || m.createdAt;
    if (at && (!lastAt || at > lastAt)) lastAt = at;
  }

  return { total: messages.length, open, byStatus, lastAt };
}

export interface EnquiryFilters {
  search?: string;
  status?: EnquiryStatus | 'all';
  /** Matches the subject/type column. */
  type?: string | 'all';
  /** Inclusive ISO date bounds (YYYY-MM-DD) compared against sentAt/createdAt. */
  from?: string;
  to?: string;
  /** Staff id, 'all', or 'unassigned'. */
  assignedTo?: string;
}

/**
 * Pure filter shared by the enquiries page and its tests. Kept out of the
 * component so the filter semantics can be pinned without a DOM.
 */
export function filterEnquiries(messages: MessageDoc[], filters: EnquiryFilters): MessageDoc[] {
  const q = filters.search?.trim().toLowerCase() || '';
  return messages.filter(m => {
    if (filters.status && filters.status !== 'all' && deriveEnquiryStatus(m) !== filters.status) return false;
    if (filters.type && filters.type !== 'all' && enquiryType(m) !== filters.type) return false;
    if (filters.assignedTo && filters.assignedTo !== 'all') {
      if (filters.assignedTo === 'unassigned') {
        if (m.enquiryAssignedToId) return false;
      } else if (m.enquiryAssignedToId !== filters.assignedTo) return false;
    }
    const at = (m.sentAt || m.createdAt || '').slice(0, 10);
    if (filters.from && (!at || at < filters.from)) return false;
    if (filters.to && (!at || at > filters.to)) return false;
    if (q) {
      const haystack = `${m.patientName || ''} ${m.subject || ''} ${m.body || ''} ${m.enquiryAssignedToName || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Move an enquiry through triage. Returns the updated message, or null. */
export async function setEnquiryStatus(id: string, status: EnquiryStatus): Promise<MessageDoc | null> {
  const { updateMessage } = await import('./message-service');
  return updateMessage(id, { enquiryStatus: status });
}

/** Assign (or, with a null assignee, unassign) an enquiry. */
export async function assignEnquiry(
  id: string,
  assignee: { id: string; name: string } | null,
): Promise<MessageDoc | null> {
  const { updateMessage } = await import('./message-service');
  return updateMessage(id, {
    enquiryAssignedToId: assignee?.id,
    enquiryAssignedToName: assignee?.name,
  });
}

export interface CreateEnquiryInput {
  patientName: string;
  patientPhone?: string;
  patientId?: string;
  subject: string;
  body: string;
  facilityId?: string;
  facilityName?: string;
  orgId?: string;
  assignedTo?: { id: string; name: string };
}

/**
 * Log an enquiry that arrived off-platform (walk-in, phone call). It is
 * written as the same inbound message a portal enquiry produces, so one list
 * shows both and nothing downstream needs to special-case the origin.
 */
export async function createEnquiry(input: CreateEnquiryInput): Promise<MessageDoc> {
  const { createMessage } = await import('./message-service');
  return createMessage({
    direction: 'patient_to_staff',
    recipientType: 'staff',
    patientId: input.patientId || '',
    patientName: input.patientName,
    patientPhone: input.patientPhone || '',
    fromDoctorId: 'patient',
    fromDoctorName: input.patientName,
    fromHospitalName: input.facilityName || '',
    fromHospitalId: input.facilityId,
    recipientHospitalId: input.facilityId,
    recipientHospitalName: input.facilityName,
    subject: input.subject,
    body: input.body,
    channel: 'app',
    sentAt: new Date().toISOString(),
    orgId: input.orgId,
    enquiryStatus: 'new',
    enquiryAssignedToId: input.assignedTo?.id,
    enquiryAssignedToName: input.assignedTo?.name,
  });
}
