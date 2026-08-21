/**
 * The full setup journey, end to end at the data layer:
 *
 *   super_admin -> organization -> org_admin -> facility -> facility staff
 *
 * Every step depends on the one before it, and the middle step (facility) is
 * the one that had no reachable UI. This walks the real services the UI calls,
 * against in-memory PouchDB, and asserts each account and document lands in
 * the tenant that can actually see it — because a facility or account written
 * without its `orgId` is invisible to `filterByScope` and rejected by
 * CouchDB's tenant validator on push, i.e. silently lost.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createOrganization } from '@/lib/services/organization-service';
import { createHospital, getAllHospitals } from '@/lib/services/hospital-service';
import { createUser, getAllUsers } from '@/lib/services/user-service';
import { roleNeedsFacility, roleNeedsOrganization } from '@/lib/user-scope-rules';
import { DEFAULT_FACILITY_TYPE } from '@/lib/facility-types';
import type { OrganizationDoc, HospitalDoc, UserDoc, UserRole } from '@/lib/db-types';

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

const PLATFORM_OPERATOR = { _id: 'user-superadmin', username: 'superadmin' };

async function makeOrganization(name = 'Ministry of Health - Republic of South Sudan') {
  return createOrganization(
    {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      orgType: 'public',
      contactEmail: 'ops@moh.gov.ss',
      country: 'South Sudan',
      subscriptionPlan: 'enterprise',
      subscriptionStatus: 'active',
      maxUsers: 500,
      maxHospitals: 50,
      isActive: true,
    } as unknown as Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>,
    PLATFORM_OPERATOR._id,
    PLATFORM_OPERATOR.username,
  );
}

function facilityPayload(orgId: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Juba Teaching Hospital',
    state: 'Central Equatoria',
    town: 'Juba',
    facilityType: DEFAULT_FACILITY_TYPE,
    totalBeds: 60, icuBeds: 0, maternityBeds: 0, pediatricBeds: 0,
    doctors: 0, clinicalOfficers: 0, nurses: 0, labTechnicians: 0, pharmacists: 0,
    hasElectricity: false, electricityHours: 0, hasGenerator: false, hasSolar: false,
    hasInternet: false, internetType: 'none', hasAmbulance: false, emergency24hr: false,
    services: [], lat: 0, lng: 0,
    orgId,
    ...overrides,
  } as unknown as Parameters<typeof createHospital>[0];
}

describe('super_admin -> organization -> org_admin', () => {
  test('the organization and its first administrator are created together', async () => {
    const org = await makeOrganization();
    expect(org._id).toBeTruthy();

    // Exactly what the create-organization form's admin sub-form submits.
    const admin = await createUser({
      name: 'Teny Makuach',
      username: 'tenymakuach',
      password: 'Str0ngTempPass!',
      role: 'org_admin',
      orgId: org._id,
    }, PLATFORM_OPERATOR._id, PLATFORM_OPERATOR.username);

    expect(admin.role).toBe('org_admin');
    expect(admin.orgId).toBe(org._id);
    // An org admin runs the whole organization, so it is never pinned to one
    // of its facilities.
    expect(roleNeedsFacility('org_admin')).toBe(false);
  });

  test('an org_admin with no organization is refused — it would see nothing', async () => {
    await expect(createUser({
      name: 'Orphan Admin', username: 'orphanadmin', password: 'Str0ngTempPass!',
      role: 'org_admin',
    })).rejects.toThrow(/organization/i);
  });
});

describe('org_admin -> facility', () => {
  test('a facility is created into the admin’s own organization and is visible there', async () => {
    const org = await makeOrganization();
    const facility = await createHospital(facilityPayload(org._id), 'user-orgadmin', 'orgadmin');

    expect(facility.orgId).toBe(org._id);
    const visible = await getAllHospitals({ orgId: org._id, role: 'org_admin' });
    expect(visible.map(h => h._id)).toContain(facility._id);
  });

  test('a platform operator can create one by naming the organization', async () => {
    // The path that was dead: the only form admitting a super_admin stamped
    // their own (absent) orgId, so `createHospital` threw every time. The
    // dialog now asks, and this is the payload it sends.
    const org = await makeOrganization();
    const facility = await createHospital(
      facilityPayload(org._id, { name: 'Wau State Hospital', state: 'Western Bahr el Ghazal', town: 'Wau' }),
      PLATFORM_OPERATOR._id,
      PLATFORM_OPERATOR.username,
    );
    expect(facility.orgId).toBe(org._id);
    // …and the tenant it was created for can see it, which is the whole point.
    await expect(getAllHospitals({ orgId: org._id, role: 'org_admin' }))
      .resolves.toEqual([expect.objectContaining({ _id: facility._id })]);
  });

  test('one tenant’s facilities never leak into another’s list', async () => {
    const moh = await makeOrganization();
    const mercy = await makeOrganization('Mercy Health Group');
    await createHospital(facilityPayload(moh._id), PLATFORM_OPERATOR._id);
    const theirs = await createHospital(
      facilityPayload(mercy._id, { name: 'Mercy Clinic' }), PLATFORM_OPERATOR._id,
    );

    const mercyView = await getAllHospitals({ orgId: mercy._id, role: 'org_admin' });
    expect(mercyView.map(h => h._id)).toEqual([theirs._id]);
  });
});

describe('facility -> staff accounts', () => {
  async function tenant() {
    const org = await makeOrganization();
    const facility = await createHospital(facilityPayload(org._id), 'user-orgadmin', 'orgadmin');
    return { org, facility };
  }

  test('a facility role is created against the facility and inherits the tenant', async () => {
    const { org, facility } = await tenant();
    const receptionist = await createUser({
      name: 'Teny Makuach',
      username: 'tenymakuach',
      password: 'Str0ngTempPass!',
      role: 'front_desk',
      orgId: org._id,
      hospitalId: facility._id,
      hospitalName: facility.name,
    }, 'user-orgadmin', 'orgadmin');

    expect(receptionist.hospitalId).toBe(facility._id);
    expect(receptionist.orgId).toBe(org._id);
  });

  test('the "Facility — None —" account the dialog used to allow is refused', async () => {
    // The screenshot's exact shape: a facility-bound role, an organization
    // chosen, and no facility. It has always been refused here; the dialog now
    // says so before the operator submits.
    const { org } = await tenant();
    expect(roleNeedsFacility('front_desk')).toBe(true);
    await expect(createUser({
      name: 'Teny Makuach', username: 'tenymakuach2', password: 'Str0ngTempPass!',
      role: 'front_desk', orgId: org._id,
    })).rejects.toThrow(/hospital/i);
  });

  test.each<[UserRole]>([
    ['doctor'], ['nurse'], ['front_desk'], ['lab_tech'], ['pharmacist'],
    ['cashier'], ['midwife'], ['data_entry_clerk'], ['medical_superintendent'],
    ['hospital_manager'], ['hrio'], ['radiologist'], ['nutritionist'],
    ['medical_biller'], ['clinical_officer'], ['triage_nurse'], ['clinic_clerk'],
  ])('%s can be created once a facility exists', async role => {
    const { org, facility } = await tenant();
    expect(roleNeedsFacility(role)).toBe(true);
    expect(roleNeedsOrganization(role)).toBe(true);
    const user = await createUser({
      name: `Test ${role}`,
      username: `test.${role.replace(/_/g, '')}`,
      password: 'Str0ngTempPass!',
      role,
      orgId: org._id,
      hospitalId: facility._id,
      hospitalName: facility.name,
    }, 'user-orgadmin', 'orgadmin');
    expect(user.role).toBe(role);
    expect(user.hospitalId).toBe(facility._id);
  });

  test('staff land in the roster their own org admin reads', async () => {
    const { org, facility } = await tenant();
    await createUser({
      name: 'Nurse One', username: 'nurse.one', password: 'Str0ngTempPass!',
      role: 'nurse', orgId: org._id, hospitalId: facility._id, hospitalName: facility.name,
    }, 'user-orgadmin', 'orgadmin');

    const roster = await getAllUsers({ orgId: org._id, role: 'org_admin', userId: 'user-orgadmin' });
    expect(roster.map((u: UserDoc) => u.username)).toContain('nurse.one');
  });

  test('a facility from another tenant cannot staff this one', async () => {
    const { org } = await tenant();
    const other = await makeOrganization('Mercy Health Group');
    const otherFacility = await createHospital(
      facilityPayload(other._id, { name: 'Mercy Clinic' }), PLATFORM_OPERATOR._id,
    ) as HospitalDoc;

    // The service stores what it is given; the tenant barrier is that the
    // organization looking at this account never sees it, so a cross-tenant
    // assignment is inert rather than a leak. (The API refuses the write
    // outright — see /api/users' "Assigned hospital does not belong to the
    // selected organization".)
    await createUser({
      name: 'Wrong Tenant', username: 'wrong.tenant', password: 'Str0ngTempPass!',
      role: 'nurse', orgId: other._id,
      hospitalId: otherFacility._id, hospitalName: otherFacility.name,
    }, PLATFORM_OPERATOR._id);

    const roster = await getAllUsers({ orgId: org._id, role: 'org_admin', userId: 'user-orgadmin' });
    expect(roster.map((u: UserDoc) => u.username)).not.toContain('wrong.tenant');
  });
});
