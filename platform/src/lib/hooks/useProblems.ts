'use client';

import { useState, useCallback, useMemo } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { ProblemDoc, ProblemStatus } from '../db-types';
import { problemsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useProblems(patientId?: string) {
  const [problems, setProblems] = useState<ProblemDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setProblems([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllProblems, getProblemsByPatient } = await import('../services/problem-service');
      const rows = patientId
        ? await getProblemsByPatient(patientId, scope)
        : await getAllProblems(scope);
      setProblems(rows);
    } catch (err) {
      console.error(err);
      setError('Failed to load problems');
    } finally {
      setLoading(false);
    }
  }, [scope, patientId]);

  const shouldReload = useCallback((change: { doc?: ProblemDoc; deleted?: boolean }) => (
    !patientId || !change.doc || change.doc.patientId === patientId || change.deleted === true
  ), [patientId]);
  usePouchLiveReload({
    load,
    database: problemsDB,
    includeDocs: Boolean(patientId),
    shouldReload,
  });

  const create = useCallback(async (data: Omit<ProblemDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createProblem } = await import('../services/problem-service');
    const doc = await createProblem(data);
    await load();
    return doc;
  }, [load]);

  const update = useCallback(async (id: string, data: Partial<ProblemDoc>) => {
    const { updateProblem } = await import('../services/problem-service');
    const doc = await updateProblem(id, data);
    await load();
    return doc;
  }, [load]);

  const setStatus = useCallback(async (id: string, status: ProblemStatus) => {
    const { setProblemStatus } = await import('../services/problem-service');
    const doc = await setProblemStatus(id, status);
    await load();
    return doc;
  }, [load]);

  const remove = useCallback(async (id: string) => {
    const { deleteProblem } = await import('../services/problem-service');
    const ok = await deleteProblem(id);
    await load();
    return ok;
  }, [load]);

  // Patient-scoped calls are narrowed by the indexed service query above;
  // keep the defensive filter for stores containing malformed legacy docs.
  const patientProblems = useMemo(
    () => patientId ? problems.filter(p => p.patientId === patientId) : problems,
    [problems, patientId],
  );

  const active = useMemo(() => patientProblems.filter(p => p.status === 'active' || p.status === 'chronic'), [patientProblems]);
  const resolved = useMemo(() => patientProblems.filter(p => p.status === 'resolved'), [patientProblems]);

  return {
    problems: patientProblems,
    allProblems: problems,
    active,
    resolved,
    loading,
    error,
    create,
    update,
    setStatus,
    remove,
    reload: load,
  };
}
