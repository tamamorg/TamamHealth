/**
 * Medication criticality tiers (Principle 2.11) — resolved for a real
 * prescription rather than described.
 *
 * `payment-model.ts` defines what the three tiers MEAN. This module answers
 * "which tier is this medication?", which is what the pharmacy queue, the
 * checkout safety flag and the stockout response all need before any of them
 * can be built. Until this existed, `MEDICATION_CRITICALITY_TIERS` had no
 * consumer at all and `TIER1_CHECKOUT_SAFETY_RULE` was a sentence no code read.
 *
 * Keyed on the formulary's WHO ATC classification, not on drug names. Names
 * are written a dozen ways ("Insulin (soluble/regular)", "insulin regular",
 * "Actrapid") and a name-matching table would silently miss the one spelling
 * that mattered; an ATC prefix covers a whole therapeutic class exactly.
 *
 * Deliberately conservative: only the classes Principle 2.11 actually names
 * are promoted above Tier 3, plus magnesium sulfate (see below). Widening the
 * table is a clinical decision, so it is a data edit here rather than a rule
 * spread through the UI.
 */

import { atcForMedication } from '../data/formulary';
import type { CriticalityTier } from './payment-model';

/**
 * Tier 1 — life-sustaining. Principle 2.11 names insulin, anti-epileptics and
 * "certain cardiac medications". Interruption is measured in hours to days.
 */
const TIER_1_ATC_PREFIXES: readonly string[] = [
  'A10A', // insulins and analogues
  'N03A', // antiepileptics
  'C01A', // cardiac glycosides (digoxin)
  'C01B', // antiarrhythmics, class I and III
  'C01C', // cardiac stimulants excl. glycosides (adrenaline, dopamine)
  'C01D', // vasodilators used in cardiac disease (nitrates)
  'C01E', // other cardiac preparations
  // Magnesium sulfate is filed under electrolytes (B05XA05), not N03A, but the
  // formulary itself categorises it "Anticonvulsant (eclampsia)" and it is the
  // WHO first-line for eclamptic seizures. Classified by what it is used for.
  'B05XA05',
];

/**
 * Tier 2 — important, time-sensitive. Principle 2.11 names ART, TB
 * medications, antihypertensives and oral hypoglycaemics. Interruption is
 * measured in days to weeks, and drives adherence/defaulter tracing.
 */
const TIER_2_ATC_PREFIXES: readonly string[] = [
  'J05A', // direct-acting antivirals incl. antiretrovirals
  'J04A', // drugs for treatment of tuberculosis
  'A10B', // blood-glucose-lowering drugs excl. insulins
  'C02',  // antihypertensives
  'C03',  // diuretics
  'C07',  // beta blocking agents
  'C08',  // calcium channel blockers
  'C09',  // agents acting on the renin-angiotensin system
];

const DEFAULT_TIER: CriticalityTier = 3;

/**
 * The tier a medication falls in, from its formulary ATC code.
 *
 * Returns `null` — NOT Tier 3 — for a medication the formulary does not carry,
 * so callers can tell "routine" from "unknown". They are different: a free-text
 * medication that happens to be insulin must not be silently reported routine.
 * `resolvePrescriptionTier` below is where that judgement is made.
 */
export function tierForMedicationName(medication: string): CriticalityTier | null {
  const atc = atcForMedication(medication);
  if (!atc) return null;
  const code = atc.toUpperCase();
  if (TIER_1_ATC_PREFIXES.some(p => code.startsWith(p))) return 1;
  if (TIER_2_ATC_PREFIXES.some(p => code.startsWith(p))) return 2;
  return DEFAULT_TIER;
}

/**
 * The tier to record on a prescription.
 *
 * An explicit tier from the prescriber always wins: the formulary cannot cover
 * every product a facility stocks, and a clinician who marks a free-text order
 * life-sustaining is making a clinical call the catalogue is not entitled to
 * overrule. Otherwise the ATC classification decides, and an unrecognised
 * medication falls to Tier 3 — the safe direction for QUEUE PRIORITY, which is
 * the only place an unknown tier is treated as routine. The checkout safety
 * flag reads `isTier1` instead, which is false for unknowns, so an unrecognised
 * drug is never *asserted* to be life-sustaining either.
 */
export function resolvePrescriptionTier(
  medication: string,
  explicitTier?: CriticalityTier,
): CriticalityTier {
  if (explicitTier) return explicitTier;
  return tierForMedicationName(medication) ?? DEFAULT_TIER;
}

/** True when this prescription is life-sustaining (Tier 1). */
export function isTier1(rx: { medication: string; criticalityTier?: CriticalityTier }): boolean {
  return resolvePrescriptionTier(rx.medication, rx.criticalityTier) === 1;
}

/**
 * Queue ordering comparator (Principle 2.9 + 2.11): Tier 1 first, then by how
 * long the order has waited, so a Tier-1 order never sits behind a vitamin and
 * nothing inside a tier can starve.
 */
export function comparePharmacyPriority(
  a: { medication: string; criticalityTier?: CriticalityTier; createdAt?: string },
  b: { medication: string; criticalityTier?: CriticalityTier; createdAt?: string },
): number {
  const tierA = resolvePrescriptionTier(a.medication, a.criticalityTier);
  const tierB = resolvePrescriptionTier(b.medication, b.criticalityTier);
  if (tierA !== tierB) return tierA - tierB;
  return (a.createdAt || '').localeCompare(b.createdAt || '');
}
