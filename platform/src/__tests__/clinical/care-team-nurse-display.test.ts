/**
 * The nurse shown on a worklist row is the nurse who was ASSIGNED.
 *
 * Reported from the appointment editor: a nurse was assigned to a visit and
 * the row above the editor still read "Nurse unassigned". Three fields are
 * involved and only one of them is the answer, so this suite pins the writer
 * and the readers to the same one.
 *
 *   assignNurseToPatient  writes  patient.assignedNurseName
 *                         and     appointment.staffName
 *   triage.triagedByName          is who took the vitals — a different person
 *   entry.assignedToName          is triage.assignedProviderName — the DOCTOR
 *
 * Source-level assertions rather than a render: the two defects were both a
 * wrong field name in an expression, which typechecks (the view model
 * declares an optional `nurse`) and renders perfectly happily as a fallback
 * string. A test that mounts the dashboard would go green against either.
 */
import fs from 'node:fs';
import path from 'node:path';

const source = (relative: string) =>
  fs.readFileSync(path.join(process.cwd(), 'src', relative), 'utf8');

/**
 * The one expression that decides a care-team cell on a unified worklist row.
 *
 * Matched on the ASSIGNMENT, not the type declaration: `UnifiedPatientRow`
 * declares `careTeamSecondary: string;` a few hundred lines above, and a
 * plain `includes` finds that first and asserts nothing.
 */
function careTeamExpression(field: 'careTeamPrimary' | 'careTeamSecondary'): string {
  const dashboard = source('components/ehr/EhrClinicalDashboard.tsx');
  const line = dashboard
    .split('\n')
    .find(l => l.includes(`${field}:`) && l.includes('||'));
  expect(line).toBeDefined();
  return line!;
}

describe('the nurse on a worklist row', () => {
  test('an appointment row reads the appointment, which is where the editor writes', () => {
    // An appointment-derived row is built with `patient: null` by
    // construction, so a patient-only lookup can never answer for exactly the
    // rows a front desk assigns a nurse to. `AppointmentEditModal` mirrors the
    // assignment onto the appointment as `staffName`.
    const expression = careTeamExpression('careTeamSecondary');
    expect(expression).toContain('row.appointment?.staffName');

    const dashboard = source('components/ehr/EhrClinicalDashboard.tsx');
    expect(dashboard).toContain('patient: null');
  });

  test('it never falls back to the queue entry, which names the doctor', () => {
    // `patient-queue-service` fills `assignedToName` from
    // `triage.assignedProviderName ?? triage.handoffToName`. Reading it here
    // printed the assigned DOCTOR in the nurse slot — and `careTeamPrimary`
    // reads the same field one line above, so both cells showed one person.
    expect(careTeamExpression('careTeamSecondary')).not.toContain('assignedToName');

    const queue = source('lib/services/patient-queue-service.ts');
    expect(queue).toContain('assignedToName: triage.assignedProviderName');
  });

  test('the doctor cell still has its own source, unchanged', () => {
    expect(careTeamExpression('careTeamPrimary')).toContain('row.provider');
  });

  test('every worklist mapper prefers the assigned nurse over the triaging nurse', () => {
    // `assignedNurseName` exists precisely because these are different people
    // — the Patient type carries a comment saying so, written the last time a
    // surface conflated them. One of the two mappers in the doctor dashboard
    // had drifted back to the triager.
    const doctorDashboard = source('components/dashboards/DoctorDashboardPage.tsx');
    const nurseLines = doctorDashboard.split('\n').filter(l => /^\s*nurse:/.test(l));
    expect(nurseLines.length).toBeGreaterThan(0);
    for (const line of nurseLines) {
      expect(line).toMatch(/assignedNurseName|staffName/);
    }
  });

  test('assignNurseToPatient writes both fields the readers depend on', () => {
    const service = source('lib/services/patient-assignment-service.ts');
    const body = service.slice(service.indexOf('export async function assignNurseToPatient'));
    expect(body).toContain('assignedNurseName: input.nurse?.name');
    expect(body).toContain('staffName: input.nurse?.name');
  });

  test('initial front-desk booking mirrors both care-team assignments onto the patient', () => {
    const booking = source('components/appointments/BookAppointmentModal.tsx');
    expect(booking).toContain('const { canBookAppointments, canAssignCareTeam } = usePermissions()');
    expect(booking).toContain('const appointment = await create({');
    expect(booking).toContain('if (canAssignCareTeam && currentUser && (providerId || staffId))');
    expect(booking).toContain('await assignProviderToPatient({');
    expect(booking).toContain('await assignNurseToPatient({');
    expect(booking.match(/appointmentId: appointment\._id/g)).toHaveLength(2);
  });

  test('a post-create assignment failure closes the booked appointment instead of inviting a duplicate', () => {
    const booking = source('components/appointments/BookAppointmentModal.tsx');
    const created = booking.indexOf('const appointment = await create({');
    const warning = booking.indexOf("t('appointments.toastBookedAssignmentIncomplete')", created);
    const callback = booking.indexOf('onBooked?.();', warning);
    const close = booking.indexOf('onClose();', callback);
    expect(created).toBeGreaterThan(-1);
    expect(warning).toBeGreaterThan(created);
    expect(callback).toBeGreaterThan(warning);
    expect(close).toBeGreaterThan(callback);
  });
});
