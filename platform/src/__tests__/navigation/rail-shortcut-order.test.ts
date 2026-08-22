/**
 * The rail leads with the role's work, not its inbox.
 *
 * `getPrimaryShortcutItems` fills four always-visible slots. Messages used to
 * outrank the "your dashboard already shows this" fallbacks, which put the
 * inbox first for eight roles — Messages ahead of Pharmacy for a pharmacist,
 * ahead of Patients for the front desk, ahead of Lab for the laboratory. That
 * duplicate argument only holds while the user is standing on their dashboard;
 * everywhere else the rail is the only navigation there is.
 */
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { ROLE_ROUTE_TABLE, getDefaultDashboard } from '@/lib/role-routes';
import { uniqueAllowedNavItems, getPrimaryShortcutItems, RAIL_SHORTCUT_COUNT } from '@/components/ehr/ehr-navigation';
import type { UserRole } from '@/lib/db-types';

const railFor = (role: UserRole) => {
  const cfg = ROLE_PERMISSIONS[role];
  const home = getDefaultDashboard(role);
  const items = uniqueAllowedNavItems(cfg.navItems, [...ROLE_ROUTE_TABLE[role].allowed]);
  return getPrimaryShortcutItems(items, role, RAIL_SHORTCUT_COUNT, home).map(i => i.href);
};

describe('top-rail shortcut order', () => {
  it('never opens a role\'s rail with Messages', () => {
    const offenders = (Object.keys(ROLE_ROUTE_TABLE) as UserRole[])
      .filter(role => railFor(role)[0] === '/messages');
    expect(offenders).toEqual([]);
  });

  it('puts each station role\'s own workspace ahead of the inbox', () => {
    const expectations: [UserRole, string][] = [
      ['pharmacist', '/pharmacy'],
      ['front_desk', '/patients'],
      ['radiologist', '/patients'],
      ['clinic_clerk', '/patients'],
      ['lab_tech', '/lab'],
    ];
    for (const [role, href] of expectations) {
      const rail = railFor(role);
      expect(rail).toContain(href);
      expect(rail.indexOf(href)).toBeLessThan(
        rail.indexOf('/messages') === -1 ? Number.MAX_SAFE_INTEGER : rail.indexOf('/messages'),
      );
    }
  });

  it('still keeps Messages on the rail where the role has room for it', () => {
    expect(railFor('front_desk')).toContain('/messages');
    expect(railFor('pharmacist')).toContain('/messages');
  });

  it('never spends a slot on the dashboard the user is already on', () => {
    for (const role of Object.keys(ROLE_ROUTE_TABLE) as UserRole[]) {
      const home = getDefaultDashboard(role);
      expect(railFor(role)).not.toContain(home);
    }
  });
});
