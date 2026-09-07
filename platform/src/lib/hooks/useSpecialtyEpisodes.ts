'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SpecialtyCareEpisodeDoc, SpecialtyPathwayCode } from '@/modules/specialty-care';
import { useDataScope } from './useDataScope';

export function useSpecialtyEpisodes(pathway?: SpecialtyPathwayCode, departmentId?: string) {
  const scope = useDataScope();
  const [episodes, setEpisodes] = useState<SpecialtyCareEpisodeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!scope) { setEpisodes([]); setLoading(false); return; }
    try {
      setError(null);
      const { getSpecialtyEpisodes } = await import('@/modules/specialty-care/services/specialty-care-service');
      setEpisodes(await getSpecialtyEpisodes(scope, { pathway, departmentId }));
    } catch (cause) {
      console.error(cause);
      setError('Specialty episodes could not be loaded from this device.');
    } finally {
      setLoading(false);
    }
  }, [departmentId, pathway, scope]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    let cancelled = false;
    let changes: { cancel: () => void } | undefined;
    void import('@/lib/db').then(({ specialtyCareDB }) => {
      if (cancelled) return;
      changes = specialtyCareDB().changes({ since: 'now', live: true, include_docs: false })
        .on('change', () => void reload()).on('error', () => undefined);
    });
    return () => { cancelled = true; try { changes?.cancel(); } catch { /* noop */ } };
  }, [reload]);

  return { episodes, loading, error, reload };
}
