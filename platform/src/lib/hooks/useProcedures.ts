'use client';

import { useTranslation } from '../i18n/useTranslation';
import { useState, useCallback, useMemo } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { ProcedureDoc } from '../db-types';
import type { ProcedureStatus } from '../clinical-flow/order-lifecycles';
import { proceduresDB } from '../db';
import { useDataScope } from './useDataScope';

export function useProcedures(patientId?: string) {
  const [allProcedures, setAllProcedures] = useState<ProcedureDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setAllProcedures([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllProcedures } = await import('../services/procedure-service');
      const all = await getAllProcedures(scope);
      setAllProcedures(all);
    } catch (err) {
      console.error(err);
      setError('msg.proceduresNotLoaded');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // Live PouchDB subscription — reflect writes arriving from sync/other tabs.
  usePouchLiveReload({ load, database: proceduresDB });

  const create = useCallback(async (data: Omit<ProcedureDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createProcedure } = await import('../services/procedure-service');
    const doc = await createProcedure(data);
    await load();
    return doc;
  }, [load]);

  const update = useCallback(async (id: string, data: Partial<ProcedureDoc>) => {
    const { updateProcedure } = await import('../services/procedure-service');
    const doc = await updateProcedure(id, data);
    await load();
    return doc;
  }, [load]);

  const amend = useCallback(async (
    id: string,
    data: Pick<Partial<ProcedureDoc>, 'name' | 'code' | 'date' | 'bodySite' | 'outcome' | 'notes'>,
    reason: string,
    actor?: { id?: string; name?: string },
  ) => {
    const { amendProcedure } = await import('../services/procedure-service');
    const doc = await amendProcedure(id, data, reason, actor);
    await load();
    return doc;
  }, [load]);

  /**
   * Move a procedure along its Stage 7 lifecycle. Distinct from `update`
   * because the service validates the move against `PROCEDURE_TRANSITIONS` and
   * throws on an illegal one — a status must never be set by a blind patch.
   */
  const advance = useCallback(async (
    id: string,
    to: ProcedureStatus,
    opts?: { actorId?: string; actorName?: string; reason?: string },
  ) => {
    const { advanceProcedure } = await import('../services/procedure-service');
    const doc = await advanceProcedure(id, to, opts);
    await load();
    return doc;
  }, [load]);

  const remove = useCallback(async (id: string, reason: string, actor?: { id?: string; name?: string }) => {
    const { deleteProcedure } = await import('../services/procedure-service');
    const ok = await deleteProcedure(id, reason, actor);
    await load();
    return ok;
  }, [load]);

  // Filtered to a single patient when caller passes a patientId; most recent first.
  const procedures = useMemo(() => {
    const list = patientId ? allProcedures.filter(p => p.patientId === patientId) : allProcedures;
    return [...list].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [allProcedures, patientId]);

  return { procedures, allProcedures, loading, error: error && t(error), create, update, amend, advance, remove, reload: load };
}
