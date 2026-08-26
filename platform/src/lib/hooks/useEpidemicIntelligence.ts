'use client';

import { useState, useEffect, useCallback } from 'react';
import type { EpidemicIntelligenceData } from '../services/epidemic-intelligence-service';
import { useDataScope } from './useDataScope';

export function useEpidemicIntelligence() {
  const [data, setData] = useState<EpidemicIntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setData(null); setLoading(false); return; }
    try {
      setError(null);
      const { getEpidemicIntelligence } = await import('../services/epidemic-intelligence-service');
      const result = await getEpidemicIntelligence(scope);
      setData(result);
    } catch (err) {
      console.error('Failed to load epidemic intelligence', err);
      setError('Failed to load epidemic intelligence');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
