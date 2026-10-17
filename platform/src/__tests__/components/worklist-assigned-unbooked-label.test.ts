/**
 * An assigned patient with no booking today must not read as a booking.
 *
 * The row synthesizes status 'scheduled' when there is no appointment, and the
 * status cell read only `patient.assignmentStatus` — empty on most patients
 * whose doctor was set — so it fell through to statusLabel('scheduled') and the
 * doctor saw a SCHEDULED pill for a patient nobody had booked. The front desk,
 * whose board is built from appointments, correctly showed nothing, and the two
 * boards appeared to disagree about who was expected.
 */
import {
  buildUnifiedPatientRows, computeRowQueueColumns, type WorklistPatient,
} from '@/components/ehr/EhrClinicalDashboard';

const patient = (over: Partial<WorklistPatient> = {}): WorklistPatient => ({
  _id: 'patient-assigned', name: 'Ekow Shamaya', age: 30, gender: 'M',
  assignedDoctor: 'dr-1',
  ...over,
});

const columnsFor = (p: WorklistPatient) => {
  const [row] = buildUnifiedPatientRows({
    patients: [p], selectedAppointmentsForDay: [], photoByPatientId: new Map(), clinicianName: 'Dr. Hycent',
  });
  return computeRowQueueColumns(row, null, null, Date.now());
};

describe('assigned patient with no booking', () => {
  it('says Assigned, not Scheduled, when assignmentStatus was never written', () => {
    expect(columnsFor(patient()).statusText).toBe('Assigned');
  });

  it('says there is no booking today instead of "Assigned list"', () => {
    expect(columnsFor(patient()).waitSubtext).toBe('No booking today');
  });

  it('still follows an explicit assignment status', () => {
    expect(columnsFor(patient({ assignmentStatus: 'accepted' })).statusText).toBe('Accepted');
  });
});

describe('assigned patient WITH a booking', () => {
  it('keeps the appointment status rather than the assignment default', () => {
    const [row] = buildUnifiedPatientRows({
      patients: [patient()],
      selectedAppointmentsForDay: [{
        _id: 'appt-1', type: 'appointment', patientId: 'patient-assigned', patientName: 'Ekow Shamaya',
        providerId: 'dr-1', providerName: 'Dr. Hycent', facilityId: 'h', facilityName: 'H', facilityLevel: 'county',
        appointmentDate: '2026-10-17', appointmentTime: '09:00', duration: 30, appointmentType: 'general',
        priority: 'routine', department: 'OPD', reason: 'Review', status: 'cancelled',
        createdAt: '2026-10-17T08:00:00Z', updatedAt: '2026-10-17T08:00:00Z',
      } as never],
      photoByPatientId: new Map(), clinicianName: 'Dr. Hycent',
    });
    expect(computeRowQueueColumns(row, null, null, Date.now()).statusText).not.toBe('Assigned');
  });
});
