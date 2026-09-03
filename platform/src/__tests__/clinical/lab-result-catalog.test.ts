import {
  buildLabObservations,
  CHEMISTRY_PROFILE,
  HEMATOLOGY_PROFILE,
  resolveLabResultProfile,
  STOOL_PROFILE,
  summarizeLabObservations,
  URINE_PROFILE,
} from '@/components/lab/workflow/lab-result-catalog';

describe('structured lab result catalogue', () => {
  test('captures all four source form families without duplicate field ids', () => {
    const profiles = [HEMATOLOGY_PROFILE, CHEMISTRY_PROFILE, URINE_PROFILE, STOOL_PROFILE];
    const fields = profiles.flatMap(profile => profile.sections.flatMap(section => section.fields));
    expect(fields).toHaveLength(50);
    expect(new Set(fields.map(field => field.id)).size).toBe(fields.length);
  });

  test.each([
    ['Full Blood Count', 'Blood', 'hematology'],
    ['Urinalysis', 'Urine', 'urine'],
    ['Stool Culture', 'Stool', 'stool'],
    ['Liver Function', 'Blood', 'chemistry'],
    ['Renal Function', 'Blood', 'chemistry'],
    ['Lipid Profile', 'Blood', 'chemistry'],
    ['Blood Glucose', 'Blood', 'chemistry'],
  ])('maps %s to its ordered result panel', (testName, specimen, expected) => {
    expect(resolveLabResultProfile(testName, specimen)?.id).toBe(expected);
  });

  test('keeps specific chemistry orders focused on relevant analytes', () => {
    const lipid = resolveLabResultProfile('Lipid Profile', 'Blood');
    expect(lipid?.sections.flatMap(section => section.fields).map(field => field.id)).toEqual([
      'chem.cholesterol_total',
      'chem.triglycerides',
    ]);
  });

  test('stores only reported observations and creates a legacy summary', () => {
    const observations = buildLabObservations(HEMATOLOGY_PROFILE, {
      'cbc.wbc': '6.4',
      'cbc.hemoglobin': '12.8',
      'cbc.mcv': '   ',
    });
    expect(observations).toHaveLength(2);
    expect(summarizeLabObservations(observations)).toBe(
      'White blood cells (WBC): 6.4 10³/µL; Hemoglobin: 12.8 g/dL',
    );
  });

  test('separates urine crystal quantity from crystal type', () => {
    const crystalFields = URINE_PROFILE.sections.find(section => section.id === 'urine-crystals')?.fields;
    expect(crystalFields?.map(field => field.id)).toEqual(['urine.crystal_quantity', 'urine.crystal_type']);
  });
});
