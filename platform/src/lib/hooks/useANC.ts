'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
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
      setError('Failed to load ANC visits');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // Live PouchDB subscription: re-load when ANC visits change.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = ancDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const register = useCallback(async (data: Omit<ANCVisitDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createANCVisit } = await import('../services/anc-service');
    const doc = await createANCVisit(data);
    await load();
    return doc;
  }, [load]);

  const update = useCallback(async (id: string, data: Partial<ANCVisitDoc>) => {
    const { updateANCVisit } = await import('../services/anc-service');
    const doc = await updateANCVisit(id, data);
    await load();
    return doc;
  }, [load]);

  return { visits, stats, loading, error, register, update, reload: load };
}
