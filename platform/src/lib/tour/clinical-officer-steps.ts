import type { TourStep } from './types';

// Walks a clinician through a full visit end to end: the dashboard they land
// on after login, finding a patient, then the consultation wizard's six
// stages (Intake → Examination → Assessment → Orders → Plan & checkout →
// Summary). Section anchors correspond to `data-tour="consult-section-N"` on
// each SectionHeader in `consultation/page.tsx`. The wizard only shows the
// section(s) for its current stage and advancing requires that stage's data,
// so a scripted tour (no real patient data entered) can only spotlight the
// first stage's card; later stages are described narratively — the engine
// renders those cards centred, and the step-nav footer
// (`.ehr-consult-step-nav`) anchors the wrap-up.
export const clinicalOfficerTourSteps: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard',
    target: '.ehr-care-greeting',
    title: 'Welcome to TamamHealth',
    body: "Let's walk through a clinician's day — from your schedule to finishing a consultation. Use Back and Next anytime, or skip to explore on your own.",
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
    body: 'Everyone booked with you, split into Upcoming, Checked In, and Completed. Click a row to open that patient’s chart.',
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
    id: 'dash-intake',
    route: '/dashboard',
    target: '.ehr-schedule-actions button.primary',
    title: 'Send a patient to intake',
    body: 'Route a walk-in to Patient Intake to capture vitals and history before you see them.',
    placement: 'bottom',
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
  {
    id: 'consult-intake',
    route: '/consultation',
    target: '[data-tour="consult-section-1"]',
    title: 'Step 1 — Intake',
    body: 'Pick the patient (the right rail shows their allergies and history), capture the chief complaint — type or search the symptom catalog — and record vitals. Next unlocks once the complaint and vitals (or today’s triage) are in.',
    placement: 'bottom',
  },
  {
    id: 'consult-exam-assessment',
    route: '/consultation',
    target: '',
    title: 'Steps 2–3 — Examination & Assessment',
    body: 'Record findings by system (general, cardiovascular, respiratory, abdominal, neurological), then code at least one diagnosis with the ICD-11 search — each with type, certainty, and severity.',
  },
  {
    id: 'consult-orders',
    route: '/consultation',
    target: '',
    title: 'Step 4 — Orders: two cards, two search bars',
    body: 'Prescriptions and Lab Orders sit side by side. Each starts with a search bar — click it and suggestions drop down. Medications add with preset dose/route/frequency and pass allergy, interaction, and duplicate checks; lab tests can also be ticked from the Basic/Special panels, one-tap panel bundles, or a clinical protocol.',
  },
  {
    id: 'consult-send-ahead',
    route: '/consultation',
    target: '',
    title: 'Send orders ahead, mid-visit',
    body: '“Order tests & send to lab” pauses the visit as Awaiting labs — resume it from your dashboard when results return. “Send to pharmacy” queues medications for preparation now. Anything not sent goes automatically when you complete the visit.',
  },
  {
    id: 'consult-plan',
    route: '/consultation',
    target: '',
    title: 'Steps 5–6 — Plan, checkout & summary',
    body: 'Write the treatment plan, set follow-up, and choose the disposition: checkout, admit (jumps to Wards pre-filled), or refer (bundles a transfer package). The Summary previews the visit — including the charges that will post — before you complete it.',
  },
  {
    id: 'consult-wizard-flow',
    route: '/consultation',
    target: '.ehr-consult-step-nav',
    title: 'Back and Next drive the visit',
    body: 'The footer walks you through all six stages in order; each stage unlocks when its data is in. Your draft auto-saves as you type — a crash or closed tab never loses a consultation.',
    placement: 'top',
  },
  {
    id: 'finish',
    route: '/consultation',
    target: '.ehr-consult-step-nav',
    title: 'You’re ready',
    body: 'That’s the full clinical workflow, start to finish. You can replay this tour anytime from your profile menu.',
    placement: 'top',
  },
];
