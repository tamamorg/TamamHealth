/**
 * Reception's walk-in must open the visit thread, not just the booking.
 *
 * Registering a walk-in writes an appointment already `checked_in` and then
 * opens the arrival encounter every downstream station joins — the rooming
 * queue, triage, the clinician's note, the checkout gate. Driving the real
 * screens turned up a patient who was CHECKED IN on the reception board and on
 * no nursing worklist at all, so this exercises the same sequence the
 * appointments page runs, against the real services.
 */
let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `${String(++uuidCounter).padStart(8, '0')}-wuid` }));
jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

jest.setTimeout(30000);

import { teardownTestDBs, putDoc } from '../helpers/test-db';
import { hospitalsDB, patientsDB } from '@/lib/db';
import { findOpenEncounterForPatient, createArrivalEncounter } from '@/lib/services/encounter-service';
import { deriveAttendanceType } from '@/lib/services/check-in-service';
import { getRoomingWorklist } from '@/lib/services/rooming-service';

afterEach(async () => {
  await teardownTestDBs();
});

const HOSP = 'hosp-001';
const ORG = 'org-moh-ss';
const SCOPE = { role: 'triage_nurse' as const, orgId: ORG, hospitalId: HOSP };

async function seedWorld() {
  await putDoc(hospitalsDB(), { _id: HOSP, type: 'hospital', name: 'Juba Teaching Hospital', orgId: ORG } as never);
  await putDoc(patientsDB(), {
    _id: 'pat-walkin', type: 'patient', firstName: 'Nyalel', surname: 'Ajak',
    registrationHospital: HOSP, orgId: ORG,
  } as never);
}

it('puts a just-checked-in walk-in on the nursing worklist', async () => {
  await seedWorld();

  // The exact block the appointments page runs after writing the booking.
  const existing = await findOpenEncounterForPatient('pat-walkin', HOSP);
  expect(existing).toBeFalsy();

  const attendanceType = await deriveAttendanceType('pat-walkin');
  const arrival = await createArrivalEncounter({
    patientId: 'pat-walkin',
    patientName: 'Nyalel Ajak',
    hospitalId: HOSP,
    hospitalName: 'Juba Teaching Hospital',
    orgId: ORG,
    arrivalChannel: 'walk_in',
    appointmentId: 'apt-walkin',
    attendanceType,
    actorId: 'user-desk.amira',
  });

  // Reception's check-in leaves the patient waiting for triage...
  expect(arrival.status).toBe('awaiting_triage');

  // ...and that is what the nursing queue is meant to show, before anybody
  // has recorded a triage for them.
  const worklist = await getRoomingWorklist(SCOPE);
  expect(worklist.map(e => e.encounter.patientId)).toContain('pat-walkin');
  expect(worklist.find(e => e.encounter.patientId === 'pat-walkin')?.step).toBe('awaiting_triage');
});
