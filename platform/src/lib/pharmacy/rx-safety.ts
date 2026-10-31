import type { PrescriptionDoc } from '@/lib/db-types';
import { checkAllergiesStructured, type AllergyLike, type StructuredAllergyAlert } from '@/lib/services/drug-interaction-service';

/** A safety warning (allergy, interaction, duplicate) was standing when the
 *  script was written — the pharmacist reviews these first. */
export function hasSafetyWarning(rx: Pick<PrescriptionDoc, 'medicationSafety'>): boolean {
  const s = rx.medicationSafety;
  return !!(s && (s.allergyWarnings.length || s.interactionWarnings.length || s.duplicateWarnings.length));
}

/** The shortest justification accepted for continuing past a safety stop. */
export const SAFETY_REASON_MIN_LENGTH = 10;

interface SafetyFindings {
  allergyWarnings?: Pick<StructuredAllergyAlert, 'allergy' | 'requiresOverride'>[] | null;
  interactionWarnings?: { interactions?: { drug1: string; drug2: string; severity: string }[] } | null;
}

/**
 * What the prescriber must justify in writing before the order can be saved:
 * severe or unknown-criticality allergy matches, and contraindicated
 * interactions. Everything below that tier is shown and recorded, not stopped.
 */
export function safetyStops(safety: SafetyFindings): { allergies: string[]; interactions: string[] } {
  return {
    allergies: (safety.allergyWarnings || []).filter(w => w.requiresOverride).map(w => w.allergy),
    interactions: (safety.interactionWarnings?.interactions || [])
      .filter(i => i.severity === 'contraindicated')
      .map(i => `${i.drug1} + ${i.drug2}`),
  };
}

export function hasSafetyStop(safety: SafetyFindings): boolean {
  const { allergies, interactions } = safetyStops(safety);
  return allergies.length + interactions.length > 0;
}

/** Title and message for the justification prompt, whichever stop it is. */
export function safetyStopPrompt(
  t: (key: string, params?: Record<string, string>) => string,
  medication: string,
  safety: SafetyFindings,
): { title: string; message: string } {
  const { allergies, interactions } = safetyStops(safety);
  const parts = [
    allergies.length ? t('prescribe.overrideMessage', { medication, allergy: allergies.join(', ') }) : '',
    interactions.length ? t('prescribe.overrideMessageInteraction', { medication, drugs: interactions.join(', ') }) : '',
  ].filter(Boolean);
  return {
    title: t(allergies.length ? 'prescribe.overrideTitle' : 'prescribe.overrideTitleInteraction'),
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
