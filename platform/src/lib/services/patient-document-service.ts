/**
 * Patient chart documents — scanned films, referral letters, IDs, previous
 * paper records, etc. The HealthBridge "drop a PDF/photo, categorise it, filter
 * on the timeline" capability.
 *
 * Stored in their own database (not on the patient doc) so large base64 file
 * payloads never bloat patient reads. Facility-operational PHI; synced
 * org-scoped but excluded from national analytics — see the coverage matrix.
 */
import { v4 as uuidv4 } from 'uuid';
import { patientDocumentsDB } from '../db';
import type { PatientDocumentDoc, PatientDocumentCategory } from '../db-types';
import { findByType } from './db-query';
import { validateAttachmentPayload } from '../validation';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';

function byNewest(a: PatientDocumentDoc, b: PatientDocumentDoc): number {
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
}

/** All documents filed on a patient's chart, newest first. */
export async function getPatientDocuments(patientId: string): Promise<PatientDocumentDoc[]> {
  const rows = await findByType<PatientDocumentDoc>(
    patientDocumentsDB(),
    'patient_document',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  return rows.sort(byNewest);
}

export interface AddPatientDocumentInput {
  patientId: string;
  title: string;
  category: PatientDocumentCategory;
  fileName: string;
  mimeType: string;
  base64Data: string;
  sizeBytes: number;
  note?: string;
  uploadedById?: string;
  uploadedByName?: string;
  hospitalId?: string;
  orgId?: string;
}

export async function addPatientDocument(input: AddPatientDocumentInput): Promise<PatientDocumentDoc> {
  if (!input.base64Data) throw new Error('Document file data is required');
  if (!input.title || input.title.trim().length === 0) throw new Error('A document title is required');
  // Size and type were checked nowhere on this path. The payload is stored
  // inline on the document and this database replicates in full to every
  // clinician's browser in the organisation, so an unbounded upload is an
  // unbounded download for everyone else. Enforced here rather than in the
  // uploader because browser writes go straight to the local replica.
  const check = validateAttachmentPayload({
    name: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    base64Length: input.base64Data.length,
  });
  if (!check.valid) throw new Error(check.error);
  const db = patientDocumentsDB();
  const now = new Date().toISOString();
  const doc: PatientDocumentDoc = {
    _id: `pdoc-${uuidv4()}`,
    type: 'patient_document',
    patientId: input.patientId,
    title: input.title.trim(),
    category: input.category,
    fileName: input.fileName,
    mimeType: input.mimeType,
    base64Data: input.base64Data,
    sizeBytes: input.sizeBytes,
    note: input.note?.trim() || undefined,
    uploadedById: input.uploadedById,
    uploadedByName: input.uploadedByName,
    hospitalId: input.hospitalId,
    orgId: input.orgId,
    createdAt: now,
    updatedAt: now,
  };
  const resp = await db.put(doc);
  doc._rev = resp.rev;
  await logAuditSafe('ADD_PATIENT_DOCUMENT', input.uploadedById, input.uploadedByName, `Filed "${doc.title}" (${doc.category}) on patient ${doc.patientId}`);
  emitSyncEvent({ resourceType: 'patient_document', resourceId: doc._id, operation: 'create', resourceVersion: doc._rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  return doc;
}

/** Delete a document. Returns true if it existed. */
export async function deletePatientDocument(id: string, by?: string): Promise<boolean> {
  const db = patientDocumentsDB();
  try {
    const doc = (await db.get(id)) as PatientDocumentDoc;
    await db.remove({ _id: doc._id, _rev: doc._rev! });
    await logAuditSafe('DELETE_PATIENT_DOCUMENT', by, undefined, `Deleted document ${id} (${doc.title}) from patient ${doc.patientId}`);
    emitSyncEvent({ resourceType: 'patient_document', resourceId: id, operation: 'delete', hospitalId: doc.hospitalId, orgId: doc.orgId });
    return true;
  } catch {
    return false;
  }
}
