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

  it('leaves text results and missing values alone', () => {
    expect(resultWithUnit('Positive (P. falciparum)', '')).toBe('Positive (P. falciparum)');
    expect(resultWithUnit('', 'g/dL')).toBe('');
    expect(resultWithUnit(undefined, undefined)).toBe('');
  });
});
