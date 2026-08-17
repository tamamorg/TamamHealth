'use client';

/**
 * The counter workspace for one prescription, rendered inside the patient
 * chart — same six-chevron shape as the lab bench, so a pharmacist and a
 * clinician are reading the same picture of the same order.
 *
 * The footer carries exactly one action: whatever the script's current stage is
 * waiting for. Steps already passed open read-only, which is how a pharmacist
 * checks which batch went out without touching the lifecycle.
 *
 * Chrome comes from the diagnostics stylesheet: this panel and the lab's are
 * deliberately the same object, and one stylesheet is what keeps them that way.
 */

import { ArrowLeft, ArrowRight, Loader2, X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { PrescriptionDoc } from '@/lib/db-types';
import {
  PHARMACY_WORKFLOW_STEPS,
  PHARMACY_WORKFLOW_STEP_LABEL,
  sigLine,
  type PharmacyWorkflowStepKey,
} from './pharmacy-workflow-types';
import { usePharmacyWorkflow } from './usePharmacyWorkflow';
import { CloseStep, CounselStep, DispenseStep, ReceiveStep, ReviewStep, RxStep } from './steps/PharmacySteps';
import '@/components/lab/order/lab-order.css';

export default function PharmacyWorkflowPanel({
  rx,
  onClose,
  canWork,
  activeMedications,
}: {
  rx: PrescriptionDoc;
  /** Back to the medications list. */
  onClose: () => void;
  /** False for viewers without dispensing permission — read-only walkthrough. */
  canWork: boolean;
  /** The patient's other active medicines, for interaction and duplicate checks. */
  activeMedications?: string[];
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const ctrl = usePharmacyWorkflow(rx, activeMedications);

  const index = PHARMACY_WORKFLOW_STEPS.indexOf(ctrl.step);
  const onActiveStep = ctrl.step === ctrl.activeStep;

  const runAction = async (fn: () => Promise<boolean>, successKey: string) => {
    const ok = await fn();
    showToast(ok ? t(successKey) : t(ctrl.error || 'rxFlow.errGeneric'), ok ? 'success' : 'error');
  };

  /** The one thing this step is for — or nothing, when the step is history. */
  const primaryAction = (): { label: string; run: () => void } | null => {
    if (!canWork || !onActiveStep) return null;
    // A parked script has one move: bring it back onto the queue. Offering
    // "clear for dispensing" on a script the prescriber has not answered yet
    // would walk straight past the question that parked it.
    if (ctrl.parked) {
      return { label: t('rxFlow.actionResume'), run: () => runAction(ctrl.resume, 'rxFlow.okResumed') };
    }
    switch (ctrl.step) {
      case 'receive':
        return { label: t('rxFlow.actionReceive'), run: () => runAction(ctrl.receive, 'rxFlow.okReceived') };
      case 'review':
        return { label: t('rxFlow.actionClear'), run: () => runAction(ctrl.clear, 'rxFlow.okCleared') };
      case 'dispense':
        return { label: t('rxFlow.actionDispense'), run: () => runAction(ctrl.dispenseNow, 'rxFlow.okDispensed') };
      case 'counsel':
        return { label: t('rxFlow.actionCounsel'), run: () => runAction(ctrl.counsel, 'rxFlow.okCounselled') };
      case 'close':
        return ctrl.stage === 'complete'
          ? null
          : { label: t('rxFlow.actionComplete'), run: () => runAction(ctrl.complete, 'rxFlow.okCompleted') };
      default:
        return null;
    }
  };

  const action = primaryAction();
  const canHold = canWork && onActiveStep && ctrl.step === 'review' && !ctrl.parked;
  const canStockOut = canWork && onActiveStep && ctrl.step === 'dispense';
  const canRecall = canWork && ctrl.step === 'counsel' && ctrl.doneThrough >= 3;

  return (
    <div className="labord labord--panel">
      <div className="labord-header">
        <div>
          <h3 className="labord-title">{rx.medication}</h3>
          {/* Sig only. This panel renders inside the patient's own chart, under
              a banner that already names them — repeating the name here told
              the reader nothing, and pushed the one fact they came for (how it
              is taken) to the end of the line. */}
          <p className="labord-subtitle">{sigLine(rx)}</p>
        </div>
        <button type="button" className="labord-close" onClick={onClose} aria-label={t('action.close')}>
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="labord-meta-row">
        <span>
          {t('rxFlow.metaLine', {
            stage: t(`rxFlow.stage_${ctrl.stage}`),
            prescribedBy: rx.prescribedBy || '—',
          })}
        </span>
        {rx.urgency === 'immediate' && <span className="labord-required">{t('rxFlow.urgencyImmediate')}</span>}
      </div>

      <nav className="labord-stepper" aria-label={t('rxFlow.stepsNav')}>
        {PHARMACY_WORKFLOW_STEPS.map((stepKey, i) => {
          const isCurrent = stepKey === ctrl.step;
          const isDone = i <= ctrl.doneThrough;
          return (
            <button
              key={stepKey}
              type="button"
              // Any step up to where the script actually is can be opened;
              // ahead of that there is nothing to show yet.
              disabled={i > ctrl.doneThrough + 1}
              onClick={() => ctrl.setStep(stepKey as PharmacyWorkflowStepKey)}
              aria-current={isCurrent ? 'step' : undefined}
              className={[
                'labord-step',
                isCurrent ? 'labord-step--current' : '',
                !isCurrent && isDone ? 'labord-step--done' : '',
                i > ctrl.doneThrough + 1 ? 'labord-step--blocked' : '',
              ].filter(Boolean).join(' ')}
            >
              {t(PHARMACY_WORKFLOW_STEP_LABEL[stepKey])}
            </button>
          );
        })}
      </nav>

      <div className="labord-main">
        <div className="labord-scroll">
          {ctrl.step === 'rx' && <RxStep rx={rx} />}
          {ctrl.step === 'receive' && <ReceiveStep rx={rx} ctrl={ctrl} />}
          {ctrl.step === 'review' && <ReviewStep rx={rx} ctrl={ctrl} />}
          {ctrl.step === 'dispense' && <DispenseStep rx={rx} ctrl={ctrl} />}
          {ctrl.step === 'counsel' && <CounselStep rx={rx} ctrl={ctrl} />}
          {ctrl.step === 'close' && <CloseStep rx={rx} ctrl={ctrl} />}
        </div>

        <div className="labord-footer">
          <span className="labord-footer-note">
            {t('labOrder.stepCounter', { current: index + 1, total: PHARMACY_WORKFLOW_STEPS.length })}
            {!canWork && ` · ${t('rxFlow.readOnly')}`}
          </span>
          <span className="labord-footer-nav">
            <button
              type="button"
              className="labord-btn"
              onClick={() => ctrl.setStep(PHARMACY_WORKFLOW_STEPS[Math.max(index - 1, 0)])}
              disabled={index === 0 || ctrl.busy}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden /> {t('action.back')}
            </button>

            {/* Holding sits beside clearing because it is the other half of the
                same decision: fill this script, or send the question back. */}
            {canHold && (
              <button
                type="button"
                className="labord-btn"
                onClick={() => runAction(ctrl.hold, 'rxFlow.okHeld')}
                disabled={ctrl.busy || !ctrl.reviewDraft.clarificationReason}
              >
                {t('rxFlow.actionHold')}
              </button>
            )}

            {/* Likewise a stock-out is the other outcome of standing at the
                shelf — it keeps the script active rather than closing it. */}
            {canStockOut && (
              <button
                type="button"
                className="labord-btn"
                onClick={() => runAction(ctrl.recordStockOut, 'rxFlow.okStockOut')}
                disabled={ctrl.busy || !ctrl.dispenseDraft.unfilledReason}
              >
                {t('rxFlow.actionStockOut')}
              </button>
            )}

            {canRecall && (
              <button
                type="button"
                className="labord-btn"
                onClick={() => runAction(ctrl.recall, 'rxFlow.okRecalled')}
                // A recall without a stated reason is just an undo.
                disabled={ctrl.busy || !ctrl.dispenseDraft.note.trim()}
              >
                {t('rxFlow.actionRecall')}
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
                onClick={() => ctrl.setStep(PHARMACY_WORKFLOW_STEPS[Math.min(index + 1, PHARMACY_WORKFLOW_STEPS.length - 1)])}
                disabled={index >= Math.min(ctrl.doneThrough + 1, PHARMACY_WORKFLOW_STEPS.length - 1) || ctrl.busy}
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
