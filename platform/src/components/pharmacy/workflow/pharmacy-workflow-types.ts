/**
 * The counter-side counterpart to prescribing: the steps a pharmacist walks a
 * prescription through, from the script that arrived to the counselling that
 * closes it.
 *
 * Same shape as the lab bench (`lab-workflow-types.ts`) and for the same
 * reason: these are not new states, they are a view of the existing dispensing
 * lifecycle (`PRESCRIPTION_TRANSITIONS`), grouped into the six things a
 * pharmacist actually does. Mapping lives here so the panel, the stepper and
 * the queue all agree on "which step is this prescription on".
 */

import type { PrescriptionStatus } from '@/lib/clinical-flow/order-lifecycles';

export type PharmacyWorkflowStepKey = 'rx' | 'receive' | 'review' | 'dispense' | 'counsel' | 'close';

export const PHARMACY_WORKFLOW_STEPS: PharmacyWorkflowStepKey[] = [
  'rx', 'receive', 'review', 'dispense', 'counsel', 'close',
];

export const PHARMACY_WORKFLOW_STEP_LABEL: Record<PharmacyWorkflowStepKey, string> = {
  rx: 'rxFlow.stepRx',
  receive: 'rxFlow.stepReceive',
  review: 'rxFlow.stepReview',
  dispense: 'rxFlow.stepDispense',
  counsel: 'rxFlow.stepCounsel',
  close: 'rxFlow.stepClose',
};

/**
 * The step a given lifecycle stage is waiting on — i.e. where the pharmacist
 * picks the prescription up.
 *
 * Every unresolved branch returns to Review, which is the point of those
 * branches: a held script, a stock-out and a recall all need the same person to
 * look at the same medicine again before anything can leave the counter.
 */
export function stepForStage(stage: PrescriptionStatus): PharmacyWorkflowStepKey {
  switch (stage) {
    case 'prescribed': return 'receive';
    case 'received_in_pharmacy_queue': return 'review';
    case 'under_review': return 'review';
    case 'clinician_consultation_in_progress': return 'review';
    case 'held_awaiting_clarification': return 'review';
    case 'stockout_partial_referred': return 'review';
    case 'dispensing_error_recalled': return 'review';
    case 'cleared_for_dispensing': return 'dispense';
    case 'dispensed': return 'counsel';
    default: return 'close';
  }
}

/** How far the prescription has got, as a step index — everything before it is done. */
export function completedThrough(stage: PrescriptionStatus): number {
  const order: Record<PrescriptionStatus, number> = {
    prescribed: 0,
    received_in_pharmacy_queue: 1,
    under_review: 1,
    clinician_consultation_in_progress: 1,
    held_awaiting_clarification: 1,
    stockout_partial_referred: 1,
    dispensing_error_recalled: 1,
    cleared_for_dispensing: 2,
    dispensed: 3,
    counseled: 4,
    complete: 5,
  };
  return order[stage] ?? 0;
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

export type CounsellingPointKey = (typeof COUNSELLING_POINTS)[number]['key'];

/**
 * Label for the dispensing quantity when the prescription never carried one.
 * Older scripts and those written before the course calculator predate
 * `quantityToDispense`; treating a missing quantity as 1 keeps the stock gate
 * honest rather than silently dispensing nothing.
 */
export const courseQuantity = (rx: { quantityToDispense?: number }): number =>
  typeof rx.quantityToDispense === 'number' && rx.quantityToDispense > 0 ? rx.quantityToDispense : 1;

/** The sig line a patient is counselled against, assembled from the script. */
export const sigLine = (rx: { dose?: string; route?: string; frequency?: string; duration?: string }): string =>
  [rx.dose, rx.route, rx.frequency, rx.duration].filter(Boolean).join(' · ') || '—';
