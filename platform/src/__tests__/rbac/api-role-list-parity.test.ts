/**
 * API role-list drift (2026-08 audit): `role-routes.ts` is the documented
 * source of truth for which roles a page route is granted, but the API
 * routes backing those pages keep their own hand-typed `READ_ROLES` /
 * `WRITE_ROLES` / `CREATE_ROLES` arrays (see the header comment on
 * `DOC_WRITE_ROLES` in `write-permissions.ts` for why: 51 routes once
 * declared their own copies rather than importing a shared one). Those
 * hand-typed lists can fall behind a route-routes.ts grant with nothing to
 * fail — the page renders, the role sees the module in nav, and the API
 * call 403s. This pins the six drifts found in that audit, each already
 * confirmed against the role's `allowed` list in `role-routes.ts`:
 *
 *   - /api/patients READ:  += lab_tech, pharmacist, hospital_manager, medical_biller
 *   - /api/messages READ+WRITE: += hospital_manager, medical_biller
 *   - /api/reports:        += hospital_manager
 *   - /api/appointments READ: += medical_biller
 *   - /api/blood-bank WRITE: += clinical_officer
 *
 * A source-text check, not an import: these routes deliberately keep their
 * role lists as module-private `const`s (not part of the file's public
 * surface), matching the style `api-route-auth-contract.test.ts` already
 * uses for this codebase's route files.
 */
import fs from 'node:fs';
import path from 'node:path';

const API_ROOT = path.join(process.cwd(), 'src/app/api');

function readRoute(relPath: string): string {
  return fs.readFileSync(path.join(API_ROOT, relPath), 'utf8');
}

/** Pull the array literal assigned to `const <name>: UserRole[] = [...]`. */
function roleListSource(source: string, constName: string): string {
  const re = new RegExp(`const ${constName}\\s*:\\s*UserRole\\[\\]\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = source.match(re);
  if (!match) throw new Error(`could not find ${constName} in source`);
  return match[1];
}

function containsRole(listSource: string, role: string): boolean {
  return new RegExp(`'${role}'`).test(listSource);
}

describe('API role lists match role-routes.ts grants (2026-08 audit)', () => {
  test('/api/patients READ_ROLES includes every role role-routes.ts grants /patients', () => {
    const list = roleListSource(readRoute('patients/route.ts'), 'READ_ROLES');
    for (const role of ['lab_tech', 'pharmacist', 'hospital_manager', 'medical_biller']) {
      expect(containsRole(list, role)).toBe(true);
    }
  });

  test('/api/messages READ_ROLES and WRITE_ROLES include hospital_manager and medical_biller', () => {
    const source = readRoute('messages/route.ts');
    for (const constName of ['READ_ROLES', 'WRITE_ROLES']) {
      const list = roleListSource(source, constName);
      for (const role of ['hospital_manager', 'medical_biller']) {
        expect(containsRole(list, role)).toBe(true);
      }
    }
  });

  test('/api/reports REPORT_ROLES includes hospital_manager', () => {
    const list = roleListSource(readRoute('reports/route.ts'), 'REPORT_ROLES');
    expect(containsRole(list, 'hospital_manager')).toBe(true);
  });

  test('/api/appointments READ_ROLES includes medical_biller', () => {
    const list = roleListSource(readRoute('appointments/route.ts'), 'READ_ROLES');
    expect(containsRole(list, 'medical_biller')).toBe(true);
  });

  test('/api/appointments CREATE_ROLES does NOT include medical_biller (billing does not schedule visits)', () => {
    const list = roleListSource(readRoute('appointments/route.ts'), 'CREATE_ROLES');
    expect(containsRole(list, 'medical_biller')).toBe(false);
  });

  test('/api/blood-bank WRITE_ROLES includes clinical_officer', () => {
    const list = roleListSource(readRoute('blood-bank/route.ts'), 'WRITE_ROLES');
    expect(containsRole(list, 'clinical_officer')).toBe(true);
  });

  // Least-privilege (2026-08-30 audit): referral CREATE must not include a
  // role that has no create surface. nutritionist and hospital_manager hold
  // the /referrals route but the create action is gated on canManageReferrals,
  // which excludes them — so an authorship grant here would be a dead grant
  // and, for the administrative hospital_manager, a clinician-less clinical
  // referral. Removing them is safe precisely because the UI never let them
  // create. This pins the removal so it can't silently drift back.
  test('/api/referrals CREATE_ROLES does NOT include nutritionist or hospital_manager (no create surface)', () => {
    const list = roleListSource(readRoute('referrals/route.ts'), 'CREATE_ROLES');
    expect(containsRole(list, 'nutritionist')).toBe(false);
    expect(containsRole(list, 'hospital_manager')).toBe(false);
  });
});
