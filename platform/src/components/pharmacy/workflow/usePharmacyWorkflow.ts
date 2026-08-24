'use client';

/**
 * The counter workflow's state and its side effects: advancing one prescription
 * through the dispensing lifecycle, with every write going through `advance`
 * (or the guarded `dispense` transaction) so an illegal transition throws
 * rather than quietly corrupting the queue.
 *
 * Lives apart from the panel so the steps stay presentational, and so the same
 * actions can be driven from the chart, the queue, or a test — the same split
 * the lab bench uses in `useLabWorkflow`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/lib/context';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { getActiveAllergies } from '@/lib/services/allergy-service';
import {
  checkAllergies,
  checkInteractions,
  findDuplicateMedications,
  type InteractionCheckResult,
} from '@/lib/services/drug-interaction-service';
import type { PrescriptionDoc } from '@/lib/db-types';
import type { FefoPlan } from '@/lib/services/dispensing-service';
import {
  completedThrough,
  courseQuantity,
  isParked,
  PHARMACY_WORKFLOW_STEPS,
  stepForStage,
  type CounsellingPointKey,
  type PharmacyWorkflowStepKey,
} from './pharmacy-workflow-types';

export interface ReviewDraft {
  /** Pharmacist confirmed they read the safety panel. */
  checksAcknowledged: boolean;
  clarificationReason: string;
  clarificationNote: string;
}

export interface DispenseDraft {
  quantity: number;
  witnessId: string;
  witnessName: string;
  allowPartial: boolean;
  note: string;
  unfilledReason: string;
}

export interface CounselDraft {
  points: Record<CounsellingPointKey, boolean>;
  note: string;
}

/** What the safety panel found. Empty arrays mean "checked, nothing to say". */
export interface SafetyReport {
  allergies: string[];
  allergyAlerts: string[];
  interactions: InteractionCheckResult | null;
  duplicates: string[];
  loading: boolean;
}

export function usePharmacyWorkflow(
  rx: PrescriptionDoc,
  /** The patient's other active medicines, for interaction and duplicate checks. */
  activeMedications: string[] = [],
) {
  const { currentUser } = useApp();
  const { advance, dispense, markUnfilled } = usePrescriptions(rx.patientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stage = rx.orderStatus || 'prescribed';
  const activeStep = stepForStage(stage);
  const doneThrough = completedThrough(stage);
  const parked = isParked(stage);

  // Which step the panel is showing. Defaults to where the script actually is;
  // finished steps stay openable so the pharmacist can check what was recorded.
  const [step, setStep] = useState<PharmacyWorkflowStepKey>(activeStep);

  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({
    checksAcknowledged: doneThrough >= 2,
    clarificationReason: '',
    clarificationNote: rx.dispenseNote || '',
  });

  const [dispenseDraft, setDispenseDraft] = useState<DispenseDraft>({
    quantity: rx.quantityDispensed || courseQuantity(rx),
    witnessId: '',
    witnessName: '',
    allowPartial: false,
    note: '',
    unfilledReason: '',
  });

  const [counselDraft, setCounselDraft] = useState<CounselDraft>({
    points: { howToTake: false, duration: false, sideEffects: false, storage: false, adherence: false },
    note: '',
  });

  // ── Safety review ─────────────────────────────────────────────────────────
  // Runs against the patient's recorded allergies and their other active
  // medicines. The lab's equivalent is the critical-value verdict: computed
  // for the pharmacist to read, never auto-actioned.
  const [safety, setSafety] = useState<SafetyReport>({
    allergies: [], allergyAlerts: [], interactions: null, duplicates: [], loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await getActiveAllergies(rx.patientId);
        const allergens = entries.map(a => a.substance).filter(Boolean);
        const withNew = [...activeMedications, rx.medication];
        if (cancelled) return;
        setSafety({
          allergies: allergens,
          // The alert carries the matched pair and how it matched; the panel
          // needs one readable line per hit, not the raw shape.
          allergyAlerts: checkAllergies([rx.medication], allergens)
            .map(a => a.reason === 'class'
              ? `${a.medication} — same drug class as ${a.allergy}`
              : `${a.medication} — recorded allergy: ${a.allergy}`),
          interactions: checkInteractions(withNew),
          duplicates: findDuplicateMedications(withNew),
          loading: false,
        });
      } catch (err) {
        console.error('[pharmacy-workflow] safety check failed; review by hand', err);
        if (!cancelled) setSafety(s => ({ ...s, loading: false }));
      }
    })();
    return () => { cancelled = true; };
    // activeMedications is a fresh array each render at most call sites; key on
    // its content so the check does not re-run on every parent render.
  }, [rx.patientId, rx.medication, activeMedications.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Anything the pharmacist must look at before clearing. */
  const hasSafetySignal = useMemo(
    () => safety.allergyAlerts.length > 0
      || safety.duplicates.length > 0
      || (safety.interactions?.interactions?.length ?? 0) > 0,
    [safety],
  );

  // ── Stock position ────────────────────────────────────────────────────────
  // The FEFO plan for the quantity being dispensed, computed without writing
  // anything, so the counter can see the shortfall before committing.
  const [stock, setStock] = useState<{ plan: FefoPlan | null; loading: boolean }>({ plan: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getDispensableBatches, planFefoAllocation } = await import('@/lib/services/dispensing-service');
        const batches = await getDispensableBatches(rx.medication, currentUser?.hospitalId);
        if (cancelled) return;
        setStock({ plan: planFefoAllocation(batches, dispenseDraft.quantity), loading: false });
      } catch (err) {
        console.error('[pharmacy-workflow] stock lookup failed', err);
        if (!cancelled) setStock({ plan: null, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, [rx.medication, currentUser?.hospitalId, dispenseDraft.quantity]);

  /** True when the shelf cannot cover the quantity being handed over. */
  const short = (stock.plan?.shortfall ?? 0) > 0;
  /** A controlled batch in the allocation needs a second signature. */
  const needsWitness = useMemo(
    () => (stock.plan?.allocations || []).some(a => !!a.batch.controlledSchedule),
    [stock.plan],
  );

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      console.error('[pharmacy-workflow]', err);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Take the script onto the pharmacy queue. */
  const receive = useCallback(() => run(async () => {
    await advance(rx._id, 'received_in_pharmacy_queue');
    setStep('review');
  }), [advance, rx._id, run]);

  /**
   * Clear for dispensing. Two hops, because `under_review` is a real state a
   * script can sit in while the pharmacist reads the safety panel — going
   * straight from the queue to cleared would skip the transition the lifecycle
   * guard enforces.
   */
  const clear = useCallback(() => run(async () => {
    if (!reviewDraft.checksAcknowledged) throw new Error('rxFlow.errChecksUnread');
    if (stage === 'received_in_pharmacy_queue') await advance(rx._id, 'under_review');
    await advance(rx._id, 'cleared_for_dispensing');
    setStep('dispense');
  }), [advance, reviewDraft.checksAcknowledged, rx._id, run, stage]);

  /** Send it back to the prescriber with a stated question. */
  const hold = useCallback(() => run(async () => {
    if (!reviewDraft.clarificationReason) throw new Error('rxFlow.errHoldReason');
    if (stage === 'received_in_pharmacy_queue') await advance(rx._id, 'under_review');
    await markUnfilled(
      rx,
      'clarification_requested',
      [reviewDraft.clarificationReason, reviewDraft.clarificationNote.trim()].filter(Boolean).join(' — '),
      { id: currentUser?._id || 'pharmacy', name: currentUser?.name || 'Pharmacy' },
    );
  }), [advance, currentUser, markUnfilled, reviewDraft, rx, run, stage]);

  /**
   * Hand the medicine over. Goes through the guarded transaction — stock gate,
   * FEFO decrement, controlled register, prescription update — so a dispense
   * that cannot legally complete fails before any stock moves.
   */
  const dispenseNow = useCallback(() => run(async () => {
    if (dispenseDraft.quantity <= 0) throw new Error('rxFlow.errQuantity');
    if (short && !dispenseDraft.allowPartial) throw new Error('rxFlow.errShortStock');
    if (needsWitness && !dispenseDraft.witnessId) throw new Error('rxFlow.errWitness');
    // The transaction throws on a refused dispense (stock gate, missing
    // witness, unauthorised actor) — there is no failure return to inspect,
    // and `run` turns the throw into the panel's error line.
    await dispense({
      prescription: rx,
      quantity: dispenseDraft.quantity,
      dispenserId: currentUser?._id || 'pharmacy',
      dispenserName: currentUser?.name || 'Pharmacy',
      dispenserRole: currentUser?.role,
      facilityId: rx.hospitalId || currentUser?.hospitalId || '',
      facilityName: currentUser?.hospitalName,
      orgId: currentUser?.orgId || rx.orgId,
      witnessId: dispenseDraft.witnessId || undefined,
      witnessName: dispenseDraft.witnessName || undefined,
      allowPartial: dispenseDraft.allowPartial,
      note: dispenseDraft.note.trim() || undefined,
    });
    setStep('counsel');
  }), [currentUser, dispense, dispenseDraft, needsWitness, rx, run, short]);

  /** Record that the shelf could not cover it — the script stays active. */
  const recordStockOut = useCallback(() => run(async () => {
    if (!dispenseDraft.unfilledReason) throw new Error('rxFlow.errUnfilledReason');
    await markUnfilled(
      rx,
      'stock_out',
      [dispenseDraft.unfilledReason, dispenseDraft.note.trim()].filter(Boolean).join(' — '),
      { id: currentUser?._id || 'pharmacy', name: currentUser?.name || 'Pharmacy' },
    );
  }), [currentUser, dispenseDraft, markUnfilled, rx, run]);

  /** Counselling given. */
  const counsel = useCallback(() => run(async () => {
    const covered = Object.values(counselDraft.points).filter(Boolean).length;
    if (!covered) throw new Error('rxFlow.errCounselPoints');
    await advance(rx._id, 'counseled', {
      counselledAt: new Date().toISOString(),
      counselledBy: currentUser?.name || 'Pharmacy',
      counselledPoints: Object.entries(counselDraft.points).filter(([, on]) => on).map(([key]) => key),
      counsellingNote: counselDraft.note.trim(),
    });
    setStep('close');
  }), [advance, counselDraft, currentUser, rx._id, run]);

  /** Close the script out. */
  const complete = useCallback(() => run(async () => {
    await advance(rx._id, 'complete');
  }), [advance, rx._id, run]);

  /** Put a dispensed medicine back under review — a recall, not a deletion. */
  const recall = useCallback(() => run(async () => {
    if (!dispenseDraft.note.trim()) throw new Error('rxFlow.errRecallReason');
    await advance(rx._id, 'dispensing_error_recalled', {
      dispenseNote: dispenseDraft.note.trim(),
    });
    setStep('review');
  }), [advance, dispenseDraft.note, rx._id, run]);

  /** Bring a parked script back onto the queue. */
  const resume = useCallback(() => run(async () => {
    await advance(rx._id, 'received_in_pharmacy_queue');
    setStep('review');
  }), [advance, rx._id, run]);

  return {
    stage,
    parked,
    step,
    setStep,
    activeStep,
    doneThrough,
    steps: PHARMACY_WORKFLOW_STEPS,
    busy,
    error,
    safety, hasSafetySignal,
    stock, short, needsWitness,
    reviewDraft, setReviewDraft,
    dispenseDraft, setDispenseDraft,
    counselDraft, setCounselDraft,
    receive, clear, hold, dispenseNow, recordStockOut, counsel, complete, recall, resume,
  };
}

export type PharmacyWorkflowController = ReturnType<typeof usePharmacyWorkflow>;
