import type { UserRole } from './db-types';

/**
 * Reception owns care-team routing. These three accounts are the same
 * front-desk station at different facility tiers; clinical and administrative
 * roles may view assignments, but they may not create or change them.
 */
export const CARE_TEAM_ASSIGNMENT_ROLES: readonly UserRole[] = [
  'front_desk',
  'central_registration_clerk',
  'clinic_clerk',
];

export function canAssignCareTeamRole(role?: UserRole | null): boolean {
  return Boolean(role && CARE_TEAM_ASSIGNMENT_ROLES.includes(role));
}

/**
 * Moving a booked slot (date/time) is reception's — the same roles that own
 * `DOC_WRITE_ROLES.appointment`, which the CouchDB validator enforces. The
 * API route, the service and the edit modal all ask this one predicate so a
 * role the UI locks out cannot reschedule through the API instead.
 */
export function canRescheduleAppointmentRole(role?: UserRole | null): boolean {
  return canAssignCareTeamRole(role);
}

/** Care-team routing is local to the facility operating the visit. */
export function canAssignStaffAtFacility(
  actorFacilityId?: string | null,
  staffFacilityId?: string | null,
): boolean {
  return Boolean(actorFacilityId && staffFacilityId && actorFacilityId === staffFacilityId);
}
