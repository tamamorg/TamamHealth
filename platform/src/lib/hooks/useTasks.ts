'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { makeCoalescer } from './live-reload';
import type { ClinicianTaskDoc } from '../db-types';
import { clinicianTasksDB } from '../db';
import { useAuth } from '../context';
import type { CreateTaskInput } from '../services/clinician-task-service';

/**
 * The signed-in clinician's personal task list, live-reloaded. Exposes open vs
 * completed splits and the create/complete/reschedule/delete actions.
 */
export function useTasks() {
  const { currentUser } = useAuth();
  const userId = currentUser?._id;
  const [tasks, setTasks] = useState<ClinicianTaskDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setTasks([]); setLoading(false); return; }
    try {
      const { getTasks } = await import('../services/clinician-task-service');
      setTasks(await getTasks(userId));
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = clinicianTasksDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const open = useMemo(() => tasks.filter(t => t.status === 'open'), [tasks]);
  const completed = useMemo(() => tasks.filter(t => t.status === 'completed'), [tasks]);

  const add = useCallback(async (input: Omit<CreateTaskInput, 'userId' | 'userName' | 'orgId' | 'hospitalId'>) => {
    if (!userId) return null;
    const { createTask } = await import('../services/clinician-task-service');
    const doc = await createTask({
      ...input,
      userId,
      userName: currentUser?.name,
      orgId: currentUser?.orgId,
      hospitalId: currentUser?.hospitalId,
    });
    await load();
    return doc;
  }, [userId, currentUser?.name, currentUser?.orgId, currentUser?.hospitalId, load]);

  const complete = useCallback(async (id: string) => {
    const { completeTask } = await import('../services/clinician-task-service');
    await completeTask(id);
    await load();
  }, [load]);

  const reopen = useCallback(async (id: string) => {
    const { reopenTask } = await import('../services/clinician-task-service');
    await reopenTask(id);
    await load();
  }, [load]);

  const reschedule = useCallback(async (id: string, dueDate: string) => {
    const { rescheduleTask } = await import('../services/clinician-task-service');
    await rescheduleTask(id, dueDate);
    await load();
  }, [load]);

  const update = useCallback(async (
    id: string,
    patch: Partial<Pick<ClinicianTaskDoc, 'title' | 'description' | 'dueDate' | 'priority'>>,
  ) => {
    const { updateTask } = await import('../services/clinician-task-service');
    const doc = await updateTask(id, patch);
    await load();
    return doc;
  }, [load]);

  const remove = useCallback(async (id: string) => {
    const { deleteTask } = await import('../services/clinician-task-service');
    await deleteTask(id);
    await load();
  }, [load]);

  return { tasks, open, completed, loading, add, complete, reopen, reschedule, update, remove, reload: load };
}
