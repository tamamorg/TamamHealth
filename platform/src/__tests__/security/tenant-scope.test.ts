/**
 * Security — tenant / facility data isolation (src/lib/services/data-scope.ts).
 *
 * filterByScope is the last line of defence keeping one organisation's PHI out
 * of another's screens. These tests pin: org isolation, facility narrowing,
 * the national-role bypass, the cross-org referral exception, and the rule that
 * a doc with no orgId is rejected for scoped users.
 */
import { filterByScope, buildScopeFromAuth } from '@/lib/services/data-scope';
import type { DataScope } from '@/lib/services/data-scope';

type Doc = Record<string, unknown> & { _id: string };
const docs: Doc[] = [
  { _id: 'a', type: 'patient', orgId: 'org-moh-ss', hospitalId: 'hosp-001' },
  { _id: 'b', type: 'patient', orgId: 'org-moh-ss', hospitalId: 'hosp-002' },
  { _id: 'c', type: 'patient', orgId: 'org-mercy-hospital', hospitalId: 'hosp-mercy-001' },
  { _id: 'd', type: 'patient' }, // no orgId at all — must be rejected for scoped users
];

const scope = (o: Partial<DataScope>): DataScope => ({ role: 'doctor', orgId: 'org-moh-ss', ...o } as DataScope);

describe('filterByScope: organisation isolation', () => {
  test('a facility user sees only their own org and facility', () => {
    const out = filterByScope(docs, scope({ role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' }));
    expect(out.map((d) => d._id)).toEqual(['a']);
  });

  test('an explicitly multi-facility user sees home and granted sites only', () => {
    const out = filterByScope(docs, scope({
      role: 'doctor',
      orgId: 'org-moh-ss',
      hospitalId: 'hosp-001',
      facilityIds: ['hosp-002'],
    }));
    expect(out.map((d) => d._id).sort()).toEqual(['a', 'b']);
    expect(out.map((d) => d._id)).not.toContain('c');
  });

  test('a facility-bound user with no entitlement fails closed for PHI', () => {
    const out = filterByScope(docs, scope({
      role: 'doctor',
      orgId: 'org-moh-ss',
      hospitalId: undefined,
      facilityIds: [],
    }));
    expect(out).toEqual([]);
  });

  test("another org's patients are never returned", () => {
    const out = filterByScope(docs, scope({ role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' }));
    expect(out.map((d) => d._id)).not.toContain('c');
  });

  test('an org-admin (no hospital narrowing) sees the whole org but not other orgs', () => {
    const out = filterByScope(docs, scope({ role: 'org_admin', orgId: 'org-moh-ss', hospitalId: undefined }));
    expect(out.map((d) => d._id).sort()).toEqual(['a', 'b']);
    expect(out.map((d) => d._id)).not.toContain('c');
  });
});

describe('filterByScope: no-orgId documents', () => {
  test('a patient doc with no orgId is rejected for a scoped user', () => {
    const out = filterByScope(docs, scope({ role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' }));
    expect(out.map((d) => d._id)).not.toContain('d');
  });

  test('a non-national user without an org scope sees nothing', () => {
    const out = filterByScope(docs, scope({ role: 'doctor', orgId: undefined, hospitalId: 'hosp-001' }));
    expect(out).toEqual([]);
  });
});

describe('filterByScope: national-role bypass', () => {
  test('super_admin sees everything, across all orgs', () => {
    const out = filterByScope(docs, scope({ role: 'super_admin', orgId: undefined, hospitalId: undefined }));
    expect(out).toHaveLength(docs.length);
  });
  test('government sees everything', () => {
    const out = filterByScope(docs, scope({ role: 'government', orgId: undefined, hospitalId: undefined }));
    expect(out).toHaveLength(docs.length);
  });
});

describe('filterByScope: cross-org referral exception (KAN-101)', () => {
  test('a referral addressed to my org/facility is visible even though its orgId is the sender', () => {
    const referral: Doc = {
      _id: 'ref-1', type: 'referral', orgId: 'org-mercy-hospital', // sending org
      toOrgId: 'org-moh-ss', toHospitalId: 'hosp-001',             // receiving facility
    };
    const out = filterByScope([referral], scope({ role: 'doctor', orgId: 'org-moh-ss', hospitalId: 'hosp-001' }));
    expect(out.map((d) => d._id)).toContain('ref-1');
  });
});

describe('buildScopeFromAuth', () => {
  test('carries role, org and all entitled facilities from the JWT payload', () => {
    const s = buildScopeFromAuth({
      role: 'nurse', orgId: 'org-moh-ss', hospitalId: 'hosp-003', facilityIds: ['hosp-004'],
    } as Parameters<typeof buildScopeFromAuth>[0]);
    expect(s.role).toBe('nurse');
    expect(s.orgId).toBe('org-moh-ss');
    expect(s.hospitalId).toBe('hosp-003');
    expect(s.facilityIds).toEqual(['hosp-004']);
  });
});
