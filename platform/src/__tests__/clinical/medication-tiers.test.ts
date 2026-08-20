/**
 * @jest-environment node
 *
 * Medication criticality tiers (Principle 2.11) resolved for real orders.
 *
 * Before this existed, `MEDICATION_CRITICALITY_TIERS` had no consumer anywhere
 * in the app and `TIER1_CHECKOUT_SAFETY_RULE` was a sentence asserted only as a
 * string in a test that matched its own wording. Nothing the tiers are supposed
 * to drive — pharmacy queue priority, the checkout safety flag, the stockout
 * response — could be built until a medication could actually be classified.
 *
 * Classification is by WHO ATC prefix, not drug name, so these cases pin the
 * class boundaries rather than a spelling.
 */

import {
  tierForMedicationName,
  resolvePrescriptionTier,
  isTier1,
  comparePharmacyPriority,
} from '@/lib/clinical-flow/medication-tiers';

describe('tier classification by ATC class', () => {
  test.each([
    ['Insulin (soluble/regular)', 1],   // A10AB01 — insulins
    ['Insulin (isophane/NPH)', 1],      // A10AC01
    ['Phenobarbital', 1],               // N03AA02 — antiepileptics
    ['Sodium valproate', 1],            // N03AG01
    ['Digoxin', 1],                     // C01AA05 — cardiac glycoside
    ['Magnesium sulfate', 1],           // B05XA05 — eclampsia anticonvulsant
  ])('%s is life-sustaining (Tier 1)', (medication, tier) => {
    expect(tierForMedicationName(medication)).toBe(tier);
  });

  test.each([
    ['Tenofovir-Lamivudine-Dolutegravir (TLD)', 2], // J05AR27 — ART
    ['Isoniazid', 2],                               // J04AC01 — anti-TB
    ['Metformin', 2],                               // A10BA02 — oral hypoglycaemic
    ['Amlodipine', 2],                              // C08CA01 — antihypertensive
    ['Furosemide', 2],                              // C03CA01 — diuretic
    ['Lisinopril', 2],                              // C09AA03 — ACE inhibitor
  ])('%s is important and time-sensitive (Tier 2)', (medication, tier) => {
    expect(tierForMedicationName(medication)).toBe(tier);
  });

  test.each([
    ['Vitamin A (retinol)', 3],  // A11CA01
    ['Amoxicillin', 3],          // J01CA04
    ['Paracetamol', 3],
  ])('%s is routine (Tier 3)', (medication, tier) => {
    expect(tierForMedicationName(medication)).toBe(tier);
  });

  test('A10A insulins and A10B oral agents do not collide', () => {
    // Adjacent ATC prefixes, deliberately different tiers — insulin cannot be
    // interrupted for a day, metformin can.
    expect(tierForMedicationName('Insulin (soluble/regular)')).toBe(1);
    expect(tierForMedicationName('Metformin')).toBe(2);
  });

  test('a medication the formulary does not carry is unknown, not routine', () => {
    // Distinct from Tier 3 so callers can tell "we checked, it is routine"
    // from "we have never heard of this". The two must not read the same.
    expect(tierForMedicationName('Novadrine XR 40mg')).toBeNull();
  });
});

describe('resolving the tier to record on a prescription', () => {
  test('an unrecognised medication falls to routine', () => {
    expect(resolvePrescriptionTier('Novadrine XR 40mg')).toBe(3);
  });

  test("the prescriber's explicit tier beats the catalogue", () => {
    // The formulary cannot carry every product a facility stocks. A clinician
    // marking a free-text order life-sustaining is making a clinical call the
    // catalogue is not entitled to overrule.
    expect(resolvePrescriptionTier('Novadrine XR 40mg', 1)).toBe(1);
    expect(resolvePrescriptionTier('Vitamin A (retinol)', 1)).toBe(1);
  });

  test('isTier1 reads the recorded tier, then the catalogue', () => {
    expect(isTier1({ medication: 'Insulin (soluble/regular)' })).toBe(true);
    expect(isTier1({ medication: 'Vitamin A (retinol)' })).toBe(false);
    expect(isTier1({ medication: 'Novadrine XR 40mg', criticalityTier: 1 })).toBe(true);
    // An unknown drug is never *asserted* life-sustaining on its own.
    expect(isTier1({ medication: 'Novadrine XR 40mg' })).toBe(false);
  });
});

describe('pharmacy queue priority', () => {
  const rx = (medication: string, createdAt: string) => ({ medication, createdAt });

  test('life-sustaining orders are worked before routine ones', () => {
    const queue = [
      rx('Vitamin A (retinol)', '2026-08-19T08:00:00.000Z'),
      rx('Insulin (soluble/regular)', '2026-08-19T11:00:00.000Z'),
      rx('Metformin', '2026-08-19T09:00:00.000Z'),
    ].sort(comparePharmacyPriority);

    expect(queue.map(r => r.medication)).toEqual([
      'Insulin (soluble/regular)', // Tier 1, despite arriving last
      'Metformin',                 // Tier 2
      'Vitamin A (retinol)',       // Tier 3
    ]);
  });

  test('inside a tier the oldest order goes first, so nothing starves', () => {
    const queue = [
      rx('Sodium valproate', '2026-08-19T11:00:00.000Z'),
      rx('Insulin (soluble/regular)', '2026-08-19T07:30:00.000Z'),
      rx('Digoxin', '2026-08-19T09:15:00.000Z'),
    ].sort(comparePharmacyPriority);

    expect(queue.map(r => r.medication)).toEqual([
      'Insulin (soluble/regular)',
      'Digoxin',
      'Sodium valproate',
    ]);
  });
});
