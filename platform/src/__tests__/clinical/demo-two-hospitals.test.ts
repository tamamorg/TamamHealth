/**
 * The demo is two hospitals, one organization, one account per job. Runs the
 * REAL seedDatabase() against in-memory PouchDB.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/modules/identity/client', () => ({ generateTempPassword: () => 'x', hashPassword: async () => 'hash' }));

import { createDBMock, teardownTestDBs } from '../helpers/test-db';
import { DEMO_USER_PROFILES } from '@/lib/seed-demo-roster';

jest.setTimeout(120000);

type Doc = Record<string, unknown>;
const HOSPITALS = ['hosp-001', 'hosp-002'];

const saved = process.env.NEXT_PUBLIC_SYNC_ENABLED;
const corpus: Record<string, Doc[]> = {};

beforeAll(async () => {
  process.env.NEXT_PUBLIC_SYNC_ENABLED = 'false';
  process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
  const { seedDatabase } = await import('@/lib/db-seed');
  await seedDatabase();
  const dbs = createDBMock() as unknown as Record<string, () => PouchDB.Database>;
  for (const [name, open] of Object.entries(dbs)) {
    if (!name.endsWith('DB') || typeof open !== 'function') continue;
    const rows = await open().allDocs({ include_docs: true }).then(r => r.rows, () => []);
    corpus[name] = rows.map(r => r.doc as unknown as Doc).filter(d => !String(d._id).startsWith('_design'));
  }
});

afterAll(async () => {
  await teardownTestDBs();
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SYNC_ENABLED;
  else process.env.NEXT_PUBLIC_SYNC_ENABLED = saved;
});

test('two hospitals in one organization', () => {
  expect(corpus.hospitalsDB.map(h => h._id).sort()).toEqual(HOSPITALS);
  expect(corpus.organizationsDB).toHaveLength(1);
});

test('nothing in the corpus names any other facility', () => {
  const others = /hosp-00[3-9]|hosp-mercy|phcu-|phcc-|org-mercy|Mercy General|Malakal Teaching|Bentiu State/;
  const leaks = Object.entries(corpus).flatMap(([db, docs]) =>
    docs.filter(d => others.test(JSON.stringify(d))).map(d => `${db}/${d._id}`));
  expect(leaks).toEqual([]);
});

test('no two patients share a hospital number, phone or name', () => {
  for (const field of ['hospitalNumber', 'phone']) {
    const values = corpus.patientsDB.map(p => p[field]).filter(Boolean);
    expect(new Set(values).size).toBe(values.length);
  }
  const names = corpus.patientsDB.map(p => [p.firstName, p.middleName, p.surname].filter(Boolean).join(' '));
  expect(new Set(names).size).toBe(names.length);
});

test('a number shows where the patient registered, on every document that quotes it', () => {
  const patients = new Map(corpus.patientsDB.map(p => [p._id, p]));
  for (const patient of corpus.patientsDB) {
    const prefix = patient.registrationHospital === 'hosp-002' ? 'WSH-' : 'JTH-';
    expect(`${patient._id} ${String(patient.hospitalNumber).slice(0, 4)}`).toBe(`${patient._id} ${prefix}`);
  }
  const stale = Object.entries(corpus).flatMap(([db, docs]) => docs
    .filter(d => d.hospitalNumber && patients.has(d.patientId) && d.hospitalNumber !== patients.get(d.patientId)?.hospitalNumber)
    .map(d => `${db}/${d._id}`));
  expect(stale).toEqual([]);
});

test('each hospital has one of each job, and can result, dispense and bill', () => {
  for (const hospitalId of HOSPITALS) {
    const staff = DEMO_USER_PROFILES.filter(p => p.hospitalId === hospitalId);
    const roles = staff.map(p => p.role);
    for (const role of ['doctor', 'nurse', 'lab_tech', 'pharmacist', 'front_desk']) expect(roles).toContain(role);
    const extras = roles.filter((role, i) => roles.indexOf(role) !== i);
    // Juba keeps a second doctor for hand-overs inside the hospital.
    expect(extras).toEqual(hospitalId === 'hosp-001' ? ['doctor'] : []);
    expect(corpus.pharmacyInventoryDB.some(i => i.hospitalId === hospitalId)).toBe(true);
    expect(corpus.feeScheduleDB.some(f => f.facilityId === hospitalId)).toBe(true);
  }
});

test('a referral goes to the other hospital', () => {
  expect(corpus.referralsDB.filter(r => r.fromHospitalId === r.toHospitalId).map(r => r._id)).toEqual([]);
});

test('every seeded transfer crosses between the hospitals, both ways', () => {
  const routes = corpus.patientTransfersDB.map(t => `${t.hospitalId}>${t.toHospitalId}`).sort();
  expect(routes).toEqual(['hosp-001>hosp-002', 'hosp-002>hosp-001']);
  const patients = new Map(corpus.patientsDB.map(p => [p._id, p]));
  for (const t of corpus.patientTransfersDB) {
    const patient = patients.get(t.patientId);
    expect(patient?.assignedDoctor).toBe(t.requestedById);
    // Really at the sending hospital, or the request proves nothing.
    expect([patient?.registrationHospital, patient?.lastVisitHospital]).toEqual([t.hospitalId, t.hospitalId]);
  }
});
