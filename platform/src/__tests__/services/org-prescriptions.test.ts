/**
 * The note's medication review reads a patient's prescriptions across the
 * organization. Removing the hospital from a facility-bound scope fails closed,
 * so that review showed "no active medications" for every doctor.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { createDBMock, teardownTestDBs } from '../helpers/test-db';
import { getOrgPrescriptionsByPatient, getPrescriptionsByPatient } from '@/lib/services/prescription-service';
import type { DataScope } from '@/lib/services/data-scope';

jest.setTimeout(30000);

const doctor: DataScope = { orgId: 'org-a', hospitalId: 'hosp-1', role: 'doctor' };

beforeEach(async () => {
  const db = (createDBMock() as unknown as { prescriptionsDB: () => PouchDB.Database }).prescriptionsDB();
  for (const [id, orgId, hospitalId] of [['rx-1', 'org-a', 'hosp-1'], ['rx-2', 'org-a', 'hosp-2'], ['rx-3', 'org-b', 'hosp-9']]) {
    await db.put({ _id: id, type: 'prescription', patientId: 'pat-1', medication: 'Metformin', status: 'pending', orgId, hospitalId } as never);
  }
});

afterEach(async () => { await teardownTestDBs(); });

test('a doctor sees the organization, and no other tenant', async () => {
  const rows = await getOrgPrescriptionsByPatient('pat-1', doctor);
  expect(rows.map(r => r._id).sort()).toEqual(['rx-1', 'rx-2']);
});

test('the scope with its hospital removed is what used to return nothing', async () => {
  expect(await getPrescriptionsByPatient('pat-1', { ...doctor, hospitalId: undefined })).toEqual([]);
});

test('a scope with no organization fails closed', async () => {
  expect(await getOrgPrescriptionsByPatient('pat-1', { role: 'doctor' })).toEqual([]);
});
