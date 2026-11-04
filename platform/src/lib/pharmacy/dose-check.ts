/**
 * Advisory dose check: a daily total above the usual maximum, for common oral
 * medicines and the narrow-margin ones most worth catching.
 *
 * It WARNS and never blocks. It is not a dosing engine: it covers a short list,
 * reads a plain milligram dose, and says nothing when it cannot be sure what
 * was ordered (a liquid in ml, a combination product, an unrecognised
 * frequency or a missing strength). Silence from this check is not approval.
 *
 * The daily ceiling for each drug is the LOWER of
 *   - the usual adult maximum per day, and
 *   - a per-kilogram daily maximum times the patient's last recorded weight
 *     (only when a recent weight is known).
 *
 * Sources (a clinician must confirm these against the national guideline
 * before relying on them): the US prescribing label (openFDA / DailyMed, read
 * 2026-11-03) for every drug marked `us-label`: the adult daily maximum the
 * label states, and its per-kilogram ceiling where it gives one. Amoxicillin's
 * label states no daily maximum, so its ceiling is the BNF figure. Left out on
 * purpose: drugs whose labelled ceiling is too high to catch anything
 * (haloperidol, chlorpromazine), and fluconazole, whose 400 mg label ceiling
 * sits below the 1200 mg WHO cryptococcal meningitis induction dose.
 */
import { dosesPerDay } from './course-quantity';

export interface DoseLimit {
  /** Lower-case fragments that identify the drug in a free-text name. */
  match: readonly string[];
  /** Usual maximum per day for an adult, in mg. */
  adultMaxMgPerDay?: number;
  /** Maximum per day per kg of body weight, in mg/kg. */
  maxMgPerKgPerDay?: number;
  /** `us-label`: the US prescribing label states it. `other`: the label is
   *  silent, so it comes from the BNF / WHO. */
  source: 'us-label' | 'other';
}

export const DOSE_LIMITS: Readonly<Record<string, DoseLimit>> = {
  paracetamol: { match: ['paracetamol', 'acetaminophen'], adultMaxMgPerDay: 4000, maxMgPerKgPerDay: 75, source: 'us-label' },
  ibuprofen: { match: ['ibuprofen'], adultMaxMgPerDay: 3200, maxMgPerKgPerDay: 40, source: 'us-label' },
  amoxicillin: { match: ['amoxicillin', 'amoxycillin'], adultMaxMgPerDay: 3000, maxMgPerKgPerDay: 90, source: 'other' },
  erythromycin: { match: ['erythromycin'], adultMaxMgPerDay: 4000, source: 'us-label' },
  isoniazid: { match: ['isoniazid'], adultMaxMgPerDay: 300, source: 'us-label' },
  pyrazinamide: { match: ['pyrazinamide'], adultMaxMgPerDay: 3000, source: 'us-label' },
  loperamide: { match: ['loperamide'], adultMaxMgPerDay: 16, source: 'us-label' },
  tramadol: { match: ['tramadol'], adultMaxMgPerDay: 400, source: 'us-label' },
  amlodipine: { match: ['amlodipine'], adultMaxMgPerDay: 10, source: 'us-label' },
  furosemide: { match: ['furosemide', 'frusemide'], adultMaxMgPerDay: 600, source: 'us-label' },
  enalapril: { match: ['enalapril'], adultMaxMgPerDay: 40, source: 'us-label' },
  lisinopril: { match: ['lisinopril'], adultMaxMgPerDay: 40, source: 'us-label' },
  captopril: { match: ['captopril'], adultMaxMgPerDay: 450, source: 'us-label' },
  losartan: { match: ['losartan'], adultMaxMgPerDay: 100, source: 'us-label' },
  atenolol: { match: ['atenolol'], adultMaxMgPerDay: 100, source: 'us-label' },
  carvedilol: { match: ['carvedilol'], adultMaxMgPerDay: 100, source: 'us-label' },
  labetalol: { match: ['labetalol'], adultMaxMgPerDay: 2400, source: 'us-label' },
  methyldopa: { match: ['methyldopa'], adultMaxMgPerDay: 3000, maxMgPerKgPerDay: 65, source: 'us-label' },
  atorvastatin: { match: ['atorvastatin'], adultMaxMgPerDay: 80, source: 'us-label' },
  metformin: { match: ['metformin'], adultMaxMgPerDay: 2550, source: 'us-label' },
  glibenclamide: { match: ['glibenclamide', 'glyburide'], adultMaxMgPerDay: 20, source: 'us-label' },
  glimepiride: { match: ['glimepiride'], adultMaxMgPerDay: 8, source: 'us-label' },
  aminophylline: { match: ['aminophylline'], adultMaxMgPerDay: 900, source: 'us-label' },
  levetiracetam: { match: ['levetiracetam'], adultMaxMgPerDay: 3000, source: 'us-label' },
  carbamazepine: { match: ['carbamazepine'], adultMaxMgPerDay: 1600, source: 'us-label' },
  valproate: { match: ['valproate', 'valproic'], maxMgPerKgPerDay: 60, source: 'us-label' },
  fluoxetine: { match: ['fluoxetine'], adultMaxMgPerDay: 80, source: 'us-label' },
  sertraline: { match: ['sertraline'], adultMaxMgPerDay: 200, source: 'us-label' },
  clomipramine: { match: ['clomipramine'], adultMaxMgPerDay: 250, source: 'us-label' },
  clozapine: { match: ['clozapine'], adultMaxMgPerDay: 900, source: 'us-label' },
  risperidone: { match: ['risperidone'], adultMaxMgPerDay: 16, source: 'us-label' },
  olanzapine: { match: ['olanzapine'], adultMaxMgPerDay: 20, source: 'us-label' },
  itraconazole: { match: ['itraconazole'], adultMaxMgPerDay: 400, source: 'us-label' },
  abacavir: { match: ['abacavir'], adultMaxMgPerDay: 600, source: 'us-label' },
  ritonavir: { match: ['ritonavir'], adultMaxMgPerDay: 1200, source: 'us-label' },
  allopurinol: { match: ['allopurinol'], adultMaxMgPerDay: 800, source: 'us-label' },
  colchicine: { match: ['colchicine'], adultMaxMgPerDay: 1.8, source: 'us-label' },
  azathioprine: { match: ['azathioprine'], maxMgPerKgPerDay: 2.5, source: 'us-label' },
  thalidomide: { match: ['thalidomide'], adultMaxMgPerDay: 400, source: 'us-label' },
  imatinib: { match: ['imatinib'], adultMaxMgPerDay: 800, source: 'us-label' },
  bupivacaine: { match: ['bupivacaine'], adultMaxMgPerDay: 400, source: 'us-label' },
  deferoxamine: { match: ['deferoxamine', 'desferrioxamine'], adultMaxMgPerDay: 6000, source: 'us-label' },
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
  // Hundredths, so a 0.6 mg dose three times a day is 1.8 mg and not 2.
  const dailyMg = Math.round(perDose * dosesPerDay(input.frequency) * 100) / 100;
  const limit = DOSE_LIMITS[drug];
  const adultMax = limit.adultMaxMgPerDay ?? Infinity;
  const weight = typeof input.weightKg === 'number' && input.weightKg > 0 ? input.weightKg : null;
  const perKgLimit = weight && limit.maxMgPerKgPerDay ? Math.round(limit.maxMgPerKgPerDay * weight) : null;
  const useWeight = perKgLimit !== null && perKgLimit < adultMax;
  const limitMg = useWeight ? perKgLimit : adultMax;
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
