'use client';

import { useState, useEffect, useCallback } from 'react';
import type { NationalDataQuality } from '../services/data-quality-service';
import { useDataScope } from './useDataScope';

export function useDataQuality() {
  const [data, setData] = useState<NationalDataQuality | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setData(null); setLoading(false); return; }
    try {
      setError(null);
      const { getNationalDataQuality } = await import('../services/data-quality-service');
      const result = await getNationalDataQuality(scope);
      setData(result);
    } catch (err) {
      console.error('Failed to load data quality', err);
      setError('Failed to load data quality');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
