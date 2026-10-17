'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { AssessmentDoc } from '../db-types';
import { assessmentsDB } from '../db';
import { useDataScope } from './useDataScope';

/** Outcome-measure assessments for one patient, newest-first, live-reloading. */
export function useAssessments(patientId?: string) {
  const [assessments, setAssessments] = useState<AssessmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setAssessments([]); setLoading(false); return; }
    if (!patientId) { setAssessments([]); setLoading(false); return; }
    try {
      const { getAssessmentsByPatient } = await import('../services/assessment-service');
      setAssessments(await getAssessmentsByPatient(patientId, scope));
    } catch (err) {
      console.error('Failed to load assessments', err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  usePouchLiveReload({ load, database: assessmentsDB, enabled: Boolean(patientId) });

  return { assessments, loading, reload: load };
}
