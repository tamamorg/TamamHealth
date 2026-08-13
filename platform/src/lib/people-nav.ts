/**
 * "People & HR" navigation and the global "Add" menu — pure definitions.
 *
 * Kept out of the components so the routes, role gating, and active-state
 * rules can be unit-tested without a DOM, matching how the rest of the app
 * tests dashboards (pure combiner exported, component stays thin).
 *
 * Two gates must agree for any destination here, exactly as elsewhere in the
 * app: `ROLE_ROUTE_TABLE[role].allowed` decides whether the page loads, and
 * `isHrefAllowed` decides whether the menu row renders. Note `isHrefAllowed`
 * has no super_admin wildcard — it reads the literal allowed list — so every
 * route named here is also present in super_admin's table entry.
 */

import type { UserRole } from './db-types';
import type { NavIcon } from './permissions';
import { isHrefAllowed } from '@/components/ehr/ehr-navigation';
import {
  Users, UserCheck, KeyRound, ClipboardList, CalendarClock, Wallet, MessageSquare, LayoutDashboard,
} from '@/components/icons/lucide';

export interface PeopleNavEntry {
  key: string;
  label: string;
  href: string;
  icon: NavIcon;
  description?: string;
  section?: string;
}

/**
 * Where a role manages login credentials. Staff records and user accounts are
 * the SAME document in this platform (a staff member IS a `UserDoc`), so this
 * points at the existing account screens rather than a third users page.
 * Returns null for roles that may not administer accounts.
 */
export function usersHrefForRole(role: UserRole | string): string | null {
  if (role === 'super_admin') return '/admin/users';
  if (role === 'org_admin') return '/org-admin/users';
  return null;
}

export interface PeopleNavContext {
  role: UserRole | string;
  allowedRoutes: readonly string[];
}

/**
 * The People & HR dropdown, filtered to what this role may actually open.
 * Every entry points at a real route; there are no placeholder rows.
 */
export function buildPeopleNavEntries({ role, allowedRoutes }: PeopleNavContext): PeopleNavEntry[] {
  const usersHref = usersHrefForRole(role);
  const candidates: PeopleNavEntry[] = [
    { key: 'overview', label: 'Overview', href: '/dashboard/hr', icon: LayoutDashboard, description: 'Workforce at a glance', section: 'PEOPLE & HR' },
    { key: 'roster', label: 'Staff Roster', href: '/hr?tab=roster', icon: Users, description: 'Everyone who works here', section: 'PEOPLE & HR' },
    ...(usersHref
      ? [{ key: 'accounts', label: 'User Accounts & Access', href: usersHref, icon: KeyRound, description: 'Logins, roles, permissions', section: 'PEOPLE & HR' } as PeopleNavEntry]
      : []),
    { key: 'leave', label: 'Leave Requests', href: '/hr?tab=leave', icon: ClipboardList, description: 'Approve and track absence', section: 'SCHEDULING' },
    { key: 'schedule', label: 'Shift Schedule', href: '/hr?tab=schedule', icon: CalendarClock, description: 'Who is on duty', section: 'SCHEDULING' },
    { key: 'payroll', label: 'Payroll', href: '/hr?tab=payroll', icon: Wallet, description: 'Pay periods and registers', section: 'SCHEDULING' },
    { key: 'inquiries', label: 'Patient Inquiries', href: '/inquiries', icon: MessageSquare, description: 'Inbound enquiries to triage', section: 'PATIENTS' },
  ];

  return candidates.filter(entry => isHrefAllowed(entry.href, allowedRoutes));
}

/** True when `pathname` + `search` is the page this entry points at. */
export function isPeopleEntryActive(entry: PeopleNavEntry, pathname: string, search = ''): boolean {
  const [entryPath, entryQuery] = entry.href.split('?');
  if (pathname !== entryPath) return false;
  if (!entryQuery) return true;
  // Tab-scoped entries (/hr?tab=leave) are active only for their own tab.
  // `/hr` with no tab shows the roster, so the roster row owns that case.
  const wanted = new URLSearchParams(entryQuery).get('tab');
  if (!wanted) return true;
  const actual = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab');
  return (actual || 'roster') === wanted;
}

/** True when the current route lives anywhere inside the People & HR menu. */
export function isPeopleSectionActive(entries: PeopleNavEntry[], pathname: string): boolean {
  return entries.some(entry => pathname === entry.href.split('?')[0]);
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
    ...(usersHref
      ? [{ key: 'staff', label: 'Add staff member', href: `${usersHref}?new=1`, icon: UserCheck, description: 'Creates their login too' } as AddMenuEntry]
      : []),
    { key: 'inquiry', label: 'Add patient inquiry', href: '/inquiries?new=1', icon: MessageSquare, description: 'Log a call or walk-in' },
    { key: 'shift', label: 'Create shift', href: '/hr?tab=schedule&new=1', icon: CalendarClock, description: 'Roster someone on duty' },
    { key: 'leave', label: 'Record leave request', href: '/hr?tab=leave&new=1', icon: ClipboardList, description: 'Log time off' },
  ];

  return candidates.filter(entry => isHrefAllowed(entry.href, allowedRoutes));
}
