'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAllPatients, isMarkedDuplicate } from '@/lib/services/patient-service';
import { useDataScope } from '@/lib/hooks/useDataScope';
import type { PatientDoc } from '@/lib/db-types';
import { findDuplicateCandidates, type DupPair } from './duplicate-candidates';

export interface DuplicateReview {
  /** Every record in the viewer's scope, linked duplicates included. */
  allPatients: PatientDoc[];
  /** The set the scans run on: a linked duplicate is neither a candidate nor a count. */
  patients: PatientDoc[];
  linked: PatientDoc[];
  candidates: DupPair[];
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads the viewer's patients through their own DataScope and derives the
 * duplicate candidates and linked duplicates from them. The scope is what makes
 * the review honest per role: an organisation admin scans the organisation's
 * records, a platform operator's device (no organisation, nothing synced) scans
 * none.
 */
export function useDuplicateReview(): DuplicateReview {
  const scope = useDataScope();
  const [allPatients, setAllPatients] = useState<PatientDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!scope) return;
    try {
      setAllPatients(await getAllPatients(scope, { includeDuplicates: true }));
    } catch (err) {
      console.error('Failed to load patients for duplicate review', err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void reload(); }, [reload]);

  const patients = useMemo(() => allPatients.filter(p => !isMarkedDuplicate(p)), [allPatients]);
  const linked = useMemo(() => allPatients.filter(isMarkedDuplicate), [allPatients]);
  const candidates = useMemo(() => findDuplicateCandidates(patients), [patients]);

  return { allPatients, patients, linked, candidates, loading, reload };
}
