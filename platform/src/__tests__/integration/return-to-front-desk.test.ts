/**
 * The exits for a patient who leaves after triage — the "they just stay on
 * the assigned dashboard and nobody can do anything" gap:
 *
 *  - "Return to front desk" releases the handoff and parks the encounter at
 *    the desk-owned crossroads: the patient leaves every clinical queue and
 *    doctor worklist, stays In Facility for reception, and reception is told
 *    through the returned-to-desk notification derivation.
 *  - "End assignment" closes a standing care-team assignment in the exact
 *    shape the CouchDB validator's terminal-cleanup exception sanctions.
 *
 * Drives the real services end to end, then the real board pipeline.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-rfduid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB } from '@/lib/db';
import { checkInPatient } from '@/lib/services/check-in-service';
import { completeTriageHandoff, returnVisitToFrontDesk } from '@/lib/services/triage-handoff-service';
import { updateTriage, getTriageByPatient } from '@/lib/services/triage-service';
import { getAppointmentsByPatient } from '@/lib/services/appointment-service';
import { getEncounter } from '@/lib/services/encounter-service';
import { completePatientAssignment } from '@/lib/services/patient-assignment-service';
import { buildQueueFromTriage } from '@/lib/services/patient-queue-service';
import { appointmentStatusGroup } from '@/lib/appointment-status';
import { buildUnifiedPatientRows } from '@/components/ehr/EhrClinicalDashboard';
import { assembleDoctorWorklist } from '@/components/dashboards/DoctorDashboardPage';
import { returnedToDeskItems } from '@/modules/communication/notifications/visit-updates';
import type { EncounterDoc, PatientDoc, TriageDoc } from '@/lib/db-types';

const ORG = 'org-moh-ss';
const HOSP1 = 'hosp-001';
const DOC = 'user-dr.wani';

async function walkInTriagedAndHandedToDoc() {
  const checkin = await checkInPatient({
    patientId: 'pat-teny', patientName: 'Teny Makuach',
    facilityId: HOSP1, facilityName: 'Juba Teaching Hospital', orgId: ORG,
    chiefComplaint: 'Headache', checkedInById: 'user-desk.amira', checkedInByName: 'Amira',
  });
  await updateTriage(checkin.triage._id, {
    priority: 'YELLOW', assessmentSource: 'clinician',
    triagedAt: new Date().toISOString(), triagedBy: 'user-nurse', triagedByName: 'Nurse Stella',
  } as Partial<TriageDoc>);
  await completeTriageHandoff({
    triageId: checkin.triage._id, patientId: 'pat-teny', patientName: 'Teny Makuach',
    appointmentId: checkin.appointmentId, disposition: 'general_clinic',
    assignedProviderId: DOC, assignedProviderName: 'Dr. Wani',
    actorId: 'user-nurse', actorName: 'Nurse Stella', actorRole: 'nurse',
    hospitalId: HOSP1, orgId: ORG,
  });
  return checkin;
}

function doctorRows(patient: PatientDoc, triages: TriageDoc[], mineOnly: boolean) {
  const worklist = assembleDoctorWorklist({
    patients: [patient],
    triages,
    currentUser: { _id: DOC, name: 'Dr. Wani' },
    appointments: [],
    unsignedDrafts: [], awaitingCosign: [], heldAssessments: [], unsignedNotes: [],
    phoneNotesInbox: [], referrals: [], resumableEncounters: [], incomingTransfers: [],
    followUpsDue: [],
  } as never);
  return buildUnifiedPatientRows({
    patients: worklist.patients as never,
    selectedAppointmentsForDay: [],
    photoByPatientId: new Map(), clinicianName: 'Dr. Wani', mineOnly,
  });
}

beforeEach(async () => {
  await putDoc(hospitalsDB(), { _id: HOSP1, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(patientsDB(), { _id: 'pat-teny', type: 'patient', firstName: 'Teny', lastName: 'Makuach', orgId: ORG } as never);
});
afterEach(async () => { await teardownTestDBs(); uuidCounter = 0; });

describe('return to front desk', () => {
  it('releases the handoff, parks the encounter at the desk, and keeps the visit In Facility for reception', async () => {
    const checkin = await walkInTriagedAndHandedToDoc();

    await returnVisitToFrontDesk({
      triageId: checkin.triage._id, patientId: 'pat-teny', patientName: 'Teny Makuach',
      reason: 'Patient stepped out', actorId: DOC, actorName: 'Dr. Wani', actorRole: 'doctor',
    });

    const [triage] = await getTriageByPatient('pat-teny');
    expect(triage.handoffStatus).toBe('returned_to_desk');
    expect(triage.assignedProviderId).toBeUndefined();
    expect(triage.status).toBe('seen'); // NOT terminal — the visit is still open

    const encounter = await getEncounter(checkin.encounter._id) as EncounterDoc;
    expect(encounter.status).toBe('awaiting_next_station');

    // Reception still holds the visit: the appointment never left In Facility.
    const [appt] = await getAppointmentsByPatient('pat-teny');
    expect(appointmentStatusGroup(appt.status)).toBe('in_office');
  });

  it('removes the patient from the doctor worklist and every clinical queue', async () => {
    const checkin = await walkInTriagedAndHandedToDoc();
    await returnVisitToFrontDesk({
      triageId: checkin.triage._id, patientId: 'pat-teny', patientName: 'Teny Makuach',
      actorId: DOC, actorName: 'Dr. Wani', actorRole: 'doctor',
    });

    const triages = await getTriageByPatient('pat-teny');
    const patient = await patientsDB().get('pat-teny') as PatientDoc;
    expect(doctorRows(patient, triages, true)).toHaveLength(0);
    expect(doctorRows(patient, triages, false)).toHaveLength(0); // not "unclaimed" either
    expect(buildQueueFromTriage(triages)).toHaveLength(0);
  });

  it('tells reception — and only reception — through the returned-to-desk feed', async () => {
    const checkin = await walkInTriagedAndHandedToDoc();
    await returnVisitToFrontDesk({
      triageId: checkin.triage._id, patientId: 'pat-teny', patientName: 'Teny Makuach',
      reason: 'Needs rebooking', actorId: DOC, actorName: 'Dr. Wani', actorRole: 'doctor',
    });
    const encounter = await getEncounter(checkin.encounter._id) as EncounterDoc;

    const desk = returnedToDeskItems([encounter], { _id: 'user-desk.amira', role: 'front_desk' }, Date.now(), 10);
    expect(desk).toHaveLength(1);
    expect(desk[0].title).toContain('Returned to front desk');
    expect(desk[0].subtitle).toBe('Needs rebooking');

    expect(returnedToDeskItems([encounter], { _id: DOC, role: 'doctor' }, Date.now(), 10)).toHaveLength(0);
  });

  it('a FRESH arrival parked at the same crossroads by registration is not "returned"', () => {
    const fresh = {
      _id: 'enc-fresh', patientId: 'pat-x', patientName: 'Fresh Arrival',
      status: 'awaiting_next_station',
      statusHistory: [
        { from: null, to: 'arrived_at_facility', at: new Date().toISOString(), byUserId: 'desk' },
        { from: 'arrived_at_facility', to: 'awaiting_next_station', at: new Date().toISOString(), byUserId: 'desk' },
      ],
      updatedAt: new Date().toISOString(),
    } as unknown as EncounterDoc;
    expect(returnedToDeskItems([fresh], { _id: 'user-desk.amira', role: 'front_desk' }, Date.now(), 10)).toHaveLength(0);
  });
});

describe('end assignment', () => {
  beforeEach(async () => {
    await putDoc(patientsDB(), {
      ...(await patientsDB().get('pat-teny') as PatientDoc),
      assignedDoctor: DOC, assignedDoctorName: 'Dr. Wani', assignmentStatus: 'assigned',
    } as never);
  });

  it('the assigned clinician may close their own assignment, in the validator-sanctioned shape', async () => {
    await completePatientAssignment({
      patientId: 'pat-teny', patientName: 'Teny Makuach',
      actor: { id: DOC, name: 'Dr. Wani', role: 'doctor' },
    });
    const patient = await patientsDB().get('pat-teny') as PatientDoc;
    expect(patient.assignmentStatus).toBe('completed');
    expect(patient.assignedDoctor).toBeUndefined(); // live ownership REMOVED
    expect(patient.assignedNurse).toBeUndefined();
    expect(patient.assignedDoctorName).toBe('Dr. Wani'); // the record of who carried the care stays

    // …and the patient leaves the doctor's board.
    expect(doctorRows(patient, [], true)).toHaveLength(0);
  });

  it('a clinician who is NOT on the assignment is refused', async () => {
    await expect(completePatientAssignment({
      patientId: 'pat-teny', patientName: 'Teny Makuach',
      actor: { id: 'user-dr.someone-else', name: 'Dr. Else', role: 'doctor' },
    })).rejects.toThrow(/assigned clinician/);
  });

  it('reception may end any assignment', async () => {
    await completePatientAssignment({
      patientId: 'pat-teny', patientName: 'Teny Makuach',
      actor: { id: 'user-desk.amira', name: 'Amira', role: 'front_desk' },
    });
    const patient = await patientsDB().get('pat-teny') as PatientDoc;
    expect(patient.assignmentStatus).toBe('completed');
  });
});
