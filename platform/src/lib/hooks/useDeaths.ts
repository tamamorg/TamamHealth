'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
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

  useEffect(() => { load(); }, [load]);

  // Live PouchDB subscription: re-load when deaths change.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = deathsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const register = useCallback(async (data: Omit<DeathRegistrationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createDeath } = await import('../services/death-service');
    const doc = await createDeath(data);
    await load();
    return doc;
  }, [load]);

  return { deaths, stats, loading, error, register, reload: load };
}
