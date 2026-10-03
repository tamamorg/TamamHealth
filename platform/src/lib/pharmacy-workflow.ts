import type { PrescriptionStatus } from './clinical-flow/order-lifecycles';
import type { PrescriptionDoc } from './db-types';

export function pharmacyStage(rx: Pick<PrescriptionDoc, 'orderStatus' | 'status'>): PrescriptionStatus {
  // Mirrors effectivePrescriptionStatus in prescription-service.ts: `status`
  // must be checked before `orderStatus` so a discontinue that lands on top
  // of a stale 'cleared_for_dispensing' orderStatus can't still read as
  // dispensable.
  if (rx.status === 'discontinued') return 'held_awaiting_clarification';
  if (rx.orderStatus) return rx.orderStatus;
  if (rx.status === 'dispensed') return 'dispensed';
  return 'received_in_pharmacy_queue';
}

export function pharmacyStageLabel(stage: PrescriptionStatus): string {
  switch (stage) {
    case 'prescribed':
      return 'Prescribed';
    case 'received_in_pharmacy_queue':
      return 'Received';
    case 'under_review':
      return 'Under review';
    case 'clinician_consultation_in_progress':
      return 'Clarifying';
    case 'cleared_for_dispensing':
      return 'Cleared';
    case 'dispensed':
      return 'Dispensed';
    case 'counseled':
      return 'Counseled';
    case 'complete':
      return 'Complete';
    case 'stockout_partial_referred':
      return 'Stockout / referred';
    case 'held_awaiting_clarification':
      return 'Held';
    case 'dispensing_error_recalled':
      return 'Recalled';
  }
}

export function pharmacyStageTone(stage: PrescriptionStatus): 'scheduled' | 'ready' | 'active' | 'done' | 'warning' | 'danger' {
  switch (stage) {
    case 'prescribed':
    case 'received_in_pharmacy_queue':
      return 'scheduled';
    case 'under_review':
    case 'clinician_consultation_in_progress':
      return 'active';
    case 'cleared_for_dispensing':
      return 'ready';
    case 'dispensed':
    case 'counseled':
    case 'complete':
      return 'done';
    case 'stockout_partial_referred':
    case 'held_awaiting_clarification':
      return 'warning';
    case 'dispensing_error_recalled':
      return 'danger';
  }
}

/**
 * The dashboard's three-lane grouping (same lanes as the mobile shell):
 * Scheduled = ordered but not yet picked up by the pharmacy workflow,
 * In Office = actively being worked (review, clarification, cleared, held,
 * stockout, recall), Finished = the medication actually left the pharmacy.
 */
export function pharmacyStageGroup(stage: PrescriptionStatus): 'scheduled' | 'in_office' | 'finished' {
  switch (stage) {
    case 'prescribed':
    case 'received_in_pharmacy_queue':
      return 'scheduled';
    case 'dispensed':
    case 'counseled':
    case 'complete':
      return 'finished';
    default:
      return 'in_office';
  }
}

/**
 * An order the patient fills at a pharmacy outside this facility — the clinic
 * has no dispensary, or the prescriber sent a stocked-out order out with the
 * patient. The patient is holding a signed script for it, so it is not this
 * pharmacy's work: it must not sit in a dispensing queue, count as "awaiting
 * dispensing", or be dispensable here. Dispensing it on site as well would
 * supply the same course twice.
 */
export function isOutsidePharmacyOrder(rx: Pick<PrescriptionDoc, 'fulfilment'>): boolean {
  return rx.fulfilment === 'external';
}

/**
 * Whether an order still holds its visit at the pharmacy stage: not dispensed,
 * not stopped, and this pharmacy's to fill. An outside-pharmacy script is none
 * of that — counting it left the visit parked at `awaiting_pharmacy` waiting
 * for a dispense that can never be recorded here. (Whether the patient has
 * been handed that script is the checkout gate's question, not the queue's.)
 */
export function holdsVisitAtPharmacy(rx: Pick<PrescriptionDoc, 'status' | 'fulfilment'>): boolean {
  return rx.status !== 'dispensed' && rx.status !== 'discontinued' && !isOutsidePharmacyOrder(rx);
}

export function isFinanciallyCleared(balance?: number): boolean {
  return (balance ?? 0) <= 0;
}

export function isActivePharmacyStage(stage: PrescriptionStatus): boolean {
  return stage !== 'complete' && stage !== 'dispensing_error_recalled';
}
