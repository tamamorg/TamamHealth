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
    target: '[data-tour="station-tabs"]',
    placement: 'bottom',
    title: 'The order lifecycle',
    body: 'Every order is a state machine: ordered → specimen collected → received at lab → in process → resulted → reviewed by clinician. Rejected specimens loop back for re-collection. STAT orders arrive already in-process and flagged.',
  },
  {
    id: 'specimen-intake',
    route: '/dashboard/lab',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Specimen intake',
    body: 'Collect the specimen, then Receive at lab once it reaches the bench — or Reject with a reason if it’s compromised; a rejected specimen loops back to Ordered for re-collection.',
  },
  {
    id: 'result-entry',
    route: '/dashboard/lab',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Enter a result',
    body: 'Start processing, then enter the result with value, unit, reference range, and abnormal/critical flags. This bench workflow lives in the patient’s own chart — open it from any row here.',
  },
  {
    id: 'critical',
    route: '/dashboard/lab',
    target: '[data-tour="side-cards"]',
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
    // Not `station-body`: this page self-closes <EhrCareDashboard />, and the
    // shell only renders station-body when it is given children, so the old
    // target matched nothing and the step fell back to a centred card. Not
    // `station-actions` either — the shell promotes the FIRST action into the
    // primary slot, and this page passes exactly one, leaving station-actions
    // rendered but empty and zero-sized. The button this step describes is the
    // primary action.
    target: '[data-tour="station-primary-action"]',
    placement: 'bottom',
    title: 'Batch result entry',
    // Analyzer import is on the registry (/lab), not here — a later step
    // covers it. Describing it on this screen sent people looking for a
    // control that isn't on it.
    body: 'Enter a whole run of the same test in one pass. Single results are entered in the patient chart’s bench workflow instead.',
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
