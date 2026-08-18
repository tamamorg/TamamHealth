'use client';

/**
 * The reading-room workspace for one study, rendered inside the patient chart —
 * same six-chevron shape as the lab bench, so a radiographer, a radiologist and
 * the clinician who ordered it are reading the same picture of the same study.
 *
 * The footer carries exactly one action: whatever the study's current stage is
 * waiting for. Steps already passed open read-only, which is how a reporter
 * checks the technique used without touching the lifecycle.
 *
 * Chrome comes from the diagnostics stylesheet: this panel and the lab's are
 * deliberately the same object, and one stylesheet is what keeps them that way.
 */

import { ArrowLeft, ArrowRight, Loader2, X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultDoc } from '@/lib/db-types';
import {
  RADIOLOGY_WORKFLOW_STEPS,
  RADIOLOGY_WORKFLOW_STEP_LABEL,
  studyLine,
  type RadiologyWorkflowStepKey,
} from './radiology-workflow-types';
import { useRadiologyWorkflow } from './useRadiologyWorkflow';
import { AcquireStep, OrderStep, ReleaseStep, ReportStep, SafetyStep, ScheduleStep } from './steps/RadiologySteps';
import '@/components/lab/order/lab-order.css';

export default function RadiologyWorkflowPanel({
  study,
  onClose,
  canWork,
}: {
  study: LabResultDoc;
  /** Back to the worklist. */
  onClose: () => void;
  /** False for viewers without imaging permission — read-only walkthrough. */
  canWork: boolean;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const ctrl = useRadiologyWorkflow(study);

  const index = RADIOLOGY_WORKFLOW_STEPS.indexOf(ctrl.step);
  const onActiveStep = ctrl.step === ctrl.activeStep;

  const runAction = async (fn: () => Promise<boolean>, successKey: string) => {
    const ok = await fn();
    showToast(ok ? t(successKey) : t(ctrl.error || 'imgFlow.errGeneric'), ok ? 'success' : 'error');
  };

  /** The one thing this step is for — or nothing, when the step is history. */
  const primaryAction = (): { label: string; run: () => void } | null => {
    if (!canWork || !onActiveStep) return null;
    switch (ctrl.step) {
      case 'schedule':
        return { label: t('imgFlow.actionSchedule'), run: () => runAction(ctrl.schedule, 'imgFlow.okScheduled') };
      case 'safety':
        return { label: t('imgFlow.actionSafety'), run: () => runAction(ctrl.clearSafety, 'imgFlow.okSafetyCleared') };
      case 'acquire':
        return { label: t('imgFlow.actionAcquire'), run: () => runAction(ctrl.acquire, 'imgFlow.okAcquired') };
      case 'report':
        return { label: t('imgFlow.actionReport'), run: () => runAction(ctrl.fileReport, 'imgFlow.okReported') };
      case 'release':
        return ctrl.stage === 'resulted'
          ? { label: t('imgFlow.actionNotify'), run: () => runAction(ctrl.notifyClinician, 'imgFlow.okNotified') }
          : null;
      default:
        return null;
    }
  };

  const action = primaryAction();
  const canRepeat = canWork && onActiveStep && ctrl.step === 'acquire';

  return (
    <div className="labord labord--panel">
      <div className="labord-header">
        <div>
          <h3 className="labord-title">{study.testName}</h3>
          {/* Modality, region and side. This panel renders inside the patient's
              own chart, under a banner that already names them — repeating the
              name here pushed the one fact the reader came for to the end of
              the line. */}
          <p className="labord-subtitle">{studyLine(study)}</p>
        </div>
        <button type="button" className="labord-close" onClick={onClose} aria-label={t('action.close')}>
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="labord-meta-row">
        <span>
          {t('imgFlow.metaLine', {
            accession: study.accessionNumber || '—',
            stage: t(`labFlow.stage_${ctrl.stage}`),
            orderedBy: study.orderedBy || '—',
          })}
        </span>
        {study.priority === 'stat' && <span className="labord-required">{t('lab.priorityStat')}</span>}
      </div>

      <nav className="labord-stepper" aria-label={t('imgFlow.stepsNav')}>
        {RADIOLOGY_WORKFLOW_STEPS.map((stepKey, i) => {
          const isCurrent = stepKey === ctrl.step;
          const isDone = i <= ctrl.doneThrough;
          return (
            <button
              key={stepKey}
              type="button"
              // Any step up to where the study actually is can be opened; ahead
              // of that there is nothing to show yet.
              disabled={i > ctrl.doneThrough + 1}
              onClick={() => ctrl.setStep(stepKey as RadiologyWorkflowStepKey)}
              aria-current={isCurrent ? 'step' : undefined}
              className={[
                'labord-step',
                isCurrent ? 'labord-step--current' : '',
                !isCurrent && isDone ? 'labord-step--done' : '',
                i > ctrl.doneThrough + 1 ? 'labord-step--blocked' : '',
              ].filter(Boolean).join(' ')}
            >
              {t(RADIOLOGY_WORKFLOW_STEP_LABEL[stepKey])}
            </button>
          );
        })}
      </nav>

      <div className="labord-main">
        <div className="labord-scroll">
          {ctrl.step === 'order' && <OrderStep study={study} />}
          {ctrl.step === 'schedule' && <ScheduleStep study={study} ctrl={ctrl} />}
          {ctrl.step === 'safety' && <SafetyStep study={study} ctrl={ctrl} />}
          {ctrl.step === 'acquire' && <AcquireStep study={study} ctrl={ctrl} />}
          {ctrl.step === 'report' && <ReportStep study={study} ctrl={ctrl} />}
          {ctrl.step === 'release' && <ReleaseStep study={study} ctrl={ctrl} />}
        </div>

        <div className="labord-footer">
          <span className="labord-footer-note">
            {t('labOrder.stepCounter', { current: index + 1, total: RADIOLOGY_WORKFLOW_STEPS.length })}
            {!canWork && ` · ${t('imgFlow.readOnly')}`}
          </span>
          <span className="labord-footer-nav">
            <button
              type="button"
              className="labord-btn"
              onClick={() => ctrl.setStep(RADIOLOGY_WORKFLOW_STEPS[Math.max(index - 1, 0)])}
              disabled={index === 0 || ctrl.busy}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden /> {t('action.back')}
            </button>

            {/* Repeating sits beside acquiring because it is the other half of
                the same decision: this study is readable, or the patient comes
                back to the machine. */}
            {canRepeat && (
              <button
                type="button"
                className="labord-btn"
                onClick={() => runAction(ctrl.repeat, 'imgFlow.okRepeat')}
                disabled={ctrl.busy || !ctrl.acquireDraft.repeatReason}
              >
                {t('imgFlow.actionRepeat')}
              </button>
            )}

            {action ? (
              <button type="button" className="labord-btn labord-btn--primary" onClick={action.run} disabled={ctrl.busy}>
                {ctrl.busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {action.label}
              </button>
            ) : (
              <button
                type="button"
                className="labord-btn labord-btn--primary"
                onClick={() => ctrl.setStep(RADIOLOGY_WORKFLOW_STEPS[Math.min(index + 1, RADIOLOGY_WORKFLOW_STEPS.length - 1)])}
                disabled={index >= Math.min(ctrl.doneThrough + 1, RADIOLOGY_WORKFLOW_STEPS.length - 1) || ctrl.busy}
              >
                {t('action.next')} <ArrowRight className="w-4 h-4" aria-hidden />
              </button>
            )}
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}
