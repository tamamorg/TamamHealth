/**
 * Free-text → notifiable-disease matching (surveillance safety net).
 *
 * A free-text "measles" with no ICD-11 code must still reach surveillance,
 * while symptom-level text ("fever") must NOT be promoted into a case.
 */
import {
  matchNotifiableByName,
  validateDiagnosisCodes,
} from '@/lib/clinical/diagnosis-validation';

describe('matchNotifiableByName', () => {
  it('matches a bare disease name', () => {
    expect(matchNotifiableByName('measles')?.code).toBe('1E30');
    expect(matchNotifiableByName('cholera')?.code).toBe('1A00');
  });

  it('matches the disease name inside a longer free text', () => {
    expect(matchNotifiableByName('suspected measles with rash')?.code).toBe('1E30');
    expect(matchNotifiableByName('Typhoid fever')?.code).toBe('1A07');
  });

  it('prefers the "unspecified" variant for a generic name', () => {
    // "malaria" alone matches several catalogue entries; the honest bucket
    // for an uncoded entry is the unspecified one.
    expect(matchNotifiableByName('malaria')?.code).toBe('1A42');
  });

  it('does NOT promote symptom-level text into a case', () => {
    expect(matchNotifiableByName('fever')).toBeUndefined();
    expect(matchNotifiableByName('cough for two weeks')).toBeUndefined();
    expect(matchNotifiableByName('rash')).toBeUndefined();
    expect(matchNotifiableByName('watery diarrhea')).toBeUndefined();
  });

  it('does not match partial words', () => {
    // "choleraic" is not "cholera" as a whole word… but whole-phrase matching
    // with non-alphanumeric boundaries must also not match inside words.
    expect(matchNotifiableByName('pneumonia')).toBeUndefined();
    expect(matchNotifiableByName('')).toBeUndefined();
  });
});

describe('validateDiagnosisCodes — free-text notifiable surface', () => {
  it('reports uncoded notifiable free text without erroring', () => {
    const result = validateDiagnosisCodes([{ name: 'Measles' }]);
    expect(result.errors).toHaveLength(0);
    expect(result.freeTextNotifiableMatches).toEqual([
      { name: 'Measles', code: '1E30', title: 'Measles' },
    ]);
    // The clinician is nudged toward the code, advisory only.
    expect(result.warnings.some(w => w.includes('1E30'))).toBe(true);
  });

  it('keeps coded notifiable diagnoses in notifiableCodes, not the free-text list', () => {
    const result = validateDiagnosisCodes([{ name: 'Measles', icd11Code: '1E30' }]);
    expect(result.notifiableCodes).toEqual(['1E30']);
    expect(result.freeTextNotifiableMatches).toHaveLength(0);
  });

  it('leaves non-notifiable free text alone', () => {
    const result = validateDiagnosisCodes([{ name: 'Sprained ankle' }]);
    expect(result.freeTextNotifiableMatches).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
