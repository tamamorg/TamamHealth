/**
 * Shared formatters in src/lib/format-utils.ts. `isoWeek` is the one that
 * matters most: epi-week reporting (IDSR summaries, outbreak trend buckets)
 * keys on its label, so the year-boundary cases below are what stop two
 * screens from filing the same case under two different weeks.
 */
import { isoWeek, titleCase, formatShortDate } from '@/lib/format-utils';

describe('isoWeek', () => {
  it('puts a year-boundary date in the week of its Thursday', () => {
    // 1 Jan 2026 is itself a Thursday — week 1 of 2026.
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1, label: '2026-W01' });
    // 29 Dec 2025 is the Monday of that same week, so it reports as 2026-W01
    // even though it falls in calendar 2025.
    expect(isoWeek('2025-12-29')).toEqual({ year: 2026, week: 1, label: '2026-W01' });
    // The Sunday before still belongs to the last week of 2025.
    expect(isoWeek('2025-12-28')).toEqual({ year: 2025, week: 52, label: '2025-W52' });
  });

  it('reports a 53-week year at the boundary', () => {
    expect(isoWeek('2027-01-03')?.label).toBe('2026-W53');
    expect(isoWeek('2027-01-04')?.label).toBe('2027-W01');
  });

  it('handles a mid-year date and a full timestamp identically', () => {
    expect(isoWeek('2026-08-13')).toEqual({ year: 2026, week: 33, label: '2026-W33' });
    expect(isoWeek('2026-08-13T09:30:00.000Z')?.label).toBe('2026-W33');
  });

  it('reads a Date as the local calendar day it names', () => {
    // Constructed from local parts, so it must resolve to 1 Jan regardless of
    // the runner's timezone.
    expect(isoWeek(new Date(2026, 0, 1))?.label).toBe('2026-W01');
  });

  it('zero-pads single-digit weeks in the label', () => {
    expect(isoWeek('2026-02-09')?.label).toBe('2026-W07');
  });

  it('returns null for empty or unparseable input', () => {
    expect(isoWeek('')).toBeNull();
    expect(isoWeek(null)).toBeNull();
    expect(isoWeek(undefined)).toBeNull();
    expect(isoWeek('not a date')).toBeNull();
    expect(isoWeek(new Date('nonsense'))).toBeNull();
  });
});

describe('titleCase', () => {
  it('capitalizes each word and turns underscores into spaces', () => {
    expect(titleCase('lab_tech')).toBe('Lab Tech');
    expect(titleCase('medical superintendent')).toBe('Medical Superintendent');
    expect(titleCase('x-ray')).toBe('X-Ray');
  });

  it('leaves casing inside a word alone', () => {
    expect(titleCase('Already Cased')).toBe('Already Cased');
    expect(titleCase('ICU nurse')).toBe('ICU Nurse');
  });

  it('returns empty input unchanged', () => {
    expect(titleCase('')).toBe('');
  });
});

describe('formatShortDate', () => {
  it('renders day + short month', () => {
    expect(formatShortDate('2026-08-13')).toBe('13 Aug');
    expect(formatShortDate('2026-08-03')).toBe('3 Aug');
    expect(formatShortDate('2026-08-13T09:30:00.000Z')).toBe('13 Aug');
  });

  it('appends the year on request', () => {
    expect(formatShortDate('2026-08-13', { year: true })).toBe('13 Aug 2026');
  });

  it('reads a Date as its local calendar day', () => {
    expect(formatShortDate(new Date(2026, 7, 13))).toBe('13 Aug');
  });

  it('is stable whatever the runtime locale would have done', () => {
    // The per-file copies this replaces split between 'en-GB' and 'en-US';
    // day-first is the one shape now.
    expect(formatShortDate('2026-01-05')).toBe('5 Jan');
    expect(formatShortDate('2026-12-31')).toBe('31 Dec');
  });

  it('returns empty for missing input and the raw string when unparseable', () => {
    expect(formatShortDate('')).toBe('');
    expect(formatShortDate(null)).toBe('');
    expect(formatShortDate(undefined)).toBe('');
    expect(formatShortDate('sometime')).toBe('sometime');
    expect(formatShortDate('2026-13-01')).toBe('2026-13-01');
  });
});
