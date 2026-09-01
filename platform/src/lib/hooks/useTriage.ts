'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { TriageDoc } from '../db-types';
import { triageDB } from '../db';
import { useDataScope } from './useDataScope';
import { withTimeout, CLINICAL_WRITE_TIMEOUT_MS } from '../write-timeout';
import type { CreateTriageOptions, TriageActor } from '../services/triage-service';

/**
 * Triage queue hook for the nurse dashboard and the patient detail page.
 *
 * Passing a `patientId` scopes the returned list to that patient's triage
 * history (newest first). Passing no args returns every triage visible to
 * the current user via DataScope filtering.
 */
export function useTriage(patientId?: string) {
  const [triages, setTriages] = useState<TriageDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setTriages([]); setLoading(false); return; }
    try {
      setError(null);
      const svc = await import('../services/triage-service');
      if (patientId) {
        const data = await svc.getTriageByPatient(patientId, scope);
        setTriages(data);
      } else {
        const data = await svc.getAllTriage(scope);
        setTriages(data);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to load triage records');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  useEffect(() => { load(); }, [load]);

  // Live subscription — any triage write anywhere re-renders consumers.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = triageDB().changes({ since: 'now', live: true, include_docs: Boolean(patientId) })
      .on('change', (change) => {
        const doc = change.doc as TriageDoc | undefined;
        if (!patientId || !doc || doc.patientId === patientId || change.deleted) reload.trigger();
      })
      .on('error', (err) => { console.warn('Triage subscription error:', err); });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load, patientId]);

  // Both writes are bounded (see lib/write-timeout.ts): a triage save stalled
  // by initial-sync IndexedDB contention must reject into the ETAT form's
  // existing catch (`nurse.triageSaveFailed` / `nurse.triageStatusFailed`)
  // rather than leave "Save Triage" spinning forever mid-assessment.
  const create = useCallback(async (
    data: Omit<TriageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
    options?: CreateTriageOptions,
  ) => {
    const { createTriage } = await import('../services/triage-service');
    const doc = await withTimeout(
      createTriage(data, options),
      CLINICAL_WRITE_TIMEOUT_MS,
      'Saving triage timed out — the local database did not respond. Please try again.',
    );
    await load();
    return doc;
  }, [load]);

  const update = useCallback(async (id: string, updates: Partial<TriageDoc>, actor?: TriageActor) => {
    const { updateTriage } = await import('../services/triage-service');
    const doc = await withTimeout(
      updateTriage(id, updates, actor),
      CLINICAL_WRITE_TIMEOUT_MS,
      'Updating triage timed out — the local database did not respond. Please try again.',
    );
    await load();
    return doc;
  }, [load]);

  return { triages, loading, error, create, update, reload: load };
}
