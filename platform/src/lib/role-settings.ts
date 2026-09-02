/**
 * Per-user role settings (design 11 — "Settings by Role").
 *
 * Each signed-in user sees ONLY their own role's settings page; there is no
 * role switcher and no other users listed here. Values persist per user on
 * this device (offline-first, like user-prefs); a handful of rows are wired
 * to real app state (language, density, display name) by the settings view.
 */

import { LANDING_ROUTES } from '@/lib/user-prefs';
import { isPathAllowed } from '@/lib/role-routes';

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
   *
   * An audit in Aug 2026 found `mar.barcode` was not the exception. Of 92
   * declared keys, 56 appeared nowhere in the codebase outside this file —
   * `security.twoFactor` ("One-time code at sign-in"), `lab.secondReview` ("A
   * colleague verifies before release"), `cs.discrepancy` ("Notifies the
   * facility admin immediately"), `disp.paymentGate` ("Block dispensing until
   * payment"). Each renders as a live switch a user can turn on, and each does
   * nothing in either position. They are all marked now.
   *
   * `settings-are-wired.test.ts` holds the line: a key is either read
   * somewhere or marked `pending`. Wiring one up means deleting its marker,
   * which is the direction this should move in.
   */
  | { kind: 'toggle'; key: string; label: string; hint: string; def: boolean; pending?: true }
  | { kind: 'select'; key: string; label: string; hint: string; def: string; options: string[]; pending?: true }
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
const sel = (key: string, label: string, hint: string, def: string, options: string[], pending?: true): RoleSettingRow =>
  ({ kind: 'select', key, label, hint, def, options, ...(pending ? { pending } : {}) });
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
      // 'System' follows the device's OS preference live. Default stays
      // 'Light' — see the theme note in lib/user-prefs.ts.
      sel('account.theme', 'Appearance', 'Light or dark interface', 'Light', ['Light', 'Dark', 'System']),
    ],
  };
}

function notifySection(rows: RoleSettingRow[]): RoleSettingSection {
  return { id: 'notifications', title: 'Notifications', icon: 'bell', note: 'In-app, plus SMS where a number is on file', rows };
}

/**
 * `twoFactor` used to be the first argument here, seeding a toggle that was
 * declared `pending` and backed by nothing. Two-factor is a real action now
 * (see the row below), so the per-role default has no meaning: whether an
 * account needs a second factor is decided by the platform policy and the
 * account's role, not by a preference seeded per dashboard.
 */
function securitySection(idle: string, mask: boolean): RoleSettingSection {
  return {
    id: 'security', title: 'Security & sessions', icon: 'shield', note: 'Policy set by the facility admin',
    rows: [
      // The user's master switch for their screen lock. Off withdraws the
      // configured default window unless an operator explicitly made locking
      // mandatory; in that case this row reads as admin-required instead of a
      // switch (see RoleSettingsView and useAutoLock).
      tg('security.lock', 'Lock the screen when idle', 'Off keeps this session open on a device only you use', true),
      // The window the switch above uses. 'Off' is deliberately NOT an option
      // here any more: two controls that both mean "no lock" is two things
      // that can disagree. A value stored from before the switch existed
      // still reads as no user lock (idleChoiceMinutes returns undefined).
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
        sel('consult.template', 'Note template', 'Pre-loaded structure for new notes', 'SOAP', ['SOAP', 'Free text', 'Problem-oriented'], true),
        sel('consult.coding', 'Diagnosis coding', 'Facility standard is ICD-11', 'ICD-11', ['ICD-11', 'ICD-10'], true),
        tg('consult.requireDx', 'Require a diagnosis before closing', 'Blocks closing a visit without a code', true, true),
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
      tg('notify.visitUpdates', "My patients' visit updates", 'Each stage — triaged, ready to call in, at pharmacy, dispensed', true),
      tg('notify.cosign', 'Co-signature requests', 'When a colleague needs your sign-off', true),
      tg('notify.referrals', 'New referrals to me', 'Incoming referrals from other facilities', true),
      tg('notify.apptSummary', 'Appointment reminders', 'Daily summary at 07:00', false),
    ]),
    securitySection('15 min', false),
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
        sel('ward.default', 'Default ward', 'Loaded when you sign in', 'Maternity', ['Medical', 'Surgical', 'Maternity', 'Pediatric'], true),
        sel('ward.shift', 'Shift pattern', 'Used for handoff timing', 'Day · 07:00–19:00', ['Day · 07:00–19:00', 'Evening · 15:00–23:00', 'Night · 19:00–07:00'], true),
        tg('ward.myBeds', 'Show only my assigned beds', 'Hides the rest of the ward', false, true),
        tg('ward.handoffPrompt', 'Prompt handoff at end of shift', 'Opens the handoff form 30 min before', true, true),
      ],
    },
    {
      id: 'mar', title: 'Medication administration', icon: 'pill', note: 'MAR behaviour at the bedside',
      rows: [
        lock('Controlled substance witness', 'Second signature at administration', 'Facility-managed'),
      ],
    },
    notifySection([
      tg('notify.vitals', 'Deteriorating vitals', 'Immediate alert on the station screen', true),
      tg('notify.visitUpdates', "My patients' visit updates", 'Each stage a patient assigned to me moves through', true),
      tg('notify.overdueDoses', 'Overdue medication doses', 'Alerts once a dose passes its window', true),
      tg('notify.admissions', 'New admissions to my ward', 'When a patient is assigned a bed', true),
    ]),
    securitySection('10 min', true),
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
      id: 'stock', title: 'Stock & reorder', icon: 'list', note: 'Thresholds that drive the alerts',
      rows: [
        sel('stock.reorder', 'Reorder trigger', 'When an item is flagged low', 'Below 30 days of cover', ['Below 14 days of cover', 'Below 30 days of cover', 'Below 60 days of cover']),
        sel('stock.expiry', 'Expiry warning window', 'How early a batch is flagged', '30 days', ['14 days', '30 days', '60 days', '90 days']),
        tg('stock.autoPo', 'Auto-draft purchase orders', 'Creates a PO when items fall below level', true, true),
        tg('stock.adjustReason', 'Require a reason for stock adjustment', 'Recorded in the audit log', true, true),
      ],
    },
    {
      id: 'controlled', title: 'Controlled substances', icon: 'shield', note: 'Register kept for inspection',
      rows: [
        lock('Witness signature required', 'Second staff member at dispensing', 'Facility-managed'),
      ],
    },
    notifySection([
      tg('notify.newRx', 'New prescriptions to dispense', 'Live queue notification', true),
    ]),
    securitySection('10 min', false),
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
        tg('lab.statTop', 'Show STAT orders at the top', 'Pins urgent orders regardless of sort', true),
        sel('lab.tat', 'Turnaround target', 'Drives the overdue highlight', '60 min', ['30 min', '60 min', '120 min']),
      ],
    },
    {
      id: 'results', title: 'Results & verification', icon: 'doc', note: 'Before a result reaches the clinician',
      rows: [
        lock('Reference ranges', 'Age and sex-specific ranges', 'Facility-managed'),
      ],
    },
    notifySection([
      tg('notify.stat', 'New STAT orders', 'Immediate alert on the bench screen', true),
      tg('notify.criticalUnacked', 'Unacknowledged critical results', 'Escalates after 15 minutes', true),

    ]),
    securitySection('15 min', true),
  ],
};

const FRONTDESK: RoleSettingsSpec = {
  title: 'Front desk & billing', accent: 'var(--category-transfer)',
  subtitle: 'Registration, check-in routing, payments and receipt handling',
  scope: 'You control registration and payment-desk behaviour. Tariffs, exemptions, and insurance contracts are facility-wide.',
  chips: ['Registration rules', 'Check-in routing', 'Payment desk', 'My alerts'],
  sections: [
    accountSection('Check-in', ['Check-in', 'Payments', 'Patients', 'Appointments', 'My dashboard']),
    {
      id: 'registration', title: 'Registration', icon: 'users', note: 'New patient records',
      rows: [
        tg('reg.phone', 'Require phone number', 'Unless the patient has none on record', true),
        tg('reg.geocode', 'Require geocode ID', 'Household identifier for follow-up', false),
        tg('reg.duplicates', 'Warn on possible duplicates', 'Matches name, age, and locality', true),

      ],
    },
    {
      id: 'payments', title: 'Payments & receipts', icon: 'card', note: 'Cash, mobile money, and exemptions',
      rows: [
        sel('pay.method', 'Default payment method', 'Most common at this desk', 'Cash', ['Cash', 'Mobile money', 'Insurance']),
        tg('pay.mgurush', 'm-Gurush mobile money', 'Confirmations post to billing automatically', true, true),
        tg('pay.receipt', 'Print a receipt for every payment', 'Duplicate kept for reconciliation', true, true),
        tg('pay.reconcile', 'Prompt end-of-shift reconciliation', 'Cash count against recorded takings', true, true),
        lock('Exemption categories', 'ANC, EPI, and under-five exemptions', 'Facility-managed'),
      ],
    },
    notifySection([
      tg('notify.queue', 'Queue over capacity', 'When waits pass the target', true),
    ]),
    securitySection('5 min', true),
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
      tg('notify.surveillance', 'Surveillance signals', 'IDSR alert thresholds reached', true),
    ]),
    securitySection('15 min', false),
  ],
};

/**
 * Radiologist — its own spec, not the lab technician's.
 *
 * This role used to be `{ ...LAB, title: 'Radiologist' }`, which changed the
 * heading and nothing else. A radiologist was therefore offered a *Bench
 * filter* of "Chemistry · Microscopy / Haematology / Serology", a *Reject
 * reason list*, and *Barcode label at collection* — sample-handling controls
 * for a discipline that handles no samples — and a start-up screen whose only
 * options were the lab worklist.
 *
 * What genuinely transfers is the shape of a reporting queue: order it, pin
 * the urgent ones, flag what is past target. Those three keys are shared with
 * the lab on purpose — one worklist concept, one stored preference — which the
 * settings guard explicitly allows across roles.
 */
const RADIOLOGY: RoleSettingsSpec = {
  title: 'Radiologist', accent: 'var(--category-lab)',
  subtitle: 'Reporting worklist, urgent studies, and turnaround targets',
  scope: 'You control how your reporting worklist is ordered and when it flags overdue. Modality catalogue, protocols, and reporting templates are facility-wide.',
  chips: ['Worklist order', 'Urgent studies', 'Turnaround', 'My alerts'],
  sections: [
    accountSection('My dashboard', ['My dashboard', 'Patients']),
    {
      id: 'worklist', title: 'Reporting worklist', icon: 'list', note: 'How studies are presented to you',
      rows: [
        sel('lab.sort', 'Sort studies by', 'Default order in your worklist', 'Urgency, then oldest', ['Urgency, then oldest', 'Oldest first', 'Newest first']),
        tg('lab.statTop', 'Show STAT studies at the top', 'Pins urgent studies regardless of sort', true),
        sel('lab.tat', 'Turnaround target', 'Drives the overdue highlight', '60 min', ['30 min', '60 min', '120 min']),
      ],
    },
    notifySection([
      tg('notify.stat', 'New STAT studies', 'Immediate alert on the reporting screen', true),
      tg('notify.criticalUnacked', 'Unacknowledged critical findings', 'Escalates after 15 minutes', true),
    ]),
    securitySection('15 min', true),
  ],
};

/**
 * Midwife — the nurse spec's shape, with maternity as the subject.
 *
 * `{ ...NURSE, title: 'Midwife' }` gave a midwife a general-nursing ward list
 * (Medical / Surgical / Maternity / Pediatric) and a scope note about triage
 * scales. The role's actual routes are ANC, births, immunizations and the
 * ward board, so the ward choice is a maternity area and the alerts are the
 * ones a birth attendant is waiting on.
 */
const MIDWIFE: RoleSettingsSpec = {
  title: 'Midwife', accent: 'var(--category-clinical)',
  subtitle: 'Maternity area, shift pattern, and the alerts you are on call for',
  scope: 'You can set your maternity area, shift, and alerts. Clinical protocols for labour and newborn care are facility-wide.',
  chips: ['Maternity area', 'Shift', 'Handoff', 'My alerts'],
  sections: [
    accountSection('My dashboard', ['My dashboard', 'Ward board', 'Patients', 'Appointments']),
    {
      id: 'ward', title: 'Maternity area & shift', icon: 'bed', note: 'Drives your ward view and handoff',
      rows: [
        sel('ward.default', 'Default area', 'Loaded when you sign in', 'Labour ward', ['Antenatal', 'Labour ward', 'Postnatal', 'Newborn care'], true),
        sel('ward.shift', 'Shift pattern', 'Used for handoff timing', 'Day · 07:00–19:00', ['Day · 07:00–19:00', 'Evening · 15:00–23:00', 'Night · 19:00–07:00'], true),
        tg('ward.handoffPrompt', 'Prompt handoff at end of shift', 'Opens the handoff form 30 min before', true, true),
      ],
    },
    notifySection([
      tg('notify.vitals', 'Deteriorating vitals', 'Immediate alert on the ward screen', true),
      tg('notify.admissions', 'New admissions to my area', 'When a mother is assigned a bed', true),
    ]),
    securitySection('10 min', true),
  ],
};

/**
 * Health authority — a ministry account, which runs no facility.
 *
 * `{ ...ADMIN, title: 'Health authority' }` handed government and county
 * health director users the *Facility administrator* page: facility profile,
 * clinical policy, integrations, offline sync. They administer none of it.
 * Their routes are surveillance, vital statistics and cross-facility reporting,
 * so what they actually own is their own alerts and session.
 */
const HEALTH_AUTHORITY: RoleSettingsSpec = {
  title: 'Health authority', accent: 'var(--category-admin)',
  subtitle: 'Surveillance alerts and session preferences',
  scope: 'You review data across facilities. You set your own alerts and session preferences; each facility\'s configuration belongs to its own administrator.',
  chips: ['My account', 'Surveillance alerts', 'My sessions'],
  sections: [
    // Offered broadly on purpose — `withReachableLandings` prunes whichever of
    // these the specific authority role cannot enter.
    accountSection('My dashboard', ['My dashboard', 'Reports', 'Appointments']),
    notifySection([
      tg('notify.surveillance', 'Surveillance signals', 'IDSR alert thresholds reached', true),
    ]),
    securitySection('15 min', false),
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
    ]),
    securitySection('15 min', false),
  ],
};

import type { UserRole } from '@/lib/db-types';

/**
 * Drop start-up screens this role cannot actually open.
 *
 * The "Start-up screen" options are written per spec, but several specs are
 * shared by roles with different route tables — so the list was a union of
 * what *some* holder of that spec could reach. A front-desk clerk was offered
 * "Payments" and a cashier "Check-in", each being the other's route; a
 * government account was offered "Patients"; and the whole Front-desk spec
 * defaulted to a screen its own holders could not enter.
 *
 * None of it failed loudly: `resolveLandingPage` checks the route and quietly
 * falls back to the role's default dashboard. So the dropdown offered a choice,
 * accepted it, saved it, and then ignored it forever.
 *
 * Filtering here rather than hand-listing per role means a route-table change
 * cannot reopen the gap. Labels absent from `LANDING_ROUTES` ("My dashboard",
 * "Nursing station", …) always survive: they have no route of their own and
 * resolve to the role's default, which every role can reach by definition.
 */
function withReachableLandings(spec: RoleSettingsSpec, role: UserRole): RoleSettingsSpec {
  const account = spec.sections.find(s => s.id === 'account');
  const row = account?.rows.find(r => 'key' in r && r.key === 'account.landing');
  if (!account || !row || row.kind !== 'select') return spec;

  const options = row.options.filter(o => {
    const route = LANDING_ROUTES[o];
    return route ? isPathAllowed(role, route) : true;
  });
  if (options.length === row.options.length) return spec;

  // A default that was just filtered out would re-create the same silent
  // fallback one level down. Prefer a label with no route of its own ("My
  // dashboard", "Nursing station"), which resolves to whatever this role's
  // default dashboard already is — landing a registration clerk on "Payments"
  // because it sorted first is not a better answer than landing them home.
  const def = options.includes(row.def)
    ? row.def
    : (options.find(o => !LANDING_ROUTES[o]) ?? options[0] ?? row.def);

  // Rebuilt, never mutated: these specs are module-level constants shared by
  // several roles, and editing one in place would hand the next role the
  // previous one's filtered list.
  return {
    ...spec,
    sections: spec.sections.map(section => section !== account ? section : {
      ...section,
      rows: section.rows.map(r => r !== row ? r : { ...row, options, def }),
    }),
  };
}

/** Which design spec a signed-in role sees — their own only. */
export function specForRole(role: UserRole): RoleSettingsSpec {
  return withReachableLandings(baseSpecForRole(role), role);
}

function baseSpecForRole(role: UserRole): RoleSettingsSpec {
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
      return MIDWIFE;
    case 'pharmacist':
      return PHARMACIST;
    case 'lab_tech':
      return LAB;
    case 'radiologist':
      return RADIOLOGY;
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
      return HEALTH_AUTHORITY;
    default:
      return GENERIC;
  }
}

// ── Per-user persisted values ──────────────────────────────────────────────

const storageKey = (userId: string) => `tamamhealth.roleSettings.${userId}`;

export type RoleSettingsValues = Record<string, boolean | string>;

/** Keep only active keys belonging to this role, with values the declared
 * control can actually represent. This closes stale-role and forged-setting
 * paths at both hydration and the authenticated preferences endpoint. */
export function sanitizeRoleSettingsForRole(role: UserRole, values: RoleSettingsValues): RoleSettingsValues {
  const out: RoleSettingsValues = {};
  for (const section of specForRole(role).sections) {
    for (const row of section.rows) {
      if (row.kind !== 'toggle' && row.kind !== 'select' && row.kind !== 'text') continue;
      if ('pending' in row && row.pending) continue;
      const value = values[row.key];
      if (row.kind === 'toggle' && typeof value === 'boolean') out[row.key] = value;
      if (row.kind === 'text' && typeof value === 'string') out[row.key] = value.slice(0, 200);
      if (row.kind === 'select' && typeof value === 'string' && row.options.includes(value)) out[row.key] = value;
    }
  }
  return out;
}

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
