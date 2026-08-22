/**
 * Critical-value flagging on lab result entry.
 *
 * This is the bridge between free-text test names the lab UI carries
 * ("Hemoglobin (g/dL)", "Full Blood Count — Hemoglobin") and the QC service's
 * threshold table. It had no tests, and it decides whether a result that could
 * kill someone gets flagged to a clinician — a haemoglobin of 4 g/dL or a
 * potassium of 7 mmol/L is an immediate call, not a line on a report.
 *
 * The two failure directions are not symmetric. A missed flag is a patient not
 * called back; a spurious flag is noise that teaches people to ignore flags,
 * which eventually costs the same thing.
 */
import { matchCriticalRule, evaluateCritical } from '@/lib/services/lab-critical-flag';

describe('matching a free-text test name to a threshold rule', () => {
  it('matches the plain analyte name', () => {
    expect(matchCriticalRule('Hemoglobin')?.testName).toBe('Hemoglobin (g/dL)');
  });

  it('matches when the UI carries the units too', () => {
    expect(matchCriticalRule('Hemoglobin (g/dL)')?.testName).toBe('Hemoglobin (g/dL)');
  });

  it('matches an analyte inside a panel name', () => {
    // The lab enters results under the panel that ordered them.
    expect(matchCriticalRule('Full Blood Count — Hemoglobin')?.testName).toBe('Hemoglobin (g/dL)');
  });

  it('is case-insensitive', () => {
    expect(matchCriticalRule('POTASSIUM')?.testName).toBe('Potassium (mmol/L)');
  });

  it('returns nothing for an analyte with no critical threshold', () => {
    expect(matchCriticalRule('Malaria RDT')).toBeUndefined();
  });

  it('returns nothing for an empty name rather than matching the first rule', () => {
    expect(matchCriticalRule('')).toBeUndefined();
    expect(matchCriticalRule(undefined as unknown as string)).toBeUndefined();
  });
});

describe('evaluating a result against its rule', () => {
  it('flags a critically low haemoglobin', () => {
    // 5 g/dL is severe anaemia — a transfusion decision.
    expect(evaluateCritical('Hemoglobin', '4.1').isCriticalValue).toBe(true);
  });

  it('flags a critically high potassium', () => {
    // 6.5 upward is an arrhythmia risk.
    expect(evaluateCritical('Potassium (mmol/L)', '7.2').isCriticalValue).toBe(true);
  });

  it('leaves a normal result alone', () => {
    expect(evaluateCritical('Hemoglobin', '12.5').isCriticalValue).toBe(false);
  });

  it('treats the threshold itself as critical, not as the edge of normal', () => {
    // `isCritical` uses <= and >=, so a value ON the boundary flags. That is
    // the safe direction for a threshold that means "call someone".
    expect(evaluateCritical('Hemoglobin', '5').isCriticalValue).toBe(true);
    expect(evaluateCritical('Hemoglobin', '20').isCriticalValue).toBe(true);
    expect(evaluateCritical('Hemoglobin', '5.01').isCriticalValue).toBe(false);
  });

  it('does not invent a low threshold where the rule has only a high one', () => {
    // INR has criticalHigh only — a low INR is not a critical value, and
    // treating an absent bound as zero would flag every normal result.
    expect(evaluateCritical('INR', '0.9').isCriticalValue).toBe(false);
    expect(evaluateCritical('INR', '6').isCriticalValue).toBe(true);
  });

  it('keeps the rule but does not flag a qualitative result', () => {
    // "Positive" is not a number; flagging on a failed parse would fire on
    // every qualitative test that happens to share an analyte name.
    const result = evaluateCritical('Hemoglobin', 'Positive');
    expect(result.rule).toBeDefined();
    expect(result.isCriticalValue).toBe(false);
  });

  it('does not flag an empty or missing value', () => {
    expect(evaluateCritical('Hemoglobin', '').isCriticalValue).toBe(false);
    expect(evaluateCritical('Hemoglobin', '—').isCriticalValue).toBe(false);
  });

  it('reports not-critical for an analyte with no rule at all', () => {
    const result = evaluateCritical('Malaria RDT', '999');
    expect(result.rule).toBeUndefined();
    expect(result.isCriticalValue).toBe(false);
  });

  it('parses a value the UI may have padded', () => {
    expect(evaluateCritical('Potassium', ' 7.2 ').isCriticalValue).toBe(true);
  });
});

describe('known limits of the name match', () => {
  it('takes the FIRST rule whose analyte appears in the name', () => {
    // A multi-analyte name resolves to whichever rule sits earlier in
    // DEFAULT_CRITICAL_VALUES, so a combined panel entered under one name is
    // evaluated against one analyte's thresholds. Pinned as a known limit
    // rather than a bug: results are entered per-analyte in the lab UI, and
    // the alternative (matching several rules) would need a value per rule.
    const rule = matchCriticalRule('Sodium and Potassium panel');
    expect(rule?.testName).toBe('Potassium (mmol/L)');
  });

  it('matches in both directions, so a truncated name still resolves', () => {
    // `analyte.includes(name)` is what lets "Hemoglob" find haemoglobin. It
    // also means a very short name can match — the reason the empty-string
    // guard above exists.
    expect(matchCriticalRule('Hemoglob')?.testName).toBe('Hemoglobin (g/dL)');
  });
});
