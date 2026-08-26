'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context';
import { getOnboardingPlan, allStepIds, type OnboardingPlan } from '../onboarding/steps';
import { loadOnboardingState, saveOnboardingState } from '../onboarding/store';
import type { OnboardingState } from '../db-types';

export interface UseOnboarding {
  /** True once the persisted state has loaded for the current user. */
  ready: boolean;
  /** The role-specific plan (sections + steps + resources). */
  plan: OnboardingPlan | null;
  completedStepIds: Set<string>;
  totalSteps: number;
  completedCount: number;
  percent: number;
  /** Every step done. */
  allDone: boolean;
  /** The user finished or skipped — onboarding should not surface anymore. */
  finished: boolean;
  collapsed: boolean;
  /** Mark a step complete (idempotent) and persist. */
  completeStep: (id: string) => void;
  /** Toggle a step's completion and persist. */
  toggleStep: (id: string) => void;
  /** Minimise / restore the panel. */
  setCollapsed: (v: boolean) => void;
  /** Skip setup for good. */
  dismiss: () => void;
  /** Record completion for good (used by the "Finish" success action). */
  finish: () => void;
}

export function useOnboarding(): UseOnboarding {
  const { currentUser } = useAuth();
  const userId = currentUser?._id ?? null;
  const role = currentUser?.role ?? null;

  const plan = useMemo(() => (role ? getOnboardingPlan(role) : null), [role]);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setState(null);
      setReady(false);
      return;
    }
    setReady(false);
    loadOnboardingState(userId).then(s => {
      if (!cancelled) {
        setState(s);
        setReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [userId]);

  const completedStepIds = useMemo(
    () => new Set(state?.completedStepIds ?? []),
    [state],
  );

  const totalSteps = plan ? allStepIds(plan).length : 0;
  const completedCount = plan
    ? allStepIds(plan).filter(id => completedStepIds.has(id)).length
    : 0;
  const percent = totalSteps === 0 ? 0 : Math.round((completedCount / totalSteps) * 100);
  const allDone = totalSteps > 0 && completedCount >= totalSteps;
  const finished = Boolean(state?.completedAt || state?.dismissedAt);

  // Persist a patch and update local state optimistically.
  const persist = useCallback(
    (patch: Partial<OnboardingState>) => {
      if (!userId) return;
      setState(prev => ({ ...(prev ?? { completedStepIds: [] }), ...patch }));
      saveOnboardingState(userId, patch).then(setState);
    },
    [userId],
  );

  const completeStep = useCallback(
    (id: string) => {
      if (completedStepIds.has(id)) return;
      persist({ completedStepIds: [...completedStepIds, id] });
    },
    [completedStepIds, persist],
  );

  const toggleStep = useCallback(
    (id: string) => {
      const next = new Set(completedStepIds);
      if (next.has(id)) next.delete(id); else next.add(id);
      persist({ completedStepIds: [...next] });
    },
    [completedStepIds, persist],
  );

  const setCollapsed = useCallback((v: boolean) => persist({ collapsed: v }), [persist]);
  const dismiss = useCallback(() => persist({ dismissedAt: new Date().toISOString() }), [persist]);
  const finish = useCallback(() => persist({ completedAt: new Date().toISOString() }), [persist]);

  return {
    ready,
    plan,
    completedStepIds,
    totalSteps,
    completedCount,
    percent,
    allDone,
    finished,
    collapsed: Boolean(state?.collapsed),
    completeStep,
    toggleStep,
    setCollapsed,
    dismiss,
    finish,
  };
}
