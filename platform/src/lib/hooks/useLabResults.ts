'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { LabResultDoc } from '../db-types';
import { labResultsDB } from '../db';
import { makeCoalescer } from './live-reload';
import { useAuth } from '../context';

export function useLabResults(patientId?: string) {
  const [results, setResults] = useState<LabResultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentUser } = useAuth();
  const scope = useMemo(() => (
    currentUser ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role } : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [currentUser?.orgId, currentUser?.hospitalId, currentUser?.role]);

  const loadResults = useCallback(async () => {
    try {
      setError(null);
      const { getAllLabResults, getLabResultsByPatient } = await import('../services/lab-service');
      const data = patientId ? await getLabResultsByPatient(patientId, scope) : await getAllLabResults(scope);
      setResults(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load lab results');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  useEffect(() => {
    loadResults();
  }, [loadResults]);

  // Live subscription: re-load whenever any lab result doc changes anywhere
  // (consultation page creating an order, lab tech entering a result, etc.).
  // Replaces the previous 30-second polling so cross-module updates are
  // reflected immediately without manual refresh.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadResults(); });
    const changes = labResultsDB().changes({ since: 'now', live: true, include_docs: Boolean(patientId) })
      .on('change', (change) => {
        const doc = change.doc as LabResultDoc | undefined;
        if (!patientId || !doc || doc.patientId === patientId || change.deleted) reload.trigger();
      })
      .on('error', (err) => { console.warn('Lab results subscription error:', err); });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadResults, patientId]);

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
