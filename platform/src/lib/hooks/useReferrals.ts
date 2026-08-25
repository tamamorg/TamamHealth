'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { makeCoalescer } from './live-reload';
import type { ReferralDoc } from '../db-types';
import type { Attachment, ReferralOutcome } from '@/data/mock';
import { referralsDB } from '../db';
import { useApp } from '../context';
import { useDataScope } from './useDataScope';

export function useReferrals() {
  const [referrals, setReferrals] = useState<ReferralDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { currentUser } = useApp();
  const scope = useMemo(() => (
    currentUser ? { orgId: currentUser.orgId, hospitalId: currentUser.hospitalId, role: currentUser.role } : undefined
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [currentUser?.orgId, currentUser?.hospitalId, currentUser?.role]);

  const loadReferrals = useCallback(async () => {
    try {
      setError(null);
      const { getAllReferrals } = await import('../services/referral-service');
      const data = await getAllReferrals(scope);
      setReferrals(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load referrals');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    loadReferrals();
  }, [loadReferrals]);

  // Live PouchDB subscription: re-load when a referral is created, accepted,
  // or status-updated anywhere in the app. Replaces 30s polling.
  useEffect(() => {
    let cancelled = false;
    const reload = makeCoalescer(() => { if (!cancelled) loadReferrals(); });
    const changes = referralsDB().changes({ since: 'now', live: true, include_docs: false })
      .on('change', () => reload.trigger())
      .on('error', () => { /* swallow */ });
    return () => {
      cancelled = true;
      reload.cancel();
      try { changes.cancel(); } catch { /* noop */ }
    };
  }, [loadReferrals]);

  const create = useCallback(async (data: Omit<ReferralDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>) => {
    const { createReferral } = await import('../services/referral-service');
    const referral = await createReferral(data);
    await loadReferrals();
    return referral;
  }, [loadReferrals]);

  const createWithTransfer = useCallback(async (
    data: Omit<ReferralDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt' | 'transferPackage' | 'referralAttachments'>,
    referralAttachments: Attachment[],
    packagedBy: string
  ) => {
    const { createReferralWithTransfer } = await import('../services/referral-service');
    const referral = await createReferralWithTransfer(data, referralAttachments, packagedBy);
    await loadReferrals();
    return referral;
  }, [loadReferrals]);

  const updateStatus = useCallback(async (id: string, status: 'sent' | 'received' | 'seen' | 'completed' | 'cancelled') => {
    const { updateReferralStatus } = await import('../services/referral-service');
    await updateReferralStatus(id, status);
    await loadReferrals();
  }, [loadReferrals]);

  const accept = useCallback(async (id: string) => {
    const { acceptReferral } = await import('../services/referral-service');
    await acceptReferral(id);
    await loadReferrals();
  }, [loadReferrals]);

  const updateNotes = useCallback(async (id: string, notes: string) => {
    const { updateReferralNotes } = await import('../services/referral-service');
    await updateReferralNotes(id, notes);
    await loadReferrals();
  }, [loadReferrals]);

  const completeWithOutcome = useCallback(async (id: string, outcome: ReferralOutcome) => {
    const { completeReferralWithOutcome } = await import('../services/referral-service');
    await completeReferralWithOutcome(id, outcome);
    await loadReferrals();
  }, [loadReferrals]);

  return { referrals, loading, error, create, createWithTransfer, updateStatus, updateNotes, completeWithOutcome, accept, reload: loadReferrals };
}

export function usePatientReferrals(patientId?: string) {
  const [referrals, setReferrals] = useState<ReferralDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scope = useDataScope();

  const loadReferrals = useCallback(async () => {
    if (!patientId) {
      setReferrals([]);
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const { getReferralsByPatient } = await import('../services/referral-service');
      const data = await getReferralsByPatient(patientId, scope);
      setReferrals(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load patient referrals');
    } finally {
      setLoading(false);
    }
  }, [patientId, scope]);

  useEffect(() => {
    loadReferrals();
  }, [loadReferrals]);

  return { referrals, loading, error, reload: loadReferrals };
}
