import {
  calculateBmi,
  getTriageVitalWarnings,
  getVitalFlags,
  isLowerTriagePriority,
  isVitalInRange,
  MUAC_MODERATE_CM,
  MUAC_SEVERE_CM,
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
    // Age 0.1y (~36 days) also falls in IITT's separate "8 days–6 months"
    // age-based YELLOW band (independent of this temperature reading), so
    // the neonatal RED criterion is asserted by code, not by array position.
    const neonatal = getTriageVitalWarnings({ temperature: '35.5' }, 0.1);
    expect(neonatal).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'IITT_NEONATE_TEMPERATURE_RED', urgency: 'RED' }),
    ]));
    expect(getTriageVitalWarnings({ temperature: '35.5' }, 8)[0].urgency).toBe('YELLOW');
  });

  // Age-band coverage (KAN triage audit, item 2): IITT/SATS select the adult
  // chart at 12y+, not 18y+. Ages 12–17 used to fall into neither the child
  // band (`< 12`) nor the adult band (`>= 18`) and got NO blood-pressure rule
  // at all — a 15-year-old at 70/40 produced zero warnings.
  describe('adult chart selection at 12y+ (IITT/SATS), not 18y+', () => {
    test.each([12, 15, 17])('a %i-year-old gets the adult BP rule', (age) => {
      const warnings = getTriageVitalWarnings({ systolic: '181' }, age);
      expect(warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'systolic', urgency: 'YELLOW', code: 'ADULT_HIGH_RISK_SYSTOLIC_BP' }),
      ]));
      // A known age never carries the "age unknown" caveat.
      expect(warnings[0].message).not.toMatch(/age unknown/i);
    });

    test('an 11-year-old (still paediatric) does NOT get the adult BP rule', () => {
      expect(getTriageVitalWarnings({ systolic: '181' }, 11)).toEqual([]);
    });

    test('an adult (30y) still gets the adult BP rule, unaffected by the cutoff change', () => {
      expect(getTriageVitalWarnings({ systolic: '181' }, 30)).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'systolic', urgency: 'YELLOW' }),
      ]));
    });

    test('unknown age applies adult ranges, and says so in the warning', () => {
      const warnings = getTriageVitalWarnings({ systolic: '181' });
      expect(warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'systolic', urgency: 'YELLOW' }),
      ]));
      expect(warnings.find(w => w.field === 'systolic')!.message).toMatch(/age unknown — adult ranges applied/i);
    });

    test('unknown age does not caveat a warning that never depended on age banding', () => {
      // GCS has no adult/child split — its warning must not claim an
      // age assumption it never made.
      const warnings = getTriageVitalWarnings({ gcs: '14' });
      expect(warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ field: 'gcs' }),
      ]));
      expect(warnings.find(w => w.field === 'gcs')!.message).not.toMatch(/age unknown/i);
    });
  });

  // IITT paediatric age-based criteria (item 3): purely age-driven, no vital
  // sign involved, and must escalate/appear in the warnings list exactly
  // like a vitals-based finding.
  describe('IITT infant age criteria', () => {
    test('an infant under 8 days old is RED regardless of vitals', () => {
      const warnings = getTriageVitalWarnings({}, 3 / 365.25);
      expect(warnings).toEqual([
        expect.objectContaining({
          field: 'patientAge',
          code: 'IITT_YOUNG_INFANT_UNDER_8_DAYS_RED',
          urgency: 'RED',
        }),
      ]);
    });

    test('exactly 8 days old is past the RED cutoff and into the YELLOW band', () => {
      // Same expression the default policy uses (8 / 365.25) — computed once
      // here to avoid a float-rounding mismatch between an equivalent but
      // differently-ordered arithmetic expression and the policy default.
      const warnings = getTriageVitalWarnings({}, 8 / 365.25);
      expect(warnings).toEqual([
        expect.objectContaining({ code: 'IITT_YOUNG_INFANT_8_DAYS_TO_6_MONTHS_YELLOW', urgency: 'YELLOW' }),
      ]);
    });

    test('a 5-month-old infant is YELLOW purely on age', () => {
      const warnings = getTriageVitalWarnings({}, 5 / 12);
      expect(warnings).toEqual([
        expect.objectContaining({ code: 'IITT_YOUNG_INFANT_8_DAYS_TO_6_MONTHS_YELLOW', urgency: 'YELLOW' }),
      ]);
    });

    test('a 7-month-old is past the infant-age criteria entirely', () => {
      expect(getTriageVitalWarnings({}, 7 / 12)).toEqual([]);
    });

    test('escalates the recommended priority exactly like a vitals-based warning', () => {
      const warnings = getTriageVitalWarnings({}, 3 / 365.25);
      expect(recommendTriagePriority('GREEN', warnings)).toBe('RED');
    });
  });

  test('an invalid field does not hide a valid warning on another field', () => {
    const input = { pulse: 'abc', oxygenSaturation: '88' };
    expect(validateTriageVitals(input)).toHaveProperty('pulse');
    expect(getTriageVitalWarnings(input, 30)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'oxygenSaturation', urgency: 'YELLOW' }),
    ]));
  });

  // MUAC unification (item 4): one pair of shared constants, distinct
  // severe/moderate labels, and escalation stays at the severe threshold —
  // the moderate band remains a ward-board highlight only (`getVitalFlags`),
  // exactly as before this change, not a new triage-priority escalator.
  describe('MUAC severe vs moderate', () => {
    test('constants match the WHO 6–59 month thresholds', () => {
      expect(MUAC_SEVERE_CM).toBe(11.5);
      expect(MUAC_MODERATE_CM).toBe(12.5);
    });

    test('severe MUAC (<11.5cm) escalates triage priority', () => {
      const warnings = getTriageVitalWarnings({ muac: '11' }, 2);
      expect(warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'WHO_SEVERE_ACUTE_MALNUTRITION', urgency: 'YELLOW' }),
      ]));
    });

    test('moderate MUAC (11.5–12.5cm) does not escalate triage priority — unchanged behaviour', () => {
      expect(getTriageVitalWarnings({ muac: '12' }, 2)).toEqual([]);
    });

    test('getVitalFlags highlights the moderate band on the ward board', () => {
      expect(getVitalFlags({ muac: '12' }).muac).toBe(true);
      expect(getVitalFlags({ muac: '13' }).muac).toBeUndefined();
    });

    test('getVitalFlags rejects garbage input instead of silently parsing its numeric prefix', () => {
      // The bug: parseFloat('12.5abc') === 12.5, so "12.5abc" (nonsense) used
      // to read as a real, in-range MUAC and could clear a flag a genuine
      // 999 would have set. parseStrictVitalNumber rejects the whole string.
      expect(getVitalFlags({ muac: '999abc' }).muac).toBeUndefined();
      expect(getVitalFlags({ temperature: '39abc' }).temperature).toBeUndefined();
      expect(getVitalFlags({ pulse: '150abc' }).pulse).toBeUndefined();
      // A genuinely out-of-range value is still flagged.
      expect(getVitalFlags({ pulse: '150' }).pulse).toBe(true);
    });
  });
});
