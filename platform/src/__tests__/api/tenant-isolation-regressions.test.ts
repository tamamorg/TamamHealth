/**
 * Horizontal-authorization regressions for API service paths that previously
 * scoped only their default list branch. These tests seed org B records and
 * exercise them with an org A scope; reads must be empty/not-found and writes
 * must leave the stored document untouched.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/modules/identity/core/api-auth', () => {
  const actual = jest.requireActual('@/modules/identity/core/api-auth');
  return { ...actual, getAuthPayload: jest.fn() };
});
jest.mock('next/server', () => {
  const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
  const { MessageChannel, MessagePort } = require('node:worker_threads');
  Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream, MessageChannel, MessagePort });
  const undici = require('undici');
  Object.assign(globalThis, {
    Response: undici.Response, Request: undici.Request,
    Headers: undici.Headers, fetch: undici.fetch,
  });
  return jest.requireActual('next/server');
});

jest.setTimeout(30000);

import { NextRequest } from 'next/server';
import { getAuthPayload, type AuthPayload } from '@/modules/identity/core/api-auth';
import {
  hospitalsDB, staffSchedulesDB, emergencyPlansDB, bloodBankDB, ancDB,
  diseaseAlertsDB, pharmacyInventoryDB, followUpsDB, organizationsDB,
} from '@/lib/db';
import { putDoc, teardownTestDBs } from '../helpers/test-db';
import type { DataScope } from '@/lib/services/data-scope';
import { getHospitalById, updateHospitalStatus } from '@/lib/services/hospital-service';
import {
  deleteSchedule, getOnCallStaff, getSchedulesByDate, getSchedulesByUser,
  getWeeklyRoster, updateSchedule,
} from '@/lib/services/staff-scheduling-service';
import {
  activatePlan, deletePlan, getActivePlans, getEmergencyDashboard,
  getPlanById, updatePlan,
} from '@/lib/services/emergency-preparedness-service';
import {
  getAvailableUnits, getBloodInventorySummary, getExpiringUnits, reserveUnit,
  updateUnit,
} from '@/lib/services/blood-bank-service';
import { getHighRiskPregnancies } from '@/lib/services/anc-service';
import { deleteAlert, getActiveAlerts, updateAlert } from '@/lib/services/surveillance-service';
import { decrementStock, deleteInventoryItem, updateInventoryItem } from '@/lib/services/pharmacy-inventory-service';
import { updateFollowUp } from '@/lib/services/follow-up-service';
import { GET as organizationsGET } from '@/app/api/organizations/route';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const HOSP_A = 'hosp-a';
const HOSP_B = 'hosp-b';
const scopeA: DataScope = { role: 'doctor', orgId: ORG_A, hospitalId: HOSP_A };
const nationalScope: DataScope = { role: 'super_admin' };
const mockGetAuth = getAuthPayload as jest.MockedFunction<typeof getAuthPayload>;

function orgAdmin(orgId: string): AuthPayload {
  return { sub: 'admin-a', username: 'admin-a', name: 'Admin A', role: 'org_admin', orgId };
}

function workspaceUser(role: AuthPayload['role'], orgId?: string): AuthPayload {
  return { sub: `${role}-user`, username: `${role}-user`, name: role, role, orgId };
}

function getRequest(url: string): NextRequest {
  return new NextRequest(url);
}

afterEach(async () => {
  await teardownTestDBs();
  jest.clearAllMocks();
});

test('hospital lookup and update fail closed across organizations', async () => {
  await putDoc(hospitalsDB(), { _id: HOSP_B, type: 'hospital', orgId: ORG_B, name: 'B', status: 'active' });

  expect(await getHospitalById(HOSP_B, scopeA)).toBeNull();
  expect(await updateHospitalStatus(HOSP_B, { status: 'inactive' } as never, scopeA)).toBeNull();
  expect((await hospitalsDB().get(HOSP_B) as { status: string }).status).toBe('active');
  expect((await getHospitalById(HOSP_B, nationalScope))?._id).toBe(HOSP_B);
});

test('an in-scope mutation cannot reassign a record to another tenant', async () => {
  await putDoc(staffSchedulesDB(), {
    _id: 'sched-a', type: 'staff_schedule', orgId: ORG_A, facilityId: HOSP_A,
    userId: 'user-a', shiftDate: '2026-08-20', startTime: '08:00', shiftType: 'morning',
    isOnCall: false, status: 'scheduled',
  });

  const updated = await updateSchedule('sched-a', {
    status: 'confirmed', orgId: ORG_B, facilityId: HOSP_B,
  } as never, scopeA);

  expect(updated?.status).toBe('confirmed');
  expect(updated?.orgId).toBe(ORG_A);
  expect(updated?.facilityId).toBe(HOSP_A);
});

test('specialized schedule reads and ID mutations stay inside the caller scope', async () => {
  await putDoc(staffSchedulesDB(), {
    _id: 'sched-b', type: 'staff_schedule', orgId: ORG_B, facilityId: HOSP_B,
    userId: 'user-b', shiftDate: '2026-08-20', startTime: '08:00', shiftType: 'morning',
    isOnCall: true, status: 'scheduled',
  });

  expect(await getSchedulesByDate('2026-08-20', HOSP_B, scopeA)).toEqual([]);
  expect(await getSchedulesByUser('user-b', scopeA)).toEqual([]);
  expect(await getOnCallStaff('2026-08-20', HOSP_B, scopeA)).toEqual([]);
  expect(await getWeeklyRoster('2026-08-20', HOSP_B, scopeA)).toEqual([]);
  expect(await updateSchedule('sched-b', { status: 'absent' } as never, scopeA)).toBeNull();
  expect(await deleteSchedule('sched-b', scopeA)).toBe(false);
  expect((await staffSchedulesDB().get('sched-b') as { status: string }).status).toBe('scheduled');
});

test('emergency and blood-bank dashboards cannot aggregate or mutate another tenant', async () => {
  await putDoc(emergencyPlansDB(), {
    _id: 'plan-b', type: 'emergency_plan', orgId: ORG_B, facilityId: HOSP_B,
    phase: 'alert', severity: 'level_1', emergencyType: 'flood', planName: 'B plan',
    facilityName: 'B', estimatedCapacity: 10, currentLoad: 1,
    resources: { availableSurgeBeds: 2, oralRehydrationSachets: 100, ppe: 100 },
  });
  await putDoc(bloodBankDB(), {
    _id: 'blood-b', type: 'blood_bank', orgId: ORG_B, facilityId: HOSP_B,
    bloodGroup: 'O+', status: 'available', expiryDate: '2099-01-01',
  });

  expect(await getPlanById('plan-b', scopeA)).toBeNull();
  expect(await getActivePlans(HOSP_B, scopeA)).toEqual([]);
  expect((await getEmergencyDashboard(HOSP_B, scopeA)).totalPlans).toBe(0);
  expect(await updatePlan('plan-b', { phase: 'response' } as never, scopeA)).toBeNull();
  expect(await activatePlan('plan-b', 'Admin A', undefined, scopeA)).toBeNull();
  expect(await deletePlan('plan-b', scopeA)).toBe(false);

  expect(await getAvailableUnits('O+', HOSP_B, scopeA)).toEqual([]);
  expect((await getBloodInventorySummary(HOSP_B, scopeA)).totalUnits).toBe(0);
  expect(await getExpiringUnits(30000, HOSP_B, scopeA)).toEqual([]);
  expect(await reserveUnit('blood-b', 'patient-a', scopeA)).toBeNull();
  expect(await updateUnit('blood-b', { status: 'discarded' } as never, scopeA)).toBeNull();
  expect((await bloodBankDB().get('blood-b') as { status: string }).status).toBe('available');
});

test('high-risk ANC, active surveillance, pharmacy, and follow-up paths reject org B data', async () => {
  await putDoc(ancDB(), {
    _id: 'anc-b', type: 'anc_visit', orgId: ORG_B, facilityId: HOSP_B,
    motherId: 'mother-b', visitNumber: 1, visitDate: '2026-08-20', riskLevel: 'high',
  });
  await putDoc(diseaseAlertsDB(), {
    _id: 'alert-b', type: 'disease_alert', orgId: ORG_B, alertLevel: 'emergency', disease: 'X',
  });
  await putDoc(pharmacyInventoryDB(), {
    _id: 'item-b', type: 'pharmacy_inventory', orgId: ORG_B, hospitalId: HOSP_B,
    medicationName: 'Drug', stockLevel: 10,
  });
  await putDoc(followUpsDB(), {
    _id: 'follow-b', type: 'follow_up', orgId: ORG_B, facilityId: HOSP_B,
    status: 'active', assignedWorker: 'user-b',
  });

  expect(await getHighRiskPregnancies(scopeA)).toEqual([]);
  expect(await getActiveAlerts(scopeA)).toEqual([]);
  expect(await updateAlert('alert-b', { alertLevel: 'normal' }, scopeA)).toBeNull();
  expect(await deleteAlert('alert-b', scopeA)).toBe(false);
  expect(await updateInventoryItem('item-b', { stockLevel: 0 }, scopeA)).toBeNull();
  expect(await deleteInventoryItem('item-b', scopeA)).toBe(false);
  await decrementStock('Drug', HOSP_A, 1, scopeA);
  expect(await updateFollowUp('follow-b', { status: 'completed' } as never, scopeA)).toBeNull();
  expect((await diseaseAlertsDB().get('alert-b') as { alertLevel: string }).alertLevel).toBe('emergency');
  expect((await pharmacyInventoryDB().get('item-b') as { stockLevel: number }).stockLevel).toBe(10);
  expect((await followUpsDB().get('follow-b') as { status: string }).status).toBe('active');
});

test('org admins see only their organization and cannot request foreign stats', async () => {
  await putDoc(organizationsDB(), { _id: ORG_A, type: 'organization', name: 'Org A', slug: 'a' });
  await putDoc(organizationsDB(), { _id: ORG_B, type: 'organization', name: 'Org B', slug: 'b' });
  mockGetAuth.mockResolvedValue(orgAdmin(ORG_A));

  const list = await organizationsGET(getRequest('http://test/api/organizations'));
  expect(list.status).toBe(200);
  expect((await list.json()).organizations.map((org: { _id: string }) => org._id)).toEqual([ORG_A]);

  const foreignById = await organizationsGET(getRequest(`http://test/api/organizations?id=${ORG_B}`));
  expect(foreignById.status).toBe(404);
  const foreignStats = await organizationsGET(getRequest(`http://test/api/organizations?orgId=${ORG_B}&stats=true`));
  expect(foreignStats.status).toBe(404);
  const foreignSlug = await organizationsGET(getRequest('http://test/api/organizations?slug=b'));
  expect(foreignSlug.status).toBe(404);

  mockGetAuth.mockResolvedValue({
    sub: 'super', username: 'super', name: 'Super Admin', role: 'super_admin',
  });
  const nationalList = await organizationsGET(getRequest('http://test/api/organizations'));
  expect((await nationalList.json()).organizations).toHaveLength(2);
});

test.each([
  'medical_superintendent',
  'hospital_manager',
  'county_health_director',
  'hrio',
  'records_hmis_officer',
] as const)('%s can open the management workspace but sees only its organization', async role => {
  await putDoc(organizationsDB(), { _id: ORG_A, type: 'organization', name: 'Org A', slug: 'a' });
  await putDoc(organizationsDB(), { _id: ORG_B, type: 'organization', name: 'Org B', slug: 'b' });
  mockGetAuth.mockResolvedValue(workspaceUser(role, ORG_A));

  const response = await organizationsGET(getRequest('http://test/api/organizations'));
  expect(response.status).toBe(200);
  expect((await response.json()).organizations.map((org: { _id: string }) => org._id)).toEqual([ORG_A]);
});

test('government oversight can list all organizations', async () => {
  await putDoc(organizationsDB(), { _id: ORG_A, type: 'organization', name: 'Org A', slug: 'a' });
  await putDoc(organizationsDB(), { _id: ORG_B, type: 'organization', name: 'Org B', slug: 'b' });
  mockGetAuth.mockResolvedValue(workspaceUser('government'));

  const response = await organizationsGET(getRequest('http://test/api/organizations'));
  expect(response.status).toBe(200);
  expect((await response.json()).organizations.map((org: { _id: string }) => org._id).sort()).toEqual([ORG_A, ORG_B]);
});
