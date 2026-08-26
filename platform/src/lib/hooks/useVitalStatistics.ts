'use client';

import { useState, useEffect, useCallback } from 'react';
import { useDataScope } from './useDataScope';
import { birthsDB, deathsDB } from '../db';

interface VitalStats {
  birthStats: Awaited<ReturnType<typeof import('../services/birth-service').getBirthStats>>;
  deathStats: Awaited<ReturnType<typeof import('../services/death-service').getDeathStats>>;
}

export function useVitalStatistics() {
  const [data, setData] = useState<VitalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setData(null); setLoading(false); return; }
    try {
      setError(null);
      const { getBirthStats } = await import('../services/birth-service');
      const { getDeathStats } = await import('../services/death-service');
      const [birthStats, deathStats] = await Promise.all([getBirthStats(scope), getDeathStats(scope)]);
      setData({ birthStats, deathStats });
    } catch (err) {
      console.error('Failed to load vital statistics', err);
      setError('Failed to load vital statistics');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // Live PouchDB subscriptions: refresh aggregate counts whenever a birth
  // or death is registered anywhere in the app. Previously the page had to
  // be manually reloaded to pick up new births — the CRVS dashboard at the
  // national level needs to track in near-real-time, not on cron.
  useEffect(() => {
    let cancelled = false;
    const birthsChanges = birthsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => { if (!cancelled) load(); })
      .on('error', () => { /* swallow */ });
    const deathsChanges = deathsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => { if (!cancelled) load(); })
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      try { birthsChanges.cancel(); } catch { /* noop */ }
      try { deathsChanges.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return { data, loading, error, reload: load };
}
