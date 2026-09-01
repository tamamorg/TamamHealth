import type { UserRole } from '@/lib/db-types';

export type AppointmentCalendarClinicalAction = 'consult' | 'triage';

/**
 * Calendar events are operational work for clinical staff, not booking forms.
 * Keep the role split explicit so admin and scheduling roles retain the
 * appointment editor even when they can view the same facility calendar.
 */
export function appointmentCalendarClinicalAction(
  role?: UserRole,
): AppointmentCalendarClinicalAction | null {
  if (role === 'doctor' || role === 'clinical_officer' || role === 'clinician') {
    return 'consult';
  }

  if (role === 'nurse' || role === 'midwife' || role === 'triage_nurse' || role === 'rooming_nurse') {
    return 'triage';
  }

  return null;
}
