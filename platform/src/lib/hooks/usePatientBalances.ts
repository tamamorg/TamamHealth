'use client';

/**
 * usePatientBalances - the one fail-closed gate on a patient's financial
 * clearance, shared by every pharmacy surface that decides whether a
 * medication can be handed over.
 *
 * Before this hook, three surfaces (the clinician dashboard's dispense
 * modal, the pharmacist worklist, and the pharmacy dashboard's Patients
 * panel) each grew their own copy of "fetch the ledger balance, treat it as
 * cleared". Two of the three defaulted to a fabricated `balance = 0` while
 * the real fetch was in flight or had failed - and `isFinanciallyCleared(0)`
 * is true, so an in-flight or broken ledger read waved a patient who
 * actually owed money straight through the payment gate. A per-surface fix
 * is not durable; the bug just grows a fourth copy next time someone adds a
 * dispensing surface. This hook is the single place that logic lives.
 *
 * `status` starts at `'unknown'` (not `'loading'`) so a caller that renders
 * before the effect has even had a chance to mark ids `'loading'` still
 * fails closed rather than reading as vacuously true.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { isFinanciallyCleared } from '../pharmacy-workflow';
import { useDataScope } from './useDataScope';

export type PatientBalanceStatus = 'unknown' | 'loading' | 'ready' | 'error';

export interface PatientBalanceState {
  balance: number;
  status: PatientBalanceStatus;
}

export type ConfirmClearedResult =
  | { cleared: true; balance: number }
  | { cleared: false; reason: 'unavailable' }
  | { cleared: false; reason: 'outstanding'; balance: number };

const EMPTY_STATE: PatientBalanceState = { balance: 0, status: 'unknown' };

export interface UsePatientBalancesResult {
  /** Best-known balance for display. Not a clearance signal on its own -
   *  use isClearedFor for that; this is for showing "KES 400 outstanding". */
  balanceFor(patientId: string | undefined | null): number;
  /** The state (balance + fetch status) backing balanceFor, for callers that
   *  need to distinguish loading/error/unknown for their own messaging. */
  stateFor(patientId: string | undefined | null): PatientBalanceState;
  /** True only once a real ledger read has landed for this patient.
   *  'loading', 'error' and an absent/empty id all read as unknown. */
  isKnownFor(patientId: string | undefined | null): boolean;
  /** The actual payment gate: fails closed. An unknown balance is never
   *  "cleared", however isFinanciallyCleared(undefined ?? 0) would read it. */
  isClearedFor(patientId: string | undefined | null): boolean;
  /**
   * A live re-read of the ledger, immediately before a write that depends on
   * the answer (i.e. the dispense transaction itself). The cached map is
   * kept in sync with whatever this finds, so a subsequent isClearedFor call
   * (or a later render) reflects it too.
   *
   * This is what makes the gate un-reimplementable-wrongly: a caller cannot
   * accidentally dispense against a stale isClearedFor from a few renders
   * ago, because the write path is required to go through this and check
   * the result instead.
   */
  confirmCleared(patientId: string): Promise<ConfirmClearedResult>;
}

const SEPARATOR = String.fromCharCode(32);

/**
 * Fetches and fail-closed-gates ledger balances for a set of patient ids.
 * Pass one id (the dispense modal) or many (a pharmacy queue page) - the
 * loader, cache and gate logic are identical either way.
 */
export function usePatientBalances(patientIds: Array<string | undefined | null>): UsePatientBalancesResult {
  const [balances, setBalances] = useState<Map<string, PatientBalanceState>>(new Map());
  const scope = useDataScope();

  // Stable across renders that pass a new-array-same-contents `patientIds` -
  // the effect below must only re-run when the actual set of ids changes,
  // not on every parent re-render.
  const idsKey = useMemo(
    () => Array.from(new Set(patientIds.filter((id): id is string => !!id))).sort().join(SEPARATOR),
    [patientIds],
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split(SEPARATOR) : [];
    if (ids.length === 0 || !scope) {
      setBalances(new Map());
      return;
    }
    let cancelled = false;

    // Mark every id 'loading' up front (keeping any previously-known balance
    // around for display) so isKnownFor reads false - not a stale 'ready' -
    // for the whole time this fetch is in flight. Without this, a component
    // that re-renders mid-refetch would trust the balance from the last
    // successful fetch as still current.
    setBalances(prev => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, { balance: next.get(id)?.balance ?? 0, status: 'loading' });
      return next;
    });

    (async () => {
      try {
        // The dynamic import is inside the try: a chunk-load failure (e.g. a
        // stale service worker after a deploy) must land ids in 'error', not
        // throw out of the effect and leave them stuck on 'loading' forever.
        const { getPatientBalance } = await import('../services/ledger-service');
        // Settled per patient (not one Promise.all) so one patient's ledger
        // hiccup can't wipe out every other patient's already-known balance.
        const results = await Promise.allSettled(ids.map(id => getPatientBalance(id, scope)));
        if (cancelled) return;
        setBalances(prev => {
          const next = new Map(prev);
          results.forEach((r, i) => {
            const id = ids[i];
            if (r.status === 'fulfilled') next.set(id, { balance: r.value, status: 'ready' });
            else next.set(id, { balance: next.get(id)?.balance ?? 0, status: 'error' });
          });
          return next;
        });
      } catch {
        if (cancelled) return;
        setBalances(prev => {
          const next = new Map(prev);
          for (const id of ids) next.set(id, { balance: next.get(id)?.balance ?? 0, status: 'error' });
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [idsKey, scope]);

  const stateFor = useCallback(
    (patientId: string | undefined | null): PatientBalanceState =>
      (patientId ? balances.get(patientId) : undefined) ?? EMPTY_STATE,
    [balances],
  );

  const balanceFor = useCallback(
    (patientId: string | undefined | null): number => stateFor(patientId).balance,
    [stateFor],
  );

  const isKnownFor = useCallback(
    (patientId: string | undefined | null): boolean => stateFor(patientId).status === 'ready',
    [stateFor],
  );

  const isClearedFor = useCallback(
    (patientId: string | undefined | null): boolean =>
      isKnownFor(patientId) && isFinanciallyCleared(balanceFor(patientId)),
    [isKnownFor, balanceFor],
  );

  const confirmCleared = useCallback(async (patientId: string): Promise<ConfirmClearedResult> => {
    if (!patientId || !scope) return { cleared: false, reason: 'unavailable' };
    try {
      const { getPatientBalance } = await import('../services/ledger-service');
      const balance = await getPatientBalance(patientId, scope);
      setBalances(prev => {
        const next = new Map(prev);
        next.set(patientId, { balance, status: 'ready' });
        return next;
      });
      if (!isFinanciallyCleared(balance)) return { cleared: false, reason: 'outstanding', balance };
      return { cleared: true, balance };
    } catch {
      // Do not touch the cached state on failure - leave whatever was there
      // (possibly already 'error' from the background loader) rather than
      // clobbering a good cached read with a transient failure.
      return { cleared: false, reason: 'unavailable' };
    }
  }, [scope]);

  return { balanceFor, stateFor, isKnownFor, isClearedFor, confirmCleared };
}
