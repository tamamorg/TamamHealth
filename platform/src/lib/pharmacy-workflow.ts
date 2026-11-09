import type { PrescriptionStatus } from './clinical-flow/order-lifecycles';
import type { PrescriptionDoc } from './db-types';
import { isTier1 } from './clinical-flow/medication-tiers';
import { isStatFrequency } from './clinical-flow/medication-schedule';
import type { VisitBilling } from './visits/visit-details';

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

/**
 * Why a dispense may go ahead with the charge still open. Pay-before-dispense
 * is the default; these are the cases where holding the medicine would be
 * holding care: a life-sustaining (Tier 1) medicine, a STAT order, an
 * emergency (red triage, or an emergency exemption), and a patient who does
 * not pay at the till (exempt/waived, or covered by insurance).
 */
export type PaymentRelease = 'life_sustaining' | 'stat' | 'emergency' | 'exempt' | 'insured';

/** What the visit says about who pays and how urgent it is. */
export interface PaymentReleaseContext {
  triagePriority?: string;
  visitBilling?: Pick<VisitBilling, 'payment' | 'method' | 'exemption'>;
  /**
   * What the patient still owes themselves for this visit's insured charges
   * (the copay), when known. An insured patient with a copay to pay is held
   * like any other; unknown is treated as owed.
   */
  insuredCopayOwed?: number;
}

export function paymentReleaseFor(
  rx: Pick<PrescriptionDoc, 'medication' | 'criticalityTier' | 'frequency'>,
  ctx: PaymentReleaseContext = {},
): PaymentRelease | null {
  if (isTier1(rx)) return 'life_sustaining';
  if (isStatFrequency(rx.frequency || '')) return 'stat';
  if (ctx.triagePriority === 'RED' || ctx.visitBilling?.exemption === 'emergency') return 'emergency';
  if (ctx.visitBilling?.payment === 'non_paying') return 'exempt';
  // Insurance releases only what the insurer covers: a patient who still owes
  // a copay on this visit is held as routine until it is paid.
  if (ctx.visitBilling?.payment === 'paying' && ctx.visitBilling.method === 'insurance'
      && ctx.insuredCopayOwed !== undefined && ctx.insuredCopayOwed <= 0) return 'insured';
  return null;
}

/**
 * Whether a dispense must wait for payment: `'due'` when money is owed,
 * `'unknown'` when the balance could not be read (`null` — fail closed, an
 * unread balance is never treated as paid), or `null` to go ahead.
 *
 * A release (see `paymentReleaseFor`) is never held, owed or unread: the
 * charge stays open on the bill and the dispense is marked as made before
 * payment. A life-sustaining (Tier 1) medicine is always released — the
 * Tier-1 rule outranks payment status outright.
 */
export function paymentHoldFor(
  rx: Pick<PrescriptionDoc, 'medication' | 'criticalityTier'>,
  balance: number | null,
  release: PaymentRelease | null = null,
): 'due' | 'unknown' | null {
  if (isTier1(rx) || release) return null;
  if (balance === null) return 'unknown';
  return isFinanciallyCleared(balance) ? null : 'due';
}

export function isActivePharmacyStage(stage: PrescriptionStatus): boolean {
  return stage !== 'complete' && stage !== 'dispensing_error_recalled';
}
