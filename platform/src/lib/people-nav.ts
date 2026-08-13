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
import type { NavIcon } from './permissions';
import { isHrefAllowed } from '@/components/ehr/ehr-navigation';
import { UserCheck, ClipboardList, CalendarClock, MessageSquare, Wallet } from '@/components/icons/lucide';

/**
 * Where a role manages login credentials. Staff records and user accounts are
 * the SAME document in this platform (a staff member IS a `UserDoc`), so this
 * points at the existing account screens rather than a third users page.
 * Returns null for roles that may not administer accounts.
 */
export function usersHrefForRole(role: UserRole | string): string | null {
  if (role === 'super_admin') return '/admin/users';
  // The org-scoped accounts page is the single staff list: the separate HR
  // "Staff Roster" was the same roster under another name and has been
  // removed, so the roles that ran a facility read their people here too.
  if (role === 'org_admin' || role === 'medical_superintendent' || role === 'hospital_manager') {
    return '/org-admin/users';
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

export interface PeopleNavContext {
  role: UserRole | string;
  allowedRoutes: readonly string[];
}

export interface AddMenuEntry {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  description?: string;
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
  const candidates: AddMenuEntry[] = [
    ...(usersHref && canCreateUsers(role)
      ? [{ key: 'staff', label: 'Add staff member', href: `${usersHref}?new=1`, icon: UserCheck, description: 'Creates their login too' } as AddMenuEntry]
      : []),
    { key: 'inquiry', label: 'Add patient inquiry', href: '/inquiries?new=1', icon: MessageSquare, description: 'Log a call or walk-in' },
    { key: 'shift', label: 'Create shift', href: '/hr/schedule?new=1', icon: CalendarClock, description: 'Roster someone on duty' },
    { key: 'leave', label: 'Request leave', href: '/hr/leave?new=1', icon: ClipboardList, description: 'Log time off' },
    { key: 'payroll', label: 'Add payroll entry', href: '/hr/payroll?new=1', icon: Wallet, description: 'Open this period\u2019s register' },
  ];

  return candidates.filter(entry => isHrefAllowed(entry.href, allowedRoutes));
}
