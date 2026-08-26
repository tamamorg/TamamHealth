'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
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

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = phoneNotesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [patientId, load]);

  return { notes, loading, reload: load };
}
