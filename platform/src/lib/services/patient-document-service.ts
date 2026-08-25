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
  rows = filterByScope(rows, scope);
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
  if (filterByScope([doc], scope).length !== 1) throw new Error('Document is outside your assigned scope');
  if (!doc.mimeType.startsWith('image/')) throw new Error('Annotations can only be added to images');
}

function cleanAnnotationInput(input: AddImageAnnotationInput): AddImageAnnotationInput {
  const label = input.label.trim();
  if (!label) throw new Error('An annotation label is required');
  if (label.length > 160) throw new Error('Annotation labels cannot exceed 160 characters');
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || input.x < 0 || input.x > 1 || input.y < 0 || input.y > 1) {
    throw new Error('Annotation position is outside the image');
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
  throw new Error('Could not update image annotations');
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
    if (!found) throw new Error('Image annotation was not found');
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
    if (!found) throw new Error('Image annotation was not found');
    return next;
  });
}
