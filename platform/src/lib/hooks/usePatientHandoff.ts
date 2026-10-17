'use client';

import { useCallback, useState } from 'react';
import type { HandoffPatientEntry, ShiftHandoffDoc } from '../db-types';
import { handoffsDB } from '../db';
import { usePouchLiveReload } from './usePouchLiveReload';
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

  usePouchLiveReload({ load, database: handoffsDB });

  return latest;
}
