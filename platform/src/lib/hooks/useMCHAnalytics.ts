'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MCHAnalyticsData } from '../services/mch-analytics-service';
import { useDataScope } from './useDataScope';

export function useMCHAnalytics() {
  const [data, setData] = useState<MCHAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setData(null); setLoading(false); return; }
    try {
      setError(null);
      const { getMCHAnalytics } = await import('../services/mch-analytics-service');
      const result = await getMCHAnalytics(scope);
      setData(result);
    } catch (err) {
      console.error('Failed to load MCH analytics', err);
      setError('Failed to load MCH analytics');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
