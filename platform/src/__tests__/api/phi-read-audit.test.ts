/**
 * KAN-97 follow-up: `logPhiRead` existed in `audit-service.ts` but nothing
 * called it — GET /api/patients/:id and every /api/fhir/* data route
 * returned PHI with no read audit trail at all. This pins down that each of
 * those routes now emits exactly one `logPhiRead` call, with the right
 * patient/resource identifiers, on a successful read — and that they emit
 * NONE when the read is denied (404/403), since a denied read discloses
 * nothing and should not be recorded as one.
 *
 * `logPhiRead` is fire-and-forget (`import(...).then(logPhiRead(...))`), so
 * these tests mock `@/lib/services/audit-service` and assert on the mock
 * directly rather than racing the real fire-and-forget write against a
 * database read.
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
jest.mock('@/lib/services/audit-service', () => {
  const actual = jest.requireActual('@/lib/services/audit-service');
  return {
    ...actual,
    logPhiRead: jest.fn().mockResolvedValue(undefined),
  };
});
// See referral-appointment-scope.test.ts for why next/server needs undici's
// Response/Request/Headers swapped in before it is first required under jsdom.
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

jest.setTimeout(30000);

import type { NextRequest } from 'next/server';
import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB, labResultsDB, prescriptionsDB, medicalRecordsDB } from '@/lib/db';
import { getAuthPayload, type AuthPayload } from '@/modules/identity/core/api-auth';
import { logPhiRead } from '@/lib/services/audit-service';
import { createReferral } from '@/lib/services/referral-service';
import type { PatientDoc, LabResultDoc, PrescriptionDoc, MedicalRecordDoc } from '@/lib/db-types';

import { GET as patientByIdGET } from '@/app/api/patients/[id]/route';
import { GET as fhirPatientGET } from '@/app/api/fhir/Patient/[id]/route';
import { GET as fhirObservationGET } from '@/app/api/fhir/Observation/route';
import { GET as fhirMedicationRequestGET } from '@/app/api/fhir/MedicationRequest/route';
import { GET as fhirEncounterGET } from '@/app/api/fhir/Encounter/route';
import { GET as fhirReferralBundleGET } from '@/app/api/fhir/Bundle/referral/[id]/route';

const mockGetAuth = getAuthPayload as jest.MockedFunction<typeof getAuthPayload>;
const mockLogPhiRead = logPhiRead as jest.MockedFunction<typeof logPhiRead>;

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const HOSP_A = 'hosp-a1';
const HOSP_B = 'hosp-b1';
const PATIENT_ID = 'patient-audit-1';

function authFor(orgId: string | undefined, hospitalId: string | undefined, role: AuthPayload['role'] = 'doctor'): AuthPayload {
  return { sub: 'user-doc', username: 'doc1', role, name: 'Dr Test', orgId, hospitalId };
}

function getRequest(url: string): NextRequest {
  return new Request(url, { method: 'GET' }) as unknown as NextRequest;
}

/**
 * `logPhiRead` is invoked as `import(...).then(({ logPhiRead }) =>
 * logPhiRead(...))` — fire-and-forget, deliberately not awaited on the
 * response path. The dynamic import resolves on a later microtask than the
 * `await routeHandler(...)` above it, so tests need to yield the event loop
 * once before asserting the mock was called.
 */
async function flushPhiReadAudit(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function seedPatient(): Promise<PatientDoc> {
  const doc = {
    _id: PATIENT_ID,
    type: 'patient',
    firstName: 'Nyandeng', surname: 'Deng', gender: 'Female', dateOfBirth: '1990-01-01',
    hospitalNumber: 'HA-000001', registrationHospital: HOSP_A, orgId: ORG_A,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as unknown as PatientDoc & { _id: string };
  return putDoc(patientsDB(), doc);
}

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP_A, type: 'hospital', name: 'Hospital A', code: 'HA', orgId: ORG_A } as unknown as { _id: string });
  await putDoc(hospitalsDB(), { _id: HOSP_B, type: 'hospital', name: 'Hospital B', code: 'HB', orgId: ORG_B } as unknown as { _id: string });
  await seedPatient();
});

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
  jest.clearAllMocks();
});

describe('GET /api/patients/:id emits logPhiRead on a successful read', () => {
  test('records the patient read once, with the patient id', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await patientByIdGET(getRequest(`http://test/api/patients/${PATIENT_ID}`), { params: Promise.resolve({ id: PATIENT_ID }) });
    expect(res.status).toBe(200);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).toHaveBeenCalledTimes(1);
    expect(mockLogPhiRead).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-doc', role: 'doctor', orgId: ORG_A, route: '/api/patients/:id' }),
      'patient',
      expect.objectContaining({ patientId: PATIENT_ID }),
    );
  });

  test('does not audit a read denied by cross-org scope (403)', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_B, HOSP_B));
    const res = await patientByIdGET(getRequest(`http://test/api/patients/${PATIENT_ID}`), { params: Promise.resolve({ id: PATIENT_ID }) });
    expect(res.status).toBe(403);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).not.toHaveBeenCalled();
  });

  test('does not audit a read for a patient that does not exist (404)', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await patientByIdGET(getRequest('http://test/api/patients/does-not-exist'), { params: Promise.resolve({ id: 'does-not-exist' }) });
    expect(res.status).toBe(404);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).not.toHaveBeenCalled();
  });
});

describe('GET /api/fhir/Patient/:id emits logPhiRead', () => {
  test('records the read on success', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await fhirPatientGET(getRequest(`http://test/api/fhir/Patient/${PATIENT_ID}`), { params: Promise.resolve({ id: PATIENT_ID }) });
    expect(res.status).toBe(200);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/fhir/Patient/:id' }),
      'Patient',
      expect.objectContaining({ patientId: PATIENT_ID }),
    );
  });

  test('does not audit a cross-org denial', async () => {
    mockGetAuth.mockResolvedValue(authFor(ORG_B, HOSP_B));
    const res = await fhirPatientGET(getRequest(`http://test/api/fhir/Patient/${PATIENT_ID}`), { params: Promise.resolve({ id: PATIENT_ID }) });
    expect(res.status).toBe(403);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).not.toHaveBeenCalled();
  });
});

describe('GET /api/fhir/Observation emits logPhiRead', () => {
  test('records the read with the result count', async () => {
    const lab = {
      _id: 'lab-audit-1', type: 'lab_result', patientId: PATIENT_ID, patientName: 'Nyandeng Deng',
      hospitalNumber: 'HA-000001', testName: 'CBC', specimen: 'Blood', status: 'completed',
      result: '', unit: '', referenceRange: '', abnormal: false, critical: false,
      orderedBy: 'Dr Test', hospitalId: HOSP_A, orgId: ORG_A,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as unknown as LabResultDoc & { _id: string };
    await putDoc(labResultsDB(), lab);

    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await fhirObservationGET(getRequest(`http://test/api/fhir/Observation?patient=${PATIENT_ID}`));
    expect(res.status).toBe(200);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/fhir/Observation' }),
      'Observation',
      expect.objectContaining({ patientId: PATIENT_ID, resultCount: 1 }),
    );
  });
});

describe('GET /api/fhir/MedicationRequest emits logPhiRead', () => {
  test('records the read with the result count', async () => {
    const rx = {
      _id: 'rx-audit-1', type: 'prescription', patientId: PATIENT_ID, patientName: 'Nyandeng Deng',
      medication: 'Amoxicillin', dose: '500mg', route: 'oral', frequency: 'TID', duration: '5d',
      prescribedBy: 'Dr Test', status: 'pending', hospitalId: HOSP_A, orgId: ORG_A,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as unknown as PrescriptionDoc & { _id: string };
    await putDoc(prescriptionsDB(), rx);

    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await fhirMedicationRequestGET(getRequest(`http://test/api/fhir/MedicationRequest?patient=${PATIENT_ID}`));
    expect(res.status).toBe(200);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/fhir/MedicationRequest' }),
      'MedicationRequest',
      expect.objectContaining({ patientId: PATIENT_ID, resultCount: 1 }),
    );
  });
});

describe('GET /api/fhir/Encounter emits logPhiRead', () => {
  test('records the read with the result count', async () => {
    const record = {
      _id: 'record-audit-1', type: 'medical_record', patientId: PATIENT_ID,
      hospitalId: HOSP_A, orgId: ORG_A, visitDate: new Date().toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as unknown as MedicalRecordDoc & { _id: string };
    await putDoc(medicalRecordsDB(), record);

    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A));
    const res = await fhirEncounterGET(getRequest(`http://test/api/fhir/Encounter?patient=${PATIENT_ID}`));
    expect(res.status).toBe(200);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/fhir/Encounter' }),
      'Encounter',
      expect.objectContaining({ patientId: PATIENT_ID, resultCount: 1 }),
    );
  });
});

describe('GET /api/fhir/Bundle/referral/:id emits logPhiRead', () => {
  test('records the read with the patient id and referral id', async () => {
    const referral = await createReferral({
      patientId: PATIENT_ID, patientName: 'Nyandeng Deng',
      fromHospital: 'Hospital A', fromHospitalId: HOSP_A,
      toHospital: 'Hospital A', toHospitalId: HOSP_A,
      referralDate: new Date().toISOString().slice(0, 10), urgency: 'routine',
      reason: 'Specialist review', department: 'Cardiology', status: 'sent',
      referringDoctor: 'Dr Test', notes: '', orgId: ORG_A,
    } as unknown as Parameters<typeof createReferral>[0]);

    mockGetAuth.mockResolvedValue(authFor(ORG_A, HOSP_A, 'medical_superintendent'));
    const res = await fhirReferralBundleGET(getRequest(`http://test/api/fhir/Bundle/referral/${referral._id}`), { params: Promise.resolve({ id: referral._id }) });
    expect(res.status).toBe(200);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/fhir/Bundle/referral/:id' }),
      'Bundle',
      expect.objectContaining({ patientId: PATIENT_ID, resourceId: referral._id }),
    );
  });

  test('does not audit a cross-org denial', async () => {
    const referral = await createReferral({
      patientId: PATIENT_ID, patientName: 'Nyandeng Deng',
      fromHospital: 'Hospital A', fromHospitalId: HOSP_A,
      toHospital: 'Hospital A', toHospitalId: HOSP_A,
      referralDate: new Date().toISOString().slice(0, 10), urgency: 'routine',
      reason: 'Specialist review', department: 'Cardiology', status: 'sent',
      referringDoctor: 'Dr Test', notes: '', orgId: ORG_A,
    } as unknown as Parameters<typeof createReferral>[0]);

    mockGetAuth.mockResolvedValue(authFor(ORG_B, HOSP_B, 'medical_superintendent'));
    const res = await fhirReferralBundleGET(getRequest(`http://test/api/fhir/Bundle/referral/${referral._id}`), { params: Promise.resolve({ id: referral._id }) });
    expect(res.status).toBe(403);
    await flushPhiReadAudit();
    expect(mockLogPhiRead).not.toHaveBeenCalled();
  });
});
