'use client';

import { useState, useCallback } from 'react';
import type { HospitalDoc } from '../db-types';
import { useDataScope } from './useDataScope';
import { usePouchLiveReload } from './usePouchLiveReload';
import { hospitalsDB } from '../db';

export function useHospitals() {
  const [hospitals, setHospitals] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadHospitals = useCallback(async () => {
    if (!scope) {
      setHospitals([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getAllHospitals } = await import('../services/hospital-service');
      const data = await getAllHospitals(scope);
      setHospitals(data);
    } catch (err) {
      console.error(err);
      setError('Facilities not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription — reflect writes arriving from sync/other tabs.
  usePouchLiveReload({ load: loadHospitals, database: hospitalsDB });

  const create = useCallback(async (
    data: Omit<HospitalDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSync' | 'patientCount' | 'todayVisits'>,
    actorId?: string,
    actorUsername?: string
  ) => {
    const { createHospital } = await import('../services/hospital-service');
    const hospital = await createHospital(data, actorId, actorUsername);
    await loadHospitals();
    return hospital;
  }, [loadHospitals]);

  const update = useCallback(async (id: string, data: Partial<HospitalDoc>) => {
    const { updateHospitalStatus } = await import('../services/hospital-service');
    const updated = await updateHospitalStatus(id, data);
    await loadHospitals();
    return updated;
  }, [loadHospitals]);

  return { hospitals, loading, error, create, update, reload: loadHospitals };
}
