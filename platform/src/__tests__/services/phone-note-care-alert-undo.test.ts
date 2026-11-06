/**
 * Undo writes for chart records: a closed phone note can be reopened, and a care
 * alert can be edited while active and reopened once resolved.
 */
jest.mock('uuid', () => { let n = 0; return { v4: () => `${String(++n).padStart(8, '0')}-undo-uuid` }; });
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { createPhoneNote, closePhoneNote, reopenPhoneNote, respondToPhoneNote } from '@/lib/services/phone-note-service';
import { addCareAlert, resolveCareAlert, updateCareAlert, reopenCareAlert, getActiveCareAlerts, getCareAlerts } from '@/lib/services/care-alert-service';

const SCOPE = { role: 'super_admin' } as const;

beforeEach(async () => {
  await putDoc(patientsDB(), {
    _id: 'pat-undo', type: 'patient', orgId: 'org-a', firstName: 'Undo', surname: 'Case', gender: 'Female',
    dateOfBirth: '1990-01-01', hospitalNumber: 'U-1', registrationHospital: 'hosp-001',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  });
});
afterEach(async () => { await teardownTestDBs(); });

describe('reopenPhoneNote', () => {
  const input = { patientId: 'pat-undo', subject: 'Refill', message: 'Needs a refill', orgId: 'org-a', hospitalId: 'hosp-1' };

  test('closed → open', async () => {
    const note = await createPhoneNote(input);
    await closePhoneNote(note._id);
    const reopened = await reopenPhoneNote(note._id, { userId: 'u1', userName: 'Dr. Wani' });
    expect(reopened?.status).toBe('open');
  });

  test('only a closed note reopens', async () => {
    const note = await createPhoneNote(input);
    await expect(reopenPhoneNote(note._id)).rejects.toThrow(/Only a closed note/);
    const answered = await respondToPhoneNote(note._id, 'Collect it', { userName: 'Dr. Wani', userRole: 'doctor' });
    expect(answered?.status).toBe('responded');
    await expect(reopenPhoneNote(note._id)).rejects.toThrow(/Only a closed note/);
  });

  test('a missing note returns null', async () => {
    expect(await reopenPhoneNote('phnote-missing')).toBeNull();
  });
});

describe('care alert update / reopen', () => {
  async function newAlert() {
    const list = await addCareAlert('pat-undo', SCOPE, { category: 'safety', message: 'Fall risk', priority: 'normal' });
    return list![0].id;
  }

  test('edits text, severity and category of an active alert', async () => {
    const id = await newAlert();
    const list = await updateCareAlert('pat-undo', SCOPE, id, { message: ' High fall risk ', priority: 'high', category: 'clinical_risk' }, { id: 'u1', name: 'Dr. Wani' });
    expect(list![0]).toMatchObject({ message: 'High fall risk', priority: 'high', category: 'clinical_risk', status: 'active', updatedByName: 'Dr. Wani' });
    expect(list![0].updatedAt).toBeTruthy();
  });

  test('refuses an empty message and a resolved alert', async () => {
    const id = await newAlert();
    await expect(updateCareAlert('pat-undo', SCOPE, id, { message: '  ' })).rejects.toThrow(/message/i);
    await resolveCareAlert('pat-undo', SCOPE, id, 'No longer at risk');
    await expect(updateCareAlert('pat-undo', SCOPE, id, { message: 'x' })).rejects.toThrow(/Reopen it first/);
  });

  test('reopen puts a resolved alert back on the chart and clears the reason', async () => {
    const id = await newAlert();
    await resolveCareAlert('pat-undo', SCOPE, id, 'Resolved by mistake');
    expect(await getActiveCareAlerts('pat-undo', SCOPE)).toHaveLength(0);
    const list = await reopenCareAlert('pat-undo', SCOPE, id, { id: 'u1', name: 'Dr. Wani' });
    expect(list![0].status).toBe('active');
    expect(list![0].resolutionReason).toBeUndefined();
    expect(await getActiveCareAlerts('pat-undo', SCOPE)).toHaveLength(1);
    expect(await getCareAlerts('pat-undo', SCOPE)).toHaveLength(1);
  });

  test('an active alert cannot be reopened; an unknown id is a no-op', async () => {
    const id = await newAlert();
    await expect(reopenCareAlert('pat-undo', SCOPE, id)).rejects.toThrow(/already active/);
    expect(await reopenCareAlert('pat-undo', SCOPE, 'nope')).toBeNull();
    expect(await updateCareAlert('pat-undo', SCOPE, 'nope', { message: 'x' })).toBeNull();
  });
});
