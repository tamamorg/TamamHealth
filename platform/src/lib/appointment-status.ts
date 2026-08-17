/**
 * Appointment status vocabulary — the single source of truth for the ladder a
 * visit climbs at the front desk, its labels, its colours, and the sets other
 * code asks about ("is the patient here?", "is this slot still live?").
 *
 * This module exists because the vocabulary used to be copied into six places
 * (two dashboards, the appointments list, the calendar, the front desk and the
 * locale file), so adding a status meant finding all six and labels drifted
 * between them — the list called `in_progress` "In Progress" while the chart
 * called the same value "Roomed".
 *
 * Stored values vs labels: `in_progress` is shown as "Roomed" and `completed`
 * as "Checked Out". The stored names predate the front-desk vocabulary and are
 * written into ~250 call sites and the analytics pipeline, so the label is what
 * moved, not the data.
 */
import type { AppointmentStatus, UserRole } from './db-types';

/**
 * The forward ladder OFFERED to users, in the order reception moves a visit
 * through it: booked → present and checked in → in the clinical workflow →
 * visit finished.
 *
 * Simplified (2026-08) from the eight-rung ladder staff found ambiguous
 * ("what's the difference between Scheduled and Confirmed?"). The four
 * fine-grained statuses that came off the ladder are STILL VALID STORED
 * VALUES — system events keep writing them (the reminder service writes
 * `reminder_sent`, the portal/Approve writes `confirmed`, arrival marking
 * writes `arrived`, saving a triage writes `triaged`) — they just display and
 * behave as the rung they fold into, per `APPOINTMENT_STATUS_CANONICAL`.
 * Nothing in the database changes: the label is what moved, not the data.
 */
export const APPOINTMENT_STATUS_FLOW: AppointmentStatus[] = [
  'scheduled',
  'checked_in',
  'in_progress',
  'completed',
];

/**
 * Where each fine-grained, system-written status folds into the simplified
 * ladder. Reading UIs canonicalise before comparing against the ladder;
 * writing UIs only offer the four canonical rungs.
 *
 *  - reminder_sent → scheduled: a reminder is a communication event, not a
 *    different kind of booking (the `reminderSent` flag carries the fact).
 *  - confirmed → scheduled: confirmation is a fact about the booking (kept in
 *    the status history and the tooltip), not a separate rung.
 *  - arrived → checked_in: the waiting-room gap between the two is real but
 *    operational sets (APPOINTMENT_CHECKED_IN_STATUSES etc.) still tell them
 *    apart; the user-facing vocabulary no longer does.
 *  - triaged → in_progress: both mean "moving through the clinical workflow".
 */
export const APPOINTMENT_STATUS_CANONICAL: Partial<Record<AppointmentStatus, AppointmentStatus>> = {
  reminder_sent: 'scheduled',
  confirmed: 'scheduled',
  arrived: 'checked_in',
  triaged: 'in_progress',
};

/** The simplified rung a stored status displays and files as. */
export function canonicalAppointmentStatus(status: AppointmentStatus): AppointmentStatus {
  return APPOINTMENT_STATUS_CANONICAL[status] ?? status;
}

/** Ways a visit leaves the ladder without being seen. */
export const APPOINTMENT_STATUS_EXITS: AppointmentStatus[] = ['no_show', 'rescheduled', 'cancelled'];

/**
 * Everything the front desk can set, ladder first then exits — the order the
 * status dropdown renders in. `requested` is absent on purpose: it is written
 * by the patient portal when a patient asks for an appointment, and reception
 * answers it by scheduling or cancelling, never by re-requesting.
 */
export const APPOINTMENT_STATUS_OPTIONS: AppointmentStatus[] = [
  ...APPOINTMENT_STATUS_FLOW,
  ...APPOINTMENT_STATUS_EXITS,
];

/**
 * Who may move a booking where — the role vocabulary behind both the status
 * pickers and `updateAppointmentStatus`'s write gates, so the dropdown never
 * offers a rung the service will refuse (it used to: a doctor could pick
 * "Cancelled" and watch nothing happen).
 *
 * Scheduling roles own the book: every rung plus the exits. Clinical roles
 * advance a visit through care but don't close the book on one — no cancel /
 * no-show / rescheduled.
 */
export const APPOINTMENT_SCHEDULING_ROLES: UserRole[] = [
  'central_registration_clerk',
  'clinic_clerk',
  'front_desk',
  'medical_superintendent',
  'org_admin',
  'super_admin',
];

export const APPOINTMENT_CLINICAL_ROLES: UserRole[] = [
  'doctor',
  'clinical_officer',
  'nurse',
  'midwife',
  'clinician',
  'triage_nurse',
  'rooming_nurse',
];

/** The rungs a role may SET from a status picker; empty = read-only pill. */
export function appointmentStatusOptionsForRole(role?: UserRole): AppointmentStatus[] {
  if (!role) return [];
  if (APPOINTMENT_SCHEDULING_ROLES.includes(role)) return APPOINTMENT_STATUS_OPTIONS;
  if (APPOINTMENT_CLINICAL_ROLES.includes(role)) return ['checked_in', 'in_progress', 'completed'];
  return [];
}

/**
 * Fine-grained statuses wear their canonical rung's label. `confirmed` reads
 * as plain Scheduled too — the confirmation fact stays in the status history
 * and the tooltip, not on the pill.
 */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  reminder_sent: 'Scheduled',
  confirmed: 'Scheduled',
  arrived: 'Checked In',
  checked_in: 'Checked In',
  triaged: 'In Progress',
  in_progress: 'In Progress',
  completed: 'Completed',
  no_show: 'No Show',
  rescheduled: 'Rescheduled',
  cancelled: 'Cancelled',
};

/**
 * One-line definition per status, shown as tooltips wherever a status can be
 * picked. Written to settle the questions staff actually ask — above all
 * "Scheduled vs Confirmed": Scheduled means the DESK booked the slot;
 * Confirmed means the PATIENT has said they are coming.
 */
export const APPOINTMENT_STATUS_DESCRIPTIONS: Record<AppointmentStatus, string> = {
  requested: 'Asked for by the patient through the portal — not yet booked by the desk.',
  scheduled: 'Booked by the desk.',
  reminder_sent: 'Booked, and a reminder has gone out — still awaiting the patient.',
  confirmed: 'Booked, and the patient has confirmed they will attend.',
  arrived: 'The patient is at the facility and their visit is being opened.',
  checked_in: 'The patient is at the facility and their visit is open at the desk.',
  triaged: 'Moving through the clinical workflow — nurse assessment recorded.',
  in_progress: 'Moving through the clinical workflow — with (or waiting for) the clinician.',
  completed: 'The visit has ended and is closed out.',
  no_show: 'The patient never arrived and the slot has lapsed.',
  rescheduled: 'Not happening at this time — to be rebooked for a new slot.',
  cancelled: 'Called off. The slot is released; the booking stays on record.',
};

/** Locale keys, for the surfaces that translate their status pills. */
export const APPOINTMENT_STATUS_I18N_KEYS: Record<AppointmentStatus, string> = {
  requested: 'appointments.statusRequested',
  scheduled: 'appointments.statusScheduled',
  reminder_sent: 'appointments.statusReminderSent',
  confirmed: 'appointments.statusConfirmed',
  arrived: 'appointments.statusArrived',
  checked_in: 'appointments.statusCheckedIn',
  triaged: 'appointments.statusTriaged',
  in_progress: 'appointments.statusInProgress',
  completed: 'appointments.statusCompleted',
  no_show: 'appointments.statusNoShow',
  rescheduled: 'appointments.statusRescheduled',
  cancelled: 'appointments.statusCancelled',
};

/**
 * Pill colours. The ladder warms as the patient gets closer to the clinician
 * (blue booked → amber present → green in the room), and the three exits are
 * muted or red so a wall of rows reads at a glance.
 */
export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, { color: string; bg: string }> = {
  // `color` is pill TEXT, so every entry takes the darker `-text` rung of its
  // token pair — the base fills would sit at ~3:1 behind 10px type. The ladder
  // still warms blue → amber → green; it just says so in tokens now, which is
  // what lets a tenant's brand blue reach the booked rungs.
  requested:     { color: 'var(--semantic-request)', bg: 'var(--semantic-request-bg)' },
  scheduled:     { color: 'var(--accent-primary)', bg: 'var(--color-info-bg)' },
  reminder_sent: { color: 'var(--semantic-it)', bg: 'var(--semantic-it-bg)' },
  confirmed:     { color: 'var(--color-info-text)', bg: 'var(--color-info-bg)' },
  arrived:       { color: 'var(--color-warning-text)', bg: 'var(--color-warning-bg)' },
  checked_in:    { color: 'var(--color-warning)', bg: 'var(--color-warning-bg)' },
  triaged:       { color: 'var(--semantic-it)', bg: 'var(--semantic-it-bg)' },
  in_progress:   { color: 'var(--color-success)', bg: 'var(--color-success-bg)' },
  completed:     { color: 'var(--color-success-text)', bg: 'var(--color-success-bg)' },
  no_show:       { color: 'var(--text-muted)', bg: 'var(--semantic-inactive-bg)' },
  rescheduled:   { color: 'var(--semantic-request)', bg: 'var(--semantic-request-bg)' },
  cancelled:     { color: 'var(--color-danger)', bg: 'var(--color-danger-bg)' },
};

/** Row tone for the shared `status-*` pill classes on the role dashboards. */
export const APPOINTMENT_STATUS_TONES: Record<AppointmentStatus, 'scheduled' | 'ready' | 'active' | 'done' | 'warning' | 'danger'> = {
  requested: 'scheduled',
  scheduled: 'scheduled',
  reminder_sent: 'scheduled',
  confirmed: 'ready',
  arrived: 'warning',
  checked_in: 'warning',
  triaged: 'ready',
  in_progress: 'active',
  completed: 'done',
  no_show: 'danger',
  rescheduled: 'scheduled',
  cancelled: 'danger',
};

/**
 * The patient is physically at the facility. `arrived` counts — that is what it
 * means — so anything keyed off presence (queues, wait timers) picks it up
 * without a second list to maintain.
 */
export const APPOINTMENT_PRESENT_STATUSES: AppointmentStatus[] = ['arrived', 'checked_in', 'triaged', 'in_progress', 'completed'];

/** The visit has been opened at the desk: reception's work on it is done. */
export const APPOINTMENT_CHECKED_IN_STATUSES: AppointmentStatus[] = ['checked_in', 'triaged', 'in_progress', 'completed'];

/** The slot is no longer live — nothing further will happen at this time. */
export const APPOINTMENT_CLOSED_STATUSES: AppointmentStatus[] = ['completed', 'cancelled', 'no_show', 'rescheduled'];

/**
 * Statuses that RELEASE the slot for conflict purposes: a cancelled, no-show
 * or rescheduled booking no longer holds its provider or patient at that
 * time, so rebooking over it must not report a clash. (`completed` is absent
 * deliberately — a finished visit really did occupy its slot.) One list, used
 * by the service's conflict guard and every availability picker, so "free"
 * means the same thing at booking time and in the dropdowns.
 */
export const APPOINTMENT_SLOT_RELEASED_STATUSES: AppointmentStatus[] = ['cancelled', 'no_show', 'rescheduled'];

/**
 * Still awaiting the patient: reception can remind, confirm, or check them in.
 * `requested` is excluded — it is not a booking yet.
 */
export const APPOINTMENT_PENDING_STATUSES: AppointmentStatus[] = ['scheduled', 'reminder_sent', 'confirmed', 'arrived'];

/**
 * The three-lane view every role dashboard files its queue into — the same
 * lanes the mobile shell shows: Upcoming (booked, patient not yet with us),
 * Checked In (visit open at the facility), Completed (the slot is closed —
 * checked out, cancelled, no-show or rescheduled, nothing further today).
 *
 * The keys stay `scheduled`/`in_office`/`finished` — they are persisted in
 * filter state and compared against stored statuses; only the display copy
 * moved, and it lives here so every dashboard's tab strip reads the same.
 */
export type AppointmentStatusGroup = 'scheduled' | 'in_office' | 'finished';

export const APPOINTMENT_STATUS_GROUPS: AppointmentStatusGroup[] = ['scheduled', 'in_office', 'finished'];

export const APPOINTMENT_STATUS_GROUP_LABELS: Record<AppointmentStatusGroup, string> = {
  scheduled: 'Upcoming',
  in_office: 'Checked In',
  finished: 'Completed',
};

export function appointmentStatusGroup(status: AppointmentStatus): AppointmentStatusGroup {
  if (status === 'checked_in' || status === 'triaged' || status === 'in_progress') return 'in_office';
  if (APPOINTMENT_CLOSED_STATUSES.includes(status)) return 'finished';
  // requested/scheduled/reminder_sent/confirmed — and `arrived`: the patient is
  // in the waiting room but the desk has not opened the visit yet, so they
  // still belong to the expected lane, matching APPOINTMENT_PENDING_STATUSES.
  return 'scheduled';
}

export function appointmentStatusLabel(status: AppointmentStatus): string {
  return APPOINTMENT_STATUS_LABELS[status]
    // A status written by an older client than this build still reads sanely.
    || String(status).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * The rung below `status`, for undoing a step. Fine-grained statuses step
 * from their canonical rung (undoing a `triaged` visit lands on Checked In).
 * Exits reopen to `scheduled` (their own rung is gone), and `scheduled` has
 * nowhere to fall back to.
 */
export function priorAppointmentStatus(status: AppointmentStatus): AppointmentStatus | undefined {
  const rung = APPOINTMENT_STATUS_FLOW.indexOf(canonicalAppointmentStatus(status));
  if (rung > 0) return APPOINTMENT_STATUS_FLOW[rung - 1];
  if (APPOINTMENT_STATUS_EXITS.includes(status)) return 'scheduled';
  return undefined;
}
