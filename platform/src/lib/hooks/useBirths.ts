'use client';

import { useTranslation } from '../i18n/useTranslation';
import { useState, useCallback } from 'react';
import { usePouchLiveReload } from './usePouchLiveReload';
import type { BirthRegistrationDoc } from '../db-types';
import { birthsDB } from '../db';
import { useDataScope } from './useDataScope';

export function useBirths() {
  const [births, setBirths] = useState<BirthRegistrationDoc[]>([]);
  /** Voided registrations: kept for the register's "Show voided" view, counted nowhere. */
  const [voidedBirths, setVoidedBirths] = useState<BirthRegistrationDoc[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof import('../services/birth-service').getBirthStats>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  const scope = useDataScope();

  const load = useCallback(async () => {
    if (!scope) { setBirths([]); setVoidedBirths([]); setLoading(false); return; }
    try {
      setError(null);
      const { getAllBirths, getBirthStats } = await import('../services/birth-service');
      const [data, s] = await Promise.all([getAllBirths(scope, { includeVoided: true }), getBirthStats(scope)]);
      setBirths(data.filter(r => !r.voidedAt));
      setVoidedBirths(data.filter(r => r.voidedAt));
      setStats(s);
    } catch (err) {
      console.error('Failed to load births', err);
      setError('msg.birthRecordsNotLoaded');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  usePouchLiveReload({ load, database: birthsDB });

  const register = useCallback(async (data: Omit<BirthRegistrationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createBirth } = await import('../services/birth-service');
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    const doc = await createBirth(data, scope);
    await load();
    return doc;
  }, [load, scope]);

  /** Correct a registered birth. Only a record already in this caller's scope can be changed; the notification number never moves. */
  const correct = useCallback(async (id: string, patch: Partial<BirthRegistrationDoc>) => {
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    if (!births.some(b => b._id === id)) throw new Error('This birth record is not available to your account.');
    const { updateBirth } = await import('../services/birth-service');
    const { certificateNumber: _keep, _id: _i, _rev: _r, type: _t, orgId: _o, ...safe } = patch;
    void _keep; void _i; void _r; void _t; void _o;
    const saved = await updateBirth(id, safe);
    if (!saved) throw new Error('Birth record not updated.');
    await load();
    return saved;
  }, [load, scope, births]);

  /** Strike a record out (entered in error / duplicate). Only a record in this caller's scope. */
  const voidRecord = useCallback(async (id: string, reason: string, actor: { userId?: string; userName: string }) => {
    if (!scope) throw new Error('Your account details are still loading. Wait a moment, then try again.');
    if (![...births, ...voidedBirths].some(r => r._id === id)) throw new Error('This birth record is not available to your account.');
    const { voidBirth } = await import('../services/birth-service');
    const saved = await voidBirth(id, reason, actor);
    if (!saved) throw new Error('Birth record not voided.');
    await load();
    return saved;
  }, [load, scope, births, voidedBirths]);

  return { births, voidedBirths, stats, loading, error: error && t(error), register, correct, voidRecord, reload: load };
}
