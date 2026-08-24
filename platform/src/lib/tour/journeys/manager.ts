import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';

// ── Hospital manager — §11.3 ───────────────────────────────────────────────
// Walks the manager's full world in nav order: facility overview & the MoH
// submission gate, the facility network, Staff & HR (now four independent
// routes — leave / schedule / payroll sit beside the HR station dashboard,
// not behind a single roster tab), services (inquiries, equipment, IT), then
// finance/reporting/clinical context. `/hr` itself is never used as a step
// route — it's a redirect stub (see hr/page.tsx), not a page with content.
export const MANAGER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/facility-management',
    target: '',
    title: 'Welcome to Facility Management',
    body: 'Reviews score, today’s appointments, enquiries, and staff shortcuts — your operational home.',
  },
  {
    id: 'facility-overview',
    route: '/facility-overview',
    target: '[data-tour="facility-overview-metrics"]',
    placement: 'bottom',
    title: 'Facility Overview',
    body: 'The review tier of the reporting pipeline: clinical staff enter data, it collects here at the facility level, and you review it before it reaches the Ministry. Patients, beds, referrals, alerts, and vital-event counts, all scoped to your facility.',
  },
  {
    id: 'my-facility',
    route: '/my-facility',
    target: '[data-tour="moh-submit-gate"]',
    placement: 'top',
    title: 'Submit to the Ministry of Health',
    body: 'Edit your facility profile — beds, staffing, infrastructure, services offered — then submit it here. Reporting is never automatic: the Ministry sees this facility’s data only once you press Submit, and again any time you update it afterward.',
  },
  {
    id: 'hospitals',
    route: '/manage',
    // Not anchored: the network list runs to dozens of rows, so centering it
    // scrolls deep into the table and the card can end up off-screen. A
    // narrative card is the stable choice for a list this long.
    target: '',
    title: 'Facility network',
    body: 'Every facility in your network, with occupancy, staffing, and performance metrics side by side. Open one for its full profile — coverage, services offered, and its performance trend.',
  },
  {
    id: 'facility-settings',
    route: '/facility-settings',
    // Not anchored: the module rail and the card beside it both move as the
    // page scrolls into view, so a narrative card is the stable choice here.
    target: '',
    title: 'Facility settings',
    body: 'Pick a facility to set what varies there — its number prefix, visit types, departments and rooms, lab catalogue, and the stations a patient passes through. Everything the network shares, like payment methods and tax, is set once under All facilities.',
  },
  {
    id: 'facility-assessments',
    route: '/facility-assessments',
    target: '',
    title: 'Facility assessments',
    body: 'Periodic readiness assessments — infrastructure, staffing, service availability — that feed straight into your facility’s profile and the performance scores on Facility Overview.',
  },
  {
    id: 'hr-dashboard',
    route: '/dashboard/hr',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Staff & HR at a glance',
    body: 'Today’s roster status and the queue of pending leave decisions, in the same shape as every other station dashboard. Approve or reject a request right from here, or jump to the full leave, schedule, or payroll registers.',
  },
  {
    id: 'hr-leave',
    route: '/hr/leave',
    target: '[data-tour="hr-leave-list"]',
    placement: 'top',
    title: 'Leave requests',
    body: 'The full leave register — filterable by status. Approve or reject a pending request from its row; there’s no separate roster page, this is the one place leave lives.',
  },
  {
    id: 'hr-schedule',
    route: '/hr/schedule',
    target: '[data-tour="hr-schedule-list"]',
    placement: 'top',
    title: 'Shift schedule',
    body: 'One day’s roster of shifts, with a staffing-shortfall banner the moment a shift type drops below its configured minimum.',
  },
  {
    id: 'hr-payroll',
    route: '/hr/payroll',
    target: '[data-tour="hr-payroll-list"]',
    placement: 'top',
    title: 'Payroll register',
    body: 'One period’s earnings, deductions, and net pay per staff member. Move an entry from draft to approved to paid from its status pill.',
  },
  {
    id: 'inquiries',
    route: '/inquiries',
    target: '[data-tour="inquiries-list"]',
    placement: 'top',
    title: 'Patient inquiries',
    body: 'Messages patients send in through the app or SMS before they’re ever a visit. Triage each one to Contacted, Appointment scheduled, or Closed, and assign it to whoever’s following up.',
  },
  {
    id: 'equipment',
    route: '/equipment',
    target: '[data-tour="equipment-list"]',
    placement: 'top',
    title: 'Assets & equipment',
    body: 'Register assets with service intervals, log services and repairs, and watch the “service due soon” 30-day lookahead.',
  },
  {
    id: 'it',
    route: '/it',
    target: '.it-ops-panel',
    placement: 'top',
    title: 'IT Operations',
    body: 'Sync jobs and device health for the facility’s IT stack — the same console reachable from Settings → System administration.',
  },
  {
    id: 'payments',
    route: '/payments',
    target: '',
    title: 'Revenue & bills',
    body: 'Collections, the pending-verification queue, and claims — the money side of every visit your facility runs.',
  },
  {
    id: 'reports',
    route: '/reports',
    target: '',
    title: 'Reports',
    body: 'Generate and download your facility’s operational and clinical reports — the same figures that roll up into Facility Overview.',
  },
  {
    id: 'data-quality',
    route: '/data-quality',
    target: '',
    title: 'Data quality',
    body: 'Completeness, timeliness, and quality scores for what your facility reports — the detail behind the Data Quality score on Facility Overview.',
  },
  {
    id: 'patients',
    route: '/patients',
    target: '',
    title: 'Patients',
    body: 'The full patient registry, here for operational context — census, throughput, no-shows — not for charting care yourself.',
  },
  {
    id: 'wards',
    route: '/wards',
    target: '',
    title: 'Wards',
    body: 'Bed occupancy and ward status across the facility — the same board your nursing staff use to place and move patients.',
  },
  messagingStep('/facility-management'),
  finishStep('/facility-management'),
];

// ── Org admin — §11.2 ──────────────────────────────────────────────────────
