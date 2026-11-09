/**
 * A cross-organisation referral leaves BOTH organisations a chart (the fix for
 * "after referring a patient to another organisation the referring hospital can
 * no longer open the chart"), run on the real encrypted test database so what
 * reaches storage is what production would hold.
 *
 *   - the sender keeps its own document, marked referredOut, readable by the
 *     sender's DataScope and not by the receiver's;
 *   - the receiver's copy is readable by the receiver only;
 *   - each copy is sealed with ITS organisation's key, never the other's;
 *   - a viewer who sees both organisations gets one linked pair, not a silent
 *     duplicate (list, duplicate review, MPI match).
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.mock('@/lib/services/sync-event-service', () => ({ emitSyncEvent: jest.fn() }));
const apiFetch = jest.fn();
jest.mock('@/lib/api-fetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { rawTestDB, teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB, referralsDB, organizationsDB } from '@/lib/db';
import { acceptReferral, acceptReferralFromDevice, getReferralsByPatient } from '@/lib/services/referral-service';
import { getAllPatients, getPatientById } from '@/lib/services/patient-service';
import { matchPatient } from '@/lib/services/mpi-service';
import { filterByScope, type DataScope } from '@/lib/services/data-scope';
import { findDuplicateCandidates } from '@/components/patients/duplicate-candidates';
import { areLinkedCopies, isReferredOut } from '@/lib/patient-referral-link';
import { envelopeOrgIds, isOrgEncrypted } from '@/lib/org-data-cipher';
import type { PatientDoc } from '@/lib/db-types';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const scope = (orgId: string, hospitalId: string, role = 'doctor') => ({ orgId, hospitalId, role }) as DataScope;
const SENDER = scope(ORG_A, 'hosp-a');
const RECEIVER = scope(ORG_B, 'hosp-b');
const BOTH = { role: 'super_admin' } as DataScope;

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: 'hosp-a', type: 'hospital', name: 'Hospital A', orgId: ORG_A } as never);
  await putDoc(hospitalsDB(), { _id: 'hosp-b', type: 'hospital', name: 'Hospital B', orgId: ORG_B } as never);
  await putDoc(organizationsDB(), { _id: ORG_A, type: 'organization', name: 'Org A' } as never);
  await putDoc(organizationsDB(), { _id: ORG_B, type: 'organization', name: 'Org B' } as never);
  await putDoc(patientsDB(), {
    _id: 'pat-1', type: 'patient', orgId: ORG_A, registrationHospital: 'hosp-a', lastVisitHospital: 'hosp-a',
    firstName: 'Achol', surname: 'Deng', dateOfBirth: '1990-04-02', phone: '+211912000111',
    nationalId: 'SS-123456', hospitalNumber: 'HA-000001', allergies: ['Penicillin'], isActive: true,
  } as never);
  await putDoc(referralsDB(), {
    _id: 'ref-1', type: 'referral', patientId: 'pat-1', patientName: 'Achol Deng', orgId: ORG_A, toOrgId: ORG_B,
    fromHospital: 'Hospital A', fromHospitalId: 'hosp-a', toHospital: 'Hospital B', toHospitalId: 'hosp-b',
    referralDate: '2026-11-08', urgency: 'urgent', reason: 'Surgery', department: 'Surgery', status: 'sent',
    referringDoctor: 'Dr A', notes: '',
  } as never);
});
afterEach(async () => { await teardownTestDBs(); });

const get = async (id: string) => patientsDB().get(id) as unknown as Promise<PatientDoc>;

describe('after a cross-org referral is accepted', () => {
  test('the sender can still open its chart; the receiver cannot read the sender\'s copy', async () => {
    await acceptReferral('ref-1');
    const sender = await get('pat-1');
    expect(sender.orgId).toBe(ORG_A);
    expect(isReferredOut(sender)).toBe(true);
    expect(sender.referredOut).toMatchObject({ toOrgId: ORG_B, toHospitalName: 'Hospital B', toOrgName: 'Org B', referralId: 'ref-1' });
    expect(sender.firstName).toBe('Achol'); // demographics as at referral, readable
    expect(await getPatientById('pat-1', SENDER)).not.toBeNull();
    expect(filterByScope([sender], RECEIVER)).toHaveLength(0);
    expect(await getPatientById('pat-1', RECEIVER)).toBeNull();
  });

  test('the receiver\'s copy is readable by the receiver only', async () => {
    await acceptReferral('ref-1');
    const copy = await get('pat-1--org-b');
    expect(copy.orgId).toBe(ORG_B);
    expect(copy.firstName).toBe('Achol');
    expect(copy.referredFrom).toMatchObject({ patientId: 'pat-1', hospitalName: 'Hospital A', orgName: 'Org A' });
    expect(await getPatientById('pat-1--org-b', RECEIVER)).not.toBeNull();
    expect(await getPatientById('pat-1--org-b', SENDER)).toBeNull();
    expect(filterByScope([copy], scope(ORG_B, 'hosp-z'))).toHaveLength(0); // another facility of the receiver
  });

  test('each copy is sealed with its own organisation\'s key, never the other\'s', async () => {
    await acceptReferral('ref-1');
    const raw = rawTestDB('tamamhealth_patients');
    const a = await raw.get('pat-1') as Record<string, unknown>;
    const b = await raw.get('pat-1--org-b') as Record<string, unknown>;
    for (const f of ['firstName', 'surname', 'phone', 'nationalId']) {
      expect(isOrgEncrypted(a[f])).toBe(true);
      expect(envelopeOrgIds(a[f] as string)).toEqual([ORG_A]);
      expect(isOrgEncrypted(b[f])).toBe(true);
      expect(envelopeOrgIds(b[f] as string)).toEqual([ORG_B]);
    }
    expect(envelopeOrgIds((b.allergies as string[])[0])).toEqual([ORG_B]);
    expect(JSON.stringify(b)).not.toMatch(/Achol|Deng|Penicillin|123456/);
    // The sender's ciphertext was not carried across.
    expect(b.firstName).not.toBe(a.firstName);
  });

  test('the sender keeps seeing the referral, and the receiver sees it on its own chart', async () => {
    await acceptReferral('ref-1');
    expect((await getReferralsByPatient('pat-1')).map(r => r._id)).toEqual(['ref-1']);
    expect((await getReferralsByPatient('pat-1--org-b')).map(r => r._id)).toEqual(['ref-1']);
    expect((await referralsDB().get('ref-1') as { receiverPatientId?: string }).receiverPatientId).toBe('pat-1--org-b');
  });

  test('a viewer who sees both organisations gets one linked pair, not a silent duplicate', async () => {
    await acceptReferral('ref-1');
    const sender = await get('pat-1');
    const copy = await get('pat-1--org-b');
    expect(areLinkedCopies(sender, copy)).toBe(true);

    // The list shows the person once: the copy being cared for now.
    expect((await getAllPatients(BOTH)).map(p => p._id)).toEqual(['pat-1--org-b']);
    // The sender's own users still list the referred-out chart.
    expect((await getAllPatients(SENDER)).map(p => p._id)).toEqual(['pat-1']);
    expect((await getAllPatients(RECEIVER)).map(p => p._id)).toEqual(['pat-1--org-b']);
    // Both stay reachable by id, and say what they are.
    expect(await getPatientById('pat-1', BOTH)).not.toBeNull();
    // The duplicate review does not offer the pair for merging...
    expect(findDuplicateCandidates([sender, copy])).toEqual([]);
    // ...but two genuinely separate records still are.
    const stranger = { ...copy, _id: 'pat-9', referredFrom: undefined } as PatientDoc;
    expect(findDuplicateCandidates([sender, stranger])).toHaveLength(1);
    // And the MPI offers the person once.
    const hits = await matchPatient({ firstName: 'Achol', surname: 'Deng', dateOfBirth: '1990-04-02' }, 5, BOTH);
    expect(hits.map(h => h.patient._id)).toEqual(['pat-1--org-b']);
  });

  test('a same-org referral still shares one document', async () => {
    await putDoc(hospitalsDB(), { _id: 'hosp-a2', type: 'hospital', name: 'Hospital A2', orgId: ORG_A } as never);
    await putDoc(referralsDB(), {
      _id: 'ref-2', type: 'referral', patientId: 'pat-1', orgId: ORG_A, fromHospitalId: 'hosp-a', toHospitalId: 'hosp-a2',
      toHospital: 'Hospital A2', fromHospital: 'Hospital A', status: 'sent', referralDate: '2026-11-08',
    } as never);
    await acceptReferral('ref-2');
    const doc = await get('pat-1');
    expect(doc.referredOut).toBeUndefined();
    expect(doc.transferFacilityIds).toEqual(expect.arrayContaining(['hosp-a', 'hosp-a2']));
    expect((await getAllPatients(BOTH)).map(p => p._id)).toEqual(['pat-1']);
  });
});

describe('accepting from a signed-in browser', () => {
  beforeEach(() => apiFetch.mockReset());

  test('a cross-org referral goes to the server (the device cannot write the other org\'s chart)', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ referral: { _id: 'ref-1', status: 'seen' } }) });
    const out = await acceptReferralFromDevice('ref-1');
    expect(out?.status).toBe('seen');
    expect(apiFetch).toHaveBeenCalledWith('/api/referrals', expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'accept', referralId: 'ref-1' }) }));
    // Nothing was split on this device.
    expect((await get('pat-1')).referredOut).toBeUndefined();
  });

  test('a refused server accept is reported as not done', async () => {
    apiFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await acceptReferralFromDevice('ref-1')).toBeNull();
  });

  test('a same-org referral is accepted on the device, no request', async () => {
    await putDoc(referralsDB(), {
      _id: 'ref-3', type: 'referral', patientId: 'pat-1', orgId: ORG_A, fromHospitalId: 'hosp-a', toHospitalId: 'hosp-a',
      toHospital: 'Hospital A', status: 'sent', referralDate: '2026-11-08',
    } as never);
    expect((await acceptReferralFromDevice('ref-3'))?.status).toBe('seen');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe('the referred-out chart is read-only', () => {
  test('a generic patient update on it is refused with a plain message; the receiver\'s copy edits normally', async () => {
    await acceptReferral('ref-1');
    const { updatePatient, mutatePatient } = await import('@/lib/services/patient-service');
    await expect(updatePatient('pat-1', { phone: '+211911999999' }, SENDER)).rejects.toThrow(/Chart not changed.*referred to another organization/);
    await expect(mutatePatient('pat-1', () => ({ allergies: ['Latex'] }))).rejects.toThrow(/Chart not changed/);
    expect((await get('pat-1')).allergies).toEqual(['Penicillin']);
    expect((await updatePatient('pat-1--org-b', { phone: '+211911999999' }, RECEIVER))?.phone).toBe('+211911999999');
  });

  test('a generic update cannot forge or clear the referral link', async () => {
    await acceptReferral('ref-1');
    const { updatePatient } = await import('@/lib/services/patient-service');
    await updatePatient('pat-1--org-b', { referredOut: { referralId: 'x', toOrgId: ORG_A, toHospitalId: 'h', receiverPatientId: 'pat-1', at: 'now' } } as never, RECEIVER);
    expect((await get('pat-1--org-b')).referredOut).toBeUndefined();
  });
});
