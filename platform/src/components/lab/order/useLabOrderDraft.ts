'use client';

/**
 * The Create Lab Order draft: state, per-step validation, and the single
 * submit path.
 *
 * All the order-placing side effects live here rather than in the lab page —
 * open the desk encounter, write one LabResultDoc per test, bill the tests,
 * write the audit line — so the wizard's step components stay presentational
 * and the same flow can be mounted from anywhere (lab queue today, patient
 * chart next) without copying 130 lines of submit logic with it.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/lib/context';
import { usePatients } from '@/lib/hooks/usePatients';
import { patientAge } from '@/lib/patient-utils';
import { withTimeout, CLINICAL_WRITE_TIMEOUT_MS } from '@/lib/write-timeout';
import { aoeSchedule } from './lab-order-aoe';
import { placeLabOrder } from './place-lab-order';
import {
  aoeKey,
  emptyLabOrderDraft,
  type LabOrderDraft,
  type LabOrderReceipt,
  type LabOrderStepKey,
  type OrderIndication,
  type OrderedTest,
} from './lab-order-types';

export function useLabOrderDraft(options: {
  presetPatientId?: string;
  /** Reasons already known where the order was opened (a note's coded
   *  diagnoses). They start on the order; the clinician can remove any. */
  presetIndications?: OrderIndication[];
  /** Complaint text from the opener, used for the reason suggestions. */
  contextText?: string;
} = {}) {
  const { currentUser } = useAuth();
  const { patients } = usePatients();
  const [draft, setDraft] = useState<LabOrderDraft>(() => ({
    ...emptyLabOrderDraft(currentUser?.name || ''),
    patientId: options.presetPatientId || '',
    indications: options.presetIndications || [],
  }));
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<LabOrderReceipt | null>(null);

  const patient = useMemo(
    () => patients.find(p => p._id === draft.patientId) || null,
    [patients, draft.patientId],
  );

  const patientContext = useMemo(() => ({
    sex: patient?.gender,
    age: patient ? (patientAge(patient) ?? undefined) : undefined,
  }), [patient]);

  /** The AOE questions the current test selection actually asks. */
  const schedule = useMemo(
    () => aoeSchedule(draft.tests, patientContext),
    [draft.tests, patientContext],
  );

  const patch = useCallback((changes: Partial<LabOrderDraft>) => {
    setDraft(prev => ({ ...prev, ...changes }));
  }, []);

  const toggleTest = useCallback((test: OrderedTest) => {
    setDraft(prev => prev.tests.some(t => t.name === test.name)
      ? { ...prev, tests: prev.tests.filter(t => t.name !== test.name) }
      : { ...prev, tests: [...prev.tests, test] });
  }, []);

  const removeTest = useCallback((name: string) => {
    setDraft(prev => ({ ...prev, tests: prev.tests.filter(t => t.name !== name) }));
  }, []);

  const addIndication = useCallback((indication: OrderIndication) => {
    setDraft(prev => prev.indications.some(i => i.code === indication.code)
      ? prev
      : { ...prev, indications: [...prev.indications, indication] });
  }, []);

  const removeIndication = useCallback((code: string) => {
    setDraft(prev => ({ ...prev, indications: prev.indications.filter(i => i.code !== code) }));
  }, []);

  const setAoe = useCallback((testName: string, questionId: string, value: string) => {
    setDraft(prev => ({ ...prev, aoe: { ...prev.aoe, [aoeKey(testName, questionId)]: value } }));
  }, []);

  /**
   * Which required AOEs are still blank. Also what the Clinical step highlights
   * in red, so "* required" means the same thing to the form and to Next.
   */
  const missingAoe = useMemo(() => {
    const missing: { testName: string; questionId: string; label: string }[] = [];
    for (const { test, questions } of schedule) {
      for (const question of questions) {
        if (!question.required) continue;
        if ((draft.aoe[aoeKey(test.name, question.id)] || '').trim()) continue;
        missing.push({ testName: test.name, questionId: question.id, label: question.label });
      }
    }
    return missing;
  }, [schedule, draft.aoe]);

  /** Why a step cannot be left yet — empty means it is satisfied. */
  const blockersFor = useCallback((step: LabOrderStepKey): string[] => {
    switch (step) {
      case 'patient':
        return draft.patientId ? [] : ['labOrder.errPatient'];
      case 'tests':
        return draft.tests.length ? [] : ['labOrder.errTests'];
      case 'clinical':
        // In the order the step lays them out: the reason, then the AOEs.
        return [
          ...(draft.indications.length ? [] : ['labOrder.errReason']),
          ...(missingAoe.length ? ['labOrder.errAoe'] : []),
        ];
      default:
        return [];
    }
  }, [draft.patientId, draft.tests.length, draft.indications.length, missingAoe.length]);

  /** Everything up to and including `step` is satisfied. */
  const isComplete = useCallback(
    (step: LabOrderStepKey) => blockersFor(step).length === 0,
    [blockersFor],
  );

  /**
   * Place the order: one LabResultDoc per test, all sharing an order group id,
   * hung off a desk encounter so the tests are billable and attributable.
   * Returns the receipt the Complete step renders as a requisition.
   *
   * Unbounded inner path — callers go through `submit` below, which puts a
   * ceiling on the whole orchestration (see lib/write-timeout.ts).
   */
  const submitInner = useCallback(async (): Promise<LabOrderReceipt> => {
    if (!patient) throw new Error('labOrder.errPatient');
    if (!draft.tests.length) throw new Error('labOrder.errTests');
    setSubmitting(true);
    try {
      const done = await placeLabOrder({
        patient,
        currentUser,
        draft,
        // Only this test's AOE answers travel with this test's document.
        answersFor: testName => (schedule.find(entry => entry.test.name === testName)?.questions || [])
          .map(question => ({
            question: question.label,
            answer: draft.aoe[aoeKey(testName, question.id)] || '',
          }))
          .filter(entry => entry.answer.trim().length > 0),
      });
      setReceipt(done);
      return done;
    } finally {
      setSubmitting(false);
    }
  }, [currentUser, draft, patient, schedule]);

  /**
   * The submit every caller uses: the inner orchestration under a hard
   * ceiling. A local write stalled by initial-sync IndexedDB contention left
   * the wizard on "Creating…" indefinitely (2026-08 QA) — same failure mode
   * as walk-in check-in and registration. Bounding it turns the stall into a
   * rejection the wizard's existing catch surfaces (`lab.createOrderFailed`),
   * and the outer finally re-enables the button — the hung inner path never
   * reaches its own finally.
   */
  const submit = useCallback(async (): Promise<LabOrderReceipt> => {
    try {
      return await withTimeout(
        submitInner(),
        CLINICAL_WRITE_TIMEOUT_MS,
        'Placing the order timed out — the local database did not respond. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [submitInner]);

  const reset = useCallback(() => {
    setDraft({
      ...emptyLabOrderDraft(currentUser?.name || ''),
      patientId: options.presetPatientId || '',
      indications: options.presetIndications || [],
    });
    setReceipt(null);
  }, [currentUser?.name, options.presetPatientId, options.presetIndications]);

  return {
    draft,
    patch,
    patient,
    patients,
    patientContext,
    contextText: options.contextText || '',
    schedule,
    missingAoe,
    blockersFor,
    isComplete,
    toggleTest,
    removeTest,
    addIndication,
    removeIndication,
    setAoe,
    submit,
    submitting,
    receipt,
    reset,
  };
}

export type LabOrderController = ReturnType<typeof useLabOrderDraft>;
