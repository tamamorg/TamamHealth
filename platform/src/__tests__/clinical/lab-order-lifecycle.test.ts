/**
 * Issue #85 lab acceptance criteria not already covered by
 * lab-bench-status.test.ts (queue pill moves) or lab-critical-flag.test.ts
 * (pure threshold matching):
 *
 *   - Test order creation stamps a barcode/ID (accessionNumber) and infers
 *     the order's org from its facility.
 *   - The granular order lifecycle (`advanceLabOrder`) refuses an illegal
 *     hop and stamps `completedAt` exactly once, at the moment a result
 *     first lands.
 *   - Integration: a result attaches to the RIGHT patient's central record
 *     (`getLabResultsByPatient`) and never leaks into another patient's
 *     chart or across tenant scope.
 *   - Critical value flags actually reach the ordering clinician: crossing
 *     into a critical, resulted state raises a task on their list — the
 *     "publishing to patient/doctor" half of results entry that has no
 *     other service-level test.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, usersDB } from '@/lib/db';
import {
  createLabResult,
  getLabResultById,
  getLabResultsByPatient,
  advanceLabOrder,
  updateLabResult,
} from '@/lib/services/lab-service';
import { getTasks } from '@/lib/services/clinician-task-service';
import type { LabResultDoc } from '@/lib/db-types';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. James Wani Igga' };

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

function baseOrder(overrides: Partial<LabResultDoc> = {}) {
  return {
    patientId: 'pat-00001',
    patientName: 'Nyakuma Deng',
    hospitalNumber: 'JTH-000001',
    testName: 'Full Blood Count',
    specimen: 'Blood',
    status: 'pending' as const,
    result: '',
    unit: '',
    referenceRange: '',
    abnormal: false,
    critical: false,
    orderedBy: DOCTOR.name,
    orderedAt: new Date().toISOString(),
    completedAt: '',
    hospitalId: HOSP,
    ...overrides,
  };
}

describe('createLabResult — order creation', () => {
  it('stamps a unique accession number (the barcode/ID) when the caller supplies none', async () => {
    const order = await createLabResult(baseOrder());
    expect(order.accessionNumber).toMatch(/^ACC-/);
  });

  it('keeps a caller-supplied accession number rather than overwriting it', async () => {
    const order = await createLabResult(baseOrder({ accessionNumber: 'ACC-CUSTOM-001' }));
    expect(order.accessionNumber).toBe('ACC-CUSTOM-001');
  });

  it('infers the order org from its facility when not supplied', async () => {
    await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
    const order = await createLabResult(baseOrder());
    expect(order.orgId).toBe(ORG);
  });

  it('supports a test panel as a set of individual orders sharing patient and encounter context', async () => {
    const cbc = await createLabResult(baseOrder({ testName: 'Full Blood Count', encounterId: 'enc-1' }));
    const chem = await createLabResult(baseOrder({ testName: 'Basic Metabolic Panel', encounterId: 'enc-1' }));
    // Each panel member is its own trackable order (its own id, its own
    // accession) even though both share the parent visit.
    expect(cbc._id).not.toBe(chem._id);
    expect(cbc.accessionNumber).toMatch(/^ACC-/);
    expect(chem.accessionNumber).toMatch(/^ACC-/);
    expect(cbc.encounterId).toBe(chem.encounterId);
  });
});

describe('advanceLabOrder — granular lifecycle guard', () => {
  it('refuses an illegal hop instead of silently accepting it', async () => {
    const order = await createLabResult(baseOrder({ orderStatus: 'ordered' }));
    // Cannot jump straight from "ordered" to "resulted" — specimen collection
    // and receipt at the lab are mandatory intermediate stages.
    await expect(advanceLabOrder(order._id, 'resulted')).rejects.toThrow(/Illegal lab order transition/);
    const stored = await getLabResultById(order._id);
    expect(stored?.orderStatus).toBe('ordered'); // unchanged
  });

  it('stamps completedAt exactly once, the moment a result first lands', async () => {
    const order = await createLabResult(baseOrder({ orderStatus: 'in_process' }));
    expect(order.completedAt).toBe('');

    const resulted = await advanceLabOrder(order._id, 'resulted', { result: 'Hb 12.0 g/dL' } as never);
    expect(resulted?.status).toBe('completed');
    expect(resulted?.completedAt).toBeTruthy();
    const firstCompletedAt = resulted!.completedAt;

    // Reviewing the result afterwards must not restamp completion time.
    const reviewed = await advanceLabOrder(order._id, 'reviewed_by_clinician', { reviewedBy: DOCTOR.name } as never);
    expect(reviewed?.completedAt).toBe(firstCompletedAt);
  });
});

describe('getLabResultsByPatient — attaches to the right patient\'s central record', () => {
  it('a newly filed result is immediately visible on its own patient\'s chart', async () => {
    const order = await createLabResult(baseOrder({ patientId: 'pat-00001' }));
    const forPatient = await getLabResultsByPatient('pat-00001');
    expect(forPatient.map(r => r._id)).toContain(order._id);
  });

  it('never leaks a result onto a different patient\'s chart', async () => {
    const orderA = await createLabResult(baseOrder({ patientId: 'pat-00001', patientName: 'Nyakuma Deng' }));
    const orderB = await createLabResult(baseOrder({ patientId: 'pat-00002', patientName: 'Achol Deng' }));

    const forA = await getLabResultsByPatient('pat-00001');
    const forB = await getLabResultsByPatient('pat-00002');

    expect(forA.map(r => r._id)).toEqual([orderA._id]);
    expect(forB.map(r => r._id)).toEqual([orderB._id]);
  });

  it('respects tenant scope on top of the patient filter', async () => {
    const order = await createLabResult(baseOrder({ patientId: 'pat-00001', orgId: 'org-a', hospitalId: 'hosp-a' }));
    const sameOrg = await getLabResultsByPatient('pat-00001', { role: 'doctor', orgId: 'org-a', hospitalId: 'hosp-a' });
    const otherOrg = await getLabResultsByPatient('pat-00001', { role: 'doctor', orgId: 'org-b', hospitalId: 'hosp-b' });
    expect(sameOrg.map(r => r._id)).toEqual([order._id]);
    expect(otherOrg).toEqual([]);
  });
});

describe('updateLabResult — critical results reach the ordering clinician', () => {
  async function seedDoctor() {
    await putDoc(usersDB(), {
      _id: DOCTOR._id, type: 'user', username: 'dr.wani', name: DOCTOR.name,
      role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true,
    } as never);
  }

  it('raises a task on the ordering clinician\'s list when a result becomes critical', async () => {
    await seedDoctor();
    const order = await createLabResult(baseOrder({ orderStatus: 'in_process' }));

    await updateLabResult(order._id, {
      orderStatus: 'resulted', status: 'completed', result: 'K+ 6.8 mmol/L',
      critical: true, completedAt: new Date().toISOString(),
    } as never);

    const tasks = await getTasks(DOCTOR._id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toMatch(/Critical result/i);
    expect(tasks[0].patientId).toBe('pat-00001');
  });

  it('does not raise a second task when a critical resulted order is merely re-saved', async () => {
    await seedDoctor();
    const order = await createLabResult(baseOrder({ orderStatus: 'in_process' }));
    const resulted = await updateLabResult(order._id, {
      orderStatus: 'resulted', status: 'completed', result: 'K+ 6.8 mmol/L',
      critical: true, completedAt: new Date().toISOString(),
    } as never);
    expect(await getTasks(DOCTOR._id)).toHaveLength(1);

    // Re-saving the same already-critical, already-resulted order (e.g. a
    // clinical-notes edit touching an unrelated field) must not re-notify.
    await updateLabResult(resulted!._id, { clinicalNotes: 'Repeat sample confirms.' } as never);
    expect(await getTasks(DOCTOR._id)).toHaveLength(1);
  });

  it('does not raise a task for a non-critical result', async () => {
    await seedDoctor();
    const order = await createLabResult(baseOrder({ orderStatus: 'in_process' }));
    await updateLabResult(order._id, {
      orderStatus: 'resulted', status: 'completed', result: 'K+ 4.1 mmol/L',
      critical: false, completedAt: new Date().toISOString(),
    } as never);
    expect(await getTasks(DOCTOR._id)).toHaveLength(0);
  });
});
