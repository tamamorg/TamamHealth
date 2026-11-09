/**
 * A walk-in the doctor saw, once checked out, belongs in that doctor's Finished
 * lane for the day, as a booked appointment does. The walk-in's booking is
 * written at check-in with NO provider, so the board used to drop it the
 * moment the visit closed (and the assignment cache on the patient is cleared
 * at discharge). Also: "Finish visit" moves it to clinic checkout and shows it
 * in Finished before the money and nursing gates are passed.
 *
 * Real services on in-memory PouchDB, then the real board pipeline.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-wifuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB } from '@/lib/db';
import { checkInPatient } from '@/lib/services/check-in-service';
import { completeTriageHandoff } from '@/lib/services/triage-handoff-service';
import { updateTriage, getTriageByPatient } from '@/lib/services/triage-service';
import { getAppointmentsByPatient } from '@/lib/services/appointment-service';
import { advanceEncounterToClinician, dischargeEncounter, getEncounter, getAllEncounters } from '@/lib/services/encounter-service';
import { createClinicalNote, saveNoteSection, signClinicalNote } from '@/lib/clinical-notes/note-service';
import { finishVisit } from '@/lib/services/finish-visit-service';
import { evaluateCheckoutGate } from '@/lib/services/checkout-gate-service';
import { buildUnifiedPatientRows, computeRowQueueColumns } from '@/components/ehr/EhrClinicalDashboard';
import { assembleDoctorWorklist } from '@/components/dashboards/DoctorDashboardPage';
import type { EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';

const TEST_SCOPE = { role: 'super_admin' } as import('@/lib/services/data-scope').DataScope;
const ORG = 'org-moh-ss';
const HOSP1 = 'hosp-001';
const DOC = 'user-dr.wani';

async function board() {
  const patient = await patientsDB().get('pat-teny') as PatientDoc;
  const triages = await getTriageByPatient('pat-teny', TEST_SCOPE);
  const encounters = await getAllEncounters();
  const appointments = await getAppointmentsByPatient('pat-teny');
  const worklist = assembleDoctorWorklist({
    patients: [patient], triages, encounters,
    currentUser: { _id: DOC, name: 'Dr. Wani' },
    appointments,
    unsignedDrafts: [], awaitingCosign: [], heldAssessments: [], unsignedNotes: [],
    phoneNotesInbox: [], referrals: [], resumableEncounters: [], incomingTransfers: [],
    followUpsDue: [],
  } as never);
  const rows = buildUnifiedPatientRows({
    patients: worklist.patients as never,
    selectedAppointmentsForDay: worklist.appointments,
    photoByPatientId: new Map(), clinicianName: 'Dr. Wani', mineOnly: true,
  });
  const encounter = encounters[0] as EncounterDoc | undefined;
  return rows.map(row => computeRowQueueColumns(row, null, null, Date.now(), undefined, encounter, false).visitTab);
}

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP1, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(patientsDB(), { _id: 'pat-teny', type: 'patient', firstName: 'Teny', lastName: 'Makuach', orgId: ORG } as never);
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('walk-in the doctor saw', () => {
  it('Finish visit moves it to clinic checkout and Finished; checkout keeps it there', async () => {
    const checkin = await checkInPatient({
      patientId: 'pat-teny', patientName: 'Teny Makuach',
      facilityId: HOSP1, facilityName: 'Juba Teaching Hospital', orgId: ORG,
      chiefComplaint: 'Headache', checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
    });
    await updateTriage(checkin.triage._id, {
      priority: 'YELLOW', assessmentSource: 'clinician',
      triagedAt: new Date().toISOString(), triagedBy: 'user-nurse', triagedByName: 'Nurse Stella',
    } as Partial<TriageDoc>, TEST_SCOPE);
    await completeTriageHandoff({ scope: TEST_SCOPE,
      triageId: checkin.triage._id, patientId: 'pat-teny', patientName: 'Teny Makuach',
      appointmentId: checkin.appointmentId, disposition: 'general_clinic',
      assignedProviderId: DOC, assignedProviderName: 'Dr. Wani',
      actorId: 'user-nurse', actorName: 'Nurse Stella', actorRole: 'nurse',
      hospitalId: HOSP1, orgId: ORG,
    });
    // The booking carries no provider: that is why the board lost it.
    const [appt] = await getAppointmentsByPatient('pat-teny');
    expect(appt.providerId || '').toBe('');

    await advanceEncounterToClinician(checkin.encounter._id, { clinicianId: DOC, clinicianName: 'Dr. Wani', actorId: DOC });
    expect(await board()).toEqual(['in_office']);

    // Finish visit: the doctor's part is over. Checkout gates still stand.
    const finished = await finishVisit(checkin.encounter._id, { id: DOC, role: 'doctor' });
    expect(finished.status).toBe('ready_for_clinic_checkout');
    expect(await board()).toEqual(['finished']);
    const gate = await evaluateCheckoutGate('pat-teny', (await getEncounter(checkin.encounter._id))!);
    expect(gate.canDischarge).toBe(false);
    await expect(dischargeEncounter(checkin.encounter._id, { actorId: 'user-desk', actorRole: 'front_desk' })).rejects.toThrow('CHECKOUT_BLOCKED');

    // The doctor signs the note afterwards (documentation gate), then checkout.
    const note = await createClinicalNote({
      patientId: 'pat-teny', patientName: 'Teny Makuach', noteType: 'soap',
      serviceDate: new Date().toISOString().slice(0, 10), encounterId: checkin.encounter._id,
      authorId: DOC, authorName: 'Dr. Wani', assignedToId: DOC, assignedToName: 'Dr. Wani',
      hospitalId: HOSP1, orgId: ORG,
    } as never);
    await saveNoteSection(note._id, 'subjective', { text: 'Headache.' });
    await saveNoteSection(note._id, 'assessment', { text: 'Tension headache.' });
    await saveNoteSection(note._id, 'plan', { text: 'Analgesia and review.' });
    await signClinicalNote(note._id, { signedBy: DOC, signedByName: 'Dr. Wani', signerRole: 'doctor' });

    // Checked out through the post-consult handoff, as the desk does.
    const { updateHandoff } = await import('@/modules/post-consult/services/handoff-service');
    const nurseScope = { role: 'nurse' as const, userId: 'nurse-1', orgId: ORG, hospitalId: HOSP1 };
    let handed = (await getEncounter(checkin.encounter._id))!;
    handed = await updateHandoff(handed._id, handed._rev!, { type: 'accept' }, nurseScope);
    for (const task of handed.postConsult!.tasks) {
      handed = await updateHandoff(handed._id, handed._rev!, { type: 'task', kind: task.kind, status: 'done', note: 'Done with the patient.' }, nurseScope);
    }
    const discharged = await dischargeEncounter(checkin.encounter._id, { actorId: 'user-desk', actorRole: 'front_desk' });
    expect(discharged?.status).toBe('discharged');

    // The assignment cache is cleared at discharge; the walk-in is still on the doctor's day.
    expect(await board()).toEqual(['finished']);
  });
});
