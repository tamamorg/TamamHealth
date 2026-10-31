/**
 * Patient chart documents — scanned films, referral letters, IDs, previous
 * paper records, etc. The HealthBridge "drop a PDF/photo, categorise it, filter
 * on the timeline" capability.
 *
 * Stored in their own database (not on the patient doc) so large base64 file
 * payloads never bloat patient reads. Facility-operational PHI; synced
 * org-scoped but excluded from national analytics — see the coverage matrix.
 */
import { canRetractDocument } from '@/lib/clinical/document-retraction';
import { v4 as uuidv4 } from 'uuid';
import { patientDocumentsDB } from '../db';
import type { ClinicalImageAnnotation, PatientDocumentDoc, PatientDocumentCategory } from '../db-types';
import { findByType } from './db-query';
import { validateAttachmentPayload } from '../validation';
import { logAuditSafe } from './audit-service';
import { emitSyncEvent } from './sync-event-service';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';

function byNewest(a: PatientDocumentDoc, b: PatientDocumentDoc): number {
  return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
}

/** All documents filed on a patient's chart, newest first. */
export async function getPatientDocuments(patientId: string, scope?: DataScope): Promise<PatientDocumentDoc[]> {
  // A pre-hydration chart has no tenant context yet. Returning nothing is the
  // only safe fallback because the local replica may hold multiple facilities.
  if (!scope) return [];
  let rows = await findByType<PatientDocumentDoc>(
    patientDocumentsDB(),
    'patient_document',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  rows = filterByScope(rows, scope).filter(doc => doc.recordStatus !== 'entered_in_error');
  return rows.sort(byNewest);
}

/**
 * Documents retracted from this chart, newest first: who, when and why. A
 * retraction hides a document from normal views but stays visible to clinical
 * staff as a note, so they know something was there and can ask for it.
 */
export async function getRetractedPatientDocuments(patientId: string, scope: DataScope): Promise<PatientDocumentDoc[]> {
  const rows = await findByType<PatientDocumentDoc>(
    patientDocumentsDB(),
    'patient_document',
    { patientId },
    { indexFields: ['type', 'patientId'] },
  );
  return filterByScope(rows, scope)
    .filter(doc => doc.recordStatus === 'entered_in_error')
    .sort((a, b) => (b.removedAt || '').localeCompare(a.removedAt || ''));
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
  if (!input.base64Data) throw new Error('Choose a file to upload.');
  if (!input.title || input.title.trim().length === 0) throw new Error('Enter a document title.');
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
/**
 * Remove a document from the patient's chart. It was erased outright, with no
 * reason and no facility check; a filed clinical document is kept for the
 * record history instead, marked entered in error with who removed it and why,
 * and every list leaves it out.
 */
export async function deletePatientDocument(
  id: string,
  scope: DataScope,
  reason: string,
  actor?: { id?: string; name?: string; role?: string },
): Promise<boolean> {
  const cleanReason = reason?.trim() ?? '';
  if (cleanReason.length < 3) throw new Error('Enter the reason for removing this document.');
  const db = patientDocumentsDB();
  let doc: PatientDocumentDoc;
  try {
    doc = (await db.get(id)) as PatientDocumentDoc;
  } catch {
    return false;
  }
  if (!canRetractDocument(actor, doc)) throw new Error('Document not removed. Only the person who filed it, a clinician or the records office can remove it.');
  if (filterByScope([doc], scope).length !== 1) throw new Error('You do not have access to this record. It belongs to another facility or organization.');
  const now = new Date().toISOString();
  const updated: PatientDocumentDoc = {
    ...doc,
    recordStatus: 'entered_in_error',
    removalReason: cleanReason,
    removedById: actor?.id,
    removedByName: actor?.name,
    removedAt: now,
    updatedAt: now,
  };
  const resp = await db.put(updated);
  await logAuditSafe('DELETE_PATIENT_DOCUMENT', actor?.id, actor?.name, `Removed document ${id} from patient ${doc.patientId}: ${cleanReason}`);
  emitSyncEvent({ resourceType: 'patient_document', resourceId: id, operation: 'update', resourceVersion: resp.rev, hospitalId: doc.hospitalId, orgId: doc.orgId });
  return true;
}

export interface ImageAnnotationActor {
  id?: string;
  name?: string;
}

export interface AddImageAnnotationInput {
  label: string;
  x: number;
  y: number;
}

function assertImageDocument(doc: PatientDocumentDoc, scope: DataScope): void {
  if (filterByScope([doc], scope).length !== 1) throw new Error('You do not have access to this record. It belongs to another facility or organization.');
  if (!doc.mimeType.startsWith('image/')) throw new Error('Annotations can only be added to images.');
}

function cleanAnnotationInput(input: AddImageAnnotationInput): AddImageAnnotationInput {
  const label = input.label.trim();
  if (!label) throw new Error('Enter a label for the annotation.');
  if (label.length > 160) throw new Error('Keep the annotation label to 160 characters or fewer.');
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 1 || input.y < 0 || input.y > 1) {
    throw new Error('Place the annotation inside the image.');
  }
  return { label, x: input.x, y: input.y };
}

async function mutateImageAnnotations(
  id: string,
  scope: DataScope,
  action: string,
  actor: ImageAnnotationActor,
  mutate: (annotations: ClinicalImageAnnotation[], now: string) => ClinicalImageAnnotation[],
): Promise<PatientDocumentDoc> {
  const db = patientDocumentsDB();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = await db.get(id) as PatientDocumentDoc;
      assertImageDocument(current, scope);
      const now = new Date().toISOString();
      const updated: PatientDocumentDoc = {
        ...current,
        imageAnnotations: mutate([...(current.imageAnnotations || [])], now),
        updatedAt: now,
      };
      const response = await db.put(updated);
      updated._rev = response.rev;
      await logAuditSafe(action, actor.id, actor.name, `Image annotations updated on ${id} (${current.title}) for patient ${current.patientId}`);
      emitSyncEvent({
        resourceType: 'patient_document',
        resourceId: id,
        operation: 'update',
        resourceVersion: updated._rev,
        hospitalId: updated.hospitalId,
        orgId: updated.orgId,
      });
      return updated;
    } catch (error) {
      const conflict = error as { status?: number; name?: string };
      if ((conflict.status === 409 || conflict.name === 'conflict') && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('Annotations not saved. Try again.');
}

export async function addImageAnnotation(
  documentId: string,
  input: AddImageAnnotationInput,
  scope: DataScope,
  actor: ImageAnnotationActor = {},
): Promise<PatientDocumentDoc> {
  const clean = cleanAnnotationInput(input);
  return mutateImageAnnotations(documentId, scope, 'ADD_IMAGE_ANNOTATION', actor, (annotations, now) => [
    ...annotations,
    {
      id: `imgann-${uuidv4()}`,
      ...clean,
      status: 'active',
      createdAt: now,
      createdById: actor.id,
      createdByName: actor.name,
    },
  ]);
}

export async function updateImageAnnotation(
  documentId: string,
  annotationId: string,
  label: string,
  scope: DataScope,
  actor: ImageAnnotationActor = {},
): Promise<PatientDocumentDoc> {
  const cleanLabel = cleanAnnotationInput({ label, x: 0, y: 0 }).label;
  return mutateImageAnnotations(documentId, scope, 'UPDATE_IMAGE_ANNOTATION', actor, (annotations, now) => {
    let found = false;
    const next = annotations.map(annotation => {
      if (annotation.id !== annotationId || annotation.status !== 'active') return annotation;
      found = true;
      return { ...annotation, label: cleanLabel, updatedAt: now, updatedById: actor.id, updatedByName: actor.name };
    });
    if (!found) throw new Error('Annotation not found. Reload the image.');
    return next;
  });
}

export async function deleteImageAnnotation(
  documentId: string,
  annotationId: string,
  scope: DataScope,
  actor: ImageAnnotationActor = {},
): Promise<PatientDocumentDoc> {
  return mutateImageAnnotations(documentId, scope, 'DELETE_IMAGE_ANNOTATION', actor, (annotations, now) => {
    let found = false;
    const next = annotations.map(annotation => {
      if (annotation.id !== annotationId || annotation.status !== 'active') return annotation;
      found = true;
      return { ...annotation, status: 'deleted' as const, deletedAt: now, deletedById: actor.id, deletedByName: actor.name };
    });
    if (!found) throw new Error('Annotation not found. Reload the image.');
    return next;
  });
}
