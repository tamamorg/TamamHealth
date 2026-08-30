/**
 * `assembleTransferPackage` only ever read MedicalRecordDoc + LabResultDoc —
 * the legacy consultation path no browser UI writes to any more (KAN-100
 * audit item 9). A referral for a patient documented through the notes
 * module, with an active problem list or current medications, shipped to the
 * receiving facility with none of that clinical context. This pins the three
 * additions: signed ClinicalNoteDocs, the problem list, and active
 * (not-yet-dispensed) prescriptions — each excluding what should not travel
 * (an unsigned draft note, a dispensed/discontinued order).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { patientsDB } from '@/lib/db';
import { assembleTransferPackage } from '@/lib/services/transfer-service';
import { createClinicalNote, saveNoteSection, signClinicalNote } from '@/lib/clinical-notes/note-service';
import { createProblem } from '@/lib/services/problem-service';
import { createPrescription, updatePrescription } from '@/lib/services/prescription-service';

const PATIENT_ID = 'pat-00001';
const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

afterEach(async () => {
  await teardownTestDBs();
});

async function seedPatient() {
  await putDoc(patientsDB(), {
    _id: PATIENT_ID, type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    hospitalNumber: 'HN-001', dateOfBirth: '1990-01-01', gender: 'female',
    registrationHospital: HOSP, orgId: ORG,
  } as never);
}

it('includes a signed note, the problem list and active prescriptions', async () => {
  await seedPatient();

  const note = await createClinicalNote({
    patientId: PATIENT_ID, patientName: 'Nyakuma Deng', noteType: 'soap',
    serviceDate: '2026-08-19', authorId: 'user-dr-wani', authorName: 'Dr. Wani',
    hospitalId: HOSP, orgId: ORG,
  } as never);
  await saveNoteSection(note._id, 'subjective', { text: 'Follow-up for hypertension.' });
  await signClinicalNote(note._id, { signedBy: 'user-dr-wani', signedByName: 'Dr. Wani', signerRole: 'doctor' });

  const draft = await createClinicalNote({
    patientId: PATIENT_ID, patientName: 'Nyakuma Deng', noteType: 'soap',
    serviceDate: '2026-08-20', authorId: 'user-dr-wani', authorName: 'Dr. Wani',
    hospitalId: HOSP, orgId: ORG,
  } as never);

  await createProblem({
    patientId: PATIENT_ID, patientName: 'Nyakuma Deng', name: 'Hypertension, essential',
    icd11Code: 'BA02', status: 'active', hospitalId: HOSP, orgId: ORG,
  } as never);

  const { prescription: active } = await createPrescription({
    patientId: PATIENT_ID, patientName: 'Nyakuma Deng',
    medication: 'Amlodipine 5mg', dose: '5mg', route: 'oral', frequency: 'OD',
    duration: '30 days', prescribedBy: 'Dr. Wani', status: 'pending', hospitalId: HOSP,
  } as never);
  const { prescription: dispensed } = await createPrescription({
    patientId: PATIENT_ID, patientName: 'Nyakuma Deng',
    medication: 'Paracetamol 500mg', dose: '500mg', route: 'oral', frequency: 'QID',
    duration: '3 days', prescribedBy: 'Dr. Wani', status: 'pending', hospitalId: HOSP,
  } as never);
  await updatePrescription(dispensed._id, { status: 'dispensed', orderStatus: 'dispensed' });

  const pkg = await assembleTransferPackage(PATIENT_ID, 'user-frontdesk-1');

  expect(pkg.clinicalNotes.map(n => n.id)).toEqual([note._id]);
  expect(pkg.clinicalNotes.map(n => n.id)).not.toContain(draft._id);
  expect(pkg.clinicalNotes[0].signedByName).toBe('Dr. Wani');

  expect(pkg.problems).toHaveLength(1);
  expect(pkg.problems[0]).toMatchObject({ name: 'Hypertension, essential', icd11Code: 'BA02' });

  expect(pkg.activePrescriptions.map(rx => rx.id)).toEqual([active._id]);
  expect(pkg.activePrescriptions.map(rx => rx.id)).not.toContain(dispensed._id);
});
