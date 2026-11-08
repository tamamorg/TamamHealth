/**
 * The desk's check-in guard, booking default, dashboards, top-rail count and
 * the seeded date-only fields share one clock: the facility's day. A device
 * west of Juba in the evening has a different local day.
 */
import { jubaDate, facilityToday, facilityDayOf, isOnFacilityDay } from '@/lib/time-juba';
import { selectTriageQueueRows } from '@/components/nurse/triage-queue';

describe('facility day vs device-local day', () => {
  afterEach(() => jest.restoreAllMocks());

  it('20:30 US Eastern on Nov 7 is already Nov 8 in Juba', () => {
    expect(jubaDate(new Date('2026-11-08T01:30:00Z'))).toBe('2026-11-08');
  });

  it('Juba midnight rolls at 22:00 UTC', () => {
    expect(jubaDate(new Date('2026-11-07T21:59:00Z'))).toBe('2026-11-07');
    expect(jubaDate(new Date('2026-11-07T22:00:00Z'))).toBe('2026-11-08');
  });

  it('facilityToday() follows the clock, not the device day', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-08T01:30:00Z').getTime());
    jest.useFakeTimers().setSystemTime(new Date('2026-11-08T01:30:00Z'));
    try {
      expect(facilityToday()).toBe('2026-11-08');
    } finally {
      jest.useRealTimers();
    }
  });

  it('facilityDayOf passes date-only values through and converts instants', () => {
    expect(facilityDayOf('2026-11-07')).toBe('2026-11-07');
    expect(facilityDayOf('2026-11-07T22:30:00Z')).toBe('2026-11-08');
    expect(facilityDayOf('')).toBe('');
    expect(facilityDayOf(undefined)).toBe('');
  });

  it('a triage at 23:00 UTC belongs to the next Juba day (seed triage-today predicate)', () => {
    // The old test, slice(0,10) of the UTC instant, said Nov 7 here.
    expect(isOnFacilityDay('2026-11-07T23:00:00Z', '2026-11-08')).toBe(true);
    expect(isOnFacilityDay('2026-11-07T23:00:00Z', '2026-11-07')).toBe(false);
    expect(isOnFacilityDay('2026-11-08T00:30:00Z', '2026-11-08')).toBe(true);
    expect(isOnFacilityDay(undefined, '2026-11-08')).toBe(false);
    expect(isOnFacilityDay('not a date', '2026-11-08')).toBe(false);
  });

  it('the nurse triage queue keeps completed-today rows on the facility day', () => {
    const rows = [
      { id: 'a', status: 'discharged' as const, triagedAt: '2026-11-07T23:00:00Z' },
      { id: 'b', status: 'discharged' as const, triagedAt: '2026-11-07T10:00:00Z' },
    ];
    const kept = selectTriageQueueRows(rows, { includeCompletedToday: true, todayIso: '2026-11-08' });
    expect(kept.map(r => r.id)).toEqual(['a']);
  });
});
