/**
 * Triage, patient-transfer and patient reads take a REQUIRED DataScope. A scope
 * from another org must see nothing; super_admin keeps the national view
 * (filterByScope owns that). Registration duplicate detection is the one
 * deliberately global read and must disclose nothing it cannot show.
 */
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { triageDB, patientTransfersDB, patientsDB } from '@/lib/db';
import {
  getAllTriage, getTriageByPatient, getActiveTriage, findActiveTriageForPatient, getTriageStats, createTriage,
} from '@/lib/services/triage-service';
import {
  getAllTransfers, getTransfersByPatient, getIncomingTransfers, getOutgoingTransfers, getOverdueTransfers,
  getActiveTransferForPatient,
} from '@/lib/services/patient-transfer-service';
import {
  getAllPatients, getPatientById, searchPatients, createPatient, getPatientByIdUnscopedForPortal,
} from '@/lib/services/patient-service';
import type { DataScope } from '@/lib/services/data-scope';

type Role = DataScope['role'];
const A: DataScope = { orgId: 'org-a', hospitalId: 'h-a', role: 'clinician' as Role };
const B: DataScope = { orgId: 'org-b', hospitalId: 'h-b', role: 'clinician' as Role };
const NO_ORG: DataScope = { role: 'clinician' as Role };
const SUPER: DataScope = { role: 'super_admin' as Role };

afterEach(async () => { await teardownTestDBs(); });

describe('triage', () => {
  beforeEach(async () => {
    await putDoc(patientsDB(), {
      _id: 'p1', type: 'patient', orgId: 'org-a', registrationHospital: 'h-a', hospitalId: 'h-a',
      firstName: 'Ada', surname: 'Lual', dateOfBirth: '1990-01-01',
    } as never);
    await putDoc(triageDB(), {
      _id: 'tri-1', type: 'triage', orgId: 'org-a', facilityId: 'h-a', hospitalId: 'h-a', patientId: 'p1',
      status: 'pending', priority: 'GREEN', triagedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    } as never);
  });
  test('another org sees nothing', async () => {
    expect(await getAllTriage(A)).toHaveLength(1);
    expect(await getAllTriage(B)).toEqual([]);
    expect(await getAllTriage(NO_ORG)).toEqual([]);
    expect(await getTriageByPatient('p1', B)).toEqual([]);
    expect(await getActiveTriage(B)).toEqual([]);
    expect(await findActiveTriageForPatient('p1', B)).toBeUndefined();
    expect((await getTriageStats(B)).total).toBe(0);
    expect((await findActiveTriageForPatient('p1', A))?._id).toBe('tri-1');
  });
  test('createTriage in another org does not see the duplicate and cannot read the patient age', async () => {
    await expect(createTriage({
      patientId: 'p1', patientName: 'Ada Lual', priority: 'GREEN', status: 'pending',
      triagedAt: new Date().toISOString(), orgId: 'org-b',
    } as never, { scope: B })).resolves.toMatchObject({ orgId: 'org-b' });
  });
  test('super_admin keeps the national view', async () => {
    expect(await getAllTriage(SUPER)).toHaveLength(1);
  });
});

describe('patient transfers', () => {
  beforeEach(async () => {
    await putDoc(patientTransfersDB(), {
      _id: 'tr-1', type: 'patient_transfer', orgId: 'org-a', fromHospitalId: 'h-a', hospitalId: 'h-a',
      patientId: 'p1', status: 'requested', urgency: 'routine', transferType: 'permanent',
      requestedById: 'u1', requestedAt: '2020-01-01T00:00:00.000Z', createdAt: '2020-01-01T00:00:00.000Z',
      from: { providerId: 'u1', facilityId: 'h-a' }, to: { providerId: 'u2', facilityId: 'h-a' },
    } as never);
  });
  test('another org sees nothing', async () => {
    expect(await getAllTransfers(A)).toHaveLength(1);
    expect(await getAllTransfers(B)).toEqual([]);
    expect(await getAllTransfers(NO_ORG)).toEqual([]);
    expect(await getTransfersByPatient('p1', B)).toEqual([]);
    expect(await getIncomingTransfers({ id: 'u2' }, B)).toEqual([]);
    expect(await getOutgoingTransfers('u1', B)).toEqual([]);
    expect(await getOverdueTransfers(B)).toEqual([]);
    expect(await getActiveTransferForPatient('p1', B)).toBeNull();
    expect((await getActiveTransferForPatient('p1', A))?._id).toBe('tr-1');
  });
});

describe('patients', () => {
  const seed = (id: string, orgId: string, hospital: string, extra: Record<string, unknown> = {}) =>
    putDoc(patientsDB(), {
      _id: id, type: 'patient', orgId, registrationHospital: hospital, hospitalId: hospital,
      firstName: 'Nyibol', surname: 'Deng', dateOfBirth: '1980-02-02', hospitalNumber: `HN-${id}`, ...extra,
    } as never);
  beforeEach(async () => { await seed('pat-a', 'org-a', 'h-a'); });

  test('another org sees nothing and cannot read by id', async () => {
    expect(await getAllPatients(A)).toHaveLength(1);
    expect(await getAllPatients(B)).toEqual([]);
    expect(await getAllPatients(NO_ORG)).toEqual([]);
    expect(await getPatientById('pat-a', B)).toBeNull();
    expect(await searchPatients('Nyibol', B)).toEqual([]);
    expect((await getPatientById('pat-a', A))?._id).toBe('pat-a');
    expect(await getAllPatients(SUPER)).toHaveLength(1);
  });

  test('the portal entrypoint is the only id-only read', async () => {
    expect((await getPatientByIdUnscopedForPortal('pat-a'))?._id).toBe('pat-a');
  });

  test('registration duplicate check stays global but discloses nothing out of scope', async () => {
    const err = await createPatient({
      firstName: 'Nyibol', surname: 'Deng', gender: 'Female', dateOfBirth: '1980-02-02',
      phone: '+211900000123', state: 'Central Equatoria', county: 'Juba', primaryLanguage: 'Dinka',
      nokName: 'X Deng', nokRelationship: 'Father', nokPhone: '+211900000124',
      hospitalNumber: '', registrationHospital: 'h-b', orgId: 'org-b',
    } as never, B).catch((e) => e);
    expect(err.fields.duplicate).toBeTruthy();
    expect(err.fields.duplicate).not.toContain('HN-pat-a');
    expect(err.fields.duplicate).not.toContain('Nyibol');
  });
});
