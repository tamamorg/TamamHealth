/**
 * The complete doctor workflow, end-to-end through the REAL services on
 * in-memory PouchDB — arrival → claim → note → prescribe → labs → critical
 * result → resume → sign → checkout gate → discharge. One patient, ONE
 * encounter the whole way: the visit thread must never fork.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-tuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

// One test, ~40 sequential PouchDB writes — the 5s default flakes on a loaded machine.
jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { usersDB, hospitalsDB, patientsDB } from '@/lib/db';
import {
  createArrivalEncounter,
  advanceEncounterToClinician,
  ensureLabOrderEncounter,
  appendLabOrderIds,
  transitionEncounter,
  getAllEncounters,
  getEncounter,
  getResumableEncounters,
  dischargeEncounter,
} from '@/lib/services/encounter-service';
import { createClinicalNote, saveNoteSection, signClinicalNote } from '@/lib/clinical-notes/note-service';
import { createPrescription, updatePrescription } from '@/lib/services/prescription-service';
import { createLabResult, updateLabResult, advanceLabOrder } from '@/lib/services/lab-service';
import { getTasks } from '@/lib/services/clinician-task-service';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';

afterEach(async () => {
  await teardownTestDBs();
});

const DOCTOR = { _id: 'user-dr-wani', name: 'Dr. Wani' };
const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';

async function seedWorld() {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(usersDB(), {
    _id: DOCTOR._id, type: 'user', username: 'dr.wani', name: DOCTOR.name,
    role: 'doctor', hospitalId: HOSP, orgId: ORG, isActive: true,
  } as never);
  await putDoc(patientsDB(), {
    _id: 'pat-00001', type: 'patient', firstName: 'Nyakuma', surname: 'Deng',
    structuredAllergies: [{
      id: 'alg-1', substance: 'Penicillin', criticality: 'severe',
      status: 'active', recordedAt: '2026-01-01T00:00:00.000Z',
    }],
    allergies: ['Penicillin'],
    registrationHospital: HOSP, orgId: ORG,
  } as never);
}

it('carries one visit from arrival to discharge without forking the encounter', async () => {
  await seedWorld();

  // ── Stage 2-3: front desk checks the walk-in in ───────────────────────
  const arrival = await createArrivalEncounter({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng',
    hospitalId: HOSP, hospitalName: 'Juba Teaching Hospital', orgId: ORG,
    arrivalChannel: 'walk_in', actorId: 'user-frontdesk-1',
  });
  expect(arrival.status).toBe('awaiting_triage');

  // ── Stage 4-5: the doctor claims the patient from the worklist ────────
  const claimed = await advanceEncounterToClinician(arrival._id, {
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });
  expect(claimed.status).toBe('with_clinician');
  expect(claimed.clinicianId).toBe(DOCTOR._id);

  // ── Documentation starts: a note linked to THIS visit ─────────────────
  const note = await createClinicalNote({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng', noteType: 'soap',
    serviceDate: '2026-08-08', encounterId: claimed._id,
    authorId: DOCTOR._id, authorName: DOCTOR.name,
    assignedToId: DOCTOR._id, assignedToName: DOCTOR.name,
    hospitalId: HOSP, orgId: ORG,
  } as never);
  await saveNoteSection(note._id, 'subjective', { text: 'Fever and dysuria for three days.' });

  // ── Prescribe from the note: visit-linked, org-stamped, allergy-checked ─
  const rx = await createPrescription({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng',
    encounterId: claimed._id,
    medication: 'Amoxicillin 500mg', dose: '500mg', route: 'oral',
    frequency: 'TDS', duration: '5 days',
    prescribedBy: DOCTOR.name, status: 'pending',
    hospitalId: HOSP,
  } as never);
  expect(rx.prescription.encounterId).toBe(claimed._id);
  expect(rx.prescription.orgId).toBe(ORG);           // inferred from the facility
  expect(rx.allergyWarnings?.[0]).toMatchObject({    // severe penicillin allergy fired
    allergy: 'Penicillin', requiresOverride: true,
  });

  // ── Order labs: the SAME visit pauses at awaiting_labs — no desk twin ──
  const anchored = await ensureLabOrderEncounter({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng',
    hospitalId: HOSP, orgId: ORG,
    clinicianId: DOCTOR._id, clinicianName: DOCTOR.name, actorId: DOCTOR._id,
  });
  expect(anchored._id).toBe(claimed._id);
  expect(anchored.status).toBe('awaiting_labs');
  expect(await getAllEncounters()).toHaveLength(1);

  const order = await createLabResult({
    patientId: 'pat-00001', patientName: 'Nyakuma Deng',
    encounterId: anchored._id,
    testName: 'Creatinine', status: 'pending', result: '', unit: '',
    referenceRange: '60-110', abnormal: false, critical: false,
    orderedBy: DOCTOR.name, orderedById: DOCTOR._id,
    orderedAt: new Date().toISOString(), completedAt: '',
    hospitalId: HOSP, orgId: ORG,
  } as never);
  await appendLabOrderIds(anchored._id, [order._id]);

  // The paused visit is on the doctor's resumable worklist with its order count.
  const resumable = await getResumableEncounters(DOCTOR._id);
  expect(resumable).toHaveLength(1);
  expect(resumable[0].labOrderIds).toEqual([order._id]);

  // ── The lab results it CRITICAL → task reaches the ordering doctor ────
  await updateLabResult(order._id, {
    critical: true, abnormal: true, orderStatus: 'resulted', status: 'completed',
    result: '480', unit: 'µmol/L',
  });
  const tasks = await getTasks(DOCTOR._id);
  expect(tasks).toHaveLength(1);
  expect(tasks[0].title).toContain('Critical result: Creatinine');

  // ── Resume the visit (what /consultation?encounter= now does) ─────────
  const resumed = await transitionEncounter(anchored._id, 'with_clinician', { actorId: DOCTOR._id });
  expect(resumed.status).toBe('with_clinician');

  // ── Sign the note: attestation closes the clinic portion ──────────────
  await signClinicalNote(note._id, {
    signedBy: DOCTOR._id, signedByName: DOCTOR.name, signerRole: 'doctor',
  });
  expect((await getEncounter(claimed._id))?.status).toBe('ready_for_clinic_checkout');

  // ── Checkout gate: the signed NOTE counts as documentation; the
  //    undispensed rx and unreviewed critical lab still block ────────────
  const encounterNow = (await getEncounter(claimed._id))!;
  let gate = await evaluateCheckoutGate('pat-00001', encounterNow);
  const blockedKeys = gate.blocking.map(b => b.key);
  expect(blockedKeys).toContain('prescriptions_dispensed');
  expect(blockedKeys).toContain('critical_labs_reviewed');
  expect(blockedKeys).not.toContain('required_documentation_generated');

  // Pharmacy dispenses; the doctor reviews the critical result.
  await updatePrescription(rx.prescription._id, { status: 'dispensed', orderStatus: 'dispensed' });
  await advanceLabOrder(order._id, 'reviewed_by_clinician', { reviewedBy: DOCTOR.name } as never);

  gate = await evaluateCheckoutGate('pat-00001', (await getEncounter(claimed._id))!);
  expect(gate.blocking.map(item => item.key)).toContain('post_consult_handoff');
  await expect(dischargeEncounter(claimed._id, { actorId: 'user-frontdesk-1' })).rejects.toThrow('POST_CONSULT_PENDING');
  const { updateHandoff } = await import('@/modules/post-consult/services/handoff-service');
  const nurseScope = { role: 'nurse' as const, userId: 'nurse-1', orgId: ORG, hospitalId: HOSP };
  let handed = (await getEncounter(claimed._id))!;
  handed = await updateHandoff(handed._id, handed._rev!, { type: 'accept' }, nurseScope);
  for (const task of handed.postConsult!.tasks) {
    handed = await updateHandoff(handed._id, handed._rev!, { type: 'task', kind: task.kind, status: 'done', note: 'Reviewed with patient; linked records checked.' }, nurseScope);
  }
  gate = await evaluateCheckoutGate('pat-00001', handed);
  expect(gate.canDischarge).toBe(true);

  // ── Stage 10: facility checkout walks the legal chain to discharged ───
  const discharged = await dischargeEncounter(claimed._id, { actorId: 'user-frontdesk-1' });
  expect(discharged?.status).toBe('discharged');
  expect(discharged?.closedAt).toBeTruthy();

  // Still exactly one encounter for the whole episode of care.
  expect(await getAllEncounters()).toHaveLength(1);
});
