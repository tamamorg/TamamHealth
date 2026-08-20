/**
 * Write-permission matrix — the single source of truth for BOTH the API route
 * guards and the CouchDB `validate_doc_update` function (KAN-94).
 *
 * ## Why this exists
 *
 * RBAC was enforced only in the Next.js API routes. But the platform is
 * offline-first: every client holds a local PouchDB replica and replicates
 * straight to CouchDB. A client that writes locally and lets replication carry
 * the change upstream **never passes through an API route guard at all**.
 *
 * So any authenticated user could create or modify documents their role has no
 * business touching — a cashier could write a medical record, a front-desk
 * clerk could write a prescription — simply by writing to their own replica.
 * Every other permission control in the system was only as strong as this.
 *
 * ## How drift is prevented
 *
 * The matrix below is exported for the API routes to consume AND compiled into
 * the CouchDB validator by `buildValidateDocUpdateFn()`. Both layers therefore
 * read the same table, and a test asserts the route guards agree with it.
 * Previously the CouchDB validator knew nothing about roles at all, so there
 * was nothing to drift — and nothing enforcing anything either.
 *
 * ## Role naming
 *
 * CouchDB users carry roles like `role:doctor` and `org:org-moh-ss` (see
 * `scripts/setup-couchdb.sh`). The validator reads the acting role from
 * `userCtx.roles` — **never** from the document body, which the client controls.
 */

import type { UserRole } from '../db-types';
// Type-only at its own boundary (it imports `AuthPayload` as a type), so this
// pulls no runtime auth code into the validator-generation path.
import { TRANSFER_WRITE_ROLES } from '../services/patient-transfer-permissions';

const ADMIN: readonly UserRole[] = ['super_admin', 'org_admin'];
const CLINICIANS: readonly UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
];
const NURSING_AND_CLINICIANS: readonly UserRole[] = [
  ...CLINICIANS, 'nurse', 'triage_nurse', 'rooming_nurse', 'midwife',
];
const REGISTRATION: readonly UserRole[] = [
  ...ADMIN, 'front_desk', 'central_registration_clerk', 'clinic_clerk',
  'data_entry_clerk', 'records_hmis_officer', 'hrio', 'hospital_manager',
];
const BILLING: readonly UserRole[] = [
  ...ADMIN, 'cashier', 'medical_biller', 'front_desk', 'hospital_manager',
];
const ALL_STAFF: readonly UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife',
  'lab_tech', 'pharmacist', 'front_desk', 'cashier', 'data_entry_clerk',
  'medical_superintendent', 'hrio', 'nutritionist', 'radiologist',
  'hospital_manager', 'medical_biller', 'central_registration_clerk',
  'clinic_clerk', 'triage_nurse', 'rooming_nurse', 'clinician',
  'records_hmis_officer',
];

/**
 * Document `type` → roles permitted to create or modify it.
 *
 * Derived from the API route CREATE/WRITE guards. Where a route grants a role
 * write access, that role appears here.
 *
 * `super_admin` is present on every row rather than special-cased, so the table
 * reads as the complete answer for a given type instead of requiring the reader
 * to remember an implicit bypass.
 */
export const DOC_WRITE_ROLES: Readonly<Record<string, readonly UserRole[]>> = {
  patient: [
    'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
    'midwife', 'front_desk', 'medical_superintendent', 'hrio', 'data_entry_clerk',
  ],
  medical_record: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
  ],
  // Clinical-notes module. Signing semantics deliberately mirror medical_record
  // (see note-service.ts's docstring), so the write roles match it exactly —
  // this is also the exact role set the chart UI gates note creation behind
  // (`canConsult` in usePermissions.ts).
  clinical_note: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
  ],
  lab_result: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'lab_tech',
    'medical_superintendent',
  ],
  prescription: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
  ],
  triage: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'front_desk',
    'medical_superintendent',
  ],
  referral: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'medical_superintendent',
  ],
  birth: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'medical_superintendent', 'data_entry_clerk',
  ],
  death: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'medical_superintendent', 'data_entry_clerk',
  ],
  anc_visit: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'medical_superintendent', 'data_entry_clerk',
  ],
  immunization: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'medical_superintendent', 'data_entry_clerk',
  ],
  // Internal transfers of care ownership. Listed here because the document is
  // what actually moves accountability for a patient: left off the matrix it
  // would fail open (see buildValidateDocUpdateFn), letting a cashier write a
  // transfer straight into their replica and have replication carry it up.
  //
  // The rows are the union of the request/accept/cancel capabilities in
  // patient-transfer-permissions.ts — CouchDB can only gate by role and doc
  // type, so the finer rules (you may not accept a transfer you raised; only
  // the current care team may raise one) stay in the service and the API. This
  // is the coarse floor, not the whole policy.
  // Derived, not transcribed: `TRANSFER_WRITE_ROLES` is computed from the same
  // capability table the API route and the UI read, so this row cannot drift
  // from the route guard the way a hand-copied list can.
  patient_transfer: TRANSFER_WRITE_ROLES,
  appointment: [...REGISTRATION, ...NURSING_AND_CLINICIANS],
  availability: [...ADMIN, ...CLINICIANS],
  assessment: NURSING_AND_CLINICIANS,
  clinical_encounter: NURSING_AND_CLINICIANS,
  encounter: NURSING_AND_CLINICIANS,
  consultation_progress: NURSING_AND_CLINICIANS,
  shift_handoff: NURSING_AND_CLINICIANS,
  follow_up: NURSING_AND_CLINICIANS,
  problem: CLINICIANS,
  procedure: CLINICIANS,
  program_enrollment: NURSING_AND_CLINICIANS,
  order_set: CLINICIANS,
  phone_note: NURSING_AND_CLINICIANS,
  patient_note: [...REGISTRATION, ...NURSING_AND_CLINICIANS],
  patient_document: [...REGISTRATION, ...NURSING_AND_CLINICIANS],
  patient_reminder: [...REGISTRATION, ...NURSING_AND_CLINICIANS],
  clinical_favorite: CLINICIANS,
  consultation_template: CLINICIANS,
  text_shortcut: CLINICIANS,
  clinician_task: NURSING_AND_CLINICIANS,
  nutrition_screening: [...NURSING_AND_CLINICIANS, 'nutritionist'],
  nutrition_supply: [...ADMIN, 'nutritionist', 'nurse', 'midwife', 'pharmacist'],
  pharmacy_inventory: [...ADMIN, 'pharmacist', 'hospital_manager'],
  controlled_substance_log: [...CLINICIANS, 'pharmacist', 'nurse'],
  ward: [...ADMIN, ...NURSING_AND_CLINICIANS, 'hospital_manager'],
  bed: [...ADMIN, ...NURSING_AND_CLINICIANS, 'hospital_manager'],
  admission: [...REGISTRATION, ...NURSING_AND_CLINICIANS],
  blood_bank: [...ADMIN, ...NURSING_AND_CLINICIANS, 'lab_tech'],
  biometric_template: [...REGISTRATION, ...NURSING_AND_CLINICIANS],
  emergency_plan: [...ADMIN, 'medical_superintendent', 'hospital_manager'],
  asset: [...ADMIN, 'hrio', 'hospital_manager', 'medical_superintendent'],
  staff_schedule: [...ADMIN, 'hrio', 'hospital_manager', 'medical_superintendent'],
  leave_request: [...ADMIN, 'hrio', 'hospital_manager'],
  payroll_entry: [...ADMIN, 'hrio'],
  patient_feedback: [...ADMIN, 'front_desk', 'hospital_manager'],
  billing: BILLING,
  fee_schedule: [...ADMIN, 'medical_biller', 'hospital_manager'],
  insurance_policy: BILLING,
  eligibility_check: BILLING,
  charge: [...BILLING, ...CLINICIANS],
  claim: BILLING,
  adjustment: BILLING,
  payment: BILLING,
  refund: BILLING,
  saved_payment_method: BILLING,
  payment_plan: BILLING,
  invoice: BILLING,
  ledger_entry: BILLING,
  visit_reason: [...ADMIN, 'front_desk', 'clinic_clerk', 'hospital_manager'],
  booking_policy: [...ADMIN, 'hospital_manager'],
  provider_profile: [...ADMIN, ...CLINICIANS],
  provider_review: ADMIN,
  message: ALL_STAFF,
  conversation: ALL_STAFF,
  announcement: [...ADMIN, 'medical_superintendent', 'hospital_manager'],
  disease_alert: [
    ...NURSING_AND_CLINICIANS, 'lab_tech', 'government', 'county_health_director',
    'data_entry_clerk', 'records_hmis_officer',
  ],
  facility_assessment: [
    ...ADMIN, 'government', 'county_health_director', 'data_entry_clerk',
    'medical_superintendent', 'hospital_manager', 'records_hmis_officer',
  ],
  facility_census: [
    ...ADMIN, 'government', 'county_health_director', 'data_entry_clerk',
    'medical_superintendent', 'hospital_manager', 'records_hmis_officer',
  ],
  hospital: [...ADMIN, 'government', 'county_health_director', 'hospital_manager'],
  organization: ADMIN,
  platform_config: ['super_admin'],
  audit_log: ALL_STAFF,
  sync_event: ALL_STAFF,
  conflict_queue: [...ADMIN, 'medical_superintendent', 'hospital_manager'],
};

/**
 * Fields that must never change after a document is created.
 *
 * `orgId` and `hospitalId` are the tenant boundary — a client able to rewrite
 * them could move a record into another organisation's dataset, which defeats
 * every scope filter above it. `type` is included because changing it would
 * move a document between permission rows: write a `patient` (broadly
 * permitted) and then flip it to `medical_record` (narrowly permitted).
 */
export const IMMUTABLE_FIELDS = ['orgId', 'hospitalId', 'type'] as const;

/**
 * Build the `validate_doc_update` source that CouchDB stores in a design doc
 * and evaluates on every write.
 *
 * Generated from the matrix above so the two layers cannot drift.
 *
 * Constraints this code lives under, which explain its style:
 *   - It runs inside CouchDB's JS engine (SpiderMonkey), not Node. No `const`,
 *     no arrow functions, no `Array.prototype.includes`.
 *   - **A syntax error here blocks every write to the database.** That is why
 *     it is generated from a tested table rather than hand-edited per type.
 *   - Unknown document types are rejected. Every browser-synced database and
 *     type is pinned by `DATABASE_DOCUMENT_TYPES` and a regression test checks
 *     that every permitted type has a role row here. Adding a new type now
 *     requires an explicit permission decision instead of silently failing
 *     open.
 */
export function buildValidateDocUpdateFn(
  matrix: Readonly<Record<string, readonly string[]>> = DOC_WRITE_ROLES,
): string {
  const matrixJson = JSON.stringify(matrix);
  const immutableJson = JSON.stringify(IMMUTABLE_FIELDS);

  return `function (newDoc, oldDoc, userCtx, secObj) {
  // Replication brings in _deleted tombstones; allow them so deletes propagate.
  if (newDoc._deleted) return;

  // Design docs are admin-only; the CouchDB security object handles that.
  if (newDoc._id && newDoc._id.indexOf('_design/') === 0) return;

  var roles = (userCtx && userCtx.roles) || [];

  function hasRole(r) {
    for (var i = 0; i < roles.length; i++) { if (roles[i] === r) return true; }
    return false;
  }

  // Server-side service writes (sync-worker, migrations) run as _admin.
  if (hasRole('_admin')) return;

  // ── Tenant boundary ────────────────────────────────────────────────────
  if (!newDoc.orgId || typeof newDoc.orgId !== 'string') {
    throw({ forbidden: 'orgId is required on this database' });
  }

  for (var i = 0; i < roles.length; i++) {
    if (roles[i].indexOf('org:') === 0) {
      var allowedOrg = roles[i].substring(4);
      if (newDoc.orgId !== allowedOrg) {
        throw({ forbidden: 'orgId mismatch: doc=' + newDoc.orgId + ' user=' + allowedOrg });
      }
    }
  }

  // ── Immutable fields ───────────────────────────────────────────────────
  // Rewriting orgId/hospitalId would move a record into another tenant's data;
  // rewriting type would move it between permission rows.
  if (oldDoc) {
    var immutable = ${immutableJson};
    for (var j = 0; j < immutable.length; j++) {
      var f = immutable[j];
      if (oldDoc[f] !== undefined && newDoc[f] !== oldDoc[f]) {
        throw({ forbidden: f + ' is immutable (was ' + oldDoc[f] + ', got ' + newDoc[f] + ')' });
      }
    }
  }

  // ── Role-based write permission, by document type ──────────────────────
  var WRITE_ROLES = ${matrixJson};
  var allowed = WRITE_ROLES[newDoc.type];

  // Unknown types fail closed. New persisted types require an explicit row.
  if (!allowed) {
    throw({ forbidden: 'unknown document type: ' + newDoc.type });
  }

  // The acting role comes from the authenticated CouchDB user context, never
  // from the document body — the client controls the body.
  var actingRole = null;
  for (var k = 0; k < roles.length; k++) {
    if (roles[k].indexOf('role:') === 0) { actingRole = roles[k].substring(5); break; }
  }

  // No role claim at all: reject rather than assume. A user whose CouchDB
  // account predates role provisioning must be re-provisioned, not trusted.
  if (!actingRole) {
    throw({ forbidden: 'no role claim on the CouchDB user; cannot write ' + newDoc.type });
  }

  for (var m = 0; m < allowed.length; m++) {
    if (allowed[m] === actingRole) return;
  }

  throw({ forbidden: 'role ' + actingRole + ' may not write documents of type ' + newDoc.type });
}`;
}

/** The validator source installed on org-scoped databases. */
export const ORG_SCOPED_VALIDATE_FN = buildValidateDocUpdateFn();
