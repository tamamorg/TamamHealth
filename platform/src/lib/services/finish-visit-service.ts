/**
 * "Finish visit": the clinician says their part of the visit is over.
 *
 * It uses the move the visit already makes when a consultation note is signed
 * (`with_clinician` to `ready_for_clinic_checkout`), so it adds no stage and
 * skips nothing: the money and nursing gates still sit at checkout
 * (`evaluateCheckoutGate`, the post-consult handoff), and a visit parked
 * waiting on a result or a dispense only closes once that work is done.
 *
 * Unsigned notes do not block, because signing is not a gate anywhere else
 * either; they stay in the clinician's signing inbox. The caller lists them
 * first so the clinician can sign before finishing.
 */
import type { EncounterDoc, UserRole } from '../db-types';
import type { EncounterStatus } from '../clinical-flow/encounter-journey';
import type { DataScope } from './data-scope';
import { todayIso } from '../date-utils';

/** Stages the clinician can finish from: in consultation, or parked on a loop. */
export const FINISHABLE_STATUSES: EncounterStatus[] = [
  'with_clinician', 'consultation_paused_draft',
  'awaiting_labs', 'awaiting_imaging', 'awaiting_pharmacy', 'awaiting_procedure',
];

export function canFinishVisit(status: EncounterStatus | undefined | null): boolean {
  return !!status && FINISHABLE_STATUSES.includes(status);
}

export interface UnsignedItem { id: string; label: string }

/** Notes of this visit (or of today, when unlinked) that are still unsigned. */
export async function unsignedNotesForVisit(
  encounter: Pick<EncounterDoc, '_id' | 'patientId'>,
  scope: DataScope,
  today: string = todayIso(),
): Promise<UnsignedItem[]> {
  const { getNotesByPatient, isNoteLocked } = await import('../clinical-notes/note-service');
  const { getNoteType } = await import('../clinical-notes/note-catalog');
  const notes = await getNotesByPatient(encounter.patientId, scope);
  return notes
    .filter(n => !isNoteLocked(n) && n.status !== 'signed' && n.status !== 'amended')
    .filter(n => n.encounterId ? n.encounterId === encounter._id : n.serviceDate === today)
    .map(n => ({ id: n._id, label: `${getNoteType(n.noteType).label} note` }));
}

export class FinishVisitError extends Error {
  name = 'FinishVisitError';
}

/**
 * Move the visit to clinic checkout. Throws `FinishVisitError` in the
 * clinician's words when the visit is not at a stage that can finish, or is
 * still waiting on work it cannot leave behind.
 */
export async function finishVisit(
  encounterId: string,
  actor: { id?: string; role?: UserRole },
): Promise<EncounterDoc> {
  const { getEncounter, transitionEncounter } = await import('./encounter-service');
  let enc = await getEncounter(encounterId);
  if (!enc) throw new FinishVisitError('Visit not finished. It could not be found.');
  if (!canFinishVisit(enc.status)) {
    throw new FinishVisitError('Visit not finished. The patient is not with a clinician.');
  }
  if (enc.status === 'awaiting_labs' || enc.status === 'awaiting_imaging' || enc.status === 'awaiting_pharmacy') {
    const { hasOutstandingParkedWork } = await import('../clinical-notes/note-service');
    if (await hasOutstandingParkedWork(enc.status, enc._id, enc.patientId)) {
      throw new FinishVisitError(enc.status === 'awaiting_pharmacy'
        ? 'Visit not finished. A prescription is still waiting at the pharmacy.'
        : 'Visit not finished. Results are still pending.');
    }
  }
  const opts = { actorId: actor.id, actorRole: actor.role };
  if (enc.status === 'consultation_paused_draft') enc = await transitionEncounter(enc._id, 'with_clinician', opts);
  return transitionEncounter(enc._id, 'ready_for_clinic_checkout', opts);
}
