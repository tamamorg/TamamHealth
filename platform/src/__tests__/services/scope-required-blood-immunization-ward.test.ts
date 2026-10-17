/**
 * Blood bank, immunization and ward reads/mutations take a REQUIRED DataScope.
 * A scope from another org must see nothing and mutate nothing; super_admin and
 * government keep their national view (filterByScope owns that).
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { bloodBankDB, immunizationsDB, wardDB } from '@/lib/db';
import { getAllUnits, getAvailableUnits, reserveUnit, discardUnit, getBloodInventorySummary } from '@/lib/services/blood-bank-service';
import { getAllImmunizations, getByPatient, getByFacility, getImmunizationStats, getByPatientUnscopedForPortal } from '@/lib/services/immunization-service';
import { getAllWards, getWardById, getBedsByWard, getBedById, getAllBeds, getOccupancyStats } from '@/lib/services/ward-service';
import type { DataScope } from '@/lib/services/data-scope';

type Role = DataScope['role'];
const A: DataScope = { orgId: 'org-a', hospitalId: 'h-a', role: 'clinician' as Role };
const B: DataScope = { orgId: 'org-b', hospitalId: 'h-b', role: 'clinician' as Role };
const NO_ORG: DataScope = { role: 'clinician' as Role };
const SUPER: DataScope = { role: 'super_admin' as Role };

afterEach(async () => { await teardownTestDBs(); });

describe('blood bank', () => {
  beforeEach(async () => {
    await putDoc(bloodBankDB(), {
      _id: 'blood-1', type: 'blood_bank', orgId: 'org-a', facilityId: 'h-a', bloodGroup: 'O+',
      status: 'available', expiryDate: '2999-01-01', volume: 450, component: 'whole',
    } as never);
  });
  test('another org sees nothing and cannot mutate', async () => {
    expect((await getAllUnits(A)).map(u => u._id)).toEqual(['blood-1']);
    expect(await getAllUnits(B)).toEqual([]);
    expect(await getAllUnits(NO_ORG)).toEqual([]);
    expect(await getAvailableUnits(undefined, undefined, B)).toEqual([]);
    expect((await getBloodInventorySummary(undefined, B)).totalUnits ?? 0).toBe(0);
    expect(await reserveUnit('blood-1', 'p1', B)).toBeNull();
    expect(await discardUnit('blood-1', 'x', B)).toBeNull();
    expect((await getAllUnits(A))[0].status).toBe('available');
  });
  test('super_admin keeps the national view', async () => {
    expect(await getAllUnits(SUPER)).toHaveLength(1);
  });
});

describe('immunizations', () => {
  beforeEach(async () => {
    await putDoc(immunizationsDB(), {
      _id: 'imm-1', type: 'immunization', orgId: 'org-a', facilityId: 'h-a', patientId: 'c1',
      vaccine: 'BCG', createdAt: '2026-01-01T00:00:00.000Z',
    } as never);
  });
  test('another org sees nothing', async () => {
    expect(await getAllImmunizations(A)).toHaveLength(1);
    expect(await getAllImmunizations(B)).toEqual([]);
    expect(await getAllImmunizations(NO_ORG)).toEqual([]);
    expect(await getByPatient('c1', B)).toEqual([]);
    expect(await getByFacility('h-a', B)).toEqual([]);
    expect((await getImmunizationStats(B)).totalVaccinations).toBe(0);
  });
  test('portal entrypoint is the only patient-id-only read', async () => {
    expect(await getByPatientUnscopedForPortal('c1')).toHaveLength(1);
  });
});

describe('wards', () => {
  beforeEach(async () => {
    await putDoc(wardDB(), { _id: 'ward-1', type: 'ward', orgId: 'org-a', facilityId: 'h-a', name: 'W', isActive: true, totalBeds: 1 } as never);
    await putDoc(wardDB(), { _id: 'bed-1', type: 'bed', orgId: 'org-a', facilityId: 'h-a', wardId: 'ward-1', wardName: 'W', bedNumber: '1', status: 'available' } as never);
  });
  test('another org sees nothing', async () => {
    expect(await getAllWards(A)).toHaveLength(1);
    expect(await getAllWards(B)).toEqual([]);
    expect(await getAllWards(NO_ORG)).toEqual([]);
    expect(await getWardById('ward-1', B)).toBeNull();
    expect(await getBedsByWard('ward-1', B)).toEqual([]);
    expect(await getBedById('bed-1', B)).toBeNull();
    expect(await getAllBeds(B)).toEqual([]);
    expect((await getOccupancyStats('h-a', B)).totalBeds).toBe(0);
  });
});
