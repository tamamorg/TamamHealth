/**
 * Per-order lifecycle state machines (Stages 6, 7, 8).
 *
 * These run IN PARALLEL with the encounter (encounter-journey.ts): a single
 * visit can have several open orders, each progressing on its own. The document
 * spells out each lifecycle's "Status transitions per …" line; this module
 * encodes them verbatim so order UIs and APIs validate against them.
 */

import { getSettings } from '../settings/settings-store';

// ── Stage 6 — Diagnostics: lab/imaging order lifecycle ──────────────────────
//
// "ordered → specimen collected → received at lab (or rejected, needs
//  recollection) → in process → resulted → reviewed by clinician → acted upon
//  → communicated to patient". The document stresses: the system ENFORCES that
// every result is reviewed; unreviewed results escalate (7 days routine, 24h
// critical).

export type LabOrderStatus =
  | 'ordered'
  | 'specimen_collected'
  | 'received_at_lab'
  | 'rejected_needs_recollection'
  | 'in_process'
  | 'resulted'
  | 'reviewed_by_clinician'
  | 'acted_upon'
  | 'communicated_to_patient';

export const LAB_ORDER_TRANSITIONS: Readonly<Record<LabOrderStatus, readonly LabOrderStatus[]>> = {
  ordered: ['specimen_collected'],
  specimen_collected: ['received_at_lab', 'rejected_needs_recollection'],
  rejected_needs_recollection: ['specimen_collected'],
  received_at_lab: ['in_process'],
  in_process: ['resulted'],
  resulted: ['reviewed_by_clinician'],
  reviewed_by_clinician: ['acted_upon'],
  acted_upon: ['communicated_to_patient'],
  communicated_to_patient: [],
};

/** Result-review enforcement windows (Stage 6 / Stage 11 Workflow 1). */
export const RESULT_REVIEW_SLA = {
  routineHours: 7 * 24, // unreviewed routine results escalate after 7 days
  criticalHours: 24, // unreviewed critical results escalate after 24 hours
} as const;

/**
 * Live result-review SLA from facility settings (defaults to RESULT_REVIEW_SLA
 * until the settings store is hydrated). Use this in non-React service code so
 * admin changes to the SLA timers propagate.
 */
export function getResultReviewSLA(): { criticalHours: number; routineHours: number } {
  return getSettings().resultReviewSLA;
}

// ── Stage 7 — Treatment / In-Clinic Procedures ──────────────────────────────
//
// "ordered → consented → in progress → completed → (observation period) →
//  released | aborted (with reason) | complication → AE reported".

export type ProcedureStatus =
  | 'ordered'
  | 'consented'
  | 'in_progress'
  | 'completed'
  | 'in_observation'
  | 'released'
  | 'aborted'
  | 'complication'
  | 'ae_reported';

export const PROCEDURE_TRANSITIONS: Readonly<Record<ProcedureStatus, readonly ProcedureStatus[]>> = {
  ordered: ['consented', 'aborted'],
  consented: ['in_progress', 'aborted'],
  in_progress: ['completed', 'aborted', 'complication'],
  completed: ['in_observation', 'released', 'complication'],
  in_observation: ['released', 'complication'],
  released: [],
  aborted: [], // requires reason
  complication: ['ae_reported'],
  ae_reported: [],
};

// ── Stage 8 — Pharmacy: prescription dispensing lifecycle ───────────────────
//
// "prescribed → received in pharmacy queue → under review → cleared for
//  dispensing (or clinician consultation in progress) → dispensed → counseled
//  → complete | stockout, partial/referred | held, awaiting clarification |
//  dispensing error, recalled".

export type PrescriptionStatus =
  | 'prescribed'
  | 'received_in_pharmacy_queue'
  | 'under_review'
  | 'clinician_consultation_in_progress'
  | 'cleared_for_dispensing'
  | 'dispensed'
  | 'counseled'
  | 'complete'
  | 'stockout_partial_referred'
  | 'held_awaiting_clarification'
  | 'dispensing_error_recalled';

export const PRESCRIPTION_TRANSITIONS: Readonly<Record<PrescriptionStatus, readonly PrescriptionStatus[]>> = {
  prescribed: ['received_in_pharmacy_queue'],
  // The pharmacist's review and clearance are one clinical action in the UI.
  // `under_review` remains readable for older/in-flight records.
  received_in_pharmacy_queue: ['under_review', 'cleared_for_dispensing', 'held_awaiting_clarification', 'stockout_partial_referred'],
  under_review: ['cleared_for_dispensing', 'clinician_consultation_in_progress', 'held_awaiting_clarification', 'stockout_partial_referred'],
  clinician_consultation_in_progress: ['cleared_for_dispensing', 'held_awaiting_clarification'],
  held_awaiting_clarification: ['under_review', 'cleared_for_dispensing'],
  cleared_for_dispensing: ['dispensed', 'stockout_partial_referred'],
  dispensed: ['counseled', 'dispensing_error_recalled'],
  counseled: ['complete'],
  complete: [],
  stockout_partial_referred: ['received_in_pharmacy_queue', 'cleared_for_dispensing'], // re-check after stock arrives
  dispensing_error_recalled: ['received_in_pharmacy_queue'],
};

/**
 * Pharmacy queue priority = acuity weight (with time-aging, Principle 2.9)
 * combined with medication criticality tier (Principle 2.11). Tier 1
 * (life-sustaining, incl. chronic refills like insulin) gets priority.
 * See payment-model.ts for the criticality-tier definitions.
 */
export const PHARMACY_QUEUE_PRIORITY_RULE =
  'acuity-weighted priority (time-aged) + medication criticality tier; Tier 1 life-sustaining first';

// ── Generic helpers ─────────────────────────────────────────────────────────

function makeGuard<S extends string>(table: Readonly<Record<S, readonly S[]>>) {
  return {
    next: (from: S): readonly S[] => table[from] ?? [],
    can: (from: S, to: S): boolean => (table[from] ?? []).includes(to),
  };
}

export const labOrder = makeGuard(LAB_ORDER_TRANSITIONS);
export const procedure = makeGuard(PROCEDURE_TRANSITIONS);
export const prescription = makeGuard(PRESCRIPTION_TRANSITIONS);
