/**
 * Phone notes (P1.4) — document a patient call, route it to a provider, and
 * keep the provider's response as a permanent part of the chart. Mirrors the
 * Centricity phone note.
 *
 * Phone notes live in their OWN database (tamamhealth_phone_notes), like the
 * internal patient notes, so they never leak to patient-facing queries. They
 * sync between facilities but are excluded from national analytics (see the
 * sync coverage matrix).
 */
import { v4 as uuidv4 } from 'uuid';
import { phoneNotesDB } from '../db';
import type { PhoneNoteDoc } from '../db-types';
import { findByType } from './db-query';
import type { DataScope } from './data-scope';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import { isClinicalAuthorRole } from '../clinical-roles';

function byNewest(a: PhoneNoteDoc, b: PhoneNoteDoc): number {
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
}

/** All phone notes for a patient, newest-first. */
export async function getPhoneNotesByPatient(patientId: string): Promise<PhoneNoteDoc[]> {
  const rows = await findByType<PhoneNoteDoc>(
    phoneNotesDB(),
    'phone_note',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  return rows.sort(byNewest);
}

/**
 * Open phone notes routed to a given provider — powers the provider inbox
 * "patient callbacks" worklist. The authorization here is the explicit routing
 * (`routedToId === userId`); we scope by ORG only (not hospital) so a note
 * routed to a provider about a patient registered at a sister facility still
 * reaches them, while never leaking across organizations.
 */
export async function getOpenPhoneNotesForUser(userId: string, scope?: DataScope): Promise<PhoneNoteDoc[]> {
  let rows = await findByType<PhoneNoteDoc>(phoneNotesDB(), 'phone_note');
  if (scope?.orgId) {
    rows = rows.filter((n) => !n.orgId || n.orgId === scope.orgId);
  }
  return rows.filter((n) => n.status === 'open' && n.routedToId === userId).sort(byNewest);
}

export interface CreatePhoneNoteInput {
  patientId: string;
  patientName?: string;
  callerName?: string;
  callerPhone?: string;
  subject: string;
  message: string;
  routedToId?: string;
  routedToName?: string;
  recordedById?: string;
  recordedByName?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

export async function createPhoneNote(input: CreatePhoneNoteInput): Promise<PhoneNoteDoc> {
  if (!input.subject || input.subject.trim().length === 0) {
    throw new Error('Phone note subject is required');
  }
  if (!input.message || input.message.trim().length === 0) {
    throw new Error('Phone note message is required');
  }
  const db = phoneNotesDB();
  const now = new Date().toISOString();
  const doc: PhoneNoteDoc = {
    _id: `phnote-${uuidv4()}`,
    type: 'phone_note',
    ...input,
    subject: input.subject.trim(),
    message: input.message.trim(),
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('CREATE_PHONE_NOTE', input.recordedById, input.recordedByName, `Phone note ${doc._id} on patient ${doc.patientId} routed to ${doc.routedToName || 'unassigned'}`);
  emitSyncEvent({
    resourceType: 'phone_note',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    hospitalId: doc.hospitalId,
    orgId: doc.orgId,
  });
  return doc;
}

export interface PhoneNoteResponder {
  userId?: string;
  userName: string;
  userRole?: string;
}

/** Provider responds to a phone note; it becomes a permanent answered record. */
export async function respondToPhoneNote(id: string, response: string, responder: PhoneNoteResponder): Promise<PhoneNoteDoc | null> {
  if (!response || response.trim().length === 0) {
    throw new Error('A response is required');
  }
  if (!isClinicalAuthorRole(responder.userRole)) {
    throw new Error(`Role "${responder.userRole ?? 'unknown'}" may not respond to phone notes.`);
  }
  const db = phoneNotesDB();
  let existing: PhoneNoteDoc;
  try {
    existing = await db.get(id) as PhoneNoteDoc;
  } catch {
    return null;
  }
  const now = new Date().toISOString();
  const updated: PhoneNoteDoc = {
    ...existing,
    response: response.trim(),
    respondedById: responder.userId,
    respondedByName: responder.userName,
    respondedAt: now,
    status: 'responded',
    updatedAt: now,
  };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('RESPOND_PHONE_NOTE', responder.userId, responder.userName, `Responded to phone note ${id} on patient ${updated.patientId}`);
  emitSyncEvent({
    resourceType: 'phone_note',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    hospitalId: updated.hospitalId,
    orgId: updated.orgId,
  });
  return updated;
}

/** Close a phone note (no response needed, or follow-up complete). */
export async function closePhoneNote(id: string): Promise<PhoneNoteDoc | null> {
  const db = phoneNotesDB();
  let existing: PhoneNoteDoc;
  try {
    existing = await db.get(id) as PhoneNoteDoc;
  } catch {
    return null;
  }
  const updated: PhoneNoteDoc = { ...existing, status: 'closed', updatedAt: new Date().toISOString() };
  const resp = await db.put(updated);
  updated._rev = resp.rev;
  await logAuditSafe('CLOSE_PHONE_NOTE', undefined, undefined, `Closed phone note ${id} on patient ${updated.patientId}`);
  emitSyncEvent({
    resourceType: 'phone_note',
    resourceId: updated._id,
    operation: 'update',
    resourceVersion: updated._rev,
    hospitalId: updated.hospitalId,
    orgId: updated.orgId,
  });
  return updated;
}
