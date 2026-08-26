'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { HospitalDoc } from '../db-types';
import { useAuth } from '../context';
import { makeCoalescer } from './live-reload';
import { hospitalsDB } from '../db';

export function useHospitals() {
  const [hospitals, setHospitals] = useState<HospitalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentUser } = useAuth();
  const scope = useMemo(() => (
    currentUser ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role } : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [currentUser?.orgId, currentUser?.hospitalId, currentUser?.role]);

  const loadHospitals = useCallback(async () => {
    try {
      setError(null);
      const { getAllHospitals } = await import('../services/hospital-service');
      const data = await getAllHospitals(scope);
      setHospitals(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load hospitals');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadHospitals();
  }, [loadHospitals]);

  // Live PouchDB subscription — reflect writes arriving from sync/other tabs.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadHospitals(); });
    const changes = hospitalsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* transient feed errors; next load resyncs */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadHospitals]);

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
