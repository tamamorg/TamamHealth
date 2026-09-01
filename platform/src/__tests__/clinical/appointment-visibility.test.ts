import { appointmentsVisibleToUser, canViewAppointment } from '@/lib/appointment-visibility';
import type { AppointmentDoc } from '@/lib/db-types';

function appointment(overrides: Partial<AppointmentDoc> = {}): AppointmentDoc {
  return {
    _id: overrides._id || 'appointment-1',
    type: 'appointment',
    createdAt: '2026-08-26T08:00:00.000Z',
    updatedAt: '2026-08-26T08:00:00.000Z',
    patientId: 'patient-1',
    patientName: 'Test Patient',
    providerId: 'doctor-1',
    providerName: 'Dr Test',
    staffId: 'nurse-1',
    staffName: 'Nurse Test',
    facilityId: 'facility-1',
    facilityName: 'Test Facility',
    facilityLevel: 'payam',
    appointmentDate: '2026-08-26',
    appointmentTime: '09:00',
    duration: 30,
    appointmentType: 'general',
    priority: 'routine',
    department: 'OPD',
    reason: 'Review',
    status: 'scheduled',
    reminderSent: false,
    isRecurring: false,
    bookedBy: 'clerk-1',
    bookedByName: 'Clerk',
    state: 'Central Equatoria',
    ...overrides,
  } as AppointmentDoc;
}

describe('appointment calendar visibility', () => {
  const assigned = appointment();
  const another = appointment({ _id: 'appointment-2', providerId: 'doctor-2', staffId: 'nurse-2' });

  test('providers see only appointments assigned as provider', () => {
    expect(appointmentsVisibleToUser([assigned, another], { _id: 'doctor-1', role: 'doctor' }))
      .toEqual([assigned]);
  });

  test('nurses see only appointments assigned as supporting staff', () => {
    expect(appointmentsVisibleToUser([assigned, another], { _id: 'nurse-1', role: 'nurse' }))
      .toEqual([assigned]);
  });

  test('a nurse carrying a primary-care visit as provider sees it too', () => {
    const nurseLed = appointment({ providerId: 'nurse-1', staffId: '' });
    expect(canViewAppointment(nurseLed, { _id: 'nurse-1', role: 'nurse' })).toBe(true);
  });

  test('facility scheduling roles see the facility-scoped book supplied to them', () => {
    expect(appointmentsVisibleToUser([assigned, another], { _id: 'desk-1', role: 'front_desk' }))
      .toEqual([assigned, another]);
  });

  test('unassigned patients stay out of every calendar, including the facility book', () => {
    const unassigned = appointment({ _id: 'appointment-unassigned', providerId: '', staffId: '' });
    expect(canViewAppointment(unassigned, { _id: 'desk-1', role: 'front_desk' })).toBe(false);
    expect(canViewAppointment(unassigned, { _id: 'doctor-1', role: 'doctor' })).toBe(false);
    expect(canViewAppointment(unassigned, { _id: 'nurse-1', role: 'nurse' })).toBe(false);
  });

  test('unrelated roles and anonymous viewers fail closed', () => {
    expect(canViewAppointment(assigned, { _id: 'lab-1', role: 'lab_tech' })).toBe(false);
    expect(canViewAppointment(assigned, null)).toBe(false);
  });
});
