'use client';

import { useTranslation } from '../i18n/useTranslation';
import { useState, useEffect, useCallback } from 'react';
import type { MCHAnalyticsData } from '../services/mch-analytics-service';
import { useDataScope } from './useDataScope';

export function useMCHAnalytics() {
  const [data, setData] = useState<MCHAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
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
      setError('msg.maternalAndChildHealthAnalyticsNotLoaded');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error: error && t(error), reload: load };
}
