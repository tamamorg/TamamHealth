/**
 * A patient moved between the demo's two hospitals, both ways.
 *
 * A hospital sees a patient by `registrationHospital` or `lastVisitHospital`, so
 * a transfer that changed only the doctor left the new doctor owning a chart
 * they could not open. Runs the real services and the real scope filter.
 */

let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { createDBMock, teardownTestDBs } from '../helpers/test-db';
import { acceptTransfer, applyDueTransfers, getTransferById, buildTransferSummary, createTransferRequest, DEFAULT_TRANSFER_CHECKLIST, rejectTransfer } from '@/lib/services/patient-transfer-service';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import type { PatientDoc } from '@/lib/db-types';

jest.setTimeout(30000);

const ORG = 'org-moh-ss';
const JUBA = { facilityId: 'hosp-001', facilityName: 'Juba Teaching Hospital', orgId: ORG };
const WAU = { facilityId: 'hosp-002', facilityName: 'Wau State Hospital', orgId: ORG };
const scopeAt = (hospitalId: string): DataScope => ({ orgId: ORG, hospitalId, role: 'doctor' });
const juba = { id: 'user-dr.wani', name: 'Dr. James Wani Igga', role: 'doctor' as const };
const wau = { id: 'user-dr.wau', name: 'Dr. Mary Akuol Deng', role: 'doctor' as const };

const patientsDB = () => (createDBMock() as unknown as { patientsDB: () => PouchDB.Database }).patientsDB();
const readPatient = async (id: string) => await patientsDB().get(id) as unknown as PatientDoc;

async function seedPatient(id: string, hospital: string, owner: string) {
  await patientsDB().put({
    _id: id, type: 'patient', firstName: 'Akech', surname: 'Deng', gender: 'Female', dateOfBirth: '1990-01-01',
    phone: '+211912000000', hospitalNumber: `T-${id}`, registrationHospital: hospital, assignedDoctor: owner,
    isActive: true, orgId: ORG, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  } as never);
}

const request = (patientId: string, from: typeof JUBA, to: typeof JUBA, actor: typeof juba) => createTransferRequest({
  patientId, patientName: 'Akech Deng', hospitalNumber: `T-${patientId}`, transferType: 'permanent', urgency: 'urgent',
  reason: 'Continue care closer to home', from: { ...from, providerId: actor.id, providerName: actor.name }, to,
  hospitalId: from.facilityId, orgId: ORG, actor,
  checklist: DEFAULT_TRANSFER_CHECKLIST.map(item => ({ ...item, done: true })),
});

afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

test.each([
  ['Juba to Wau', JUBA, WAU, juba, wau],
  ['Wau to Juba', WAU, JUBA, wau, juba],
])('%s: the receiving hospital gets the request, then the patient', async (_label, from, to, sender, receiver) => {
  await seedPatient('pat-t1', from.facilityId, sender.id);

  const sent = await request('pat-t1', from, to, sender);
  expect(filterByScope([sent], scopeAt(to.facilityId))).toHaveLength(1);
  // Nothing moves until someone at the other end says yes.
  expect(filterByScope([await readPatient('pat-t1')], scopeAt(to.facilityId))).toHaveLength(0);

  const done = await acceptTransfer(sent._id, receiver);
  expect(done?.status).toBe('completed');

  const moved = await readPatient('pat-t1');
  expect(moved.assignedDoctor).toBe(receiver.id);
  expect(filterByScope([moved], scopeAt(to.facilityId))).toHaveLength(1);
  // The sending hospital keeps the record of a patient it treated.
  expect(filterByScope([moved], scopeAt(from.facilityId))).toHaveLength(1);
});

test('a refused transfer leaves the patient where they were', async () => {
  await seedPatient('pat-t2', 'hosp-001', juba.id);
  const sent = await request('pat-t2', JUBA, WAU, juba);
  await rejectTransfer(sent._id, wau, 'No bed');

  const patient = await readPatient('pat-t2');
  expect(patient.assignedDoctor).toBe(juba.id);
  expect(filterByScope([patient], scopeAt('hosp-002'))).toHaveLength(0);
});

test('a hand-over inside one hospital does not touch where the patient is', async () => {
  await seedPatient('pat-t3', 'hosp-001', juba.id);
  const achol = { id: 'user-dr.achol', name: 'Dr. Achol Mayen Deng', role: 'doctor' as const };
  const sent = await request('pat-t3', JUBA, { ...JUBA }, juba);
  await acceptTransfer(sent._id, achol);
  expect((await readPatient('pat-t3')).lastVisitHospital).toBeUndefined();
});

test('a device without the chart accepts, and the sweep finishes the move', async () => {
  await seedPatient('pat-t4', 'hosp-001', juba.id);
  const sent = await request('pat-t4', JUBA, WAU, juba);

  // What Wau's device holds: the addressed transfer, not Juba's patient.
  const chart = await patientsDB().get('pat-t4');
  await patientsDB().remove(chart);
  const accepted = await acceptTransfer(sent._id, wau);
  expect(accepted?.status).toBe('accepted');
  expect(accepted?.effectiveAt).toBeTruthy();

  // The server has the chart.
  await patientsDB().put({ ...chart, _rev: undefined } as never);
  const swept = await applyDueTransfers(new Date(Date.now() + 1000));
  expect(swept.completed).toContain(sent._id);
  const moved = await readPatient('pat-t4');
  expect(moved.assignedDoctor).toBe(wau.id);
  expect(moved.lastVisitHospital).toBe('hosp-002');
});

test('the summary carries chronic conditions, not just active ones', async () => {
  await seedPatient('pat-t5', 'hosp-001', juba.id);
  const problemsDB = (createDBMock() as unknown as { problemsDB: () => PouchDB.Database }).problemsDB();
  for (const [name, status] of [['Sickle cell disease', 'chronic'], ['Malaria', 'active'], ['Fracture', 'resolved']]) {
    await problemsDB.put({ _id: `prob-${name}`, type: 'problem', patientId: 'pat-t5', name, status } as never);
  }
  const { activeProblems } = await buildTransferSummary('pat-t5');
  expect(activeProblems?.slice().sort()).toEqual(['Malaria', 'Sickle cell disease']);
});

test('a temporary transfer that ends withdraws the other hospital\'s access', async () => {
  await seedPatient('pat-t6', 'hosp-001', juba.id);
  const sent = await createTransferRequest({
    patientId: 'pat-t6', patientName: 'Akech Deng', hospitalNumber: 'T-pat-t6', transferType: 'temporary', urgency: 'urgent',
    reason: 'Weekend cover', from: { ...JUBA, providerId: juba.id, providerName: juba.name }, to: WAU,
    hospitalId: 'hosp-001', orgId: ORG, actor: juba, expiresAt: new Date(Date.now() + 60_000).toISOString(),
    checklist: DEFAULT_TRANSFER_CHECKLIST.map(item => ({ ...item, done: true })),
  });
  await acceptTransfer(sent._id, wau);
  expect(filterByScope([await readPatient('pat-t6')], scopeAt('hosp-002'))).toHaveLength(1);

  const swept = await applyDueTransfers(new Date(Date.now() + 120_000));
  expect(swept.expired).toContain(sent._id);
  const back = await readPatient('pat-t6');
  expect(back.assignedDoctor).toBe(juba.id);
  expect(filterByScope([back], scopeAt('hosp-002'))).toHaveLength(0);
  expect((await getTransferById(sent._id))?.status).toBe('expired');
});

test('the snapshot carries the last vitals and results, which the receiver cannot read', async () => {
  await seedPatient('pat-t7', 'hosp-001', juba.id);
  const dbs = createDBMock() as unknown as Record<string, () => PouchDB.Database>;
  await dbs.medicalRecordsDB().put({
    _id: 'rec-1', type: 'medical_record', patientId: 'pat-t7', visitDate: '2026-10-01',
    vitalSigns: { systolic: 120, diastolic: 80, pulse: 88, temperature: 37.2 },
  } as never);
  await dbs.labResultsDB().put({
    _id: 'lab-1', type: 'lab_result', patientId: 'pat-t7', testName: 'Hemoglobin', result: '4.2', unit: 'g/dL',
    critical: true, status: 'completed', completedAt: '2026-10-02T08:00:00Z',
  } as never);
  const summary = await buildTransferSummary('pat-t7');
  expect(summary.latestVitals).toMatchObject({ systolic: 120, diastolic: 80, pulse: 88 });
  expect(summary.recentResults).toEqual([expect.objectContaining({ testName: 'Hemoglobin', result: '4.2', critical: true })]);
});
