import {
  weekRange, prevWeekStart, nextWeekStart, groupSlotsByDay, buildSlotBody, buildLegacyBody, type PortalSlot,
} from '../booking-logic';

const slot = (date: string, startTime: string, providerName = 'A', providerId = 'p1'): PortalSlot =>
  ({ providerId, providerName, date, startTime, endTime: '10:00', durationMinutes: 30 });

describe('booking-logic', () => {
  it('builds a 7-day range across a month boundary', () => {
    expect(weekRange('2026-10-28')).toEqual({ from: '2026-10-28', to: '2026-11-03' });
  });

  it('never pages before today', () => {
    expect(prevWeekStart('2026-10-20', '2026-10-17')).toBe('2026-10-17');
    expect(prevWeekStart('2026-10-31', '2026-10-17')).toBe('2026-10-24');
    expect(nextWeekStart('2026-10-17')).toBe('2026-10-24');
  });

  it('groups slots by day, keeps empty days, sorts by time then provider', () => {
    const range = weekRange('2026-10-17');
    const days = groupSlotsByDay([
      slot('2026-10-19', '10:00', 'Zed', 'p2'),
      slot('2026-10-19', '09:00'),
      slot('2026-10-19', '10:00', 'Amy', 'p3'),
      slot('2026-11-30', '09:00'),
    ], range);
    expect(days).toHaveLength(7);
    expect(days[0].slots).toEqual([]);
    expect(days[2].slots.map(s => `${s.startTime}${s.providerName}`)).toEqual(['09:00A', '10:00Amy', '10:00Zed']);
  });

  it('builds the slot body without empty optionals', () => {
    const body = buildSlotBody({
      visitReasonId: 'r1', slot: slot('2026-10-19', '09:00'), phone: ' ', contactPreference: 'sms', notes: '  ',
    });
    expect(body).toEqual({
      visitReasonId: 'r1', providerId: 'p1', appointmentDate: '2026-10-19', appointmentTime: '09:00', contactPreference: 'sms',
    });
    const full = buildSlotBody({
      visitReasonId: 'r1', slot: slot('2026-10-19', '09:00'), phone: ' +211 9 ', contactPreference: 'call', notes: ' cough ',
    });
    expect(full.patientPhone).toBe('+211 9');
    expect(full.patientNotes).toBe('cough');
  });

  it('legacy body has no slot fields', () => {
    const b = buildLegacyBody({ phone: '1', facilityId: 'f', facilityName: 'F', date: '2026-10-20', reasonText: 'x', state: 'CES' });
    expect(b).not.toHaveProperty('visitReasonId');
    expect(b.appointmentTime).toBe('');
    expect(b.appointmentDate).toBe('2026-10-20');
  });
});
