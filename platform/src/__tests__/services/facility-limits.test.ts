/**
 * Subscription limits and tenant status, enforced rather than displayed.
 *
 * `maxHospitals` appeared on four screens as "3 / 10" and was checked by
 * nothing, so an organization on a ten-facility plan could register a hundred.
 * A suspended or cancelled tenant could still be given new sites, because the
 * kill-switch (`getTenantAccess`) runs on the ACTOR's organization and a
 * platform operator has none and is exempt anyway.
 *
 * `createHospital` is the single writer both the dialog and /api/hospitals go
 * through, so the rules live there and these tests exercise them directly.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createOrganization } from '@/lib/services/organization-service';
import {
  createHospital, getAllHospitals, setFacilityActive, updateFacility,
  isFacilityActive, activeFacilities,
} from '@/lib/services/hospital-service';
import type { OrganizationDoc } from '@/lib/db-types';

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

async function org(overrides: Partial<OrganizationDoc> = {}, slug = 'moh') {
  return createOrganization({
    name: `Org ${slug}`, slug, orgType: 'public', contactEmail: 'a@b.c',
    country: 'South Sudan', subscriptionPlan: 'basic', subscriptionStatus: 'active',
    maxUsers: 50, maxHospitals: 2, isActive: true, ...overrides,
  } as unknown as Omit<OrganizationDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>);
}

function facility(orgId: string, name: string) {
  return {
    name, state: 'Central Equatoria', town: 'Juba', facilityType: 'phcc',
    totalBeds: 10, icuBeds: 0, maternityBeds: 0, pediatricBeds: 0,
    doctors: 0, clinicalOfficers: 0, nurses: 0, labTechnicians: 0, pharmacists: 0,
    hasElectricity: false, electricityHours: 0, hasGenerator: false, hasSolar: false,
    hasInternet: false, internetType: 'none', hasAmbulance: false, emergency24hr: false,
    services: [], lat: 0, lng: 0, orgId,
  } as unknown as Parameters<typeof createHospital>[0];
}

describe('maxHospitals is a limit, not a label', () => {
  test('the plan’s allowance can be filled', async () => {
    const o = await org();
    await createHospital(facility(o._id, 'One'));
    await createHospital(facility(o._id, 'Two'));
    await expect(getAllHospitals({ orgId: o._id, role: 'org_admin' })).resolves.toHaveLength(2);
  });

  test('the one past it is refused, naming the plan', async () => {
    const o = await org();
    await createHospital(facility(o._id, 'One'));
    await createHospital(facility(o._id, 'Two'));
    await expect(createHospital(facility(o._id, 'Three')))
      .rejects.toMatchObject({
        name: 'ValidationError',
        fields: { orgId: expect.stringContaining('all 2 facilities') },
      });
  });

  test('retiring one frees the slot it was holding', async () => {
    const o = await org();
    const first = await createHospital(facility(o._id, 'One'));
    await createHospital(facility(o._id, 'Two'));
    await expect(createHospital(facility(o._id, 'Three'))).rejects.toThrow();

    await setFacilityActive(first._id, false, 'user-admin', 'admin');
    const third = await createHospital(facility(o._id, 'Three'));
    expect(third.name).toBe('Three');
  });

  test('an unlimited plan (no maxHospitals) is left alone', async () => {
    const o = await org({ maxHospitals: 0 }, 'unlimited');
    for (const n of ['A', 'B', 'C', 'D']) await createHospital(facility(o._id, n));
    await expect(getAllHospitals({ orgId: o._id, role: 'org_admin' })).resolves.toHaveLength(4);
  });

  test('one tenant’s facilities never count against another’s allowance', async () => {
    const a = await org({}, 'alpha');
    const b = await org({}, 'beta');
    await createHospital(facility(a._id, 'A1'));
    await createHospital(facility(a._id, 'A2'));
    // `a` is full; `b` is untouched.
    await expect(createHospital(facility(b._id, 'B1'))).resolves.toBeTruthy();
  });
});

describe('a tenant that is not entitled takes no facilities', () => {
  test.each(['suspended', 'cancelled'] as const)('%s is refused', async status => {
    const o = await org({ subscriptionStatus: status }, `s-${status}`);
    await expect(createHospital(facility(o._id, 'Nope')))
      .rejects.toMatchObject({ fields: { orgId: expect.stringContaining(status) } });
  });

  test('a deactivated organization is refused', async () => {
    const o = await org({ isActive: false }, 'inactive');
    await expect(createHospital(facility(o._id, 'Nope')))
      .rejects.toMatchObject({ fields: { orgId: expect.stringContaining('inactive') } });
  });

  test('an active one is not', async () => {
    const o = await org({}, 'fine');
    await expect(createHospital(facility(o._id, 'Yes'))).resolves.toBeTruthy();
  });
});

describe('a facility can be corrected after registration', () => {
  test('beds, type and location are editable — they used to be write-once', async () => {
    const o = await org({}, 'edit');
    const saved = await createHospital(facility(o._id, 'Typo Clinic'));
    const updated = await updateFacility(saved._id, {
      name: 'Yei PHCU', facilityType: 'phcu', totalBeds: 24, town: 'Yei',
    });
    expect(updated).toMatchObject({ name: 'Yei PHCU', facilityType: 'phcu', totalBeds: 24, town: 'Yei' });
  });

  test('the tenant is not editable — moving one would orphan its records', async () => {
    const o = await org({}, 'immutable');
    const other = await org({}, 'elsewhere');
    const saved = await createHospital(facility(o._id, 'Fixed'));
    // The signature forbids it; this pins the runtime behaviour too.
    const updated = await updateFacility(saved._id, { orgId: other._id } as never);
    expect(updated!.orgId).toBe(o._id);
  });
});

describe('retiring is a soft flag', () => {
  test('a retired facility keeps its record and its history', async () => {
    const o = await org({}, 'retire');
    const saved = await createHospital(facility(o._id, 'Closing'));
    const retired = await setFacilityActive(saved._id, false, 'user-admin', 'admin');

    expect(retired!.isActive).toBe(false);
    expect(retired!.retiredAt).toBeTruthy();
    expect(retired!.name).toBe('Closing');
    // Still readable — every admission and bill stamped with it must resolve.
    await expect(getAllHospitals({ orgId: o._id, role: 'org_admin' }))
      .resolves.toEqual([expect.objectContaining({ _id: saved._id })]);
  });

  test('but it drops out of the pickers new work is assigned through', async () => {
    const o = await org({}, 'pickers');
    const open = await createHospital(facility(o._id, 'Open'));
    const shut = await createHospital(facility(o._id, 'Shut'));
    await setFacilityActive(shut._id, false, 'user-admin', 'admin');

    const all = await getAllHospitals({ orgId: o._id, role: 'org_admin' });
    expect(all).toHaveLength(2);
    expect(activeFacilities(all).map(h => h._id)).toEqual([open._id]);
  });

  test('and it can come back', async () => {
    const o = await org({}, 'restore');
    const saved = await createHospital(facility(o._id, 'Seasonal'));
    await setFacilityActive(saved._id, false, 'user-admin', 'admin');
    const restored = await setFacilityActive(saved._id, true, 'user-admin', 'admin');
    expect(isFacilityActive(restored!)).toBe(true);
    expect(restored!.retiredAt).toBeUndefined();
  });

  test('a facility from before the field existed counts as active', () => {
    // `isActive` is undefined on every facility created before this shipped —
    // reading it as `=== true` would empty every picker in the app.
    expect(isFacilityActive({ isActive: undefined })).toBe(true);
    expect(isFacilityActive({ isActive: true })).toBe(true);
    expect(isFacilityActive({ isActive: false })).toBe(false);
  });
});
