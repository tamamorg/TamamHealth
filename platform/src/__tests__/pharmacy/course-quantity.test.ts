/**
 * The full-course quantity estimate the dispense workflow runs on.
 *
 * Pinned by the live failure that motivated it: a chart-header prescription of
 * "Paracetamol 500mg tablets, 1000 mg TDS × 3 days" carried no
 * `quantityToDispense`, so the workflow fell back to 1 — one tablet cleared the
 * stock gate, one was dispensed, one was deducted, for an eighteen-tablet
 * course.
 */

import {
  estimateCourseQuantity, dosesPerDay, courseDays, unitsPerDose,
} from '@/lib/pharmacy/course-quantity';

describe('the live failure case', () => {
  it('1000 mg TDS × 3 days of 500mg tablets is 18 tablets, not 1', () => {
    expect(estimateCourseQuantity({
      medication: 'Paracetamol 500mg tablets',
      dose: '1000 mg',
      frequency: 'TDS (Three times daily)',
      duration: '3',
    })).toBe(18);
  });
});

describe('an explicit prescriber quantity always wins', () => {
  it('overrides the estimate in either direction', () => {
    const rx = { medication: 'Paracetamol 500mg', dose: '1000 mg', frequency: 'TDS', duration: '3' };
    expect(estimateCourseQuantity({ ...rx, quantityToDispense: 10 })).toBe(10);
    expect(estimateCourseQuantity({ ...rx, quantityToDispense: 40 })).toBe(40);
  });

  it('ignores zero and negative values as unset', () => {
    expect(estimateCourseQuantity({
      medication: 'Paracetamol 500mg', dose: '500 mg', frequency: 'OD', duration: '2',
      quantityToDispense: 0,
    })).toBe(2);
  });
});

describe('doses per day', () => {
  it.each([
    ['OD (Once daily)', 1], ['BD (Twice daily)', 2], ['TDS (Three times daily)', 3],
    ['QDS (Four times daily)', 4], ['TID', 3], ['QID', 4], ['Nocte', 1],
    ['every 6 hours', 4], ['every 8 hours', 3], ['q12h', 2], ['8 hourly', 3],
  ])('%s → %i', (freq, expected) => {
    expect(dosesPerDay(freq)).toBe(expected);
  });

  it('falls back to 1 for the unrecognised — never to 0', () => {
    expect(dosesPerDay('PRN as needed')).toBe(1);
    expect(dosesPerDay(undefined)).toBe(1);
  });
});

describe('course days', () => {
  it('reads the leading number, with or without a unit', () => {
    expect(courseDays('3')).toBe(3);
    expect(courseDays('5 days')).toBe(5);
    expect(courseDays('5 days — take after meals')).toBe(5);
  });

  it('converts weeks', () => {
    expect(courseDays('2 weeks')).toBe(14);
  });

  it('falls back to 1 when absent', () => {
    expect(courseDays('')).toBe(1);
    expect(courseDays(undefined)).toBe(1);
  });
});

describe('units per dose', () => {
  it('divides the dose by the strength in the name', () => {
    expect(unitsPerDose('Paracetamol 500mg tablets', '1000 mg')).toBe(2);
    expect(unitsPerDose('Amoxicillin 250mg capsules', '500 mg')).toBe(2);
  });

  it('ceils a fractional dose — half a tablet still costs a tablet', () => {
    expect(unitsPerDose('Drug 400mg', '600 mg')).toBe(2);
  });

  it('degrades to 1 when units differ or either side is unparseable', () => {
    // A syrup dosed in ml against a strength in mg is not a ratio to guess at.
    expect(unitsPerDose('Amoxicillin 125mg/5ml suspension', '5 ml')).toBe(1);
    expect(unitsPerDose('Paracetamol tablets', '1000 mg')).toBe(1);
    expect(unitsPerDose('Paracetamol 500mg', 'one tablet')).toBe(1);
  });
});

describe('everything missing', () => {
  it('is the old behaviour: 1', () => {
    expect(estimateCourseQuantity({})).toBe(1);
  });
});
