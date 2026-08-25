/**
 * Internal clinical notes — staff-only, per-patient.
 *
 * These notes are kept in their OWN database (tamamhealth_patient_notes),
 * completely separate from the messages DB. No patient-facing query ever
 * touches this database, so internal notes can never leak to a patient
 * (the patient portal and getMessagesByPatient only read MessageDocs).
 */
import { v4 as uuidv4 } from 'uuid';
import { patientNotesDB } from '../db';
import type { PatientNoteDoc } from '../db-types';
import { findByType } from './db-query';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';

/** All internal notes for a patient, newest-first. */
export async function getNotesByPatient(patientId: string, scope?: DataScope): Promise<PatientNoteDoc[]> {
  let rows = await findByType<PatientNoteDoc>(
    patientNotesDB(),
    'patient_note',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  if (scope) rows = filterByScope(rows, scope);
  return rows.sort(
    (a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime(),
  );
}

export async function createPatientNote(
  data: Omit<PatientNoteDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
): Promise<PatientNoteDoc> {
  const db = patientNotesDB();
  const now = new Date().toISOString();
  const id = `pnote-${uuidv4()}`;
  const doc: PatientNoteDoc = {
    _id: id,
    type: 'patient_note',
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe(
    'CREATE_PATIENT_NOTE', doc.authorId, doc.authorName,
    `Internal note ${doc._id} on patient ${doc.patientId}`,
  );
  emitSyncEvent({
    resourceType: 'patient_note',
    resourceId: doc._id,
    operation: 'create',
    resourceVersion: doc._rev,
    hospitalId: doc.hospitalId,
    orgId: doc.orgId,
  });
  return doc;
}

export async function deletePatientNote(id: string): Promise<boolean> {
  const db = patientNotesDB();
  try {
    const doc = await db.get(id);
    await db.remove(doc);
    const note = doc as unknown as PatientNoteDoc;
    await logAuditSafe(
      'DELETE_PATIENT_NOTE', note.authorId, note.authorName,
      `Deleted internal note ${id} on patient ${note.patientId}`,
    );
    emitSyncEvent({
      resourceType: 'patient_note',
      resourceId: id,
      operation: 'delete',
      hospitalId: note.hospitalId,
      orgId: note.orgId,
    });
    return true;
  } catch {
    return false;
  }
}
