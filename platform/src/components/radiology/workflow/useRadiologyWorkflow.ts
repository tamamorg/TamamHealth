'use client';

/**
 * The reading-room workflow's state and its side effects: advancing one study
 * through the diagnostics lifecycle, with every write going through
 * `advanceLabOrder` so an illegal transition throws rather than quietly
 * corrupting the worklist.
 *
 * Lives apart from the panel so the steps stay presentational, and so the same
 * actions can be driven from the chart, the worklist, or a test — the same
 * split the lab bench uses in `useLabWorkflow`.
 */

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@/lib/context';
import { useLabResults } from '@/lib/hooks/useLabResults';
import { usePermissions } from '@/lib/hooks/usePermissions';
import { effectiveOrderStatus } from '@/lib/services/lab-service';
import type { LabResultDoc } from '@/lib/db-types';
import {
  completedThrough,
  fallbackAccessionNumber,
  isIonising,
  needsImplantCheck,
  RADIOLOGY_WORKFLOW_STEPS,
  stepForStage,
  type RadiologyWorkflowStepKey,
} from './radiology-workflow-types';
import { describeError } from '@/lib/user-facing-error';
import { useTranslation } from '@/lib/i18n/useTranslation';

export interface ScheduleDraft {
  accessionNumber: string;
  modality: string;
  bodyRegion: string;
  laterality: '' | 'left' | 'right' | 'bilateral';
  contrast: 'none' | 'oral' | 'iv' | 'both';
  scheduledAt: string;
}

export interface SafetyDraft {
  pregnancyStatus: 'not_applicable' | 'excluded' | 'possible' | 'confirmed';
  contrastAllergy: boolean;
  implantsOrDevices: boolean;
  renalRisk: boolean;
  consentGiven: boolean;
  note: string;
}

export interface AcquireDraft {
  technique: string;
  imageCount: number;
  repeatReason: string;
}

export interface ReportDraft {
  findings: string;
  impression: string;
  abnormal: boolean;
  critical: boolean;
}

export function useRadiologyWorkflow(study: LabResultDoc) {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const { advance, update } = useLabResults(study.patientId);
  const [busy, setBusy] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  // The panel reads this right after an action resolves, before React has
  // re-rendered with the new `error`.
  const lastError = useRef<string | null>(null);
  const setError = useCallback((message: string | null) => {
    lastError.current = message;
    setErrorState(message);
  }, []);
  const { canOrderLabs: canCloseOut } = usePermissions();

  const stage = effectiveOrderStatus(study);
  const activeStep = stepForStage(stage);
  const doneThrough = completedThrough(stage);

  // Which step the panel is showing. Defaults to where the study actually is;
  // finished steps stay openable so the reporter can check the technique
  // without touching the lifecycle.
  const [step, setStep] = useState<RadiologyWorkflowStepKey>(activeStep);

  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>({
    accessionNumber: fallbackAccessionNumber(study),
    modality: study.modality || '',
    bodyRegion: study.bodyRegion || '',
    laterality: study.laterality || '',
    contrast: study.contrast || 'none',
    scheduledAt: study.studyScheduledAt || '',
  });

  const [safetyDraft, setSafetyDraft] = useState<SafetyDraft>({
    pregnancyStatus: study.safetyChecks?.pregnancyStatus || 'not_applicable',
    contrastAllergy: !!study.safetyChecks?.contrastAllergy,
    implantsOrDevices: !!study.safetyChecks?.implantsOrDevices,
    renalRisk: !!study.safetyChecks?.renalRisk,
    consentGiven: !!study.safetyChecks?.consentGiven,
    note: study.safetyChecks?.note || '',
  });

  const [acquireDraft, setAcquireDraft] = useState<AcquireDraft>({
    technique: study.technique || '',
    imageCount: study.imageCount || 0,
    repeatReason: '',
  });

  const [reportDraft, setReportDraft] = useState<ReportDraft>({
    findings: study.findings || '',
    impression: study.impression || study.result || '',
    abnormal: !!study.abnormal,
    critical: !!study.critical,
  });

  const modality = scheduleDraft.modality || study.modality;
  /** A scan that cannot safely proceed until someone answers for it. */
  const safetyBlockers = (): string[] => {
    const blockers: string[] = [];
    if (isIonising(modality) && safetyDraft.pregnancyStatus === 'confirmed') blockers.push('imgFlow.blockPregnancy');
    if (needsImplantCheck(modality) && safetyDraft.implantsOrDevices) blockers.push('imgFlow.blockImplant');
    if (scheduleDraft.contrast !== 'none' && safetyDraft.contrastAllergy) blockers.push('imgFlow.blockContrastAllergy');
    return blockers;
  };

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      console.error('[radiology-workflow]', err);
      setError(describeError(err, t('msg.changeNotSavedTryAgain')));
      return false;
    } finally {
      setBusy(false);
    }
  }, [t]);

  /** Book the modality slot and stamp the accession. */
  const schedule = useCallback(() => run(async () => {
    if (!scheduleDraft.modality) throw new Error('imgFlow.errModality');
    await advance(study._id, 'specimen_collected', {
      accessionNumber: scheduleDraft.accessionNumber.trim() || fallbackAccessionNumber(study),
      modality: scheduleDraft.modality,
      bodyRegion: scheduleDraft.bodyRegion.trim(),
      laterality: scheduleDraft.laterality || undefined,
      contrast: scheduleDraft.contrast,
      studyScheduledAt: scheduleDraft.scheduledAt || new Date().toISOString(),
      studyScheduledBy: currentUser?.name || 'Radiology',
      // A re-booking clears the previous repeat note so the row stops reading
      // as a failed study once the patient is back on the list.
      repeatReason: '',
    });
    setStep('safety');
  }), [advance, currentUser, run, scheduleDraft, study]);

  /** Record the pre-scan screening and call the patient through. */
  const clearSafety = useCallback(() => run(async () => {
    if (!safetyDraft.consentGiven) throw new Error('imgFlow.errConsent');
    if (safetyBlockers().length) throw new Error('imgFlow.errBlocked');
    await advance(study._id, 'received_at_lab', {
      safetyChecks: {
        pregnancyStatus: safetyDraft.pregnancyStatus,
        contrastAllergy: safetyDraft.contrastAllergy,
        implantsOrDevices: safetyDraft.implantsOrDevices,
        renalRisk: safetyDraft.renalRisk,
        consentGiven: safetyDraft.consentGiven,
        note: safetyDraft.note.trim(),
        checkedBy: currentUser?.name || 'Radiology',
        checkedAt: new Date().toISOString(),
      },
    });
    setStep('acquire');
  }), [advance, currentUser, run, safetyDraft, study._id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Perform the study. */
  const acquire = useCallback(() => run(async () => {
    await advance(study._id, 'in_process', {
      acquiredAt: new Date().toISOString(),
      acquiredBy: currentUser?.name || 'Radiology',
      technique: acquireDraft.technique.trim(),
      imageCount: acquireDraft.imageCount || undefined,
    });
    setStep('report');
  }), [acquireDraft, advance, currentUser, run, study._id]);

  /**
   * Send the patient back to the machine. The study is not reported and not
   * discarded — it returns to Schedule with a stated reason, which is the same
   * loop a rejected specimen runs in the lab.
   */
  const repeat = useCallback(() => run(async () => {
    if (!acquireDraft.repeatReason) throw new Error('imgFlow.errRepeatReason');
    await advance(study._id, 'rejected_needs_recollection', {
      repeatReason: acquireDraft.repeatReason,
    });
    setStep('schedule');
  }), [acquireDraft.repeatReason, advance, run, study._id]);

  /**
   * File the report. The impression also lands in the coarse `result` field so
   * every existing result reader — the chart, the portal, the clinician's
   * inbox — shows the answer rather than an empty row.
   */
  const fileReport = useCallback(() => run(async () => {
    if (!reportDraft.impression.trim()) throw new Error('imgFlow.errImpression');
    await update(study._id, {
      status: 'completed',
      orderStatus: 'resulted',
      findings: reportDraft.findings.trim(),
      impression: reportDraft.impression.trim(),
      result: reportDraft.impression.trim(),
      abnormal: reportDraft.abnormal,
      critical: reportDraft.critical,
      reportedAt: new Date().toISOString(),
      reportedBy: currentUser?.name || 'Radiology',
      completedAt: new Date().toISOString(),
    });

    if (reportDraft.critical) {
      // Best-effort, exactly as the lab does it: a filed report the department
      // can phone through beats a blocked save.
      try {
        const { createMessage } = await import('@/modules/communication/services/message-service');
        await createMessage({
          recipientType: 'staff',
          patientId: study.patientId,
          patientName: study.patientName,
          patientPhone: '',
          fromDoctorId: currentUser?._id || 'radiology',
          fromDoctorName: currentUser?.name || 'Radiology',
          fromHospitalName: currentUser?.hospitalName || study.hospitalName || '',
          subject: `CRITICAL: ${study.testName} for ${study.patientName}`,
          body: `Critical imaging finding for ${study.patientName} — ${study.testName}: ${reportDraft.impression.trim()}. Please review immediately.`,
          channel: 'app',
          sentAt: new Date().toISOString(),
          orgId: currentUser?.orgId || study.orgId,
        });
      } catch (err) {
        console.error('[radiology-workflow] critical-finding alert failed; phone the clinician', err);
      }
    }
    setStep('release');
  }), [currentUser, reportDraft, run, study, update]);

  /**
   * Close out the tail of the lifecycle, same hops and same rule as the lab's:
   * these record a clinician's review, not reading-room work, and the patient
   * portal releases on them — so ordering clinicians only.
   */
  const closeOut = useCallback(async (fn: () => Promise<unknown>) => {
    if (!canCloseOut) {
      setError(t('labFlow.closeoutClinicianOnly'));
      return false;
    }
    return run(fn);
  }, [canCloseOut, run, t]);

  const markReviewed = useCallback(() => closeOut(
    () => advance(study._id, 'reviewed_by_clinician', { reviewedBy: currentUser?.name, reviewedAt: new Date().toISOString() }),
  ), [advance, closeOut, currentUser, study._id]);

  const markActedUpon = useCallback(() => closeOut(
    () => advance(study._id, 'acted_upon', { actedUponBy: currentUser?.name, actedUponAt: new Date().toISOString() }),
  ), [advance, closeOut, currentUser, study._id]);

  const markCommunicated = useCallback(() => closeOut(
    () => advance(study._id, 'communicated_to_patient', { communicatedBy: currentUser?.name, communicatedAt: new Date().toISOString() }),
  ), [advance, closeOut, currentUser, study._id]);

  return {
    stage,
    step,
    setStep,
    activeStep,
    doneThrough,
    steps: RADIOLOGY_WORKFLOW_STEPS,
    busy,
    error,
    lastError,
    safetyBlockers: safetyBlockers(),
    scheduleDraft, setScheduleDraft,
    safetyDraft, setSafetyDraft,
    acquireDraft, setAcquireDraft,
    reportDraft, setReportDraft,
    schedule, clearSafety, acquire, repeat, fileReport,
    canCloseOut, markReviewed, markActedUpon, markCommunicated,
  };
}

export type RadiologyWorkflowController = ReturnType<typeof useRadiologyWorkflow>;
