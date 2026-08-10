import { entitlementFor, replicationSelector } from '@/lib/sync/facility-entitlements';

describe('replicationSelector: device-level data isolation', () => {
  test('matches facilityId and registrationHospital, not only hospitalId', () => {
    const selector = replicationSelector(entitlementFor({
      role: 'nurse', orgId: 'org-a', hospitalId: 'facility-a',
    })) as Record<string, any>;
    const facility = selector.$and[1];
    const branches = facility.$or as Record<string, any>[];
    expect(branches).toEqual(expect.arrayContaining([
      { hospitalId: { $in: ['facility-a'] } },
      { facilityId: { $in: ['facility-a'] } },
      { registrationHospital: { $in: ['facility-a'] } },
    ]));
  });

  test('requires the tenant on non-global data', () => {
    const selector = replicationSelector(entitlementFor({
      role: 'nurse', orgId: 'org-a', hospitalId: 'facility-a',
    })) as Record<string, any>;
    const org = selector.$and[0];
    expect(org.$or).toContainEqual({ orgId: 'org-a' });
    expect(org.$or).toContainEqual({
      $and: [
        { orgId: { $exists: false } },
        { type: { $in: ['organization', 'platform_config'] } },
      ],
    });
  });

  test('unknown facility entitlement is fail-closed', () => {
    const selector = replicationSelector(entitlementFor({ role: 'nurse', orgId: 'org-a' })) as Record<string, any>;
    expect(selector.$and[1]).toEqual({
      $and: expect.arrayContaining([
        { hospitalId: { $exists: false } },
        { facilityId: { $exists: false } },
      ]),
    });
  });
});
