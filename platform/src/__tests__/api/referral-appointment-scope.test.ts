/**
 * Regression tests for three tenancy/authorization bugs in doctor-relevant
 * API routes:
 *
 *  1. /api/referrals POST `accept` / `update_status` used to trust a
 *     client-supplied referralId with no scope check — any CREATE_ROLES
 *     caller could accept or drive the status of ANY org's referral.
 *  2. /api/appointments POST `update_status` / `reschedule` had the same gap.
 *  3. Every create branch (lab, prescriptions, referrals, appointments) used
 *     `if (!body.orgId && auth.orgId) body.orgId = auth.orgId`, which let a
 *     caller who explicitly supplied an orgId write into another org's data.
 *     Auth must always win when the caller belongs to an org.
 *
 * These exercise the real route handlers (POST) end-to-end against the
 * in-memory PouchDB test harness, with `getAuthPayload` swapped for a
 * controllable stub so each case can assert as a specific authenticated user.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/modules/identity/core/api-auth', () => {
  const actual = jest.requireActual('@/modules/identity/core/api-auth');
  return {
    ...actual,
    getAuthPayload: jest.fn(),
  };
});
// The project's default jsdom test environment has no native fetch, so
// jest.setup.ts polyfills `Response`/`Request`/`Headers` with empty stub
// classes (adequate for pouchdb-browser, which only needs `fetch` to exist).
// `next/server`'s NextResponse class extends the global `Response` at
// *module-load* time, so those stubs make every `NextResponse.json(...)`
// call in the route handlers throw ("Response.json is not a function").
// Swapping in undici's spec-compliant classes — before `next/server` is
// first required — fixes that without touching the shared jest.setup.ts
// (which pouchdb-browser elsewhere still needs the stub-triggering branch
// for). jest.mock factories are hoisted above the imports below and run the
// first time the module is required, which is early enough here.
jest.mock('next/server', () => {
   
  const { ReadableStream, WritableStream, TransformStream } = require('node:stream/web');
   
  const { MessageChannel, MessagePort } = require('node:worker_threads');
  Object.assign(globalThis, { ReadableStream, WritableStream, TransformStream, MessageChannel, MessagePort });
   
  const undici = require('undici');
  Object.assign(globalThis, {
    Response: undici.Response,
    Request: undici.Request,
    Headers: undici.Headers,
    fetch: undici.fetch,
  });
  return jest.requireActual('next/server');
});

// Route-handler tests do real request plumbing plus PouchDB seeding per case;
// the 5s default flakes on a loaded machine.
jest.setTimeout(30000);

import type { NextRequest } from 'next/server';
import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB } from '@/lib/db';
import { getAuthPayload, type AuthPayload } from '@/modules/identity/core/api-auth';
import { createReferral, getReferralById } from '@/lib/services/referral-service';
import { createAppointment, getAppointmentById } from '@/lib/services/appointment-service';
import { POST as referralsPOST } from '@/app/api/referrals/route';
import { POST as appointmentsPOST } from '@/app/api/appointments/route';
import { POST as labPOST } from '@/app/api/lab/route';
import { POST as prescriptionsPOST } from '@/app/api/prescriptions/route';

const mockGetAuth = getAuthPayload as jest.MockedFunction<typeof getAuthPayload>;

const HOSP_A = 'hosp-a1';
const HOSP_B = 'hosp-b1';
const ORG_A = 'org-a';
const ORG_B = 'org-b';

function authFor(orgId: string, hospitalId: string, sub = 'user-doc'): AuthPayload {
  return {
    sub, username: sub, role: 'doctor', name: 'Dr Test',
    orgId, hospitalId,
  };
}

function postRequest(url: string, body: unknown): NextRequest {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

/** A date far enough ahead of the real system clock to pass appointment
 * future-date validation, whatever the actual test-run date happens to be. */
function futureDateString(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP_A, type: 'hospital', name: 'Hospital A', code: 'HA', orgId: ORG_A } as unknown as { _id: string });
  await putDoc(hospitalsDB(), { _id: HOSP_B, type: 'hospital', name: 'Hospital B', code: 'HB', orgId: ORG_B } as unknown as { _id: string });
});

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
  jest.clearAllMocks();
});

describe('BUG 1 — /api/referrals accept / update_status scope guard', () => {
  test('a doctor cannot accept or update_status a referral belonging to another org', async () => {
    // Wholly inside org-b — no cross-org toOrgId in play.
    const referral = await createReferral({
      patientId: 'pat-1', patientName: 'Test Patient',
      fromHospital: 'Hospital B', fromHospitalId: HOSP_B,
      toHospital: 'Hospital B Annex', toHospitalId: HOSP_B,
      referralDate: '2026-08-01', urgency: 'routine', reason: 'Specialist review',
      department: 'Cardiology', status: 'sent', referringDoctor: 'Dr B', notes: '',
      orgId: ORG_B,
    } as unknown as Parameters<typeof createReferral>[0]);

    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));

    const acceptRes = await referralsPOST(postRequest('http://test/api/referrals', {
      action: 'accept', referralId: referral._id,
    }));
    expect(acceptRes.status).toBe(404);

    const statusRes = await referralsPOST(postRequest('http://test/api/referrals', {
      action: 'update_status', referralId: referral._id, status: 'seen',
    }));
    expect(statusRes.status).toBe(404);

    const unchanged = await getReferralById(referral._id);
    expect(unchanged?.status).toBe('sent');
  });

  test('a doctor in the receiving org CAN accept an inbound cross-org referral (KAN-101)', async () => {
    const referral = await createReferral({
      patientId: 'pat-2', patientName: 'Cross Org Patient',
      fromHospital: 'Hospital A', fromHospitalId: HOSP_A,
      toHospital: 'Hospital B', toHospitalId: HOSP_B,
      referralDate: '2026-08-01', urgency: 'urgent', reason: 'Trauma transfer',
      department: 'Surgery', status: 'sent', referringDoctor: 'Dr A', notes: '',
      orgId: ORG_A,
      // toOrgId intentionally omitted so createReferral resolves it itself
      // via hospitalsDB, exactly like the real create path.
    } as unknown as Parameters<typeof createReferral>[0]);
    expect(referral.toOrgId).toBe(ORG_B);

    mockGetAuth.mockResolvedValue(authFor(ORG_B, HOSP_B, 'user-receiving-doc'));

    const acceptRes = await referralsPOST(postRequest('http://test/api/referrals', {
      action: 'accept', referralId: referral._id,
    }));
    expect(acceptRes.status).toBe(200);
    const body = await acceptRes.json();
    expect(body.referral.status).toBe('seen');

    const persisted = await getReferralById(referral._id);
    expect(persisted?.status).toBe('seen');
  });
});

describe('BUG 2 — /api/appointments update_status / reschedule scope guard', () => {
  test('a doctor cannot update_status or reschedule an appointment belonging to another org', async () => {
    const appt = await createAppointment({
      patientId: 'pat-3', patientName: 'Appt Patient',
      providerId: 'user-provider-b', providerName: 'Dr Provider B',
      facilityId: HOSP_B, facilityName: 'Hospital B', facilityLevel: 'payam',
      appointmentDate: '2026-08-20', appointmentTime: '09:00', duration: 30,
      appointmentType: 'general', status: 'scheduled', reason: 'Follow-up',
      bookedBy: 'user-desk-b', bookedByName: 'Desk B', orgId: ORG_B, source: 'staff',
    } as unknown as Parameters<typeof createAppointment>[0]);

    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));

    const statusRes = await appointmentsPOST(postRequest('http://test/api/appointments', {
      action: 'update_status', appointmentId: appt._id, status: 'confirmed',
    }));
    expect(statusRes.status).toBe(404);

    const reschedRes = await appointmentsPOST(postRequest('http://test/api/appointments', {
      action: 'reschedule', appointmentId: appt._id, newDate: futureDateString(45), newTime: '10:00',
    }));
    expect(reschedRes.status).toBe(404);

    const unchanged = await getAppointmentById(appt._id);
    expect(unchanged?.status).toBe('scheduled');
    expect(unchanged?.appointmentDate).toBe('2026-08-20');
    expect(unchanged?.appointmentTime).toBe('09:00');
  });
});

describe('BUG 3 — auth wins over a client-supplied orgId on create', () => {
  test('lab order create stamps orgId + hospitalId from auth even when the body supplies a different org', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await labPOST(postRequest('http://test/api/lab', {
      patientId: 'pat-4', testName: 'CBC', orgId: ORG_B,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.labResult.orgId).toBe(ORG_A);
    expect(body.labResult.hospitalId).toBe(HOSP_A);
  });

  test('prescription create stamps orgId + hospitalId from auth even when the body supplies a different org', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await prescriptionsPOST(postRequest('http://test/api/prescriptions', {
      patientId: 'pat-5', medication: 'Amoxicillin', dose: '500mg', frequency: 'TID', orgId: ORG_B,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prescription.orgId).toBe(ORG_A);
    expect(body.prescription.hospitalId).toBe(HOSP_A);
  });

  test('referral create stamps orgId from auth even when the body supplies a different org', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await referralsPOST(postRequest('http://test/api/referrals', {
      patientId: 'pat-6', toHospitalId: HOSP_B, reason: 'Specialist opinion', orgId: ORG_B,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.referral.orgId).toBe(ORG_A);
  });

  test('appointment create stamps orgId from auth even when the body supplies a different org', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await appointmentsPOST(postRequest('http://test/api/appointments', {
      patientId: 'pat-7', patientName: 'Appt Create Patient', providerId: 'user-provider-a',
      appointmentDate: futureDateString(30), appointmentTime: '11:00', duration: 30,
      orgId: ORG_B,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.appointment.orgId).toBe(ORG_A);
  });

  test('a national-role caller with no orgId of their own may still supply one', async () => {
    mockGetAuth.mockResolvedValue({
      sub: 'user-super', username: 'super', role: 'super_admin', name: 'Super Admin',
    });
    const res = await labPOST(postRequest('http://test/api/lab', {
      patientId: 'pat-8', testName: 'Malaria RDT', orgId: ORG_B,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.labResult.orgId).toBe(ORG_B);
  });
});
