'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { PatientDocumentDoc } from '../db-types';
import { patientDocumentsDB } from '../db';
import type { AddPatientDocumentInput } from '../services/patient-document-service';
import { useDataScope } from './useDataScope';

/** Scanned/uploaded documents filed on a patient's chart, live-reloaded. */
export function usePatientDocuments(patientId?: string) {
  const [documents, setDocuments] = useState<PatientDocumentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!patientId) { setDocuments([]); setLoading(false); return; }
    try {
      const { getPatientDocuments } = await import('../services/patient-document-service');
      setDocuments(await getPatientDocuments(patientId, scope));
    } catch {
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = patientDocumentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const add = useCallback(async (input: AddPatientDocumentInput) => {
    const { addPatientDocument } = await import('../services/patient-document-service');
    const doc = await addPatientDocument(input);
    await load();
    return doc;
  }, [load]);

  const remove = useCallback(async (id: string, by?: string) => {
    const { deletePatientDocument } = await import('../services/patient-document-service');
    const ok = await deletePatientDocument(id, by);
    await load();
    return ok;
  }, [load]);

  return { documents, loading, add, remove, reload: load };
}
