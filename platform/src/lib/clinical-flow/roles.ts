/**
 * Staff roles & the capability model.
 *
 * Faithful encoding of Section 4 (Staff Roles) and Principle 2.3 (Configurable
 * to facility staffing reality) of the architecture document.
 *
 * Core idea (Principle 2.3): CAPABILITIES (functions like triage, dispensing,
 * rooming) are DECOUPLED from POSITIONS (the physical staff member doing them).
 * A small facility may collapse several roles into one person; a large facility
 * splits them. The system supports both via configuration, not parallel
 * codebases. Roles are bundles of capabilities; permission checks are made
 * against capabilities, not hard-coded job titles.
 *
 * This module defines the documented 11 roles and the capabilities each holds,
 * and maps them onto the platform's existing `UserRole` union so the rest of
 * the app can be migrated incrementally without a breaking rename.
 */

import type { UserRole } from '../db-types';

/**
 * Capabilities — the atomic, permission-checkable functions named across the
 * document's stages and Principle 2.3. UI features are shown/hidden based on
 * the active role's capabilities (hidden, not greyed out — Section 4 behavior).
 */
export type Capability =
  // Registration & front desk (Stage 2, 10)
  | 'patient_registration' // initial registration, demographics, payor capture
  | 'patient_routing' // route to triage / clinic / emergency / pharmacy-only / results
  | 'facility_checkout' // final facility checkout gate
  // Clinic reception (Stage 4, 9)
  | 'clinic_checkin' // clinic-specific check-in
  | 'clinic_queue_management' // manage clinic queue, call patients in
  | 'clinic_followup_scheduling' // book follow-ups at clinic checkout
  // Triage (Stage 3)
  | 'triage' // acuity assessment + routing for walk-ins
  // Rooming / vitals (Stage 4, Principle 2.10)
  | 'rooming' // call & room patients, clinic-specific history
  | 'vitals_capture' // capture vitals (any permitted role)
  // Clinician (Stage 5)
  | 'consultation' // evaluate, document, clinical reasoning, SOAP note, sign
  | 'ordering' // place lab/imaging/procedure/referral/admission orders
  | 'prescribing' // medication orders from formulary
  | 'result_review' // review returned diagnostics (every result must be reviewed)
  // Diagnostics (Stage 6)
  | 'lab_processing' // receive specimen, perform test, enter result
  | 'result_verification' // senior verification step where required
  // Pharmacy (Stage 8)
  | 'dispensing' // review, counsel, dispense, label
  | 'stock_management' // inventory, reorder, lot/batch, cold chain
  // Cashier (Stage 10)
  | 'payment_collection' // collect payment, apply exemptions, issue receipts
  | 'exemption_authorization' // authorize exemptions (typically facility admin)
  // Records / HMIS (Section 4 #9, Workflow 6)
  | 'records_hmis' // aggregate reports, data-quality audit, register management
  // Facility administrator (Section 4 #10)
  | 'user_management'
  | 'facility_configuration'
  | 'oversight'
  | 'proxy_referral_capture'; // front-desk capture of phoned-in referral (10.6.1)

/** The roles the system supports (Section 4). */
export type ClinicalFlowRole =
  | 'central_registration_clerk' // 1
  | 'clinic_clerk' // 2 — clinic reception
  | 'triage_nurse' // 3
  | 'rooming_nurse' // 4 — nurse / clinical officer assistant
  | 'clinician' // 5 — medical officer, clinical officer, specialist
  | 'lab_technician' // 6
  | 'pharmacist' // 7 — pharmacist / pharmacy technician
  | 'cashier' // 8
  | 'records_hmis_officer'; // 9

export interface RoleDefinition {
  role: ClinicalFlowRole;
  number: number;
  label: string;
  /** Primary function, quoted from the Section 4 table. */
  primaryFunction: string;
  capabilities: Capability[];
  /** What clinical content this role may see (Section 4 clerk table, Stage interfaces). */
  clinicalVisibility: 'none' | 'identity_billing_only' | 'light_clinical' | 'full_chart';
  /** Existing platform UserRole(s) this maps onto during migration. */
  mapsToUserRoles: UserRole[];
}

export const CLINICAL_FLOW_ROLES: Readonly<Record<ClinicalFlowRole, RoleDefinition>> = {
  central_registration_clerk: {
    role: 'central_registration_clerk', number: 1, label: 'Central registration clerk',
    primaryFunction: 'Initial patient registration, demographics, routing, final facility checkout',
    capabilities: ['patient_registration', 'patient_routing', 'facility_checkout', 'proxy_referral_capture'],
    clinicalVisibility: 'identity_billing_only',
    mapsToUserRoles: ['central_registration_clerk', 'front_desk'],
  },
  clinic_clerk: {
    role: 'clinic_clerk', number: 2, label: 'Clinic reception / clinic clerk',
    primaryFunction: 'Clinic-specific check-in, queue management, follow-up scheduling within the clinic',
    capabilities: ['clinic_checkin', 'clinic_queue_management', 'clinic_followup_scheduling'],
    clinicalVisibility: 'light_clinical',
    mapsToUserRoles: ['clinic_clerk', 'front_desk'],
  },
  triage_nurse: {
    role: 'triage_nurse', number: 3, label: 'Triage nurse',
    primaryFunction: 'Acuity assessment and routing for walk-ins and undifferentiated patients',
    capabilities: ['triage', 'vitals_capture', 'patient_routing'],
    clinicalVisibility: 'full_chart',
    // Platform role `triage_nurse` was missing from its own clinical-flow
    // role's mapping — an account provisioned with that exact UserRole held
    // ZERO clinical-flow capabilities. `midwife` performs the same acuity
    // assessment for maternity presentations (role-routes.ts grants `/triage`);
    // `super_admin` needs a real capability set here too, since `/dashboard`
    // — the shared clinical workspace nurse-family roles land on — renders
    // triage actions gated on this map, and a platform admin exercising that
    // workspace directly (not via role impersonation) otherwise sees none of
    // them hidden-not-greyed per Section 4's own behavior rule.
    mapsToUserRoles: ['nurse', 'clinical_officer', 'triage_nurse', 'midwife', 'super_admin'],
  },
  rooming_nurse: {
    role: 'rooming_nurse', number: 4, label: 'Nurse / clinical officer assistant (rooming)',
    primaryFunction: 'Calls and rooms patients, takes vitals, captures clinic-specific history',
    capabilities: ['rooming', 'vitals_capture'],
    clinicalVisibility: 'full_chart',
    // Same gap as triage_nurse above: the platform role `rooming_nurse` held
    // none of its own capabilities, and super_admin needs the rooming set for
    // the same shared-workspace reason.
    mapsToUserRoles: ['nurse', 'rooming_nurse', 'super_admin'],
  },
  clinician: {
    role: 'clinician', number: 5, label: 'Doctor',
    primaryFunction: 'Consultation, documentation, orders, prescriptions, referrals (medical officer, clinical officer, specialist)',
    capabilities: ['consultation', 'ordering', 'prescribing', 'result_review', 'vitals_capture'],
    clinicalVisibility: 'full_chart',
    mapsToUserRoles: ['clinician', 'doctor', 'clinical_officer', 'medical_superintendent'],
  },
  lab_technician: {
    role: 'lab_technician', number: 6, label: 'Lab technician',
    primaryFunction: 'Receives orders, collects specimens, performs tests, enters results',
    capabilities: ['lab_processing', 'result_verification'],
    clinicalVisibility: 'light_clinical',
    mapsToUserRoles: ['lab_tech', 'radiologist'],
  },
  pharmacist: {
    role: 'pharmacist', number: 7, label: 'Pharmacist / pharmacy technician',
    primaryFunction: 'Reviews and dispenses prescriptions, counsels patients, manages stock',
    capabilities: ['dispensing', 'stock_management'],
    clinicalVisibility: 'light_clinical',
    mapsToUserRoles: ['pharmacist'],
  },
  cashier: {
    role: 'cashier', number: 8, label: 'Cashier',
    primaryFunction: 'Collects payment, applies exemptions, issues receipts',
    capabilities: ['payment_collection'],
    clinicalVisibility: 'identity_billing_only',
    mapsToUserRoles: ['cashier', 'medical_biller'],
  },
  records_hmis_officer: {
    role: 'records_hmis_officer', number: 9, label: 'Records / HMIS officer',
    primaryFunction: 'Generates aggregate reports, audits data quality, manages registers',
    capabilities: ['records_hmis', 'result_review'],
    clinicalVisibility: 'light_clinical',
    mapsToUserRoles: ['records_hmis_officer', 'hrio', 'data_entry_clerk'],
  },
};

/** Role behavior rules (Section 4 — "Role behavior"). */
export const ROLE_BEHAVIOR = {
  multiRoleAssignment: true, // a user can hold multiple roles
  singleActiveRolePerSession: true, // acts in one role at a time; active role logged with every action
  roleSwitchMidSession: true, // ends one session, starts another; actions attributed correctly
  permissionsHiddenNotGreyed: true, // unavailable actions are hidden, not greyed out
  configurablePerFacility: true, // which roles exist, their permissions, and which combine into one dashboard
} as const;

/**
 * Central registration clerk vs. clinic clerk distinction (Section 4 table).
 * `true` = that clerk performs the function. Both roles can be combined into a
 * single dashboard for small facilities.
 */
export const CLERK_FUNCTION_MATRIX: { function: string; centralRegistrationClerk: boolean; clinicClerk: boolean }[] = [
  { function: 'Initial patient registration', centralRegistrationClerk: true, clinicClerk: false },
  { function: 'Demographics and payor capture', centralRegistrationClerk: true, clinicClerk: false },
  { function: 'Routing to clinic/triage/emergency', centralRegistrationClerk: true, clinicClerk: false },
  { function: 'Clinic-specific check-in', centralRegistrationClerk: false, clinicClerk: true },
  { function: 'Clinic queue management', centralRegistrationClerk: false, clinicClerk: true },
  { function: 'Calling patients into the clinic', centralRegistrationClerk: false, clinicClerk: true },
  { function: 'Clinic-specific follow-up scheduling', centralRegistrationClerk: false, clinicClerk: true },
  { function: 'Final facility checkout & payment routing', centralRegistrationClerk: true, clinicClerk: false },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/** All capabilities granted by a set of active clinical-flow roles. */
export function capabilitiesForRoles(roles: ClinicalFlowRole[]): Set<Capability> {
  const out = new Set<Capability>();
  for (const r of roles) for (const c of CLINICAL_FLOW_ROLES[r].capabilities) out.add(c);
  return out;
}

export function hasCapability(roles: ClinicalFlowRole[], cap: Capability): boolean {
  return roles.some((r) => CLINICAL_FLOW_ROLES[r].capabilities.includes(cap));
}

/** Map an existing platform UserRole to the clinical-flow roles it can act as. */
export function clinicalFlowRolesForUserRole(userRole: UserRole): ClinicalFlowRole[] {
  return (Object.values(CLINICAL_FLOW_ROLES) as RoleDefinition[])
    .filter((def) => def.mapsToUserRoles.includes(userRole))
    .map((def) => def.role);
}
