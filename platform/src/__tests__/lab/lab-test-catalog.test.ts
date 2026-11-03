/**
 * The lab catalogue. A test name is read as free text by the critical-value
 * rules and the result forms, so a name can change what a result does.
 */
import { LAB_CATALOG_VERSION, LAB_TEST_CATALOG } from '@/lib/data/lab-tests';
import { DEFAULT_FACILITY_SETTINGS, mergeFacilitySettings, mergeLabCatalog } from '@/lib/settings/facility-settings';
import { flagLabResult, getLabReferenceRange, matchCriticalRule } from '@/lib/services/lab-critical-flag';
import { resolveLabResultProfile } from '@/components/lab/workflow/lab-result-catalog';
import { isImagingStudy } from '@/lib/clinical-flow/lab-catalog';
import { groupBySection } from '@/components/lab/order/lab-order-catalog';

const CRITICAL_RULE_TESTS: Record<string, string> = {
  'Hemoglobin (Hb)': 'Hemoglobin',
  'White Blood Cell Count': 'White Blood Cell',
  'Platelets': 'Platelets',
  'Blood Glucose': 'Glucose',
  'Fasting Blood Glucose': 'Glucose',
  'Oral Glucose Tolerance Test': 'Glucose',
  'Sodium': 'Sodium',
  'Potassium': 'Potassium',
  'Calcium': 'Calcium',
  'Creatinine': 'Creatinine',
  'PT / INR': 'INR',
  'Lactate': 'Lactate',
  'Lithium Level': 'Lithium',
  'Digoxin Level': 'Digoxin',
};

describe('the catalogue', () => {
  it('lists each test once', () => {
    const names = LAB_TEST_CATALOG.map(test => test.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every test a section and a specimen, none of them imaging', () => {
    for (const test of LAB_TEST_CATALOG) {
      expect(test.section).toBeTruthy();
      expect(test.specimen).toBeTruthy();
      expect(isImagingStudy({ specimen: test.specimen, testName: test.name })).toBe(false);
    }
  });

  it('uses one LOINC code per test', () => {
    const codes = LAB_TEST_CATALOG.flatMap(test => test.loinc ? [test.loinc] : []);
    expect(new Set(codes).size).toBe(codes.length);
    codes.forEach(code => expect(code).toMatch(/^\d{3,6}-\d$/));
  });

  it.each([
    'Kala-azar rK39 RDT', 'Sleeping Sickness CATT', 'Xpert MTB/RIF', 'HIV Viral Load', 'HBsAg', 'Hepatitis E IgM',
    'Cholera RDT', 'Lithium Level', '20-Minute Whole Blood Clotting Test', 'Blood Group & Rh',
  ])('offers %s', name => {
    expect(LAB_TEST_CATALOG.some(test => test.name === name)).toBe(true);
  });

  it('keeps imaging in the default catalogue', () => {
    expect(DEFAULT_FACILITY_SETTINGS.labCatalog.some(test => test.specimen === 'Imaging')).toBe(true);
  });

  it('groups tests under their own headings', () => {
    const sections = groupBySection(LAB_TEST_CATALOG).map(group => group.section);
    expect(sections).toEqual(expect.arrayContaining(['Chemistry', 'Kala-azar & sleeping sickness', 'Drug levels']));
  });
});

describe('names cannot trip other rules', () => {
  it.each(LAB_TEST_CATALOG.map(test => test.name))('%s only reaches the critical rule meant for it', name => {
    const rule = matchCriticalRule(name);
    expect(rule?.testName.split(' (')[0]).toBe(CRITICAL_RULE_TESTS[name]);
  });

  it('gives a single-answer stool test a plain result', () => {
    expect(resolveLabResultProfile('Cholera RDT', 'Stool')).toBeNull();
    expect(resolveLabResultProfile('Faecal Occult Blood', 'Stool')).toBeNull();
    expect(resolveLabResultProfile('H. pylori Antigen', 'Stool')).toBeNull();
    expect(resolveLabResultProfile('Stool Microscopy', 'Stool')?.id).toBe('stool');
  });
});

describe('a facility catalogue saved before this release', () => {
  const saved = [
    { name: 'Full Blood Count', tier: 'special' as const, specimen: 'Blood', loinc: '58410-2' },
    { name: 'Our own panel', tier: 'special' as const, specimen: 'Blood' },
  ];

  it('gains the new tests and keeps its own edits', () => {
    const merged = mergeLabCatalog(saved, undefined);
    expect(merged.find(test => test.name === 'Our own panel')).toBeTruthy();
    expect(merged.find(test => test.name === 'Full Blood Count')?.tier).toBe('special');
    expect(merged.find(test => test.name === 'Full Blood Count')?.section).toBe('Haematology');
    expect(merged.some(test => test.name === 'Kala-azar rK39 RDT')).toBe(true);
    expect(merged.some(test => test.specimen === 'Imaging')).toBe(true);
  });

  it('does not bring back a test removed after the upgrade', () => {
    const merged = mergeLabCatalog(saved, LAB_CATALOG_VERSION);
    expect(merged).toEqual(saved);
  });

  it('stamps the version when settings load', () => {
    expect(mergeFacilitySettings({ labCatalog: saved }).labCatalogVersion).toBe(LAB_CATALOG_VERSION);
    expect(mergeFacilitySettings(null).labCatalog.length).toBe(DEFAULT_FACILITY_SETTINGS.labCatalog.length);
  });
});

describe('results on the new tests', () => {
  it('reads viral load as a number, not Reactive / Non-reactive', () => {
    expect(getLabReferenceRange('HIV Viral Load')?.qualitative).toBeUndefined();
    expect(flagLabResult('HIV Viral Load', '250').flag).toBe('NORMAL');
    expect(flagLabResult('HIV Viral Load', '45000').flag).toBe('ABNORMAL');
    expect(getLabReferenceRange('HIV Rapid Test')?.qualitative).toContain('Reactive');
  });

  it('keeps a short name from matching inside a longer one', () => {
    expect(getLabReferenceRange('Fasting Blood Glucose')?.test).toBe('Blood Glucose');
    expect(getLabReferenceRange('Urine Microalbumin')).toBeUndefined();
  });

  it('offers real choices for a rapid test', () => {
    expect(getLabReferenceRange('Kala-azar rK39 RDT')?.qualitative).toEqual(['Positive', 'Negative']);
    expect(flagLabResult('Kala-azar rK39 RDT', 'Positive').flag).toBe('ABNORMAL');
    expect(flagLabResult('Kala-azar rK39 RDT', 'Negative').flag).toBe('NORMAL');
  });

  it.each([
    ['Ebola PCR', 'Detected'],
    ['Cholera RDT', 'Positive'],
    ['20-Minute Whole Blood Clotting Test', 'Not clotted'],
  ])('%s %s is critical', (test, value) => {
    expect(flagLabResult(test, value).flag).toBe('CRITICAL');
  });

  it.each([
    ['Lithium Level', '2.1'],
    ['Lactate', '6'],
    ['Potassium', '7.1'],
    ['PT / INR', '6'],
  ])('%s of %s is critical', (test, value) => {
    expect(flagLabResult(test, value).flag).toBe('CRITICAL');
  });

  it('names every range after a test the catalogue offers, or a broader older match', () => {
    const names = new Set(LAB_TEST_CATALOG.map(test => test.name));
    const { LAB_REFERENCE_RANGES } = jest.requireActual('@/lib/services/lab-critical-flag');
    for (const range of LAB_REFERENCE_RANGES.filter((r: { exact?: boolean }) => r.exact)) {
      expect(names.has(range.test)).toBe(true);
    }
  });
});
