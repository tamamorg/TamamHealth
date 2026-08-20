import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Front desk (front_desk, clerks) — §4 ───────────────────────────────────
// The desk's real ladder: register → check in → assign a room and provider →
// route → close out. Every step below rides that ladder end to end rather
// than stopping at the board's surface.
export const FRONT_DESK_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/front-desk',
    target: '.ehr-care-greeting',
    title: 'Welcome to the Front Desk',
    body: 'Your desk runs the flow of the whole facility: register → check in → assign a room and provider → route → close out. Let’s walk it.',
    placement: 'bottom',
  },
  {
    id: 'queue',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'The live queue',
    body: 'One queue merges triaged walk-ins, arrived appointments, and open checkouts — sorted RED → YELLOW → GREEN by acuity and wait time, each row reading WAITING, IN CONSULT, or DONE.',
  },
  {
    id: 'lanes',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-tabs"]',
    placement: 'bottom',
    title: 'Upcoming, Checked In, Completed',
    body: 'Every visit files into one of three lanes: Upcoming (booked, not here yet), Checked In (in the building — triaged, roomed, or with the clinician), Completed (checked out, cancelled, no-show, or rescheduled). Each tab’s count always matches the rows under it.',
  },
  {
    id: 'register',
    route: '/patients/new',
    target: '',
    title: 'Register a patient — 6 steps',
    body: 'Demographics → Contact & location (the household number derives the geocode) → Next of kin → Biometrics (take the patient’s photo with the camera popup — or upload — plus consent-gated fingerprints) → Payment coverage → Review.',
  },
  {
    id: 'views',
    route: '/appointments',
    target: '.rbc-tamam',
    placement: 'bottom',
    title: 'The appointments calendar',
    body: 'Every booking for the facility, laid out month, week or day — filtered by status and search from the bar above. Click a slot to book into it, click an appointment to open it. The day-by-day worklist lives on your dashboard.',
  },
  {
    id: 'lifecycle',
    route: '/appointments',
    target: '',
    title: 'The booking ladder',
    body: 'Every booking climbs one ladder — Scheduled → Checked In → In Progress → Completed — with Requested (asked for via the patient portal), No Show, Rescheduled and Cancelled off to the side. Set any rung from a row’s status pill; the service blocks a double-booked slot before it saves. A walk-in is booked straight onto Checked In — there’s no separate check-in step for them.',
  },
  {
    // Last stop on /appointments on purpose: it leaves the booking dialog
    // open, and the next step navigates to /dashboard/front-desk — a route
    // change unmounts this page (and the dialog with it) instead of leaving
    // it stuck open behind a later same-route step.
    id: 'book',
    route: '/appointments',
    target: '[data-tour="book-appointment-modal"]',
    preClickSelector: 'button[title="Create new appointment"]',
    placement: 'bottom',
    title: 'Book an appointment',
    body: 'Book appointment opens booking as four short steps — Visit (reason, duration, in-person or telehealth, clinician), Time (a live clinician-by-day grid narrowed to who’s needed), Patient, then Insurance — so a slot is only offered once the people it needs are actually free.',
  },
  {
    id: 'check-in',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-body"]',
    placement: 'right',
    title: 'Check in an arrival',
    body: 'Pick Checked In on a Scheduled row’s status pill — here, or on the appointment itself in the Appointments calendar — to open the check-in dialog: confirm new visit or re-attendance, and the patient’s visit opens for triage, rooming, and the clinician to pick up. Caught a mis-click? Undo sends it straight back to Scheduled.',
  },
  {
    id: 'assign',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-body"]',
    placement: 'right',
    title: 'Room & assign',
    body: 'On a checked-in row: assign an exam room, the doctor, and the covering nurse — the reception → clinical handoff. The patient then appears on that clinician’s own worklist.',
  },
  {
    id: 'quick-actions',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-body"]',
    placement: 'right',
    title: 'Reschedule, no-show, cancel',
    body: 'A Scheduled visit that isn’t happening as booked gets its own path from the row: Reschedule moves it to a new day/time and keeps it live; No Show and Cancel both ask for confirmation first and leave an Undo, so a slot never disappears on a stray click.',
  },
  {
    id: 'referrals',
    route: '/referrals',
    target: '',
    title: 'Referrals',
    body: 'Outgoing referrals bundle a transfer package of the patient’s records. Incoming: Accept re-homes the patient here and drops an intake encounter; Decline requires a reason.',
  },
  {
    id: 'checkout',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-body"]',
    placement: 'right',
    title: 'Close the visit',
    body: 'Checkout on a DONE row opens the facility gate: outstanding balance, any unresolved critical item (each with its own Resolve link), and a disposition — routine discharge, discharged with referral, or left without formal checkout. A blocked item needs a reason and a named authorizer to override; either way, Undo reverses a completed checkout back into the queue.',
  },
  searchStep('/dashboard/front-desk'),
  messagingStep('/dashboard/front-desk'),
  finishStep('/dashboard/front-desk'),
];
