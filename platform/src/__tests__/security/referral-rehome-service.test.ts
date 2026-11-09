/**
 * @jest-environment node
 *
 * acceptReferral splits a patient across organisations (the sender keeps its
 * chart, the receiver gets a linked copy) only when the patient currently
 * belongs to the referring org, and updatePatient ignores orgId without the
 * explicit allowRehome opt-in. The sealing and multi-org cases run on the real
 * encrypted test database in referral-cross-org-split.test.ts.
 */
const store: Record<string, Record<string, Record<string, unknown>>> = {
  referrals: {}, hospitals: {}, patients: {}, records: {}, orgs: {},
};
const fakeDb = (name: string) => ({
  get: async (id: string) => {
    const doc = store[name][id];
    if (!doc) throw Object.assign(new Error('missing'), { status: 404, name: 'not_found' });
    return { ...doc };
  },
  put: jest.fn(async (doc: Record<string, unknown>) => { store[name][doc._id as string] = { ...doc }; return { ok: true, rev: '2-x' }; }),
});
const dbs = { referrals: fakeDb('referrals'), hospitals: fakeDb('hospitals'), patients: fakeDb('patients'), records: fakeDb('records'), orgs: fakeDb('orgs') };
jest.mock('@/lib/db', () => ({
  referralsDB: () => dbs.referrals, hospitalsDB: () => dbs.hospitals,
  patientsDB: () => dbs.patients, medicalRecordsDB: () => dbs.records, organizationsDB: () => dbs.orgs,
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
import { filterByScope } from '@/lib/services/data-scope';
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
  test('a cross-org referral keeps the sender its chart and gives the receiver a linked copy', async () => {
    store.orgs['org-a'] = { _id: 'org-a', name: 'Org A' };
    store.orgs['org-b'] = { _id: 'org-b', name: 'Org B' };
    const result = await acceptReferral('ref-1');
    expect(result?.status).toBe('seen');
    const receiverId = 'pat-1--org-b';
    expect(result?.receiverPatientId).toBe(receiverId);

    // The sender's document is not moved: same id, same org, marked referred out.
    const sender = store.patients['pat-1'] as Record<string, any>;
    expect(sender.orgId).toBe('org-a');
    expect(sender.registrationHospital).toBe('hosp-a');
    expect(sender.referredOut).toMatchObject({
      referralId: 'ref-1', toOrgId: 'org-b', toHospitalId: 'hosp-b', toHospitalName: 'B',
      toOrgName: 'Org B', receiverPatientId: receiverId,
    });

    // The receiver has its own copy, in its own org, linked back.
    const receiver = store.patients[receiverId] as Record<string, any>;
    expect(receiver.orgId).toBe('org-b');
    expect(receiver.registrationHospital).toBe('hosp-b');
    expect(receiver.lastVisitHospital).toBe('hosp-b');
    expect(receiver.firstName).toBe('A');
    expect(receiver.referredFrom).toMatchObject({ patientId: 'pat-1', orgId: 'org-a', hospitalId: 'hosp-a', referralId: 'ref-1', orgName: 'Org A' });
    expect(receiver.referredOut).toBeUndefined();
    // The sender's own staff routing and portal credentials do not travel.
    expect(receiver.assignedDoctor).toBeUndefined();
    expect(receiver.portalPasswordHash).toBeUndefined();
    // The receiver's intake encounter hangs off ITS chart.
    expect((store.records['rec-refin-ref-1'] as Record<string, unknown>).patientId).toBe(receiverId);
  });

  test('the receiver copy leaves the sender routing, portal login and duplicate links behind', async () => {
    store.patients['pat-1'] = {
      ...store.patients['pat-1'], assignedDoctor: 'u-doc', careTeam: [{ id: 'x' }], stationAssignments: { lab: {} },
      portalUsername: 'achol.b', portalPasswordHash: 'hash', duplicateOf: 'pat-9', transferFacilityIds: ['hosp-a'],
    };
    await acceptReferral('ref-1');
    const receiver = store.patients['pat-1--org-b'] as Record<string, unknown>;
    for (const f of ['assignedDoctor', 'careTeam', 'stationAssignments', 'portalUsername', 'portalPasswordHash', 'duplicateOf']) {
      expect(receiver[f]).toBeUndefined();
    }
    expect(receiver.transferFacilityIds).toEqual(['hosp-b']);
    // ...and the sender still has all of its own.
    expect((store.patients['pat-1'] as Record<string, unknown>).assignedDoctor).toBe('u-doc');
  });

  test('a referral back to the sender reopens the original chart instead of making a third', async () => {
    await acceptReferral('ref-1');
    store.referrals['ref-2'] = {
      _id: 'ref-2', _rev: '1-a', type: 'referral', patientId: 'pat-1--org-b', orgId: 'org-b', toOrgId: 'org-a',
      fromHospitalId: 'hosp-b', toHospitalId: 'hosp-a', toHospital: 'A', fromHospital: 'B', status: 'sent',
    };
    const back = await acceptReferral('ref-2');
    expect(back?.receiverPatientId).toBe('pat-1');
    expect(Object.keys(store.patients).sort()).toEqual(['pat-1', 'pat-1--org-b']);
    expect((store.patients['pat-1'] as Record<string, unknown>).referredOut).toBeUndefined();
    expect((store.patients['pat-1--org-b'] as Record<string, any>).referredOut).toMatchObject({ toOrgId: 'org-a', receiverPatientId: 'pat-1' });
  });

  test('a same-org referral leaves the sending facility able to read the chart', async () => {
    store.hospitals['hosp-c'] = { _id: 'hosp-c', orgId: 'org-a' };
    store.referrals['ref-1'] = { ...store.referrals['ref-1'], toOrgId: undefined, toHospitalId: 'hosp-c' };
    await acceptReferral('ref-1');
    const patient = store.patients['pat-1'] as { orgId: string; transferFacilityIds: string[] };
    const sender = { orgId: 'org-a', hospitalId: 'hosp-a', role: 'doctor' } as import('@/lib/services/data-scope').DataScope;
    const receiver = { orgId: 'org-a', hospitalId: 'hosp-c', role: 'doctor' } as import('@/lib/services/data-scope').DataScope;
    const elsewhere = { orgId: 'org-a', hospitalId: 'hosp-z', role: 'doctor' } as import('@/lib/services/data-scope').DataScope;
    expect(patient.orgId).toBe('org-a');
    expect(patient.transferFacilityIds).toEqual(expect.arrayContaining(['hosp-a', 'hosp-c']));
    expect(filterByScope([patient], sender)).toHaveLength(1);
    expect(filterByScope([patient], receiver)).toHaveLength(1);
    expect(filterByScope([patient], elsewhere)).toHaveLength(0);
  });

  test('the sender stays on the chart even when the patient was registered somewhere else', async () => {
    store.hospitals['hosp-c'] = { _id: 'hosp-c', orgId: 'org-a' };
    store.patients['pat-1'] = { ...store.patients['pat-1'], registrationHospital: 'hosp-origin', lastVisitHospital: 'hosp-a' };
    store.referrals['ref-1'] = { ...store.referrals['ref-1'], toOrgId: undefined, toHospitalId: 'hosp-c' };
    await acceptReferral('ref-1');
    const patient = store.patients['pat-1'] as { transferFacilityIds: string[] };
    const sender = { orgId: 'org-a', hospitalId: 'hosp-a', role: 'doctor' } as import('@/lib/services/data-scope').DataScope;
    expect(filterByScope([patient], sender)).toHaveLength(1);
  });

  test('re-running acceptance is idempotent: still one pair, no second copy', async () => {
    await acceptReferral('ref-1');
    const first = (store.patients['pat-1'] as { referredOut: { at: string } }).referredOut.at;
    expect((await acceptReferral('ref-1'))?.status).toBe('seen');
    expect(Object.keys(store.patients).sort()).toEqual(['pat-1', 'pat-1--org-b']);
    expect((store.patients['pat-1'] as { referredOut: { at: string } }).referredOut.at).toBe(first);
    expect(store.patients['pat-1'].orgId).toBe('org-a');
  });

  test('a chart already moved to the destination org by the old behaviour is left alone', async () => {
    store.patients['pat-1'] = { ...store.patients['pat-1'], orgId: 'org-b' };
    expect((await acceptReferral('ref-1'))?.status).toBe('seen');
    expect(Object.keys(store.patients)).toEqual(['pat-1']);
    expect(store.patients['pat-1'].orgId).toBe('org-b');
  });

  test('a referral stamped by an org that never owned the patient does not move it', async () => {
    store.referrals['ref-1'] = { ...store.referrals['ref-1'], orgId: 'org-evil', toOrgId: undefined, toHospitalId: 'hosp-b' };
    store.hospitals['hosp-b'] = { _id: 'hosp-b', orgId: 'org-evil' };
    await expect(acceptReferral('ref-1')).rejects.toThrow(/registered with a different organization/);
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
