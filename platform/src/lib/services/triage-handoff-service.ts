import type { TriageDisposition, TriageHandoffStatus, UserRole } from '../db-types';
import { updateAppointmentStatus } from './appointment-service';
import { getEncounter, findOpenEncounterForPatient, advanceEncounterAfterTriage, escalateEncounterToEmergency, transitionEncounter } from './encounter-service';
import { updateTriage } from './triage-service';
import { syncConsultationProgressStage } from './consultation-progress-service';

export interface CompleteTriageHandoffInput {
  triageId: string;
  patientId: string;
  patientName: string;
  appointmentId?: string;
  disposition: TriageDisposition;
  destinationClinic?: string;
  assignedProviderId?: string;
  assignedProviderName?: string;
  handoffNote?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/**
 * The single triage exit path. It keeps the triage document, appointment,
 * encounter, and provider-progress tracker moving together so each queue sees
 * the same destination and handoff owner.
 */
export async function completeTriageHandoff(input: CompleteTriageHandoffInput) {
  const handoffStatus: TriageHandoffStatus = input.disposition === 'home_care'
    ? 'completed'
    : input.assignedProviderId ? 'assigned' : 'awaiting_provider';

  const triage = await updateTriage(input.triageId, {
    disposition: input.disposition,
    destinationClinic: input.destinationClinic,
    assignedProviderId: input.assignedProviderId,
    assignedProviderName: input.assignedProviderName,
    handoffNote: input.handoffNote,
    handoffStatus,
    status: input.disposition === 'home_care' ? 'discharged' : 'seen',
  });
  if (!triage) throw new Error('The triage record could not be updated.');

  // Prefer the encounter already linked by reception check-in. Falling back
  // to a patient/facility lookup keeps older triage records working, but the
  // explicit link is the source of truth and avoids losing the handoff when a
  // facility id is absent or the patient has visited more than one facility.
  const encounter = triage.encounterId
    ? await getEncounter(triage.encounterId)
    : await findOpenEncounterForPatient(input.patientId, input.hospitalId || '');
  const appointmentId = input.appointmentId || encounter?.appointmentId;

  if (appointmentId) {
    await updateAppointmentStatus(appointmentId, 'triaged', {
      actorId: input.actorId,
      actorName: input.actorName,
      actorRole: input.actorRole,
    });
  }

  if (encounter && input.disposition === 'home_care') {
    await transitionEncounter(encounter._id, 'dismissed_without_formal_checkout', {
      actorId: input.actorId,
      reason: 'Triage disposition: home care',
    });
    if (appointmentId) {
      await updateAppointmentStatus(appointmentId, 'completed', {
        actorId: input.actorId,
        actorName: input.actorName,
        actorRole: input.actorRole,
      });
    }
  } else if (encounter && input.disposition !== 'home_care') {
    if (input.disposition === 'emergency') {
      // Reception creates the visit at awaiting_triage. Escalation requires a
      // documented assessment first, so take the encounter through in_triage
      // before handing it to emergency care.
      if (encounter.status === 'awaiting_triage') {
        await transitionEncounter(encounter._id, 'in_triage', { actorId: input.actorId });
      }
      await escalateEncounterToEmergency(encounter._id, { actorId: input.actorId });
    } else {
      await advanceEncounterAfterTriage(encounter._id, {
        triageId: input.triageId,
        destinationClinic: input.destinationClinic,
        actorId: input.actorId,
      });
    }
  }

  if (input.disposition !== 'home_care') {
    try {
      await syncConsultationProgressStage({
        patientId: input.patientId,
        patientName: input.patientName,
        hospitalId: input.hospitalId || 'facility-unassigned',
        hospitalName: input.hospitalName,
        orgId: input.orgId,
        stage: 'waiting_for_provider',
        nextAction: input.assignedProviderName
          ? `Awaiting ${input.assignedProviderName}`
          : 'Assign patient to a provider',
        actor: { id: input.actorId, name: input.actorName, role: input.actorRole },
      });
    } catch {
      // The triage and encounter handoff are authoritative. Progress sync is
      // best-effort so a stale/optional progress record cannot block care.
    }
  }

  return triage;
}
