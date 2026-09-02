/**
 * Cross-board agreement after a triage handoff — the "mismatch between the
 * front desk, nurse and doctor boards" bug. The handoff names its provider on
 * the TRIAGE record (`assignedProviderId`); the patient document's
 * `assignedDoctor` is reception's field and is not written at triage. The
 * doctor board's "mine" test used to read only `patient.assignedDoctor`, so a
 * walk-in the nurse handed to THIS clinician was filtered off their board by
 * the default "only my patients" toggle while the front desk showed the same
 * visit In Facility.
 *
 * Drives the REAL services (check-in → triage → handoff), then the REAL board
 * pipeline (assembleDoctorWorklist → buildUnifiedPatientRows → lane).
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-lruid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());
jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB } from '@/lib/db';
import { checkInPatient } from '@/lib/services/check-in-service';
import { completeTriageHandoff } from '@/lib/services/triage-handoff-service';
import { updateTriage, getTriageByPatient } from '@/lib/services/triage-service';
import { getAppointmentsByPatient } from '@/lib/services/appointment-service';
import { getEncounter } from '@/lib/services/encounter-service';
import { appointmentStatusGroup } from '@/lib/appointment-status';
import {
  buildUnifiedPatientRows, buildActiveTriageByPatient, buildQueueEntryByPatient,
  computeRowQueueColumns, computeRowStatusGroup,
} from '@/components/ehr/EhrClinicalDashboard';
import { assembleDoctorWorklist } from '@/components/dashboards/DoctorDashboardPage';
import type { PatientDoc, TriageDoc, EncounterDoc } from '@/lib/db-types';

const ORG = 'org-moh-ss';
const HOSP1 = 'hosp-001';
const DOC = 'user-dr.wani';

async function walkInTriagedAndHandedTo(providerId?: string) {
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
    assignedProviderId: providerId, assignedProviderName: providerId ? 'Dr. Wani' : undefined,
    actorId: 'user-nurse', actorName: 'Nurse Stella', actorRole: 'nurse',
    hospitalId: HOSP1, orgId: ORG,
  });
  return checkin;
}

function doctorRows(patient: PatientDoc, triages: TriageDoc[], mineOnly: boolean, viewerId = DOC) {
  const worklist = assembleDoctorWorklist({
    patients: [patient],
    triages,
    currentUser: { _id: viewerId, name: 'Dr. Wani' },
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

it('a walk-in handed to THIS doctor at triage is on their board — with "only my patients" ON — filed In Facility', async () => {
  const checkin = await walkInTriagedAndHandedTo(DOC);
  const triages = await getTriageByPatient('pat-teny');
  const patient = await patientsDB().get('pat-teny') as PatientDoc;
  const encounter = await getEncounter(checkin.encounter._id) as EncounterDoc;

  // Front desk's view: the appointment advanced to triaged = In Facility.
  const [appt] = await getAppointmentsByPatient('pat-teny');
  expect(appt.status).toBe('triaged');
  expect(appointmentStatusGroup(appt.status)).toBe('in_office');

  // Doctor's view, default settings: visible, assigned to the viewer…
  const rows = doctorRows(patient, triages, true);
  expect(rows).toHaveLength(1);
  expect(rows[0].patient?.assignedDoctor).toBe(DOC);

  // …and the SAME lane the front desk shows: In Facility, not Upcoming.
  const active = buildActiveTriageByPatient(triages, Date.now());
  const queue = buildQueueEntryByPatient(active);
  const cols = computeRowQueueColumns(rows[0], queue.get('pat-teny') ?? null, active.get('pat-teny') ?? null, Date.now(), undefined, encounter);
  const lane = computeRowStatusGroup(rows[0].status, Boolean(cols.entry) || cols.inService, cols.operationalLane);
  expect(lane).toBe('in_office');
});

it('a triaged walk-in handed to a DIFFERENT doctor is not on this board, and not claimable as unclaimed', async () => {
  await walkInTriagedAndHandedTo('user-dr.someone-else');
  const triages = await getTriageByPatient('pat-teny');
  const patient = await patientsDB().get('pat-teny') as PatientDoc;
  expect(doctorRows(patient, triages, false)).toHaveLength(0);
});

it('a triaged walk-in with NO named provider still appears as an unclaimed row (any doctor can pick them up)', async () => {
  await walkInTriagedAndHandedTo(undefined);
  const triages = await getTriageByPatient('pat-teny');
  const patient = await patientsDB().get('pat-teny') as PatientDoc;
  const rows = doctorRows(patient, triages, false);
  expect(rows).toHaveLength(1);
  expect(rows[0].patient?.assignedDoctor).toBeUndefined();
});
