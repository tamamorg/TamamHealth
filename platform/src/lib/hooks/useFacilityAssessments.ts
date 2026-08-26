'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FacilityAssessmentDoc } from '../db-types';
import { useDataScope } from './useDataScope';
import { makeCoalescer } from './live-reload';
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
      setError('Failed to load facility assessments');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // Live PouchDB subscription — reflect writes arriving from sync/other tabs.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = facilityAssessmentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* transient feed errors; next load resyncs */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const create = useCallback(async (data: Omit<FacilityAssessmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createAssessment } = await import('../services/facility-assessment-service');
    const doc = await createAssessment(data);
    await load();
    return doc;
  }, [load]);

  return { assessments, summary, loading, error, create, reload: load };
}
