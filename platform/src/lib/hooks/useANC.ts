'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { ANCVisitDoc } from '../db-types';
import { ancDB } from '../db';
import { useDataScope } from './useDataScope';

export function useANC() {
  const [visits, setVisits] = useState<ANCVisitDoc[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof import('../services/anc-service').getANCStats>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setVisits([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllANCVisits, getANCStats } = await import('../services/anc-service');
      const [data, s] = await Promise.all([getAllANCVisits(scope), getANCStats(scope)]);
      setVisits(data);
      setStats(s);
    } catch (err) {
      console.error('Failed to load ANC visits', err);
      setError('ANC visits not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription: re-load when ANC visits change.
  usePouchLiveReload({ load, database: ancDB });

  const register = useCallback(async (data: Omit<ANCVisitDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createANCVisit } = await import('../services/anc-service');
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const doc = await createANCVisit(data, scope);
    await load();
    return doc;
  }, [load, scope]);

  const update = useCallback(async (id: string, data: Partial<ANCVisitDoc>) => {
    const { updateANCVisit } = await import('../services/anc-service');
    const doc = await updateANCVisit(id, data);
    await load();
    return doc;
  }, [load]);

  return { visits, stats, loading, error, register, update, reload: load };
}
