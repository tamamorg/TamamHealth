'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { AssessmentDoc } from '../db-types';
import { assessmentsDB } from '../db';
import { useDataScope } from './useDataScope';

/** Outcome-measure assessments for one patient, newest-first, live-reloading. */
export function useAssessments(patientId?: string) {
  const [assessments, setAssessments] = useState<AssessmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = assessmentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [patientId, load]);

  return { assessments, loading, reload: load };
}
