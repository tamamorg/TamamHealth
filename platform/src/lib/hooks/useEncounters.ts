'use client';

import { useCallback, useState } from 'react';
import type { EncounterDoc } from '../db-types';
import { encountersDB } from '../db';
import { useDataScope } from './useDataScope';
import { usePouchLiveReload } from './usePouchLiveReload';

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

  usePouchLiveReload({ load, database: encountersDB });

  return { encounters, loading, reload: load };
}
