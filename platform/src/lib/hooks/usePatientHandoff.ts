'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HandoffPatientEntry, ShiftHandoffDoc } from '../db-types';
import { handoffsDB } from '../db';
import { makeCoalescer } from './live-reload';
import { useDataScope } from './useDataScope';

export interface PatientShiftHandoff {
  handoff: ShiftHandoffDoc;
  entry: HandoffPatientEntry;
}

/** Returns the newest signed shift handoff entry for one patient. */
export function usePatientHandoff(patientId?: string) {
  const [latest, setLatest] = useState<PatientShiftHandoff | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setLatest(null); return; }
    if (!patientId) {
      setLatest(null);
      return;
    }
    try {
      const { listHandoffs } = await import('../services/handoff-service');
      const handoffs = await listHandoffs(scope);
      for (const handoff of handoffs) {
        const entry = handoff.patients.find(p => p.patientId === patientId);
        if (entry) {
          setLatest({ handoff, entry });
          return;
        }
      }
      setLatest(null);
    } catch {
      setLatest(null);
    }
  }, [patientId, scope]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const reload = makeCoalescer(() => { void load(); });
    const changes = handoffsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* offline or closed — retain the last loaded value */ });
    return () => {
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return latest;
}
