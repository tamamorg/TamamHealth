/**
 * @jest-environment node
 *
 * The "PEOPLE & HR" module-menu section and the global Add menu.
 *
 * Two gates must agree for any nav destination: `ROLE_ROUTE_TABLE` decides
 * whether the page loads, and `isHrefAllowed` (which has NO super_admin
 * wildcard — it reads the literal allowed list) decides whether the row
 * renders. A row that renders for a role that cannot open it is a dead end; a
 * reachable route with no row is invisible. Both are pinned here.
 */

import { buildAddMenuEntries, canCreateUsers, usersHrefForRole } from '@/lib/people-nav';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import { isHrefAllowed, uniqueAllowedNavItems, groupNavItemsBySection } from '@/components/ehr/ehr-navigation';
import type { UserRole } from '@/lib/db-types';

const ALL_ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];
const allowedFor = (role: UserRole) => ROLE_ROUTE_TABLE[role].allowed;
/**
 * The people section, under either heading.
 *
 * Facility roles get 'PEOPLE & HR' — accounts plus the workforce area. The
 * platform operator gets a narrower 'PEOPLE', because it employs nobody at a
 * facility (see `super_admin` in permissions.ts).
 */
const PEOPLE_SECTIONS = ['PEOPLE & HR', 'PEOPLE'];
const peopleItems = (role: UserRole) =>
  ROLE_PERMISSIONS[role].navItems.filter(item => PEOPLE_SECTIONS.includes(item.section ?? ''));

/**
 * Roles that own the workforce area — leave, shifts, payroll, enquiries.
 *
 * `super_admin` is deliberately absent. It is a SaaS platform operator: it has
 * no staff at a facility to schedule, no leave to approve and no payroll to
 * run. Those four rows were on its console and are not any more; the routes
 * stay registered for the roles below, which do employ the people.
 */
const HR_ROLES: UserRole[] = ['org_admin', 'medical_superintendent', 'hospital_manager'];

describe('PEOPLE & HR nav section', () => {
  test.each(HR_ROLES)('%s gets the workforce destinations', role => {
    const hrefs = peopleItems(role).map(i => i.href);
    expect(hrefs).toEqual(expect.arrayContaining([
      '/hr/leave', '/hr/schedule', '/hr/payroll', '/inquiries',
    ]));
  });

  test('the platform operator gets none of the workforce destinations', () => {
    const hrefs = peopleItems('super_admin').map(i => i.href);
    for (const href of ['/hr/leave', '/hr/schedule', '/hr/payroll', '/inquiries']) {
      expect(hrefs).not.toContain(href);
    }
    // The routes themselves stay reachable — this is a nav decision, not a
    // revocation, and the roles that own the workforce still need them.
    for (const role of HR_ROLES) expect(isPathAllowed(role, '/hr/leave')).toBe(true);
  });

  test('the HR landing page has no nav row — its content merged into the facility dashboard', () => {
    // /dashboard/hr and /facility-management were two overlapping operational
    // homes. The pending-leave queue now lives on the facility dashboard as a
    // tab, so listing both again would recreate the split.
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role].navItems.map(i => i.href)).not.toContain('/dashboard/hr');
    }
  });

  test('every workforce role gets one accounts row — it is the staff list', () => {
    // The HR module's "Staff Roster" was the same roster as this page, so it
    // was removed and the facility roles read their people here instead.
    const accountsHref = (role: UserRole) =>
      peopleItems(role).map(i => i.href).find(h => h.endsWith('/users')) ?? null;
    expect(accountsHref('super_admin')).toBe('/admin/users');
    expect(accountsHref('org_admin')).toBe('/org-admin/users');
    expect(accountsHref('hospital_manager')).toBe('/org-admin/users');
    expect(accountsHref('medical_superintendent')).toBe('/org-admin/users');
    // The nav row and the Add-menu target must not drift apart.
    for (const role of HR_ROLES) expect(accountsHref(role)).toBe(usersHrefForRole(role));
  });

  test('no role keeps a second staff list beside the accounts page', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_PERMISSIONS[role].navItems.map(i => i.href)).not.toContain('/hr/roster');
    }
  });

  test('clinical roles get no PEOPLE & HR section at all', () => {
    for (const role of ['doctor', 'nurse', 'pharmacist', 'lab_tech', 'front_desk'] as UserRole[]) {
      expect(peopleItems(role)).toEqual([]);
    }
  });

  test('every PEOPLE & HR row is a page its role can actually open', () => {
    for (const role of ALL_ROLES) {
      for (const item of peopleItems(role)) {
        const path = item.href.split('?')[0];
        expect(isPathAllowed(role, path)).toBe(true);
        // …and survives the nav-visibility filter, which is a separate gate.
        expect(isHrefAllowed(item.href, allowedFor(role))).toBe(true);
      }
    }
  });

  test('the section survives the runtime nav filter as ONE contiguous group', () => {
    // Grouping is run-based, not keyed: items sharing a section but separated
    // by another section render as two groups with duplicate headings.
    for (const role of HR_ROLES) {
      const visible = uniqueAllowedNavItems(ROLE_PERMISSIONS[role].navItems, allowedFor(role));
      const groups = groupNavItemsBySection(visible).filter(g => g.section === 'PEOPLE & HR');
      expect(groups).toHaveLength(1);
      expect(groups[0].items.length).toBeGreaterThanOrEqual(5);
    }
  });

  test('the platform operator’s narrower section is contiguous too', () => {
    const visible = uniqueAllowedNavItems(
      ROLE_PERMISSIONS.super_admin.navItems, allowedFor('super_admin'),
    );
    const groups = groupNavItemsBySection(visible).filter(g => g.section === 'PEOPLE');
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(i => i.href)).toEqual(['/admin/users', '/transfers']);
  });

  test('no role lists the same destination twice across its whole nav', () => {
    for (const role of ALL_ROLES) {
      const hrefs = ROLE_PERMISSIONS[role].navItems.map(i => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });

  test('/messages is labelled as messaging, not as enquiries', () => {
    // It is staff-to-staff chat. Labelling it "Enquiries" sent anyone hunting
    // inbound patient enquiries to the wrong screen; those live at /inquiries.
    for (const role of ALL_ROLES) {
      for (const item of ROLE_PERMISSIONS[role].navItems) {
        if (item.href === '/messages') expect(item.label).not.toMatch(/enquir|inquir/i);
        if (/enquir|inquir/i.test(item.label)) expect(item.href).toBe('/inquiries');
      }
    }
  });
});

describe('buildAddMenuEntries', () => {
  test('org_admin can add a facility, staff, inquiries, shifts, leave and payroll', () => {
    const entries = buildAddMenuEntries({ role: 'org_admin', allowedRoutes: allowedFor('org_admin') });
    expect(entries.map(e => e.key)).toEqual(['facility', 'staff', 'inquiry', 'shift', 'leave', 'payroll']);
    expect(entries.find(e => e.key === 'staff')!.href).toBe('/org-admin/users?new=1');
  });

  test('"Add facility" comes before "Add staff member" — a facility role cannot be saved without one', () => {
    // roleNeedsFacility() blocks the account until the facility exists, so the
    // menu lists the steps in the order the platform actually enforces.
    for (const role of ['super_admin', 'org_admin'] as UserRole[]) {
      const keys = buildAddMenuEntries({ role, allowedRoutes: allowedFor(role) }).map(e => e.key);
      expect(keys.indexOf('facility')).toBeGreaterThanOrEqual(0);
      expect(keys.indexOf('facility')).toBeLessThan(keys.indexOf('staff'));
    }
  });

  test('super_admin adds staff through the platform accounts page', () => {
    const entries = buildAddMenuEntries({ role: 'super_admin', allowedRoutes: allowedFor('super_admin') });
    expect(entries.find(e => e.key === 'staff')!.href).toBe('/admin/users?new=1');
  });

  test('there is no separate "create user account" action — staff and login are one record', () => {
    const entries = buildAddMenuEntries({ role: 'super_admin', allowedRoutes: allowedFor('super_admin') });
    expect(entries.map(e => e.label.toLowerCase()).filter(l => l.includes('user account'))).toHaveLength(0);
    // The single staff entry IS the account-creating one — it points at the
    // users console's create form. (This used to also assert a "Creates their
    // login too" subline; the menu no longer renders per-item clarifiers, so
    // the rule is pinned to the destination instead of to copy.)
    expect(entries.find(e => e.key === 'staff')!.href).toMatch(/\/users\?new=1$/);
  });

  test('a role that cannot administer accounts keeps the entries it can use', () => {
    const entries = buildAddMenuEntries({ role: 'hospital_manager', allowedRoutes: allowedFor('hospital_manager') });
    expect(entries.map(e => e.key)).not.toContain('staff');
    expect(entries.map(e => e.key)).toEqual(expect.arrayContaining(['shift', 'leave', 'inquiry', 'payroll']));
  });

  test('a clinical role gets nothing, so the Add button hides entirely', () => {
    for (const role of ['nurse', 'doctor', 'lab_tech'] as UserRole[]) {
      expect(buildAddMenuEntries({ role, allowedRoutes: allowedFor(role) })).toEqual([]);
    }
  });

  test('every Add destination is openable by that role and carries the ?new flag', () => {
    for (const role of ALL_ROLES) {
      for (const entry of buildAddMenuEntries({ role, allowedRoutes: allowedFor(role) })) {
        expect(isPathAllowed(role, entry.href.split('?')[0])).toBe(true);
        expect(entry.href).toContain('new=1');
      }
    }
  });
});

describe('usersHrefForRole', () => {
  test('each admin role points at its own existing accounts page — no third users screen', () => {
    expect(usersHrefForRole('super_admin')).toBe('/admin/users');
    expect(usersHrefForRole('org_admin')).toBe('/org-admin/users');
  });

  test('the facility roles read the staff list on the org-scoped accounts page', () => {
    expect(usersHrefForRole('hospital_manager')).toBe('/org-admin/users');
    expect(usersHrefForRole('medical_superintendent')).toBe('/org-admin/users');
  });

  test('clinical roles get nothing', () => {
    for (const role of ['doctor', 'nurse', 'front_desk'] as UserRole[]) {
      expect(usersHrefForRole(role)).toBeNull();
    }
  });

  test('reading the staff list is not permission to create one — Add staff stays with the writers', () => {
    // /api/users' WRITE_ROLES is super_admin + org_admin only.
    for (const role of ['hospital_manager', 'medical_superintendent'] as UserRole[]) {
      expect(canCreateUsers(role)).toBe(false);
      const entries = buildAddMenuEntries({ role, allowedRoutes: allowedFor(role) });
      expect(entries.map(e => e.key)).not.toContain('staff');
    }
    for (const role of ['super_admin', 'org_admin'] as UserRole[]) {
      expect(canCreateUsers(role)).toBe(true);
    }
  });
});
