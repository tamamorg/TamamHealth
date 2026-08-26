'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { PhoneNoteDoc } from '../db-types';
import { phoneNotesDB } from '../db';
import { useAuth } from '../context';
import { useDataScope } from './useDataScope';

/**
 * Open phone notes routed to the logged-in provider — the "patient callbacks"
 * worklist for the Chart Desktop inbox (P1.4). Live-reloads as notes are
 * created or answered.
 */
export function usePhoneNotesInbox() {
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const userId = currentUser?._id;
  const [notes, setNotes] = useState<PhoneNoteDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) { setNotes([]); setLoading(false); return; }
    try {
      const { getOpenPhoneNotesForUser } = await import('../services/phone-note-service');
      setNotes(await getOpenPhoneNotesForUser(userId, scope));
    } catch (err) {
      console.error('Failed to load phone-note inbox', err);
    } finally {
      setLoading(false);
    }
  }, [userId, scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = phoneNotesDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger()).on('error', () => { /* noop */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  return { notes, loading, reload: load };
}
