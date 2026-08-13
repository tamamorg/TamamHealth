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

import { buildAddMenuEntries, usersHrefForRole } from '@/lib/people-nav';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import { isHrefAllowed, uniqueAllowedNavItems, groupNavItemsBySection } from '@/components/ehr/ehr-navigation';
import type { UserRole } from '@/lib/db-types';

const ALL_ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];
const allowedFor = (role: UserRole) => ROLE_ROUTE_TABLE[role].allowed;
const peopleItems = (role: UserRole) =>
  ROLE_PERMISSIONS[role].navItems.filter(item => item.section === 'PEOPLE & HR');

/** Roles that own the workforce area. */
const HR_ROLES: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager'];

describe('PEOPLE & HR nav section', () => {
  test.each(HR_ROLES)('%s gets the workforce destinations', role => {
    const hrefs = peopleItems(role).map(i => i.href);
    expect(hrefs).toEqual(expect.arrayContaining([
      '/dashboard/hr', '/hr?tab=roster', '/hr?tab=leave',
      '/hr?tab=schedule', '/hr?tab=payroll', '/inquiries',
    ]));
  });

  test('only the two account-administering roles get an accounts row, pointing at their own page', () => {
    const accountsHref = (role: UserRole) =>
      peopleItems(role).map(i => i.href).find(h => h.endsWith('/users')) ?? null;
    expect(accountsHref('super_admin')).toBe('/admin/users');
    expect(accountsHref('org_admin')).toBe('/org-admin/users');
    expect(accountsHref('hospital_manager')).toBeNull();
    expect(accountsHref('medical_superintendent')).toBeNull();
    // The nav row and the Add-menu target must not drift apart.
    expect(accountsHref('super_admin')).toBe(usersHrefForRole('super_admin'));
    expect(accountsHref('org_admin')).toBe(usersHrefForRole('org_admin'));
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
      expect(groups[0].items.length).toBeGreaterThanOrEqual(6);
    }
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
  test('org_admin can add staff, inquiries, shifts and leave', () => {
    const entries = buildAddMenuEntries({ role: 'org_admin', allowedRoutes: allowedFor('org_admin') });
    expect(entries.map(e => e.key)).toEqual(['staff', 'inquiry', 'shift', 'leave']);
    expect(entries.find(e => e.key === 'staff')!.href).toBe('/org-admin/users?new=1');
  });

  test('super_admin adds staff through the platform accounts page', () => {
    const entries = buildAddMenuEntries({ role: 'super_admin', allowedRoutes: allowedFor('super_admin') });
    expect(entries.find(e => e.key === 'staff')!.href).toBe('/admin/users?new=1');
  });

  test('there is no separate "create user account" action — staff and login are one record', () => {
    const entries = buildAddMenuEntries({ role: 'super_admin', allowedRoutes: allowedFor('super_admin') });
    expect(entries.map(e => e.label.toLowerCase()).filter(l => l.includes('user account'))).toHaveLength(0);
    expect(entries.find(e => e.key === 'staff')!.description).toMatch(/login/i);
  });

  test('a role that cannot administer accounts keeps the entries it can use', () => {
    const entries = buildAddMenuEntries({ role: 'hospital_manager', allowedRoutes: allowedFor('hospital_manager') });
    expect(entries.map(e => e.key)).not.toContain('staff');
    expect(entries.map(e => e.key)).toEqual(expect.arrayContaining(['shift', 'leave', 'inquiry']));
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

  test('roles that may not administer accounts get nothing', () => {
    for (const role of ['doctor', 'nurse', 'front_desk', 'hospital_manager'] as UserRole[]) {
      expect(usersHrefForRole(role)).toBeNull();
    }
  });
});
