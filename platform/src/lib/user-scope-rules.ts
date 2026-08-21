/**
 * Which tenant scope a staff account is REQUIRED to carry, in one place.
 *
 * `/api/users` enforced these rules twice (once on create, once on update),
 * `user-service.createUser` enforced them a third time, and
 * `/org-admin/users` kept a fourth copy to decide whether to show the facility
 * picker — while `/admin/users` had no copy at all, so its Add-user dialog
 * happily offered "Facility — None —" for a facility-bound role and only found
 * out at submit time, from a 400 the server was right to send.
 *
 * These are the same two invariants the whole platform depends on:
 *
 *  • An account with no `orgId` bypasses `filterByScope`, so it must be a
 *    deliberate platform/national account, never an accident of a blank select.
 *  • An account with no `hospitalId` has no facility to scope its worklists,
 *    schedules, or ward views to, so a facility-bound role without one lands
 *    on empty screens with no way to fix itself.
 *
 * No database, icon, or Next imports — this is read by the Edge-adjacent API
 * routes, by the node-side service layer, and by client components alike.
 */
import type { UserRole } from './db-types';

/**
 * Accounts that are organisation-wide or supra-organisational, so they are
 * never bound to a single facility.
 *
 * `government` and `county_health_director` look across tenants by design;
 * `super_admin` runs the platform; `org_admin` runs a whole organization and
 * would be crippled by being pinned to one of its facilities.
 */
export const ROLES_WITHOUT_FACILITY: readonly UserRole[] = [
  'super_admin', 'org_admin', 'government', 'county_health_director',
] as const;

/**
 * Accounts that carry no organization at all — the platform operator and the
 * two national roles that read across every tenant. Everyone else, `org_admin`
 * included, must belong to exactly one organization.
 */
export const ROLES_WITHOUT_ORGANIZATION: readonly UserRole[] = [
  'super_admin', 'government', 'county_health_director',
] as const;

/**
 * Roles that bypass org scoping in `filterByScope`, so only a platform
 * operator may grant one.
 *
 * A tenant's org_admin creating any of these could read every other
 * organization's PHI, so `/api/users` refuses it (privilege escalation ->
 * tenant breakout). The list lives here because the ROLE PICKERS have to read
 * it too: `assignableRolesForOrgAdmin` used to strip only `super_admin`, so a
 * public-sector org admin was offered `government` and `county_health_director`
 * — two rows that could never do anything but 403 on submit.
 */
export const PLATFORM_ONLY_ASSIGNABLE_ROLES: readonly UserRole[] = [
  'super_admin', 'government', 'county_health_director',
] as const;

/** True when only a super_admin may grant this role. */
export function isPlatformOnlyRole(role: UserRole | string | undefined): boolean {
  return !!role && (PLATFORM_ONLY_ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/** True when this role must be assigned to a facility before it can be saved. */
export function roleNeedsFacility(role: UserRole | string | undefined): boolean {
  return !!role && !(ROLES_WITHOUT_FACILITY as readonly string[]).includes(role);
}

/** True when this role must be assigned to an organization before it can be saved. */
export function roleNeedsOrganization(role: UserRole | string | undefined): boolean {
  return !!role && !(ROLES_WITHOUT_ORGANIZATION as readonly string[]).includes(role);
}

/**
 * The exact messages `/api/users` and `user-service` return, so a client that
 * validates first shows the SAME sentence the server would have — no dialog
 * that says one thing while the API says another.
 */
export const ORG_REQUIRED_MESSAGE = 'Organization administrators must be assigned to an organization';
export const FACILITY_REQUIRED_MESSAGE = 'Clinical users must be assigned to a hospital';

/**
 * Validate an account's scope before it is submitted. Returns the message to
 * show, or null when the assignment is complete.
 *
 * Deliberately mirrors the server's order of checks (organization first, then
 * facility) so the first error a user sees client-side is the first error they
 * would have hit server-side.
 */
export function validateUserScope(input: {
  role: UserRole | string | undefined;
  orgId?: string;
  hospitalId?: string;
}): string | null {
  const { role, orgId, hospitalId } = input;
  if (!role) return null;
  if (roleNeedsOrganization(role) && !orgId) {
    return role === 'org_admin'
      ? ORG_REQUIRED_MESSAGE
      : 'Select the organization this account belongs to.';
  }
  if (roleNeedsFacility(role) && !hospitalId) return FACILITY_REQUIRED_MESSAGE;
  return null;
}
