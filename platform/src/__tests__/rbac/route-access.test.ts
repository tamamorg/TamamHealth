/**
 * RBAC — page-route access control (src/lib/role-routes.ts).
 *
 * These tests pin the route allow-list behaviour the Edge proxy and the
 * client RoleGuard both rely on, including the three prefix-inheritance
 * regressions found in the 2026-08 QA pass:
 *   - /payments/claims must not be inherited from /payments (cashier).
 *   - /settings/manage must not be inherited from the universal /settings.
 *   - explicit-grant routes are reachable only when a role names them.
 */
import { isPathAllowed, getDefaultDashboard, hasRoleRouteConfig, ROLE_ROUTE_TABLE } from '@/lib/role-routes';
import type { UserRole } from '@/lib/db-types';

const ALL_ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];

describe('RBAC: landing pages', () => {
  test('every role resolves to a concrete default dashboard', () => {
    for (const role of ALL_ROLES) {
      const dash = getDefaultDashboard(role);
      expect(dash).toMatch(/^\//);
      expect(isPathAllowed(role, dash)).toBe(true);
    }
  });

  test('unknown role has no config and no allowed routes', () => {
    expect(hasRoleRouteConfig('not_a_role')).toBe(false);
    expect(isPathAllowed('not_a_role', '/patients')).toBe(false);
    // Falls back to a safe default rather than throwing.
    expect(getDefaultDashboard('not_a_role')).toBe('/dashboard');
  });
});

describe('RBAC: nurse-family roles share the merged clinical workspace', () => {
  const nurseFamily: UserRole[] = ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'];

  test('all land on /dashboard, not a standalone nurse station', () => {
    for (const role of nurseFamily) expect(getDefaultDashboard(role)).toBe('/dashboard');
  });

  test('all reach /dashboard and the legacy /dashboard/nurse bookmarks (redirect stubs)', () => {
    for (const role of nurseFamily) {
      expect(isPathAllowed(role, '/dashboard')).toBe(true);
      // /dashboard/nurse/* now redirects, but stays reachable so the
      // redirect stub itself can run rather than getting RoleGuard-blocked.
      expect(isPathAllowed(role, '/dashboard/nurse')).toBe(true);
      expect(isPathAllowed(role, '/dashboard/nurse/ward')).toBe(true);
    }
  });

  test('nurse/triage_nurse/rooming_nurse reach the new shift-handoff page via the /wards prefix', () => {
    for (const role of ['nurse', 'triage_nurse', 'rooming_nurse'] as UserRole[]) {
      expect(isPathAllowed(role, '/wards/handoff')).toBe(true);
    }
  });
});

describe('RBAC: super_admin has total page access', () => {
  test('reaches every station dashboard and clinical module, listed or not', () => {
    const previouslyExcluded = [
      // The nurse station used to be a distinct dashboard listed here
      // ('/dashboard/nurse'); it was merged into the shared clinical
      // workspace, so there's no separate nurse station route left to test.
      '/triage', '/rooming', '/patient-intake', '/wards/handoff',
      '/dashboard/front-desk', '/dashboard/lab', '/dashboard/pharmacy',
      '/consultation', '/payments/claims', '/settings/manage',
    ];
    for (const path of previouslyExcluded) {
      expect(isPathAllowed('super_admin', path)).toBe(true);
    }
  });

  test('still lands on the admin console by default', () => {
    expect(getDefaultDashboard('super_admin')).toBe('/admin');
  });

  test('total access is super_admin-only — org_admin gains nothing', () => {
    expect(isPathAllowed('org_admin', '/consultation')).toBe(false);
    expect(isPathAllowed('org_admin', '/triage')).toBe(false);
  });
});

describe('RBAC: /payments/claims is biller-only (BUG-006 regression)', () => {
  test('cashier reaches /payments but NOT /payments/claims', () => {
    expect(isPathAllowed('cashier', '/payments')).toBe(true);
    expect(isPathAllowed('cashier', '/payments/claims')).toBe(false);
  });

  test('medical_biller reaches both /payments and /payments/claims', () => {
    expect(isPathAllowed('medical_biller', '/payments')).toBe(true);
    expect(isPathAllowed('medical_biller', '/payments/claims')).toBe(true);
  });
});

describe('RBAC: /settings/manage is admin-only (BUG-007 regression)', () => {
  const admins: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent', 'hospital_manager'];
  const nonAdmins: UserRole[] = ['nurse', 'cashier', 'front_desk', 'doctor', 'lab_tech', 'pharmacist'];

  test('every role can reach the universal /settings', () => {
    for (const role of ALL_ROLES) expect(isPathAllowed(role, '/settings')).toBe(true);
  });

  test('only the admin/manager roles reach /settings/manage', () => {
    for (const role of admins) expect(isPathAllowed(role, '/settings/manage')).toBe(true);
    for (const role of nonAdmins) expect(isPathAllowed(role, '/settings/manage')).toBe(false);
  });
});

describe('RBAC: prefix inheritance still works for ordinary nested routes', () => {
  test('a role with a module root reaches its own sub-routes', () => {
    // doctor has /patients → /patients/pat-123 and query strings resolve.
    expect(isPathAllowed('doctor', '/patients/pat-123')).toBe(true);
    expect(isPathAllowed('doctor', '/patients?q=abc')).toBe(true);
  });

  test('query strings and hashes are ignored when matching', () => {
    expect(isPathAllowed('government', '/data-quality?view=completeness')).toBe(true);
  });
});

describe('RBAC: hard denials', () => {
  test('clinical roles cannot reach the platform admin console', () => {
    for (const role of ['doctor', 'nurse', 'front_desk', 'lab_tech', 'pharmacist'] as UserRole[]) {
      expect(isPathAllowed(role, '/admin')).toBe(false);
      expect(isPathAllowed(role, '/admin/users')).toBe(false);
    }
  });

  test('front_desk cannot reach billing or the lab bench', () => {
    expect(isPathAllowed('front_desk', '/billing')).toBe(false);
    expect(isPathAllowed('front_desk', '/lab')).toBe(false);
  });

  test('cashier cannot reach clinical modules', () => {
    expect(isPathAllowed('cashier', '/consultation')).toBe(false);
    expect(isPathAllowed('cashier', '/lab')).toBe(false);
    expect(isPathAllowed('cashier', '/dashboard')).toBe(false);
  });

  test('government sees aggregate modules, not individual patient charts', () => {
    expect(isPathAllowed('government', '/patients')).toBe(false);
    expect(isPathAllowed('government', '/surveillance')).toBe(true);
    expect(isPathAllowed('government', '/reports')).toBe(true);
  });
});
