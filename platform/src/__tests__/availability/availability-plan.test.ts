import {
  appliesOnDate, clinicNow, clinicianDays, countSlots, firstClash, planSegments, validateDayPlan,
} from '@/lib/availability-plan';
import type { AvailabilityDoc } from '@/lib/db-types';

const win = (patch: Partial<AvailabilityDoc>): AvailabilityDoc => ({
  _id: `w-${Math.random()}`, type: 'availability', providerId: 'dr', providerName: 'Dr. A', facilityId: 'h',
  facilityName: 'H', date: '2026-11-04', startTime: '08:00', endTime: '12:00', slotMinutes: 30,
  modality: 'in_person', status: 'open', createdAt: '', updatedAt: '', ...patch,
} as AvailabilityDoc);

describe('day plan', () => {
  it('cuts the breaks out of the working day', () => {
    expect(planSegments('08:00', '17:00', [
      { kind: 'tea', start: '10:30', end: '10:45' },
      { kind: 'lunch', start: '13:00', end: '14:00' },
    ])).toEqual([
      { start: '08:00', end: '10:30' },
      { start: '10:45', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ]);
  });

  it('drops an empty stretch when a break starts the day', () => {
    expect(planSegments('08:00', '12:00', [{ kind: 'ward_round', start: '08:00', end: '09:00' }]))
      .toEqual([{ start: '09:00', end: '12:00' }]);
  });

  it('counts whole slots only', () => {
    expect(countSlots([{ start: '08:00', end: '10:30' }, { start: '10:45', end: '13:00' }], 30)).toBe(5 + 4);
  });

  it('accepts a normal day with lunch', () => {
    expect(validateDayPlan({ start: '08:00', end: '17:00', breaks: [{ kind: 'lunch', start: '13:00', end: '14:00' }], slotMinutes: 30 })).toBeNull();
  });

  it('refuses an end before the start (the evening "now + 3h" default)', () => {
    expect(validateDayPlan({ start: '21:30', end: '00:30', breaks: [], slotMinutes: 30 })?.problem).toBe('clinicHours.errorEndBeforeStart');
  });

  it('names the break that is wrong', () => {
    const breaks = [
      { kind: 'lunch' as const, start: '13:00', end: '14:00' },
      { kind: 'tea' as const, start: '13:30', end: '13:45' },
    ];
    expect(validateDayPlan({ start: '08:00', end: '17:00', breaks, slotMinutes: 30 })).toEqual({ problem: 'clinicHours.errorBreakOverlap', breakIndex: 1 });
    expect(validateDayPlan({ start: '08:00', end: '12:00', breaks: [breaks[0]], slotMinutes: 30 })).toEqual({ problem: 'clinicHours.errorBreakOutside', breakIndex: 0 });
    expect(validateDayPlan({ start: '08:00', end: '17:00', breaks: [{ kind: 'tea', start: '11:00', end: '10:00' }], slotMinutes: 30 })?.problem).toBe('clinicHours.errorBreakTimes');
  });

  it('refuses a day the breaks leave no slot in', () => {
    expect(validateDayPlan({ start: '08:00', end: '09:00', breaks: [{ kind: 'meeting', start: '08:20', end: '08:50' }], slotMinutes: 30 })?.problem).toBe('clinicHours.errorNoBookableTime');
  });
});

describe('clashes', () => {
  it('sees a one-off day clash with a weekly series on the same weekday', () => {
    // 2026-11-04 is a Wednesday.
    const weekly = win({ date: '2026-10-01', recurrence: { daysOfWeek: [3], until: '2026-12-31' } });
    expect(firstClash(weekly, win({ date: '2026-11-04', startTime: '11:00', endTime: '15:00' }))).toBe('2026-11-04');
    expect(firstClash(weekly, win({ date: '2026-11-05', startTime: '11:00', endTime: '15:00' }))).toBeNull();
    expect(firstClash(weekly, win({ date: '2026-11-04', startTime: '12:00', endTime: '15:00' }))).toBeNull();
  });

  it('skips a series exception', () => {
    const weekly = win({ date: '2026-10-01', recurrence: { daysOfWeek: [3], until: '2026-12-31', exceptions: ['2026-11-04'] } });
    expect(appliesOnDate(weekly, '2026-11-04')).toBe(false);
    expect(firstClash(weekly, win({ date: '2026-11-04' }))).toBeNull();
  });
});

describe('the desk view', () => {
  const breaks = [{ kind: 'lunch' as const, start: '13:00', end: '14:00' }];
  const plan = [
    win({ startTime: '08:00', endTime: '13:00', dayPlanId: 'p', dayStart: '08:00', dayEnd: '17:00', breaks, department: 'Outpatient' }),
    win({ startTime: '14:00', endTime: '17:00', dayPlanId: 'p', dayStart: '08:00', dayEnd: '17:00', breaks }),
  ];

  it('folds a plan into one day with its named break', () => {
    const [day] = clinicianDays(plan, '2026-11-04');
    expect(day).toMatchObject({ providerName: 'Dr. A', start: '08:00', end: '17:00', department: 'Outpatient', breaks });
  });

  it('shows an unnamed gap between separate windows as a break', () => {
    const [day] = clinicianDays([win({ startTime: '08:00', endTime: '12:00' }), win({ startTime: '14:00', endTime: '16:30' })], '2026-11-04');
    expect(day.breaks).toEqual([{ kind: 'other', start: '12:00', end: '14:00' }]);
  });

  it('says where the day stands', () => {
    const [day] = clinicianDays(plan, '2026-11-04');
    expect(clinicNow(day, '07:30')).toEqual({ state: 'before' });
    expect(clinicNow(day, '09:00')).toEqual({ state: 'in' });
    expect(clinicNow(day, '13:15')).toEqual({ state: 'break', kind: 'lunch', until: '14:00' });
    expect(clinicNow(day, '17:00')).toEqual({ state: 'after' });
  });

  it('leaves out other days and cancelled windows', () => {
    expect(clinicianDays([win({ date: '2026-11-05' }), win({ status: 'cancelled' })], '2026-11-04')).toEqual([]);
  });
});
