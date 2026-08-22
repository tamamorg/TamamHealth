/**
 * @jest-environment node
 *
 * A station dashboard belongs to the station.
 *
 * `/dashboard` is the shared clinical workspace — doctors, clinicians, nurses,
 * midwives and the medical superintendent all hold it. Route access is
 * prefix-inherited, so that one entry also opened every OTHER role's station:
 * `/dashboard/state` (the county director's oversight console),
 * `/dashboard/hr`, `/dashboard/front-desk`, `/dashboard/lab`,
 * `/dashboard/pharmacy`, `/dashboard/radiology`, `/dashboard/nutrition` and
 * `/dashboard/data-entry`. No nav row ever offered them and no workflow needed
 * them; a URL was enough.
 *
 * The rule is structural (`stationDashboardGrant`), not a list, so a station
 * added later is closed by default instead of inheriting the workspace's grant
 * on the day it lands.
 */

import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

const ALL_ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];

const STATIONS = [
  '/dashboard/state', '/dashboard/hr', '/dashboard/lab', '/dashboard/pharmacy',
  '/dashboard/front-desk', '/dashboard/nutrition', '/dashboard/radiology',
  '/dashboard/data-entry',
] as const;

describe('station dashboards are explicit grants', () => {
  test.each(STATIONS)('%s opens only for roles that name it', station => {
    for (const role of ALL_ROLES) {
      if (role === 'super_admin') continue; // total page access by design
      const named = ROLE_ROUTE_TABLE[role].allowed.some(
        route => route === station || route.startsWith(station + '/'),
      );
      expect(isPathAllowed(role, station)).toBe(named);
    }
  });

  test('the shared clinical workspace grants no station', () => {
    // The regression in one line: every role holding /dashboard, and none of
    // them reaching a station they never listed.
    const workspaceRoles = ALL_ROLES.filter(
      role => role !== 'super_admin' && ROLE_ROUTE_TABLE[role].allowed.includes('/dashboard'),
    );
    expect(workspaceRoles.length).toBeGreaterThan(0);
    for (const role of workspaceRoles) {
      const leaked = STATIONS.filter(
        station => isPathAllowed(role, station) && !ROLE_ROUTE_TABLE[role].allowed.includes(station),
      );
      expect(leaked).toEqual([]);
    }
  });

  test('a station added later is closed by default', () => {
    // Nothing lists it, so nothing may open it — the point of the prefix rule.
    for (const role of ALL_ROLES) {
      if (role === 'super_admin') continue;
      expect(isPathAllowed(role, '/dashboard/some-future-station')).toBe(false);
    }
  });

  test('the retired nurse-station stubs stay reachable for the nurse family', () => {
    // They are redirects; gating them would strand an old bookmark on the
    // RoleGuard screen instead of forwarding it.
    for (const role of ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'] as UserRole[]) {
      expect(isPathAllowed(role, '/dashboard/nurse')).toBe(true);
      expect(isPathAllowed(role, '/dashboard/nurse/ward')).toBe(true);
    }
  });
});
