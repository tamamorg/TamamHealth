import type { ShiftHandoffDoc } from './db-types';

/**
 * Is this nurse about to sign a second handoff for a shift they already
 * signed, with nobody having acknowledged the first?
 *
 * The shift is part of the question. Matching on nurse + date alone refused a
 * day-shift handoff because the same nurse had signed the NIGHT one earlier
 * that calendar day, while the message told them to "wait for the next shift"
 * — the very shift they were in.
 */
export function isDuplicateHandoff(
  latest: Pick<ShiftHandoffDoc, 'outgoingNurseId' | 'shiftDate' | 'shift' | 'status'> | null | undefined,
  nurseId: string,
  shiftDate: string,
  shift: ShiftHandoffDoc['shift'],
): boolean {
  return !!latest
    && latest.outgoingNurseId === nurseId
    && latest.shiftDate === shiftDate
    && latest.shift === shift
    && latest.status !== 'acknowledged';
}
