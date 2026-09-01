import type { AppointmentDoc, UserRole } from './db-types';

export interface AppointmentViewer {
  _id: string;
  role: UserRole;
}

/** Roles whose job requires operating the whole facility book. */
export const FACILITY_APPOINTMENT_ROLES: readonly UserRole[] = [
  'front_desk',
  'central_registration_clerk',
  'clinic_clerk',
  'medical_superintendent',
  'hospital_manager',
  'org_admin',
  'super_admin',
];

const PROVIDER_ROLES: readonly UserRole[] = ['doctor', 'clinical_officer', 'clinician'];
const NURSING_ROLES: readonly UserRole[] = ['nurse', 'midwife', 'triage_nurse', 'rooming_nurse'];

/**
 * Calendar/worklist visibility is narrower than tenant data visibility.
 * Clinical users see their assigned book; operational scheduling roles see the
 * facility book. The patient registry remains the place to find unassigned
 * patients.
 */
export function canViewAppointment(appointment: AppointmentDoc, viewer?: AppointmentViewer | null): boolean {
  if (!viewer) return false;
  // A registry entry is not a calendar entry. Until a clinician or supporting
  // nurse owns the visit, keep it in the patient registry instead of placing
  // an unowned patient on every operational calendar.
  if (!appointment.providerId && !appointment.staffId) return false;
  if (FACILITY_APPOINTMENT_ROLES.includes(viewer.role)) return true;
  if (PROVIDER_ROLES.includes(viewer.role)) return appointment.providerId === viewer._id;
  // At primary-care facilities a nurse or midwife may carry the visit as the
  // responsible provider rather than as secondary staff.
  if (NURSING_ROLES.includes(viewer.role)) {
    return appointment.staffId === viewer._id || appointment.providerId === viewer._id;
  }
  return false;
}

export function appointmentsVisibleToUser(
  appointments: AppointmentDoc[],
  viewer?: AppointmentViewer | null,
): AppointmentDoc[] {
  return appointments.filter(appointment => canViewAppointment(appointment, viewer));
}
