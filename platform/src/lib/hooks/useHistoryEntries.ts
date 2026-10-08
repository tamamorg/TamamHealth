'use client';

import { useState, useCallback, useMemo } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { HistoryEntryDoc } from '../db-types';
import { historyEntriesDB } from '../db';
import { useDataScope } from './useDataScope';
import { activeHistory } from '../clinical/patient-history';
import type { CreateHistoryEntryInput, HistoryEntryPatch } from '../services/history-service';

/**
 * A patient's standing history, live: the chart's History tab and the note's
 * history popup both read through this, so an entry added in one appears in the
 * other without a reload.
 */
export function useHistoryEntries(patientId?: string) {
  const [all, setAll] = useState<HistoryEntryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const scope = useDataScope();

  const load = useCallback(async () => {
    // No scope yet means the session is still hydrating: stay "loading"
    // rather than report a patient with no history for a moment.
    if (!scope) { setAll([]); return; }
    if (!patientId) { setAll([]); setLoading(false); return; }
    try {
      setError(false);
      const { getHistoryByPatient } = await import('../services/history-service');
      setAll(await getHistoryByPatient(patientId, scope));
    } catch (err) {
      console.error(err);
      // Kept distinct from "empty": a history that failed to load must not
      // read as a patient with no history.
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  const shouldReload = useCallback((change: { doc?: HistoryEntryDoc; deleted?: boolean }) => (
    !change.doc || change.doc.patientId === patientId || change.deleted === true
  ), [patientId]);
  usePouchLiveReload({ load, database: historyEntriesDB, includeDocs: true, shouldReload });

  const create = useCallback(async (data: CreateHistoryEntryInput) => {
    const { createHistoryEntry } = await import('../services/history-service');
    const doc = await createHistoryEntry(data);
    await load();
    return doc;
  }, [load]);

  const update = useCallback(async (
    id: string, patch: HistoryEntryPatch, actor?: { userId?: string; userName?: string },
  ) => {
    const { updateHistoryEntry } = await import('../services/history-service');
    if (!scope) return null;
    const doc = await updateHistoryEntry(id, patch, scope, actor);
    await load();
    return doc;
  }, [load, scope]);

  const markInError = useCallback(async (id: string, actor?: { userId?: string; userName?: string }) => {
    const { markHistoryEntryInError } = await import('../services/history-service');
    if (!scope) return null;
    const doc = await markHistoryEntryInError(id, scope, actor);
    await load();
    return doc;
  }, [load, scope]);

  const entries = useMemo(() => activeHistory(all), [all]);

  return { entries, loading, error, create, update, markInError, reload: load };
}
