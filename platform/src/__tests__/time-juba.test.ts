import { jubaDateRangeUtc } from '@/lib/time-juba';

describe('jubaDateRangeUtc', () => {
  it('maps Juba calendar midnights to half-open UTC boundaries', () => {
    expect(jubaDateRangeUtc('2026-08-24', '2026-08-31')).toEqual({
      from: '2026-08-23T22:00:00.000Z',
      to: '2026-08-30T22:00:00.000Z',
    });
  });

  it('rejects non-ISO calendar dates', () => {
    expect(() => jubaDateRangeUtc('24/08/2026', '2026-08-31')).toThrow('Invalid ISO date');
  });
});
