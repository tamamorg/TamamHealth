'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MedicalRecordDoc } from '../db-types';
import { medicalRecordsDB } from '../db';
import { useDataScope } from './useDataScope';
import { usePouchLiveReload } from './usePouchLiveReload';

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
  const shouldReload = useCallback((change: { doc?: MedicalRecordDoc; deleted?: boolean }) =>
    // Reload when: doc is for this patient, doc was deleted, or doc is missing (safety)
    !change.doc || change.doc.patientId === patientId || Boolean(change.deleted), [patientId]);
  usePouchLiveReload({
    load: loadRecords,
    database: medicalRecordsDB,
    includeDocs: true,
    shouldReload,
    enabled: Boolean(patientId),
    onError: err => console.warn('Medical records subscription error:', err),
  });

  const create = useCallback(async (data: Omit<MedicalRecordDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createMedicalRecord } = await import('../services/medical-record-service');
    const record = await createMedicalRecord(data);
    await loadRecords();
    return record;
  }, [loadRecords]);

  return { records, loading, error, create, reload: loadRecords };
}
