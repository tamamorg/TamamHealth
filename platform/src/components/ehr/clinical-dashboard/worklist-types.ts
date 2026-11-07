import type { AppointmentDoc, AppointmentStatus, TriageDoc } from '@/lib/db-types';
import type { StationAction } from '@/components/ehr/StationActionPill';
import type { AppointmentStatusGroup } from '@/lib/appointment-status';
import type { VisitLane } from '@/lib/clinical-flow/visit-state';
import type { QueueEntry } from '@/lib/services/patient-queue-service';

export type WorklistPatient = {
  _id: string;
  /** Patient portrait; the avatar falls back to initials when absent. */
  photoUrl?: string;
  name: string;
  age: number | null;
  gender: string;
  id?: string;
  ward?: string;
  doctor?: string;
  nurse?: string;
  division?: string;
  triagePriority?: 'RED' | 'YELLOW' | 'GREEN';
  assignedDoctor?: string;
  assignedDoctorName?: string;
  /** The assigned nurse's USER id (the `nurse` field above is a display
   *  name) — what the End-assignment gate compares the viewer against. */
  assignedNurse?: string;
  assignmentStatus?: 'assigned' | 'accepted' | 'in_progress' | 'completed';
  assignmentNote?: string;
  /**
   * A station's own reading of the row (lab, pharmacy, radiology, nutrition):
   * the worklist is the doctor's, but what a row says is the station's work —
   * "Collect specimen", not the visit rung. Each field overrides the doctor
   * column it names; a doctor's rows never set them.
   */
  station?: {
    /** The Time column — when the order came in — and the line under it. */
    timeLabel?: string;
    timeSubtext?: string;
    /** The Context column: the work itself ("HIV Rapid Test +2") and its detail. */
    context?: string;
    contextSubtext?: string;
    status: string;
    statusTone?: 'scheduled' | 'ready' | 'active' | 'done' | 'warning' | 'danger';
    statusSubtext?: string;
    /** The Care team column's second line (the doctor's nurse slot). */
    careTeamSecondary?: string;
    /** Which lane tab the row files under. */
    lane: AppointmentStatusGroup;
    /** Where Open chart lands: the chart with the station's form up. */
    chartHref?: string;
    /** The row's own key, when a patient has a row in two lanes (to fill and dispensed). */
    rowKey?: string;
    /** The order the row's pill works, when the station uses a slider. */
    openId?: string;
    /** What the pill's dropdown offers next. None: the pill only opens. */
    actions?: StationAction[];
  };
};

export type UnifiedPatientRow = {
  id: string;
  photoUrl?: string;
  patient: WorklistPatient | null;
  appointment: AppointmentDoc | null;
  name: string;
  patientId?: string;
  triagePriority: 'RED' | 'YELLOW' | 'GREEN';
  reason: string;
  timeLabel: string;
  status: AppointmentStatus;
  department: string;
  provider: string;
  isAssigned: boolean;
  /** Patient rows only: the patient's assignmentStatus, defaulted to
   *  'assigned' when an assignedDoctor is set without one. */
  assignmentStatus?: 'assigned' | 'accepted' | 'in_progress' | 'completed';
  assignmentNote?: string;
};


/** One row inside an outstanding-item worklist (a document to sign, an open
 *  referral, a paused encounter, …) rendered inline in the centre panel. */
export type OutstandingEntry = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  tone?: 'neutral' | 'warning' | 'danger';
  href?: string;
  actionLabel?: string;
  actionHref?: string;
  actionKind?: 'navigate' | 'complete-follow-up';
  /** The order this opens, when the station works it in a slider. */
  openId?: string;
};

export type OutstandingItem = {
  label: string;
  count: number;
  tone?: 'neutral' | 'warning' | 'danger';
  href?: string;
  /** The actual items behind the count — clicking the card swaps the centre
   *  panel (schedule area) for this list instead of navigating away. */
  entries?: OutstandingEntry[];
};

export type ClinicalDashboardQueryPatch = Partial<Record<'day' | 'lane' | 'outstanding' | 'appointment', string | null>>;

/** One worklist row's queue-derived display columns (Coming from / Care team
 *  / Status / Queue / Wait), from its live queue entry when the patient has
 *  arrived and from the appointment/assignment alone when they haven't. */
export interface RowQueueColumns {
  entry: QueueEntry | null;
  triage: TriageDoc | null;
  comingFrom: string;
  careTeamPrimary: string;
  careTeamSecondary: string;
  statusText: string;
  queueText: string;
  waitText: string;
  waitSubtext: string;
  statusSubtext: string;
  overTarget: boolean;
  /** The booked slot has already passed and the patient is not in the queue —
   *  the row is running late, which the Time column shows in red. */
  isPast: boolean;
  inService: boolean;
  /** The encounter-derived lane, when the row has a live encounter. The status
   *  chip already reads the encounter (via resolveOperationalVisitState), so
   *  the lane must read the same source — otherwise a patient whose chip says
   *  "Awaiting triage" files under Upcoming while In Facility shows zero. */
  operationalLane: VisitLane | null;
}
