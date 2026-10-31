'use client';

/**
 * One lab order as a single form, in the dashboard's slider (LabBenchSlider) and
 * the patient chart. There are no steps to walk: the form opens on what the test
 * needs. A new test asks for the specimen; a specimen in hand asks for the result;
 * a filed result shows its report. Save does that one thing; the lifecycle's own
 * hops happen behind it (see `fileResult` in useLabWorkflow).
 */

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import type { LabResultDoc } from '@/lib/db-types';
import { fallbackAccessionNumber } from './lab-workflow-types';
import { useLabWorkflow } from './useLabWorkflow';
import { CollectStep, OrderContext, OrderStep, ReceiveStep, ReportStep, ResultStep } from './steps/LabSteps';
import FormNotices from '@/components/overlay/FormNotices';
import '@/components/forms/o3-form.css';
import '@/components/ehr/chart/panels/order-basket/order-basket.css';
import '../order/lab-order.css';
import './lab-workflow.css';

export default function LabWorkflowPanel({
  order: orderFromList,
  onClose,
  canWork,
  seedResult,
  hideTitle = false,
  intent,
}: {
  order: LabResultDoc;
  /** Back out of the workflow: to the list, or closes the slider. */
  onClose: () => void;
  /** False for viewers without lab-result permission — read-only walkthrough. */
  canWork: boolean;
  /** Analyzer reading to pre-fill the Result step with, for review. */
  seedResult?: { value: string; unit: string; referenceRange: string };
  /** The slider's own header already names the test. */
  hideTitle?: boolean;
  /** Picked from the row's dropdown: Save rejects the specimen rather than books it in. */
  intent?: 'reject';
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const ctrl = useLabWorkflow(orderFromList, seedResult, canWork);
  const { order } = ctrl;
  const [rejecting, setRejecting] = useState(intent === 'reject');

  const needsSpecimen = ctrl.stage === 'ordered' || ctrl.stage === 'rejected_needs_recollection';
  const filed = ctrl.doneThrough >= 4;

  const runAction = async (fn: () => Promise<boolean>, successKey: string, closes = false) => {
    const ok = await fn();
    // An outcome of the form, not its validation: it goes to the corner.
    showToast(ok ? t(successKey) : t(ctrl.lastError.current || 'labFlow.errGeneric'), ok ? 'success' : 'error', { placement: 'corner' });
    if (ok && closes) onClose();
  };

  /** The form's one Save — or nothing, once the result is filed. */
  const primaryAction = (): { run: () => void; blocked?: boolean } | null => {
    if (!canWork || filed) return null;
    if (rejecting) {
      return {
        run: () => { void runAction(ctrl.reject, 'labFlow.okRejected', true); setRejecting(false); },
        blocked: !ctrl.receiveDraft.rejectionReason,
      };
    }
    // Collected: the row moves to the bench and the result comes later.
    if (needsSpecimen) {
      return {
        run: () => void runAction(ctrl.collect, 'labFlow.okCollected', true),
        blocked: !ctrl.collectDraft.container || !ctrl.collectDraft.collectedBy.trim(),
      };
    }
    // Filed: the slider stays open on the report, to print or send it.
    return {
      run: () => void runAction(ctrl.fileResult, 'labFlow.okFiled'),
      blocked: !ctrl.hasResultEntry || !ctrl.receiveDraft.accessionNumber.trim(),
    };
  };

  const action = primaryAction();

  return (
    <div className="station-form-slider obk-root lwf">
      <div className="obf-form">
        <div className="obf-form-body">
          <div className="obf-pad">
            {!hideTitle && <h3 className="lwf-title">{order.testName}</h3>}
            {/* Who sent it, when that is not a clinician here. */}
            <div className="lwf-meta">
              <span>
                {t('labFlow.metaLine', {
                  accession: fallbackAccessionNumber(order),
                  orderedBy: [order.orderedBy, order.externalFacility].filter(Boolean).join(', ') || '—',
                })}
              </span>
              {order.priority === 'stat' && <strong className="lwf-stat">{t('lab.priorityStat')}</strong>}
            </div>

            {/* Filed: the report is what the slider is open for, so it leads.
                A read-only viewer (the ordering clinician) cannot work the bench,
                but that report is theirs to read and print — so it sits outside
                the fieldset and guards its own write controls. A disabled
                fieldset disables every button inside it, Print included. */}
            {filed && <ReportStep order={order} ctrl={ctrl} readOnly={!canWork} />}
            <fieldset className="lwf-fields" disabled={!canWork}>
              {/* What this form is open to do comes first; the clinician's notes
                  stay above it, and what is already on record follows. */}
              <OrderContext order={order} />
              {needsSpecimen && <CollectStep order={order} ctrl={ctrl} />}
              {!needsSpecimen && !rejecting && <ResultStep order={order} ctrl={ctrl} onAmend={() => runAction(ctrl.amendResult, 'labFlow.okAmended')} />}
              {!needsSpecimen && <ReceiveStep order={order} ctrl={ctrl} rejecting={rejecting} />}
              {!needsSpecimen && <CollectStep order={order} ctrl={ctrl} />}
              <OrderStep order={order} />
            </fieldset>
          </div>
        </div>
        <FormNotices />
        <div className="obk-footer">
          <button type="button" className="obk-footer-btn obk-footer-btn--secondary" disabled={ctrl.busy} onClick={onClose}>
            {t(action ? 'action.cancel' : 'action.close')}
          </button>
          {action && (
            <button type="button" className="obk-footer-btn obk-footer-btn--primary" onClick={action.run} disabled={ctrl.busy || action.blocked}>
              {t('action.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
