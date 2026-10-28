/**
 * Who may move a visit where, from a dashboard dropdown. The picker, the
 * service gate and the sync validator must agree, or a pick looks saved and is
 * refused at replication.
 */
import { appointmentStatusOptionsForRole, appointmentStatusNeedsReason, APPOINTMENT_STATION_ROLES, canRoleMoveAppointment } from '@/lib/appointment-status';
import { DOC_UPDATE_ONLY_FIELDS, DOC_UPDATE_ONLY_ROLES, DOC_WRITE_ROLES } from '@/lib/sync/write-permissions';
import type { UserRole } from '@/lib/db-types';

describe('visit status options by role', () => {
  it('gives reception and admins every rung and exit', () => {
    for (const role of ['front_desk', 'clinic_clerk', 'central_registration_clerk', 'org_admin'] as UserRole[]) {
      expect(appointmentStatusOptionsForRole(role)).toEqual(
        expect.arrayContaining(['scheduled', 'checked_in', 'in_progress', 'completed', 'no_show', 'rescheduled', 'cancelled']),
      );
    }
  });

  it('lets clinical staff advance a visit but not close the book on it', () => {
    for (const role of ['doctor', 'nurse', 'triage_nurse', 'midwife'] as UserRole[]) {
      expect(appointmentStatusOptionsForRole(role)).toEqual(['checked_in', 'in_progress', 'completed']);
    }
  });

  it('lets the stations pick a patient up and finish them', () => {
    for (const role of APPOINTMENT_STATION_ROLES) {
      expect(appointmentStatusOptionsForRole(role)).toEqual(['in_progress', 'completed']);
    }
  });

  it('gives back-office roles a read-only pill', () => {
    for (const role of ['data_entry_clerk', 'hrio', 'government'] as UserRole[]) {
      expect(appointmentStatusOptionsForRole(role)).toEqual([]);
    }
  });

  it('asks for a reason only on exits', () => {
    expect(appointmentStatusNeedsReason('cancelled')).toBe(true);
    expect(appointmentStatusNeedsReason('no_show')).toBe(true);
    expect(appointmentStatusNeedsReason('rescheduled')).toBe(true);
    expect(appointmentStatusNeedsReason('completed')).toBe(false);
  });
});

describe('sync grants match the picker', () => {
  it('lets every role with options amend an appointment status', () => {
    const roles = ['front_desk', 'doctor', 'nurse', ...APPOINTMENT_STATION_ROLES] as UserRole[];
    for (const role of roles) {
      const full = DOC_WRITE_ROLES.appointment?.includes(role);
      const amend = DOC_UPDATE_ONLY_ROLES.appointment?.includes(role);
      expect({ role, granted: !!(full || amend) }).toEqual({ role, granted: true });
    }
    expect(DOC_UPDATE_ONLY_FIELDS.appointment).toEqual(expect.arrayContaining(['status', 'statusHistory', 'startedAt', 'completedAt']));
  });

  it('keeps scheduling and care-team fields out of the stations\' reach', () => {
    expect(DOC_UPDATE_ONLY_FIELDS.appointment).not.toEqual(expect.arrayContaining(['providerId']));
    expect(DOC_UPDATE_ONLY_FIELDS.appointment).not.toContain('appointmentDate');
  });
});

describe('canRoleMoveAppointment', () => {
  it('lets only reception reopen a visit that was taken off the board', () => {
    for (const from of ['cancelled', 'no_show', 'rescheduled'] as const) {
      expect(canRoleMoveAppointment('front_desk', from, 'scheduled')).toBe(true);
      expect(canRoleMoveAppointment('doctor', from, 'checked_in')).toBe(false);
      expect(canRoleMoveAppointment('lab_tech', from, 'in_progress')).toBe(false);
    }
  });

  it('keeps stations to checked-in patients and their own rungs', () => {
    expect(canRoleMoveAppointment('lab_tech', 'checked_in', 'in_progress')).toBe(true);
    expect(canRoleMoveAppointment('pharmacist', 'triaged', 'completed')).toBe(true);
    expect(canRoleMoveAppointment('cashier', 'scheduled', 'in_progress')).toBe(false);
    expect(canRoleMoveAppointment('lab_tech', 'in_progress', 'checked_in')).toBe(false);
    expect(canRoleMoveAppointment('radiologist', 'checked_in', 'cancelled')).toBe(false);
  });

  it('allows system writes and clinical forward moves', () => {
    expect(canRoleMoveAppointment(undefined, 'cancelled', 'scheduled')).toBe(true);
    expect(canRoleMoveAppointment('nurse', 'scheduled', 'checked_in')).toBe(true);
    expect(canRoleMoveAppointment('doctor', 'checked_in', 'no_show')).toBe(false);
  });
});
