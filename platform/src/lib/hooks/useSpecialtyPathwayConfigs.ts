'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SpecialtyPathwayConfigDoc } from '@/modules/specialty-care';
import { useDataScope } from './useDataScope';

export function useSpecialtyPathwayConfigs() {
  const scope = useDataScope();
  const [configs, setConfigs] = useState<SpecialtyPathwayConfigDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!scope) { setConfigs([]); setLoading(false); return; }
    const { getSpecialtyPathwayConfigs } = await import('@/modules/specialty-care/services/specialty-care-service');
    try { setConfigs(await getSpecialtyPathwayConfigs(scope)); }
    finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    let cancelled = false;
    let changes: { cancel: () => void } | undefined;
    void import('@/lib/db').then(({ hospitalsDB }) => {
      if (cancelled) return;
      changes = hospitalsDB().changes({ since: 'now', live: true, include_docs: false })
        .on('change', (change: { id?: string }) => { if (change.id?.startsWith('specialty-pathway:')) void reload(); })
        .on('error', () => undefined);
    });
    return () => { cancelled = true; try { changes?.cancel(); } catch { /* noop */ } };
  }, [reload]);
  return { configs, loading, reload };
}
