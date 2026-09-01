/**
 * `findActiveAppointmentForPatient` is the front desk's one appointment
 * matcher — two call sites in front-desk/page.tsx used to pick the FIRST
 * same-patient appointment of the day regardless of status, so an active
 * walk-in with an earlier CANCELLED booking that morning filed its status
 * changes and checkout against the dead appointment instead of the live one
 * (docs/PATIENT-JOURNEY-GAP-AUDIT-2026-08.md, KAN-118). It is exported as a
 * plain module-level function specifically so this can be tested without
 * rendering the dashboard.
 */
import { findActiveAppointmentForPatient } from '@/lib/appointment-workflow';
import type { AppointmentDoc } from '@/lib/db-types';

function makeAppt(overrides: Partial<AppointmentDoc>): AppointmentDoc {
  return {
    _id: 'apt-base', _rev: '1-x', type: 'appointment',
    patientId: 'pat-1', patientName: 'Test Patient',
    providerId: '', providerName: '',
    facilityId: 'hosp-1', facilityName: 'Test Hospital', facilityLevel: 'payam',
    appointmentDate: '2026-08-29', appointmentTime: '08:00', duration: 15,
    appointmentType: 'walk_in', priority: 'routine', department: 'OPD',
    reason: 'Visit', status: 'checked_in',
    createdAt: '2026-08-29T08:00:00.000Z', updatedAt: '2026-08-29T08:00:00.000Z',
    ...overrides,
  } as AppointmentDoc;
}

describe('findActiveAppointmentForPatient', () => {
  it('excludes a cancelled booking earlier the same day and picks the active one', () => {
    const cancelledMorning = makeAppt({ _id: 'apt-cancelled', appointmentTime: '08:00', status: 'cancelled' });
    const activeAfternoon = makeAppt({ _id: 'apt-active', appointmentTime: '14:00', status: 'checked_in' });
    const todaysAppointments = [cancelledMorning, activeAfternoon]; // pre-sorted by time, as the board builds it

    expect(findActiveAppointmentForPatient(todaysAppointments, 'pat-1')?._id).toBe('apt-active');
  });

  it('also excludes no-show and rescheduled bookings', () => {
    const noShow = makeAppt({ _id: 'apt-noshow', appointmentTime: '08:00', status: 'no_show' });
    const rescheduled = makeAppt({ _id: 'apt-rescheduled', appointmentTime: '09:00', status: 'rescheduled' });
    const active = makeAppt({ _id: 'apt-active', appointmentTime: '10:00', status: 'in_progress' });
    const todaysAppointments = [noShow, rescheduled, active];

    expect(findActiveAppointmentForPatient(todaysAppointments, 'pat-1')?._id).toBe('apt-active');
  });

  it('falls back to the earliest ACTIVE booking when several are open the same day', () => {
    const earlier = makeAppt({ _id: 'apt-earlier', appointmentTime: '08:00', status: 'checked_in' });
    const later = makeAppt({ _id: 'apt-later', appointmentTime: '15:00', status: 'checked_in' });
    const todaysAppointments = [earlier, later];

    expect(findActiveAppointmentForPatient(todaysAppointments, 'pat-1')?._id).toBe('apt-earlier');
  });

  it('prefers the appointment linked to the visit\'s own encounter over a same-patient guess', () => {
    const earlier = makeAppt({ _id: 'apt-earlier', appointmentTime: '08:00', status: 'checked_in' });
    const linked = makeAppt({ _id: 'apt-linked', appointmentTime: '15:00', status: 'checked_in' });
    const todaysAppointments = [earlier, linked];

    expect(findActiveAppointmentForPatient(todaysAppointments, 'pat-1', 'apt-linked')?._id).toBe('apt-linked');
  });

  it('falls back to the time-based match when the encounter-linked appointment is not in the list', () => {
    const active = makeAppt({ _id: 'apt-active', appointmentTime: '08:00', status: 'checked_in' });
    const todaysAppointments = [active];

    expect(findActiveAppointmentForPatient(todaysAppointments, 'pat-1', 'apt-not-found')?._id).toBe('apt-active');
  });

  it('returns undefined when the patient has no active booking today', () => {
    const cancelled = makeAppt({ _id: 'apt-cancelled', status: 'cancelled' });
    expect(findActiveAppointmentForPatient([cancelled], 'pat-1')).toBeUndefined();
    expect(findActiveAppointmentForPatient([], 'pat-1')).toBeUndefined();
  });
});
