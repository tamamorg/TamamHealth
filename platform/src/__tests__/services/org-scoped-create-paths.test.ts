/**
 * Every create path whose database is orgScoped must stamp an orgId or refuse:
 * an org-less document never replicates and is hidden by filterByScope.
 * The org is resolved from the explicit value, the linked patient, then the
 * facility - never guessed.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-ocuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB } from '@/lib/db';
import { resolveDocOrgId } from '@/lib/services/register-org';
import { createFollowUp } from '@/lib/services/follow-up-service';
import { createHandoff } from '@/lib/services/handoff-service';
import { createAssessment } from '@/lib/services/facility-assessment-service';
import { addUnit } from '@/lib/services/blood-bank-service';
import { createSchedule } from '@/lib/services/staff-scheduling-service';
import { createPlan } from '@/lib/services/emergency-preparedness-service';
import { createAlert } from '@/lib/services/surveillance-service';
import { createAnnouncement } from '@/modules/communication/services/announcement-service';
import { ValidationError } from '@/lib/validation';

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: 'hosp-1', type: 'hospital', name: 'H', orgId: 'org-1' } as never);
  await putDoc(patientsDB(), { _id: 'pat-1', type: 'patient', orgId: 'org-2' } as never);
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('resolveDocOrgId', () => {
  test('explicit wins, then patient, then facility, then fallback', async () => {
    expect(await resolveDocOrgId({ orgId: 'org-x', patientId: 'pat-1', facilityId: 'hosp-1' }, 'x')).toBe('org-x');
    expect(await resolveDocOrgId({ patientId: 'pat-1', facilityId: 'hosp-1' }, 'x')).toBe('org-2');
    expect(await resolveDocOrgId({ facilityId: 'hosp-1' }, 'x')).toBe('org-1');
    expect(await resolveDocOrgId({ facilityId: 'nowhere' }, 'x', 'org-fb')).toBe('org-fb');
  });
  test('refuses when nothing resolves', async () => {
    await expect(resolveDocOrgId({ facilityId: 'nowhere', patientId: 'nobody' }, 'x')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('create paths', () => {
  const base = { facilityId: 'hosp-nowhere' };
  test('a patient-linked follow-up inherits the patient org', async () => {
    const doc = await createFollowUp({ patientId: 'pat-1', condition: 'TB', assignedWorker: 'w' } as never);
    expect(doc.orgId).toBe('org-2');
  });
  test('facility-linked records inherit the facility org', async () => {
    expect((await createHandoff({ facilityId: 'hosp-1', patients: [], shift: 'day', shiftDate: '2026-10-10' } as never)).orgId).toBe('org-1');
    expect((await createAssessment({ facilityId: 'hosp-1' } as never)).orgId).toBe('org-1');
    expect((await addUnit({ facilityId: 'hosp-1', facilityName: 'H', bloodGroup: 'O+', component: 'whole', volume: 450 } as never)).orgId).toBe('org-1');
    expect((await createSchedule({ facilityId: 'hosp-1', userId: 'u', shiftType: 'day', shiftDate: '2026-10-10' } as never)).orgId).toBe('org-1');
    expect((await createPlan({ facilityId: 'hosp-1', facilityName: 'H', planName: 'p', emergencyType: 'flood', severity: 'high' } as never)).orgId).toBe('org-1');
    expect((await createAlert({ hospitalId: 'hosp-1', disease: 'Cholera' } as never)).orgId).toBe('org-1');
  });
  test.each([
    ['follow-up', () => createFollowUp({ patientId: 'nobody', condition: 'c', assignedWorker: 'w' } as never)],
    ['handoff', () => createHandoff({ ...base, patients: [], shift: 'day', shiftDate: 'd' } as never)],
    ['assessment', () => createAssessment({ ...base } as never)],
    ['blood unit', () => addUnit({ ...base, facilityName: 'H' } as never)],
    ['schedule', () => createSchedule({ ...base, userId: 'u' } as never)],
    ['plan', () => createPlan({ ...base, facilityName: 'H' } as never)],
    ['alert', () => createAlert({ disease: 'x' } as never)],
    ['announcement', () => createAnnouncement({ title: 't', body: 'b', audience: 'organization', priority: 'normal' } as never)],
  ])('%s with no resolvable org is refused', async (_n, run) => {
    await expect(run()).rejects.toBeInstanceOf(ValidationError);
  });
});
