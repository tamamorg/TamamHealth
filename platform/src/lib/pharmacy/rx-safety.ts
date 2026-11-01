import type { PrescriptionDoc } from '@/lib/db-types';
import { checkAllergiesStructured, checkNewPrescription, type AllergyLike, type StructuredAllergyAlert } from '@/lib/services/drug-interaction-service';

/** A safety warning (allergy, interaction, duplicate) was standing when the
 *  script was written — the pharmacist reviews these first. */
export function hasSafetyWarning(rx: Pick<PrescriptionDoc, 'medicationSafety'>): boolean {
  const s = rx.medicationSafety;
  return !!(s && (s.allergyWarnings.length || s.interactionWarnings.length || s.duplicateWarnings.length || s.doseWarnings?.length));
}

/** The shortest justification accepted for continuing past a safety stop. */
export const SAFETY_REASON_MIN_LENGTH = 10;

interface SafetyFindings {
  allergyWarnings?: Pick<StructuredAllergyAlert, 'allergy' | 'requiresOverride'>[] | null;
  interactionWarnings?: { interactions?: { drug1: string; drug2: string; severity: string }[] } | null;
  /** The medicine is meant to be taken weekly and this order says otherwise. */
  weeklyOnly?: boolean;
}

/**
 * Methotrexate is taken once a week for most uses, and the same tablet taken
 * daily by mistake is a recognised fatal error, so anything else is a stop.
 */
export function needsWeeklyReview(medication: string, frequency?: string): boolean {
  if (!/methotrexate/i.test(medication) || !frequency?.trim()) return false;
  return !/week|\b1\s*\/\s*7\b/i.test(frequency);
}

/**
 * What the prescriber must justify in writing before the order can be saved:
 * severe or unknown-criticality allergy matches, and contraindicated
 * interactions. Everything below that tier is shown and recorded, not stopped.
 */
export function safetyStops(safety: SafetyFindings): { allergies: string[]; interactions: string[]; weeklyOnly: boolean } {
  return {
    weeklyOnly: Boolean(safety.weeklyOnly),
    allergies: (safety.allergyWarnings || []).filter(w => w.requiresOverride).map(w => w.allergy),
    interactions: (safety.interactionWarnings?.interactions || [])
      .filter(i => i.severity === 'contraindicated')
      .map(i => `${i.drug1} + ${i.drug2}`),
  };
}

export function hasSafetyStop(safety: SafetyFindings): boolean {
  const { allergies, interactions, weeklyOnly } = safetyStops(safety);
  return allergies.length > 0 || interactions.length > 0 || weeklyOnly;
}

/** Title and message for the justification prompt, whichever stop it is. */
export function safetyStopPrompt(
  t: (key: string, params?: Record<string, string>) => string,
  medication: string,
  safety: SafetyFindings,
): { title: string; message: string } {
  const { allergies, interactions, weeklyOnly } = safetyStops(safety);
  const parts = [
    allergies.length ? t('prescribe.overrideMessage', { medication, allergy: allergies.join(', ') }) : '',
    interactions.length ? t('prescribe.overrideMessageInteraction', { medication, drugs: interactions.join(', ') }) : '',
    weeklyOnly ? t('prescribe.overrideMessageWeekly', { medication }) : '',
  ].filter(Boolean);
  return {
    title: t(allergies.length ? 'prescribe.overrideTitle' : interactions.length ? 'prescribe.overrideTitleInteraction' : 'prescribe.overrideTitleWeekly'),
    message: parts.join(' '),
  };
}

/**
 * Allergies the pharmacist has not yet seen answered: severe or unknown matches
 * against the patient's allergies now, leaving out any the prescriber or an
 * earlier fill already justified. An allergy recorded after the order was
 * written is the case this exists for.
 */
export function unreviewedAllergyConflicts(
  rx: Pick<PrescriptionDoc, 'medication' | 'medicationSafety' | 'dispenseAllergyReview'>,
  allergies: AllergyLike[],
): StructuredAllergyAlert[] {
  const answered = new Set<string>(rx.dispenseAllergyReview?.allergies || []);
  if (rx.medicationSafety?.acknowledgement) {
    for (const warning of rx.medicationSafety.allergyWarnings) answered.add(warning.allergy);
  }
  return checkAllergiesStructured([rx.medication], allergies)
    .filter(alert => alert.requiresOverride && !answered.has(alert.allergy));
}

/**
 * Contraindicated pairs on this order that nobody has answered: the prescriber
 * who wrote either medicine, or an earlier fill. `orders` is the patient's other
 * prescriptions, so a pair justified on one half does not stop the other.
 */
export function unreviewedInteractionConflicts(
  rx: Pick<PrescriptionDoc, 'medication' | 'medicationSafety' | 'dispenseAllergyReview'>,
  currentMedications: string[],
  orders: Pick<PrescriptionDoc, 'medicationSafety' | 'dispenseAllergyReview'>[] = [],
): string[] {
  const answered = new Set<string>();
  for (const order of [rx, ...orders]) {
    for (const pair of order.dispenseAllergyReview?.interactions || []) answered.add(pair);
    if (order.medicationSafety?.acknowledgement) {
      for (const i of order.medicationSafety.interactionWarnings) answered.add(`${i.drug1} + ${i.drug2}`);
    }
  }
  return checkNewPrescription(rx.medication, currentMedications).interactions
    .filter(i => i.severity === 'contraindicated')
    .map(i => `${i.drug1} + ${i.drug2}`)
    .filter(pair => !answered.has(pair));
}

/** One advisory dose line, worded for the prescriber. */
export function doseWarningText(
  t: (key: string, params?: Record<string, string>) => string,
  warning: { medication: string; dailyMg: number; limitMg: number; basis: 'adult_max' | 'per_kg'; weightKg?: number },
): string {
  const params = {
    medication: warning.medication,
    daily: String(warning.dailyMg),
    limit: String(warning.limitMg),
    weight: String(warning.weightKg ?? ''),
  };
  return t(warning.basis === 'per_kg' ? 'prescribe.doseAboveMaxWeight' : 'prescribe.doseAboveMax', params);
}
