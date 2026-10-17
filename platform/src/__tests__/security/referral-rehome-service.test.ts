/**
 * @jest-environment node
 *
 * acceptReferral re-homes a patient only when the patient currently belongs to
 * the referring org, and updatePatient ignores orgId without the explicit
 * allowRehome opt-in.
 */
const store: Record<string, Record<string, Record<string, unknown>>> = {
  referrals: {}, hospitals: {}, patients: {}, records: {},
};
const fakeDb = (name: string) => ({
  get: async (id: string) => {
    const doc = store[name][id];
    if (!doc) throw Object.assign(new Error('missing'), { status: 404, name: 'not_found' });
    return { ...doc };
  },
  put: jest.fn(async (doc: Record<string, unknown>) => { store[name][doc._id as string] = { ...doc }; return { ok: true, rev: '2-x' }; }),
});
const dbs = { referrals: fakeDb('referrals'), hospitals: fakeDb('hospitals'), patients: fakeDb('patients'), records: fakeDb('records') };
jest.mock('@/lib/db', () => ({
  referralsDB: () => dbs.referrals, hospitalsDB: () => dbs.hospitals,
  patientsDB: () => dbs.patients, medicalRecordsDB: () => dbs.records,
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
jest.mock('@/lib/services/transfer-service', () => ({ assembleTransferPackage: jest.fn() }));
jest.mock('@/lib/validation', () => ({
  ...jest.requireActual('@/lib/validation'),
  validatePatientData: () => ({}),
}));

import { acceptReferral } from '@/lib/services/referral-service';
import { updatePatient, mutatePatient } from '@/lib/services/patient-service';
const SCOPE_A = { orgId: 'org-a', role: 'org_admin' } as import('@/lib/services/data-scope').DataScope;

beforeEach(() => {
  for (const k of Object.keys(store)) store[k] = {};
  store.hospitals['hosp-a'] = { _id: 'hosp-a', orgId: 'org-a' };
  store.hospitals['hosp-b'] = { _id: 'hosp-b', orgId: 'org-b' };
  store.patients['pat-1'] = { _id: 'pat-1', _rev: '1-a', type: 'patient', orgId: 'org-a', registrationHospital: 'hosp-a', firstName: 'A', surname: 'B' };
  store.referrals['ref-1'] = {
    _id: 'ref-1', _rev: '1-a', type: 'referral', patientId: 'pat-1', orgId: 'org-a', toOrgId: 'org-b',
    fromHospitalId: 'hosp-a', toHospitalId: 'hosp-b', toHospital: 'B', status: 'sent',
  };
});

describe('acceptReferral', () => {
  test('a legitimate cross-org referral accepted by the receiver re-homes the patient', async () => {
    const result = await acceptReferral('ref-1');
    expect(result?.status).toBe('seen');
    expect(store.patients['pat-1'].orgId).toBe('org-b');
    expect(store.patients['pat-1'].registrationHospital).toBe('hosp-b');
  });

  test('re-running acceptance after the patient moved is idempotent', async () => {
    await acceptReferral('ref-1');
    expect((await acceptReferral('ref-1'))?.status).toBe('seen');
    expect(store.patients['pat-1'].orgId).toBe('org-b');
  });

  test('a referral stamped by an org that never owned the patient does not move it', async () => {
    store.referrals['ref-1'] = { ...store.referrals['ref-1'], orgId: 'org-evil', toOrgId: undefined, toHospitalId: 'hosp-b' };
    store.hospitals['hosp-b'] = { _id: 'hosp-b', orgId: 'org-evil' };
    await expect(acceptReferral('ref-1')).rejects.toThrow(/does not belong to the referring organization/);
    expect(store.patients['pat-1'].orgId).toBe('org-a');
    expect(store.patients['pat-1'].registrationHospital).toBe('hosp-a');
    expect(store.referrals['ref-1'].status).toBe('sent');
  });
});

describe('orgId is not writable through the generic patient updates', () => {
  test('updatePatient ignores orgId without the opt-in', async () => {
    await updatePatient('pat-1', { orgId: 'org-evil', phone: '+211911111111' } as never, SCOPE_A);
    expect(store.patients['pat-1'].orgId).toBe('org-a');
    expect(store.patients['pat-1'].phone).toBe('+211911111111');
  });
  test('updatePatient honours orgId only with allowRehome', async () => {
    await updatePatient('pat-1', { orgId: 'org-b' } as never, SCOPE_A, { allowRehome: true });
    expect(store.patients['pat-1'].orgId).toBe('org-b');
  });
  test('mutatePatient never writes orgId', async () => {
    await mutatePatient('pat-1', () => ({ orgId: 'org-evil', phone: '+211922222222' } as never));
    expect(store.patients['pat-1'].orgId).toBe('org-a');
  });
  test('toOrgId cannot be written onto a patient', async () => {
    await updatePatient('pat-1', { toOrgId: 'org-b' } as never, SCOPE_A);
    expect(store.patients['pat-1'].toOrgId).toBeUndefined();
  });
});
