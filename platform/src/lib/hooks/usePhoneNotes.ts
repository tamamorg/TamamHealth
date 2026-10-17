'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { PhoneNoteDoc } from '../db-types';
import { phoneNotesDB } from '../db';
import { useDataScope } from './useDataScope';

/** Phone notes for one patient, newest-first, live-reloading on changes. */
export function usePhoneNotes(patientId?: string) {
  const [notes, setNotes] = useState<PhoneNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setNotes([]); setLoading(false); return; }
    if (!patientId) { setNotes([]); setLoading(false); return; }
    try {
      const { getPhoneNotesByPatient } = await import('../services/phone-note-service');
      setNotes(await getPhoneNotesByPatient(patientId, scope));
    } catch (err) {
      console.error('Failed to load phone notes', err);
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  usePouchLiveReload({ load, database: phoneNotesDB, enabled: Boolean(patientId) });

  return { notes, loading, reload: load };
}
