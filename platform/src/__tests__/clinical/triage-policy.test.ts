/**
 * `TriagePolicy` (lib/clinical/triage-policy.ts) — the config-driven
 * thresholds `getTriageVitalWarnings` consults. The IITT FAQ says target
 * times, and by extension most acuity thresholds, are "locally determined";
 * this module is the seam that lets a deployment change one without a code
 * change, while the DEFAULT policy reproduces the exact numbers the
 * hardcoded version used.
 */
import { getTriageVitalWarnings } from '@/lib/clinical/vitals';
import { DEFAULT_TRIAGE_POLICY, resolveTriagePolicy } from '@/lib/clinical/triage-policy';

describe('resolveTriagePolicy', () => {
  test('no override resolves to the exact default policy', () => {
    expect(resolveTriagePolicy()).toBe(DEFAULT_TRIAGE_POLICY);
    expect(resolveTriagePolicy(null)).toBe(DEFAULT_TRIAGE_POLICY);
  });

  test('an override changes only the leaf it names, keeping every other default', () => {
    const resolved = resolveTriagePolicy({ adult: { pulse: { redLow: { value: 55 } } } });
    expect(resolved.adult.pulse.redLow.value).toBe(55);
    // The source string for the untouched value survives...
    expect(resolved.adult.pulse.redLow.source).toBe(DEFAULT_TRIAGE_POLICY.adult.pulse.redLow.source);
    // ...and every sibling threshold is untouched.
    expect(resolved.adult.pulse.redHigh).toEqual(DEFAULT_TRIAGE_POLICY.adult.pulse.redHigh);
    expect(resolved.adult.pulse.yellowLow).toEqual(DEFAULT_TRIAGE_POLICY.adult.pulse.yellowLow);
    expect(resolved.spo2).toEqual(DEFAULT_TRIAGE_POLICY.spo2);
    expect(resolved.muac).toEqual(DEFAULT_TRIAGE_POLICY.muac);
  });

  test('an override can replace a value\'s source citation alongside its value', () => {
    const resolved = resolveTriagePolicy({
      pain: { severeMin: { value: 8, source: 'Facility-specific pain protocol v2' } },
    });
    expect(resolved.pain.severeMin).toEqual({ value: 8, source: 'Facility-specific pain protocol v2' });
  });
});

describe('getTriageVitalWarnings with the default policy', () => {
  test('matches behaviour with no policy argument at all', () => {
    const withDefault = getTriageVitalWarnings({ pulse: '160' }, 35, { policy: DEFAULT_TRIAGE_POLICY });
    const withNone = getTriageVitalWarnings({ pulse: '160' }, 35);
    expect(withDefault).toEqual(withNone);
    expect(withDefault[0]).toMatchObject({ code: 'IITT_ADULT_PULSE_RED', urgency: 'RED' });
  });
});

describe('getTriageVitalWarnings with an overridden policy', () => {
  test('a raised adult RED pulse ceiling stops flagging a reading the default would catch', () => {
    const defaultWarnings = getTriageVitalWarnings({ pulse: '155' }, 35);
    expect(defaultWarnings.some(w => w.code === 'IITT_ADULT_PULSE_RED')).toBe(true);

    const looser = resolveTriagePolicy({ adult: { pulse: { redHigh: { value: 160 } } } });
    const overriddenWarnings = getTriageVitalWarnings({ pulse: '155' }, 35, { policy: looser });
    expect(overriddenWarnings.some(w => w.code === 'IITT_ADULT_PULSE_RED')).toBe(false);
  });

  test('a facility that lowers the severe-pain threshold catches a reading the default would not', () => {
    const defaultWarnings = getTriageVitalWarnings({ painScore: '5' }, 35);
    expect(defaultWarnings).toEqual([]);

    const stricter = resolveTriagePolicy({ pain: { severeMin: { value: 5 } } });
    const overriddenWarnings = getTriageVitalWarnings({ painScore: '5' }, 35, { policy: stricter });
    expect(overriddenWarnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'IITT_SEVERE_PAIN', urgency: 'YELLOW' }),
    ]));
  });

  test('a raised adult chart-selection age changes who gets adult vs paediatric pulse bands', () => {
    // At the default (12y), a 13-year-old with pulse 160 is scored on the
    // adult chart and meets RED (>150).
    expect(getTriageVitalWarnings({ pulse: '160' }, 13).some(w => w.code === 'IITT_ADULT_PULSE_RED')).toBe(true);

    // Raise the adult cutoff to 15y: the same 13-year-old is now scored on
    // the paediatric 5–12y band (70–140), where 160 is still high-risk, but
    // under a different, non-RED code.
    const raised = resolveTriagePolicy({ ageBands: { adultMinYears: { value: 15 } } });
    const warnings = getTriageVitalWarnings({ pulse: '160' }, 13, { policy: raised });
    expect(warnings.some(w => w.code === 'IITT_ADULT_PULSE_RED')).toBe(false);
    expect(warnings.some(w => w.code === 'IITT_CHILD_HIGH_RISK_PULSE')).toBe(true);
  });
});
