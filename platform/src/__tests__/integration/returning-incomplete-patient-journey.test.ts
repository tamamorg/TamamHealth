/**
 * Integration — a RETURNING patient and a patient with INCOMPLETE information,
 * through the real service layer.
 *
 * Two realities of African OPD registration this pins down (per the WHO/EMR
 * research feeding this module): patients routinely present without documents
 * or exact birthdates (estimated age must be first-class), and returning
 * patients must be findable by name so the front desk reuses the record
 * instead of minting a duplicate folder.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { createPatient, searchPatients, getPatientById } from '@/lib/services/patient-service';
import { checkInPatient } from '@/lib/services/check-in-service';
import { getTriageByPatient } from '@/lib/services/triage-service';
import { hospitalsDB } from '@/lib/db';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', code: 'JTH', orgId: ORG } as unknown as { _id: string });
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

test('a patient with no birthdate and no national ID registers on estimated age alone', async () => {
  const p = await createPatient({
    firstName: 'Nyanut', surname: 'Kuol', gender: 'Female',
    estimatedAge: 30, // no dateOfBirth, no nationalId, no own phone — arrivals like this are routine
    state: 'Jonglei', county: 'Bor South',
    // NOTE: `validatePatientData` hard-requires a next-of-kin phone, so a fully
    // unaccompanied arrival still cannot register — an "unknown patient" fast
    // path remains an open product gap (see final report). The escort's number
    // is the one piece of contact data this arrival has.
    primaryLanguage: 'Dinka', nokName: 'Kuol Manyang', nokRelationship: 'Husband', nokPhone: '+211925004001',
    hospitalNumber: '', registrationHospital: HOSP, orgId: ORG,
  } as unknown as Parameters<typeof createPatient>[0]);

  expect(p._id).toMatch(/^pat-/);
  expect(p.hospitalNumber).toBeTruthy(); // the facility number is the identity anchor
  expect(p.dateOfBirth).toBeFalsy();

  // She can be triaged immediately despite the missing data — check-in never
  // requires fields the registration didn't have.
  const checkIn = await checkInPatient({
    patientId: p._id, patientName: `${p.firstName} ${p.surname}`,
    facilityId: HOSP, facilityName: 'Juba Teaching Hospital', orgId: ORG,
    chiefComplaint: 'Abdominal pain', acuity: 'routine',
    checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
  });
  expect(checkIn.triage.encounterId).toBe(checkIn.encounter._id);
  expect((await getTriageByPatient(p._id))).toHaveLength(1);
});

test('a returning patient is found by name search and the record is reused across visits', async () => {
  const first = await createPatient({
    firstName: 'Gabriel', surname: 'Lueth', gender: 'Male', dateOfBirth: '1979-11-20',
    phone: '+211925003001', state: 'Central Equatoria', county: 'Juba',
    primaryLanguage: 'Nuer', nokName: 'Rebecca Lueth', nokRelationship: 'Wife', nokPhone: '+211925003002',
    hospitalNumber: '', registrationHospital: HOSP, orgId: ORG,
  } as unknown as Parameters<typeof createPatient>[0]);

  // Visit 1 (walk-in) opens and — for this test — remains that day's record.
  const visit1 = await checkInPatient({
    patientId: first._id, patientName: `${first.firstName} ${first.surname}`,
    facilityId: HOSP, facilityName: 'Juba Teaching Hospital', orgId: ORG,
    chiefComplaint: 'Cough', acuity: 'routine',
    checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
  });

  // Months later the front desk searches by name — the returning-patient path.
  const found = await searchPatients('Lueth');
  expect(found.map(r => r._id)).toContain(first._id);

  // The same hospital number answers, so the desk reuses the folder: the
  // record retrieved is the registered one, not a fresh registration.
  const reused = await getPatientById(first._id);
  expect(reused?.hospitalNumber).toBe(first.hospitalNumber);

  // A same-day re-check-in joins the OPEN visit rather than forking a second
  // one — the one-visit-thread rule.
  const visit1b = await checkInPatient({
    patientId: first._id, patientName: `${first.firstName} ${first.surname}`,
    facilityId: HOSP, facilityName: 'Juba Teaching Hospital', orgId: ORG,
    chiefComplaint: 'Cough', acuity: 'routine',
    checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
  });
  expect(visit1b.encounter._id).toBe(visit1.encounter._id);
});
