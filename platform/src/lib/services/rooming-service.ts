/**
 * The rooming station (KAN-99 / KAN-108).
 *
 * ## What rooming is
 *
 * The step between triage and the clinician: a patient routed to a clinic is
 * placed in an exam room, has a second set of vitals taken, and is marked ready
 * for the clinician to pick up. It is the handoff that turns "somewhere in the
 * building" into "in room 4, ready for you".
 *
 * ## What was missing
 *
 * `rooming_nurse` has been a real role in the `UserRole` union, with routes and
 * permissions, since before this module existed — and the encounter state
 * machine already modelled the whole chain
 * (`routed_to_clinic` → `arrived_at_clinic_awaiting_rooming` → `in_rooming` →
 * `ready_for_clinician`). What did not exist was anything that DROVE those
 * transitions. The states were reachable only by the catch-all
 * `advanceEncounterToClinician` chain, which walks straight through them
 * without a human ever assigning a room or taking a vital. So the stage was
 * modelled, logged, and never actually performed.
 *
 * ## Design notes
 *
 * Every action here goes through `transitionEncounter`, never a direct write,
 * so an illegal hop throws instead of corrupting the journey and the audit
 * trail matches what a station actually did.
 *
 * Rooming vitals reuse `recordNursingVitals` rather than introducing a rooming
 * vitals document. That is deliberate: the ticket requires rooming vitals to
 * share the numeric `VitalSigns` shape so they cannot drift from triage and
 * clinical records, and the surest way to guarantee that is to share the writer
 * rather than to write a parallel one that happens to agree today.
 */

import type { DataScope } from './data-scope';
import type { EncounterDoc } from '../db-types';
import { getAllEncounters, transitionEncounter, updateEncounter } from './encounter-service';
import { recordNursingVitals, type NursingVitalsInput } from './medical-record-service';
import { logAuditSafe } from './audit-service';

/**
 * Encounter statuses that belong to the rooming station's worklist.
 *
 * `routed_to_clinic` is included because that is where a patient sits after
 * triage sends them to a clinic but before anyone at that clinic has
 * acknowledged them — if the worklist started at
 * `arrived_at_clinic_awaiting_rooming`, nobody would ever see the patients
 * waiting to be acknowledged, and the queue would look permanently empty.
 */
export const ROOMING_WORKLIST_STATUSES = [
  // ── Everything from reception's check-in onward ──
  // Reception's check-in creates the arrival encounter and walks it to
  // `awaiting_triage`; the first status this list used to accept was
  // `routed_to_clinic`, which is only reachable *after* a triage has been
  // recorded and routed. So a patient reception had just checked in appeared on
  // no nursing worklist at all — the rooming queue read empty while people sat
  // in the waiting room, and the ward board's "Awaiting Rooming" context (which
  // `buildQueueFromTriage` derives from triage docs) named patients this list
  // had never heard of. Two surfaces, two answers, and a hole between them.
  //
  // Rooming is now the queue a patient joins the moment they are checked in,
  // and triage is a step taken FROM it — click a row and the patient's triage
  // page opens. The clinical order is unchanged (triage still precedes the
  // room); what changed is that the waiting are visible from the first minute.
  'awaiting_next_station',
  'awaiting_triage',
  'in_triage',
  'triaged_awaiting_destination',
  'routed_to_clinic',
  'arrived_at_clinic_awaiting_rooming',
  'in_rooming',
] as const;

/** The pre-triage statuses, kept in one place so the step map and the UI agree. */
const PRE_TRIAGE_STATUSES: readonly string[] = [
  'awaiting_next_station', 'awaiting_triage', 'in_triage', 'triaged_awaiting_destination',
];

export interface RoomingWorklistEntry {
  encounter: EncounterDoc;
  /** Where in the sequence this patient currently sits. */
  step: 'awaiting_triage' | 'awaiting_arrival' | 'awaiting_rooming' | 'being_roomed';
  /** Minutes since the encounter started — the number that drives urgency. */
  waitingMinutes: number;
}

function stepFor(status: EncounterDoc['status']): RoomingWorklistEntry['step'] {
  if (PRE_TRIAGE_STATUSES.includes(status)) return 'awaiting_triage';
  if (status === 'routed_to_clinic') return 'awaiting_arrival';
  if (status === 'in_rooming') return 'being_roomed';
  return 'awaiting_rooming';
}

/**
 * Patients waiting to be roomed, longest wait first.
 *
 * Sorted by wait rather than arrival order because the point of the list is to
 * surface who has been left waiting — an alphabetical or insertion-ordered
 * queue hides exactly that.
 */
export async function getRoomingWorklist(
  scope?: DataScope,
  now: number = Date.now(),
): Promise<RoomingWorklistEntry[]> {
  const all = await getAllEncounters(scope);
  const statuses: readonly string[] = ROOMING_WORKLIST_STATUSES;

  return all
    .filter(e => statuses.includes(e.status))
    .map(e => {
      const started = Date.parse(e.startedAt || e.createdAt || '');
      return {
        encounter: e,
        step: stepFor(e.status),
        waitingMinutes: Number.isNaN(started) ? 0 : Math.max(0, Math.round((now - started) / 60000)),
      };
    })
    .sort((a, b) => b.waitingMinutes - a.waitingMinutes);
}

/**
 * Acknowledge that a routed patient has physically reached the clinic.
 *
 * Separate from `assignRoom` because they are separate facts: a patient can be
 * present and waiting well before a room frees up, and collapsing the two would
 * make the queue unable to distinguish "not here yet" from "here, no room".
 */
export async function markArrivedAtClinic(
  encounterId: string,
  opts: { actorId?: string } = {},
): Promise<EncounterDoc> {
  return transitionEncounter(encounterId, 'arrived_at_clinic_awaiting_rooming', {
    actorId: opts.actorId,
  });
}

/**
 * Place the patient in an exam room and begin rooming.
 *
 * The room number is stored on the encounter, not only in the audit log, so the
 * clinician's worklist can say WHERE the patient is. A room without that is a
 * fact recorded for the auditor and lost to the person who needs it.
 */
export async function assignRoom(
  encounterId: string,
  roomNumber: string,
  opts: { actorId?: string; actorName?: string } = {},
): Promise<EncounterDoc> {
  const room = roomNumber.trim();
  if (!room) throw new Error('A room must be named to assign it');

  const enc = await transitionEncounter(encounterId, 'in_rooming', { actorId: opts.actorId });
  const updated = await updateEncounter(encounterId, { roomNumber: room });

  await logAuditSafe(
    'ROOMING_ASSIGN_ROOM',
    opts.actorId,
    opts.actorName,
    `Encounter ${encounterId} (patient ${enc.patientId}) placed in room ${room}`,
  );
  return updated ?? enc;
}

/**
 * Record the rooming set of vitals.
 *
 * Delegates to `recordNursingVitals`, so these land as a `medical_record` with
 * the same numeric `VitalSigns` shape as triage and clinical vitals and appear
 * on the chart's vitals trend alongside them — rather than in a rooming-only
 * store the chart would have to learn about separately.
 *
 * Sharing the writer immediately surfaced a live bug in it: absent
 * measurements were coerced to 0 (and `height` was hardcoded to 0), while
 * `validateMedicalRecord` skips undefined but range-checks 0 — so every
 * nursing-vitals write threw `ValidationError`. Absent values are now left
 * undefined, so a partial set saves correctly. This is the argument for
 * sharing the path rather than writing a parallel one: a private rooming
 * writer would have worked, and the ward's would have stayed broken.
 */
export async function recordRoomingVitals(
  input: NursingVitalsInput,
): Promise<Awaited<ReturnType<typeof recordNursingVitals>>> {
  if (!input.encounterId) {
    // Without the link the observation is orphaned from the visit it was taken
    // during, which is the whole reason for taking it at this station.
    throw new Error('Rooming vitals must be linked to an encounter');
  }
  return recordNursingVitals(input);
}

/**
 * Change the clinic a patient is routed to.
 *
 * Uses the machine's `transferred_to_other_clinic` state rather than silently
 * rewriting a field: sending a patient to a different department mid-visit is a
 * routing decision that the journey should show, not an edit that erases where
 * they were originally sent.
 */
export async function setDestinationClinic(
  encounterId: string,
  clinic: string,
  opts: { actorId?: string; actorName?: string } = {},
): Promise<EncounterDoc> {
  const destination = clinic.trim();
  if (!destination) throw new Error('A destination clinic must be named');

  await transitionEncounter(encounterId, 'transferred_to_other_clinic', { actorId: opts.actorId });
  // Back into the rooming queue at the receiving clinic — the patient still
  // has to be roomed there, and the room they were in no longer applies.
  const enc = await transitionEncounter(encounterId, 'arrived_at_clinic_awaiting_rooming', {
    actorId: opts.actorId,
  });
  const updated = await updateEncounter(encounterId, {
    destinationClinic: destination,
    roomNumber: undefined,
  });

  await logAuditSafe(
    'ROOMING_TRANSFER_CLINIC',
    opts.actorId,
    opts.actorName,
    `Encounter ${encounterId} (patient ${enc.patientId}) re-routed to ${destination}`,
  );
  return updated ?? enc;
}

/**
 * Complete rooming — the patient is ready for the clinician.
 *
 * Refuses without a room. The clinician's worklist tells them where to go, and
 * "ready" with no location is a handoff that does not hand anything off; it
 * just moves the problem to whoever reads the list.
 */
export async function markReadyForClinician(
  encounterId: string,
  opts: { actorId?: string; actorName?: string } = {},
): Promise<EncounterDoc> {
  const current = (await getAllEncounters()).find(e => e._id === encounterId);
  if (current && !current.roomNumber) {
    throw new Error('Assign a room before marking the patient ready for the clinician');
  }

  const enc = await transitionEncounter(encounterId, 'ready_for_clinician', { actorId: opts.actorId });
  const updated = await updateEncounter(encounterId, {
    roomedByName: opts.actorName,
    roomedAt: new Date().toISOString(),
  });

  await logAuditSafe(
    'ROOMING_READY_FOR_CLINICIAN',
    opts.actorId,
    opts.actorName,
    `Encounter ${encounterId} (patient ${enc.patientId}) ready in room ${current?.roomNumber ?? '?'}`,
  );
  return updated ?? enc;
}
