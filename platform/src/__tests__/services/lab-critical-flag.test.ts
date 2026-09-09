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
import { matchCriticalRule, evaluateCritical, evaluateCriticalObservations } from '@/lib/services/lab-critical-flag';

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

/**
 * `evaluateCritical` only ever sees the plain single-value result field.
 * Every structured panel (Full Blood Count, chemistry panels, Urinalysis,
 * Stool — see lab-result-catalog.ts) writes its analytes into an
 * observations list instead, which is what `evaluateCriticalObservations`
 * checks. This is the piece that used to not exist at all: a Hemoglobin of
 * 4 g/dL entered through a Full Blood Count panel produced no flag, only a
 * Hemoglobin entered through a bare single-value test did.
 */
describe('evaluating structured panel observations', () => {
  it('flags a critical analyte inside a panel by its label', () => {
    // The catalogue's WBC label carries the abbreviation in parens and a
    // unit spelled differently to the QC table's ("10³/µL" vs "×10⁹/L") —
    // both the name match and the unit-equivalence check have to hold.
    const check = evaluateCriticalObservations([
      { id: 'cbc.wbc', label: 'White blood cells (WBC)', value: '0.6', unit: '10³/µL' },
    ]);
    expect(check.isCriticalValue).toBe(true);
    expect(check.hits).toHaveLength(1);
    expect(check.hits[0].rule.testName).toBe('White Blood Cell (×10⁹/L)');
    expect(check.hits[0].comparison).toBe('≤ 1');
  });

  it('is critical overall if ANY observation is, not only the first', () => {
    const check = evaluateCriticalObservations([
      { id: 'cbc.rbc', label: 'Red blood cells (RBC)', value: '5.1', unit: '10⁶/µL' },
      { id: 'cbc.hemoglobin', label: 'Hemoglobin', value: '4.1', unit: 'g/dL' },
      { id: 'cbc.platelets', label: 'Platelets', value: '250', unit: '10³/µL' },
    ]);
    expect(check.isCriticalValue).toBe(true);
    expect(check.hits.map(h => h.id)).toEqual(['cbc.hemoglobin']);
  });

  it('leaves a panel of normal values alone', () => {
    const check = evaluateCriticalObservations([
      { id: 'cbc.hemoglobin', label: 'Hemoglobin', value: '12.8', unit: 'g/dL' },
      { id: 'chem.potassium', label: 'Serum potassium', value: '4.2', unit: 'mmol/L' },
    ]);
    expect(check.isCriticalValue).toBe(false);
    expect(check.hits).toHaveLength(0);
  });

  it('skips an observation whose analyte has no critical-value rule', () => {
    // Amylase is a real chemistry-panel field with no entry in
    // DEFAULT_CRITICAL_VALUES — it should be silently uninvolved, not
    // mistaken for some other analyte.
    const check = evaluateCriticalObservations([
      { id: 'chem.amylase', label: 'Amylase', value: '9999', unit: 'U/L' },
    ]);
    expect(check.isCriticalValue).toBe(false);
    expect(check.hits).toHaveLength(0);
  });

  it('does not compare a value against a rule whose unit does not match', () => {
    // The chemistry panel's calcium field is entered in mg/dL; the QC
    // table's Calcium rule is in mmol/L. Comparing the raw numbers would be
    // wrong in both directions (a real critical value could read as normal,
    // or vice versa) — with no conversion available, the safe move is not
    // to flag it, not to guess.
    const check = evaluateCriticalObservations([
      { id: 'chem.calcium', label: 'Serum calcium', value: '1.0', unit: 'mg/dL' },
    ]);
    expect(check.isCriticalValue).toBe(false);
    expect(check.hits).toHaveLength(0);
  });

  it('still evaluates the same analyte reported in the unit the rule expects', () => {
    // Chemistry carries two "Serum glucose" fields — one in mg/dL, one in
    // mmol/L. Only the one matching the rule's unit should ever fire.
    const mismatched = evaluateCriticalObservations([
      { id: 'chem.glucose_serum_mg', label: 'Serum glucose', value: '450', unit: 'mg/dL' },
    ]);
    expect(mismatched.isCriticalValue).toBe(false);

    const matched = evaluateCriticalObservations([
      { id: 'chem.glucose_serum_mmol', label: 'Serum glucose', value: '28', unit: 'mmol/L' },
    ]);
    expect(matched.isCriticalValue).toBe(true);
    expect(matched.hits[0].comparison).toBe('≥ 25');
  });

  it('ignores a non-numeric or blank observation value', () => {
    const check = evaluateCriticalObservations([
      { id: 'cbc.hemoglobin', label: 'Hemoglobin', value: '', unit: 'g/dL' },
      { id: 'chem.potassium', label: 'Serum potassium', value: 'clotted', unit: 'mmol/L' },
    ]);
    expect(check.isCriticalValue).toBe(false);
  });
});
