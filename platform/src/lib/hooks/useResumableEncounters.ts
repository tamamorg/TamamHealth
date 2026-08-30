'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import { useDataScope } from './useDataScope';
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
  const scope = useDataScope();
  const [encounters, setEncounters] = useState<ResumableEncounter[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // Fails closed before touching the local replica: pre-hydration (no
    // signed-in user, no scope yet) must read as "nothing to resume", not as
    // every clinician's paused encounters on the device.
    if (!clinicianId || !scope) {
      setEncounters([]);
      setLoading(false);
      return;
    }
    try {
      const { getResumableEncounters } = await import('../services/encounter-service');
      const list = await getResumableEncounters(clinicianId, scope);

      // Gather every ordered lab id across the open encounters in one read —
      // the authoritative source once an order is placed through the lab
      // wizard, which now writes back to `labOrderIds` at order time.
      const allIds = Array.from(new Set(list.flatMap(e => e.labOrderIds || [])));
      const byId = new Map<string, LabResultDoc>();
      if (allIds.length > 0) {
        const res = await labResultsDB().allDocs<LabResultDoc>({ keys: allIds, include_docs: true });
        for (const row of res.rows) {
          const doc = (row as { doc?: LabResultDoc }).doc;
          if (doc) byId.set(doc._id, doc);
        }
      }

      // Fallback: orders placed outside the wizard — or before the write-back
      // fix existed — never landed on `labOrderIds` at all. Read every lab
      // result linked to these encounters directly so the worklist still
      // counts them instead of permanently reading "0 of 0 results".
      const encounterIds = list.map(e => e._id);
      const byEncounterId = new Map<string, LabResultDoc[]>();
      if (encounterIds.length > 0) {
        const { findByType } = await import('../services/db-query');
        const linked = await findByType<LabResultDoc>(
          labResultsDB(),
          'lab_result',
          { encounterId: { $in: encounterIds } },
          { indexFields: ['type', 'encounterId'] },
        );
        for (const doc of linked) {
          if (!doc.encounterId) continue;
          const rows = byEncounterId.get(doc.encounterId) || [];
          rows.push(doc);
          byEncounterId.set(doc.encounterId, rows);
        }
      }

      const enriched: ResumableEncounter[] = list.map(e => {
        // Union by _id — labOrderIds and the encounter-link query usually
        // name the same orders; merging avoids double-counting one that
        // shows up via both.
        const merged = new Map<string, LabResultDoc | undefined>();
        for (const id of e.labOrderIds || []) merged.set(id, byId.get(id));
        for (const doc of byEncounterId.get(e._id) || []) {
          if (!merged.has(doc._id)) merged.set(doc._id, doc);
        }
        const resultsTotal = merged.size;
        const resultsReady = Array.from(merged.values()).filter(doc => doc?.status === 'completed').length;
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
  }, [clinicianId, scope]);

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
