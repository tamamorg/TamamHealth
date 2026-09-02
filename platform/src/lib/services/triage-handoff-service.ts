import type { TriageDisposition, TriageDoc, TriageHandoffStatus, UserRole } from '../db-types';
import { updateAppointmentStatus } from './appointment-service';
import { getEncounter, findOpenEncounterForPatient, advanceEncounterAfterTriage, escalateEncounterToEmergency, returnEncounterToFrontDesk, transitionEncounter } from './encounter-service';
import { updateTriage } from './triage-service';
import { syncConsultationProgressStage } from './consultation-progress-service';
import { logAuditSafe } from './audit-service';
import { triageDB } from '../db';

/** Triage statuses with no further clinical transition (see
 *  `VALID_TRANSITIONS` in triage-service.ts) — the visit's triage phase is
 *  administratively closed. */
const TERMINAL_TRIAGE_STATUSES = new Set<TriageDoc['status']>(['admitted', 'discharged', 'referred', 'lwbs']);

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

export interface ReturnVisitToFrontDeskInput {
  triageId: string;
  patientId: string;
  patientName: string;
  /** Free-text explanation, kept in the audit trail and the encounter's
   *  transition record — "patient stepped out", "needs rebooking", … */
  reason?: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
}

/**
 * Send a triaged-but-unfinished visit back to reception — the exit for a
 * patient who stepped out (and may return), a handoff that named the wrong
 * provider, or a visit that needs rebooking. The counterpart of
 * `completeTriageHandoff`, undone:
 *
 *  - the triage keeps its non-terminal status but its handoff is released
 *    (`handoffStatus: 'returned_to_desk'`, provider cleared), which removes
 *    the patient from every clinical queue and doctor worklist — see
 *    `buildQueueFromTriage` and `assembleDoctorWorklist`;
 *  - the encounter (when one is linked) moves to `awaiting_next_station`,
 *    the desk-owned crossroads, keeping the visit open and In Facility on
 *    the front-desk board;
 *  - reception learns about it from the returned-to-desk notification
 *    derivation (visit-updates.ts), which reads exactly this state.
 */
export async function returnVisitToFrontDesk(input: ReturnVisitToFrontDeskInput): Promise<TriageDoc> {
  const triage = await updateTriage(input.triageId, {
    handoffStatus: 'returned_to_desk',
    assignedProviderId: undefined,
    assignedProviderName: undefined,
    handoffNote: input.reason || undefined,
  }, { userId: input.actorId, username: input.actorName });
  if (!triage) throw new Error('The triage record could not be updated.');

  if (triage.encounterId) {
    try {
      await returnEncounterToFrontDesk(triage.encounterId, {
        actorId: input.actorId, actorRole: input.actorRole, reason: input.reason,
      });
    } catch (err) {
      // A visit already past the returnable stages (in consultation, closed)
      // has no legal edge back to the desk — the handoff release above still
      // stands, so the row leaves the clinical queues either way; record why
      // the encounter itself did not move.
      await logAuditSafe('ENCOUNTER_RETURN_TO_DESK_SKIPPED', input.actorId, input.actorName,
        `Visit for ${input.patientName} (${input.patientId}): encounter not moved — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  await logAuditSafe('TRIAGE_RETURNED_TO_DESK', input.actorId, input.actorName,
    `${input.patientName} (${input.patientId}) returned to the front desk` +
    (input.reason ? ` — ${input.reason}` : ''),
  );
  return triage;
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

  // Read the CURRENT status before writing: if this triage already reached a
  // terminal outcome (admitted/discharged/referred/lwbs), `updateTriage`
  // below must not attempt to move it to 'seen'/'discharged' again —
  // `VALID_TRANSITIONS` has no path out of any of those four, so the write
  // would throw AFTER already persisting the disposition/handoff fields
  // (`db.put` inside `updateTriage` happens before the caller sees the
  // status-transition error), leaving a triage doc whose content changed but
  // whose downstream appointment/encounter walk never ran — a silent
  // desync. A best-effort read failure here is not fatal: `updateTriage`'s
  // own transition guard is still the authority and will surface a real
  // error if the id is bad.
  let alreadyTerminal = false;
  try {
    const current = await triageDB().get(input.triageId) as TriageDoc;
    alreadyTerminal = TERMINAL_TRIAGE_STATUSES.has(current.status);
  } catch {
    alreadyTerminal = false;
  }

  const triage = await updateTriage(input.triageId, {
    disposition: input.disposition,
    destinationClinic: input.destinationClinic,
    assignedProviderId: input.assignedProviderId,
    assignedProviderName: input.assignedProviderName,
    handoffNote: input.handoffNote,
    handoffStatus,
    // Omitted entirely (not set to the existing value) when already
    // terminal, so `updateTriage`'s `updates.status !== existing.status`
    // check never fires and the transition guard is never consulted.
    ...(alreadyTerminal ? {} : { status: input.disposition === 'home_care' ? 'discharged' as const : 'seen' as const }),
  }, { userId: input.actorId, username: input.actorName });
  if (!triage) throw new Error('The triage record could not be updated.');

  if (alreadyTerminal) {
    // A content correction to an already-closed triage must persist without
    // re-opening the encounter/appointment flow that already ran to
    // completion for this visit — that flow is exactly what the rest of this
    // function drives, so it stops here.
    return triage;
  }

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
