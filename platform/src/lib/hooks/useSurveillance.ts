'use client';

import { useTranslation } from '../i18n/useTranslation';
import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { DiseaseAlertDoc } from '../db-types';
import { diseaseAlertsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useSurveillance() {
  const [alerts, setAlerts] = useState<DiseaseAlertDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
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
      setError('msg.surveillanceAlertsNotLoaded');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription: re-load on any disease alert change.
  usePouchLiveReload({ load: loadAlerts, database: diseaseAlertsDB });

  const create = useCallback(async (
    data: Omit<DiseaseAlertDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>
  ) => {
    const { createAlert } = await import('../services/surveillance-service');
    const alert = await createAlert(data);
    await loadAlerts();
    return alert;
  }, [loadAlerts]);

  /** Correct counts / level / trend on an existing alert (scoped to the caller's tenant). */
  const update = useCallback(async (id: string, data: Partial<DiseaseAlertDoc>) => {
    const { updateAlert } = await import('../services/surveillance-service');
    const saved = await updateAlert(id, data, scope ?? undefined);
    if (!saved) throw new Error('Alert not updated.');
    await loadAlerts();
    return saved;
  }, [loadAlerts, scope]);

  return { alerts, loading, error: error && t(error), create, update, reload: loadAlerts };
}
