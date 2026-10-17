'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
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
    if (!scope) { setNotes([]); setLoading(false); return; }
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

  usePouchLiveReload({ load, database: phoneNotesDB });

  return { notes, loading, reload: load };
}
