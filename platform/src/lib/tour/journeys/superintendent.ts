import type { TourStep } from '../types';
import { finishStep, messagingStep } from './_shared';
import { clinicalOfficerTourSteps } from '../clinical-officer-steps';

// ── Medical superintendent — clinical journey + oversight stops ────────────
// The superintendent runs the same visit workflow as any clinician (the
// imported clinical steps, finish stripped so this tour keeps its own single
// ending), then the tour turns to what's actually different about the role:
// facility-wide oversight across clinical quality, HR, facility performance,
// and finance. A facility's working tabs — Staff, Wards, Equipment, Inventory,
// Schedules, Performance, Settings — used to be a separate screen at
// `/hospitals/[hospitalId]/manage`, two sequential clicks away (select a
// facility, then Manage), which is why this tour could only describe them.
// They now sit on the facility profile itself, and every row in the network
// list carries a gear that opens straight onto one, so the stop below anchors
// on that gear instead of narrating a screen the tour could not reach.
export const SUPERINTENDENT_STEPS: TourStep[] = [
  ...clinicalOfficerTourSteps.filter(s => s.id !== 'finish'),
  {
    id: 'cosign-oversight',
    route: '/dashboard',
    target: '.ehr-outstanding-card',
    placement: 'left',
    title: 'Beyond your own patients',
    body: 'The rest of this tour covers what’s different about your role: facility-wide oversight. Your Outstanding Items already include co-signature requests routed here from nurses, midwives, and nutritionists across the facility — not just your own unsigned notes.',
  },
  {
    id: 'data-quality-oversight',
    route: '/data-quality',
    target: '',
    title: 'Clinical & reporting quality',
    body: 'Completeness, timeliness, and quality scores for everything your facility reports — the detail behind the Data Quality tile on Facility Overview, broken down enough to see exactly where documentation is slipping.',
  },
  {
    id: 'hr-dashboard-oversight',
    route: '/dashboard/hr',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Staffing at a glance',
    body: 'Who’s on today, who’s on leave, and every leave request waiting on a decision — approve or reject right from the queue.',
  },
  {
    id: 'hr-leave-oversight',
    route: '/hr/leave',
    target: '[data-tour="hr-leave-list"]',
    placement: 'top',
    title: 'Leave requests',
    body: 'The full leave register for your clinical teams — filter by status, and decide a pending request from its row.',
  },
  {
    id: 'hr-schedule-oversight',
    route: '/hr/schedule',
    target: '[data-tour="hr-schedule-list"]',
    placement: 'top',
    title: 'Shift schedule',
    body: 'One day’s roster, with a staffing-shortfall banner the moment a shift type drops below its configured minimum — the gap you’re accountable for closing.',
  },
  {
    id: 'hr-payroll-oversight',
    route: '/hr/payroll',
    target: '[data-tour="hr-payroll-list"]',
    placement: 'top',
    title: 'Payroll register',
    body: 'One period’s earnings and deductions per staff member. Move an entry from draft to approved to paid — the sign-off chain runs through you.',
  },
  {
    id: 'facility-overview-oversight',
    route: '/facility-overview',
    target: '[data-tour="facility-overview-metrics"]',
    placement: 'bottom',
    title: 'Facility performance',
    body: 'The same kind of KPIs the Ministry sees nationally, scoped to your facility — patients, beds, referrals, alerts, and the vital-event and care-program counts that feed them.',
  },
  {
    id: 'my-facility-oversight',
    route: '/my-facility',
    target: '[data-tour="moh-submit-gate"]',
    placement: 'top',
    title: 'Submit to the Ministry of Health',
    body: 'Facility data — beds, staffing, infrastructure, services offered — is edited here, and it reaches the Ministry only when you submit it. Nothing reports automatically.',
  },
  {
    id: 'hospitals-oversight',
    route: '/admin/organizations',
    // Not anchored: the network list runs to dozens of rows, so centering it
    // scrolls deep into the table and the card can end up off-screen. A
    // narrative card is the stable choice for a list this long.
    target: '',
    title: 'Hospital network',
    body: 'Every facility you oversee, with occupancy, staffing, and performance metrics side by side. Open one for its full profile — the record on Overview, and beside it the tabs you actually work in: staff, wards, equipment, inventory, schedules, and performance.',
  },
  {
    id: 'facility-tabs',
    route: '/admin/organizations',
    // The gear sits on the first row, at the top of the list, so this one IS
    // safe to anchor — unlike the list itself.
    target: '[data-tour="facility-row-tabs"]',
    placement: 'left',
    title: 'Straight to a facility\u2019s work',
    body: 'This gear opens the same tabs without opening the profile first — pick Staff, Wards, Inventory or Settings and the facility opens on it. Useful when you already know what you came to check.',
  },
  {
    id: 'payments-oversight',
    route: '/payments',
    target: '',
    title: 'Financial oversight',
    body: 'Collections and the pending-verification queue — the money side of the visits you supervise.',
  },
  {
    id: 'claims-oversight',
    route: '/payments/claims',
    target: '',
    title: 'Insurance claims',
    body: 'The claims pipeline for every payer your facility bills — track a claim from submitted through adjudicated to paid.',
  },
  {
    id: 'emergency-preparedness-oversight',
    route: '/emergency-preparedness',
    target: '[data-tour="emergency-new-plan"]',
    placement: 'bottom',
    title: 'Emergency preparedness',
    body: 'Surge plans for outbreaks, mass casualty events, and other emergencies. Activate one to move it into response, with surge beds and current load tracked live against capacity.',
  },
  messagingStep('/dashboard'),
  finishStep('/dashboard'),
];
