import { isPositiveResult } from '@/lib/lab/result-polarity';

describe('isPositiveResult', () => {
  it.each(['Reactive', 'POSITIVE', 'HIV-1 detected', 'Reactive (confirmed)'])('%s is positive', r => {
    expect(isPositiveResult(r)).toBe(true);
  });
  it.each(['Non-reactive', 'Non reactive', 'Nonreactive', 'Negative', 'Not detected', 'Target not detected', 'Undetectable', '<40 copies/mL', '', undefined])('%s is not positive', r => {
    expect(isPositiveResult(r as string)).toBe(false);
  });
});
