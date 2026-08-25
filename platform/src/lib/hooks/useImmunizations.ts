'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
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
      setError('Failed to load immunizations');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  useEffect(() => { load(); }, [load]);

  // Live PouchDB subscription: re-load on any immunization create/update.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = immunizationsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const register = useCallback(async (data: Omit<ImmunizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createImmunization } = await import('../services/immunization-service');
    const doc = await createImmunization(data);
    await load();
    return doc;
  }, [load]);

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
