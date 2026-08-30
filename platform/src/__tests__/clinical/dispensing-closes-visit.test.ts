/**
 * The pharmacy side of KAN-?? audit item 2: a visit prescribed-then-signed
 * used to stay at `awaiting_pharmacy` forever, because nothing on the
 * dispensing path ever looked at the encounter. This pins the closing move —
 * dispensing the LAST outstanding prescription on a visit whose note is
 * already signed advances `awaiting_pharmacy` → `ready_for_clinic_checkout`
 * via the legal edge — and the two guards around it (another order still
 * outstanding; the note not yet signed).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, hospitalsDB, patientsDB, pharmacyInventoryDB } from '@/lib/db';
import { createArrivalEncounter, advanceEncounterToClinician, getEncounter } from '@/lib/services/encounter-service';
import { createClinicalNote, saveNoteSection, signClinicalNote } from '@/lib/clinical-notes/note-service';
import { createPrescription, advancePrescription, getPrescriptionsByPatient } from '@/lib/services/prescription-service';
import { dispenseMedication } from '@/lib/services/dispensing-service';

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani' };
const PHARMACIST = { _id: 'user-pharma-rose', name: 'Pharmacist Rose' };
const PATIENT = { _id: 'pat-00001', name: 'Nyakuma Deng' };

async function seedWorld() {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(usersDB(), {
    _id: DOCTOR._id, type: 'user', username: 'dr.wani', name: DOCTOR.name,
    role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(usersDB(), {
    _id: PHARMACIST._id, type: 'user', username: 'pharma.rose', name: PHARMACIST.name,
    role: 'pharmacist', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(patientsDB(), {
    _id: PATIENT._id, type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    registrationHospital: HOSP, orgId: ORG, state: 'Central Equatoria', county: 'Juba',
  } as never);
  await putDoc(pharmacyInventoryDB(), {
    _id: 'inv-amox', type: 'pharmacy_inventory', hospitalId: HOSP,
    hospitalName: 'Juba Teaching Hospital', medicationName: 'Amoxicillin 500mg',
    category: 'Antibiotic', stockLevel: 200, unit: 'tablets', reorderLevel: 20,
    batchNumber: 'B-2026-01', expiryDate: '2027-01-01', dispensedToday: 0, orgId: ORG,
  } as never);
}

async function clearForDispensing(rxId: string) {
  await advancePrescription(rxId, 'cleared_for_dispensing', undefined, PHARMACIST._id);
}

afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

it('closes the visit once the last prescription is dispensed on a signed visit', async () => {
  await seedWorld();

  const arrival = await createArrivalEncounter({
    patientId: PATIENT._id, patientName: PATIENT.name,
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });

  const note = await createClinicalNote({
    patientId: PATIENT._id, patientName: PATIENT.name, noteType: 'soap',
    serviceDate: '2026-08-19', encounterId: claimed._id,
    authorId: DOCTOR._id, authorName: DOCTOR.name,
    assignedToId: DOCTOR._id, assignedToName: DOCTOR.name,
    hospitalId: HOSP, orgId: ORG,
  } as never);
  await saveNoteSection(note._id, 'subjective', { text: 'Fever and cough for 4 days.' });

  const { prescription } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
    frequency: 'TDS', duration: '5 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, quantityToDispense: 15,
  } as never);
  expect((await getEncounter(claimed._id))?.status).toBe('awaiting_pharmacy');

  // Sign while the prescription is still outstanding — must NOT force-close
  // (item 2a's own guard).
  await signClinicalNote(note._id, { signedBy: DOCTOR._id, signedByName: DOCTOR.name, signerRole: 'doctor' });
  expect((await getEncounter(claimed._id))?.status).toBe('awaiting_pharmacy');

  await clearForDispensing(prescription._id);
  const cleared = (await getPrescriptionsByPatient(PATIENT._id)).find(r => r._id === prescription._id)!;
  await dispenseMedication({
    prescription: cleared, quantity: 15,
    dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
    facilityId: HOSP, orgId: ORG, counsellingConfirmed: true,
  });

  const after = await getEncounter(claimed._id);
  expect(after?.status).toBe('ready_for_clinic_checkout');
  expect(after?.closedAt).toBeTruthy();
});

it('does not close the visit when the note has not been signed yet', async () => {
  await seedWorld();
  const arrival = await createArrivalEncounter({
    patientId: PATIENT._id, patientName: PATIENT.name,
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });
  const { prescription } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
    frequency: 'TDS', duration: '5 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, quantityToDispense: 15,
  } as never);

  await clearForDispensing(prescription._id);
  const cleared = (await getPrescriptionsByPatient(PATIENT._id)).find(r => r._id === prescription._id)!;
  await dispenseMedication({
    prescription: cleared, quantity: 15,
    dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
    facilityId: HOSP, orgId: ORG, counsellingConfirmed: true,
  });

  // No note was ever signed for this visit — the loop is not genuinely closed.
  expect((await getEncounter(claimed._id))?.status).toBe('awaiting_pharmacy');
});

it('does not close the visit while a second prescription is still outstanding', async () => {
  await seedWorld();
  const arrival = await createArrivalEncounter({
    patientId: PATIENT._id, patientName: PATIENT.name,
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });
  const note = await createClinicalNote({
    patientId: PATIENT._id, patientName: PATIENT.name, noteType: 'soap',
    serviceDate: '2026-08-19', encounterId: claimed._id,
    authorId: DOCTOR._id, authorName: DOCTOR.name,
    hospitalId: HOSP, orgId: ORG,
  } as never);
  await saveNoteSection(note._id, 'subjective', { text: 'Fever and cough for 4 days.' });

  const { prescription: amox } = await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
    frequency: 'TDS', duration: '5 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, quantityToDispense: 15,
  } as never);
  await createPrescription({
    patientId: PATIENT._id, patientName: PATIENT.name, encounterId: claimed._id,
    medication: 'Paracetamol 500mg', dose: '500mg', route: 'oral',
    frequency: 'QID', duration: '3 days', prescribedBy: DOCTOR.name,
    status: 'pending', hospitalId: HOSP, quantityToDispense: 12,
  } as never);

  await signClinicalNote(note._id, { signedBy: DOCTOR._id, signedByName: DOCTOR.name, signerRole: 'doctor' });
  expect((await getEncounter(claimed._id))?.status).toBe('awaiting_pharmacy');

  await clearForDispensing(amox._id);
  const cleared = (await getPrescriptionsByPatient(PATIENT._id)).find(r => r._id === amox._id)!;
  await dispenseMedication({
    prescription: cleared, quantity: 15,
    dispenserId: PHARMACIST._id, dispenserName: PHARMACIST.name,
    facilityId: HOSP, orgId: ORG, counsellingConfirmed: true,
  });

  // Paracetamol is still an open order on this visit — must stay parked.
  expect((await getEncounter(claimed._id))?.status).toBe('awaiting_pharmacy');
});
