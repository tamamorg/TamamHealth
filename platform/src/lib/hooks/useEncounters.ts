'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EncounterDoc } from '../db-types';
import { encountersDB } from '../db';
import { useDataScope } from './useDataScope';
import { makeCoalescer } from './live-reload';

/** Live, tenant-scoped encounter state for cross-station operational displays. */
export function useEncounters() {
  const [encounters, setEncounters] = useState<EncounterDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) {
      setEncounters([]);
      setLoading(false);
      return;
    }
    try {
      const { getAllEncounters } = await import('../services/encounter-service');
      setEncounters(await getAllEncounters(scope));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) void load(); });
    const changes = encountersDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => undefined);
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return { encounters, loading, reload: load };
}
