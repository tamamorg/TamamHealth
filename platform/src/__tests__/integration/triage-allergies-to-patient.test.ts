/**
 * Allergies captured at triage must reach the PATIENT document — the source
 * the chart header banner, AllergiesSection and prescribing safety checks
 * read. Exercises the real service layer end to end: createTriage /
 * updateTriage write the triage record AND merge `knownAllergies` onto
 * `patient.allergies`.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tauid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { createTriage, updateTriage } from '@/lib/services/triage-service';
import type { PatientDoc, TriageDoc } from '@/lib/db-types';

const ORG = 'org-moh-ss';
const HOSP1 = 'hosp-001';

function triagePayload(overrides: Partial<TriageDoc> = {}) {
  return {
    patientId: 'pat-nyibol',
    patientName: 'Nyibol Deng',
    facilityId: HOSP1,
    orgId: ORG,
    priority: 'GREEN',
    status: 'waiting',
    triagedBy: 'user-nurse.stella',
    triagedByName: 'Nurse Stella',
    triagedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as Omit<TriageDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'>;
}

beforeEach(async () => {
  await putDoc(patientsDB(), {
    _id: 'pat-nyibol', type: 'patient', firstName: 'Nyibol', lastName: 'Deng',
    orgId: ORG, noKnownDrugAllergies: true,
  } as never);
});
afterEach(async () => {
  await teardownTestDBs();
  uuidCounter = 0;
});

describe('triage allergies reach the patient document', () => {
  it('createTriage merges knownAllergies onto patient.allergies and clears the NKDA attestation', async () => {
    await createTriage(triagePayload({ knownAllergies: 'Penicillin, Sulfa drugs' }));

    const patient = await patientsDB().get('pat-nyibol') as PatientDoc;
    expect(patient.allergies).toEqual(['Penicillin', 'Sulfa drugs']);
    expect(patient.noKnownDrugAllergies).toBe(false);
  });

  it('never dilutes recorded allergies with a "none" answer, and never duplicates', async () => {
    await putDoc(patientsDB(), {
      ...(await patientsDB().get('pat-nyibol') as PatientDoc),
      allergies: ['Penicillin'],
    } as never);

    const created = await createTriage(triagePayload({ knownAllergies: 'none' }));
    let patient = await patientsDB().get('pat-nyibol') as PatientDoc;
    expect(patient.allergies).toEqual(['Penicillin']);

    await updateTriage(created._id, { knownAllergies: 'penicillin, Latex' });
    patient = await patientsDB().get('pat-nyibol') as PatientDoc;
    expect(patient.allergies).toEqual(['Penicillin', 'Latex']);
  });

  it('a triage save without allergies leaves the patient document untouched', async () => {
    const before = await patientsDB().get('pat-nyibol') as PatientDoc;
    await createTriage(triagePayload());
    const after = await patientsDB().get('pat-nyibol') as PatientDoc;
    expect(after._rev).toBe(before._rev);
    expect(after.allergies).toBeUndefined();
    expect(after.noKnownDrugAllergies).toBe(true);
  });
});
