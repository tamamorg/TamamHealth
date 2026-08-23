/**
 * Who reaches the facility console, and who may manage a facility inside it.
 *
 * Stated once because three surfaces need the same answer and had begun to
 * state it three times: the Organizations page (which hosts the facility
 * network), the facility's own page at `/admin/facilities/[id]`, and the
 * network view that lists them. Two copies already existed and matched only by
 * luck — nothing failed when they drifted, because a drift shows up as a role
 * that can open a page and then finds half of it missing.
 *
 * These decide what is OFFERED. The barriers are elsewhere and stay there:
 * `lib/role-routes.ts` (which the Edge proxy enforces) decides who may load
 * the route at all, and `filterByScope` decides which facilities they see.
 * A list here that is wider than the route table produces a dead link; one
 * that is narrower produces a page nobody can open. Both must name the same
 * roles — `__tests__/rbac/facility-access.test.ts` holds them together.
 */

import type { UserRole } from './db-types';

/**
 * Roles whose navigation offers the facility network, and which may therefore
 * open a facility's page.
 *
 * Inherited from the roles that had `/hospitals` in their nav before that
 * route was deleted (2026-08-23), plus the platform operator. Six of these
 * have no other facility list anywhere in the product.
 */
export const FACILITY_CONSOLE_ROLES: readonly UserRole[] = [
  'super_admin',
  'org_admin',
  'government',
  'county_health_director',
  'medical_superintendent',
  'hrio',
  'hospital_manager',
  'records_hmis_officer',
];

/**
 * Roles that may work a facility — the staff, wards, equipment, inventory,
 * schedules, performance and settings sections.
 *
 * Narrower than the console: an oversight role reads the network, it does not
 * staff a ward in it. Every service call underneath is scoped regardless, so
 * this governs what is shown, not what is permitted.
 */
export const FACILITY_MANAGE_ROLES: readonly UserRole[] = [
  'super_admin',
  'org_admin',
  'medical_superintendent',
  'hrio',
];

export function canOpenFacilityConsole(role: UserRole | undefined): boolean {
  return !!role && FACILITY_CONSOLE_ROLES.includes(role);
}

export function canManageFacility(role: UserRole | undefined): boolean {
  return !!role && FACILITY_MANAGE_ROLES.includes(role);
}
