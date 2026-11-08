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
import { APPOINTMENT_DISPLAY, VISIT_TONE_TO_ROW_TONE, resolveVisitDisplay, type VisitRowTone } from './visit-display-status';

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

/**
 * The service stations a checked-in patient passes through after (or instead
 * of) the clinician. Each one moves the visit only while the patient is with
 * them: picked up (In Progress) and finished (Completed). Checking a patient
 * in, and taking one off the board, stay with reception.
 */
export const APPOINTMENT_STATION_ROLES: UserRole[] = [
  'lab_tech',
  'radiologist',
  'pharmacist',
  'nutritionist',
  'cashier',
  'medical_biller',
];

/** The rungs a role may SET from a status picker; empty = read-only pill. */
export function appointmentStatusOptionsForRole(role?: UserRole): AppointmentStatus[] {
  if (!role) return [];
  if (APPOINTMENT_SCHEDULING_ROLES.includes(role)) return APPOINTMENT_STATUS_OPTIONS;
  if (APPOINTMENT_CLINICAL_ROLES.includes(role)) return ['checked_in', 'in_progress', 'completed'];
  if (APPOINTMENT_STATION_ROLES.includes(role)) return ['in_progress', 'completed'];
  return [];
}

/** The rungs a station may act from: the patient is present and in the building. */
const STATION_ACTIONABLE: AppointmentStatus[] = ['checked_in', 'in_progress', 'completed'];

/**
 * May `role` move a visit from `from` to `to`? The one rule behind both the
 * dropdowns (which only offer moves that pass) and `updateAppointmentStatus`
 * (which refuses the rest), so a pick is never offered that the write refuses.
 *
 *  - Reception and admins own the book: any move.
 *  - Nobody else takes a visit OUT of an exit. A cancelled, no-show or
 *    rescheduled visit was closed by reception, so reopening it is theirs too.
 *  - A station acts only on a patient who is checked in, and only along its
 *    own rungs — it never checks a patient in.
 *  - A clinician never sets an exit or Confirmed (the existing gates).
 *
 * No role means a system write (reminders, encounter projections): allowed.
 */
export function canRoleMoveAppointment(role: UserRole | undefined, from: AppointmentStatus, to: AppointmentStatus): boolean {
  if (!role || APPOINTMENT_SCHEDULING_ROLES.includes(role)) return true;
  if (APPOINTMENT_STATUS_EXITS.includes(from)) return false;
  if (APPOINTMENT_STATION_ROLES.includes(role)) {
    return STATION_ACTIONABLE.includes(canonicalAppointmentStatus(from))
      && ['in_progress', 'completed'].includes(canonicalAppointmentStatus(to));
  }
  return !APPOINTMENT_STATUS_EXITS.includes(to) && to !== 'confirmed';
}

/**
 * Statuses that take a visit off the board without it being seen. Picking one
 * from a row's dropdown asks for a reason first; every forward move saves
 * straight from the pick.
 */
export function appointmentStatusNeedsReason(status: AppointmentStatus): boolean {
  return APPOINTMENT_STATUS_EXITS.includes(status);
}

/**
 * Fine-grained statuses wear their canonical rung's label. `confirmed` reads
 * as plain Scheduled too — the confirmation fact stays in the status history
 * and the tooltip, not on the pill.
 *
 * `arrived` is the one exception, and deliberately so: it canonicalises to
 * `checked_in` for the LADDER, but it files in the Upcoming lane, because the
 * desk has not opened the visit yet (see `appointmentStatusGroup` and
 * APPOINTMENT_PENDING_STATUSES). Labelling it "Checked In" put a pill reading
 * "Checked In" inside the "Upcoming" tab and told reception their work was
 * done while it was still theirs to do. It says what it is instead.
 */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  requested: 'Requested',
  scheduled: 'Scheduled',
  reminder_sent: 'Scheduled',
  confirmed: 'Scheduled',
  arrived: 'Arrived',
  checked_in: 'Checked In',
  // Triage done, waiting for a room or provider: blue "queue action", not the
  // purple of an encounter in progress, so it says what it is (like `arrived`).
  triaged: 'Triage Complete',
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
 * Pill colours, derived from the one display mapping (visit-display-status.ts):
 * slate idle, blue queue action needed, purple active encounter, green done,
 * red cancelled / no-show / rescheduled.
 */
export const APPOINTMENT_STATUS_COLORS: Record<AppointmentStatus, { color: string; bg: string }> = Object.fromEntries(
  (Object.keys(APPOINTMENT_DISPLAY) as AppointmentStatus[]).map(status => {
    // `requested` is a portal ask, not a rung of the visit: it keeps its own
    // pending-action colour. Everything else wears the owner's key (slate idle,
    // blue queue action, purple active, green done, red cancelled) through the
    // --visit-* tokens, so a status looks the same on every screen and two
    // statuses reading the same word cannot differ in colour.
    if (status === 'requested') return [status, { color: 'var(--semantic-request)', bg: 'var(--semantic-request-bg)' }];
    const tone = APPOINTMENT_DISPLAY[status][1];
    return [status, { color: `var(--visit-${tone})`, bg: `var(--visit-${tone}-bg)` }];
  }),
) as Record<AppointmentStatus, { color: string; bg: string }>;

/**
 * Row tone for the shared `status-*` pill classes on the role dashboards,
 * derived from the one display mapping (visit-display-status.ts) so pill
 * colour and tab are never decided in two places.
 */
export const APPOINTMENT_STATUS_TONES = Object.fromEntries(
  (Object.keys(APPOINTMENT_DISPLAY) as AppointmentStatus[]).map(
    status => [status, VISIT_TONE_TO_ROW_TONE[APPOINTMENT_DISPLAY[status][1]]],
  ),
) as Record<AppointmentStatus, VisitRowTone>;

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
 * lanes the mobile shell shows: Waiting (booked, patient not yet with us),
 * In service (visit open at the facility), Finished (the slot is closed —
 * checked out, cancelled, no-show or rescheduled, nothing further today).
 *
 * The keys stay `scheduled`/`in_office`/`finished` — they are persisted in
 * filter state and compared against stored statuses; only the display copy
 * moved, and it lives here so every dashboard's tab strip reads the same.
 */
export type AppointmentStatusGroup = 'scheduled' | 'in_office' | 'finished';

export const APPOINTMENT_STATUS_GROUPS: AppointmentStatusGroup[] = ['scheduled', 'in_office', 'finished'];

export const APPOINTMENT_STATUS_GROUP_LABELS: Record<AppointmentStatusGroup, string> = {
  scheduled: 'Waiting',
  in_office: 'In service',
  finished: 'Finished',
};

export function appointmentStatusGroup(status: AppointmentStatus): AppointmentStatusGroup {
  // Waiting until care actually begins: a checked-in or arrived patient is
  // still in the queue. Full rules in visit-display-status.ts.
  return resolveVisitDisplay({ appointmentStatus: status }).tab;
}

/**
 * Does a stored status belong under `filter`, the value of a status dropdown?
 *
 * A folded status answers to its canonical rung ONLY where it actually wears
 * that rung's label — picking "Scheduled" rightly returns the `confirmed` and
 * `reminder_sent` rows, because all three read "Scheduled" on screen. `arrived`
 * is the exception: it reads "Arrived" and files in the Upcoming lane, so
 * picking "Checked In" must not return it. Without this the same visit answered
 * to "Checked In" on the appointments list while sitting under "Upcoming" on
 * every dashboard.
 */
export function appointmentMatchesStatusFilter(status: AppointmentStatus, filter: string): boolean {
  if (filter === 'all') return true;
  if (status === filter) return true;
  const rung = canonicalAppointmentStatus(status);
  if (rung !== filter) return false;
  return APPOINTMENT_STATUS_LABELS[status] === APPOINTMENT_STATUS_LABELS[rung];
}

/**
 * The dropdown value a status counts towards — the same bucket
 * {@link appointmentMatchesStatusFilter} would put it in, so a chip's count
 * always equals the number of rows selecting that chip returns.
 */
export function appointmentStatusFilterKey(status: AppointmentStatus): AppointmentStatus {
  const rung = canonicalAppointmentStatus(status);
  return APPOINTMENT_STATUS_LABELS[status] === APPOINTMENT_STATUS_LABELS[rung] ? rung : status;
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
