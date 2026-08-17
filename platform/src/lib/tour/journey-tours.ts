import type { UserRole } from '@/lib/db-types';
import { getRoleConfig } from '@/lib/permissions';
import { clinicalOfficerTourSteps } from './clinical-officer-steps';
import type { TourDefinition, TourStep } from './types';

/**
 * Journey-based "Take a tour" definitions — one per workspace, derived from
 * docs/USER-JOURNEYS.md so the tour walks each user through THEIR documented
 * day, step by step (not just the shared shell).
 *
 * Authoring rules:
 * - Page-level stops use an empty `target` → the engine renders a centred
 *   narrative card over that page (robust; no per-page selector to break).
 * - Anchored stops only use the shell selectors that exist for every role
 *   (.ehr-top-search / .ehr-top-modules / .ehr-top-actions).
 * - Steps are FILTERED against the role's route allow-list before use, so a
 *   tour can never navigate a user onto an "Access Restricted" screen — e.g.
 *   a triage nurse simply skips the ANC/immunizations stops of the nurse
 *   journey.
 */

const searchStep = (route: string): TourStep => ({
  id: 'search',
  route,
  target: '.ehr-top-search',
  title: 'Find any patient',
  body: 'Search by name, hospital number, or phone from anywhere in the app.',
  placement: 'bottom',
});

const messagingStep = (route: string): TourStep => ({
  id: 'messaging',
  route,
  // The sidebar entry, which every role that can message has. The floating
  // dock is back (restored after da19f4d6 removed it), but the nav link stays
  // the tour anchor: it exists on every screen and viewport, while the dock's
  // launcher is desktop-only and hidden under the mobile shell.
  target: 'a.nav-item[href="/messages"]',
  title: 'Message your team',
  body: 'Direct messages, plus group threads for a whole ward or department. A handover of care waiting on you appears on your dashboard under “Transfers to accept”.',
  placement: 'right',
});

const finishStep = (route: string): TourStep => ({
  id: 'finish',
  route,
  target: '.ehr-top-actions',
  title: "You're all set",
  body: 'That’s your workflow end to end. Replay this tour anytime from your profile menu — look for “Take a tour.”',
  placement: 'left',
});

// ── Nursing (nurse, midwife, triage/rooming nurse) — USER-JOURNEYS §5 ──────
// The standalone nurse station is retired: nurse-family roles now land on the
// same shared clinical workspace as doctors (/dashboard, rendered by
// NurseHomeView — see components/dashboards/NurseHomeView.tsx), so every step
// below is anchored to a route + selector that actually exists in that shell.
// Triage (/triage/[patientId]) and rooming (/rooming/[patientId]) both take a
// real patient id, so there is no generic route to script a click through —
// that step describes the flow narratively instead of inventing a selector.
// Same reasoning for MAR (/wards/mar/[admissionId]): reached per admission
// from the "Medications due" outstanding entry, not from a static control on
// the ward board.
const NURSE_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard',
    target: '.ehr-care-greeting',
    title: 'Welcome to your clinical workspace',
    body: 'Let’s walk your shift end to end: your worklist, triage and rooming, the ward board, medication rounds, and handoff. Use Back and Next, or skip anytime.',
    placement: 'bottom',
  },
  {
    id: 'worklist',
    route: '/dashboard',
    target: '.ehr-appointment-list',
    title: 'Your worklist',
    body: 'Today’s ward roster and anyone still moving through rooming, in one list. Click a row to open that patient’s chart.',
    placement: 'top',
  },
  {
    id: 'dash-outstanding',
    route: '/dashboard',
    target: '.ehr-outstanding-card',
    title: 'Outstanding items',
    body: 'Medications due, handoffs waiting on your acknowledgement, the rooming queue, and follow-ups due — each opens straight to the patient or the tool that clears it.',
    placement: 'left',
  },
  {
    id: 'triage-rooming',
    route: '/dashboard',
    target: '',
    title: 'Triage and rooming',
    body: 'New arrivals show up in the Rooming queue on the outstanding rail. A patient who hasn’t been triaged yet opens straight into Triage — ETAT ABCC (Airway, Breathing, Circulation, Consciousness) and vitals, with RED / YELLOW / GREEN priority calculated automatically. Once triaged, “Continue rooming” walks them through room assignment and rooming vitals until they’re marked ready — that’s what moves them onto the clinician’s worklist.',
  },
  {
    id: 'ward-board',
    route: '/wards',
    target: '',
    title: 'The ward board',
    body: 'Your admitted patients, sorted by ward, with diagnosis and severity. Admit a new patient or discharge one from here; occupancy stats sit at the top. Each admission also has its own bedside medication record (the printable time-grid MAR) — reached per admission from the Medications due card on your dashboard.',
  },
  {
    id: 'handoff',
    route: '/wards/handoff',
    target: '[data-tour="handoff-sbar"]',
    placement: 'top',
    title: 'Shift handoff',
    body: 'The shift auto-detects (day/evening/night). Write a per-patient SBAR for your critical patients, check the shift KPIs, then Sign off — the oncoming nurse acknowledges your handoff from here too.',
  },
  {
    id: 'anc',
    route: '/anc',
    target: '',
    title: 'Antenatal care',
    body: 'Mothers grouped with latest visit and risk level. A visit captures gestational age, BP, fundal height, fetal heart rate, screens, and the next-visit date — feeding MCH analytics and DHIS2.',
  },
  {
    id: 'immunizations',
    route: '/immunizations',
    target: '',
    title: 'Immunizations & defaulters',
    body: 'Record doses against each child’s schedule, and work the Defaulters tab — overdue doses can be recalled by SMS to the caregiver, per row or in bulk.',
  },
  searchStep('/dashboard'),
  messagingStep('/dashboard'),
  finishStep('/dashboard'),
];

// ── Laboratory (lab_tech) — §7.1 ───────────────────────────────────────────
const LAB_STEPS: TourStep[] = [
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
const PHARMACY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/pharmacy',
    target: '.ehr-care-greeting',
    title: 'Welcome to the Pharmacy',
    body: 'Let’s walk the dispensing queue, the safety gates, and your inventory tools.',
    placement: 'bottom',
  },
  {
    id: 'queue',
    route: '/dashboard/pharmacy',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'The prescription queue',
    body: 'Prescriptions arrive from consultations in priority order — life-sustaining tiers first, immediate-urgency floats up.',
  },
  {
    id: 'dispense-gates',
    route: '/dashboard/pharmacy',
    target: '[data-tour="station-body"]',
    placement: 'top',
    title: 'Dispensing safety gates',
    body: 'Each dispense checks, in order: enough stock for the full course, drug interactions against the patient’s other active meds, and — for controlled drugs — a witness picker that writes the two-signature register entry before stock moves.',
  },
  {
    id: 'inventory',
    route: '/pharmacy',
    target: '',
    title: 'Inventory, reorder & expiry',
    body: 'Live stock status (adequate / low / critical / expired), receive stock with batch + expiry, FEFO expiry tracking, reorder quantities with a printable purchase order, and CSV export everywhere.',
  },
  {
    id: 'controlled',
    route: '/controlled-substances',
    target: '',
    title: 'Controlled-substance register',
    body: 'An append-only, two-signature register: intake, dispense, waste, reconciliation, transfer. Entries can never be edited or deleted — dispensing scheduled drugs writes here automatically.',
  },
  searchStep('/dashboard/pharmacy'),
  messagingStep('/dashboard/pharmacy'),
  finishStep('/dashboard/pharmacy'),
];

// ── Radiology (radiologist) — §7.2 ─────────────────────────────────────────
const RADIOLOGY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/radiology',
    target: '.ehr-care-greeting',
    title: 'Welcome to Imaging',
    body: 'Imaging orders from consultations land on this worklist automatically.',
    placement: 'bottom',
  },
  {
    id: 'study',
    route: '/dashboard/radiology',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Work a study',
    body: 'Open a study → attach images or DICOM files (they save to the patient’s documents, so the ordering clinician sees them) → enter findings → Submit report. Completing returns the findings to the chart.',
  },
  {
    id: 'panels',
    route: '/dashboard/radiology',
    target: '[data-tour="station-body"]',
    placement: 'top',
    title: 'Your analytics',
    body: 'Modality breakdown, body regions, completion rate, and average turnaround time — at a glance.',
  },
  searchStep('/dashboard/radiology'),
  messagingStep('/dashboard/radiology'),
  finishStep('/dashboard/radiology'),
];

// ── Nutrition (nutritionist) — §7.7 ────────────────────────────────────────
const NUTRITION_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/nutrition',
    target: '.ehr-care-greeting',
    title: 'Welcome to Nutrition',
    body: 'CMAM screening and therapeutic supplies, in one station.',
    placement: 'bottom',
  },
  {
    id: 'screening',
    route: '/dashboard/nutrition',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Screen a child',
    body: 'Name, age, sex, MUAC, weight/height, edema — the classification derives live: SAM, MAM, At Risk, Underweight, or Normal. The worklist filters by classification.',
  },
  {
    id: 'supplies',
    route: '/dashboard/nutrition',
    target: '[data-tour="station-body"]',
    placement: 'top',
    title: 'Therapeutic supplies',
    body: 'Track RUTF, F-75/F-100, ReSoMal, Vitamin A and MUAC tapes with reorder-level statuses; +/− adjustments persist and survive reload.',
  },
  searchStep('/dashboard/nutrition'),
  messagingStep('/dashboard/nutrition'),
  finishStep('/dashboard/nutrition'),
];

// ── Front desk (front_desk, clerks) — §4 ───────────────────────────────────
const FRONT_DESK_STEPS: TourStep[] = [
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
const CASHIER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/payments',
    target: '',
    title: 'Welcome to Payments',
    body: 'Patient accounts sorted outstanding-first, with A/R aging buckets. Let’s walk a collection.',
  },
  {
    id: 'collect',
    route: '/payments',
    target: '',
    title: 'Collect a payment',
    body: 'Pick the patient (or arrive deep-linked from front-desk checkout), choose the tender — cash, mobile money (m-Gurush, M-Pesa, MTN, Airtel), bank transfer, insurance, or waiver — and the payment posts and credits the ledger.',
  },
  {
    id: 'receipt',
    route: '/payments',
    target: '',
    title: 'Receipts',
    body: 'Print or email the receipt right from the confirmation — the “Sent” badge only shows when the email provider actually accepted it.',
  },
  {
    id: 'pending',
    route: '/payments',
    target: '',
    title: 'Verify pending payments',
    body: 'Pay-by-link and patient-portal payments arrive pending. The amber verification queue appears whenever something needs review: Approve posts it and credits the patient’s balance; Reject records why.',
  },
  {
    id: 'plans',
    route: '/payments',
    target: '',
    title: 'Plans, refunds & waivers',
    body: 'Record installments on payment plans, void or refund posted payments (with confirmation), and waive bills through the exemption path — reason required.',
  },
  searchStep('/payments'),
  messagingStep('/payments'),
  finishStep('/payments'),
];

// ── Medical biller — §8.3 ──────────────────────────────────────────────────
const BILLER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/payments',
    target: '',
    title: 'Welcome to Billing',
    body: 'You have the cashier’s collections view plus the full insurance-claims lifecycle. Let’s walk both.',
  },
  {
    id: 'collections',
    route: '/payments',
    target: '',
    title: 'Collections & pending verification',
    body: 'Collect payments, verify pending pay-by-link/portal payments, manage plans and refunds — same flow as the cashier.',
  },
  {
    id: 'claims',
    route: '/payments/claims',
    target: '',
    title: 'Claims at a glance',
    body: 'KPIs for billed / pending / approved / denied, plus the payer mix: self-pay, NHIS, CBHI, donor/NGO, government, private, employer.',
  },
  {
    id: 'submit',
    route: '/payments/claims',
    target: '',
    title: 'Submit a claim',
    body: '“New claim”: pick the insured patient, their policy, and the outstanding bill (or enter the amount) — the claim goes to the payer as submitted.',
  },
  {
    id: 'adjudicate',
    route: '/payments/claims',
    target: '',
    title: 'Adjudicate honestly',
    body: 'Record the allowed and paid amounts — the resulting status (paid / partial / denied) previews live from the same rule that gets saved. Paid 0 against an allowed amount = full denial, with a reason.',
  },
  {
    id: 'appeal',
    route: '/payments/claims',
    target: '',
    title: 'Appeal & resubmit',
    body: 'Denied claims carry row actions: Appeal (with a note for the payer) and Resubmit — the resubmission count is tracked on the claim.',
  },
  messagingStep('/payments'),
  finishStep('/payments'),
];

// ── Records / HMIS (hrio, records officer, data entry) — §9 ────────────────
const RECORDS_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/data-entry',
    target: '',
    title: 'Welcome to Records & HMIS',
    body: 'From daily census to DHIS2 export — the facility’s reporting spine. Let’s walk it in order.',
  },
  {
    id: 'census',
    route: '/dashboard/data-entry',
    target: '[data-tour="station-queue"]',
    placement: 'right',
    title: 'Daily census entry',
    body: 'OPD attendance, admissions, deliveries, immunizations given, bed occupancy, and disease counts — entered here daily.',
  },
  {
    id: 'births',
    route: '/births',
    target: '',
    title: 'Register births',
    body: 'Child + parents + birth details; the certificate number auto-generates (SS-B-…), and the mother’s chart links when she’s a registered patient.',
  },
  {
    id: 'deaths',
    route: '/deaths',
    target: '',
    title: 'Register deaths',
    body: 'Decedent details, WHO cause chain, certificate number. Ward “death” discharges route here automatically.',
  },
  {
    id: 'vitals-stats',
    route: '/vital-statistics',
    target: '',
    title: 'Vital statistics',
    body: 'Read-only rollups: sex ratios, crude rates, monthly trends.',
  },
  {
    id: 'quality',
    route: '/data-quality',
    target: '',
    title: 'Data quality',
    body: 'Completeness, timeliness, and consistency scoring — check it before you export.',
  },
  {
    id: 'dhis2',
    route: '/dhis2-export',
    target: '',
    title: 'DHIS2 export',
    body: 'Pick the period and level, then Sync to DHIS2 or download JSON/CSV. Statuses and the sync log here are real and persisted — “Never synced” means never synced.',
  },
  {
    id: 'reports',
    route: '/reports',
    target: '',
    title: 'Monthly reports',
    body: 'Downloadable facility reports; MCH analytics has the maternal/child indicator dashboards.',
  },
  messagingStep('/dashboard/data-entry'),
  finishStep('/dashboard/data-entry'),
];

// ── Hospital manager — §11.3 ───────────────────────────────────────────────
const MANAGER_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/facility-management',
    target: '',
    title: 'Welcome to Facility Management',
    body: 'Reviews score, today’s appointments, enquiries, and staff shortcuts — your operational home.',
  },
  {
    id: 'hospitals',
    route: '/hospitals',
    target: '',
    title: 'Facility console',
    body: 'Open a facility to quick-create wards, staff, and stock, or edit its details.',
  },
  {
    id: 'settings',
    route: '/facility-settings',
    target: '',
    title: 'Facility settings',
    body: 'Payment methods offered, tax rate, exam rooms, and feature flags like fingerprint identification.',
  },
  {
    id: 'hr',
    route: '/hr',
    target: '',
    title: 'HR & leave',
    body: 'Staff roster, shift schedule, leave requests, and payroll — with CSV export.',
  },
  {
    id: 'equipment',
    route: '/equipment',
    target: '',
    title: 'Assets & equipment',
    body: 'Register assets with service intervals, log services and repairs, and watch the “service due soon” 30-day lookahead.',
  },
  messagingStep('/facility-management'),
  finishStep('/facility-management'),
];

// ── Org admin — §11.2 ──────────────────────────────────────────────────────
const ORG_ADMIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/facility-management',
    target: '',
    title: 'Welcome, Org Admin',
    body: 'You run the organization: facilities, staff accounts, branding, and the price list. Let’s walk each.',
  },
  {
    id: 'hospitals',
    route: '/org-admin/hospitals',
    target: '',
    title: 'Your facilities',
    body: 'Create and manage the hospitals and clinics in your organization.',
  },
  {
    id: 'users',
    route: '/org-admin/users',
    target: '',
    title: 'Staff accounts',
    body: 'Create staff, reset passwords, deactivate. New accounts are provisioned centrally with a temporary password the user must change at first login — so they can sign in on any device.',
  },
  {
    id: 'pricing',
    route: '/org-admin/pricing',
    target: '',
    title: 'The price list',
    body: 'The fee schedule that powers billing: category, service code, unit price. Unpriced services are skipped, never charged at zero.',
  },
  {
    id: 'branding',
    route: '/org-admin/branding',
    target: '',
    title: 'Branding',
    body: 'Your logo and theme, applied across every facility in the organization.',
  },
  messagingStep('/facility-management'),
  finishStep('/facility-management'),
];

// ── County health director — §10 ───────────────────────────────────────────
const COUNTY_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/dashboard/state',
    target: '',
    title: 'Welcome to your county dashboard',
    body: 'Jurisdiction-scoped oversight: MCH indicators, births/deaths, immunization coverage, and facilities — aggregate only, never patient-level.',
  },
  {
    id: 'surveillance',
    route: '/surveillance',
    target: '',
    title: 'Disease surveillance',
    body: 'Notifiable-disease counts across the states, outbreak alerts, and exportable line lists.',
  },
  {
    id: 'assessments',
    route: '/facility-assessments',
    target: '',
    title: 'Facility assessments',
    body: 'Supervisor scorecards for the facilities in your jurisdiction; facilities also self-submit via My Facility.',
  },
  messagingStep('/dashboard/state'),
  finishStep('/dashboard/state'),
];

// ── Government (MoH) — §10 ─────────────────────────────────────────────────
const GOVERNMENT_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/government',
    target: '',
    title: 'Welcome to the national dashboard',
    body: 'Weekly disease trends, facility distribution, and performance by state — with chart-type switches, fullscreen views, and drill-downs.',
  },
  {
    id: 'surveillance',
    route: '/surveillance',
    target: '',
    title: 'Surveillance',
    body: 'Notifiable diseases across the 28 states; create outbreak alerts and export line lists.',
  },
  {
    id: 'epidemic',
    route: '/epidemic-intelligence',
    target: '',
    title: 'Epidemic intelligence',
    body: 'Signal detection, outbreak risk, and hotspot mapping — the epidemic curves aggregate real weekly case reports.',
  },
  {
    id: 'dhis2',
    route: '/dhis2-export',
    target: '',
    title: 'DHIS2',
    body: 'National-level exports and sync into the HMIS — with a persisted, honest sync log.',
  },
  messagingStep('/government'),
  finishStep('/government'),
];

// ── Super admin — §11.1 ────────────────────────────────────────────────────
const SUPER_ADMIN_STEPS: TourStep[] = [
  {
    id: 'welcome',
    route: '/admin',
    target: '',
    title: 'Welcome, platform operator',
    body: 'Organizations, users, system config, tenant billing, and sync conflicts. Let’s walk the platform console.',
  },
  {
    id: 'orgs',
    route: '/admin/organizations',
    target: '',
    title: 'Organizations',
    body: 'Create and deactivate tenants — each organization is fully isolated.',
  },
  {
    id: 'users',
    route: '/admin/users',
    target: '',
    title: 'Cross-tenant users',
    body: 'Add users, change roles, activate/deactivate across every tenant. Only you can grant platform or national roles.',
  },
  {
    id: 'system',
    route: '/admin/system',
    target: '',
    title: 'System',
    body: 'Local data stores and build facts — platform settings live under Configuration.',
  },
  {
    id: 'billing',
    route: '/admin/billing',
    target: '',
    title: 'Tenant billing',
    body: 'Subscription plans and statuses per organization.',
  },
  {
    id: 'conflicts',
    route: '/admin/conflicts',
    target: '',
    title: 'Sync conflicts',
    body: 'Resolve or dismiss offline-sync conflicts — the safety valve of an offline-first system.',
  },
  messagingStep('/admin'),
  finishStep('/admin'),
];

// ── Medical superintendent — clinical journey + oversight stops ────────────
const SUPERINTENDENT_STEPS: TourStep[] = [
  ...clinicalOfficerTourSteps.filter(s => s.id !== 'finish'),
  {
    id: 'payments-oversight',
    route: '/payments',
    target: '',
    title: 'Financial oversight',
    body: 'You also see collections, the pending-verification queue, and claims — the money side of the visits you supervise.',
  },
  {
    id: 'hr-oversight',
    route: '/hr',
    target: '',
    title: 'People',
    body: 'Shifts, leave, and payroll for the clinical teams you run.',
  },
  messagingStep('/dashboard'),
  finishStep('/dashboard'),
];

const JOURNEY_STEPS: Partial<Record<UserRole, TourStep[]>> = {
  // Clinical
  clinical_officer: clinicalOfficerTourSteps,
  doctor: clinicalOfficerTourSteps,
  clinician: clinicalOfficerTourSteps,
  medical_superintendent: SUPERINTENDENT_STEPS,
  // Nursing
  nurse: NURSE_STEPS,
  midwife: NURSE_STEPS,
  triage_nurse: NURSE_STEPS,
  rooming_nurse: NURSE_STEPS,
  // Diagnostics & pharmacy
  lab_tech: LAB_STEPS,
  pharmacist: PHARMACY_STEPS,
  radiologist: RADIOLOGY_STEPS,
  nutritionist: NUTRITION_STEPS,
  // Front of house
  front_desk: FRONT_DESK_STEPS,
  central_registration_clerk: FRONT_DESK_STEPS,
  clinic_clerk: FRONT_DESK_STEPS,
  // Money
  cashier: CASHIER_STEPS,
  medical_biller: BILLER_STEPS,
  // Records
  hrio: RECORDS_STEPS,
  records_hmis_officer: RECORDS_STEPS,
  data_entry_clerk: RECORDS_STEPS,
  // Management & admin
  hospital_manager: MANAGER_STEPS,
  org_admin: ORG_ADMIN_STEPS,
  county_health_director: COUNTY_STEPS,
  government: GOVERNMENT_STEPS,
  super_admin: SUPER_ADMIN_STEPS,
};

function isRouteAllowed(route: string, allowedRoutes: readonly string[]): boolean {
  return allowedRoutes.some(r => route === r || route.startsWith(r + '/'));
}

/**
 * Roles that have a bespoke journey tour.
 *
 * Exported so a test can assert every one of them actually SURVIVES route
 * filtering. A role can be listed here and still fall through to the generic
 * shell tour if `journeyTourForRole` filters it below the minimum — a silent
 * regression that is invisible from reading the table above.
 */
export const JOURNEY_TOUR_ROLES = Object.keys(JOURNEY_STEPS) as UserRole[];

/**
 * The journey tour for a role, with any steps whose route falls outside the
 * role's allow-list removed (so the tour never strands a user on an
 * "Access Restricted" screen). Returns undefined when the role has no
 * journey or filtering leaves too little to be worth touring — callers fall
 * back to the generic shell tour.
 */
export function journeyTourForRole(role: UserRole): TourDefinition | undefined {
  const steps = JOURNEY_STEPS[role];
  if (!steps) return undefined;
  const allowed = getRoleConfig(role)?.allowedRoutes || [];
  const filtered = steps.filter(s => isRouteAllowed(s.route, allowed));
  if (filtered.length < 3) return undefined;
  return { key: `journey-${role}`, steps: filtered };
}
