/**
 * The global "Add" menu — pure definitions.
 *
 * Kept out of the component so the destinations and role gating can be
 * unit-tested without a DOM, matching how the rest of the app tests dashboards
 * (pure logic exported, component stays thin).
 *
 * Two gates must agree for any destination here, exactly as elsewhere in the
 * app: `ROLE_ROUTE_TABLE[role].allowed` decides whether the page loads, and
 * `isHrefAllowed` decides whether the menu row renders. Note `isHrefAllowed`
 * has no super_admin wildcard — it reads the literal allowed list — so every
 * route named here is also present in super_admin's table entry.
 *
 * The People & HR NAVIGATION itself is not built here: it is hand-authored per
 * role in `ROLE_PERMISSIONS[role].navItems` (permissions.ts), the same as every
 * other nav section, and rendered by the existing module menu.
 */

import type { UserRole } from './db-types';
import { isHrefAllowed } from '@/components/ehr/ehr-navigation';

/**
 * Where a role manages login credentials. Staff records and user accounts are
 * the SAME document in this platform (a staff member IS a `UserDoc`), so this
 * points at the existing account screens rather than a third users page.
 * Returns null for roles that may not administer accounts.
 */
export function usersHrefForRole(role: UserRole | string): string | null {
  if (role === 'super_admin') return '/manage?view=people';
  // The org-scoped accounts page is the single staff list: the separate HR
  // "Staff Roster" was the same roster under another name and has been
  // removed, so the roles that ran a facility read their people here too.
  if (role === 'org_admin' || role === 'medical_superintendent' || role === 'hospital_manager') {
    return '/manage?view=people';
  }
  return null;
}

/**
 * Who may CREATE an account, which is narrower than who may read the list:
 * /api/users' WRITE_ROLES is super_admin and org_admin only, so offering
 * "Add staff member" to a facility manager would just 403.
 */
export function canCreateUsers(role: UserRole | string): boolean {
  return role === 'super_admin' || role === 'org_admin';
}

/**
 * Where a role registers facilities. `/admin/organizations` hosts the network
 * every role with facility sight already has in its nav; it hosts the create
 * dialog so there is no second "Facilities" row competing with it. The
 * org-scoped editor at `/org-admin/hospitals` is the same registry embedded in
 * Settings, and opens the same dialog.
 */
export function facilitiesHrefForRole(role: UserRole | string): string | null {
  return canCreateFacilities(role) ? '/manage?view=facilities' : null;
}

/**
 * Who may CREATE a facility.
 *
 * Deliberately narrower than /api/hospitals' WRITE_ROLES, which also admits
 * `medical_superintendent`: a superintendent runs ONE facility, so registering
 * new sites in the tenant is an organisation-level act, not a facility-level
 * one. The API stays the enforcement point — this only decides who is offered
 * the action, and a UI narrower than its API is the safe direction.
 *
 * `super_admin` is here because the platform operator had no working facility
 * path at all: the only form that admitted them stamped `currentUser.orgId`
 * onto the document, and an operator carries none, so `createHospital` threw
 * on every attempt. They now pick the owning organization in the dialog.
 */
export function canCreateFacilities(role: UserRole | string): boolean {
  return role === 'super_admin' || role === 'org_admin';
}

export interface PeopleNavContext {
  role: UserRole | string;
  allowedRoutes: readonly string[];
}

export interface AddMenuEntry {
  key: string;
  label: string;
  href: string;
}

/**
 * The global "Add" menu.
 *
 * There is deliberately no separate "Create user account" action. A staff
 * member and their login are one document here, so a second entry would write
 * the same record under a different name — the duplicate-source-of-truth this
 * module exists to avoid. "Add staff member" creates the account; the
 * accounts page manages the access on it afterwards.
 */
export function buildAddMenuEntries({ role, allowedRoutes }: PeopleNavContext): AddMenuEntry[] {
  const usersHref = usersHrefForRole(role);
  const facilitiesHref = facilitiesHrefForRole(role);
  const withNew = (href: string) => `${href}${href.includes('?') ? '&' : '?'}new=1`;
  const candidates: AddMenuEntry[] = [
    // Facility first: a facility-bound role cannot be saved without one
    // (`roleNeedsFacility`), so registering the site genuinely precedes hiring
    // into it. This entry is what was missing — the create form existed, but
    // nothing in the running app pointed at it.
    ...(facilitiesHref
      ? [{ key: 'facility', label: 'Add facility', href: withNew(facilitiesHref) } as AddMenuEntry]
      : []),
    ...(usersHref && canCreateUsers(role)
      ? [{ key: 'staff', label: 'Add staff member', href: withNew(usersHref) } as AddMenuEntry]
      : []),
    { key: 'inquiry', label: 'Add patient inquiry', href: '/inquiries?new=1' },
    { key: 'shift', label: 'Create shift', href: '/hr/schedule?new=1' },
    { key: 'leave', label: 'Request leave', href: '/hr/leave?new=1' },
    { key: 'payroll', label: 'Add payroll entry', href: '/hr/payroll?new=1' },
  ];

  return candidates.filter(entry => isHrefAllowed(entry.href, allowedRoutes));
}
