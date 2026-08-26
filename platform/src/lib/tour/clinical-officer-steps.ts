import type { TourStep } from './types';

// Walks a clinician through a full day end to end: the dashboard they land on
// after login, the patient registry, a patient's chart (the OpenMRS O3-style
// shell in src/components/ehr/chart/, scoped `omrs-` classes), writing a
// clinical note, and the alerts entry point.
//
// `/consultation` is a retired route now — it only redirects into a clinical
// note (see its own file header) — so this tour documents the note-based
// workflow that replaced the old wizard, rather than a UI that no longer
// exists.
//
// Steps that read "route: '/patients/[id]'" or "'/notes/[id]'" ride along on
// whatever record the PRECEDING step opened via `preClickSelector` (see
// tour-context.tsx) — the engine cannot navigate to a dynamic route directly.
// Several chart steps also use `preClickSelector` to switch the chart's own
// rail tab; because the chart component stays mounted across steps, each
// tab switch persists into the steps that follow it until another step
// switches again.
export const clinicalOfficerTourSteps: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard',
    target: '.ehr-care-greeting',
    title: 'Welcome to TamamHealth',
    body: "Let's walk through a clinician's day — from your schedule to opening a chart and writing up a visit. Use Back and Next anytime, or skip to explore on your own.",
    placement: 'bottom',
  },
  {
    id: 'dash-view-toggle',
    route: '/dashboard',
    target: '.ehr-clinical-dashboard-tabs .ehr-segmented',
    title: 'Dashboard & Calendar',
    body: 'Dashboard shows the day as a worklist. Calendar shows the same appointments laid out across the month.',
    placement: 'bottom',
  },
  {
    id: 'dash-calendar',
    route: '/dashboard',
    target: '.ehr-left-rail .ehr-mini-calendar',
    title: 'Jump to any day',
    body: 'Pick a date to see who is booked with you that day.',
    placement: 'right',
  },
  {
    id: 'dash-schedule',
    route: '/dashboard',
    target: '.ehr-appointment-list',
    title: 'Your schedule',
    body: 'Everyone booked with you, split into Upcoming, In Facility, and Completed. The live status shows whether they are awaiting triage, in triage, rooming, or consultation. Click a row to open that patient’s chart.',
    placement: 'top',
  },
  {
    id: 'dash-outstanding',
    route: '/dashboard',
    target: '.ehr-outstanding-card',
    title: 'Outstanding items',
    body: 'Documents to sign, open referrals, and visits paused as “Awaiting labs” — resume a paused visit from here when results return.',
    placement: 'left',
  },
  {
    id: 'top-search',
    route: '/dashboard',
    target: '.ehr-top-search',
    title: 'Find any patient',
    body: 'Search by name, hospital number, or phone from anywhere in the app.',
    placement: 'bottom',
  },
  {
    id: 'top-modules',
    route: '/dashboard',
    target: '.ehr-top-modules',
    title: 'Switch modules',
    body: 'Jump between Patients, Consultation, Wards, Lab, Pharmacy, Referrals, and everything else you have access to.',
    placement: 'bottom',
  },

  // ── Patient registry ──────────────────────────────────────────────────
  {
    id: 'patients-registry',
    route: '/patients',
    target: '[data-tour="patients-toolbar"]',
    title: 'The patient registry',
    body: 'Every patient at your facility, with live counts for male/female, new this month, and unassigned. Search narrows by name, hospital number, or phone.',
    placement: 'bottom',
  },
  {
    id: 'patients-filters',
    route: '/patients',
    target: '.ehr-list-filters-panel',
    preClickSelector: 'button[title="Filters"]',
    title: 'Narrow the list',
    body: 'Filter by age, gender, location, registration date, allergies, chronic conditions, or just the patients assigned to you.',
    placement: 'left',
  },
  {
    id: 'patients-open-chart',
    route: '/patients',
    target: '.appointment-card-row',
    preClickSelector: '.appointment-card-row',
    title: "Open a patient's chart",
    body: "Click any row to open that patient's full record — every visit, medication, result, and note. Let's open the first one.",
    placement: 'top',
  },

  // ── Patient chart (/patients/[id]) ──────────────────────────────────────
  {
    id: 'chart-header',
    route: '/patients/[id]',
    target: '.omrs-header',
    title: 'Every chart opens here',
    body: 'Name, hospital number, and allergy flag up top, with one-click actions — new note, prescribe, order labs, refer — that follow you to every tab.',
    placement: 'bottom',
  },
  {
    id: 'chart-vitals-band',
    route: '/patients/[id]',
    target: '.omrs-vitals-band',
    title: 'Vitals at a glance',
    body: 'The latest recorded vitals stay pinned here no matter which tab you’re on, so an abnormal reading is never more than a glance away.',
    placement: 'bottom',
  },
  {
    id: 'chart-summary',
    route: '/patients/[id]',
    target: '.tebra-section-title',
    title: 'Patient summary',
    body: 'Safety alerts, current medications, latest vitals, and next care actions — the chart’s front page. Click any card to jump straight to its tab.',
    placement: 'bottom',
  },
  {
    id: 'chart-rail',
    route: '/patients/[id]',
    target: '.omrs-left-rail',
    title: 'Every section, one rail',
    body: 'Conditions, medications, immunizations, vitals, notes, results, billing — organized like an OpenMRS chart so nothing is more than one click away.',
    placement: 'right',
  },
  {
    id: 'chart-workspace',
    route: '/patients/[id]',
    target: '.omrs-right-rail',
    title: 'Workspace panels',
    body: 'Order basket, visit note, task list, clinical forms, and patient lists open here without ever leaving the chart you’re reading.',
    placement: 'left',
  },
  {
    id: 'chart-problems',
    route: '/patients/[id]',
    target: '.omrs-section-title',
    preClickSelector: '.omrs-rail-item[title="Conditions"]',
    title: 'Conditions',
    body: 'Every diagnosis, coded to ICD-11, with date of onset and status. Resolve or reactivate a condition right from its row.',
    placement: 'bottom',
  },
  {
    id: 'chart-allergies',
    route: '/patients/[id]',
    target: '.omrs-section-title',
    preClickSelector: '.omrs-rail-item[title="Allergies"]',
    title: 'Allergies',
    body: 'Active allergies and reactions — checked automatically against every new prescription.',
    placement: 'bottom',
  },
  {
    id: 'chart-vitals-tab',
    route: '/patients/[id]',
    target: '.omrs-section-title',
    preClickSelector: '.omrs-rail-item[title="Vitals & Biometrics"]',
    title: 'Vitals history',
    body: 'The full reading history for this patient, as a table or a flowsheet — switch views with the toggle above it.',
    placement: 'bottom',
  },
  {
    id: 'chart-notes-tab',
    route: '/patients/[id]',
    target: '.cn-list-toolbar',
    preClickSelector: '.omrs-rail-item[title="Notes"]',
    title: 'Documentation lives here',
    body: 'Every encounter note for this patient, sorted by date of service — notes are the record now, filterable by type, author, and signed status.',
    placement: 'bottom',
  },
  {
    id: 'chart-write-note',
    route: '/patients/[id]',
    target: '.cn-split-main',
    preClickSelector: '.cn-split-main',
    title: 'Start a note',
    body: "The main button starts the note type you'll use most, SOAP; the caret next to it opens the full list — OB Evaluation, Nursing visit, and more.",
    placement: 'bottom',
  },

  // ── Note editor (/notes/[id]) ───────────────────────────────────────────
  {
    id: 'note-editor',
    route: '/notes/[id]',
    target: '.cn-section-nav',
    title: 'Write the visit',
    body: 'Jump between sections — a filled dot means it already has content. Assign the note to a colleague or pull in a lab from the sidebar, then Sign to lock it into the record.',
    placement: 'right',
  },

  // ── Alerts ───────────────────────────────────────────────────────────
  {
    id: 'alerts-feed',
    route: '/alerts',
    // The feed spans nearly the full width AND height of the page, and
    // TourCard's cardPosition only clamps one axis per placement (top/bottom
    // clamp X, left/right clamp Y) — every direction pushed the card
    // partly off-screen against a target this large. A centred narrative
    // card is the only placement that's always fully on screen here.
    target: '',
    title: 'What needs attention today',
    body: 'Outbreak warnings, critical lab results awaiting sign-off, and overdue immunizations — newest first, so nothing urgent gets buried.',
  },

  {
    id: 'finish',
    route: '/alerts',
    target: '',
    title: "You're ready",
    body: "That's a clinician's day end to end — schedule, chart, documentation, and the alerts that need you. Replay this tour anytime from your profile menu.",
  },
];
