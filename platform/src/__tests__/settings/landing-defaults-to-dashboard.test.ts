/**
 * Sign-in lands on the dashboard first, for every role.
 *
 * The post-login route is the user's "Start-up screen" choice, falling back to
 * the spec default for their role. Three specs (pharmacist, lab, front desk)
 * used to default to a worklist — `/pharmacy`, `/lab`, `/rooming` — so those
 * roles never saw their dashboard, and the mission card on it, unless they
 * went looking. This pins the default for every role in the route table to the
 * role's own default dashboard; the worklists remain a choice, not the default.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { initRoleSettings, clearRoleSettings, setRoleSettings } from '@/lib/settings/role-settings-store';
import { resolveLandingPage } from '@/lib/user-prefs';
import { ROLE_ROUTE_TABLE, getDefaultDashboard } from '@/lib/role-routes';
import { specForRole } from '@/lib/role-settings';
import type { UserRole } from '@/lib/db-types';
import type { RoleSettingRow } from '@/lib/role-settings';

const ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];

beforeEach(() => {
  window.localStorage.clear();
  clearRoleSettings();
});

describe('start-up screen defaults', () => {
  it.each(ROLES)('%s lands on their dashboard when they have not chosen a start-up screen', role => {
    initRoleSettings(`user-${role}`, role);
    expect(resolveLandingPage(role)).toBe(getDefaultDashboard(role));
  });

  it.each(ROLES)('%s is offered the dashboard first in the start-up picker', role => {
    const landing = specForRole(role).sections
      .flatMap(s => s.rows as RoleSettingRow[])
      .find(r => 'key' in r && r.key === 'account.landing');
    if (!landing || landing.kind !== 'select') return;
    // The default is always a label with no route of its own, which resolves
    // to the role's default dashboard — never a worklist route.
    expect(landing.options[0]).toBe(landing.def);
    expect(['My dashboard', 'Facility dashboard']).toContain(landing.def);
  });

  it('a technician who prefers the worklist still gets it', () => {
    initRoleSettings('user-lab', 'lab_tech');
    setRoleSettings({ 'account.landing': 'Lab worklist' });
    expect(resolveLandingPage('lab_tech')).toBe('/lab');
  });

  it('a pharmacist who prefers the dispense queue still gets it', () => {
    initRoleSettings('user-pharma', 'pharmacist');
    setRoleSettings({ 'account.landing': 'Dispense queue' });
    expect(resolveLandingPage('pharmacist')).toBe('/pharmacy');
  });
});
