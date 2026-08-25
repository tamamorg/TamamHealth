'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { makeCoalescer } from './live-reload';
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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = patientRemindersDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const queued = useMemo(() => reminders.filter(r => r.status === 'queued'), [reminders]);

  const queue = useCallback(async (input: QueueReminderInput) => {
    const { queueReminder } = await import('../services/patient-reminder-service');
    const doc = await queueReminder(input);
    await load();
    return doc;
  }, [load]);

  const markSent = useCallback(async (id: string) => {
    const { markReminderSent } = await import('../services/patient-reminder-service');
    await markReminderSent(id);
    await load();
  }, [load]);

  const cancel = useCallback(async (id: string) => {
    const { cancelReminder } = await import('../services/patient-reminder-service');
    await cancelReminder(id);
    await load();
  }, [load]);

  return { reminders, queued, loading, queue, markSent, cancel, reload: load };
}
