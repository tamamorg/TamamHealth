/** The fill form's vocabulary, over the dispensing lifecycle (`PRESCRIPTION_TRANSITIONS`). */

import type { PrescriptionStatus } from '@/lib/clinical-flow/order-lifecycles';

/** Given out: the fill form has nothing left to do. */
export const isFilled = (stage: PrescriptionStatus): boolean =>
  stage === 'dispensed' || stage === 'counseled' || stage === 'complete';

/**
 * What the row's dropdown offers. Once the medicine has gone out there is
 * nothing to fill; a pharmacist (`canReverse`) can still take it back.
 */
export function counterActions(
  stage: PrescriptionStatus,
  t: (key: string) => string,
  opts?: { canReverse?: boolean },
): { value: string; label: string }[] {
  if (isFilled(stage)) return opts?.canReverse ? [{ value: 'reverse', label: t('rxFlow.actionReverseDispense') }] : [];
  return [
    { value: 'next', label: t('rxFlow.fillPrescription') },
    { value: 'hold', label: t('rxFlow.actionHold') },
    { value: 'stockout', label: t('rxFlow.actionStockOut') },
  ];
}

/** The row's one word: there are no steps to report, only where the script stands. */
export function counterPillLabel(stage: PrescriptionStatus, t: (key: string) => string): string {
  if (isFilled(stage)) return t('rxFlow.pillDispensed');
  return isParked(stage) ? t('rxFlow.pillOnHold') : t('rxFlow.pillToFill');
}

/** Stages where the script is parked on someone outside the pharmacy. */
export const PARKED_STAGES: PrescriptionStatus[] = [
  'held_awaiting_clarification',
  'clinician_consultation_in_progress',
  'stockout_partial_referred',
  'dispensing_error_recalled',
];

export const isParked = (stage: PrescriptionStatus): boolean => PARKED_STAGES.includes(stage);

/** Why a pharmacist sends a script back to the prescriber rather than filling it. */
export const CLARIFICATION_REASONS = [
  'Dose outside usual range',
  'Illegible or incomplete',
  'Duplicate of an active medicine',
  'Interaction with an active medicine',
  'Allergy on the record',
  'Contraindicated in pregnancy',
  'Weight or age not recorded',
  'Other',
];

/** Why a dispense could not be completed in full. */
export const UNFILLED_REASONS = [
  'Out of stock',
  'Short stock — partial fill',
  'Batch expired',
  'Referred to another facility',
  'Patient did not collect',
  'Other',
];

/** The counselling points a pharmacist confirms before a script closes. */
export const COUNSELLING_POINTS = [
  { key: 'howToTake', label: 'rxFlow.counselHowToTake' },
  { key: 'duration', label: 'rxFlow.counselDuration' },
  { key: 'sideEffects', label: 'rxFlow.counselSideEffects' },
  { key: 'storage', label: 'rxFlow.counselStorage' },
  { key: 'adherence', label: 'rxFlow.counselAdherence' },
] as const;

/**
 * Label for the dispensing quantity when the prescription never carried one.
 * Older scripts and those written before the course calculator predate
 * `quantityToDispense`; treating a missing quantity as 1 keeps the stock gate
 * honest rather than silently dispensing nothing.
 */
export const courseQuantity = (rx: { quantityToDispense?: number }): number =>
  typeof rx.quantityToDispense === 'number' && rx.quantityToDispense > 0 ? rx.quantityToDispense : 1;

/**
 * What is still owed on the course, for the over-course guard. Only a script
 * that states its course (quantityToDispense) can be over-filled: an older one
 * without it reads as 1 through courseQuantity's display fallback while the
 * server accepts any amount for it, so it gets no ceiling here.
 */
export function remainingOnCourse(rx: { quantityToDispense?: number; quantityDispensed?: number }): number {
  if (!(typeof rx.quantityToDispense === 'number' && rx.quantityToDispense > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(0, rx.quantityToDispense - (rx.quantityDispensed || 0));
}

/** The sig line a patient is counselled against, assembled from the script. */
export const sigLine = (rx: { dose?: string; route?: string; frequency?: string; duration?: string }): string =>
  [rx.dose, rx.route, rx.frequency, rx.duration].filter(Boolean).join(' · ') || '—';
