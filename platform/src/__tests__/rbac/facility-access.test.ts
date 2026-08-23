/**
 * The facility console, and the two lists that have to agree about it.
 *
 * `/hospitals` was deleted on 2026-08-23 and its network view moved onto
 * `/admin/organizations`, with each facility opening its own page at
 * `/admin/facilities/[id]`. That page shipped without an entry in
 * `ROLE_ROUTE_TABLE`, so the Edge proxy redirected every role except the
 * platform operator away from it — the seven roles the list exists for, six of
 * whom have no other facility list anywhere in the product. Nothing failed:
 * the suite was green, because the page is reached by a row click rather than
 * by a nav item, and the existing nav-href checks only walk `navItems`.
 *
 * These tests walk the route instead of the nav, so a page that is offered and
 * not routable (or routable and not offered) fails here rather than in a
 * clinic.
 */

import { isPathAllowed, ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import {
  FACILITY_CONSOLE_ROLES, FACILITY_MANAGE_ROLES,
  canOpenFacilityConsole, canManageFacility,
} from '@/lib/facility-access';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import type { UserRole } from '@/lib/db-types';

const ALL_ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];
/** Both surfaces of the console: the list, and one facility opened from it. */
const CONSOLE_ROUTES = ['/admin/organizations', '/admin/facilities/hosp-001'];

describe('every console role can actually reach the console', () => {
  it.each(FACILITY_CONSOLE_ROLES.map(role => [role]))(
    '%s is routed to both the list and a facility page',
    (role) => {
      for (const route of CONSOLE_ROUTES) {
        expect({ role, route, allowed: isPathAllowed(role, route) })
          .toEqual({ role, route, allowed: true });
      }
    },
  );

  it('grants the facility page to exactly the roles that get the list', () => {
    // Not "some overlap": a role that can open the list can click a row, and
    // a row that leads somewhere it cannot go is a dead end by construction.
    const list = ALL_ROLES.filter(r => isPathAllowed(r, '/admin/organizations'));
    const detail = ALL_ROLES.filter(r => isPathAllowed(r, '/admin/facilities/hosp-001'));
    expect(detail.sort()).toEqual(list.sort());
  });
});

describe('roles outside the console stay outside it', () => {
  const outsiders = ALL_ROLES.filter(r => !FACILITY_CONSOLE_ROLES.includes(r));

  it('has outsiders to test', () => expect(outsiders.length).toBeGreaterThan(0));

  it.each(outsiders.map(role => [role]))('%s reaches neither surface', (role) => {
    for (const route of CONSOLE_ROUTES) {
      expect({ role, route, allowed: isPathAllowed(role, route) })
        .toEqual({ role, route, allowed: false });
    }
  });
});

describe('what the nav offers is what the routes permit', () => {
  it('every role whose nav links the console is routed to it', () => {
    for (const role of ALL_ROLES) {
      const offered = ROLE_PERMISSIONS[role]?.navItems
        ?.some(item => item.href === '/admin/organizations');
      if (!offered) continue;
      expect({ role, allowed: canOpenFacilityConsole(role) })
        .toEqual({ role, allowed: true });
    }
  });
});

describe('managing a facility is narrower than reading the network', () => {
  it('every manager is also a console role', () => {
    for (const role of FACILITY_MANAGE_ROLES) {
      expect({ role, console: FACILITY_CONSOLE_ROLES.includes(role) })
        .toEqual({ role, console: true });
    }
  });

  it('leaves the oversight roles reading only', () => {
    // They read the network for planning; they do not staff a ward in it.
    for (const role of ['government', 'county_health_director', 'records_hmis_officer'] as UserRole[]) {
      expect({ role, manage: canManageFacility(role) }).toEqual({ role, manage: false });
    }
  });
});
