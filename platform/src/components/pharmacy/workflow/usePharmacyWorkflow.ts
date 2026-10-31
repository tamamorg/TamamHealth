'use client';

/**
 * The fill form's state and its side effects: every write goes through `advance`
 * or the guarded `dispense` transaction, so an illegal move throws rather than
 * quietly corrupting the queue.
 *
 * Lives apart from the panel so the same actions can be driven from the chart,
 * the queue, or a test.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/context';
import { usePrescriptions } from '@/lib/hooks/usePrescriptions';
import { useDataScope } from '@/lib/hooks/useDataScope';
import { getActiveAllergies } from '@/lib/services/allergy-service';
import {
  checkAllergies,
  checkInteractions,
  findDuplicateMedications,
  type InteractionCheckResult,
} from '@/lib/services/drug-interaction-service';
import type { PrescriptionDoc } from '@/lib/db-types';
import type { FefoPlan } from '@/lib/services/dispensing-service';
import { courseQuantity } from './pharmacy-workflow-types';
import { describeError } from '@/lib/user-facing-error';
import { paymentHoldFor } from '@/lib/pharmacy-workflow';
import { formatMoney } from '@/lib/format-utils';

/** A stop the pharmacist can act on, shown as written (see describeError). */
const dispenseStop = (message: string) => Object.assign(new Error(message), { name: 'DispenseError' });
import { useTranslation } from '@/lib/i18n/useTranslation';

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
  allergyReview: string;
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
  rxFromList: PrescriptionDoc,
  /** The patient's other active medicines, for interaction and duplicate checks. */
  activeMedications: string[] = [],
) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const scope = useDataScope();
  const { prescriptions, advance, dispense, markUnfilled } = usePrescriptions(rxFromList.patientId);
  // The script as this workflow last saved it: a step must not wait for the
  // list behind the slider to catch up.
  const rx = prescriptions?.find(other => other._id === rxFromList._id) ?? rxFromList;
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  // The panel reads this right after an action resolves, before React has
  // re-rendered with the new `error`.
  const lastError = useRef<string | null>(null);
  const setError = useCallback((message: string | null) => {
    lastError.current = message;
    setErrorState(message);
  }, []);

  const stage = rx.orderStatus || 'prescribed';

  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({
    checksAcknowledged: false,
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
    allergyReview: '',
  });

  // ── Safety review ─────────────────────────────────────────────────────────
  // Runs against the patient's recorded allergies and their other active
  // medicines. The lab's equivalent is the critical-value verdict: computed
  // for the pharmacist to read, never auto-actioned.
  const [safety, setSafety] = useState<SafetyReport>({
    allergies: [], allergyAlerts: [], interactions: null, duplicates: [], loading: true,
  });

  useEffect(() => {
    // No scope yet (pre-hydration): stay in the loading state rather than
    // reading allergies unscoped; the effect re-runs when the scope arrives.
    if (!scope) return;
    let cancelled = false;
    (async () => {
      try {
        const entries = await getActiveAllergies(rx.patientId, scope);
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
  }, [rx.patientId, rx.medication, scope, activeMedications.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setError(describeError(err, t('msg.changeNotSavedTryAgain')));
      return false;
    } finally {
      setBusy(false);
    }
  }, [setError, t]);

  /** Send it back to the prescriber with a stated question. */
  const hold = useCallback(() => run(async () => {
    if (!reviewDraft.clarificationReason) throw new Error('rxFlow.errHoldReason');
    if (stage === 'prescribed') await advance(rx._id, 'received_in_pharmacy_queue');
    if (stage === 'prescribed' || stage === 'received_in_pharmacy_queue') await advance(rx._id, 'under_review');
    await markUnfilled(
      rx,
      'clarification_requested',
      [reviewDraft.clarificationReason, reviewDraft.clarificationNote.trim()].filter(Boolean).join(' — '),
      { id: currentUser?._id || 'pharmacy', name: currentUser?.name || 'Pharmacy' },
    );
  }), [advance, currentUser, markUnfilled, reviewDraft, rx, run, stage]);

  /**
   * Fill it and give it out, in one press. Everything that can stop the dispense
   * is checked first, so a refused fill leaves the script where it was; then the
   * lifecycle's own hops (queue, cleared) are made here, and the medicine goes
   * through the guarded transaction — stock gate, FEFO decrement, controlled
   * register, prescription update — which fails before any stock moves. A fill
   * ends at `dispensed`: nothing here claims counselling that was not recorded.
   */
  const fill = useCallback(() => run(async () => {
    if (hasSafetySignal && !reviewDraft.checksAcknowledged) throw new Error('rxFlow.errChecksUnread');
    if (dispenseDraft.quantity <= 0) throw new Error('rxFlow.errQuantity');
    if (short && !dispenseDraft.allowPartial) throw new Error('rxFlow.errShortStock');
    if (needsWitness && !dispenseDraft.witnessId) throw new Error('rxFlow.errWitness');
    // Payment before dispensing, as the pharmacy dashboard enforced it before
    // the station rewrite dropped that page (rule: paymentHoldFor — Tier 1 is
    // never held, an unread balance is never treated as paid).
    let balance: number | null = null;
    try {
      if (scope) {
        const { getPatientBalance } = await import('@/lib/services/ledger-service');
        balance = await getPatientBalance(rx.patientId, scope);
      }
    } catch { balance = null; }
    const hold = paymentHoldFor(rx, balance);
    if (hold === 'unknown') throw dispenseStop(t('msg.sBalanceCouldNotBe', { patientName: rx.patientName }));
    if (hold === 'due') {
      throw dispenseStop(t('rxFlow.errBalanceDue', { medication: rx.medication, amount: formatMoney(balance ?? 0), patientName: rx.patientName }));
    }
    // The dispense is checked against the script it is handed, so it gets the
    // record these hops just wrote, not the copy this form opened with.
    let current: PrescriptionDoc = rx;
    if (stage === 'prescribed' || stage === 'dispensing_error_recalled') current = await advance(rx._id, 'received_in_pharmacy_queue') ?? current;
    if (stage !== 'cleared_for_dispensing') current = await advance(rx._id, 'cleared_for_dispensing') ?? current;
    // The transaction throws on a refused dispense (stock gate, missing
    // witness, unauthorised actor) — there is no failure return to inspect,
    // and `run` turns the throw into the panel's error line.
    await dispense({
      prescription: current,
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
      allergyReview: dispenseDraft.allergyReview.trim() || undefined,
    });
  }), [advance, currentUser, dispense, dispenseDraft, hasSafetySignal, needsWitness, reviewDraft.checksAcknowledged, rx, run, scope, short, stage, t]);

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

  /** Put a dispensed medicine back under review — a recall, not a deletion. */
  const recall = useCallback(() => run(async () => {
    if (!dispenseDraft.note.trim()) throw new Error('rxFlow.errRecallReason');
    await advance(rx._id, 'dispensing_error_recalled', {
      dispenseNote: dispenseDraft.note.trim(),
    });
  }), [advance, dispenseDraft.note, rx._id, run]);

  return {
    rx,
    stage,
    busy,
    error,
    lastError,
    safety, hasSafetySignal,
    stock, short, needsWitness,
    reviewDraft, setReviewDraft,
    dispenseDraft, setDispenseDraft,
    fill, hold, recordStockOut, recall,
  };
}

export type PharmacyWorkflowController = ReturnType<typeof usePharmacyWorkflow>;
