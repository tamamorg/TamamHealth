import type { PrescriptionDoc } from '@/lib/db-types';

/** A safety warning (allergy, interaction, duplicate) was standing when the
 *  script was written — the pharmacist reviews these first. */
export function hasSafetyWarning(rx: Pick<PrescriptionDoc, 'medicationSafety'>): boolean {
  const s = rx.medicationSafety;
  return !!(s && (s.allergyWarnings.length || s.interactionWarnings.length || s.duplicateWarnings.length));
}
