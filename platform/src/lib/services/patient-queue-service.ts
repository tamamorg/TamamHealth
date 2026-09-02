/**
 * Patient Queue Service — derives queue state from existing triage, consultation,
 * prescription, and lab order documents. No new document type is needed; queue
 * state is computed from the lifecycle of existing records.
 *
 * Priority algorithm:
 *   score = acuity_weight + (minutes_waiting / target_wait_minutes) * 1.5
 *   RED=3  YELLOW=2  GREEN=1
 *
 * Patients exceeding 1.5× their target wait time are flagged for reassessment.
 */

import type { TriageDoc } from '@/lib/db-types';

export type QueueStage =
  | 'awaiting_triage'
  | 'awaiting_rooming'
  | 'awaiting_consultation'
  | 'awaiting_lab'
  | 'awaiting_pharmacy'
  | 'awaiting_checkout';

export const STAGE_LABELS: Record<QueueStage, string> = {
  awaiting_triage: 'Awaiting Triage',
  awaiting_rooming: 'Awaiting Rooming',
  awaiting_consultation: 'Awaiting Consultation',
  awaiting_lab: 'Awaiting Lab Results',
  awaiting_pharmacy: 'Awaiting Pharmacy',
  awaiting_checkout: 'Awaiting Checkout',
};

/**
 * The queue stage a visit is at, read from the front desk's ladder.
 *
 * `buildQueueFromTriage` can only speak for patients who already have a triage
 * document, so a patient reception checked in five minutes ago — the ones the
 * nursing station most needs to see — produced no queue entry at all, and any
 * board falling back on "no entry" said whatever it had left (a department
 * name, a dash). This maps the visit's own status onto the same vocabulary, so
 * one patient reads the same on the ward board, the rooming queue and the front
 * desk whether or not they have been assessed yet.
 *
 * Returns null when the visit is not in the building: still expected
 * (scheduled/confirmed), or already finished.
 */
export function stageForAppointmentStatus(status: string | undefined): QueueStage | null {
  switch (status) {
    case 'arrived':
    case 'checked_in':
      return 'awaiting_triage';
    case 'triaged':
      return 'awaiting_rooming';
    case 'in_progress':
      return 'awaiting_consultation';
    default:
      return null;
  }
}

/**
 * Default target wait time in minutes per stage.
 *
 * Exported so a caller that already knows a visit's stage — the front desk's
 * appointment-sourced queue rows, which have no triage document for
 * `buildQueueFromTriage` to read — can flag an over-target wait the same way
 * this module does for its own entries, instead of a second copy of the table.
 */
export const TARGET_WAIT: Record<QueueStage, number> = {
  awaiting_triage: 10,
  awaiting_rooming: 15,
  awaiting_consultation: 30,
  awaiting_lab: 45,
  awaiting_pharmacy: 20,
  awaiting_checkout: 15,
};

/**
 * Wait clock for a queue row derived straight from an appointment's own
 * status/timestamp, for the front desk's checked-in appointment rows — which
 * have no triage document for `buildQueueFromTriage` to read a wait off of,
 * and so showed no wait clock at all. Mirrors the acuity-table math
 * `buildQueueFromTriage` uses for its own entries (over target past 1.5× the
 * stage's `TARGET_WAIT`), so a booked patient the desk checked in waits the
 * same clock as a walk-in.
 *
 * Returns `overTarget: false` (and no `waitMinutes`) for a status with no
 * stage (e.g. `completed`) or with no `checkedInAt` yet stamped.
 */
export function deriveAppointmentWait(
  status: string | undefined,
  checkedInAt: string | undefined,
  nowMs: number,
): { waitMinutes?: number; overTarget: boolean } {
  const stage = stageForAppointmentStatus(status);
  if (!stage || !checkedInAt) return { overTarget: false };
  const waitMinutes = Math.floor((nowMs - new Date(checkedInAt).getTime()) / 60000);
  return { waitMinutes, overTarget: waitMinutes > TARGET_WAIT[stage] * 1.5 };
}

const ACUITY_WEIGHT: Record<'RED' | 'YELLOW' | 'GREEN', number> = {
  RED: 3,
  YELLOW: 2,
  GREEN: 1,
};

export interface QueueEntry {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  stage: QueueStage;
  acuity: 'RED' | 'YELLOW' | 'GREEN';
  chiefComplaint?: string;
  enteredStageAt: string; // ISO datetime
  minutesWaiting: number;
  targetWaitMinutes: number;
  score: number;
  flaggedForReassessment: boolean;
  triageId: string;
  assignedToId?: string;
  assignedToName?: string;
}

export function buildQueueFromTriage(
  triageDocs: TriageDoc[],
  /** Optional: map of patientId → current consultation status */
  consultationStatusByPatient?: Record<string, string>,
  /** Optional: set of patientIds who have pending prescriptions in pharmacy */
  pendingPharmacyPatients?: Set<string>,
  /** Optional: set of patientIds with outstanding lab orders */
  pendingLabPatients?: Set<string>,
): QueueEntry[] {
  const now = Date.now();
  const entries: QueueEntry[] = [];

  for (const triage of triageDocs) {
    // 'lwbs' belongs with the other terminal outcomes: the patient has left.
    // Without it a RED-acuity walk-away sorts to the top of the queue as the
    // most urgent patient in the building for the next 24 hours.
    if (triage.status === 'admitted' || triage.status === 'discharged' || triage.status === 'referred' || triage.status === 'lwbs') continue;
    // A visit sent back to reception is out of the CLINICAL queues — the desk
    // owns it now (its encounter sits at awaiting_next_station and the
    // front-desk board files it by appointment status). Leaving it here kept
    // the patient on the very worklists "return to front desk" removes them
    // from.
    if (triage.handoffStatus === 'returned_to_desk') continue;

    const acuity = (triage.priority as 'RED' | 'YELLOW' | 'GREEN') ?? 'GREEN';
    const consultStatus = consultationStatusByPatient?.[triage.patientId];

    let stage: QueueStage;
    let stageEnteredAt: string;

    if (pendingLabPatients?.has(triage.patientId)) {
      stage = 'awaiting_lab';
      stageEnteredAt = triage.triagedAt;
    } else if (pendingPharmacyPatients?.has(triage.patientId)) {
      stage = 'awaiting_pharmacy';
      stageEnteredAt = triage.triagedAt;
    } else if (consultStatus === 'completed' || consultStatus === 'clinic_checkout') {
      stage = 'awaiting_checkout';
      stageEnteredAt = triage.triagedAt;
    } else if (consultStatus === 'with_clinician' || consultStatus === 'in_progress') {
      // Already in consultation — skip the active stage, it's not "waiting"
      continue;
    } else if (triage.status === 'seen' && triage.assignedRoom) {
      stage = 'awaiting_consultation';
      stageEnteredAt = triage.triagedAt;
    } else if (triage.status === 'seen') {
      stage = 'awaiting_rooming';
      stageEnteredAt = triage.triagedAt;
    } else {
      stage = 'awaiting_triage';
      stageEnteredAt = triage.triagedAt;
    }

    const target = TARGET_WAIT[stage];
    const minutesWaiting = Math.floor((now - new Date(stageEnteredAt).getTime()) / 60000);
    const timeFactor = target > 0 ? (minutesWaiting / target) * 1.5 : 0;
    const score = ACUITY_WEIGHT[acuity] + timeFactor;
    const flaggedForReassessment = minutesWaiting > target * 1.5;

    entries.push({
      patientId: triage.patientId,
      patientName: triage.patientName,
      hospitalNumber: triage.hospitalNumber,
      stage,
      acuity,
      chiefComplaint: triage.chiefComplaint,
      enteredStageAt: stageEnteredAt,
      minutesWaiting,
      targetWaitMinutes: target,
      score,
      flaggedForReassessment,
      triageId: triage._id,
      assignedToId: triage.assignedProviderId ?? triage.handoffTo,
      assignedToName: triage.assignedProviderName ?? triage.handoffToName,
    });
  }

  // Sort by score descending (highest priority first)
  return entries.sort((a, b) => b.score - a.score);
}
