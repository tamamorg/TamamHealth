import type { TourStep } from '../types';
import { finishStep, messagingStep, searchStep } from './_shared';

// ── Laboratory (lab_tech) — §7.1 ───────────────────────────────────────────
export const LAB_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/lab',
    target: '.ehr-care-greeting',
    title: 'Welcome to the Lab bench',
    body: 'Let’s walk an order from specimen to result — including the safety rails around critical values.',
    placement: 'bottom',
  },
  {
    id: 'lifecycle',
    route: '/dashboard/lab',
    target: '.ehr-day-tabs',
    placement: 'bottom',
    title: 'The order lifecycle',
    body: 'Every order is a state machine: ordered → specimen collected → received at lab → in process → resulted → reviewed by clinician. Rejected specimens loop back for re-collection. STAT orders arrive already in-process and flagged.',
  },
  {
    id: 'specimen-intake',
    route: '/dashboard/lab',
    target: '.ehr-appointment-list',
    placement: 'right',
    title: 'Specimen intake',
    body: 'One row per patient — their most pressing test, plus how many more. Open a row for the patient’s tests, the visit and vitals; Work opens the chart with the Lab orders form up. There: collect the specimen, receive it at the bench — or reject it with a reason, which loops it back for re-collection.',
  },
  {
    id: 'result-entry',
    route: '/dashboard/lab',
    target: '.ehr-appointment-list',
    placement: 'right',
    title: 'Enter a result',
    body: 'Start processing, then enter the result with value, unit, reference range, and abnormal/critical flags — all in the chart’s Lab orders form, beside the record.',
  },
  {
    id: 'critical',
    route: '/dashboard/lab',
    target: '.ehr-outstanding-card',
    placement: 'left',
    title: 'Critical results — two eyes',
    body: 'Entered values are auto-scored against the critical-value table — the Critical tile here tracks the count. A critical result requires a two-person confirmation and fires a high-priority message to the ordering clinician.',
  },
  {
    id: 'release',
    route: '/dashboard/lab',
    target: '',
    title: 'Release to the clinician',
    body: 'Saving a result moves it to Resulted and it appears in the ordering clinician’s chart immediately — there is no separate release step. A result still unreviewed past its SLA (24h critical / 7 days routine) shows up on the registry’s Overdue review worklist.',
  },
  {
    id: 'batch',
    route: '/dashboard/lab',
    // A header action on the shared workspace, which has no tour anchor of its
    // own — narrative rather than an invented selector.
    target: '',
    title: 'Batch result entry',
    body: 'Batch entry, in the header, fills in a whole run of the same test in one pass. Single results are entered in the chart’s Lab orders form instead.',
  },
  {
    id: 'registry-worklists',
    route: '/lab',
    target: '[data-tour="lab-registry-filters"]',
    placement: 'bottom',
    title: 'Worklists, not just a list',
    body: 'The full operational registry — every order, with CSV export and its own worklists here: draws due, scheduled collections, open send-outs, and results past their review SLA. Rows deep-link into the patient chart at the exact result.',
  },
  {
    id: 'analyzer-import',
    route: '/lab',
    // The import trigger is an icon-only EhrListHeaderButton that doesn't
    // forward a data-tour attribute, and this modal has no other static
    // anchor before it's opened — narrative rather than an invented selector.
    target: '',
    title: 'Import from an analyzer',
    body: 'Paste a raw LIS-2A/ASTM or HL7 ORU^R01 payload here and it parses into individual readings, matched by accession number — nothing saves until you review and confirm each one.',
  },
  {
    id: 'blood-bank',
    route: '/blood-bank',
    target: '[data-tour="bb-availability"]',
    placement: 'bottom',
    title: 'Blood bank',
    body: 'Availability by blood group (scarcity color-coded), expiry warnings, and donated-unit registration with auto-suggested unit IDs. Each unit’s row menu walks the transfusion lifecycle: Reserve for a patient (with compatibility check) → Record crossmatch → Record transfusion — or Discard with a reason.',
  },
  searchStep('/dashboard/lab'),
  messagingStep('/dashboard/lab'),
  finishStep('/dashboard/lab'),
];

// ── Pharmacy (pharmacist) — §7.3–7.4 ───────────────────────────────────────
