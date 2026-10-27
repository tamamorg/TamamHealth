'use client';

import { useState, useCallback } from 'react';
import type { LabResultDoc } from '../db-types';
import { labResultsDB } from '../db';
import { usePouchLiveReload } from './usePouchLiveReload';
import { useDataScope } from './useDataScope';

export function useLabResults(patientId?: string) {
  const [results, setResults] = useState<LabResultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadResults = useCallback(async () => {
    if (!scope) {
      setResults([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getAllLabResults, getLabResultsByPatient } = await import('../services/lab-service');
      const data = patientId ? await getLabResultsByPatient(patientId, scope) : await getAllLabResults(scope);
      setResults(data);
    } catch (err) {
      console.error(err);
      setError('Lab results not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  // Live subscription: re-load whenever any lab result doc changes anywhere
  // (consultation page creating an order, lab tech entering a result, etc.).
  // Replaces the previous 30-second polling so cross-module updates are
  // reflected immediately without manual refresh.
  const shouldReload = useCallback((change: { doc?: LabResultDoc; deleted?: boolean }) =>
    !patientId || !change.doc || change.doc.patientId === patientId || Boolean(change.deleted), [patientId]);
  usePouchLiveReload({ load: loadResults, database: labResultsDB, includeDocs: Boolean(patientId), shouldReload, onError: err => console.warn('Lab results subscription error:', err) });

  const create = useCallback(async (data: Omit<LabResultDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createLabResult } = await import('../services/lab-service');
    const result = await createLabResult(data);
    await loadResults();
    return result;
  }, [loadResults]);

  const update = useCallback(async (id: string, data: Partial<LabResultDoc>) => {
    const { updateLabResult } = await import('../services/lab-service');
    const result = await updateLabResult(id, data);
    await loadResults();
    return result;
  }, [loadResults]);

  // Advance an order through its diagnostics lifecycle (validated server-side).
  const advance = useCallback(async (id: string, to: import('../clinical-flow/order-lifecycles').LabOrderStatus, extra?: Partial<LabResultDoc>) => {
    const { advanceLabOrder } = await import('../services/lab-service');
    const result = await advanceLabOrder(id, to, extra);
    await loadResults();
    return result;
  }, [loadResults]);

  return { results, loading, error, create, update, advance, reload: loadResults };
}
