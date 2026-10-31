'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { PatientDocumentDoc } from '../db-types';
import { patientDocumentsDB } from '../db';
import type { AddImageAnnotationInput, AddPatientDocumentInput, ImageAnnotationActor } from '../services/patient-document-service';
import { useDataScope } from './useDataScope';

/** Scanned/uploaded documents filed on a patient's chart, live-reloaded. */
export function usePatientDocuments(patientId?: string) {
  const [documents, setDocuments] = useState<PatientDocumentDoc[]>([]);
  const [retracted, setRetracted] = useState<PatientDocumentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!patientId) { setDocuments([]); setRetracted([]); setLoading(false); return; }
    try {
      const { getPatientDocuments, getRetractedPatientDocuments } = await import('../services/patient-document-service');
      setDocuments(await getPatientDocuments(patientId, scope));
      setRetracted(scope ? await getRetractedPatientDocuments(patientId, scope) : []);
    } catch {
      setDocuments([]);
      setRetracted([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  usePouchLiveReload({ load, database: patientDocumentsDB });

  const add = useCallback(async (input: AddPatientDocumentInput) => {
    const { addPatientDocument } = await import('../services/patient-document-service');
    const doc = await addPatientDocument(input);
    await load();
    return doc;
  }, [load]);

  const remove = useCallback(async (id: string, reason: string, actor?: { id?: string; name?: string; role?: string }) => {
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const { deletePatientDocument } = await import('../services/patient-document-service');
    const ok = await deletePatientDocument(id, scope, reason, actor);
    await load();
    return ok;
  }, [load, scope]);

  const addAnnotation = useCallback(async (documentId: string, input: AddImageAnnotationInput, actor?: ImageAnnotationActor) => {
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const { addImageAnnotation } = await import('../services/patient-document-service');
    const doc = await addImageAnnotation(documentId, input, scope, actor);
    await load();
    return doc;
  }, [load, scope]);

  const updateAnnotation = useCallback(async (documentId: string, annotationId: string, label: string, actor?: ImageAnnotationActor) => {
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const { updateImageAnnotation } = await import('../services/patient-document-service');
    const doc = await updateImageAnnotation(documentId, annotationId, label, scope, actor);
    await load();
    return doc;
  }, [load, scope]);

  const deleteAnnotation = useCallback(async (documentId: string, annotationId: string, actor?: ImageAnnotationActor) => {
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const { deleteImageAnnotation } = await import('../services/patient-document-service');
    const doc = await deleteImageAnnotation(documentId, annotationId, scope, actor);
    await load();
    return doc;
  }, [load, scope]);

  return { documents, retracted, loading, add, remove, addAnnotation, updateAnnotation, deleteAnnotation, reload: load };
}
