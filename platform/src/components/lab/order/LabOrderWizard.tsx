'use client';

/**
 * Phase 2 — the requisition wizard shell.
 *
 * Owns only navigation: which step is showing, whether the current one is
 * satisfied, and the single submit at the end of Review. Each step renders its
 * own body; the rail and patient strip stay put so context never scrolls away.
 */

import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, X } from '@/components/icons/lucide';
import { useToast } from '@/components/Toast';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { patientFullName } from '@/lib/patient-utils';
import LabOrderPatientStrip from './LabOrderPatientStrip';
import LabOrderSidebar from './LabOrderSidebar';
import LabOrderStepper from './LabOrderStepper';
import PatientStep from './steps/PatientStep';
import TestsStep from './steps/TestsStep';
import ClinicalStep from './steps/ClinicalStep';
import ReviewStep from './steps/ReviewStep';
import CompleteStep from './steps/CompleteStep';
import { LAB_ORDER_STEPS, timingLabelKey, type LabOrderStepKey } from './lab-order-types';
import type { LabOrderController } from './useLabOrderDraft';

export default function LabOrderWizard({
  controller,
  onClose,
  onPlaced,
  lockPatient = false,
}: {
  controller: LabOrderController;
  onClose: () => void;
  /** Fired once the orders exist, so the caller can refresh its queue. */
  onPlaced: () => void;
  /** Opened from a chart: the patient is fixed and shown read-only. */
  lockPatient?: boolean;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { draft, patient, blockersFor, isComplete, submit, submitting, receipt } = controller;
  const [step, setStep] = useState<LabOrderStepKey>('patient');

  const index = LAB_ORDER_STEPS.indexOf(step);
  const placed = !!receipt;

  // What the order *is*, as short tags beside the title. This used to be a
  // sentence under the title plus a second band repeating it below the patient
  // strip; three stacked rows of chrome pushed the actual form off the fold for
  // one line of facts that fits on the title row.
  const orderTags = receipt
    ? [t('labOrder.orderBarPlaced', { accession: receipt.accessionNumbers[0] || receipt.orderGroupId })]
    : [
        draft.kind === 'imaging' ? t('labOrder.typeImaging') : t('labOrder.typeLabs'),
        t(timingLabelKey(draft.kind, draft.collectionTiming)),
        draft.processing === 'send_out' ? t('labOrder.processingSendOut') : t('labOrder.processingInHouse'),
      ];

  const goNext = async () => {
    const blockers = blockersFor(step);
    if (blockers.length) {
      showToast(t(blockers[0]), 'error');
      return;
    }
    if (step === 'review') {
      try {
        await submit();
        onPlaced();
        setStep('complete');
        showToast(t('lab.ordersCreated', { count: draft.tests.length }), 'success');
      } catch (err) {
        console.error(err);
        showToast(t('lab.createOrderFailed'), 'error');
      }
      return;
    }
    setStep(LAB_ORDER_STEPS[Math.min(index + 1, LAB_ORDER_STEPS.length - 1)]);
  };

  const goBack = () => setStep(LAB_ORDER_STEPS[Math.max(index - 1, 0)]);

  return (
    <div className="labord labord--wizard">
      <div className="labord-header">
        <h3 className="labord-title">
          {patient
            ? t('labOrder.wizardTitleFor', { name: patientFullName(patient) })
            : t('labOrder.wizardTitle')}
        </h3>

        <div className="labord-header-tags">
          {orderTags.map(tag => <span key={tag} className="labord-tag">{tag}</span>)}
          {draft.priority === 'stat' && (
            <span className="labord-tag labord-tag--stat">{t('lab.priorityStat')}</span>
          )}
        </div>

        <div className="labord-header-actions">
          {!receipt && (
            <button type="button" className="labord-btn labord-btn--sm" onClick={onClose}>
              {t('labOrder.cancelOrder')}
            </button>
          )}
          <button type="button" className="labord-close" onClick={onClose} aria-label={t('action.close')}>
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>

      {patient && <LabOrderPatientStrip patient={patient} />}

      <LabOrderStepper
        current={step}
        reachable={target => !placed && isComplete(target)}
        onJump={setStep}
      />

      <div className="labord-body">
        <LabOrderSidebar draft={draft} />
        <div className="labord-main">
          <div className="labord-scroll">
            {/* A measured column, not the full pane: a two-field card stretched
                across the whole workspace puts its label and its control an
                arm's length apart and reads as an empty band. */}
            <div className="labord-column">
              {/* Said once, above every step: who fills this in and who reads
                  it. Without it the form reads as questions for no one. */}
              {step !== 'complete' && (
                <p className="labord-audience">
                  {t(draft.kind === 'imaging' ? 'labOrder.audienceImaging' : 'labOrder.audienceLab')}
                </p>
              )}
              {step === 'patient' && <PatientStep controller={controller} lockPatient={lockPatient} />}
              {step === 'tests' && <TestsStep controller={controller} />}
              {step === 'clinical' && <ClinicalStep controller={controller} />}
              {step === 'review' && <ReviewStep controller={controller} onEditStep={setStep} />}
              {step === 'complete' && <CompleteStep controller={controller} />}
            </div>
          </div>

          <div className="labord-footer">
            <span className="labord-footer-note">
              {t('labOrder.stepCounter', { current: index + 1, total: LAB_ORDER_STEPS.length })}
            </span>
            <span className="labord-footer-nav">
              {step === 'complete' ? (
                <button type="button" className="labord-btn labord-btn--primary" onClick={onClose}>
                  <CheckCircle2 className="w-4 h-4" aria-hidden /> {t('labOrder.finish')}
                </button>
              ) : (
                <>
                  <button type="button" className="labord-btn" onClick={goBack} disabled={index === 0 || submitting}>
                    <ArrowLeft className="w-4 h-4" aria-hidden /> {t('action.back')}
                  </button>
                  <button type="button" className="labord-btn labord-btn--primary" onClick={goNext} disabled={submitting}>
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    {step === 'review'
                      ? (submitting ? t('lab.creating') : t('labOrder.complete'))
                      : t('action.next')}
                    {step !== 'review' && <ArrowRight className="w-4 h-4" aria-hidden />}
                  </button>
                </>
              )}
            </span>
            <span />
          </div>
        </div>
      </div>
    </div>
  );
}
