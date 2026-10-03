'use client';

/**
 * The wizard's chevron stepper. Steps already satisfied are clickable so a
 * clinician can jump back to fix a test or a reason without walking the whole form
 * again; steps ahead of the first unsatisfied one are inert.
 */

import { useTranslation } from '@/lib/i18n/useTranslation';
import { LAB_ORDER_STEPS, type LabOrderStepKey } from './lab-order-types';

const STEP_LABEL_KEY: Record<LabOrderStepKey, string> = {
  patient: 'labOrder.stepPatient',
  tests: 'labOrder.stepTests',
  clinical: 'labOrder.stepClinical',
  review: 'labOrder.stepReview',
  complete: 'labOrder.stepComplete',
};

export default function LabOrderStepper({
  current,
  reachable,
  onJump,
}: {
  current: LabOrderStepKey;
  /** True when the step can be opened directly. */
  reachable: (step: LabOrderStepKey) => boolean;
  onJump: (step: LabOrderStepKey) => void;
}) {
  const { t } = useTranslation();
  const currentIndex = LAB_ORDER_STEPS.indexOf(current);

  return (
    <nav className="labord-stepper" aria-label={t('labOrder.stepsNav')}>
      {LAB_ORDER_STEPS.map((step, i) => {
        const isCurrent = step === current;
        const canJump = !isCurrent && i < currentIndex && reachable(step);
        return (
          <button
            key={step}
            type="button"
            disabled={!canJump}
            onClick={canJump ? () => onJump(step) : undefined}
            aria-current={isCurrent ? 'step' : undefined}
            className={[
              'labord-step',
              isCurrent ? 'labord-step--current' : '',
              !isCurrent && i < currentIndex ? 'labord-step--done' : '',
              !isCurrent && i > currentIndex ? 'labord-step--blocked' : '',
            ].filter(Boolean).join(' ')}
          >
            {t(STEP_LABEL_KEY[step])}
          </button>
        );
      })}
    </nav>
  );
}
