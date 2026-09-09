'use client';

/**
 * The bench workspace for one lab order, rendered inside the patient chart —
 * same six-chevron shape as the ordering wizard, so a technician and a
 * clinician are reading the same picture of the same order.
 *
 * The footer carries exactly one action: whatever the order's current stage is
 * waiting for. Steps already passed open read-only, which is how a technician
 * checks who drew the specimen without touching the lifecycle.
 */

import { ArrowLeft, ArrowRight, Loader2, X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultDoc } from '@/lib/db-types';
import {
  LAB_WORKFLOW_STEPS,
  LAB_WORKFLOW_STEP_LABEL,
  type LabWorkflowStepKey,
} from './lab-workflow-types';
import { useLabWorkflow } from './useLabWorkflow';
import { CollectStep, OrderStep, ProcessStep, ReceiveStep, ReportStep, ResultStep } from './steps/LabSteps';
import '../order/lab-order.css';

export default function LabWorkflowPanel({
  order,
  onClose,
  canWork,
  seedResult,
}: {
  order: LabResultDoc;
  /** Back to the results list. */
  onClose: () => void;
  /** False for viewers without lab-result permission — read-only walkthrough. */
  canWork: boolean;
  /** Analyzer reading to pre-fill the Result step with, for review. */
  seedResult?: { value: string; unit: string; referenceRange: string };
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const ctrl = useLabWorkflow(order, seedResult, canWork);

  const index = LAB_WORKFLOW_STEPS.indexOf(ctrl.step);
  const onActiveStep = ctrl.step === ctrl.activeStep;

  const runAction = async (fn: () => Promise<boolean>, successKey: string) => {
    const ok = await fn();
    showToast(ok ? t(successKey) : t(ctrl.error || 'labFlow.errGeneric'), ok ? 'success' : 'error');
  };

  /** The one thing this step is for — or nothing, when the step is history. */
  const primaryAction = (): { label: string; run: () => void } | null => {
    if (!canWork || !onActiveStep) return null;
    switch (ctrl.step) {
      case 'collect':
        return { label: t('labFlow.actionCollect'), run: () => runAction(ctrl.collect, 'labFlow.okCollected') };
      case 'receive':
        return { label: t('labFlow.actionReceive'), run: () => runAction(ctrl.receive, 'labFlow.okReceived') };
      case 'process':
        return { label: t('labFlow.actionProcess'), run: () => runAction(ctrl.startProcessing, 'labFlow.okProcessing') };
      case 'result':
        return { label: t('labFlow.actionFile'), run: () => runAction(ctrl.fileResult, 'labFlow.okFiled') };
      default:
        return null;
    }
  };

  const action = primaryAction();
  const canAmend = canWork && ctrl.step === 'result' && ctrl.doneThrough >= 4;

  return (
    <div className="labord labord--panel">
      <div className="labord-header">
        <div>
          <h3 className="labord-title">{order.testName}</h3>
          {/* Specimen only. This panel renders inside the patient's own chart,
              under a banner that already names them and carries their hospital
              number — repeating both here told the reader nothing they had not
              just read, and pushed the one fact they came for (which specimen)
              to the end of the line. */}
          {order.specimen && <p className="labord-subtitle">{order.specimen}</p>}
        </div>
        <button type="button" className="labord-close" onClick={onClose} aria-label={t('action.close')}>
          <X className="w-4 h-4" aria-hidden />
        </button>
      </div>

      <div className="labord-meta-row">
        <span>
          {t('labFlow.metaLine', {
            accession: order.accessionNumber || '—',
            stage: t(`labFlow.stage_${ctrl.stage}`),
            orderedBy: order.orderedBy || '—',
          })}
        </span>
        {order.priority === 'stat' && <span className="labord-required">{t('lab.priorityStat')}</span>}
      </div>

      <nav className="labord-stepper" aria-label={t('labFlow.stepsNav')}>
        {LAB_WORKFLOW_STEPS.map((stepKey, i) => {
          const isCurrent = stepKey === ctrl.step;
          const isDone = i <= ctrl.doneThrough;
          return (
            <button
              key={stepKey}
              type="button"
              // Any step up to where the order actually is can be opened; ahead
              // of that there is nothing to show yet.
              disabled={i > ctrl.doneThrough + 1}
              onClick={() => ctrl.setStep(stepKey as LabWorkflowStepKey)}
              aria-current={isCurrent ? 'step' : undefined}
              className={[
                'labord-step',
                isCurrent ? 'labord-step--current' : '',
                !isCurrent && isDone ? 'labord-step--done' : '',
                i > ctrl.doneThrough + 1 ? 'labord-step--blocked' : '',
              ].filter(Boolean).join(' ')}
            >
              {t(LAB_WORKFLOW_STEP_LABEL[stepKey])}
            </button>
          );
        })}
      </nav>

      <div className="labord-main">
        <fieldset className="labord-scroll" disabled={!canWork} style={{ border: 0, margin: 0, minWidth: 0 }}>
          {ctrl.step === 'order' && <OrderStep order={order} />}
          {ctrl.step === 'collect' && <CollectStep order={order} ctrl={ctrl} />}
          {ctrl.step === 'receive' && <ReceiveStep order={order} ctrl={ctrl} />}
          {ctrl.step === 'process' && <ProcessStep order={order} ctrl={ctrl} />}
          {ctrl.step === 'result' && <ResultStep order={order} ctrl={ctrl} />}
          {ctrl.step === 'report' && <ReportStep order={order} ctrl={ctrl} />}
        </fieldset>

        <div className="labord-footer">
          <span className="labord-footer-note">
            {t('labOrder.stepCounter', { current: index + 1, total: LAB_WORKFLOW_STEPS.length })}
            {!canWork && ` · ${t('labFlow.readOnly')}`}
          </span>
          <span className="labord-footer-nav">
            <button
              type="button"
              className="labord-btn"
              onClick={() => ctrl.setStep(LAB_WORKFLOW_STEPS[Math.max(index - 1, 0)])}
              disabled={index === 0 || ctrl.busy}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden /> {t('action.back')}
            </button>

            {/* Rejecting sits beside receiving because it is the other half of
                the same decision: accept this specimen, or send it back. */}
            {canWork && onActiveStep && ctrl.step === 'receive' && (
              <button
                type="button"
                className="labord-btn"
                onClick={() => runAction(ctrl.reject, 'labFlow.okRejected')}
                disabled={ctrl.busy || !ctrl.receiveDraft.rejectionReason}
              >
                {t('labFlow.actionReject')}
              </button>
            )}

            {canAmend && (
              <button
                type="button"
                className="labord-btn"
                onClick={() => runAction(ctrl.amendResult, 'labFlow.okAmended')}
                // An amendment without a stated reason is just an overwrite.
                disabled={ctrl.busy || !ctrl.amendReason.trim()}
              >
                {t('labFlow.actionAmend')}
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
                onClick={() => ctrl.setStep(LAB_WORKFLOW_STEPS[Math.min(index + 1, LAB_WORKFLOW_STEPS.length - 1)])}
                disabled={index >= Math.min(ctrl.doneThrough + 1, LAB_WORKFLOW_STEPS.length - 1) || ctrl.busy}
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
