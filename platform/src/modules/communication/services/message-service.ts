import { messagesDB } from '@/lib/db';
import { findByType } from '@/lib/services/db-query';
import type { MessageDoc } from '@/lib/db-types';
import type { DataScope } from '@/lib/services/data-scope';
import { filterByScope } from '@/lib/services/data-scope';
import { v4 as uuidv4 } from 'uuid';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import { maybeDecrypt, maybeEncrypt } from '@/lib/field-encryption';

const ENCRYPTED_MESSAGE_FIELDS = ['subject', 'body'] as const;

function decryptMessage(doc: MessageDoc): MessageDoc {
  const out = { ...doc };
  for (const field of ENCRYPTED_MESSAGE_FIELDS) {
    const value = out[field];
    if (typeof value === 'string') out[field] = maybeDecrypt(value);
  }
  return out;
}

function encryptMessageFields<T extends Partial<MessageDoc>>(data: T): T {
  const out = { ...data };
  for (const field of ENCRYPTED_MESSAGE_FIELDS) {
    const value = out[field];
    if (typeof value === 'string' && value.length > 0) out[field] = maybeEncrypt(value);
  }
  return out;
}

export async function getAllMessages(scope?: DataScope): Promise<MessageDoc[]> {
  const db = messagesDB();
  const all = (await findByType<MessageDoc>(db, 'message'))
    .map(decryptMessage)
    .sort((a, b) => new Date(b.sentAt || '').getTime() - new Date(a.sentAt || '').getTime());
  return scope ? filterByScope(all, scope) : all;
}

export async function getMessagesByPatient(patientId: string): Promise<MessageDoc[]> {
  const all = await getAllMessages();
  // Exclude internal staff chat only. A patient→staff message legitimately has
  // recipientType 'staff' (the recipient is staff), so we must NOT filter on
  // recipientType here — that would drop real inbound patient messages.
  // Staff chat messages also carry a blank patientId, so they can't match.
  return all.filter(m => m.patientId === patientId && m.direction !== 'staff_to_staff');
}

export async function getMessagesByDoctor(doctorId: string): Promise<MessageDoc[]> {
  const all = await getAllMessages();
  return all.filter(m => m.fromDoctorId === doctorId);
}

/**
 * Inbound messages authored by patients via the patient-portal. The
 * patient-portal Chat tab writes these with `direction === 'patient_to_staff'`
 * (and the legacy fallback of `fromDoctorId === 'patient'` for messages saved
 * before the direction field existed).
 */
export async function getInboundPatientMessages(scope?: DataScope): Promise<MessageDoc[]> {
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
export async function getMessagesForFacility(hospitalId: string, scope?: DataScope): Promise<MessageDoc[]> {
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
    const updated = encryptMessageFields({
      ...existing,
      ...data,
      _id: existing._id,
      _rev: existing._rev,
      updatedAt: new Date().toISOString(),
    });
    const resp = await db.put(updated);
    updated._rev = resp.rev;
    return decryptMessage(updated);
  } catch {
    return null;
  }
}

export async function deleteMessage(id: string): Promise<boolean> {
  const db = messagesDB();
  try {
    const doc = await db.get(id);
    await db.remove(doc);
    return true;
  } catch {
    return false;
  }
}

export async function createMessage(data: Omit<MessageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'status'>): Promise<MessageDoc> {
  const db = messagesDB();
  const now = new Date().toISOString();
  const id = `msg-${uuidv4()}`;
  const doc: MessageDoc = encryptMessageFields({
    _id: id,
    type: 'message',
    ...data,
    status: 'sent',
    createdAt: now,
    updatedAt: now,
  });
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  const plaintextDoc = decryptMessage(doc);
  // Audit trail: every message write is patient-related communication, so
  // it belongs in the audit log alongside other PHI-touching mutations.
  // Previously createMessage wrote silently — the admin audit-log page
  // showed Rx and lab activity but nothing for patient↔staff chats.
  await logAuditSafe(
    'CREATE_MESSAGE', undefined, plaintextDoc.fromDoctorName,
    `Message ${plaintextDoc._id}: ${plaintextDoc.direction || 'staff_to_patient'} — ${plaintextDoc.subject || '(no subject)'}`
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
