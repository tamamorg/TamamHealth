jest.mock('uuid', () => ({ v4: () => 'episode' }));
jest.mock('@/lib/db', () => ({
  ...require('../helpers/test-db').createDBMock(),
  specialtyCareDB: () => require('@/lib/db').getDB('specialty'),
  encountersDB: () => require('@/lib/db').getDB('encounters'),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn() }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
import { hospitalsDB, patientsDB } from '@/lib/db';
import { teardownTestDBs } from '../helpers/test-db';
import { createSpecialtyEpisode } from '@/modules/specialty-care/services/specialty-care-service';

const input = { pathway: 'dental' as const, patientId: 'patient', patientName: 'Wrong typed name', hospitalId: 'facility', orgId: 'org', scope: { role: 'doctor' as const, orgId: 'org', hospitalId: 'facility' } };
beforeEach(async () => { await hospitalsDB().put({ _id: 'specialty-pathway:facility:dental', type: 'specialty_pathway_config', hospitalId: 'facility', orgId: 'org', status: 'pilot' }); });
afterEach(teardownTestDBs);
test('rejects unknown patients and patients outside the authorized scope', async () => {
  await expect(createSpecialtyEpisode(input)).rejects.toThrow('registered patient');
  await patientsDB().put({ _id: 'patient', type: 'patient', firstName: 'Other', surname: 'Patient', orgId: 'another-org', registrationHospital: 'facility' });
  await expect(createSpecialtyEpisode(input)).rejects.toThrow('registered patient');
});
test('uses the registered identity rather than caller-supplied patient name', async () => {
  await patientsDB().put({ _id: 'patient', type: 'patient', firstName: 'Correct', surname: 'Patient', orgId: 'org', registrationHospital: 'facility' });
  expect((await createSpecialtyEpisode(input)).patientName).toBe('Correct Patient');
});
