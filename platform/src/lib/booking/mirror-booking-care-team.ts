/**
 * After a booking, mirror its provider and second staff member onto the
 * patient's care team — the fields the doctor and nurse worklists read.
 *
 * Only reception may change a patient's care team (CARE_TEAM_ASSIGNMENT_ROLES;
 * the CouchDB validator refuses anyone else), so a clinician's booking stays
 * appointment-only and the caller passes `canAssignCareTeam` false; the desk
 * reconciles it at check-in (reconcileCareTeamFromAppointment).
 *
 * The two assignments are attempted independently: if the provider's tracker
 * follow-up throws after writing the patient fields, the nurse must still be
 * mirrored. Returns the failures so the caller can say the booking stands but
 * the care team is incomplete.
 */
import type { AppointmentDoc, UserRole } from '@/lib/db-types';

export async function mirrorBookingCareTeam({ appointment, canAssignCareTeam, actor, providerRole }: {
  appointment: AppointmentDoc;
  canAssignCareTeam: boolean;
  actor: { id: string; name: string; role: UserRole; hospitalId?: string; hospitalName?: string; orgId?: string };
  providerRole?: UserRole;
}): Promise<unknown[]> {
  const failures: unknown[] = [];
  if (!canAssignCareTeam || (!appointment.providerId && !appointment.staffId)) return failures;
  const { assignProviderToPatient, assignNurseToPatient } = await import('@/lib/services/patient-assignment-service');
  const who = { id: actor.id, name: actor.name, role: actor.role };
  const hospitalId = appointment.facilityId || actor.hospitalId;
  const orgId = appointment.orgId || actor.orgId;

  if (appointment.providerId) {
    try {
      await assignProviderToPatient({
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        provider: { id: appointment.providerId, name: appointment.providerName, role: providerRole },
        actor: who,
        hospitalId,
        hospitalName: appointment.facilityName || actor.hospitalName,
        orgId,
        appointmentId: appointment._id,
      });
    } catch (error) {
      failures.push(error);
    }
  }
  if (appointment.staffId) {
    try {
      await assignNurseToPatient({
        patientId: appointment.patientId,
        nurse: { id: appointment.staffId, name: appointment.staffName || 'Nurse' },
        actor: who,
        hospitalId,
        orgId,
        appointmentId: appointment._id,
      });
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}
