'use client';

import { useState, useCallback, useMemo } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { PatientReminderDoc } from '../db-types';
import { patientRemindersDB } from '../db';
import type { QueueReminderInput } from '../services/patient-reminder-service';
import { useDataScope } from './useDataScope';

/** A patient's queued/sent reminders, live-reloaded. */
export function usePatientReminders(patientId?: string) {
  const [reminders, setReminders] = useState<PatientReminderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setReminders([]); setLoading(false); return; }
    if (!patientId) { setReminders([]); setLoading(false); return; }
    try {
      const { getRemindersByPatient } = await import('../services/patient-reminder-service');
      setReminders(await getRemindersByPatient(patientId, scope));
    } catch {
      setReminders([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  usePouchLiveReload({ load, database: patientRemindersDB });

  const queued = useMemo(() => reminders.filter(r => r.status === 'queued'), [reminders]);

  const queue = useCallback(async (input: QueueReminderInput) => {
    const { queueReminder } = await import('../services/patient-reminder-service');
    const doc = await queueReminder(input);
    await load();
    return doc;
  }, [load]);

  const markSent = useCallback(async (id: string) => {
    const { markReminderSent } = await import('../services/patient-reminder-service');
    const saved = await markReminderSent(id);
    await load();
    if (!saved) throw new Error('Reminder not found. Refresh and try again.');
  }, [load]);

  const cancel = useCallback(async (id: string) => {
    const { cancelReminder } = await import('../services/patient-reminder-service');
    const saved = await cancelReminder(id);
    await load();
    if (!saved) throw new Error('Reminder not found. Refresh and try again.');
  }, [load]);

  const edit = useCallback(async (
    id: string,
    changes: { message?: string; sendDate?: string; channel?: PatientReminderDoc['channel'] },
    actor?: { id?: string; name?: string },
  ) => {
    const { updateReminder } = await import('../services/patient-reminder-service');
    const doc = await updateReminder(id, changes, actor);
    await load();
    return doc;
  }, [load]);

  const reopen = useCallback(async (id: string) => {
    const { reopenReminder } = await import('../services/patient-reminder-service');
    const saved = await reopenReminder(id);
    await load();
    if (!saved) throw new Error('Reminder not found. Refresh and try again.');
  }, [load]);

  return { reminders, queued, loading, queue, markSent, cancel, edit, reopen, reload: load };
}
