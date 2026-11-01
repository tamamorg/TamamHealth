import { resultWithUnit } from '@/components/lab/workflow/lab-workflow-types';

describe('resultWithUnit', () => {
  it('adds the unit to a bare value', () => {
    expect(resultWithUnit('4.2', 'g/dL')).toBe('4.2 g/dL');
    expect(resultWithUnit(4.2, 'g/dL')).toBe('4.2 g/dL');
  });

  it('does not repeat a unit the value already carries', () => {
    expect(resultWithUnit('4.2 g/dL', 'g/dL')).toBe('4.2 g/dL');
    expect(resultWithUnit('4.2 G/DL', 'g/dL')).toBe('4.2 G/DL');
  });

  it('keeps a unit that only shares its last letters with the value', () => {
    expect(resultWithUnit('5 mg', 'g')).toBe('5 mg g');
    expect(resultWithUnit('0.5 mmol/L', 'mol/L')).toBe('0.5 mmol/L mol/L');
    expect(resultWithUnit('4.2g/dL', 'g/dL')).toBe('4.2g/dL');
  });

  it('leaves text results and missing values alone', () => {
    expect(resultWithUnit('Positive (P. falciparum)', '')).toBe('Positive (P. falciparum)');
    expect(resultWithUnit('', 'g/dL')).toBe('');
    expect(resultWithUnit(undefined, undefined)).toBe('');
  });
});
