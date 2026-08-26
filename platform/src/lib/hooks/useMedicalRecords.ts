'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MedicalRecordDoc } from '../db-types';
import { medicalRecordsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useMedicalRecords(patientId?: string) {
  const [records, setRecords] = useState<MedicalRecordDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadRecords = useCallback(async () => {
    if (!scope) { setRecords([]); setLoading(false); return; }
    if (!patientId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getRecordsByPatient } = await import('../services/medical-record-service');
      const data = await getRecordsByPatient(patientId, scope);
      setRecords(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load medical records');
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Live PouchDB subscription scoped to this patient: re-load when any
  // medical record changes (matching by patientId on the changed doc).
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const changes = medicalRecordsDB().changes({ since: 'now', live: true, include_docs: true })
      .on('change', (change) => {
        if (cancelled) return;
        const doc = change.doc as MedicalRecordDoc | undefined;
        // Reload when: doc is for this patient, doc was deleted, or doc is missing (safety)
        if (!doc || doc.patientId === patientId || change.deleted) {
          loadRecords();
        }
      })
      .on('error', (err) => { console.warn('Medical records subscription error:', err); });
    return () => {
      cancelled = true;
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [patientId, loadRecords]);

  const create = useCallback(async (data: Omit<MedicalRecordDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createMedicalRecord } = await import('../services/medical-record-service');
    const record = await createMedicalRecord(data);
    await loadRecords();
    return record;
  }, [loadRecords]);

  return { records, loading, error, create, reload: loadRecords };
}
