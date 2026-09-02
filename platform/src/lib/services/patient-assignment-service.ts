/**
 * Who a patient belongs to right now — the provider carrying the visit, and the
 * nurse looking after them.
 *
 * Assigning a provider is more than a field write: it stamps the patient's
 * assignment fields, opens (or reuses) the shared consultation-progress tracker
 * so the provider's board shows the handoff, and records the handoff on the
 * triage entry the patient arrived through. That sequence lived inside
 * `AssignDoctorModal`, which meant the front desk's inline pickers could only
 * have had a partial copy of it. It lives here so every entry point performs
 * the same assignment.
 *
 * Ordering matters: the patient document is the source of truth and is written
 * first. The tracker and the triage stamp are additive, so a failure in either
 * leaves the assignment standing rather than rolling it back.
 */
import type { UserRole } from '../db-types';
import { canAssignCareTeamRole, canAssignStaffAtFacility } from '../care-team-permissions';

export interface AssignmentActor {
  id?: string;
  name?: string;
  /** Kept to `UserRole` so it feeds the consultation tracker unchanged. */
  role?: UserRole;
}

export interface AssignProviderInput {
  patientId: string;
  patientName: string;
  provider: { id: string; name: string; role?: UserRole } | null;
  actor?: AssignmentActor;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
  /** The triage entry the patient arrived through, when there is one. */
  triageId?: string;
  appointmentId?: string;
  encounterId?: string;
  note?: string;
}

/** Assigns the provider who will carry the visit. */
export async function assignProviderToPatient(input: AssignProviderInput): Promise<void> {
  await assertCanAssign(input.actor, input.hospitalId, input.orgId);
  if (input.provider) {
    await assertAssignableStaff(input.provider.id, input.hospitalId, input.orgId, [
      'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
      'nurse', 'midwife', 'triage_nurse', 'rooming_nurse',
    ]);
  }
  const { patient, encounter, appointment, triage } = await resolveAndValidateTargets(input);
  const now = new Date().toISOString();
  const { updatePatient } = await import('./patient-service');
  const updatedPatient = await updatePatient(patient._id, {
    assignedDoctor: input.provider?.id,
    assignedDoctorName: input.provider?.name,
    assignedAt: input.provider ? now : undefined,
    assignedBy: input.provider ? input.actor?.id : undefined,
    assignedByName: input.provider ? input.actor?.name : undefined,
    assignmentNote: input.provider ? input.note?.trim() || undefined : undefined,
    assignmentStatus: input.provider ? 'assigned' : undefined,
    assignmentSource: input.provider ? 'front_desk' : undefined,
    assignmentTransferId: undefined,
    // A fresh assignment is unaccepted, whatever the previous provider had done.
    assignmentAcceptedAt: undefined,
    assignmentAcceptedBy: undefined,
    assignmentAcceptedByName: undefined,
  });
  if (!updatedPatient) throw new Error('The patient could not be updated');

  const appointmentId = appointment?._id;
  if (appointment) {
    const { updateAppointment } = await import('./appointment-service');
    const updated = await updateAppointment(appointment._id, {
      providerId: input.provider?.id || '',
      providerName: input.provider?.name || '',
    });
    if (!updated) {
      const error = new Error('Failed to update the assigned appointment');
      await recordAssignmentRepair(input, 'appointment', error, appointmentId, encounter?._id);
      throw error;
    }
  }
  if (encounter) {
    const { updateEncounter } = await import('./encounter-service');
    const updated = await updateEncounter(encounter._id, {
      assignedClinicianId: input.provider?.id,
      assignedClinicianName: input.provider?.name,
      assignedAt: input.provider ? now : undefined,
      assignedBy: input.provider ? input.actor?.id : undefined,
      assignedByName: input.provider ? input.actor?.name : undefined,
    });
    if (!updated) {
      const error = new Error('Failed to update the assigned encounter');
      await recordAssignmentRepair(input, 'encounter', error, appointmentId, encounter._id);
      throw error;
    }
  }

  if (input.provider) try {
    const { ensureConsultationProgress, assignProgressOwner, updateProgressStage } =
      await import('./consultation-progress-service');
    const tracker = await ensureConsultationProgress({
      patientId: input.patientId,
      patientName: input.patientName,
      hospitalId: input.hospitalId || '',
      hospitalName: input.hospitalName || '',
      orgId: input.orgId,
      encounterId: encounter?._id,
      appointmentId,
      actor: input.actor,
    });
    await assignProgressOwner(tracker._id, input.provider, input.actor);
    await updateProgressStage(tracker._id, 'waiting_for_provider', input.actor, 'Provider to accept assignment');
  } catch (error) {
    await recordAssignmentRepair(input, 'consultation_progress', error, appointmentId, encounter?._id);
  }

  if (!input.provider) {
    try {
      const {
        assignProgressOwner, getConsultationProgressByAppointment,
        getConsultationProgressByEncounter, updateProgressStage,
      } = await import('./consultation-progress-service');
      const tracker = encounter
        ? await getConsultationProgressByEncounter(input.patientId, encounter._id)
        : appointmentId
          ? await getConsultationProgressByAppointment(input.patientId, appointmentId)
          : null;
      if (tracker && tracker.currentStage !== 'completed' && tracker.currentStage !== 'cancelled') {
        await assignProgressOwner(tracker._id, {}, input.actor);
        await updateProgressStage(tracker._id, 'waiting_for_provider', input.actor, 'Assign a provider');
      }
    } catch (error) {
      await recordAssignmentRepair(input, 'consultation_progress', error, appointmentId, encounter?._id);
    }
  }

  if (triage) {
    try {
      const { updateTriage } = await import('./triage-service');
      await updateTriage(triage._id, {
        handoffTo: input.provider?.id,
        handoffToName: input.provider?.name,
        handoffAt: input.provider ? now : undefined,
        handoffStatus: input.provider ? 'assigned' : 'awaiting_provider',
      });
    } catch (error) {
      await recordAssignmentRepair(input, 'triage_handoff', error, appointmentId, encounter?._id);
    }
  }
}

export interface AssignNurseInput {
  patientId: string;
  nurse: { id: string; name: string } | null;
  actor?: AssignmentActor;
  hospitalId?: string;
  orgId?: string;
  appointmentId?: string;
  encounterId?: string;
}

/**
 * Assigns (or clears) the nurse looking after the patient. Deliberately lighter
 * than a provider assignment: nursing care needs no acceptance handshake and no
 * consultation tracker — the desk records who is covering the patient and the
 * ward boards read it back.
 */
export async function assignNurseToPatient(input: AssignNurseInput): Promise<void> {
  await assertCanAssign(input.actor, input.hospitalId, input.orgId);
  if (input.nurse) {
    await assertAssignableStaff(input.nurse.id, input.hospitalId, input.orgId, [
      'nurse', 'midwife', 'triage_nurse', 'rooming_nurse',
    ]);
  }
  const { patient, encounter, appointment } = await resolveAndValidateTargets(input);
  const now = new Date().toISOString();
  const { updatePatient } = await import('./patient-service');
  const updatedPatient = await updatePatient(patient._id, {
    assignedNurse: input.nurse?.id,
    assignedNurseName: input.nurse?.name,
    assignedNurseAt: input.nurse ? now : undefined,
    assignedNurseBy: input.nurse ? input.actor?.id : undefined,
    assignedNurseByName: input.nurse ? input.actor?.name : undefined,
  });
  if (!updatedPatient) throw new Error('The patient could not be updated');

  const appointmentId = appointment?._id;
  if (appointment) {
    const { updateAppointment } = await import('./appointment-service');
    const updated = await updateAppointment(appointment._id, {
      staffId: input.nurse?.id,
      staffName: input.nurse?.name,
    });
    if (!updated) {
      const error = new Error('Failed to update the assigned appointment');
      await recordAssignmentRepair(input, 'appointment', error, appointmentId, encounter?._id);
      throw error;
    }
  }
  if (encounter) {
    const { updateEncounter } = await import('./encounter-service');
    const updated = await updateEncounter(encounter._id, {
      assignedNurseId: input.nurse?.id,
      assignedNurseName: input.nurse?.name,
      assignedAt: input.nurse ? now : encounter.assignedAt,
      assignedBy: input.nurse ? input.actor?.id : encounter.assignedBy,
      assignedByName: input.nurse ? input.actor?.name : encounter.assignedByName,
    });
    if (!updated) {
      const error = new Error('Failed to update the assigned encounter');
      await recordAssignmentRepair(input, 'encounter', error, appointmentId, encounter._id);
      throw error;
    }
  }
}

async function assertCanAssign(
  actor?: AssignmentActor,
  hospitalId?: string,
  orgId?: string,
): Promise<void> {
  // Assignment changes accountability for a patient. Require an identified
  // reception actor at the service boundary; hiding a picker is not an
  // authorization control, and an actor-less call must not become a bypass.
  if (!actor?.id || !canAssignCareTeamRole(actor.role)) {
    throw new Error('Only front desk staff can assign doctors or nurses');
  }
  const { getUserById } = await import('@/modules/identity/services/user-service');
  const actualActor = await getUserById(actor.id);
  if (
    !actualActor || actualActor.isActive === false ||
    !canAssignCareTeamRole(actualActor.role) ||
    !orgId || actualActor.orgId !== orgId ||
    !canAssignStaffAtFacility(hospitalId, actualActor.hospitalId)
  ) {
    throw new Error('The assignment actor is not authorized at this facility');
  }
}

async function assertAssignableStaff(
  staffId: string,
  hospitalId: string | undefined,
  orgId: string | undefined,
  allowedRoles: readonly UserRole[],
): Promise<void> {
  const { getUserById } = await import('@/modules/identity/services/user-service');
  const staff = await getUserById(staffId);
  if (
    !staff || staff.isActive === false || !allowedRoles.includes(staff.role) ||
    !orgId || staff.orgId !== orgId ||
    !canAssignStaffAtFacility(hospitalId, staff.hospitalId)
  ) {
    throw new Error('The selected staff member is not assignable at this facility');
  }
}

async function resolveAndValidateTargets(input: {
  patientId: string;
  hospitalId?: string;
  orgId?: string;
  appointmentId?: string;
  encounterId?: string;
  triageId?: string;
}) {
  if (!input.orgId || !input.hospitalId) throw new Error('Organization and facility are required for assignment');
  const { getPatientById } = await import('./patient-service');
  const patient = await getPatientById(input.patientId);
  if (!patient) throw new Error('The patient does not exist');
  if (patient.orgId !== input.orgId) throw new Error('The patient is outside the assignment organization');

  const { getEncounter, findOpenEncounterForPatient } = await import('./encounter-service');
  const encounter = input.encounterId
    ? await getEncounter(input.encounterId)
    : input.hospitalId
      ? await findOpenEncounterForPatient(input.patientId, input.hospitalId)
      : null;
  if (encounter && (
    encounter.patientId !== input.patientId ||
    encounter.orgId !== input.orgId ||
    encounter.hospitalId !== input.hospitalId
  )) {
    throw new Error('The encounter is outside this patient visit');
  }

  const appointmentId = input.appointmentId || encounter?.appointmentId;
  const { getAppointmentById } = await import('./appointment-service');
  const appointment = appointmentId ? await getAppointmentById(appointmentId) : null;
  if (appointmentId && !appointment) throw new Error('The appointment does not exist');
  if (appointment && (
    appointment.patientId !== input.patientId ||
    appointment.orgId !== input.orgId ||
    appointment.facilityId !== input.hospitalId ||
    (encounter?.appointmentId && encounter.appointmentId !== appointment._id)
  )) {
    throw new Error('The appointment is outside this patient visit');
  }

  const { getTriageByEncounter, getTriageById } = await import('./triage-service');
  const triage = input.triageId
    ? await getTriageById(input.triageId)
    : encounter
      ? await getTriageByEncounter(encounter._id)
      : null;
  if (input.triageId && !triage) throw new Error('The triage record does not exist');
  if (triage && (
    triage.patientId !== input.patientId ||
    triage.orgId !== input.orgId ||
    // Older triage records predate the required facility stamp. Their linked
    // encounter has already established the visit facility above; reject only
    // an explicit conflicting value rather than stranding a legacy visit.
    (triage.facilityId && triage.facilityId !== input.hospitalId) ||
    (triage.encounterId && encounter && triage.encounterId !== encounter._id)
  )) {
    throw new Error('The triage record is outside this patient visit');
  }

  return { patient, encounter, appointment, triage };
}

async function recordAssignmentRepair(
  input: { patientId: string; hospitalId?: string; orgId?: string },
  currentStep: string,
  error: unknown,
  appointmentId?: string,
  encounterId?: string,
): Promise<void> {
  const { upsertWorkflowRepair } = await import('./workflow-repair-service');
  await upsertWorkflowRepair(
    `repair-care-assignment-${appointmentId || encounterId || input.patientId}`,
    {
      workflow: 'care_assignment',
      patientId: input.patientId,
      appointmentId,
      encounterId,
      hospitalId: input.hospitalId,
      orgId: input.orgId,
      status: 'open',
      currentStep,
      lastError: error instanceof Error ? error.message : 'Care assignment synchronization failed',
    },
  ).catch(() => undefined);
}
