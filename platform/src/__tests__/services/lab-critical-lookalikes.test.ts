/**
 * A name that mentions an analyte is not always that analyte. "Mean
 * corpuscular hemoglobin concentration" contains "hemoglobin", and the fuzzy
 * match read a normal MCHC of 33 g/dL against hemoglobin's critical-high of
 * 20 — so every full blood count raised a critical alert.
 */
import { matchCriticalRule, evaluateCriticalObservations } from '@/lib/services/lab-critical-flag';
import { HEMATOLOGY_PROFILE } from '@/components/lab/workflow/lab-result-catalog';

describe('critical-value rules ignore look-alike measurements', () => {
  it.each([
    'Mean corpuscular hemoglobin concentration (MCHC)',
    'Mean corpuscular hemoglobin (MCH)',
    'Hemoglobin A1c',
    'Glycated hemoglobin (HbA1c)',
    'Mean platelet volume (MPV)',
    'Urine sodium',
    'Urine potassium',
    'Creatinine clearance',
    'Albumin/creatinine ratio',
    'Hemoglobin electrophoresis',
  ])('%s has no critical rule', name => {
    expect(matchCriticalRule(name)).toBeUndefined();
  });

  it.each([
    ['Hemoglobin', 'Hemoglobin (g/dL)'],
    ['Hemoglobin (Hb)', 'Hemoglobin (g/dL)'],
    ['Full Blood Count — Hemoglobin', 'Hemoglobin (g/dL)'],
    ['Platelets', 'Platelets (×10⁹/L)'],
    ['Potassium', 'Potassium (mmol/L)'],
    ['Serum creatinine', 'Creatinine (µmol/L)'],
    ['Random blood glucose', 'Glucose (mmol/L)'],
  ])('%s still matches %s', (name, rule) => {
    expect(matchCriticalRule(name)?.testName).toBe(rule);
  });

  it('a normal full blood count raises no critical alert', () => {
    const normal: Record<string, string> = {
      'cbc.wbc': '6.5', 'cbc.rbc': '4.8', 'cbc.platelets': '250', 'cbc.neutrophils': '60', 'cbc.lymphocytes': '30',
      'cbc.mixed_cells': '10', 'cbc.hemoglobin': '13.5', 'cbc.hematocrit': '41', 'cbc.mcv': '88', 'cbc.mch': '29', 'cbc.mchc': '33',
    };
    const observations = HEMATOLOGY_PROFILE.sections.flatMap(section => section.fields)
      .filter(field => normal[field.id])
      .map(field => ({ label: field.label, value: normal[field.id], unit: field.unit }));
    expect(observations.length).toBeGreaterThan(8);
    expect(evaluateCriticalObservations(observations as never).hits).toEqual([]);
  });

  it('a critically low hemoglobin in the same panel is still caught', () => {
    const hits = evaluateCriticalObservations([
      { label: 'Hemoglobin', value: '4.2', unit: 'g/dL' },
      { label: 'Mean corpuscular hemoglobin concentration (MCHC)', value: '33', unit: 'g/dL' },
    ] as never).hits;
    expect(hits.map(h => h.label)).toEqual(['Hemoglobin']);
  });
});
