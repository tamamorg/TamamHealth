'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { EncounterDoc, LabResultDoc } from '../db-types';
import { encountersDB, labResultsDB } from '../db';
import { useAuth } from '../context';

export interface ResumableEncounter extends EncounterDoc {
  /** How many of the ordered investigations have come back resulted. */
  resultsReady: number;
  /** Total investigations ordered for this paused visit. */
  resultsTotal: number;
  /** True once every ordered investigation has a completed result. */
  allResultsBack: boolean;
}

/**
 * Encounters the current clinician paused (e.g. "Awaiting labs") together with
 * how many of their ordered investigations have come back. Powers the
 * dashboard "Awaiting results" worklist and the Resume action.
 */
export function useResumableEncounters() {
  const { currentUser } = useAuth();
  const clinicianId = currentUser?._id;
  const [encounters, setEncounters] = useState<ResumableEncounter[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { getResumableEncounters } = await import('../services/encounter-service');
      const list = await getResumableEncounters(clinicianId);

      // Gather every ordered lab id across the open encounters in one read.
      const allIds = Array.from(new Set(list.flatMap(e => e.labOrderIds || [])));
      const byId = new Map<string, LabResultDoc>();
      if (allIds.length > 0) {
        const res = await labResultsDB().allDocs<LabResultDoc>({ keys: allIds, include_docs: true });
        for (const row of res.rows) {
          const doc = (row as { doc?: LabResultDoc }).doc;
          if (doc) byId.set(doc._id, doc);
        }
      }

      const enriched: ResumableEncounter[] = list.map(e => {
        const ids = e.labOrderIds || [];
        const resultsReady = ids.filter(id => byId.get(id)?.status === 'completed').length;
        const resultsTotal = ids.length;
        return {
          ...e,
          resultsReady,
          resultsTotal,
          allResultsBack: resultsTotal > 0 && resultsReady === resultsTotal,
        };
      });
      setEncounters(enriched);
    } catch (err) {
      console.error('Failed to load resumable encounters', err);
    } finally {
      setLoading(false);
    }
  }, [clinicianId]);

  useEffect(() => { load(); }, [load]);

  // Reload when an encounter changes or a lab result is completed elsewhere.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const encChanges = encountersDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    const labChanges = labResultsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { encChanges.cancel(); } catch { /* noop */ }
      try { labChanges.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return { encounters, loading, reload: load };
}
