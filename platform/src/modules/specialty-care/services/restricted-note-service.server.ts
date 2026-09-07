import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDB } from '@/lib/db';
import { decryptField, encryptField } from '@/lib/field-encryption';
import { logAuditSafe } from '@/lib/services/audit-service';
import { findByType } from '@/lib/services/db-query';
import type { RestrictedMentalHealthNote, RestrictedMentalHealthNoteCategory } from '../core/restricted-notes';

interface EncryptedRestrictedNoteDoc {
  _id: string;
  _rev?: string;
  type: 'restricted_mental_health_note';
  patientId: string;
  patientName: string;
  episodeId: string;
  category: RestrictedMentalHealthNoteCategory;
  hospitalId: string;
  orgId: string;
  authoredBy: string;
  authoredByName: string;
  authoredAt: string;
  updatedAt: string;
  ciphertext: string;
}

const restrictedDB = () => getDB('tamamhealth_restricted_clinical');

export async function createRestrictedMentalHealthNote(input: {
  patientId: string;
  patientName: string;
  episodeId: string;
  category: RestrictedMentalHealthNoteCategory;
  narrative: string;
  hospitalId: string;
  orgId: string;
  actorId: string;
  actorName: string;
}): Promise<RestrictedMentalHealthNote> {
  const narrative = input.narrative.trim();
  if (!narrative) throw new Error('Restricted note narrative is required');
  if (narrative.length > 20_000) throw new Error('Restricted note narrative cannot exceed 20,000 characters');
  const now = new Date().toISOString();
  const id = `restricted-mh-${randomUUID()}`;
  const doc: EncryptedRestrictedNoteDoc = {
    _id: id, type: 'restricted_mental_health_note', patientId: input.patientId, patientName: input.patientName,
    episodeId: input.episodeId, category: input.category, hospitalId: input.hospitalId, orgId: input.orgId,
    authoredBy: input.actorId, authoredByName: input.actorName, authoredAt: now, updatedAt: now,
    ciphertext: encryptField(narrative),
  };
  const response = await restrictedDB().put(doc);
  doc._rev = response.rev;
  await logAuditSafe('RESTRICTED_MH_NOTE_CREATED', input.actorId, input.actorName, `Restricted mental-health note ${id} created for patient ${input.patientId}`);
  return { id, patientId: doc.patientId, patientName: doc.patientName, episodeId: doc.episodeId, category: doc.category, narrative, hospitalId: doc.hospitalId, orgId: doc.orgId, authoredBy: doc.authoredBy, authoredByName: doc.authoredByName, authoredAt: doc.authoredAt, updatedAt: doc.updatedAt };
}

export async function getRestrictedMentalHealthNotes(input: {
  patientId: string;
  orgId: string;
  allowedFacilityIds?: readonly string[];
  allFacilities?: boolean;
  actorId: string;
  actorName: string;
  breakGlassReason?: string;
}): Promise<RestrictedMentalHealthNote[]> {
  const rows = await findByType<EncryptedRestrictedNoteDoc>(restrictedDB(), 'restricted_mental_health_note', { patientId: input.patientId }, { indexFields: ['type', 'patientId'] });
  const facilities = new Set(input.allowedFacilityIds ?? []);
  const scoped = rows.filter((row) => row.orgId === input.orgId && (input.allFacilities || facilities.has(row.hospitalId)));
  await logAuditSafe(input.breakGlassReason ? 'RESTRICTED_MH_NOTE_BREAK_GLASS_READ' : 'RESTRICTED_MH_NOTE_READ', input.actorId, input.actorName, `Read ${scoped.length} restricted mental-health note(s) for patient ${input.patientId}${input.breakGlassReason ? `; reason: ${input.breakGlassReason}` : ''}`);
  return scoped.sort((a, b) => b.authoredAt.localeCompare(a.authoredAt)).map((doc) => ({ id: doc._id, patientId: doc.patientId, patientName: doc.patientName, episodeId: doc.episodeId, category: doc.category, narrative: decryptField(doc.ciphertext), hospitalId: doc.hospitalId, orgId: doc.orgId, authoredBy: doc.authoredBy, authoredByName: doc.authoredByName, authoredAt: doc.authoredAt, updatedAt: doc.updatedAt }));
}
