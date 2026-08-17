import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Front desk (front_desk, clerks) — §4 ───────────────────────────────────
export const FRONT_DESK_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/front-desk',
    target: '.ehr-care-greeting',
    title: 'Welcome to the Front Desk',
    body: 'Your desk runs the flow of the whole facility: register → check in → assign → room → close out. Let’s walk it.',
    placement: 'bottom',
  },
  {
    id: 'queue',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'The live queue',
    body: 'One queue merges triaged walk-ins, arrived appointments, and open checkouts — sorted RED → YELLOW → GREEN with status chips (WAITING / IN CONSULT / ADMITTED / REFERRED / DONE).',
  },
  {
    id: 'register',
    route: '/patients/new',
    target: '',
    title: 'Register a patient — 6 steps',
    body: 'Demographics → Contact & location (the household number derives the geocode) → Next of kin → Biometrics (take the patient’s photo with the camera popup — or upload — plus consent-gated fingerprints) → Payment coverage → Review.',
  },
  {
    id: 'check-in',
    route: '/appointments',
    target: '',
    title: 'Check in an arrival',
    body: 'Checking in happens on the appointment itself: find the patient’s booking for today and move its status to Checked In. That opens their visit and puts them in the nurse’s queue — there is no separate check-in module.',
  },
  {
    id: 'assign',
    route: '/dashboard/front-desk',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Room & assign',
    body: 'On queue rows: assign an exam room, and assign the provider — that’s the reception → clinical handoff; the patient appears in that clinician’s worklist.',
  },
  {
    id: 'appointments',
    route: '/appointments',
    target: '',
    title: 'Appointments',
    body: 'List or full calendar. The lifecycle runs requested → scheduled → confirmed → checked-in → in progress → completed, with conflict checks against provider availability. Walk-in creates an already-checked-in appointment.',
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
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Close the visit',
    body: 'Checkout on DONE rows runs the facility gate — prescriptions dispensed? critical labs reviewed? payment determined? — then discharges the encounter. Undo is supported.',
  },
  searchStep('/dashboard/front-desk'),
  messagingStep('/dashboard/front-desk'),
  finishStep('/dashboard/front-desk'),
];

// ── Cashier — §8.2 ─────────────────────────────────────────────────────────
