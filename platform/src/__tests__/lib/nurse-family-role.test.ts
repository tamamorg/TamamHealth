/**
 * The "nurse family" role set was duplicated inline in ~8 places; it now has
 * one home in clinical-roles (modularization 2026-11, Phase 1 dedup). This pins
 * the exact membership so a future edit can't silently widen or narrow it — the
 * duplicates that intentionally differ (clinical_officer-inclusive, or
 * {nurse,midwife} only) were deliberately NOT folded into this set.
 */
import { NURSE_FAMILY_ROLES, isNurseFamilyRole } from '@/lib/clinical-roles';

describe('nurse family roles', () => {
  it('is exactly nurse, midwife, triage_nurse, rooming_nurse', () => {
    expect([...NURSE_FAMILY_ROLES].sort()).toEqual(['midwife', 'nurse', 'rooming_nurse', 'triage_nurse']);
  });

  it('isNurseFamilyRole matches the set and nothing else', () => {
    for (const r of NURSE_FAMILY_ROLES) expect(isNurseFamilyRole(r)).toBe(true);
    for (const r of ['doctor', 'clinical_officer', 'pharmacist', 'front_desk', 'nutritionist']) {
      expect(isNurseFamilyRole(r)).toBe(false);
    }
  });

  it('is safe for undefined / null', () => {
    expect(isNurseFamilyRole(undefined)).toBe(false);
    expect(isNurseFamilyRole(null)).toBe(false);
    expect(isNurseFamilyRole('')).toBe(false);
  });
});
