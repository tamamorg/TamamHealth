import { appointmentCalendarClinicalAction } from '@/lib/appointment-calendar-role';
import fs from 'node:fs';
import path from 'node:path';

describe('appointment calendar role actions', () => {
  it.each(['doctor', 'clinical_officer', 'clinician'] as const)(
    'opens consultation work for %s',
    role => expect(appointmentCalendarClinicalAction(role)).toBe('consult'),
  );

  it.each(['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'] as const)(
    'opens triage work for %s',
    role => expect(appointmentCalendarClinicalAction(role)).toBe('triage'),
  );

  it.each(['front_desk', 'clinic_clerk', 'medical_superintendent', 'org_admin', 'super_admin'] as const)(
    'keeps the appointment editor for %s',
    role => expect(appointmentCalendarClinicalAction(role)).toBeNull(),
  );

  it('renders clinical workflow buttons while retaining the scheduler editor fallback', () => {
    const page = fs.readFileSync(
      path.join(process.cwd(), 'src/app/(dashboard)/appointments/page.tsx'),
      'utf8',
    );

    expect(page).toContain("t('appointments.startConsultation')");
    expect(page).toContain("t('appointments.startTriage')");
    expect(page).toContain("t('appointments.openChart')");
    expect(page).toContain('`/consultation?patientId=${encodeURIComponent(apt.patientId)}`');
    expect(page).toContain('`/triage/${encodeURIComponent(apt.patientId)}`');
    expect(page).toContain('`/patients/${encodeURIComponent(apt.patientId)}`');
    expect(page.indexOf('if (calendarClinicalAction)')).toBeLessThan(page.indexOf('<AppointmentEditModal'));
  });
});
