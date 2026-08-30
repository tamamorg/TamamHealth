/**
 * Signing a note while the encounter is parked on a parallel order loop
 * (KAN-?? audit item 2). `signClinicalNote` used to move ONLY a `with_clinician`
 * encounter to `ready_for_clinic_checkout` — but the commonest sequence is
 * prescribe (or order labs) THEN sign, and prescribing/ordering already parks
 * the visit away from `with_clinician` before the note is ever signed. That
 * left every prescribe-then-sign visit open at `awaiting_pharmacy` /
 * `awaiting_labs` forever, and `findOpenEncounterForPatient` absorbed the
 * patient's next arrival into the stale visit.
 *
 * Also covers item 4 (a notifiable diagnosis on a signed note now raises
 * surveillance, mirroring medical-record-service) and item 5 (signing clears
 * the shared consultation-progress tracker instead of leaving it "in
 * progress" forever).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { teardownTestDBs } from '../helpers/test-db';
import { createClinicalNote, saveNoteSection, signClinicalNote } from '@/lib/clinical-notes/note-service';
import { createEncounter, getEncounter, transitionEncounter } from '@/lib/services/encounter-service';
import { createPrescription, updatePrescription } from '@/lib/services/prescription-service';
import { createLabResult, updateLabResult } from '@/lib/services/lab-service';
import { getAlertsBySourceRecord } from '@/lib/services/surveillance-service';
import { ensureConsultationProgress, getConsultationProgressByPatient } from '@/lib/services/consultation-progress-service';

afterEach(async () => {
  await teardownTestDBs();
});

const PATIENT_ID = 'pat-00001';
const PATIENT_NAME = 'Nyakuma Deng';
const DOCTOR_ID = 'user-dr-wani';
const DOCTOR_NAME = 'Dr. Wani';
const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

async function withClinicianEncounter() {
  return createEncounter({
    patientId: PATIENT_ID, patientName: PATIENT_NAME,
    clinicianId: DOCTOR_ID, clinicianName: DOCTOR_NAME,
    hospitalId: HOSP, orgId: ORG,
    status: 'with_clinician', snapshot: {}, labOrderIds: [],
    startedAt: new Date().toISOString(),
  } as never);
}

async function draftNoteFor(encounterId: string) {
  const note = await createClinicalNote({
    patientId: PATIENT_ID, patientName: PATIENT_NAME, noteType: 'soap',
    serviceDate: '2026-08-08', encounterId,
    authorId: DOCTOR_ID, authorName: DOCTOR_NAME,
    assignedToId: DOCTOR_ID, assignedToName: DOCTOR_NAME,
    hospitalId: HOSP, orgId: ORG,
  } as never);
  await saveNoteSection(note._id, 'subjective', { text: 'Fever for three days.' });
  return note;
}

describe('signClinicalNote — parked-visit closure (prescribe/order then sign)', () => {
  it('leaves the visit at awaiting_pharmacy when a prescription is still outstanding', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);

    await createPrescription({
      patientId: PATIENT_ID, patientName: PATIENT_NAME, encounterId: enc._id,
      medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
      frequency: 'TDS', duration: '5 days', prescribedBy: DOCTOR_NAME,
      status: 'pending', hospitalId: HOSP,
    } as never);
    // Prescribing already parked the visit — this is the "prescribe then
    // sign" sequence the bug describes.
    expect((await getEncounter(enc._id))?.status).toBe('awaiting_pharmacy');

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    // The prescription is genuinely still outstanding — the visit must NOT
    // be force-closed.
    expect((await getEncounter(enc._id))?.status).toBe('awaiting_pharmacy');
  });

  it('advances awaiting_pharmacy → ready_for_clinic_checkout once the only prescription is resolved', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);

    const { prescription } = await createPrescription({
      patientId: PATIENT_ID, patientName: PATIENT_NAME, encounterId: enc._id,
      medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
      frequency: 'TDS', duration: '5 days', prescribedBy: DOCTOR_NAME,
      status: 'pending', hospitalId: HOSP,
    } as never);
    await updatePrescription(prescription._id, { status: 'dispensed', orderStatus: 'dispensed' });
    expect((await getEncounter(enc._id))?.status).toBe('awaiting_pharmacy');

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    const after = await getEncounter(enc._id);
    expect(after?.status).toBe('ready_for_clinic_checkout');
    expect(after?.closedAt).toBeTruthy();
  });

  it('leaves the visit at awaiting_labs while a result is still pending', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);
    const paused = await transitionEncounter(enc._id, 'awaiting_labs', { actorId: DOCTOR_ID });

    await createLabResult({
      patientId: PATIENT_ID, patientName: PATIENT_NAME, encounterId: paused._id,
      testName: 'Creatinine', status: 'pending', result: '', unit: '',
      referenceRange: '60-110', abnormal: false, critical: false,
      orderedBy: DOCTOR_NAME, orderedAt: new Date().toISOString(), completedAt: '',
      hospitalId: HOSP, orgId: ORG,
    } as never);

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    expect((await getEncounter(enc._id))?.status).toBe('awaiting_labs');
  });

  it('advances awaiting_labs → ready_for_clinic_checkout once every ordered result is back', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);
    const paused = await transitionEncounter(enc._id, 'awaiting_labs', { actorId: DOCTOR_ID });

    const order = await createLabResult({
      patientId: PATIENT_ID, patientName: PATIENT_NAME, encounterId: paused._id,
      testName: 'Creatinine', status: 'pending', result: '', unit: '',
      referenceRange: '60-110', abnormal: false, critical: false,
      orderedBy: DOCTOR_NAME, orderedAt: new Date().toISOString(), completedAt: '',
      hospitalId: HOSP, orgId: ORG,
    } as never);
    await updateLabResult(order._id, { status: 'completed', result: '90', unit: 'µmol/L' });

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    const after = await getEncounter(enc._id);
    expect(after?.status).toBe('ready_for_clinic_checkout');
  });

  it('does not touch a visit still genuinely with the clinician when nothing was ordered', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    expect((await getEncounter(enc._id))?.status).toBe('ready_for_clinic_checkout');
  });
});

describe('signClinicalNote — notifiable diagnosis raises surveillance (item 4)', () => {
  it('raises a disease_alert for a notifiable ICD-11 diagnosis on the Assessment section', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);
    await saveNoteSection(note._id, 'assessment', {
      diagnoses: [{ id: 'dx-1', name: 'Measles', icd11Code: '1E30', addedAt: new Date().toISOString() }],
    });

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    const alerts = await getAlertsBySourceRecord(note._id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ icd11Code: '1E30', sourceRecordId: note._id, patientId: PATIENT_ID });
  });

  it('does not raise anything for a non-notifiable diagnosis', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);
    await saveNoteSection(note._id, 'assessment', {
      diagnoses: [{ id: 'dx-1', name: 'Hypertension, essential', icd11Code: 'BA02', addedAt: new Date().toISOString() }],
    });

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    expect(await getAlertsBySourceRecord(note._id)).toHaveLength(0);
  });

  it('never lets a surveillance failure block the signature (fail-safe)', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);
    // A malformed code must not throw out of the sign path — surveillance is
    // best-effort and the attestation must stand regardless.
    await saveNoteSection(note._id, 'assessment', {
      diagnoses: [{ id: 'dx-1', name: 'Something', icd11Code: '###', addedAt: new Date().toISOString() }],
    });

    const signed = await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });
    expect(signed?.status).toBe('signed');
  });
});

describe('signClinicalNote — clears the shared consultation-progress tracker (item 5)', () => {
  it('marks the visit\'s tracker completed on a full sign', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);
    const tracker = await ensureConsultationProgress({
      patientId: PATIENT_ID, patientName: PATIENT_NAME, hospitalId: HOSP, orgId: ORG,
      encounterId: enc._id,
    });
    expect(tracker.currentStage).not.toBe('completed');

    await signClinicalNote(note._id, { signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor' });

    const after = await getConsultationProgressByPatient(PATIENT_ID);
    expect(after?.currentStage).toBe('completed');
    expect(after?.milestones.find(m => m.key === 'consultation_signed')?.status).toBe('completed');
  });

  it('does not mark progress complete on a trainee signature awaiting co-sign', async () => {
    const enc = await withClinicianEncounter();
    const note = await draftNoteFor(enc._id);
    await ensureConsultationProgress({
      patientId: PATIENT_ID, patientName: PATIENT_NAME, hospitalId: HOSP, orgId: ORG,
      encounterId: enc._id,
    });

    await signClinicalNote(note._id, {
      signedBy: DOCTOR_ID, signedByName: DOCTOR_NAME, signerRole: 'doctor', awaitingCosign: true,
    });

    const after = await getConsultationProgressByPatient(PATIENT_ID);
    expect(after?.currentStage).not.toBe('completed');
  });
});
