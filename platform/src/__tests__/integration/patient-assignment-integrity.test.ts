jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { putDoc, teardownTestDBs } from '../helpers/test-db';
import { appointmentsDB, patientsDB, usersDB } from '@/lib/db';
import { getAppointmentById } from '@/lib/services/appointment-service';
import { getPatientById } from '@/lib/services/patient-service';
import { assignProviderToPatient, reconcileCareTeamFromAppointment } from '@/lib/services/patient-assignment-service';
import { getConsultationProgressByAppointment } from '@/lib/services/consultation-progress-service';
import { checkInAppointment } from '@/lib/services/check-in-service';

const ORG = 'org-a';
const FACILITY = 'facility-a';

afterEach(async () => teardownTestDBs());

async function seedIdentity() {
  for (const user of [
    { _id: 'desk-1', username: 'desk', name: 'Desk One', role: 'front_desk' },
    { _id: 'doctor-1', username: 'doctor', name: 'Dr One', role: 'doctor' },
    { _id: 'nurse-1', username: 'nurse', name: 'Nurse One', role: 'nurse' },
  ]) {
    await putDoc(usersDB(), {
      ...user, type: 'user', passwordHash: 'test', isActive: true,
      orgId: ORG, hospitalId: FACILITY,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    } as never);
  }
}

async function seedPatient(id: string, extra: Record<string, unknown> = {}) {
  await putDoc(patientsDB(), {
    _id: id, type: 'patient', orgId: ORG, firstName: 'Nyakuma', surname: id,
    registrationHospital: FACILITY, ...extra,
  } as never);
}

async function seedAppointment(id: string, patientId: string, extra: Record<string, unknown> = {}) {
  await putDoc(appointmentsDB(), {
    _id: id, type: 'appointment', orgId: ORG, patientId, patientName: patientId,
    providerId: '', providerName: '', facilityId: FACILITY, facilityName: 'Facility A',
    facilityLevel: 'county', appointmentDate: '2026-09-01', appointmentTime: '10:00',
    duration: 30, appointmentType: 'general', priority: 'routine', department: 'OPD',
    reason: 'Review', status: 'scheduled', bookedBy: 'desk-1', bookedByName: 'Desk One',
    bookedAt: '2026-09-01T00:00:00.000Z', source: 'staff', ...extra,
  } as never);
}

/** A clinician-booked appointment: care team named on the slot, patient document never stamped. */
const bookedCareTeam = {
  providerId: 'doctor-1', providerName: 'Dr One',
  staffId: 'nurse-1', staffName: 'Nurse One',
};

const input = (patientId: string, appointmentId: string) => ({
  patientId, patientName: patientId,
  provider: { id: 'doctor-1', name: 'Dr One', role: 'doctor' as const },
  actor: { id: 'desk-1', name: 'Desk One', role: 'front_desk' as const },
  hospitalId: FACILITY, hospitalName: 'Facility A', orgId: ORG, appointmentId,
});

describe('patient assignment target integrity', () => {
  it('rejects an appointment belonging to another patient before any write', async () => {
    await seedIdentity();
    await seedPatient('patient-1');
    await seedPatient('patient-2');
    await seedAppointment('appointment-2', 'patient-2');

    await expect(assignProviderToPatient(input('patient-1', 'appointment-2')))
      .rejects.toThrow('appointment is outside this patient visit');
    expect((await getPatientById('patient-1'))?.assignedDoctor).toBeUndefined();
    expect((await getAppointmentById('appointment-2'))?.providerId).toBe('');
  });

  it('uses the same orchestration to assign and clear provider ownership', async () => {
    await seedIdentity();
    await seedPatient('patient-1');
    await seedAppointment('appointment-1', 'patient-1');

    await assignProviderToPatient(input('patient-1', 'appointment-1'));
    expect((await getPatientById('patient-1'))?.assignedDoctor).toBe('doctor-1');
    expect((await getAppointmentById('appointment-1'))?.providerId).toBe('doctor-1');
    expect((await getConsultationProgressByAppointment('patient-1', 'appointment-1'))?.ownerId)
      .toBe('doctor-1');

    await assignProviderToPatient({ ...input('patient-1', 'appointment-1'), provider: null });
    expect((await getPatientById('patient-1'))?.assignedDoctor).toBeUndefined();
    expect((await getPatientById('patient-1'))?.assignmentStatus).toBeUndefined();
    expect((await getAppointmentById('appointment-1'))?.providerId).toBe('');
    expect((await getConsultationProgressByAppointment('patient-1', 'appointment-1'))?.ownerId)
      .toBeUndefined();
  });
});

describe('care-team reconciliation from a booked appointment', () => {
  it('promotes the booked provider and nurse onto the patient document', async () => {
    await seedIdentity();
    await seedPatient('patient-1');
    await seedAppointment('appointment-1', 'patient-1', bookedCareTeam);

    await reconcileCareTeamFromAppointment({
      appointmentId: 'appointment-1',
      actor: { id: 'desk-1', name: 'Desk One', role: 'front_desk' },
    });

    const patient = await getPatientById('patient-1');
    expect(patient?.assignedDoctor).toBe('doctor-1');
    expect(patient?.assignedDoctorName).toBe('Dr One');
    expect(patient?.assignedNurse).toBe('nurse-1');
    expect(patient?.assignedNurseName).toBe('Nurse One');
  });

  it('skips silently for a non-reception actor instead of writing or throwing', async () => {
    // Only reception may change patient care-team fields — the CouchDB
    // validator enforces the same rule at replication, so a clinical device
    // writing them would strand the change locally. Skipping (not failing)
    // matters because this runs inside a check-in that has already succeeded.
    await seedIdentity();
    await seedPatient('patient-1');
    await seedAppointment('appointment-1', 'patient-1', bookedCareTeam);

    await reconcileCareTeamFromAppointment({
      appointmentId: 'appointment-1',
      actor: { id: 'doctor-1', name: 'Dr One', role: 'doctor' },
    });

    expect((await getPatientById('patient-1'))?.assignedDoctor).toBeUndefined();
    expect((await getPatientById('patient-1'))?.assignedNurse).toBeUndefined();
  });

  it('never clears a patient-level assignment the booking knows nothing about', async () => {
    // Promote-only: an empty slot on the booking is not a divergence. The
    // patient may have been routed through a triage handoff or another visit.
    await seedIdentity();
    await seedPatient('patient-1', {
      assignedDoctor: 'doctor-1', assignedDoctorName: 'Dr One',
      assignedNurse: 'nurse-1', assignedNurseName: 'Nurse One',
    });
    await seedAppointment('appointment-1', 'patient-1');

    await reconcileCareTeamFromAppointment({
      appointmentId: 'appointment-1',
      actor: { id: 'desk-1', name: 'Desk One', role: 'front_desk' },
    });

    const patient = await getPatientById('patient-1');
    expect(patient?.assignedDoctor).toBe('doctor-1');
    expect(patient?.assignedNurse).toBe('nurse-1');
  });

  it('heals the patient document when the front desk checks the booking in', async () => {
    // The end-to-end shape of the reported defect: a booking that names its
    // care team while the patient document says nothing. The next reception
    // touch — check-in — stamps the patient, so the doctor's and nurse's
    // assigned-patient worklists pick the visit up without anyone re-assigning.
    await seedIdentity();
    await seedPatient('patient-1');
    await seedAppointment('appointment-1', 'patient-1', bookedCareTeam);

    await checkInAppointment({
      appointmentId: 'appointment-1',
      patientId: 'patient-1',
      patientName: 'Nyakuma patient-1',
      facilityId: FACILITY,
      facilityName: 'Facility A',
      orgId: ORG,
      actorId: 'desk-1',
      actorName: 'Desk One',
      actorRole: 'front_desk',
    });

    expect((await getAppointmentById('appointment-1'))?.status).toBe('checked_in');
    const patient = await getPatientById('patient-1');
    expect(patient?.assignedDoctor).toBe('doctor-1');
    expect(patient?.assignedNurse).toBe('nurse-1');
  });
});
