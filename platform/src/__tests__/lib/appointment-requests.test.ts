import type { AppointmentDoc } from '@/lib/db-types';
import {
  pendingRequests, normalizePhone, telHref, smsHref, requestPhone,
  requestSourceLabel, contactPreferenceOf,
} from '@/lib/appointment-requests';

const mk = (o: Partial<AppointmentDoc>): AppointmentDoc =>
  ({ _id: 'a', type: 'appointment', status: 'requested', appointmentDate: '2026-10-20', appointmentTime: '09:00', ...o }) as AppointmentDoc;

describe('pendingRequests', () => {
  it('keeps only future requested rows, soonest first', () => {
    const rows = [
      mk({ _id: 'late', appointmentDate: '2026-10-25' }),
      mk({ _id: 'past', appointmentDate: '2026-10-10' }),
      mk({ _id: 'sched', status: 'scheduled' }),
      mk({ _id: 'soon2', appointmentDate: '2026-10-18', appointmentTime: '11:00' }),
      mk({ _id: 'soon1', appointmentDate: '2026-10-18', appointmentTime: '08:00' }),
      mk({ _id: 'today', appointmentDate: '2026-10-17' }),
    ];
    expect(pendingRequests(rows, '2026-10-17').map(a => a._id)).toEqual(['today', 'soon1', 'soon2', 'late']);
  });
  it('filters other facilities but keeps unstamped rows', () => {
    const rows = [mk({ _id: 'x', facilityId: 'f2' }), mk({ _id: 'y', facilityId: 'f1' }), mk({ _id: 'z' })];
    expect(pendingRequests(rows, '2026-10-17', 'f1').map(a => a._id).sort()).toEqual(['y', 'z']);
  });
});

describe('phone helpers', () => {
  it('normalizes', () => {
    expect(normalizePhone(' +211 912-345 678 ')).toBe('+211912345678');
    expect(normalizePhone('(0912) 345.678')).toBe('0912345678');
    expect(normalizePhone(undefined)).toBe('');
  });
  it('builds links or null', () => {
    expect(telHref('+211 912 345')).toBe('tel:+211912345');
    expect(smsHref('0912 345')).toBe('sms:0912345');
    expect(telHref('')).toBeNull();
  });
  it('prefers patientPhone over requester phone', () => {
    expect(requestPhone(mk({ patientPhone: '1', requester: { firstName: 'a', lastName: 'b', phone: '2' } }))).toBe('1');
    expect(requestPhone(mk({ requester: { firstName: 'a', lastName: 'b', phone: '2' } }))).toBe('2');
  });
});

describe('source and contact preference', () => {
  it('labels sources, defaulting to Staff', () => {
    expect(requestSourceLabel(mk({ source: 'portal' }))).toBe('Portal');
    expect(requestSourceLabel(mk({ source: 'public_widget' }))).toBe('Online booking');
    expect(requestSourceLabel(mk({}))).toBe('Staff');
  });
  it('reads contactPreference defensively', () => {
    expect(contactPreferenceOf(mk({}))).toBeNull();
    expect(contactPreferenceOf({ ...mk({}), contactPreference: 'sms' } as AppointmentDoc)).toBe('sms');
    expect(contactPreferenceOf({ ...mk({}), contactPreference: 'x' } as unknown as AppointmentDoc)).toBeNull();
  });
});

describe('requestSourceKey for requests without a source', () => {
  it('reads a patient-booked request as portal, not staff', async () => {
    const { requestSourceKey } = await import('@/lib/appointment-requests');
    expect(requestSourceKey({ patientId: 'p1', bookedBy: 'p1' } as never)).toBe('portal');
    expect(requestSourceKey({ patientId: 'p1', bookedBy: 'desk-1' } as never)).toBe('staff');
  });
});
