/**
 * localDayOf / localClockOf read a stored timestamp in local time. Slicing the
 * ISO string gave the UTC day and clock: the visit panel showed "triaged 03:37"
 * for a 05:37 Juba triage, and a record written after 22:00 landed on tomorrow.
 */
import { localClockOf, localDayOf } from '@/lib/date-utils';

describe('localDayOf', () => {
  it('passes a bare calendar day through untouched', () => {
    expect(localDayOf('2026-10-29')).toBe('2026-10-29');
  });
  it('reads a timestamp as the local day', () => {
    const lateEvening = new Date(2026, 9, 29, 23, 30);
    expect(localDayOf(lateEvening.toISOString())).toBe('2026-10-29');
  });
  it('is empty for nothing', () => {
    expect(localDayOf(undefined)).toBe('');
  });
});

describe('localClockOf', () => {
  it('reads a timestamp as the local clock', () => {
    expect(localClockOf(new Date(2026, 9, 29, 5, 37).toISOString())).toBe('05:37');
  });
  it('has no clock for a bare day or nothing', () => {
    expect(localClockOf('2026-10-29')).toBeUndefined();
    expect(localClockOf(undefined)).toBeUndefined();
  });
});
