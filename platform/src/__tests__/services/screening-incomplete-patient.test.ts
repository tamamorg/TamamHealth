/**
 * Chart list writes (screenings, allergies, alerts, directives) go through
 * mutatePatient, which re-validated the WHOLE patient. A patient registered
 * before next of kin and state became required — or created by an API or
 * another system — could then never have a screening recorded: the write
 * failed with "State is required, Next-of-kin name is required…".
 *
 * Runs against the real service layer on pouchdb-adapter-memory.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { addScreening, completeScreening, declineScreening } from '@/lib/services/screening-service';
import { mutatePatient } from '@/lib/services/patient-service';

const incomplete = {
  _id: 'pat-incomplete', type: 'patient', orgId: 'org-a', firstName: 'Portal', surname: 'Check',
  gender: 'Female', dateOfBirth: '1990-01-01', hospitalNumber: 'E2E-1', registrationHospital: 'hosp-001',
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
};

beforeAll(async () => { await putDoc(patientsDB(), { ...incomplete }); });
afterAll(async () => { await teardownTestDBs(); });

test('a screening can be added, completed and declined on a patient with gaps in their registration', async () => {
  const added = await addScreening('pat-incomplete', { type: 'Cervical cancer (VIA)', dueDate: '2026-10-16' });
  expect(added).toHaveLength(1);
  const id = added![0].id;
  expect((await completeScreening('pat-incomplete', id, '2026-10-16'))![0]).toMatchObject({ status: 'completed', lastDoneDate: '2026-10-16' });

  const second = await addScreening('pat-incomplete', { type: 'HIV test' });
  const hiv = second!.find(s => s.type === 'HIV test')!;
  expect((await declineScreening('pat-incomplete', hiv.id, 'Tested elsewhere'))!.find(s => s.id === hiv.id)).toMatchObject({ status: 'declined', notes: 'Tested elsewhere' });
});

test('a write that itself breaks a field is still refused', async () => {
  await expect(mutatePatient('pat-incomplete', () => ({ firstName: '' }))).rejects.toThrow(/first name/i);
});
