/**
 * Pharmacy "Review & clear" failed with a raw "Internal server error" toast
 * whenever the server has no CouchDB (a standalone demo deployment,
 * `NEXT_PUBLIC_SYNC_ENABLED=false`): `advancePrescription`'s pharmacist-actor
 * check resolved the actor exclusively through `GET /api/users`, which 500s
 * with no users database to read.
 *
 * `getUserById` is now local-first in the browser — it reads the browser's
 * own PouchDB users store (a pull-replica of the shared users database,
 * seeded on first boot) before ever touching the network, and only falls
 * back to the API when the local replica does not have the document. These
 * pin that the pharmacy clearance workflow keeps working from the local
 * replica alone when the API is unreachable, that a genuine non-pharmacist
 * refusal is unaffected, and that a wholly-unresolvable actor gets a clear
 * domain error rather than a raw fetch failure.
 *
 * `isBrowserRuntime()` treats a Jest worker as the server (see
 * hospital-server-first-writes.test.ts), so these tests clear
 * JEST_WORKER_ID to become "the browser" and restore it after.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/api-fetch', () => ({ apiFetch: jest.fn() }));

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, hospitalsDB, patientsDB } from '@/lib/db';
import { apiFetch } from '@/lib/api-fetch';
import {
  createPrescription, advancePrescription, PrescriptionClearanceError,
} from '@/lib/services/prescription-service';
import type { PrescriptionDoc } from '@/lib/db-types';

const apiFetchMock = apiFetch as jest.Mock;
const WORKER_ID = process.env.JEST_WORKER_ID;

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani' };
const PHARMACIST = { _id: 'user-pharma-rose', name: 'Pharmacist Rose' };
const NURSE = { _id: 'user-nurse-stella', name: 'Nurse Stella' };
const PATIENT = { _id: 'pat-00001', name: 'Nyakuma Deng' };

async function seedWorld() {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(usersDB(), {
    _id: DOCTOR._id, type: 'user', username: 'dr.wani', name: DOCTOR.name,
    role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(usersDB(), {
    _id: PHARMACIST._id, type: 'user', username: 'pharma.rose', name: PHARMACIST.name,
    role: 'pharmacist', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(usersDB(), {
    _id: NURSE._id, type: 'user', username: 'nurse.stella', name: NURSE.name,
    role: 'nurse', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(patientsDB(), {
    _id: PATIENT._id, type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    registrationHospital: HOSP, orgId: ORG, state: 'Central Equatoria', county: 'Juba',
  } as never);
}

async function prescribe(): Promise<PrescriptionDoc> {
  const { prescription } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name,
    medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
    frequency: 'TDS', duration: '5 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, orgId: ORG, quantityToDispense: 15,
  } as never);
  return prescription;
}

async function catchClearanceError(promise: Promise<unknown>): Promise<PrescriptionClearanceError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof PrescriptionClearanceError) return err;
    throw err;
  }
  throw new Error('expected advancePrescription to reject');
}

beforeEach(() => {
  delete process.env.JEST_WORKER_ID;
  apiFetchMock.mockReset();
  // The exact repro: /api/users is unreachable (no CouchDB on a standalone
  // demo server, or simply offline). Any actor lookup that has to fall back
  // to the network must fail — proving the happy path never touches it.
  apiFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
});

afterEach(async () => {
  process.env.JEST_WORKER_ID = WORKER_ID;
  await teardownTestDBs();
});

describe('advancePrescription pharmacist check is local-first', () => {
  it('clears for dispensing using a pharmacist who exists only in the local users store, with the API unreachable', async () => {
    await seedWorld();
    const rx = await prescribe();

    const cleared = await advancePrescription(rx._id, 'cleared_for_dispensing', undefined, PHARMACIST._id);

    expect(cleared?.orderStatus).toBe('cleared_for_dispensing');
    expect(cleared?.status).toBe('pending');
    // Resolved from the local PouchDB replica — never fell back to the API.
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('still refuses a non-pharmacist actor, even though the API is unreachable', async () => {
    await seedWorld();
    const rx = await prescribe();

    const err = await catchClearanceError(
      advancePrescription(rx._id, 'cleared_for_dispensing', undefined, NURSE._id),
    );
    expect(err.code).toBe('NOT_A_PHARMACIST');
    expect(err.message).toMatch(/only a pharmacist/i);
  });

  it('refuses an inactive pharmacist the same way as an active non-pharmacist', async () => {
    await seedWorld();
    await putDoc(usersDB(), {
      _id: 'user-pharma-retired', type: 'user', username: 'pharma.retired', name: 'Retired Pharmacist',
      role: 'pharmacist', hospitalId: HOSP, orgId: ORG, isActive: false,
    } as never);
    const rx = await prescribe();

    const err = await catchClearanceError(
      advancePrescription(rx._id, 'cleared_for_dispensing', undefined, 'user-pharma-retired'),
    );
    expect(err.code).toBe('NOT_A_PHARMACIST');
  });

  it('reports ACTOR_NOT_FOUND — not a raw fetch error — when the actor cannot be resolved at all', async () => {
    await seedWorld();
    const rx = await prescribe();

    const err = await catchClearanceError(
      advancePrescription(rx._id, 'cleared_for_dispensing', undefined, 'user-does-not-exist'),
    );
    expect(err.code).toBe('ACTOR_NOT_FOUND');
    expect(err.message).not.toMatch(/fetch|500|Internal server error/i);
  });
});
