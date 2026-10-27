'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { ImmunizationDoc } from '../db-types';
import { immunizationsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useImmunizations(patientId?: string) {
  const [immunizations, setImmunizations] = useState<ImmunizationDoc[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof import('../services/immunization-service').getImmunizationStats>> | null>(null);
  const [coverage, setCoverage] = useState<Awaited<ReturnType<typeof import('../services/immunization-service').getVaccineCoverage>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setImmunizations([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllImmunizations, getImmunizationStats, getVaccineCoverage, getByPatient } = await import('../services/immunization-service');
      const [data, s, c] = patientId
        ? [await getByPatient(patientId, scope), null, null]
        : await Promise.all([getAllImmunizations(scope), getImmunizationStats(scope), getVaccineCoverage(scope)]);
      setImmunizations(data);
      setStats(s);
      setCoverage(c);
    } catch (err) {
      console.error('Failed to load immunizations', err);
      setError('Immunizations not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  // Live PouchDB subscription: re-load on any immunization create/update.
  const shouldReload = useCallback((change: { doc?: ImmunizationDoc; deleted?: boolean }) =>
    !patientId || !change.doc || change.doc.patientId === patientId || Boolean(change.deleted), [patientId]);
  usePouchLiveReload({ load: load, database: immunizationsDB, includeDocs: Boolean(patientId), shouldReload });

  const register = useCallback(async (data: Omit<ImmunizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createImmunization } = await import('../services/immunization-service');
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const doc = await createImmunization(data, scope);
    await load();
    return doc;
  }, [load, scope]);

  const update = useCallback(async (id: string, data: Partial<ImmunizationDoc>) => {
    const { updateImmunization } = await import('../services/immunization-service');
    const doc = await updateImmunization(id, data);
    await load();
    return doc;
  }, [load]);

  const enterInError = useCallback(async (id: string, reason: string, actor?: { id?: string; name?: string }) => {
    const { enterImmunizationInError } = await import('../services/immunization-service');
    const doc = await enterImmunizationInError(id, reason, actor);
    await load();
    return doc;
  }, [load]);

  return { immunizations, stats, coverage, loading, error, register, update, enterInError, reload: load };
}
