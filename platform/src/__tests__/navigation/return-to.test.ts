import { returnToFromSearch, safeReturnTo, withReturnTo } from '@/lib/navigation/return-to';

describe('return-to navigation', () => {
  it('accepts local paths with queries and fragments', () => {
    expect(safeReturnTo('/dashboard?day=2026-08-19#queue', '/patients'))
      .toBe('/dashboard?day=2026-08-19#queue');
  });

  it.each([
    'https://attacker.example/steal',
    '//attacker.example/steal',
    'javascript:alert(1)',
    '/\\attacker.example/steal',
    'patients',
    '',
  ])('rejects a non-local return target: %s', (target) => {
    expect(safeReturnTo(target, '/patients')).toBe('/patients');
  });

  it('uses a safe default when both values are invalid', () => {
    expect(safeReturnTo('//attacker.example', 'javascript:alert(1)')).toBe('/dashboard');
  });

  it('reads an encoded returnTo query parameter', () => {
    expect(returnToFromSearch('?returnTo=%2Fdashboard%3Fday%3D2026-08-19', '/patients'))
      .toBe('/dashboard?day=2026-08-19');
  });

  it('adds a returnTo without discarding existing query or fragment state', () => {
    expect(withReturnTo('/patients/patient-1?tab=notes#latest', '/rooming/patient-1'))
      .toBe('/patients/patient-1?tab=notes&returnTo=%2Frooming%2Fpatient-1#latest');
  });

  it('preserves a nested return path for multi-step workflows', () => {
    expect(withReturnTo('/patients/patient-1', '/rooming/patient-1?returnTo=%2Fdashboard%3Flane%3Din_office'))
      .toBe('/patients/patient-1?returnTo=%2Frooming%2Fpatient-1%3FreturnTo%3D%252Fdashboard%253Flane%253Din_office');
  });
});
