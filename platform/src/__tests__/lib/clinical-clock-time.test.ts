/**
 * Nurse dashboard and handoff times read in the deployment's clinical zone
 * (Africa/Juba, UTC+2), like the bedside MAR, whatever zone the device is set to.
 */
import { clinicalClockTime } from '@/lib/time-juba';

describe('clinicalClockTime', () => {
  it('shows Juba wall-clock time for a fixed instant', () => {
    expect(clinicalClockTime('2026-11-08T06:00:00.000Z')).toBe('08:00 AM');
    expect(clinicalClockTime('2026-11-08T21:30:00.000Z')).toBe('11:30 PM');
    expect(clinicalClockTime(new Date('2026-11-08T22:05:00.000Z'))).toBe('12:05 AM');
  });

  it('is independent of the device zone', () => {
    const original = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(clinicalClockTime('2026-11-08T06:00:00.000Z')).toBe('08:00 AM');
    } finally {
      if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
    }
  });

  it('is empty for nothing or an unreadable date', () => {
    expect(clinicalClockTime(undefined)).toBe('');
    expect(clinicalClockTime('not a date')).toBe('');
  });
});
