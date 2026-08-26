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

export interface AssignmentActor {
  id?: string;
  name?: string;
  /** Kept to `UserRole` so it feeds the consultation tracker unchanged. */
  role?: UserRole;
}

export interface AssignProviderInput {
  patientId: string;
  patientName: string;
  provider: { id: string; name: string; role?: UserRole };
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
  assertCanAssign(input.actor);
  const now = new Date().toISOString();
  const { updatePatient } = await import('./patient-service');
  await updatePatient(input.patientId, {
    assignedDoctor: input.provider.id,
    assignedDoctorName: input.provider.name,
    assignedAt: now,
    assignedBy: input.actor?.id,
    assignedByName: input.actor?.name,
    assignmentNote: input.note?.trim() || undefined,
    assignmentStatus: 'assigned',
    // A fresh assignment is unaccepted, whatever the previous provider had done.
    assignmentAcceptedAt: undefined,
    assignmentAcceptedBy: undefined,
    assignmentAcceptedByName: undefined,
  });

  let encounter: Awaited<ReturnType<typeof resolveVisit>>['encounter'];
  let appointmentId: string | undefined;
  try {
    ({ encounter, appointmentId } = await resolveVisit(input));
  } catch (error) {
    await recordAssignmentRepair(input, 'resolve_visit', error);
    throw error;
  }
  if (appointmentId) {
    const { updateAppointment } = await import('./appointment-service');
    const updated = await updateAppointment(appointmentId, {
      providerId: input.provider.id,
      providerName: input.provider.name,
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
      assignedClinicianId: input.provider.id,
      assignedClinicianName: input.provider.name,
      assignedAt: now,
      assignedBy: input.actor?.id,
      assignedByName: input.actor?.name,
    });
    if (!updated) {
      const error = new Error('Failed to update the assigned encounter');
      await recordAssignmentRepair(input, 'encounter', error, appointmentId, encounter._id);
      throw error;
    }
  }

  try {
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

  if (input.triageId) {
    try {
      const { updateTriage } = await import('./triage-service');
      await updateTriage(input.triageId, {
        handoffTo: input.provider.id,
        handoffToName: input.provider.name,
        handoffAt: now,
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
  assertCanAssign(input.actor);
  const now = new Date().toISOString();
  const { updatePatient } = await import('./patient-service');
  await updatePatient(input.patientId, {
    assignedNurse: input.nurse?.id,
    assignedNurseName: input.nurse?.name,
    assignedNurseAt: input.nurse ? now : undefined,
    assignedNurseBy: input.nurse ? input.actor?.id : undefined,
    assignedNurseByName: input.nurse ? input.actor?.name : undefined,
  });

  let resolved: Awaited<ReturnType<typeof resolveVisit>>;
  try {
    resolved = await resolveVisit(input);
  } catch (error) {
    await recordAssignmentRepair(input, 'resolve_visit', error);
    throw error;
  }
  const { encounter, appointmentId } = resolved;
  if (appointmentId) {
    const { updateAppointment } = await import('./appointment-service');
    const updated = await updateAppointment(appointmentId, {
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

const ASSIGNMENT_ROLES: readonly UserRole[] = [
  'front_desk', 'central_registration_clerk', 'clinic_clerk',
  'medical_superintendent', 'hospital_manager', 'org_admin', 'super_admin',
  'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
  'triage_nurse', 'rooming_nurse',
];

function assertCanAssign(actor?: AssignmentActor): void {
  // Internal/migration callers may not have an interactive actor. Whenever an
  // actor is supplied, fail closed on roles that do not coordinate care.
  if (actor?.role && !ASSIGNMENT_ROLES.includes(actor.role)) {
    throw new Error('You do not have permission to assign care staff');
  }
}

async function resolveVisit(input: {
  patientId: string;
  hospitalId?: string;
  appointmentId?: string;
  encounterId?: string;
}) {
  const { getEncounter, findOpenEncounterForPatient } = await import('./encounter-service');
  const encounter = input.encounterId
    ? await getEncounter(input.encounterId)
    : input.hospitalId
      ? await findOpenEncounterForPatient(input.patientId, input.hospitalId)
      : null;
  if (encounter && encounter.patientId !== input.patientId) {
    throw new Error('The encounter does not belong to this patient');
  }
  return { encounter, appointmentId: input.appointmentId || encounter?.appointmentId };
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
