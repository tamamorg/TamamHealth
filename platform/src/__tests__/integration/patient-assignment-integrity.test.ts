jest.mock('@/lib/db', () => require('../helpers/test-db').createDBMock());

import { putDoc, teardownTestDBs } from '../helpers/test-db';
import { appointmentsDB, patientsDB, usersDB } from '@/lib/db';
import { getAppointmentById } from '@/lib/services/appointment-service';
import { getPatientById } from '@/lib/services/patient-service';
import { assignProviderToPatient } from '@/lib/services/patient-assignment-service';
import { getConsultationProgressByAppointment } from '@/lib/services/consultation-progress-service';

const ORG = 'org-a';
const FACILITY = 'facility-a';

afterEach(async () => teardownTestDBs());

async function seedIdentity() {
  for (const user of [
    { _id: 'desk-1', username: 'desk', name: 'Desk One', role: 'front_desk' },
    { _id: 'doctor-1', username: 'doctor', name: 'Dr One', role: 'doctor' },
  ]) {
    await putDoc(usersDB(), {
      ...user, type: 'user', passwordHash: 'test', isActive: true,
      orgId: ORG, hospitalId: FACILITY,
      createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    } as never);
  }
}

async function seedPatient(id: string) {
  await putDoc(patientsDB(), {
    _id: id, type: 'patient', orgId: ORG, firstName: 'Nyakuma', surname: id,
    registrationHospital: FACILITY,
  } as never);
}

async function seedAppointment(id: string, patientId: string) {
  await putDoc(appointmentsDB(), {
    _id: id, type: 'appointment', orgId: ORG, patientId, patientName: patientId,
    providerId: '', providerName: '', facilityId: FACILITY, facilityName: 'Facility A',
    facilityLevel: 'county', appointmentDate: '2026-09-01', appointmentTime: '10:00',
    duration: 30, appointmentType: 'general', priority: 'routine', department: 'OPD',
    reason: 'Review', status: 'scheduled', bookedBy: 'desk-1', bookedByName: 'Desk One',
    bookedAt: '2026-09-01T00:00:00.000Z', source: 'staff',
  } as never);
}

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
