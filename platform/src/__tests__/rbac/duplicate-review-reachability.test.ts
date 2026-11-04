/**
 * @jest-environment node
 *
 * Duplicate review has to be reachable by every role that may mark a duplicate.
 *
 * It lived only on `/admin/data`, which is the platform operator's console:
 * that device has no organisation and syncs nothing, so it scanned 0 patients,
 * while the roles that DO hold the records (PATIENT_DUPLICATE_ROLES) could not
 * open the page. The review now renders on `/data-quality`. Both halves of the
 * gate are pinned: the route table (does the page load) and the nav (is there
 * a way in).
 */
import { ROLE_ROUTE_TABLE, isPathAllowed } from '@/lib/role-routes';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { isHrefAllowed } from '@/components/ehr/ehr-navigation';
import { navReaches } from '@/lib/navigation/module-hubs';
import { PATIENT_DUPLICATE_ROLES } from '@/lib/sync/write-permissions';
import { findDuplicateCandidates } from '@/components/patients/duplicate-candidates';
import type { PatientDoc } from '@/lib/db-types';
import type { UserRole } from '@/lib/db-types';

describe('every role that may mark a duplicate can open the review', () => {
  test.each([...PATIENT_DUPLICATE_ROLES])('%s can load /data-quality', role => {
    expect(isPathAllowed(role, '/data-quality')).toBe(true);
  });

  // Since the 2026-11-04 navigation redesign the way in is the Reports row:
  // Data quality is one of the Reports hub's tabs (module-hubs.ts).
  test.each(['org_admin', 'hospital_manager'] as UserRole[])('%s has a nav way into it', role => {
    const navHrefs = ROLE_PERMISSIONS[role].navItems.map(item => item.href);
    expect(navReaches(navHrefs, ROLE_ROUTE_TABLE[role].allowed, '/data-quality')).toBe(true);
    expect(isHrefAllowed('/data-quality', ROLE_PERMISSIONS[role].allowedRoutes)).toBe(true);
  });

  test('both directions agree for org_admin: route table and derived allowedRoutes', () => {
    expect(ROLE_ROUTE_TABLE.org_admin.allowed).toContain('/data-quality');
    expect(ROLE_PERMISSIONS.org_admin.allowedRoutes).toContain('/data-quality');
  });

  test('/admin/data stays the platform operator\'s: org_admin was not given it back', () => {
    expect(isPathAllowed('org_admin', '/admin/data')).toBe(false);
    expect(isPathAllowed('hospital_manager', '/admin/data')).toBe(false);
    expect(isPathAllowed('super_admin', '/admin/data')).toBe(true);
  });
});

describe('candidate scan', () => {
  const p = (id: string, over: Partial<PatientDoc>) => ({
    _id: id, firstName: 'Achol', surname: 'Deng', dateOfBirth: '1990-05-02', ...over,
  }) as unknown as PatientDoc;

  test('pairs on name + DOB and on phone, once per pair', () => {
    const pairs = findDuplicateCandidates([
      p('a', { phone: '+211 912 345 678' }),
      p('b', { phone: '211912345678' }),
      p('c', { firstName: 'Nyibol', dateOfBirth: '1980-01-01', phone: '000' }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].basis).toBe('Name + DOB match');
  });

  test('an empty set has no candidates', () => {
    expect(findDuplicateCandidates([])).toEqual([]);
  });
});
