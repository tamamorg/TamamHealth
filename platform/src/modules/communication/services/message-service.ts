import { messagesDB } from '@/lib/db';
import { findByType } from '@/lib/services/db-query';
import type { MessageDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { filterByScope } from '@/lib/services/data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import { EncryptionKeyError, UNREADABLE_FIELD_TEXT, readReplicatedField } from '@/lib/field-encryption';
import { UNREADABLE_ORG_FIELD_TEXT, isOrgEncrypted, readOrgField } from '@/lib/org-data-cipher';

/** Shown in place of text this device cannot decrypt. */
export const UNREADABLE_MESSAGE_TEXT = UNREADABLE_FIELD_TEXT;

/** Whether a decrypted value is one of the "cannot read it here" placeholders. */
export function isUnreadableMessageText(value: string): boolean {
  return value === UNREADABLE_FIELD_TEXT || value === UNREADABLE_ORG_FIELD_TEXT;
}

/**
 * Message text is encrypted at rest under its organisation's data key — by the
 * database layer (lib/encrypted-db.ts, `message` in phi-field-catalog.json),
 * not here. That layer is the one place that seals, because it alone compares
 * against the stored revision: an untouched subject, body or earlier wording
 * keeps its exact envelope, which the message-integrity rule requires. Sealing
 * here first gave every update fresh envelopes, so a front-desk status change
 * read as rewriting the message and an edit as rewriting its history, and the
 * sync gateway refused both.
 *
 * This only refuses the unreadable placeholder as NEW text: a form loaded on a
 * device that could not decrypt a field holds the placeholder, and sending it
 * as a message would store the placeholder as if someone had written it.
 */
export async function encryptMessageText(plaintext: string, _orgId?: string): Promise<string> {
  void _orgId;
  if (isUnreadableMessageText(plaintext)) {
    throw new EncryptionKeyError('This message cannot be read on this device, so it cannot be saved from it.');
  }
  return plaintext;
}

/** Either layer: this device's organisation key, or the legacy server key. */
async function readMessageText(value: string): Promise<string> {
  return isOrgEncrypted(value) ? readOrgField(value) : readReplicatedField(value);
}

/** Read-side decrypt of a stored message, including its history and attachments. */
export async function decryptMessage(doc: MessageDoc): Promise<MessageDoc> {
  const out = { ...doc };
  if (typeof out.subject === 'string') out.subject = await readMessageText(out.subject);
  if (typeof out.body === 'string') out.body = await readMessageText(out.body);
  if (out.editHistory?.length) {
    out.editHistory = await Promise.all(out.editHistory.map(async entry => ({ ...entry, body: await readMessageText(entry.body) })));
  }
  if (out.attachments?.length) {
    out.attachments = await Promise.all(out.attachments.map(async a => ({
      ...a,
      name: await readMessageText(a.name),
      base64Data: await readMessageText(a.base64Data),
    })));
  }
  return out;
}

/**
 * Encrypt every text field still in plaintext. Values already encrypted are
 * left byte-for-byte as stored, and so is `editHistory`: the integrity rule
 * (lib/sync/message-integrity.ts) requires every earlier wording to survive
 * exactly, so history is only ever appended to, never re-encoded.
 */
async function encryptMessageFields<T extends Partial<MessageDoc>>(data: T): Promise<T> {
  // Sealing happens in the database layer (see `encryptMessageText`). A
  // placeholder in an UPDATE is left for that layer, which restores the stored
  // envelope in its place; only brand-new text is refused here.
  return data;
}

async function getAllMessagesUnscoped(): Promise<MessageDoc[]> {
  const db = messagesDB();
  return (await Promise.all((await findByType<MessageDoc>(db, 'message')).map(decryptMessage)))
    .sort((a, b) => new Date(b.sentAt || '').getTime() - new Date(a.sentAt || '').getTime());
}

/**
 * Every message in scope that is NOT staff chat.
 *
 * Staff chat belongs to its participants, not to the organisation, so it is
 * never served by an org-scoped read — it is reached through
 * `conversation-service`, which checks membership. Without this exclusion
 * `GET /api/messages` returned every direct message in the organisation to
 * any staff account.
 */
export async function getAllMessages(scope: DataScope): Promise<MessageDoc[]> {
  // Staff issue reports ride in this database too, but they are a support
  // queue with their own reader (issue-report-service), not correspondence.
  return filterByScope(await getAllMessagesUnscoped(), scope)
    .filter(m => !m.conversationId && m.messageKind !== 'issue_report');
}

export async function getMessagesByPatient(patientId: string, scope: DataScope): Promise<MessageDoc[]> {
  const all = await getAllMessages(scope);
  // Exclude internal staff chat only. A patient→staff message legitimately has
  // recipientType 'staff' (the recipient is staff), so we must NOT filter on
  // recipientType here — that would drop real inbound patient messages.
  // Staff chat messages also carry a blank patientId, so they can't match.
  return all.filter(m => m.patientId === patientId && m.direction !== 'staff_to_staff');
}

export async function getMessagesByDoctor(doctorId: string, scope: DataScope): Promise<MessageDoc[]> {
  const all = await getAllMessages(scope);
  return all.filter(m => m.fromDoctorId === doctorId);
}

/** Patient-portal read: authentication already fixes the query to this patient. */
export async function getPortalMessagesByPatient(patientId: string): Promise<MessageDoc[]> {
  const all = await getAllMessagesUnscoped();
  return all.filter(m => m.patientId === patientId && m.direction !== 'staff_to_staff');
}

/**
 * Inbound messages authored by patients via the patient-portal. The
 * patient-portal Chat tab writes these with `direction === 'patient_to_staff'`
 * (and the legacy fallback of `fromDoctorId === 'patient'` for messages saved
 * before the direction field existed).
 */
export async function getInboundPatientMessages(scope: DataScope): Promise<MessageDoc[]> {
  const all = await getAllMessages(scope);
  return all.filter(m =>
    m.direction === 'patient_to_staff' || m.fromDoctorId === 'patient'
  );
}

/**
 * All messages addressed to (or originating from) a given facility — useful
 * for the staff inbox at a specific hospital. Matches both patient-originated
 * messages targeting this facility and staff-authored messages from/to it.
 */
export async function getMessagesForFacility(hospitalId: string, scope: DataScope): Promise<MessageDoc[]> {
  const all = await getAllMessages(scope);
  return all.filter(m =>
    m.recipientHospitalId === hospitalId ||
    m.fromHospitalId === hospitalId
  );
}

export async function updateMessage(id: string, data: Partial<MessageDoc>): Promise<MessageDoc | null> {
  const db = messagesDB();
  try {
    const existing = await db.get(id) as MessageDoc;
    const updated = await encryptMessageFields({
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      updatedAt: new Date().toISOString(),
    });
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    return await decryptMessage(updated);
  } catch {
    return null;
  }
}

export type RetractMessageResult = 'retracted' | 'already_retracted' | 'not_author' | 'not_found';

/**
 * Remove a message from the thread without removing it from the record.
 *
 * A clinical message is part of the communication record and has to survive
 * its author changing their mind: someone may already have acted on it, and a
 * thread with a hole in it cannot be reconstructed later. So this never calls
 * `db.remove` and never clears the text — it stamps who retracted the message
 * and when, and leaves `body`, `attachments` and `reactions` exactly as sent.
 * Only the author may retract; the audit row carries the acting user.
 */
export async function retractMessage(
  id: string,
  actor: { id: string; name?: string },
): Promise<RetractMessageResult> {
  const db = messagesDB();
  let doc: MessageDoc;
  try {
    doc = await db.get(id) as MessageDoc;
  } catch {
    return 'not_found';
  }
  if (doc.type !== 'message') return 'not_found';
  if (doc.fromDoctorId !== actor.id) return 'not_author';
  if (doc.deleted) return 'already_retracted';
  const now = new Date().toISOString();
  try {
    await db.put({
      ...doc,
      deleted: true,
      deletedAt: now,
      deletedById: actor.id,
      deletedByName: actor.name || doc.fromDoctorName,
      updatedAt: now,
    });
  } catch {
    return 'not_found';
  }
  await logAuditSafe(
    'DELETE_MESSAGE', actor.id, actor.name || doc.fromDoctorName,
    `Message ${doc._id} removed from the thread by its author; content retained`,
  );
  return 'retracted';
}

export async function createMessage(data: Omit<MessageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'>): Promise<MessageDoc> {
  const db = messagesDB();
  const now = new Date().toISOString();
  const id = `msg-${uuidv4()}`;
  const doc: MessageDoc = await encryptMessageFields({
    _id: id,
    type: 'message',
    ...data,
    status: 'sent',
    createdAt: now,
    updatedAt: now,
  });
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  const plaintextDoc = await decryptMessage(doc);
  // Audit trail: every message write is patient-related communication, so
  // it belongs in the audit log alongside other PHI-touching mutations.
  // Previously createMessage wrote silently — the admin audit-log page
  // showed Rx and lab activity but nothing for patient↔staff chats.
  await logAuditSafe(
    'CREATE_MESSAGE', undefined, plaintextDoc.fromDoctorName,
    // Identifiers only: the subject is message text, and the audit log is not encrypted.
    `Message ${plaintextDoc._id}: ${plaintextDoc.direction || 'staff_to_patient'}`
  );
  // Sync event so the Postgres `messages` analytics table receives the row.
  // The /api/sync route already has a field mapper for it (DB_TABLE_MAP +
  // FIELD_MAPPERS.messages), so the missing piece was just emitting the event.
  emitSyncEvent({
    resourceType: 'message',
    resourceId: plaintextDoc._id,
    operation: 'create',
    resourceVersion: plaintextDoc._rev,
    hospitalId: plaintextDoc.fromHospitalId || plaintextDoc.recipientHospitalId,
    orgId: plaintextDoc.orgId,
  });
  return plaintextDoc;
}
