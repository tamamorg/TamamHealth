/**
 * @jest-environment node
 *
 * Tenant setup has an order — organization, then facility, then staff — and
 * until this change the middle step had no way in.
 *
 * `/org-admin/hospitals` owned the only create-a-facility form and had no nav
 * row anywhere; the "Facilities" row every admin does have pointed at
 * `/hospitals`, a read-only directory whose header offered a CSV export and
 * nothing else. A platform operator could not create one at ALL: the one form
 * that admitted them stamped `currentUser.orgId` onto the document, and a
 * super_admin carries none, so `createHospital` rejected every attempt.
 *
 * These tests pin the route out of that: who is offered the action, that the
 * destination is one their role can open, and that the org/facility
 * requirements the UI enforces are the SAME ones the server enforces.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  buildAddMenuEntries, canCreateFacilities, facilitiesHrefForRole, canCreateUsers,
} from '@/lib/people-nav';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import { isHrefAllowed } from '@/components/ehr/ehr-navigation';
import {
  roleNeedsFacility, roleNeedsOrganization, validateUserScope,
  ROLES_WITHOUT_FACILITY, ROLES_WITHOUT_ORGANIZATION,
  FACILITY_REQUIRED_MESSAGE, ORG_REQUIRED_MESSAGE,
} from '@/lib/user-scope-rules';
import { FACILITY_TYPES, DEFAULT_FACILITY_TYPE, isFacilityType } from '@/lib/facility-types';
import type { UserRole } from '@/lib/db-types';

const source = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');

const ALL_ROLES = Object.keys(ROLE_ROUTE_TABLE) as UserRole[];
const allowedFor = (role: UserRole) => ROLE_ROUTE_TABLE[role].allowed;
const ADMIN_ROLES: UserRole[] = ['super_admin', 'org_admin'];

describe('who may register a facility', () => {
  test('the two admin roles, and nobody else', () => {
    for (const role of ADMIN_ROLES) expect(canCreateFacilities(role)).toBe(true);
    for (const role of ALL_ROLES.filter(r => !ADMIN_ROLES.includes(r))) {
      expect(canCreateFacilities(role)).toBe(false);
    }
  });

  test('the UI never offers what /api/hospitals would refuse', () => {
    // The API is the enforcement point; the menu is allowed to be narrower
    // (it is — medical_superintendent may write but is not offered the
    // action), never wider.
    const route = source('app/api/hospitals/route.ts');
    const writeRoles = route
      .split('const WRITE_ROLES: UserRole[] = [')[1]
      .split(']')[0];
    for (const role of ALL_ROLES.filter(canCreateFacilities)) {
      expect(writeRoles).toContain(`'${role}'`);
    }
  });

  test('a role offered the action is sent somewhere it can open', () => {
    for (const role of ALL_ROLES) {
      const href = facilitiesHrefForRole(role);
      if (!href) continue;
      expect(isPathAllowed(role, href)).toBe(true);
      expect(isHrefAllowed(href, allowedFor(role))).toBe(true);
    }
  });

  test('the destination is a page with a nav row, not an orphan route', () => {
    // The whole defect: the form existed at a route nothing linked to. A
    // destination the module menu never shows is a destination nobody finds.
    for (const role of ADMIN_ROLES) {
      const href = facilitiesHrefForRole(role)!;
      const navHrefs = ROLE_PERMISSIONS[role].navItems.map(i => i.href);
      expect(navHrefs).toContain(href);
    }
  });

  test('the Add menu carries a facility entry that opens the dialog', () => {
    for (const role of ADMIN_ROLES) {
      const entry = buildAddMenuEntries({ role, allowedRoutes: allowedFor(role) })
        .find(e => e.key === 'facility');
      expect(entry).toBeDefined();
      expect(entry!.href).toBe('/hospitals?new=1');
    }
  });

  test('roles that cannot create one are offered nothing', () => {
    for (const role of ['doctor', 'nurse', 'hospital_manager', 'government'] as UserRole[]) {
      expect(facilitiesHrefForRole(role)).toBeNull();
      expect(buildAddMenuEntries({ role, allowedRoutes: allowedFor(role) }).map(e => e.key))
        .not.toContain('facility');
    }
  });
});

describe('the pages that host the create dialog', () => {
  test.each([
    'app/(dashboard)/hospitals/page.tsx',
    'app/(dashboard)/org-admin/hospitals/page.tsx',
    'app/(dashboard)/admin/users/page.tsx',
    'app/(dashboard)/org-admin/users/page.tsx',
  ])('%s opens the shared dialog rather than its own copy', file => {
    // `CreateFacilityModal` is the create-only wrapper around the same
    // component; either name means the caller is on the shared form.
    expect(source(file)).toMatch(/CreateFacilityModal|FacilityFormModal/);
  });

  test('Settings → Manage no longer administers facilities or accounts at all', () => {
    // Its two CRUD tabs were the platform's third user roster and second
    // facility form, and both had drifted: the user form could not set an
    // organization, and the facility form offered three of the five types.
    const manage = source('app/(dashboard)/settings/manage/page.tsx');
    expect(manage).not.toContain('createHospital');
    expect(manage).not.toContain('USER MANAGEMENT TAB');
    expect(manage).not.toContain('HOSPITAL MANAGEMENT TAB');
  });

  test.each([
    ['app/(dashboard)/hospitals/page.tsx', "searchParams.get('new')"],
    ['app/(dashboard)/org-admin/hospitals/page.tsx', "has('new')"],
  ])('%s honours the ?new=1 deep link the Add menu emits', (file, marker) => {
    expect(source(file)).toContain(marker);
  });

  test('the Add button on /hospitals paints its glyph white', () => {
    // globals.css repaints any lucide glyph with no INLINE colour to
    // --icon-color, the same brand blue as the primary button's fill — the
    // plus was a blank blue circle. A className cannot escape that rule; the
    // `color` prop writes a literal stroke attribute, which beats it. Every
    // other `EhrListHeaderButton primary` in the app already does this.
    const header = source('app/(dashboard)/hospitals/page.tsx')
      .split('EhrListHeaderButton primary')[1]
      .split('</EhrListHeaderButton>')[0];
    expect(header).toContain('color="#fff"');
  });

  test('the dialog asks a platform operator which organization owns the facility', () => {
    // `createHospital` refuses a facility with no orgId, and a super_admin has
    // none of their own — without this picker the operator's every attempt
    // threw, which is why the platform-level path was dead.
    const modal = source('components/admin/FacilityFormModal.tsx');
    expect(modal).toContain('needsOrgChoice');
    expect(modal).toContain('effectiveOrgId');
    expect(modal).toContain('orgId: effectiveOrgId');
  });

  test('editing never re-asks for the organization', () => {
    // Moving a facility between tenants would strand every admission, bill and
    // staff record already stamped with its id, so `orgId` is immutable and the
    // picker is create-only.
    const modal = source('components/admin/FacilityFormModal.tsx');
    expect(modal).toContain('!isEdit && !orgId');
    expect(source('lib/services/hospital-service.ts'))
      .toContain("Omit<HospitalDoc, '_id' | '_rev' | 'type' | 'orgId' | 'createdAt'>");
  });

  test('a facility can be corrected and retired, not just created', () => {
    const service = source('lib/services/hospital-service.ts');
    expect(service).toContain('export async function updateFacility');
    expect(service).toContain('export async function setFacilityActive');
    // Retiring is a soft flag — the records that reference the facility must
    // survive it.
    expect(service).not.toMatch(/db\.remove\(/);
  });

  test('retired facilities drop out of the assignment pickers', () => {
    for (const file of [
      'app/(dashboard)/admin/users/page.tsx',
      'app/(dashboard)/org-admin/users/page.tsx',
    ]) {
      expect(source(file)).toContain('activeFacilities');
    }
  });
});

describe('facility types are one vocabulary', () => {
  test('all five types the document model accepts are offered', () => {
    expect(FACILITY_TYPES.map(f => f.value)).toEqual([
      'national_referral', 'state_hospital', 'county_hospital', 'phcc', 'phcu',
    ]);
    expect(isFacilityType(DEFAULT_FACILITY_TYPE)).toBe(true);
  });

  test('no page keeps a private list — Settings once offered only three', () => {
    // A three-entry list meant a PHCC or PHCU, the commonest facilities in
    // South Sudan, could not be created from Settings at all.
    for (const file of [
      'app/(dashboard)/org-admin/hospitals/page.tsx',
      'components/admin/FacilityFormModal.tsx',
    ]) {
      const text = source(file);
      expect(text).not.toMatch(/const FACILITY_TYPES\s*=/);
      expect(text).toContain("from '@/lib/facility-types'");
    }
  });

  test('every type has a locale key that exists in both locales', () => {
    const en = source('lib/i18n/locales/en.ts');
    const apd = source('lib/i18n/locales/apd.ts');
    for (const option of FACILITY_TYPES) {
      expect(en).toContain(`'${option.labelKey}':`);
      expect(apd).toContain(`'${option.labelKey}':`);
    }
  });
});

describe('the scope a staff account must carry', () => {
  test('organisation-wide and national roles are not bound to a facility', () => {
    for (const role of ROLES_WITHOUT_FACILITY) expect(roleNeedsFacility(role)).toBe(false);
    for (const role of ALL_ROLES.filter(r => !ROLES_WITHOUT_FACILITY.includes(r))) {
      expect(roleNeedsFacility(role)).toBe(true);
    }
  });

  test('only the platform operator and the national roles carry no organization', () => {
    for (const role of ROLES_WITHOUT_ORGANIZATION) expect(roleNeedsOrganization(role)).toBe(false);
    for (const role of ALL_ROLES.filter(r => !ROLES_WITHOUT_ORGANIZATION.includes(r))) {
      expect(roleNeedsOrganization(role)).toBe(true);
    }
  });

  test('an org_admin needs an org but never a facility', () => {
    expect(roleNeedsOrganization('org_admin')).toBe(true);
    expect(roleNeedsFacility('org_admin')).toBe(false);
    expect(validateUserScope({ role: 'org_admin', orgId: '' })).toBe(ORG_REQUIRED_MESSAGE);
    expect(validateUserScope({ role: 'org_admin', orgId: 'org-1' })).toBeNull();
  });

  test('the Add-user dialog can no longer save "Facility — None —"', () => {
    // The exact shape the screenshot showed: a facility-bound role, an
    // organization chosen, and no facility. The server answered 400; the
    // dialog now says so before the operator loses the generated password.
    expect(validateUserScope({ role: 'front_desk', orgId: 'org-1', hospitalId: '' }))
      .toBe(FACILITY_REQUIRED_MESSAGE);
    expect(validateUserScope({ role: 'front_desk', orgId: 'org-1', hospitalId: 'hosp-1' }))
      .toBeNull();
  });

  test('a missing organization is reported before a missing facility', () => {
    // Same order the server checks in, so the first client-side error is the
    // first server-side one and the two never contradict each other.
    expect(validateUserScope({ role: 'nurse' })).toMatch(/organization/i);
  });

  test('the rules are stated once — no page or route keeps a private copy', () => {
    for (const file of [
      'app/api/users/route.ts',
      'lib/services/user-service.ts',
      'app/(dashboard)/org-admin/users/page.tsx',
      'app/(dashboard)/admin/users/page.tsx',
    ]) {
      const text = source(file);
      expect(text).not.toMatch(/ROLES_WITHOUT_HOSPITAL\s*:\s*UserRole\[\]\s*=/);
      expect(text).not.toMatch(/rolesWithoutHospital\s*:\s*UserRole\[\]\s*=/);
      expect(text).toContain('user-scope-rules');
    }
  });

  test('creating a user is still narrower than reading the roster', () => {
    // Unchanged by this work, and cheap to keep pinned: facility managers read
    // the staff list but may not write to it.
    for (const role of ['hospital_manager', 'medical_superintendent'] as UserRole[]) {
      expect(canCreateUsers(role)).toBe(false);
    }
  });
});
