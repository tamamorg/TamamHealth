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
    id: 'work-queue',
    route: '/dashboard/lab',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Work the queue row by row',
    body: 'Collect specimen → Receive at lab (or Reject with a reason) → Start processing → Enter result with value, unit, reference range, and abnormal/critical flags.',
  },
  {
    id: 'critical',
    route: '/dashboard/lab',
    target: '',
    title: 'Critical results — two eyes',
    body: 'Entered values are auto-scored against the critical-value table. A critical result requires a two-person confirmation and fires a high-priority message to the ordering clinician.',
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
    // Analyzer import is on the registry (/lab), not here — the next step
    // covers it. Describing it on this screen sent people looking for a
    // control that isn't on it.
    body: 'Enter a whole run of the same test in one pass. Single results are entered in the patient chart’s bench workflow instead.',
  },
  {
    id: 'registry',
    route: '/lab',
    target: '',
    title: 'The full lab registry',
    body: 'The operational registry with every order, CSV export, and worklists for draws due, scheduled collections, send-outs and results past their review SLA (24 h critical / 7 days routine). Import LIS-2A/HL7 analyzer payloads here — parsed readings are matched by accession and never auto-saved. Rows deep-link into the patient chart at the exact result.',
  },
  {
    id: 'blood-bank',
    route: '/blood-bank',
    target: '',
    title: 'Blood bank',
    body: 'Availability by blood group (scarcity color-coded), expiry warnings, and donated-unit registration with auto-suggested unit IDs. Each unit’s row menu walks the transfusion lifecycle: Reserve for a patient (with compatibility check) → Record crossmatch → Record transfusion — or Discard with a reason.',
  },
  searchStep('/dashboard/lab'),
  messagingStep('/dashboard/lab'),
  finishStep('/dashboard/lab'),
];

// ── Pharmacy (pharmacist) — §7.3–7.4 ───────────────────────────────────────
