'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { BirthRegistrationDoc } from '../db-types';
import { birthsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useBirths() {
  const [births, setBirths] = useState<BirthRegistrationDoc[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof import('../services/birth-service').getBirthStats>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setBirths([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllBirths, getBirthStats } = await import('../services/birth-service');
      const [data, s] = await Promise.all([getAllBirths(scope), getBirthStats(scope)]);
      setBirths(data);
      setStats(s);
    } catch (err) {
      console.error('Failed to load births', err);
      setError('Birth records not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload({ load, database: birthsDB });

  const register = useCallback(async (data: Omit<BirthRegistrationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createBirth } = await import('../services/birth-service');
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const doc = await createBirth(data, scope);
    await load();
    return doc;
  }, [load, scope]);

  return { births, stats, loading, error, register, reload: load };
}
