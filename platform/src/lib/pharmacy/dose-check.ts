/**
 * Advisory dose check: a daily total above the usual maximum, for a short list
 * of common oral medicines.
 *
 * It WARNS and never blocks. It is not a dosing engine: it knows three drugs,
 * reads a plain milligram dose, and says nothing when it cannot be sure what
 * was ordered (a liquid in ml, a combination product, an unrecognised
 * frequency or a missing strength). Silence from this check is not approval.
 *
 * The daily ceiling for each drug is the LOWER of
 *   - the usual adult maximum per day, and
 *   - a per-kilogram daily maximum times the patient's last recorded weight
 *     (only when a recent weight is known).
 *
 * Sources (a clinician must confirm these against the facility's formulary
 * and national guideline before relying on them):
 *   - paracetamol: BNF / BNFC. Adult max 4 g in 24 h. Child 15 mg/kg per dose,
 *     at most 4 doses in 24 h = 60 mg/kg/day. WHO EML for Children agrees on
 *     10 to 15 mg/kg per dose.
 *   - ibuprofen:   BNF / BNFC. Adult max 2.4 g daily. Child 20 to 30 mg/kg
 *     daily in 3 to 4 divided doses (ceiling used: 30 mg/kg/day).
 *   - amoxicillin: BNF / BNFC. Adult oral 3 g daily (1 g three times a day).
 *     Child high-dose oral courses up to 30 mg/kg three times a day
 *     (ceiling used: 90 mg/kg/day).
 */
import { dosesPerDay } from './course-quantity';

export interface DoseLimit {
  /** Lower-case fragments that identify the drug in a free-text name. */
  match: readonly string[];
  /** Usual maximum per day for an adult, in mg. */
  adultMaxMgPerDay: number;
  /** Maximum per day per kg of body weight, in mg/kg. */
  maxMgPerKgPerDay: number;
}

export const DOSE_LIMITS: Readonly<Record<string, DoseLimit>> = {
  paracetamol: { match: ['paracetamol', 'acetaminophen'], adultMaxMgPerDay: 4000, maxMgPerKgPerDay: 60 },
  ibuprofen: { match: ['ibuprofen'], adultMaxMgPerDay: 2400, maxMgPerKgPerDay: 30 },
  amoxicillin: { match: ['amoxicillin', 'amoxycillin'], adultMaxMgPerDay: 3000, maxMgPerKgPerDay: 90 },
};

/** A weight older than this is not trusted for a per-kg limit (children grow). */
export const WEIGHT_MAX_AGE_DAYS = 90;

export interface DoseAdvisory {
  medication: string;
  drug: string;
  /** What the order adds up to, mg per day. */
  dailyMg: number;
  /** The ceiling it was compared with, mg per day. */
  limitMg: number;
  /** Which ceiling applied. */
  basis: 'adult_max' | 'per_kg';
  /** Present when basis is per_kg. */
  weightKg?: number;
}

function mgOf(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(mg|g)\b/i);
  if (!m) return null;
  const n = Number(m[1]) * (m[2].toLowerCase() === 'g' ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The milligrams in one dose: "500 mg" directly, or "2" tablets of a 500 mg product. */
function doseMg(medication: string, dose: string | undefined): number | null {
  const direct = mgOf(dose);
  if (direct) return direct;
  const count = dose?.trim().match(/^(\d+(?:\.\d+)?)\s*(?:tabs?|tablets?|caps?|capsules?)?$/i);
  const strength = mgOf(medication);
  if (count && strength) return Number(count[1]) * strength;
  return null;
}

/** Null when nothing is wrong, or when the order cannot be read with confidence. */
export function checkDoseAdvisory(input: {
  medication: string;
  dose?: string;
  frequency?: string;
  weightKg?: number | null;
}): DoseAdvisory | null {
  const name = input.medication.toLowerCase();
  if (/[/+]|clav|codeine|\bwith\b/.test(name)) return null; // a combination product
  const drug = Object.keys(DOSE_LIMITS).find(key => DOSE_LIMITS[key].match.some(m => name.includes(m)));
  if (!drug) return null;
  if (!input.frequency || !input.frequency.trim()) return null;
  const perDose = doseMg(input.medication, input.dose);
  if (!perDose) return null;
  const dailyMg = Math.round(perDose * dosesPerDay(input.frequency));
  const limit = DOSE_LIMITS[drug];
  const weight = typeof input.weightKg === 'number' && input.weightKg > 0 ? input.weightKg : null;
  const perKgLimit = weight ? Math.round(limit.maxMgPerKgPerDay * weight) : null;
  const useWeight = perKgLimit !== null && perKgLimit < limit.adultMaxMgPerDay;
  const limitMg = useWeight ? perKgLimit : limit.adultMaxMgPerDay;
  if (dailyMg <= limitMg) return null;
  return {
    medication: input.medication,
    drug,
    dailyMg,
    limitMg,
    basis: useWeight ? 'per_kg' : 'adult_max',
    ...(useWeight && weight ? { weightKg: weight } : {}),
  };
}
