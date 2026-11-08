'use client';

/**
 * The bench workflow's state and its side effects: advancing one order through
 * the diagnostics lifecycle, with every write going through `advanceLabOrder`
 * so an illegal transition throws rather than quietly corrupting the queue.
 *
 * Lives apart from the panel so the steps stay presentational, and so the same
 * actions can be driven from the chart, the queue, or a test.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { usePermissions } from '@/lib/hooks/usePermissions';
import {
  evaluateCritical,
  evaluateCriticalObservations,
  flagLabResult,
  getLabReferenceRange,
  type CriticalObservationHit,
} from '@/lib/services/lab-critical-flag';
import { effectiveOrderStatus, getLabResultById } from '@/lib/services/lab-service';
import type { LabResultCorrection, LabResultDoc } from '@/lib/db-types';
import {
  completedThrough,
  correctionReviewState,
  fallbackAccessionNumber,
  resultWithUnit,
} from './lab-workflow-types';
import {
  buildLabObservations,
  resolveLabResultProfile,
  summarizeLabObservations,
  valuesFromObservations,
} from './lab-result-catalog';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface CollectDraft {
  container: string;
  collectedBy: string;
  /** Local datetime-local value; empty means now. */
  collectedAt: string;
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
  observations: Record<string, string>;
  abnormal: boolean;
  critical: boolean;
  /** Once the tech overrides the critical flag by hand, stop deriving it. */
  criticalManual: boolean;
}

/**
 * One shape for the live QC verdict whether the test is a plain single value
 * or a structured panel — the panel adds `hits` (which analyte, value, and
 * threshold tripped) so the UI can name what fired instead of only a boolean.
 */
export interface WorkflowCriticalVerdict {
  isCriticalValue: boolean;
  hits: CriticalObservationHit[];
}

export function useLabWorkflow(
  orderFromList: LabResultDoc,
  /** A reading imported from an analyzer, offered for review rather than saved. */
  seedResult?: { value: string; unit: string; referenceRange: string },
  canWork = true,
) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  // Reviewing a result, acting on it and telling the patient are the
  // clinician's half of the loop — the roles that order tests. The bench files
  // the result; it does not review it on the clinician's behalf.
  const { canOrderLabs: canCloseOut } = usePermissions();
  const { results, advance, update } = useLabResults(orderFromList.patientId);
  // The record as this workflow last saved it. The list behind the slider
  // catches up a moment later; a step must not wait for it to move on.
  const order = results?.find(r => r._id === orderFromList._id) ?? orderFromList;
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  // The panel reads this right after an action resolves, before React has
  // re-rendered with the new `error`.
  const lastError = useRef<string | null>(null);
  const setError = useCallback((message: string | null) => {
    lastError.current = message;
    setErrorState(message);
  }, []);
  /** Why a already-reported value is being corrected. Required to amend. */
  const [amendReason, setAmendReason] = useState('');

  const stage = effectiveOrderStatus(order);
  const doneThrough = completedThrough(stage);

  const [collectDraft, setCollectDraft] = useState<CollectDraft>({
    container: order.specimenContainer || '',
    collectedBy: order.specimenCollectedBy || currentUser?.name || '',
    collectedAt: '',
    note: order.specimenCollectionNote || '',
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
      observations: valuesFromObservations(order.observations),
      abnormal: !!order.abnormal || seededCritical,
      critical: seededCritical,
      criticalManual: !seedResult?.value && !!order.critical,
    };
  });

  /**
   * The panel this order resolves to, if any — Full Blood Count, a chemistry
   * panel, Urinalysis, Stool. Everything below that files or evaluates a
   * structured result shares this one lookup rather than re-resolving it.
   */
  const resultProfile = useMemo(
    () => resolveLabResultProfile(order.testName, order.specimen),
    [order.testName, order.specimen],
  );

  /** Turn the draft's {fieldId: value} map into what `evaluateCriticalObservations` needs. */
  const structuredObservationInputs = useCallback((values: Record<string, string>) => {
    if (!resultProfile) return [];
    return resultProfile.sections.flatMap(section => section.fields.flatMap(field => {
      const value = values[field.id]?.trim();
      return value ? [{ id: field.id, label: field.label, unit: field.unit, value }] : [];
    }));
  }, [resultProfile]);

  /**
   * Live QC verdict for the value being entered — the plain result field for
   * an ordinary test, or every analyte in the panel for a structured one.
   * `evaluateCritical` alone used to be wired here, which left every panel
   * test's DEFAULT_CRITICAL_VALUES analytes (Hemoglobin, WBC, Platelets,
   * Glucose, Potassium, Sodium, Calcium, Creatinine) undetectable, since they
   * are entered as observations, never the plain `result` field.
   */
  const criticalVerdict = useMemo<WorkflowCriticalVerdict>(() => {
    if (resultProfile) {
      const { isCriticalValue, hits } = evaluateCriticalObservations(
        structuredObservationInputs(resultDraft.observations),
      );
      return { isCriticalValue, hits };
    }
    return { isCriticalValue: evaluateCritical(order.testName, resultDraft.result).isCriticalValue, hits: [] };
  }, [resultProfile, structuredObservationInputs, resultDraft.observations, order.testName, resultDraft.result]);

  /** Typing a value re-derives the critical flag until the tech overrides it. */
  const setResultValue = useCallback((value: string) => {
    setResultDraft(prev => {
      const verdict = evaluateCritical(order.testName, value);
      const critical = prev.criticalManual ? prev.critical : verdict.isCriticalValue;
      // A test the reference table knows (the same table the batch-entry
      // screen flags from) gets its unit and range filled in and its abnormal
      // flag derived from the value — "Positive" on a malaria RDT is abnormal,
      // and changing it back to "Negative" clears the flag again. Tests with
      // no reference entry keep the technician's own flag.
      const reference = getLabReferenceRange(order.testName);
      const flagged = reference ? flagLabResult(order.testName, value) : null;
      return {
        ...prev,
        result: value,
        unit: prev.unit || reference?.unit || '',
        referenceRange: prev.referenceRange || reference?.referenceStr || '',
        critical,
        abnormal: flagged
          ? flagged.abnormal || (critical && !prev.criticalManual)
          : prev.abnormal || (critical && !prev.criticalManual),
      };
    });
  }, [order.testName]);

  /**
   * Entering an analyte in a structured panel re-derives the critical flag
   * the same way `setResultValue` does for a plain result — this is the
   * counterpart that was missing, which left the checkbox as the only way a
   * panel test's critical values ever got flagged.
   */
  const setObservationValue = useCallback((id: string, value: string) => {
    setResultDraft(prev => {
      const observations = { ...prev.observations, [id]: value };
      const verdict = evaluateCriticalObservations(structuredObservationInputs(observations));
      const critical = prev.criticalManual ? prev.critical : verdict.isCriticalValue;
      return {
        ...prev,
        observations,
        critical,
        abnormal: prev.abnormal || (critical && !prev.criticalManual),
      };
    });
  }, [structuredObservationInputs]);

  const execute = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      console.error('[lab-workflow]', err);
      // The workflow's own refusals are thrown as message keys; the panel
      // translates them. Anything else is described for the user.
      const message = err instanceof Error ? err.message : '';
      setError(/^labFlow\.\w+$/.test(message) ? message : describeError(err, t('msg.changeNotSavedTryAgain')));
      return false;
    } finally {
      setBusy(false);
    }
  }, [setError, t]);

  /** Bench work: collecting, receiving, processing, filing, amending. */
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (!canWork || currentUser?.role !== 'lab_tech') {
      setError('labFlow.readOnly');
      return false;
    }
    return execute(fn);
  }, [canWork, currentUser?.role, execute, setError]);

  /**
   * Close-out: a clinician's attestation, not the bench's. It was gated like
   * bench work, so only a lab tech could press "Mark reviewed" — recording a
   * clinician's review nobody had made — while the clinician who ordered the
   * test could not. The patient portal releases a result on this stage, which
   * makes who may set it matter.
   */
  const runCloseout = useCallback(async (fn: () => Promise<unknown>) => {
    if (!canCloseOut) {
      setError('labFlow.closeoutClinicianOnly');
      return false;
    }
    return execute(fn);
  }, [canCloseOut, execute, setError]);

  /** The specimen is in hand. The form then asks for the result. */
  const collect = useCallback(() => run(async () => {
    await advance(order._id, 'specimen_collected', {
      specimenCollectedAt: (collectDraft.collectedAt ? new Date(collectDraft.collectedAt) : new Date()).toISOString(),
      specimenCollectedBy: collectDraft.collectedBy || currentUser?.name || 'Lab',
      specimenContainer: collectDraft.container,
      specimenCollectionNote: collectDraft.note.trim() || undefined,
      accessionNumber: order.accessionNumber || fallbackAccessionNumber(order),
      // Re-collection clears the previous rejection so the row stops reading as
      // rejected once a fresh specimen is in hand.
      specimenRejectionReason: '',
      specimenRejectionNotes: '',
    });
  }), [advance, collectDraft, currentUser, order, run]);

  const reject = useCallback(() => run(async () => {
    if (!receiveDraft.rejectionReason) throw new Error('labFlow.errRejectReason');
    await advance(order._id, 'rejected_needs_recollection', {
      specimenCondition: 'other',
      specimenRejectionReason: receiveDraft.rejectionReason,
      specimenRejectionNotes: receiveDraft.rejectionNotes.trim(),
      specimenRejectedAt: new Date().toISOString(),
      specimenRejectedBy: currentUser?.name || 'Lab',
    });
  }), [advance, currentUser, order._id, receiveDraft, run]);

  /** Anything to file yet: the plain value, or one analyte of a panel. */
  const hasResultEntry = resultProfile
    ? Object.values(resultDraft.observations).some(value => value?.trim())
    : !!resultDraft.result.trim();

  /**
   * File the result, in one press. The specimen's receipt and the bench's own
   * hops happen here, stamped as they always were, so the lifecycle and the
   * chain of custody read the same without a technician walking them. Critical
   * values also page the ordering clinician — best-effort, because a saved
   * result the lab can phone through beats a blocked save.
   */
  /**
   * Message the care team about a critical value — best-effort, because a
   * saved result the lab can phone through beats a blocked save. Filing and
   * an approved correction send the same message.
   */
  const sendCriticalAlert = useCallback(async (result: string, unit: string, referenceRange: string) => {
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
        body: `Critical lab result for ${order.patientName} — ${order.testName}: ${result}${unit ? ` ${unit}` : ''}${referenceRange ? ` (reference range: ${referenceRange})` : ''}. Please review immediately.`,
        channel: 'app',
        sentAt: new Date().toISOString(),
        orgId: currentUser?.orgId || order.orgId,
      });
    } catch (err) {
      console.error('[lab-workflow] critical-result alert failed; phone the clinician', err);
    }
  }, [currentUser, order.hospitalName, order.orgId, order.patientId, order.patientName, order.testName]);

  const fileResult = useCallback(() => run(async () => {
    const profile = resultProfile;
    const observations = profile ? buildLabObservations(profile, resultDraft.observations) : [];
    const result = profile ? summarizeLabObservations(observations) : resultDraft.result.trim();
    if (!result) throw new Error('labFlow.errResultValue');
    if (stage === 'specimen_collected') {
      await advance(order._id, 'received_at_lab', {
        accessionNumber: receiveDraft.accessionNumber.trim(),
        specimenCondition: receiveDraft.condition,
        specimenReceivedAt: new Date().toISOString(),
        specimenReceivedBy: currentUser?.name || 'Lab',
      });
    }
    if (stage === 'specimen_collected' || stage === 'received_at_lab') await advance(order._id, 'in_process');
    await update(order._id, {
      status: 'completed',
      orderStatus: 'resulted',
      result,
      unit: profile ? '' : resultDraft.unit.trim(),
      referenceRange: profile ? '' : resultDraft.referenceRange.trim(),
      observations: profile ? observations : order.observations,
      abnormal: resultDraft.abnormal,
      critical: resultDraft.critical,
      completedAt: new Date().toISOString(),
    });

    if (resultDraft.critical) {
      await sendCriticalAlert(result, profile ? '' : resultDraft.unit.trim(), profile ? '' : resultDraft.referenceRange.trim());
    }
  }), [advance, currentUser, order, receiveDraft, resultDraft, resultProfile, run, sendCriticalAlert, stage, update]);

  /**
   * Propose a correction to a filed value. Nothing on the filed result moves:
   * the correction waits on the document until a second lab tech approves it,
   * because a clinician may already have acted on the value it would replace.
   * One at a time — a second proposal would bury the first unreviewed.
   */
  const amendResult = useCallback(() => run(async () => {
    const reason = amendReason.trim();
    const profile = resultProfile;
    const observations = profile ? buildLabObservations(profile, resultDraft.observations) : [];
    const result = profile ? summarizeLabObservations(observations) : resultDraft.result.trim();
    if (!result) throw new Error('labFlow.errResultValue');
    if (!reason) throw new Error('labFlow.errAmendReason');
    if (!currentUser?._id) throw new Error('labFlow.errNoUser');
    const latest = await getLabResultById(order._id);
    if (!latest) throw new Error('labFlow.errGeneric');
    if (latest.pendingCorrection) throw new Error('labFlow.errCorrectionPending');
    const correction: LabResultCorrection = {
      result,
      unit: profile ? '' : resultDraft.unit.trim(),
      referenceRange: profile ? '' : resultDraft.referenceRange.trim(),
      ...(profile ? { observations } : {}),
      abnormal: resultDraft.abnormal,
      critical: resultDraft.critical,
      reason,
      proposedBy: currentUser.name || 'Lab',
      proposedById: currentUser._id,
      proposedAt: new Date().toISOString(),
    };
    await update(order._id, { pendingCorrection: correction });
    setAmendReason('');
  }), [amendReason, currentUser, order._id, resultDraft, resultProfile, run, update]);

  /** Why the reviewer turned a correction down. Required to reject. */
  const [correctionRejectReason, setCorrectionRejectReason] = useState('');

  /** Who may approve or reject the correction on this result, right now. */
  const correctionReview = correctionReviewState(order, currentUser, canWork);

  /**
   * Re-read the result and check the viewer may act on its correction. Read
   * fresh, not from the list: another tech may have approved or replaced it.
   */
  const pendingForReview = useCallback(async () => {
    const latest = await getLabResultById(order._id);
    const pending = latest?.pendingCorrection;
    if (!latest || !pending) throw new Error('labFlow.errNoCorrection');
    const state = correctionReviewState(latest, currentUser, true);
    if (state === 'own') throw new Error('labFlow.errOwnCorrection');
    if (state !== 'can_review') throw new Error('labFlow.readOnly');
    return { latest, pending };
  }, [currentUser, order._id]);

  /**
   * A second lab tech approves: the correction becomes the result, with the
   * amendment stamps every reader already shows, plus who verified it.
   */
  const approveCorrection = useCallback(() => run(async () => {
    const { latest, pending } = await pendingForReview();
    const previous = resultWithUnit(latest.result, latest.unit) || '—';
    await update(order._id, {
      result: pending.result,
      unit: pending.unit,
      referenceRange: pending.referenceRange,
      observations: pending.observations?.length ? pending.observations : latest.observations,
      abnormal: pending.abnormal,
      critical: pending.critical,
      amended: true,
      amendedAt: new Date().toISOString(),
      amendedBy: pending.proposedBy,
      // Keep the FIRST reported value across repeat corrections — that is the
      // one a clinician may have acted on.
      amendedFrom: latest.amendedFrom || previous,
      amendmentReason: pending.reason,
      correctionVerifiedBy: currentUser?.name || 'Lab',
      correctionVerifiedById: currentUser?._id,
      correctionVerifiedAt: new Date().toISOString(),
      pendingCorrection: undefined,
    });
    if (pending.critical) await sendCriticalAlert(pending.result, pending.unit, pending.referenceRange);
  }), [currentUser, order._id, pendingForReview, run, sendCriticalAlert, update]);

  /** A second lab tech turns the correction down. The filed value stands. */
  const rejectCorrection = useCallback(() => run(async () => {
    const reason = correctionRejectReason.trim();
    if (!reason) throw new Error('labFlow.errCorrectionRejectReason');
    const { latest, pending } = await pendingForReview();
    await update(order._id, {
      pendingCorrection: undefined,
      rejectedCorrections: [
        ...(latest.rejectedCorrections || []),
        {
          ...pending,
          rejectedBy: currentUser?.name || 'Lab',
          rejectedById: currentUser?._id || '',
          rejectedAt: new Date().toISOString(),
          rejectionReason: reason,
        },
      ],
    });
    setCorrectionRejectReason('');
  }), [correctionRejectReason, currentUser, order._id, pendingForReview, run, update]);

  /**
   * The proposer takes their own correction back (audit 2026-11-08). Without
   * it a correction nobody else reviewed — one lab tech on shift — sat
   * "awaiting review" for good and blocked every later correction. The entry
   * joins the same audit trail, marked withdrawn; the server accepts it only
   * from the proposer.
   */
  const withdrawCorrection = useCallback(() => run(async () => {
    const reason = correctionRejectReason.trim();
    if (!reason) throw new Error('labFlow.errCorrectionWithdrawReason');
    const latest = await getLabResultById(order._id);
    const pending = latest?.pendingCorrection;
    if (!latest || !pending) throw new Error('labFlow.errNoCorrection');
    if (!currentUser?._id || pending.proposedById !== currentUser._id) throw new Error('labFlow.readOnly');
    await update(order._id, {
      pendingCorrection: undefined,
      rejectedCorrections: [
        ...(latest.rejectedCorrections || []),
        {
          ...pending,
          rejectedBy: currentUser.name || 'Lab',
          rejectedById: currentUser._id,
          rejectedAt: new Date().toISOString(),
          rejectionReason: reason,
          withdrawn: true,
        },
      ],
    });
    setCorrectionRejectReason('');
  }), [correctionRejectReason, currentUser, order._id, run, update]);

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
  const markReviewed = useCallback(() => runCloseout(
    () => advance(order._id, 'reviewed_by_clinician', { reviewedBy: currentUser?.name, reviewedAt: new Date().toISOString() }),
  ), [advance, currentUser, order._id, runCloseout]);

  const markActedUpon = useCallback(() => runCloseout(
    () => advance(order._id, 'acted_upon', { actedUponBy: currentUser?.name, actedUponAt: new Date().toISOString() }),
  ), [advance, currentUser, order._id, runCloseout]);

  const markCommunicated = useCallback(() => runCloseout(
    () => advance(order._id, 'communicated_to_patient', { communicatedBy: currentUser?.name, communicatedAt: new Date().toISOString() }),
  ), [advance, currentUser, order._id, runCloseout]);

  /** The report left the lab: handed to the patient or sent to the requester. */
  const releaseReport = useCallback(() => run(() => update(order._id, {
    reportReleasedAt: new Date().toISOString(),
    reportReleasedBy: currentUser?.name || 'Lab',
  })), [currentUser, order._id, run, update]);

  return {
    order,
    stage,
    doneThrough,
    busy,
    error,
    lastError,
    collectDraft, setCollectDraft,
    receiveDraft, setReceiveDraft,
    resultDraft, setResultDraft, setResultValue, setObservationValue, criticalVerdict,
    amendReason, setAmendReason,
    correctionReview, correctionRejectReason, setCorrectionRejectReason, approveCorrection, rejectCorrection, withdrawCorrection,
    collect, reject, fileResult, hasResultEntry, amendResult, releaseReport,
    markReviewed, markActedUpon, markCommunicated,
    canCloseOut,
  };
}

export type LabWorkflowController = ReturnType<typeof useLabWorkflow>;
