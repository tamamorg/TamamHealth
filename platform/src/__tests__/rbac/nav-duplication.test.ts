/**
 * @jest-environment node
 *
 * A sidebar row is a destination, not a bookmark.
 *
 * The government console carried 25 rows onto 19 pages. Four of them were
 * `/data-quality?view=…` — Reporting Completeness, Reporting Timeliness,
 * Outliers & Validation, Facility DQ Scores — which are the four VIEWS of one
 * screen, each given its own row under its own heading. Three more were
 * `/government/equity?view=…`, and one was `/epidemic-intelligence?tab=alerts`,
 * a single tab of a six-tab page promoted to the sidebar while the other five
 * stayed hidden.
 *
 * Nothing was broken by it, which is why it accumulated. It is just unreadable:
 * a minister scanning the sidebar cannot tell that four consecutive rows all
 * open the same page, and the fifth view of a page is invisible because nobody
 * added a row for it. Deep links belong to the page's own tab strip, which is
 * where every one of these pages already renders one.
 */

import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

const ALL_ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];

const basePath = (href: string) => href.split('?')[0].split('#')[0];

describe('nav rows are distinct destinations', () => {
  test.each(ALL_ROLES)('%s lists no page twice', role => {
    const seen = new Map<string, string[]>();
    for (const item of ROLE_PERMISSIONS[role].navItems) {
      const base = basePath(item.href);
      seen.set(base, [...(seen.get(base) ?? []), item.label]);
    }
    const duplicated = [...seen.entries()].filter(([, labels]) => labels.length > 1);
    // Reported as page → the labels competing for it, so a failure names the
    // rows to merge rather than just a count.
    expect(Object.fromEntries(duplicated)).toEqual({});
  });

  test('every nav row opens a route its role may reach', () => {
    // A query string never changes which page loads, so the gate is the base
    // path. Pinned here because collapsing a `?view=` row to its base is only
    // safe while the base itself is routable.
    for (const role of ALL_ROLES) {
      for (const item of ROLE_PERMISSIONS[role].navItems) {
        expect(isPathAllowed(role, basePath(item.href))).toBe(true);
      }
    }
  });
});

describe('sections group cleanly', () => {
  // `groupNavItemsBySection` groups by RUN, not by key: two items sharing a
  // section but separated by another render as two groups under the same
  // heading. medical_superintendent had ADMINISTRATION in three runs and
  // SERVICES in two — nine headings for six sections — and
  // records_hmis_officer had GOVERNANCE twice.
  test.each(ALL_ROLES)('%s renders each section heading once', role => {
    const sections = ROLE_PERMISSIONS[role].navItems.map(i => i.section ?? null);
    const runs: (string | null)[] = [];
    for (const section of sections) {
      if (runs.length && runs[runs.length - 1] === section) continue;
      runs.push(section);
    }
    const named = runs.filter((s): s is string => !!s);
    expect(named).toEqual([...new Set(named)]);
  });

  test.each(ALL_ROLES)('%s has no heading introducing a single row', role => {
    // A heading exists to group things. Sixteen roles had one called 'MORE'
    // over a lone Messages link — a heading, a rule and a gap to announce one
    // item whose own label already said what it was.
    const items = ROLE_PERMISSIONS[role].navItems;
    const runs: { section: string | null; count: number }[] = [];
    for (const item of items) {
      const section = item.section ?? null;
      if (runs.length && runs[runs.length - 1].section === section) runs[runs.length - 1].count += 1;
      else runs.push({ section, count: 1 });
    }
    const lonely = runs.filter(r => r.section !== null && r.count === 1).map(r => r.section);
    expect(lonely).toEqual([]);
  });
});

describe('the consoles stay trimmed', () => {
  // Upper bounds, not exact counts — adding a genuinely new destination should
  // not fail a test, but drifting back toward a sidebar nobody can scan should.
  const CEILINGS: Partial<Record<UserRole, number>> = {
    super_admin: 20,
    government: 21,
    medical_superintendent: 30,
    org_admin: 28,
    hospital_manager: 26,
  };

  test.each(Object.entries(CEILINGS))('%s keeps at most %i nav rows', (role, max) => {
    expect(ROLE_PERMISSIONS[role as UserRole].navItems.length).toBeLessThanOrEqual(max as number);
  });

  test('nothing Settings renders itself keeps a sidebar row', () => {
    // RoleSettingsView mounts these page components directly as panels —
    // <ItOperationsPanel />, <ServicePricingPage />. A sidebar row beside the
    // panel is a second door onto the same screen. /org-admin/users is the
    // deliberate exception: it is the staff roster, opened many times a day,
    // and burying it inside Settings to save a row is the wrong trade.
    const EMBEDDED_IN_SETTINGS = ['/it', '/org-admin/pricing', '/org-admin/branding',
                                  '/org-admin/hospitals', '/system-admin', '/settings/manage'];
    for (const role of ALL_ROLES) {
      const hrefs = ROLE_PERMISSIONS[role].navItems.map(i => basePath(i.href));
      for (const href of EMBEDDED_IN_SETTINGS) expect(hrefs).not.toContain(href);
    }
  });

  test('the platform operator does not carry facility workforce rows', () => {
    // It employs nobody at a facility. Duplicated from people-nav.test.ts's
    // angle deliberately: that file asserts the section's shape, this one
    // asserts the console's size, and the rows came back once already.
    const hrefs = ROLE_PERMISSIONS.super_admin.navItems.map(i => i.href);
    for (const href of ['/hr/leave', '/hr/schedule', '/hr/payroll', '/inquiries']) {
      expect(hrefs).not.toContain(href);
    }
  });
});
