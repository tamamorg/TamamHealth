/**
 * updatePatient, archivePatient and updateTriage take a REQUIRED DataScope. An
 * id that is on the device is not authorization to write it: another org's
 * scope is refused exactly like a missing record, and nothing is mutated.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { triageDB, patientsDB } from '@/lib/db';
import { updatePatient, archivePatient } from '@/lib/services/patient-service';
import { updateTriage } from '@/lib/services/triage-service';
import type { DataScope } from '@/lib/services/data-scope';

type Role = DataScope['role'];
const A: DataScope = { orgId: 'org-a', hospitalId: 'h-a', role: 'clinician' as Role };
const B: DataScope = { orgId: 'org-b', hospitalId: 'h-b', role: 'clinician' as Role };
const NO_ORG: DataScope = { role: 'clinician' as Role };

beforeEach(async () => {
  await putDoc(patientsDB(), {
    _id: 'p1', type: 'patient', orgId: 'org-a', registrationHospital: 'h-a', hospitalId: 'h-a',
    firstName: 'Ada', surname: 'Lual', dateOfBirth: '1990-01-01', isActive: true,
  } as never);
  await putDoc(triageDB(), {
    _id: 'tri-1', type: 'triage', orgId: 'org-a', facilityId: 'h-a', hospitalId: 'h-a', patientId: 'p1',
    status: 'pending', priority: 'GREEN', triagedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  } as never);
});
afterEach(async () => { await teardownTestDBs(); });

describe('updatePatient / archivePatient', () => {
  test('another org (or a scope with no org) cannot update the patient', async () => {
    expect(await updatePatient('p1', { phone: '+211911111111' }, B)).toBeNull();
    expect(await updatePatient('p1', { phone: '+211911111111' }, NO_ORG)).toBeNull();
    expect((await patientsDB().get('p1') as { phone?: string }).phone).toBeUndefined();
  });

  test('the owning org can update the patient', async () => {
    const updated = await updatePatient('p1', { phone: '+211911111111' }, A);
    expect(updated?.phone).toBe('+211911111111');
  });

  test('another org cannot archive the patient', async () => {
    expect(await archivePatient('p1', B)).toBeNull();
    expect((await patientsDB().get('p1') as { isActive?: boolean }).isActive).toBe(true);
  });

  test('the owning org can archive the patient', async () => {
    expect((await archivePatient('p1', A, 'tester'))?.isActive).toBe(false);
  });
});

describe('updateTriage', () => {
  test('another org cannot update the triage and nothing is written', async () => {
    await expect(updateTriage('tri-1', { assignedRoom: 'Bay 9' }, B)).rejects.toMatchObject({ name: 'not_found' });
    await expect(updateTriage('tri-1', { assignedRoom: 'Bay 9' }, NO_ORG)).rejects.toMatchObject({ name: 'not_found' });
    expect((await triageDB().get('tri-1') as { assignedRoom?: string }).assignedRoom).toBeUndefined();
  });

  test('the owning org can update the triage', async () => {
    const updated = await updateTriage('tri-1', { assignedRoom: 'Bay 2' }, A);
    expect(updated.assignedRoom).toBe('Bay 2');
  });
});
