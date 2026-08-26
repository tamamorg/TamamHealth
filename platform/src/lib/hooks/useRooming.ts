'use client';

import { useState, useEffect, useCallback } from 'react';
import { makeCoalescer } from './live-reload';
import { encountersDB } from '../db';
import { useDataScope } from './useDataScope';
import type { RoomingWorklistEntry } from '../services/rooming-service';

/**
 * The rooming station's worklist (KAN-99).
 *
 * Subscribes to the encounters database rather than polling: rooming sits
 * between triage and the clinician, so its queue changes because someone at
 * ANOTHER station acted. A nurse watching a stale list would keep working
 * patients the clinic has already pulled forward.
 */
export function useRooming() {
  const [entries, setEntries] = useState<RoomingWorklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setEntries([]); setLoading(false); return; }
    try {
      setError(null);
      const svc = await import('../services/rooming-service');
      setEntries(await svc.getRoomingWorklist(scope));
    } catch (err) {
      console.error(err);
      setError('Failed to load the rooming worklist');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) load(); });
    const changes = encountersDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', (err) => { console.warn('Rooming subscription error:', err); });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [load]);

  const markArrived = useCallback(async (encounterId: string, actorId?: string) => {
    const svc = await import('../services/rooming-service');
    const doc = await svc.markArrivedAtClinic(encounterId, { actorId });
    await load();
    return doc;
  }, [load]);

  const assignRoom = useCallback(async (
    encounterId: string, room: string, actor: { actorId?: string; actorName?: string } = {},
  ) => {
    const svc = await import('../services/rooming-service');
    const doc = await svc.assignRoom(encounterId, room, actor);
    await load();
    return doc;
  }, [load]);

  const transferClinic = useCallback(async (
    encounterId: string, clinic: string, actor: { actorId?: string; actorName?: string } = {},
  ) => {
    const svc = await import('../services/rooming-service');
    const doc = await svc.setDestinationClinic(encounterId, clinic, actor);
    await load();
    return doc;
  }, [load]);

  const markReady = useCallback(async (
    encounterId: string, actor: { actorId?: string; actorName?: string } = {},
  ) => {
    const svc = await import('../services/rooming-service');
    const doc = await svc.markReadyForClinician(encounterId, actor);
    await load();
    return doc;
  }, [load]);

  const recordVitals = useCallback(async (
    input: import('../services/medical-record-service').NursingVitalsInput,
  ) => {
    const svc = await import('../services/rooming-service');
    const doc = await svc.recordRoomingVitals(input);
    await load();
    return doc;
  }, [load]);

  return { entries, loading, error, markArrived, assignRoom, transferClinic, markReady, recordVitals, reload: load };
}
