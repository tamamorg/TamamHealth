'use client';

import { useState, useCallback } from 'react';
import type { FacilityAssessmentDoc } from '../db-types';
import { useDataScope } from './useDataScope';
import { usePouchLiveReload } from './usePouchLiveReload';
import { facilityAssessmentsDB } from '../db';

export function useFacilityAssessments() {
  const [assessments, setAssessments] = useState<FacilityAssessmentDoc[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof import('../services/facility-assessment-service').getAssessmentSummary>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setAssessments([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllAssessments, getAssessmentSummary } = await import('../services/facility-assessment-service');
      const [data, s] = await Promise.all([getAllAssessments(scope), getAssessmentSummary(scope)]);
      setAssessments(data);
      setSummary(s);
    } catch (err) {
      console.error('Failed to load assessments', err);
      setError('Facility assessments not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription — reflect writes arriving from sync/other tabs.
  usePouchLiveReload({ load, database: facilityAssessmentsDB });

  const create = useCallback(async (data: Omit<FacilityAssessmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createAssessment } = await import('../services/facility-assessment-service');
    const doc = await createAssessment(data);
    await load();
    return doc;
  }, [load]);

  return { assessments, summary, loading, error, create, reload: load };
}
