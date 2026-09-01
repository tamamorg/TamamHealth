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
