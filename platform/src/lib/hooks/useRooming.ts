'use client';

import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
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
      setError('Rooming worklist not loaded. Reload the page to try again.');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload({ load, database: encountersDB, onError: err => console.warn('Rooming subscription error:', err) });

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
