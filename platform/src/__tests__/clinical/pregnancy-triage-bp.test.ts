/**
 * IITT's only numeric blood-pressure rule is a pregnancy rule, and it is RED.
 *
 * The Age ≥ 12 chart lists, under "PREGNANT WITH ANY OF", SBP ≥160 or DBP ≥110
 * — move to the high-acuity resuscitation area immediately. The general adult
 * boundaries this module also carries (NEWS2's low systolic, AHA/ACC's severe
 * hypertension) sit well above that, so before pregnancy was passed in, a
 * woman at 165/112 — severe pre-eclampsia — produced no warning at all.
 */
import { getTriageVitalWarnings, recommendTriagePriority } from '@/lib/clinical/vitals';

const bp = (systolic: string, diastolic: string) => ({ systolic, diastolic });

describe('pregnancy hypertension at triage', () => {
  it('was invisible without pregnancy status, and is RED with it', () => {
    // A reading that clears both general boundaries (>180 / >120).
    expect(getTriageVitalWarnings(bp('165', '112'), 28)).toEqual([]);

    const pregnant = getTriageVitalWarnings(bp('165', '112'), 28, { isPregnant: true });
    expect(pregnant).toHaveLength(1);
    expect(pregnant[0].urgency).toBe('RED');
    expect(pregnant[0].code).toBe('IITT_PREGNANCY_HYPERTENSION_RED');
    expect(pregnant[0].message).toMatch(/pre-eclampsia/i);
  });

  it('fires on either limb of the criterion', () => {
    expect(getTriageVitalWarnings(bp('162', '95'), 30, { isPregnant: true })[0]?.urgency).toBe('RED');
    expect(getTriageVitalWarnings(bp('130', '110'), 30, { isPregnant: true })[0]?.urgency).toBe('RED');
    // Exactly on the boundary counts — the criterion is "≥".
    expect(getTriageVitalWarnings(bp('160', '90'), 30, { isPregnant: true })[0]?.code)
      .toBe('IITT_PREGNANCY_HYPERTENSION_RED');
  });

  it('leaves a normal pregnant reading alone', () => {
    expect(getTriageVitalWarnings(bp('118', '74'), 27, { isPregnant: true })).toEqual([]);
  });

  it('does not double-report the general adult boundary alongside it', () => {
    // 190/125 crosses the general rules too; one RED warning is the answer,
    // not a RED plus two YELLOWs saying something quieter about the same cuff.
    const warnings = getTriageVitalWarnings(bp('190', '125'), 34, { isPregnant: true });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].urgency).toBe('RED');
  });

  it('still reports the general boundary when the patient is not pregnant', () => {
    const warnings = getTriageVitalWarnings(bp('190', '125'), 34);
    expect(warnings.map(w => w.urgency)).toEqual(['YELLOW', 'YELLOW']);
  });

  it('up-triages a GREEN ABCC assessment to RED', () => {
    const warnings = getTriageVitalWarnings(bp('165', '112'), 28, { isPregnant: true });
    expect(recommendTriagePriority('GREEN', warnings)).toBe('RED');
  });
});
