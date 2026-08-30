/**
 * `patientAgeYearsExact` (lib/patient-utils.ts) — the fractional-year age
 * `getTriageVitalWarnings` needs.
 *
 * `patientAge()` rounds down to whole years, so every infant under 12 months
 * reads as age 0 — which made IITT's "<2 months" neonatal-emergency
 * temperature check fire for a 5-, 7- or 11-month-old (all "age 0"), and
 * meant none of them could ever reach WHO's 6–59-month MUAC screen (which
 * needs `age >= 0.5`). These pin the fractional value at exactly the
 * boundaries that distinguish those bands.
 */
import { patientAgeYearsExact } from '@/lib/patient-utils';
import { toIsoDate } from '@/lib/date-utils';

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toIsoDate(d);
}

describe('patientAgeYearsExact', () => {
  test('a 5-month-old is well under the 6-month (0.5y) MUAC/infant-YELLOW boundary', () => {
    const years = patientAgeYearsExact({ dateOfBirth: daysAgoIso(152) }); // ~5 months
    expect(years).not.toBeNull();
    expect(years!).toBeGreaterThan(0.35);
    expect(years!).toBeLessThan(0.5);
  });

  test('a 7-month-old is past the 6-month boundary — eligible for the MUAC screen', () => {
    const years = patientAgeYearsExact({ dateOfBirth: daysAgoIso(213) }); // ~7 months
    expect(years!).toBeGreaterThanOrEqual(0.5);
    expect(years!).toBeLessThan(1);
  });

  test('an 11-month-old is still under 1 year, but past the 6-month MUAC boundary', () => {
    const years = patientAgeYearsExact({ dateOfBirth: daysAgoIso(335) }); // ~11 months
    expect(years!).toBeGreaterThanOrEqual(0.5);
    expect(years!).toBeLessThan(1);
    // The bug this fixes: `patientAge()` (whole years) reads this same
    // record as exactly 0 — indistinguishable from a newborn.
  });

  test('a 1-day-old is under the IITT 8-day RED cutoff', () => {
    const years = patientAgeYearsExact({ dateOfBirth: daysAgoIso(1) });
    expect(years!).toBeLessThan(8 / 365.25);
    expect(years!).toBeGreaterThan(0);
  });

  test('a 13-year-old lands comfortably in the adult (>=12y) chart-selection band', () => {
    const years = patientAgeYearsExact({ dateOfBirth: daysAgoIso(13 * 365.25) });
    expect(years!).toBeGreaterThanOrEqual(12);
    expect(years!).toBeLessThan(14);
  });

  test('falls back to estimatedAge (imprecise, whole years) when there is no dateOfBirth', () => {
    expect(patientAgeYearsExact({ estimatedAge: 34 })).toBe(34);
  });

  test('dateOfBirth takes precedence over estimatedAge when both are present', () => {
    const years = patientAgeYearsExact({ dateOfBirth: daysAgoIso(365 * 10), estimatedAge: 99 });
    expect(years!).toBeGreaterThan(9.9);
    expect(years!).toBeLessThan(10.1);
  });

  test('returns null when age is genuinely unknown', () => {
    expect(patientAgeYearsExact({})).toBeNull();
    expect(patientAgeYearsExact({ estimatedAge: 0 })).toBeNull();
  });

  test('a future dateOfBirth (bad data) does not produce a negative age', () => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    expect(patientAgeYearsExact({ dateOfBirth: toIsoDate(d) })).toBeNull();
  });
});
