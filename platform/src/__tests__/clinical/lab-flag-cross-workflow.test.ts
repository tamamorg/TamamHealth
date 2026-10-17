/**
 * The lab dashboard's batch entry used to carry its own critical table
 * (Hb < 7, WBC < 2000/µL, creatinine > 5 mg/dL…) that disagreed with the QC
 * table the result-entry workflow and SMS alerts use. Both now read the QC
 * table; these tests pin that a value is critical in one workflow iff it is
 * critical in the other, across the unit conversions the dashboard needs.
 */
import {
  flagLabResult,
  evaluateCritical,
  getLabReferenceRange,
  criticalBoundsInEntryUnit,
  LAB_REFERENCE_RANGES,
} from '@/lib/services/lab-critical-flag';

describe('dashboard flagging uses the QC critical table', () => {
  it.each([
    // [test, dashboard-entry value, expected flag]
    ['Hemoglobin', '5', 'CRITICAL'],    // QC: ≤ 5 is critical (inclusive)
    ['Hemoglobin', '6', 'ABNORMAL'],    // old dashboard called < 7 critical
    ['Hemoglobin', '20', 'CRITICAL'],
    ['Hemoglobin', '14', 'NORMAL'],
    ['WBC', '1000', 'CRITICAL'],        // 1.0 ×10⁹/L
    ['WBC', '1500', 'ABNORMAL'],        // old dashboard: critical below 2000
    ['WBC', '50000', 'CRITICAL'],
    ['WBC', '35000', 'ABNORMAL'],       // old dashboard: critical above 30000
    ['Platelets', '20000', 'CRITICAL'],
    ['Platelets', '40000', 'ABNORMAL'], // old dashboard: critical below 50000
    ['Platelets', '1000000', 'CRITICAL'],
    ['Blood Glucose', '39', 'CRITICAL'],  // 2.17 mmol/L
    ['Blood Glucose', '450', 'CRITICAL'], // 25 mmol/L
    ['Blood Glucose', '420', 'ABNORMAL'], // old dashboard: critical above 400
    ['Creatinine', '6.8', 'CRITICAL'],    // 601 µmol/L
    ['Creatinine', '6', 'ABNORMAL'],      // old dashboard: critical above 5
    ['Malaria RDT', 'Positive', 'ABNORMAL'],
    ['HIV', 'Non-reactive', 'NORMAL'],
  ])('%s %s → %s', (test, value, expected) => {
    expect(flagLabResult(test, value).flag).toBe(expected);
  });

  it('agrees with result-entry evaluation for values entered in the rule unit', () => {
    for (const v of ['3', '5', '5.1', '19.9', '20', '25']) {
      expect(flagLabResult('Hemoglobin', v).critical).toBe(evaluateCritical('Hemoglobin', v).isCriticalValue);
    }
  });

  it('falls back to the QC table for analytes the dashboard has no range for', () => {
    expect(flagLabResult('Potassium', '7').flag).toBe('CRITICAL');
    // Known to the QC table but with no normal range: not critical, not vouched for.
    expect(flagLabResult('Potassium', '4').flag).toBe('');
  });

  it('every range that names a QC rule resolves to it', () => {
    for (const range of LAB_REFERENCE_RANGES.filter(r => r.ruleName)) {
      const bounds = criticalBoundsInEntryUnit(range);
      expect(bounds.low ?? bounds.high).toBeDefined();
    }
  });

  it('shows critical bounds in the unit the technician types', () => {
    expect(criticalBoundsInEntryUnit(getLabReferenceRange('WBC')!)).toEqual({ low: 1000, high: 50000 });
    expect(criticalBoundsInEntryUnit(getLabReferenceRange('Creatinine')!).high).toBeCloseTo(6.79, 2);
  });
});

it('matches the seeded "Platelet Count" order name, not only "Platelets"', () => {
  expect(flagLabResult('Platelet Count', '15000').flag).toBe('CRITICAL');
  expect(getLabReferenceRange('Platelet Count')?.test).toBe('Platelet');
});

describe('tests with no normal range are not called NORMAL', () => {
  it.each(['Full Blood Count', 'Renal Function', 'Sputum AFB', 'CD4 Count'])('%s → not evaluated', test => {
    expect(flagLabResult(test, '7').flag).toBe('');
  });

  it('HbA1c has a range now', () => {
    expect(flagLabResult('HbA1c', '5.2').flag).toBe('NORMAL');
    expect(flagLabResult('HbA1c', '7.1').flag).toBe('ABNORMAL');
  });

  it('a non-numeric entry is not evaluated rather than normal', () => {
    expect(flagLabResult('Hemoglobin', 'haemolysed').flag).toBe('');
  });
});
