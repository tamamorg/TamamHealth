'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { DeathRegistrationDoc } from '../db-types';
import { deathsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useDeaths() {
  const [deaths, setDeaths] = useState<DeathRegistrationDoc[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof import('../services/death-service').getDeathStats>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setDeaths([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllDeaths, getDeathStats } = await import('../services/death-service');
      const [data, s] = await Promise.all([getAllDeaths(scope), getDeathStats(scope)]);
      setDeaths(data);
      setStats(s);
    } catch (err) {
      console.error('Failed to load deaths', err);
      setError('Failed to load deaths');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription: re-load when deaths change.
  usePouchLiveReload({ load, database: deathsDB });

  const register = useCallback(async (data: Omit<DeathRegistrationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createDeath } = await import('../services/death-service');
    if (!scope) throw new Error('Your data scope is still loading - try again in a moment.');
    const doc = await createDeath(data, scope);
    await load();
    return doc;
  }, [load, scope]);

  return { deaths, stats, loading, error, register, reload: load };
}
