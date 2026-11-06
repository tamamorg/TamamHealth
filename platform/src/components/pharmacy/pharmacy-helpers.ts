import type { PrescriptionStatus } from '@/lib/clinical-flow/order-lifecycles';
import { isControlledMedicine } from '@/lib/data/formulary';

export const UNITS = ['tablets', 'vials', 'bottles', 'sachets', 'tubes', 'ampoules', 'sachet', 'ml'];

/**
 * Whether a stocked batch must require a second-person witness to dispense:
 * the pharmacist assigned a controlled schedule, OR the medicine is a
 * recognised controlled substance by its drug class. The second arm is the
 * safety net — a narcotic stocked without a schedule (morphine typed into the
 * receive-stock form) still can't be dispensed with no witness, which was the
 * headline gap in the 2026-11-05 security audit (§2.1 #7). Dispensing enforces
 * the witness whenever the batch carries requiresWitness or a controlledSchedule.
 */
export function stockRequiresWitness(medicationName: string, schedule: string | undefined): boolean {
  return !!schedule || isControlledMedicine(medicationName);
}

export type PharmacyTab = 'queue' | 'inventory' | 'reorder' | 'expiry' | 'overview' | 'patients';

/**
 * The prescription sig for display.
 *
 * Seeded and clinician-entered `dose` values often already carry the whole sig
 * ("1g QDS PRN x 5 days") while `frequency` and `duration` repeat those same
 * parts as separate fields. Concatenating all three printed the tail twice —
 * "1g QDS PRN x 5 days QDS PRN x 5 days" — which is both wrong and what made
 * the Dosage column the widest one on the page. Only append a part the dose
 * does not already state.
 */
/* The registry/appointments pill vocabulary mapped onto the pharmacy ladder,
   exactly as the lab queue maps its bench stages: waiting reads calm blue,
   active reads active, cleared reads ready, closed goes green, holds and
   recalls take the attention/danger tones. */
export const RX_STAGE_PILL_CLASS: Record<PrescriptionStatus, string> = {
  prescribed: 'status-scheduled',
  received_in_pharmacy_queue: 'status-scheduled',
  under_review: 'status-checked-in',
  clinician_consultation_in_progress: 'status-in-progress',
  cleared_for_dispensing: 'status-confirmed',
  dispensed: 'status-completed',
  counseled: 'status-completed',
  complete: 'status-completed',
  stockout_partial_referred: 'status-attention',
  held_awaiting_clarification: 'status-attention',
  dispensing_error_recalled: 'status-cancelled',
};

export function prescriptionSig(rx: { dose?: string; frequency?: string; duration?: string }): string {
  const dose = (rx.dose || '').trim();
  const stated = dose.toLowerCase();
  const extras = [rx.frequency?.trim(), rx.duration?.trim() ? `x ${rx.duration.trim()}` : '']
    .filter((part): part is string => !!part)
    .filter(part => !stated.includes(part.replace(/^x /i, '').toLowerCase()));
  return [dose, ...extras].filter(Boolean).join(' ');
}
