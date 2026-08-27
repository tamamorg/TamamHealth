import {
  calculateBmi,
  getTriageVitalWarnings,
  isLowerTriagePriority,
  isVitalInRange,
  parseStrictVitalNumber,
  recommendTriagePriority,
  validateTriageVitals,
  type TriageVitalsInput,
} from '@/lib/clinical/vitals';

describe('triage vital-sign safety', () => {
  test.each<[string, TriageVitalsInput, string]>([
    ['temperature -50', { temperature: '-50' }, 'temperature'],
    ['pulse abc', { pulse: 'abc' }, 'pulse'],
    ['respiratory rate -3', { respiratoryRate: '-3' }, 'respiratoryRate'],
    ['oxygen saturation 999', { oxygenSaturation: '999' }, 'oxygenSaturation'],
    ['systolic blood pressure 0', { systolic: '0' }, 'systolic'],
    ['diastolic blood pressure 999', { diastolic: '999' }, 'diastolic'],
    ['weight -200', { weight: '-200' }, 'weight'],
    ['height 999', { height: '999' }, 'height'],
    ['pain 20', { painScore: '20' }, 'painScore'],
    ['glucose xyz', { bloodGlucose: 'xyz' }, 'bloodGlucose'],
    ['GCS 100', { gcs: '100' }, 'gcs'],
    ['MUAC -5', { muac: '-5' }, 'muac'],
  ])('%s is a blocking error', (_label, input, expectedField) => {
    expect(validateTriageVitals(input)).toHaveProperty(expectedField);
  });

  test('rejects partially numeric and non-finite formats instead of accepting a prefix', () => {
    expect(parseStrictVitalNumber('80abc')).toBeNull();
    expect(parseStrictVitalNumber('1e2')).toBeNull();
    expect(parseStrictVitalNumber('Infinity')).toBeNull();
    expect(isVitalInRange('pulse', '80abc')).toBe(false);
  });

  test('keeps empty optional fields valid and accepts complete decimal values', () => {
    expect(validateTriageVitals({})).toEqual({});
    expect(validateTriageVitals({ temperature: '37.2', bloodGlucose: '5.5', pulse: '80', height: '170' })).toEqual({});
    expect(validateTriageVitals({ pulse: 80 })).toEqual({});
  });

  test('calculates BMI only from plausible captured height and weight', () => {
    expect(calculateBmi('65', '170')).toBe('22.5');
    expect(calculateBmi('', '170')).toBeNull();
    expect(calculateBmi('65', '999')).toBeNull();
  });

  test('blocks an impossible blood-pressure relationship', () => {
    const errors = validateTriageVitals({ systolic: '80', diastolic: '120' });
    expect(errors.systolic).toContain('must be higher');
    expect(errors.diastolic).toContain('must be lower');
  });

  test('adult RED pulse is visible as an emergency warning and raises GREEN to RED', () => {
    const warnings = getTriageVitalWarnings({ pulse: '160' }, 35);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'pulse', urgency: 'RED', code: 'IITT_ADULT_PULSE_RED' }),
    ]));
    expect(recommendTriagePriority('GREEN', warnings)).toBe('RED');
    expect(isLowerTriagePriority('GREEN', 'RED')).toBe(true);
  });

  test('WHO high-risk readings produce age-aware YELLOW recommendations', () => {
    const adult = getTriageVitalWarnings({ respiratoryRate: '31', oxygenSaturation: '91' }, 35);
    expect(adult.map(item => item.field)).toEqual(expect.arrayContaining(['respiratoryRate', 'oxygenSaturation']));
    expect(adult.every(item => item.urgency === 'YELLOW')).toBe(true);
    expect(recommendTriagePriority('GREEN', adult)).toBe('YELLOW');

    const child = getTriageVitalWarnings({ pulse: '170', muac: '11' }, 3);
    expect(child).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'pulse', code: 'IITT_CHILD_HIGH_RISK_PULSE' }),
      expect.objectContaining({ field: 'muac', code: 'WHO_SEVERE_ACUTE_MALNUTRITION' }),
    ]));
  });

  test('temperature outside 36–39°C is RED under 2 months and YELLOW thereafter', () => {
    expect(getTriageVitalWarnings({ temperature: '35.5' }, 0.1)[0].urgency).toBe('RED');
    expect(getTriageVitalWarnings({ temperature: '35.5' }, 8)[0].urgency).toBe('YELLOW');
  });

  test('adult-only blood-pressure thresholds are not applied to adolescents', () => {
    expect(getTriageVitalWarnings({ systolic: '181' }, 16)).toEqual([]);
    expect(getTriageVitalWarnings({ systolic: '181' }, 30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'systolic', urgency: 'YELLOW' }),
    ]));
  });

  test('an invalid field does not hide a valid warning on another field', () => {
    const input = { pulse: 'abc', oxygenSaturation: '88' };
    expect(validateTriageVitals(input)).toHaveProperty('pulse');
    expect(getTriageVitalWarnings(input, 30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'oxygenSaturation', urgency: 'YELLOW' }),
    ]));
  });
});
