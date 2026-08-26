'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { makeCoalescer } from './live-reload';
import type { ProgramEnrollmentDoc, ProgramEnrollmentStatus } from '../db-types';
import { programEnrollmentsDB } from '../db';
import { useDataScope } from './useDataScope';

export function usePrograms(patientId?: string) {
  const [enrollments, setEnrollments] = useState<ProgramEnrollmentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setEnrollments([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllProgramEnrollments } = await import('../services/program-service');
      const all = await getAllProgramEnrollments(scope);
      setEnrollments(all);
    } catch (err) {
      console.error(err);
      setError('Failed to load program enrollments');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = programEnrollmentsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const create = useCallback(async (data: Omit<ProgramEnrollmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createProgramEnrollment } = await import('../services/program-service');
    const doc = await createProgramEnrollment(data);
    await load();
    return doc;
  }, [load]);

  const update = useCallback(async (id: string, data: Partial<ProgramEnrollmentDoc>) => {
    const { updateProgramEnrollment } = await import('../services/program-service');
    const doc = await updateProgramEnrollment(id, data);
    await load();
    return doc;
  }, [load]);

  const setStatus = useCallback(async (id: string, status: ProgramEnrollmentStatus) => {
    const { setProgramEnrollmentStatus } = await import('../services/program-service');
    const doc = await setProgramEnrollmentStatus(id, status);
    await load();
    return doc;
  }, [load]);

  const remove = useCallback(async (id: string, reason: string) => {
    const { deleteProgramEnrollment } = await import('../services/program-service');
    const ok = await deleteProgramEnrollment(id, reason);
    await load();
    return ok;
  }, [load]);

  // Filtered to a single patient when caller passes a patientId.
  const patientEnrollments = useMemo(
    () => patientId ? enrollments.filter(p => p.patientId === patientId) : enrollments,
    [enrollments, patientId],
  );

  const active = useMemo(() => patientEnrollments.filter(p => p.status === 'active'), [patientEnrollments]);

  return {
    enrollments: patientEnrollments,
    allEnrollments: enrollments,
    active,
    loading,
    error,
    create,
    update,
    setStatus,
    remove,
    reload: load,
  };
}
