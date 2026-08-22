/**
 * The roles that book appointments can read the staff directory.
 *
 * `BookAppointmentModal` builds its PROVIDER list from `useUsers()`, which is
 * the same directory `/api/users` guards with `STAFF_DIRECTORY_READ_ROLES`.
 * The desk roles were absent from that list while `canAssignCareTeam` gave
 * them the power to assign a doctor and a nurse to a patient — so the wizard
 * showed "Any clinician" and nothing else, and no appointment could be booked
 * against a named provider from the desk.
 */
import { STAFF_DIRECTORY_READ_ROLES, canReadStaffDirectory } from '@/modules/identity/policy/staff-directory-access';

const DESK_ROLES = ['front_desk', 'central_registration_clerk', 'clinic_clerk'] as const;

describe('staff directory access', () => {
  it.each(DESK_ROLES)('lets %s read the directory the booking wizard needs', (role) => {
    expect(canReadStaffDirectory(role)).toBe(true);
  });

  it('still refuses roles with no reason to hold a staff list', () => {
    // A cashier, a lab bench and a records desk book nobody and assign nobody.
    for (const role of ['cashier', 'lab_tech', 'data_entry_clerk', 'records_hmis_officer']) {
      expect(canReadStaffDirectory(role)).toBe(false);
    }
    expect(canReadStaffDirectory(undefined)).toBe(false);
  });

  it('keeps the list explicit rather than "everyone signed in"', () => {
    expect(STAFF_DIRECTORY_READ_ROLES.length).toBeLessThan(20);
  });
});
