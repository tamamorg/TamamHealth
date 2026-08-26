'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { DiseaseAlertDoc } from '../db-types';
import { diseaseAlertsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useSurveillance() {
  const [alerts, setAlerts] = useState<DiseaseAlertDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadAlerts = useCallback(async () => {
    if (!scope) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getAllAlerts } = await import('../services/surveillance-service');
      const data = await getAllAlerts(scope);
      setAlerts(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load surveillance alerts');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  // Live PouchDB subscription: re-load on any disease alert change.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadAlerts(); });
    const changes = diseaseAlertsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadAlerts]);

  const create = useCallback(async (
    data: Omit<DiseaseAlertDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
  ) => {
    const { createAlert } = await import('../services/surveillance-service');
    const alert = await createAlert(data);
    await loadAlerts();
    return alert;
  }, [loadAlerts]);

  return { alerts, loading, error, create, reload: loadAlerts };
}
