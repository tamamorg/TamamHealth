/**
 * "Show only patients assigned to me" must NOT hide the clinician's own
 * scheduled appointments from the dashboard centre panel.
 *
 * The regression: `buildUnifiedPatientRows` turns each of the clinician's own
 * bookings (the caller already scoped them to providerId === me) into a
 * standalone row carrying `isAssigned: false` and `patient: null`. The
 * mine-only filter kept only `isAssigned && patient.assignedDoctor`, so with
 * the setting on — its default — a doctor saw their assigned patients but none
 * of their appointments, even though the very same bookings showed on their
 * calendar. The fix keeps any appointment-backed row.
 */
import { buildUnifiedPatientRows, type WorklistPatient } from '@/components/ehr/EhrClinicalDashboard';
import type { AppointmentDoc } from '@/lib/db-types';

const appointment = (over: Partial<AppointmentDoc> = {}): AppointmentDoc => ({
  _id: 'appt-1', type: 'appointment', orgId: 'org-a',
  patientId: 'patient-appt', patientName: 'Teny Makuach',
  providerId: 'dr-1', providerName: 'Dr. James Wani Igga',
  facilityId: 'hosp-1', facilityName: 'Juba Teaching Hospital', facilityLevel: 'national',
  appointmentDate: '2026-09-02', appointmentTime: '16:00', duration: 30,
  appointmentType: 'general', priority: 'routine', department: 'OPD',
  reason: 'General Consultation', status: 'scheduled',
  createdAt: '2026-09-02T08:00:00.000Z', updatedAt: '2026-09-02T08:00:00.000Z',
  ...over,
} as AppointmentDoc);

const assignedPatient = (over: Partial<WorklistPatient> = {}): WorklistPatient => ({
  _id: 'patient-assigned', name: 'Deng Garang', age: 30, gender: 'M',
  assignedDoctor: 'dr-1', assignmentStatus: 'assigned',
  ...over,
});

describe('mine-only keeps the clinician’s own appointments', () => {
  it('surfaces a standalone appointment row even with mineOnly on', () => {
    const rows = buildUnifiedPatientRows({
      patients: [assignedPatient()],
      selectedAppointmentsForDay: [appointment()],
      photoByPatientId: new Map(),
      clinicianName: 'Dr. James Wani Igga',
      mineOnly: true,
    });
    const names = rows.map(r => r.name);
    expect(names).toContain('Teny Makuach');   // the appointment
    expect(names).toContain('Deng Garang');    // the assigned patient
    const apptRow = rows.find(r => r.name === 'Teny Makuach');
    expect(apptRow?.appointment?._id).toBe('appt-1');
    expect(apptRow?.isAssigned).toBe(false);
  });

  it('still hides an unclaimed triage row (no appointment, no assignment) with mineOnly on', () => {
    // The exact thing the setting exists to hide: a patient surfaced for any
    // doctor to claim, with no appointment and no assignment to this one.
    const rows = buildUnifiedPatientRows({
      patients: [assignedPatient({ _id: 'unclaimed', name: 'Walk In', assignedDoctor: undefined, assignmentStatus: undefined })],
      selectedAppointmentsForDay: [],
      photoByPatientId: new Map(),
      clinicianName: 'Dr. James Wani Igga',
      mineOnly: true,
    });
    expect(rows.map(r => r.name)).not.toContain('Walk In');
  });

  it('with mineOnly off, everything shows regardless', () => {
    const rows = buildUnifiedPatientRows({
      patients: [assignedPatient()],
      selectedAppointmentsForDay: [appointment()],
      photoByPatientId: new Map(),
      clinicianName: 'Dr. James Wani Igga',
      mineOnly: false,
    });
    expect(rows.map(r => r.name).sort()).toEqual(['Deng Garang', 'Teny Makuach']);
  });
});
