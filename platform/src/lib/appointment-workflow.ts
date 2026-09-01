import { APPOINTMENT_STATUS_EXITS } from '@/lib/appointment-status';
import type { AppointmentDoc, AppointmentStatus } from '@/lib/db-types';

export function isPendingApproval(
  appointment: { status: AppointmentStatus; appointmentDate: string },
  today: string,
): boolean {
  return appointment.status === 'requested' && appointment.appointmentDate >= today;
}

export function findActiveAppointmentForPatient(
  todaysAppointments: AppointmentDoc[],
  patientId: string,
  encounterAppointmentId?: string,
): AppointmentDoc | undefined {
  if (encounterAppointmentId) {
    const linked = todaysAppointments.find(
      appointment => appointment._id === encounterAppointmentId && appointment.patientId === patientId,
    );
    if (linked) return linked;
  }

  return todaysAppointments.find(
    appointment => appointment.patientId === patientId && !APPOINTMENT_STATUS_EXITS.includes(appointment.status),
  );
}
