'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import type { ShiftHandoffDoc } from '../db-types';
import { handoffsDB } from '../db';
import { useDataScope } from './useDataScope';

/**
 * Live-subscribed shift-handoff hook for the nurse dashboard.
 *
 * Returns every handoff visible to the current user (newest first) plus the
 * single latest one for the user's facility — the record the oncoming nurse
 * reads and acknowledges. Any handoff write anywhere re-renders consumers.
 */
export function useHandoffs() {
  const [handoffs, setHandoffs] = useState<ShiftHandoffDoc[]>([]);
  const [latest, setLatest] = useState<ShiftHandoffDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setHandoffs([]); setLoading(false); return; }
    try {
      const svc = await import('../services/handoff-service');
      const list = await svc.listHandoffs(scope);
      setHandoffs(list);
      // listHandoffs is already newest-first and scope-filtered; pick the most
      // recent for the current facility (or overall when no facility scope).
      const facilityId = scope?.hospitalId;
      setLatest(facilityId ? (list.find(h => h.facilityId === facilityId) ?? null) : (list[0] ?? null));
    } catch (err) {
      console.error('Failed to load handoffs', err);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  // Live subscription — any handoff write anywhere re-renders consumers.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = handoffsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', (err) => { console.warn('Handoff subscription error:', err); });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const create = useCallback(async (
    data: Omit<ShiftHandoffDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'signedAt' | 'status'>,
  ) => {
    const { createHandoff } = await import('../services/handoff-service');
    const doc = await createHandoff(data);
    await load();
    return doc;
  }, [load]);

  const acknowledge = useCallback(async (id: string, userId: string, userName: string) => {
    const { acknowledgeHandoff } = await import('../services/handoff-service');
    const doc = await acknowledgeHandoff(id, userId, userName);
    await load();
    return doc;
  }, [load]);

  // Reverse an accidental acknowledgement — returns the handoff to 'signed'.
  const unacknowledge = useCallback(async (id: string, userId: string, userName: string) => {
    const { unacknowledgeHandoff } = await import('../services/handoff-service');
    const doc = await unacknowledgeHandoff(id, userId, userName);
    await load();
    return doc;
  }, [load]);

  return { handoffs, latest, loading, create, acknowledge, unacknowledge, reload: load };
}
