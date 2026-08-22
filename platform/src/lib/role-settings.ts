/**
 * Per-user role settings (design 11 — "Settings by Role").
 *
 * Each signed-in user sees ONLY their own role's settings page; there is no
 * role switcher and no other users listed here. Values persist per user on
 * this device (offline-first, like user-prefs); a handful of rows are wired
 * to real app state (language, density, display name) by the settings view.
 */

export type RoleSettingRow =
  /**
   * `pending` marks a row that is DECLARED but not WIRED — the control renders
   * so the intent is visible, and nothing reads its value.
   *
   * It exists because `mar.barcode` ("Barcode scan before administering —
   * Confirms patient and drug") shipped defaulted ON while the platform has no
   * bedside barcode scanning and nothing anywhere reads the key. In a
   * medication-administration context that is a safety affordance that lies: a
   * nurse could reasonably believe the system verifies patient and drug before
   * a dose. Marking it keeps the roadmap visible without the claim.
   */
  | { kind: 'toggle'; key: string; label: string; hint: string; def: boolean; pending?: true }
  | { kind: 'select'; key: string; label: string; hint: string; def: string; options: string[] }
  | { kind: 'text'; key: string; label: string; hint: string; def: string }
  | { kind: 'locked'; label: string; hint: string; value: string }
  | { kind: 'action'; label: string; hint: string; action: 'password' | 'pin'; buttonLabel: string };

export type RoleSettingSection = {
  id: string;
  title: string;
  icon: string; // key into the view's icon map
  note: string;
  rows: RoleSettingRow[];
};

export type RoleSettingsSpec = {
  /** Chip + page title, e.g. "Doctor". */
  title: string;
  /** Bold line of the scope card. */
  subtitle: string;
  /** Body of the scope card. */
  scope: string;
  /** "You control" chips. */
  chips: string[];
  /** Role accent for avatar/identity bar/scope border. */
  /** Identity, not status: the category-axis hue behind this role's avatar
   *  on their own settings page. Never a success/warning/danger colour — a
   *  green chip must not read as "resolved" when it only means "pharmacist". */
  accent: string;
  sections: RoleSettingSection[];
};

const tg = (key: string, label: string, hint: string, def: boolean, pending?: true): RoleSettingRow =>
  ({ kind: 'toggle', key, label, hint, def, ...(pending ? { pending } : {}) });
const sel = (key: string, label: string, hint: string, def: string, options: string[]): RoleSettingRow =>
  ({ kind: 'select', key, label, hint, def, options });
const lock = (label: string, hint: string, value: string): RoleSettingRow =>
  ({ kind: 'locked', label, hint, value });

/** Sections every user gets — account, notifications, security. */
function accountSection(landing: string, landingOptions: string[]): RoleSettingSection {
  return {
    id: 'account', title: 'My account', icon: 'user', note: 'Visible to facility admins',
    rows: [
      { kind: 'text', key: 'account.displayName', label: 'Display name', hint: 'Shown on notes, receipts, and referrals', def: '' },
      sel('account.language', 'Interface language', 'Applies to labels and printed forms', 'English', []),
      sel('account.landing', 'Start-up screen', 'Where sign-in lands you', landing, landingOptions),
      sel('account.density', 'Data density', 'Row height in queues and tables', 'Comfortable', ['Comfortable', 'Compact']),
    ],
  };
}

function notifySection(rows: RoleSettingRow[]): RoleSettingSection {
  return { id: 'notifications', title: 'Notifications', icon: 'bell', note: 'In-app, plus SMS where a number is on file', rows };
}

function securitySection(twoFactor: boolean, idle: string, mask: boolean): RoleSettingSection {
  return {
    id: 'security', title: 'Security & sessions', icon: 'shield', note: 'Policy set by the facility admin',
    rows: [
      tg('security.twoFactor', 'Two-factor authentication', 'One-time code at sign-in', twoFactor),
      sel('security.idle', 'Auto sign-out after inactivity', 'Shared-workstation protection', idle, ['5 min', '10 min', '15 min', '30 min']),
      tg('security.mask', 'Hide patient identifiers on shared screens', 'Masks phone and address in queues', mask),
      { kind: 'action', label: 'Password', hint: 'Change the password you sign in with', action: 'password', buttonLabel: 'Change password' },
      { kind: 'action', label: 'Screen-lock PIN', hint: 'Quick unlock on this shared device', action: 'pin', buttonLabel: 'Manage PIN' },
      lock('Password policy', 'Minimum length and rotation period', 'Facility-managed'),
    ],
  };
}

const DOCTOR: RoleSettingsSpec = {
  title: 'Doctor', accent: 'var(--color-info-text)',
  subtitle: 'Consultation defaults, prescribing safety, and your queue preferences',
  scope: 'You can change your own clinical defaults and notifications. Formulary, tariffs, and triage rules are facility-wide and set by an administrator.',
  chips: ['Consultation defaults', 'Prescribing prompts', 'Queue order', 'My alerts'],
  sections: [
    accountSection('My dashboard', ['My dashboard', 'Patients', 'Appointments', 'Consultation']),
    {
      id: 'consultation', title: 'Consultation defaults', icon: 'steth', note: 'Applied to each new consultation you open',
      rows: [
        sel('consult.length', 'Default appointment length', 'Used when you book from your calendar', '20 min', ['10 min', '15 min', '20 min', '30 min', '45 min']),
        sel('consult.template', 'Note template', 'Pre-loaded structure for new notes', 'SOAP', ['SOAP', 'Free text', 'Problem-oriented']),
        sel('consult.coding', 'Diagnosis coding', 'Facility standard is ICD-11', 'ICD-11', ['ICD-11', 'ICD-10']),
        tg('consult.requireDx', 'Require a diagnosis before closing', 'Blocks closing a visit without a code', true),
        tg('consult.autosave', 'Auto-save notes every 30 seconds', 'Protects work during power cuts', true),
      ],
    },
    {
      id: 'prescribing', title: 'Prescribing & safety', icon: 'pill', note: 'Allergy and interaction checks',
      rows: [
        tg('rx.allergyCheck', 'Allergy check before prescribing', 'Hard stop on a documented allergy', true),
        tg('rx.interactions', 'Interaction warnings', 'Flags major drug-drug interactions', true),
        tg('rx.inStockOnly', 'Show only in-stock medicines by default', 'Reduces prescriptions the pharmacy cannot fill', true),
        sel('rx.duration', 'Default prescription duration', 'Editable per prescription', '5 days', ['3 days', '5 days', '7 days', '14 days', '30 days']),
        lock('Controlled substances', 'Requires a witness at dispensing', 'Facility-managed'),
      ],
    },
    {
      id: 'queue', title: 'My queue', icon: 'list', note: 'How your patient list is ordered and filtered',
      rows: [
        sel('queue.sort', 'Sort patients by', 'Default order in your list', 'Longest wait first', ['Longest wait first', 'Acuity first', 'Appointment time']),
        tg('queue.mineOnly', 'Show only patients assigned to me', 'Hides the wider facility queue', true),
        tg('queue.overTarget', 'Highlight waits over target', 'Red once past the 30-minute target', true),
      ],
    },
    notifySection([
      tg('notify.criticalLabs', 'Critical lab results', 'Immediate alert plus SMS out of hours', true),
      tg('notify.cosign', 'Co-signature requests', 'When a colleague needs your sign-off', true),
      tg('notify.referrals', 'New referrals to me', 'Incoming referrals from other facilities', true),
      tg('notify.apptSummary', 'Appointment reminders', 'Daily summary at 07:00', false),
    ]),
    securitySection(true, '15 min', false),
  ],
};

const NURSE: RoleSettingsSpec = {
  title: 'Nurse', accent: 'var(--category-clinical)',
  subtitle: 'Ward assignment, vitals and MAR rounds, handoff and shift preferences',
  scope: 'You can set your ward, rounding intervals, and alerts. Triage scales and medication policy are facility-wide.',
  chips: ['Ward & shift', 'Rounding intervals', 'MAR prompts', 'My alerts'],
  sections: [
    accountSection('Nursing station', ['Nursing station', 'Ward board', 'Triage', 'Patients']),
    {
      id: 'ward', title: 'Ward & shift', icon: 'bed', note: 'Drives your station view and handoff',
      rows: [
        sel('ward.default', 'Default ward', 'Loaded when you sign in', 'Maternity', ['Medical', 'Surgical', 'Maternity', 'Pediatric']),
        sel('ward.shift', 'Shift pattern', 'Used for handoff timing', 'Day · 07:00–19:00', ['Day · 07:00–19:00', 'Evening · 15:00–23:00', 'Night · 19:00–07:00']),
        tg('ward.myBeds', 'Show only my assigned beds', 'Hides the rest of the ward', false),
        tg('ward.handoffPrompt', 'Prompt handoff at end of shift', 'Opens the handoff form 30 min before', true),
      ],
    },
    {
      id: 'vitals', title: 'Vitals & rounds', icon: 'clock', note: 'Rounding reminders per acuity',
      rows: [
        sel('vitals.critical', 'Critical patients', 'Vitals interval for red acuity', 'Every 1 hour', ['Every 30 min', 'Every 1 hour', 'Every 2 hours']),
        sel('vitals.watch', 'Watch patients', 'Vitals interval for yellow acuity', 'Every 4 hours', ['Every 2 hours', 'Every 4 hours', 'Every 6 hours']),
        sel('vitals.stable', 'Stable patients', 'Vitals interval for green acuity', 'Every 8 hours', ['Every 6 hours', 'Every 8 hours', 'Every 12 hours']),
        tg('vitals.rangeWarn', 'Warn on out-of-range vitals', 'Flags values outside the age-based range', true),
        sel('vitals.units', 'Vitals units', 'Facility standard is metric', 'Metric (kg · °C)', ['Metric (kg · °C)', 'Imperial (lb · °F)']),
      ],
    },
    {
      id: 'mar', title: 'Medication administration', icon: 'pill', note: 'MAR behaviour at the bedside',
      rows: [
        // Not wired: the platform has no bedside barcode scanning, and nothing
        // reads this key. Shown as unavailable rather than as a live safety check.
        tg('mar.barcode', 'Barcode scan before administering', 'Confirms patient and drug', true, true),
        sel('mar.reminder', 'Dose-due reminder', 'How early the MAR alerts you', '15 min before', ['5 min before', '15 min before', '30 min before']),
        tg('mar.missedReason', 'Require a reason for a missed dose', 'Recorded in the audit log', true),
        lock('Controlled substance witness', 'Second signature at administration', 'Facility-managed'),
      ],
    },
    notifySection([
      tg('notify.vitals', 'Deteriorating vitals', 'Immediate alert on the station screen', true),
      tg('notify.overdueDoses', 'Overdue medication doses', 'Alerts once a dose passes its window', true),
      tg('notify.admissions', 'New admissions to my ward', 'When a patient is assigned a bed', true),
      tg('notify.discharge', 'Discharge paperwork ready', 'Daily summary', false),
    ]),
    securitySection(false, '10 min', true),
  ],
};

const PHARMACIST: RoleSettingsSpec = {
  title: 'Pharmacist', accent: 'var(--category-clinical)',
  subtitle: 'Dispensing rules, stock thresholds, and controlled-substance handling',
  scope: 'You manage dispensing behaviour and stock alert levels. The national formulary and price list are facility-wide.',
  chips: ['Dispensing rules', 'Reorder levels', 'Register checks', 'My alerts'],
  sections: [
    accountSection('Dispense queue', ['Dispense queue', 'Stock', 'My dashboard']),
    {
      id: 'dispensing', title: 'Dispensing', icon: 'pill', note: 'Applies to every prescription you fill',
      rows: [
        tg('disp.paymentGate', 'Block dispensing until payment or exemption', 'Payment-gated queue', true),
        tg('disp.generic', 'Offer generic substitution', 'Suggests an in-stock equivalent', true),
        tg('disp.labels', 'Print a label for every item', 'Patient name, drug, dose, date', true),
        sel('disp.batch', 'Batch selection', 'Which batch is picked by default', 'Earliest expiry first', ['Earliest expiry first', 'Oldest stock first', 'Manual']),
        tg('disp.counsel', 'Counsel prompt for new medicines', 'Shows key counselling points', true),
      ],
    },
    {
      id: 'stock', title: 'Stock & reorder', icon: 'list', note: 'Thresholds that drive the alerts',
      rows: [
        sel('stock.reorder', 'Reorder trigger', 'When an item is flagged low', 'Below 30 days of cover', ['Below 14 days of cover', 'Below 30 days of cover', 'Below 60 days of cover']),
        sel('stock.expiry', 'Expiry warning window', 'How early a batch is flagged', '30 days', ['14 days', '30 days', '60 days', '90 days']),
        tg('stock.autoPo', 'Auto-draft purchase orders', 'Creates a PO when items fall below level', true),
        tg('stock.adjustReason', 'Require a reason for stock adjustment', 'Recorded in the audit log', true),
      ],
    },
    {
      id: 'controlled', title: 'Controlled substances', icon: 'shield', note: 'Register kept for inspection',
      rows: [
        lock('Witness signature required', 'Second staff member at dispensing', 'Facility-managed'),
        tg('cs.reconcile', 'Daily register reconciliation', 'Prompts a count at close of day', true),
        tg('cs.discrepancy', 'Alert on any discrepancy', 'Notifies the facility admin immediately', true),
      ],
    },
    notifySection([
      tg('notify.stockOut', 'Stock-out risk', 'When an item falls below reorder level', true),
      tg('notify.expiring', 'Expiring batches', 'Weekly summary of batches within 30 days', true),
      tg('notify.newRx', 'New prescriptions to dispense', 'Live queue notification', true),
      tg('notify.po', 'Purchase order status', 'When a PO is approved or delivered', true),
    ]),
    securitySection(true, '10 min', false),
  ],
};

const LAB: RoleSettingsSpec = {
  title: 'Laboratory technician', accent: 'var(--category-lab)',
  subtitle: 'Worklist, sample handling, result verification and critical-value alerts',
  scope: 'You control worklist and verification behaviour. Test panels, reference ranges, and pricing are facility-wide.',
  chips: ['Worklist order', 'Sample rules', 'Verification', 'My alerts'],
  sections: [
    accountSection('Lab worklist', ['Lab worklist', 'My dashboard']),
    {
      id: 'worklist', title: 'Worklist', icon: 'list', note: 'How orders are presented to you',
      rows: [
        sel('lab.sort', 'Sort orders by', 'Default order in the worklist', 'Urgency, then oldest', ['Urgency, then oldest', 'Oldest first', 'Newest first']),
        sel('lab.bench', 'Bench filter', 'Only show tests you run', 'Chemistry · Microscopy', ['All benches', 'Chemistry · Microscopy', 'Haematology', 'Serology']),
        tg('lab.statTop', 'Show STAT orders at the top', 'Pins urgent orders regardless of sort', true),
        sel('lab.tat', 'Turnaround target', 'Drives the overdue highlight', '60 min', ['30 min', '60 min', '120 min']),
      ],
    },
    {
      id: 'samples', title: 'Sample handling', icon: 'flask', note: 'Collection and labelling',
      rows: [
        tg('lab.barcode', 'Barcode label at collection', 'Prints a sample label on accession', true),
        tg('lab.collector', 'Require collector identity', 'Records who drew the sample', true),
        tg('lab.sampleAge', 'Warn on sample age', 'Flags samples past stability window', true),
        sel('lab.reject', 'Reject reason list', 'Options offered when rejecting a sample', 'National standard', ['National standard', 'Facility list']),
      ],
    },
    {
      id: 'results', title: 'Results & verification', icon: 'doc', note: 'Before a result reaches the clinician',
      rows: [
        tg('lab.secondReview', 'Second review for critical values', 'A colleague verifies before release', true),
        tg('lab.autoFlag', 'Auto-flag out-of-range values', 'Against the facility reference ranges', true),
        tg('lab.notifyClinician', 'Notify the ordering clinician on release', 'In-app alert plus SMS if critical', true),
        lock('Reference ranges', 'Age and sex-specific ranges', 'Facility-managed'),
      ],
    },
    notifySection([
      tg('notify.stat', 'New STAT orders', 'Immediate alert on the bench screen', true),
      tg('notify.criticalUnacked', 'Unacknowledged critical results', 'Escalates after 15 minutes', true),
      tg('notify.analyser', 'Analyser errors', 'When an instrument reports a fault', true),
      tg('notify.reagent', 'Reagent stock low', 'Weekly summary', false),
    ]),
    securitySection(true, '15 min', true),
  ],
};

const FRONTDESK: RoleSettingsSpec = {
  title: 'Front desk & billing', accent: 'var(--category-transfer)',
  subtitle: 'Registration, check-in routing, payments and receipt handling',
  scope: 'You control registration and payment-desk behaviour. Tariffs, exemptions, and insurance contracts are facility-wide.',
  chips: ['Registration rules', 'Check-in routing', 'Payment desk', 'My alerts'],
  sections: [
    accountSection('Check-in', ['Check-in', 'Payments', 'Patients', 'My dashboard']),
    {
      id: 'registration', title: 'Registration', icon: 'users', note: 'New patient records',
      rows: [
        tg('reg.phone', 'Require phone number', 'Unless the patient has none on record', true),
        tg('reg.geocode', 'Require geocode ID', 'Household identifier for follow-up', false),
        tg('reg.duplicates', 'Warn on possible duplicates', 'Matches name, age, and locality', true),
        tg('reg.card', 'Print a patient card with QR code', 'Speeds up return visits', true),
        sel('reg.district', 'Default district', 'Pre-filled on new registrations', 'Juba', ['Juba', 'Wau', 'Malakal', 'Bor', 'Bentiu']),
      ],
    },
    {
      id: 'routing', title: 'Check-in routing', icon: 'list', note: 'Where arrivals are sent',
      rows: [
        sel('route.department', 'Default department', 'Applied when none is chosen', 'OPD', ['OPD', 'Emergency', 'ANC', 'Under-five clinic']),
        sel('route.acuity', 'Default acuity', 'Clerk may raise it, never lower it', 'Routine', ['Routine', 'Urgent']),
        tg('route.triageFirst', 'Send every arrival to triage first', 'Nurse sets the final acuity', true),
        tg('route.queueLength', 'Show live queue length per department', 'Helps balance the load', true),
      ],
    },
    {
      id: 'payments', title: 'Payments & receipts', icon: 'card', note: 'Cash, mobile money, and exemptions',
      rows: [
        sel('pay.method', 'Default payment method', 'Most common at this desk', 'Cash', ['Cash', 'Mobile money', 'Insurance']),
        tg('pay.mgurush', 'm-Gurush mobile money', 'Confirmations post to billing automatically', true),
        tg('pay.receipt', 'Print a receipt for every payment', 'Duplicate kept for reconciliation', true),
        tg('pay.reconcile', 'Prompt end-of-shift reconciliation', 'Cash count against recorded takings', true),
        lock('Exemption categories', 'ANC, EPI, and under-five exemptions', 'Facility-managed'),
      ],
    },
    notifySection([
      tg('notify.unpaid', 'Unpaid invoices at discharge', 'Alerts before a patient leaves', true),
      tg('notify.claims', 'Insurance claim rejections', 'When a payer rejects a claim', true),
      tg('notify.queue', 'Queue over capacity', 'When waits pass the target', true),
      tg('notify.collections', 'Daily collection summary', 'Sent at close of shift', true),
    ]),
    securitySection(false, '5 min', true),
  ],
};

const ADMIN: RoleSettingsSpec = {
  title: 'Facility administrator', accent: 'var(--category-admin)',
  subtitle: 'Facility-wide configuration, users, reporting and integrations',
  scope: 'You set the policies every other role inherits. Changes here apply facility-wide and are recorded in the audit log.',
  chips: ['Facility profile', 'Users & roles', 'Clinical policy', 'Reporting', 'Integrations'],
  sections: [
    accountSection('Facility dashboard', ['Facility dashboard', 'Reports', 'Patients']),
    {
      id: 'facility', title: 'Facility profile', icon: 'building', note: 'Appears on receipts, referrals, and exports',
      rows: [],
    },
    {
      id: 'users', title: 'Users & roles', icon: 'users', note: 'Account policy — manage people from User management',
      rows: [],
    },
    // Clinical policy, Users & roles policy, Reporting and Integrations are
    // FACILITY policy, not personal preference: they must hold for every user
    // on every device, so they live in the replicated `facility_settings` doc
    // and are edited by `components/settings/FacilityPolicySections.tsx`.
    // Only the section shells stay here, to name the rail entries.
    {
      id: 'clinical', title: 'Clinical policy', icon: 'steth', note: 'Inherited by clinical roles',
      rows: [],
    },
    {
      id: 'reporting', title: 'Reporting & data', icon: 'doc', note: 'DHIS2 and surveillance obligations',
      rows: [],
    },
    {
      id: 'integrations', title: 'Integrations & offline sync', icon: 'sync', note: 'Connections this facility relies on',
      rows: [],
    },
    notifySection([
      tg('notify.syncConflicts', 'Sync conflicts', 'When a record cannot merge automatically', true),
      tg('notify.surveillance', 'Surveillance signals', 'IDSR alert thresholds reached', true),
      tg('notify.integrations', 'Failed integrations', 'Credential or connection errors', true),
      tg('notify.weekly', 'Weekly facility summary', 'Attendance, collections, and stock', true),
    ]),
    securitySection(true, '15 min', false),
  ],
};

/** Generic fallback for roles without a bespoke design page. */
const GENERIC: RoleSettingsSpec = {
  title: 'Staff member', accent: 'var(--category-admin)',
  subtitle: 'Your account, alerts, and session preferences',
  scope: 'You can change your own preferences and notifications. Facility-wide policy is set by an administrator.',
  chips: ['My account', 'My alerts', 'My sessions'],
  sections: [
    accountSection('My dashboard', ['My dashboard', 'Patients']),
    notifySection([
      tg('notify.assigned', 'Work assigned to me', 'When an item lands in my queue', true),
      tg('notify.mentions', 'Messages and mentions', 'When a colleague messages me', true),
      tg('notify.summary', 'Daily summary', 'Sent at the start of the day', false),
    ]),
    securitySection(false, '15 min', false),
  ],
};

import type { UserRole } from '@/lib/db-types';

/** Which design spec a signed-in role sees — their own only. */
export function specForRole(role: UserRole): RoleSettingsSpec {
  switch (role) {
    case 'doctor':
    case 'clinician':
      return DOCTOR;
    case 'clinical_officer':
      return { ...DOCTOR, title: 'Clinical Officer' };
    case 'nurse':
    case 'triage_nurse':
    case 'rooming_nurse':
      return NURSE;
    case 'midwife':
      return { ...NURSE, title: 'Midwife' };
    case 'pharmacist':
      return PHARMACIST;
    case 'lab_tech':
      return LAB;
    case 'radiologist':
      return { ...LAB, title: 'Radiologist' };
    case 'front_desk':
    case 'central_registration_clerk':
    case 'clinic_clerk':
      return FRONTDESK;
    case 'cashier':
    case 'medical_biller':
      return { ...FRONTDESK, title: 'Billing & payments' };
    case 'hospital_manager':
    case 'medical_superintendent':
    case 'org_admin':
    case 'super_admin':
      return ADMIN;
    case 'government':
    case 'county_health_director':
      return { ...ADMIN, title: 'Health authority' };
    default:
      return GENERIC;
  }
}

// ── Per-user persisted values ──────────────────────────────────────────────

const storageKey = (userId: string) => `tamamhealth.roleSettings.${userId}`;

export type RoleSettingsValues = Record<string, boolean | string>;

export function getStoredRoleSettings(userId: string): RoleSettingsValues {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as RoleSettingsValues) : {};
  } catch {
    return {};
  }
}

export function saveStoredRoleSettings(userId: string, values: RoleSettingsValues): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(values));
  } catch {
    // Storage unavailable — settings simply reset next session.
  }
}
