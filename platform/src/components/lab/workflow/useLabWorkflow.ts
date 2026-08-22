'use client';

/**
 * The bench workflow's state and its side effects: advancing one order through
 * the diagnostics lifecycle, with every write going through `advanceLabOrder`
 * so an illegal transition throws rather than quietly corrupting the queue.
 *
 * Lives apart from the panel so the steps stay presentational, and so the same
 * actions can be driven from the chart, the queue, or a test.
 */

import { useCallback, useMemo, useState } from 'react';
import { useApp } from '@/lib/context';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { evaluateCritical } from '@/lib/services/lab-critical-flag';
import { effectiveOrderStatus } from '@/lib/services/lab-service';
import type { LabResultDoc } from '@/lib/db-types';
import {
  completedThrough,
  fallbackAccessionNumber,
  LAB_WORKFLOW_STEPS,
  stepForStage,
  type LabWorkflowStepKey,
} from './lab-workflow-types';

export interface CollectDraft {
  container: string;
  collectedBy: string;
  note: string;
}

export interface ReceiveDraft {
  accessionNumber: string;
  condition: NonNullable<LabResultDoc['specimenCondition']>;
  rejectionReason: string;
  rejectionNotes: string;
}

export interface ResultDraft {
  result: string;
  unit: string;
  referenceRange: string;
  abnormal: boolean;
  critical: boolean;
  /** Once the tech overrides the critical flag by hand, stop deriving it. */
  criticalManual: boolean;
}

export function useLabWorkflow(
  order: LabResultDoc,
  /** A reading imported from an analyzer, offered for review rather than saved. */
  seedResult?: { value: string; unit: string; referenceRange: string },
) {
  const { currentUser } = useApp();
  const { advance, update } = useLabResults(order.patientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Why a already-reported value is being corrected. Required to amend. */
  const [amendReason, setAmendReason] = useState('');

  const stage = effectiveOrderStatus(order);
  const activeStep = stepForStage(stage);
  const doneThrough = completedThrough(stage);

  // Which step the panel is showing. Defaults to where the order actually is;
  // finished steps stay openable so the tech can check what was recorded.
  const [step, setStep] = useState<LabWorkflowStepKey>(activeStep);

  const [collectDraft, setCollectDraft] = useState<CollectDraft>({
    container: order.specimenContainer || '',
    collectedBy: order.specimenCollectedBy || currentUser?.name || '',
    note: '',
  });

  const [receiveDraft, setReceiveDraft] = useState<ReceiveDraft>({
    accessionNumber: fallbackAccessionNumber(order),
    condition: order.specimenCondition || 'acceptable',
    rejectionReason: '',
    rejectionNotes: '',
  });

  const [resultDraft, setResultDraft] = useState<ResultDraft>(() => {
    const value = seedResult?.value || order.result || '';
    const seededCritical = seedResult?.value
      ? evaluateCritical(order.testName, seedResult.value).isCriticalValue
      : !!order.critical;
    return {
      result: value,
      unit: seedResult?.unit || order.unit || '',
      referenceRange: seedResult?.referenceRange || order.referenceRange || '',
      abnormal: !!order.abnormal || seededCritical,
      critical: seededCritical,
      criticalManual: !seedResult?.value && !!order.critical,
    };
  });

  /** Live QC verdict for the value being typed. */
  const criticalVerdict = useMemo(
    () => evaluateCritical(order.testName, resultDraft.result),
    [order.testName, resultDraft.result],
  );

  /** Typing a value re-derives the critical flag until the tech overrides it. */
  const setResultValue = useCallback((value: string) => {
    setResultDraft(prev => {
      const verdict = evaluateCritical(order.testName, value);
      const critical = prev.criticalManual ? prev.critical : verdict.isCriticalValue;
      return {
        ...prev,
        result: value,
        critical,
        abnormal: prev.abnormal || (critical && !prev.criticalManual),
      };
    });
  }, [order.testName]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      console.error('[lab-workflow]', err);
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const collect = useCallback(() => run(async () => {
    await advance(order._id, 'specimen_collected', {
      specimenCollectedAt: new Date().toISOString(),
      specimenCollectedBy: collectDraft.collectedBy || currentUser?.name || 'Lab',
      specimenContainer: collectDraft.container,
      accessionNumber: order.accessionNumber || fallbackAccessionNumber(order),
      // Re-collection clears the previous rejection so the row stops reading as
      // rejected once a fresh specimen is in hand.
      specimenRejectionReason: '',
      specimenRejectionNotes: '',
    });
    setStep('receive');
  }), [advance, collectDraft, currentUser, order, run]);

  const receive = useCallback(() => run(async () => {
    await advance(order._id, 'received_at_lab', {
      accessionNumber: receiveDraft.accessionNumber.trim(),
      specimenCondition: receiveDraft.condition,
      specimenReceivedAt: new Date().toISOString(),
      specimenReceivedBy: currentUser?.name || 'Lab',
    });
    setStep('process');
  }), [advance, currentUser, order._id, receiveDraft, run]);

  const reject = useCallback(() => run(async () => {
    if (!receiveDraft.rejectionReason) throw new Error('labFlow.errRejectReason');
    await advance(order._id, 'rejected_needs_recollection', {
      specimenCondition: 'other',
      specimenRejectionReason: receiveDraft.rejectionReason,
      specimenRejectionNotes: receiveDraft.rejectionNotes.trim(),
      specimenRejectedAt: new Date().toISOString(),
      specimenRejectedBy: currentUser?.name || 'Lab',
    });
    setStep('collect');
  }), [advance, currentUser, order._id, receiveDraft, run]);

  const startProcessing = useCallback(() => run(async () => {
    await advance(order._id, 'in_process');
    setStep('result');
  }), [advance, order._id, run]);

  /**
   * File the result. Critical values also page the ordering clinician —
   * best-effort, because a saved result the lab can phone through beats a
   * blocked save.
   */
  const fileResult = useCallback(() => run(async () => {
    if (!resultDraft.result.trim()) throw new Error('labFlow.errResultValue');
    await update(order._id, {
      status: 'completed',
      orderStatus: 'resulted',
      result: resultDraft.result.trim(),
      unit: resultDraft.unit.trim(),
      referenceRange: resultDraft.referenceRange.trim(),
      abnormal: resultDraft.abnormal,
      critical: resultDraft.critical,
      completedAt: new Date().toISOString(),
    });

    if (resultDraft.critical) {
      try {
        const { createMessage } = await import('@/modules/communication/services/message-service');
        await createMessage({
          recipientType: 'staff',
          patientId: order.patientId,
          patientName: order.patientName,
          patientPhone: '',
          fromDoctorId: currentUser?._id || 'lab',
          fromDoctorName: currentUser?.name || 'Laboratory',
          fromHospitalName: currentUser?.hospitalName || order.hospitalName || '',
          subject: `CRITICAL: ${order.testName} for ${order.patientName}`,
          body: `Critical lab result for ${order.patientName} — ${order.testName}: ${resultDraft.result.trim()}${resultDraft.unit.trim() ? ` ${resultDraft.unit.trim()}` : ''}${resultDraft.referenceRange.trim() ? ` (reference range: ${resultDraft.referenceRange.trim()})` : ''}. Please review immediately.`,
          channel: 'app',
          sentAt: new Date().toISOString(),
          orgId: currentUser?.orgId || order.orgId,
        });
      } catch (err) {
        console.error('[lab-workflow] critical-result alert failed; phone the clinician', err);
      }
    }
    setStep('report');
  }), [currentUser, order, resultDraft, run, update]);

  /**
   * Correct a filed value without moving the order backwards in its lifecycle.
   *
   * Stamps the amendment onto the document. A clinician may already have acted
   * on the old value, so a correction that reads identically to an original
   * result is the one thing this must not produce — the report and the chart
   * both surface `amended` and show what it previously said.
   */
  const amendResult = useCallback(() => run(async () => {
    const reason = amendReason;
    if (!resultDraft.result.trim()) throw new Error('labFlow.errResultValue');
    if (!reason.trim()) throw new Error('labFlow.errAmendReason');
    const previous = `${order.result || '—'}${order.unit ? ` ${order.unit}` : ''}`;
    await update(order._id, {
      result: resultDraft.result.trim(),
      unit: resultDraft.unit.trim(),
      referenceRange: resultDraft.referenceRange.trim(),
      abnormal: resultDraft.abnormal,
      critical: resultDraft.critical,
      amended: true,
      amendedAt: new Date().toISOString(),
      amendedBy: currentUser?.name || 'Lab',
      // Keep the FIRST reported value across repeat corrections — that is the
      // one a clinician may have acted on.
      amendedFrom: order.amendedFrom || previous,
      amendmentReason: reason.trim(),
    });
    setAmendReason('');
  }), [amendReason, currentUser, order, resultDraft, run, update]);

  /**
   * Close out the tail of the lifecycle.
   *
   * `resulted → reviewed_by_clinician → acted_upon → communicated_to_patient`
   * was defined in LAB_ORDER_TRANSITIONS and labelled everywhere, but only the
   * first hop had a writer anywhere in the app (the consultation screen), and
   * the last two had none at all — no order could reach them. That left two
   * visible consequences: a result read anywhere other than a consultation
   * stayed at `resulted`, so `getOverdueUnreviewedResults` escalated it past
   * its SLA for ever; and "Acted upon" / "Communicated" were labels for states
   * nothing could enter.
   *
   * The guard in `advanceLabOrder` rejects skips, so each of these only fires
   * from the stage before it.
   */
  const markReviewed = useCallback(() => run(
    () => advance(order._id, 'reviewed_by_clinician', { reviewedBy: currentUser?.name, reviewedAt: new Date().toISOString() }),
  ), [advance, currentUser, order._id, run]);

  const markActedUpon = useCallback(() => run(
    () => advance(order._id, 'acted_upon', { actedUponBy: currentUser?.name, actedUponAt: new Date().toISOString() }),
  ), [advance, currentUser, order._id, run]);

  const markCommunicated = useCallback(() => run(
    () => advance(order._id, 'communicated_to_patient', { communicatedBy: currentUser?.name, communicatedAt: new Date().toISOString() }),
  ), [advance, currentUser, order._id, run]);

  /** Send the report to the ordering clinician's inbox. */
  const notifyClinician = useCallback(() => run(async () => {
    const { createMessage } = await import('@/modules/communication/services/message-service');
    await createMessage({
      recipientType: 'staff',
      patientId: order.patientId,
      patientName: order.patientName,
      patientPhone: '',
      fromDoctorId: currentUser?._id || 'lab',
      fromDoctorName: currentUser?.name || 'Laboratory',
      fromHospitalName: currentUser?.hospitalName || order.hospitalName || '',
      subject: `Result ready: ${order.testName} for ${order.patientName}`,
      body: `${order.testName} for ${order.patientName} has been reported: ${order.result || resultDraft.result}${order.unit ? ` ${order.unit}` : ''}${order.referenceRange ? ` (reference range: ${order.referenceRange})` : ''}.`,
      channel: 'app',
      sentAt: new Date().toISOString(),
      orgId: currentUser?.orgId || order.orgId,
    });
  }), [currentUser, order, resultDraft.result, run]);

  return {
    stage,
    step,
    setStep,
    activeStep,
    doneThrough,
    steps: LAB_WORKFLOW_STEPS,
    busy,
    error,
    collectDraft, setCollectDraft,
    receiveDraft, setReceiveDraft,
    resultDraft, setResultDraft, setResultValue, criticalVerdict,
    amendReason, setAmendReason,
    collect, receive, reject, startProcessing, fileResult, amendResult, notifyClinician,
    markReviewed, markActedUpon, markCommunicated,
  };
}

export type LabWorkflowController = ReturnType<typeof useLabWorkflow>;
