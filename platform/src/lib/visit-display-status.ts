/**
 * The ONE place a visit's state becomes {tab, colour tone}.
 *
 * Product-owner rules (2026-11-07):
 *
 *  TABS. A patient is in Waiting until a provider or clinical team member
 *  actively takes ownership and begins care.
 *   - Waiting:    in the queue — Scheduled, Arrived / Checked In, Ready for
 *                 Triage. A checked-in patient is still waiting.
 *   - In service: active clinical intervention — from the moment intake or
 *                 triage starts, or the patient is brought to a room — through
 *                 In Triage, Triage Complete / Roomed, Provider Encounter.
 *   - Finished:   the physical visit is over — provider completed the
 *                 encounter or discharge was initiated: Ready for Discharge,
 *                 Discharged / Completed, No Show / Canceled.
 *
 *  COLOUR, by meaning (reinforcement only, the label always stays).
 *   - slate:  idle baseline, no staff action needed (Scheduled)
 *   - blue:   queue action needed — staff must pull the patient in (Checked
 *             In, Ready for Triage, Roomed / Ready for Provider, Ready for
 *             Discharge)
 *   - purple: active encounter (In Triage, With Provider)
 *   - green:  zero remaining tasks (Discharged / Completed)
 *   - red:    Canceled / No-Show / Rescheduled
 *
 * The display state is DERIVED from what is stored — the appointment status
 * and, once the patient has arrived, the encounter stage (the encounter wins,
 * exactly as `resolveOperationalVisitState` does). No new stored status.
 *
 * This file imports types only, so `appointment-status.ts` can build its
 * legacy tables from it without a cycle.
 */
import type { AppointmentStatus } from './db-types';
import type { EncounterStatus } from './clinical-flow/encounter-journey';

/** Same keys the tab strips persist: scheduled = Waiting, in_office = In service. */
export type VisitTab = 'scheduled' | 'in_office' | 'finished';
export type VisitTone = 'slate' | 'blue' | 'purple' | 'green' | 'red';
/** The row-tone vocabulary the existing pills and rows already speak. */
export type VisitRowTone = 'scheduled' | 'ready' | 'active' | 'done' | 'warning' | 'danger';

export interface VisitDisplay {
  tab: VisitTab;
  tone: VisitTone;
  /** Legacy row tone (`status-*` pill class source) for `tone`. */
  rowTone: VisitRowTone;
}

/** slate/blue/purple/green/red expressed in the row-tone vocabulary. */
export const VISIT_TONE_TO_ROW_TONE: Record<VisitTone, VisitRowTone> = {
  slate: 'scheduled',
  blue: 'ready',
  purple: 'active',
  green: 'done',
  red: 'danger',
};

const W = 'scheduled' as const;
const S = 'in_office' as const;
const F = 'finished' as const;

type Cell = readonly [VisitTab, VisitTone];

/** Appointment status → display. Used when there is no encounter yet. */
export const APPOINTMENT_DISPLAY: Record<AppointmentStatus, Cell> = {
  requested: [W, 'slate'],
  scheduled: [W, 'slate'],
  reminder_sent: [W, 'slate'],
  confirmed: [W, 'slate'],
  arrived: [W, 'blue'],
  checked_in: [W, 'blue'],
  // Saving a triage writes `triaged`: triage is done, the patient waits for a room/provider.
  triaged: [S, 'blue'],
  in_progress: [S, 'purple'],
  completed: [F, 'green'],
  no_show: [F, 'red'],
  rescheduled: [F, 'red'],
  cancelled: [F, 'red'],
};

/** Encounter stage → display. The encounter is authoritative once it exists. */
export const ENCOUNTER_DISPLAY: Record<EncounterStatus, Cell> = {
  scheduled: [W, 'slate'],
  registered: [W, 'slate'],
  arrived_at_facility: [W, 'blue'],
  awaiting_next_station: [W, 'blue'],
  awaiting_triage: [W, 'blue'],
  in_triage: [S, 'purple'],
  triaged_awaiting_destination: [S, 'blue'],
  escalated_to_emergency: [S, 'purple'],
  lwbs: [F, 'red'],
  // Triage is complete and the patient is being sent on: Triage Complete.
  routed_to_clinic: [S, 'blue'],
  arrived_at_clinic_awaiting_rooming: [W, 'blue'],
  in_rooming: [S, 'purple'],
  ready_for_clinician: [S, 'blue'],
  transferred_to_other_clinic: [S, 'blue'],
  with_clinician: [S, 'purple'],
  consultation_paused_draft: [S, 'purple'],
  // Results / dispensing / procedures are still active care, pulled in by a station.
  awaiting_labs: [S, 'blue'],
  awaiting_imaging: [S, 'blue'],
  awaiting_pharmacy: [S, 'blue'],
  awaiting_procedure: [S, 'blue'],
  referred_out: [S, 'blue'],
  // The provider has completed the encounter: documentation/discharge wrapping up.
  ready_for_clinic_checkout: [F, 'blue'],
  in_clinic_checkout: [F, 'blue'],
  clinic_complete_awaiting_next_station: [F, 'blue'],
  awaiting_facility_checkout: [F, 'blue'],
  in_facility_checkout: [F, 'blue'],
  discharged: [F, 'green'],
  discharged_with_referral: [F, 'green'],
  discharged_with_pending_items: [F, 'green'],
  dismissed_without_formal_checkout: [F, 'green'],
  admitted: [F, 'green'],
  deceased: [F, 'slate'],
  voided: [F, 'red'],
};

export interface VisitDisplayInput {
  appointmentStatus?: AppointmentStatus | null;
  encounterStatus?: EncounterStatus | null;
  /** Post-consultation nursing still open: the visit is not finished yet. */
  nursingReviewOpen?: boolean;
  /**
   * A provider/clinical team member has taken the patient (handoff in
   * consultation, assigned and accepted). Lifts a still-queued row to In
   * service; it never pulls a closed visit back.
   */
  inService?: boolean;
}

/** The single status/stage → {tab, tone, rowTone} function every dashboard uses. */
export function resolveVisitDisplay(input: VisitDisplayInput): VisitDisplay {
  const { appointmentStatus, encounterStatus, nursingReviewOpen, inService } = input;
  let cell: Cell;
  if (encounterStatus) {
    cell = ENCOUNTER_DISPLAY[encounterStatus] ?? [W, 'slate'];
    if (nursingReviewOpen && (encounterStatus === 'ready_for_clinic_checkout' || encounterStatus === 'in_clinic_checkout')) {
      cell = [S, 'purple'];
    }
  } else {
    cell = (appointmentStatus && APPOINTMENT_DISPLAY[appointmentStatus]) || [W, 'slate'];
  }
  if (inService && cell[0] === W) cell = [S, 'purple'];
  // Triage is complete and the patient is only being sent on, so the row is
  // already In service (blue: "pull them in"). Once a provider has accepted the
  // handoff somebody owns the patient, so it reads as an active encounter.
  else if (inService && (encounterStatus === 'routed_to_clinic' || encounterStatus === 'triaged_awaiting_destination')) {
    cell = [S, 'purple'];
  }
  return { tab: cell[0], tone: cell[1], rowTone: VISIT_TONE_TO_ROW_TONE[cell[1]] };
}
