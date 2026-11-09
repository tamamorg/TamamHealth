/**
 * Display timestamps render in the facility zone (Africa/Juba, UTC+2 by
 * default), whatever zone the device is set to. Stored values stay ISO UTC.
 */
process.env.TZ = 'America/New_York';

import {
  formatDateTime, formatCompactDateTime, formatClockTime, formatDate, formatShortDate, formatLongDate,
} from '@/lib/format-utils';
import { formatInFacilityZone, facilityTimeZone } from '@/lib/time-juba';

describe('facility-zone display on a non-Juba device', () => {
  it('runs with a device zone that is not Juba', () => {
    // 03:30Z is 23:30 the previous evening in New York, 05:30 in Juba.
    expect(new Date('2026-08-24T03:30:00Z').getHours()).not.toBe(5);
    expect(facilityTimeZone()).toBe('Africa/Juba');
  });

  it('formatDateTime shows Juba clock time and day', () => {
    expect(formatDateTime('2026-08-24T22:30:00Z')).toBe('Aug 25, 2026 at 12:30 AM');
  });

  it('formatCompactDateTime shows Juba clock time and day', () => {
    expect(formatCompactDateTime('2026-08-24T22:30:00Z')).toBe('Aug 25 · 12:30 AM');
  });

  it('formatClockTime renders 24-hour Juba time', () => {
    expect(formatClockTime('2026-08-24T03:30:00Z')).toBe('05:30');
    expect(formatClockTime('08:15')).toBe('08:15');
  });

  it('formatDate uses the Juba day for an instant but leaves a calendar day alone', () => {
    expect(formatDate('2026-08-24T22:30:00Z')).toBe('Aug 25, 2026');
    expect(formatDate('2026-08-24')).toBe('Aug 24, 2026');
  });

  it('formatShortDate reads an instant in Juba', () => {
    expect(formatShortDate('2026-08-24T22:30:00Z')).toBe('25 Aug');
    expect(formatShortDate('2026-08-24')).toBe('24 Aug');
  });

  it('formatShortDate reads a zone-less datetime as facility wall time, not the device clock', () => {
    // 23:30 in New York would be 25 Aug in Juba if it were parsed as device time.
    expect(formatShortDate('2026-08-24T23:30')).toBe('24 Aug');
    expect(formatShortDate('2026-08-24T10:00:00')).toBe('24 Aug');
    // With a zone it is still an instant.
    expect(formatShortDate('2026-08-24T22:30:00+00:00')).toBe('25 Aug');
    expect(formatShortDate('2026-08-24T22:30:00-02:00')).toBe('25 Aug');
  });

  it('date-only record fields stay on their own day', () => {
    // immunization.dateGiven, bill.date, claim.submittedDate go through formatDate.
    expect(formatDate('2026-08-24')).toBe('Aug 24, 2026');
  });

  it('formatLongDate uses the Juba day', () => {
    expect(formatLongDate('2026-08-24T22:30:00Z')).toBe('Tuesday, 25 August 2026');
  });

  it('formatInFacilityZone is the shared primitive', () => {
    expect(formatInFacilityZone(new Date('2026-08-24T03:30:00Z'), { hour: '2-digit', minute: '2-digit', hour12: false }, 'en-GB')).toBe('05:30');
  });
});
