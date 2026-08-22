/**
 * A date of birth is a calendar day, not an instant.
 *
 * `new Date('1998-03-14')` is the date-ONLY form, which the spec parses as UTC
 * midnight; reading it back with `getDate()` reports it in LOCAL time. West of
 * UTC that lands a day early, so the chart header and the printed bill both
 * showed every patient born a day before they were — and `patientAge` compared
 * the wrong day when deciding whether the birthday had passed.
 *
 * These assertions are timezone-independent by construction: a calendar day
 * formatted back as itself, and an age measured against the local clock. They
 * failed on the old implementation in every negative UTC offset (the machine
 * this was found on runs America/New_York) and passed in Juba, which is
 * exactly why the bug survived.
 */
import { formatDobOmrs } from '@/lib/date-utils';
import { patientAge } from '@/lib/patient-utils';

describe('date of birth never travels through a timezone', () => {
  it('formats a date-only DOB as the day it was recorded', () => {
    expect(formatDobOmrs('1998-03-14')).toBe('14-Mar-1998');
    expect(formatDobOmrs('1990-06-17')).toBe('17-Jun-1990');
    expect(formatDobOmrs('2026-01-01')).toBe('01-Jan-2026');
  });

  it('still parses a full timestamp as the instant it is', () => {
    expect(formatDobOmrs('1998-03-14T12:00:00.000Z')).toMatch(/^1[34]-Mar-1998$/);
  });

  it('returns the em dash for missing or unparseable input', () => {
    expect(formatDobOmrs(undefined)).toBe('—');
    expect(formatDobOmrs('')).toBe('—');
    expect(formatDobOmrs('not-a-date')).toBe('—');
  });

  it('ages a patient off their local birth day', () => {
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Born exactly 30 years ago today: today IS the birthday, so 30.
    const birthday = new Date(now.getFullYear() - 30, now.getMonth(), now.getDate());
    expect(patientAge({ dateOfBirth: iso(birthday) })).toBe(30);
    // Born 30 years ago tomorrow: the birthday has not happened yet, so 29.
    const tomorrow = new Date(now.getFullYear() - 30, now.getMonth(), now.getDate() + 1);
    expect(patientAge({ dateOfBirth: iso(tomorrow) })).toBe(29);
  });
});

/**
 * The same rule for the shared formatters. A booking made for Monday must not
 * read as Sunday on the patient's own record: `formatDate` is what the chart's
 * appointment row calls, and it parsed the calendar day as UTC midnight.
 */
describe('shared date formatters keep a calendar day local', () => {
  it('formats a date-only value as the day it names', async () => {
    const { formatDate, formatDateTime, formatCompactDateTime } = await import('@/lib/format-utils');
    expect(formatDate('2026-08-24')).toBe('Aug 24, 2026');
    expect(formatDateTime('2026-08-24')).toBe('Aug 24, 2026');
    expect(formatCompactDateTime('2026-08-24')).toBe('Aug 24');
  });

  it('still treats a timestamp as an instant', async () => {
    const { formatDate } = await import('@/lib/format-utils');
    // Midday UTC lands on the same calendar day either side of the meridian.
    expect(formatDate('2026-08-24T12:00:00.000Z')).toBe('Aug 24, 2026');
  });
});
