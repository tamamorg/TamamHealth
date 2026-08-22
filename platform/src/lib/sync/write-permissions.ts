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
// The roles entitled to read across every facility in their org. Reused rather
// than restated so the read selector and the write validator cannot disagree
// about who works at more than one site.
import { MULTI_FACILITY_ROLES } from './facility-entitlements';
import { DATABASE_DOCUMENT_TYPES } from './sync-config';

/**
 * The canonical role groups.
 *
 * Exported — not module-private — because 51 of the 93 API routes were
 * declaring their own `const READ_ROLES: UserRole[] = [...]` beside these, and
 * 16 of those declarations were byte-identical to another file's. The routes
 * could not reuse the real ones because none of them left this module.
 *
 * That is the mechanism behind the workflow bugs found in Aug 2026: eight
 * flows where a role passed the API guard and was then refused by the CouchDB
 * validator, because the guard's hand-typed list and the matrix below had
 * drifted. Two copies of one rule always drift; the fix is for there to be one
 * copy. `src/__tests__/rbac/role-group-reuse.test.ts` fails when a route
 * retypes a list that already exists here.
 */
export const ADMIN: readonly UserRole[] = ['super_admin', 'org_admin'];
export const CLINICIANS: readonly UserRole[] = [
  'super_admin', 'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
];
export const NURSING_AND_CLINICIANS: readonly UserRole[] = [
  ...CLINICIANS, 'nurse', 'triage_nurse', 'rooming_nurse', 'midwife',
];
export const REGISTRATION: readonly UserRole[] = [
  ...ADMIN, 'front_desk', 'central_registration_clerk', 'clinic_clerk',
  'data_entry_clerk', 'records_hmis_officer', 'hrio', 'hospital_manager',
];
// `medical_superintendent` collects at the till in small facilities, which is
// what `canCollectPayments` in usePermissions.ts already grants them.
export const BILLING: readonly UserRole[] = [
  ...ADMIN, 'cashier', 'medical_biller', 'front_desk', 'hospital_manager',
  'medical_superintendent',
];
/**
 * Roles that work inside a facility and can therefore hold a conversation.
 *
 * `county_health_director` is included because `canSendMessages` grants it the
 * composer — they supervise facilities and message the staff in them. The other
 * national role, `government`, has no `/messages` route and is left out.
 */
export const ALL_STAFF: readonly UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse', 'midwife',
  'lab_tech', 'pharmacist', 'front_desk', 'cashier', 'data_entry_clerk',
  'medical_superintendent', 'hrio', 'nutritionist', 'radiologist',
  'hospital_manager', 'medical_biller', 'central_registration_clerk',
  'clinic_clerk', 'triage_nurse', 'rooming_nurse', 'clinician',
  'records_hmis_officer', 'county_health_director',
];

/**
 * Every role in the `UserRole` union, without exception.
 *
 * Used for the two document types every authenticated session writes whatever
 * its job is: `audit_log` (a sign-in, a PHI read) and `sync_event` (replication
 * bookkeeping). Leaving a role out does not stop it acting — it stops the
 * *record* of the action replicating, so the entry is written to the device and
 * silently never leaves it. `government` and `county_health_director` were both
 * absent, which meant the two roles with the broadest cross-facility read had
 * no server-side audit trail at all.
 *
 * A test asserts this covers `ROLE_ROUTE_TABLE` exactly, so a new role cannot
 * be added without landing here.
 */
export const EVERY_ROLE: readonly UserRole[] = [...ALL_STAFF, 'government'];

/**
 * Vital-events registers: births, deaths, immunisations, antenatal visits.
 *
 * Authored at the bedside by nursing and clinical staff, and maintained as
 * registers by the records roles — which is exactly the set
 * `canRecordVitalEvents` grants in usePermissions.ts. `hrio` and
 * `records_hmis_officer` were missing here while holding the `/births`,
 * `/deaths`, `/immunizations` and `/anc` routes, so register management was
 * offered to them and then refused at replication.
 */
export const VITAL_EVENTS: readonly UserRole[] = [
  ...NURSING_AND_CLINICIANS, 'data_entry_clerk', 'records_hmis_officer', 'hrio',
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
  // Mirrors `canRegisterPatients`. The four clinical-flow stations were absent
  // while the UI offered them the registration form: a triage nurse or a
  // registration clerk could complete it, see the patient appear locally, and
  // never have the record replicate — the worst failure shape available, since
  // nothing tells them it did not save.
  patient: [
    'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse',
    'midwife', 'front_desk', 'medical_superintendent', 'hrio', 'data_entry_clerk',
    'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse',
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
  // `radiologist` reports imaging studies as lab_result documents — the
  // radiology dashboard calls `updateLabResult` directly — and was missing, so
  // the station could not file a report. `clinical-flow/roles.ts` already maps
  // the lab_technician capability set onto ['lab_tech', 'radiologist'].
  lab_result: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'lab_tech',
    'medical_superintendent', 'radiologist',
  ],
  prescription: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'medical_superintendent',
  ],
  // `triage_nurse` — the role whose entire primary function is acuity
  // assessment — could not write a triage document. `midwife` is included for
  // the obstetric walk-in they triage themselves; both hold the `/triage`
  // route. `rooming_nurse` is deliberately absent: rooming captures vitals onto
  // the encounter, and never writes a triage record.
  triage: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'front_desk',
    'medical_superintendent', 'triage_nurse', 'midwife',
  ],
  // Reception takes phoned-in referrals — the `proxy_referral_capture`
  // capability in clinical-flow/roles.ts, and what `canManageReferrals` and the
  // front_desk `/referrals` route ("referral intake") both already offer.
  referral: [
    'super_admin', 'doctor', 'clinical_officer', 'clinician', 'nurse', 'midwife',
    'medical_superintendent', 'front_desk', 'central_registration_clerk',
  ],
  birth: VITAL_EVENTS,
  death: VITAL_EVENTS,
  anc_visit: VITAL_EVENTS,
  immunization: VITAL_EVENTS,
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
  // `hrio` holds `canAssessFacility` and the `/facility-assessments` route but
  // was missing from the row.
  facility_assessment: [
    ...ADMIN, 'government', 'county_health_director', 'data_entry_clerk',
    'medical_superintendent', 'hospital_manager', 'records_hmis_officer', 'hrio',
  ],
  facility_census: [
    ...ADMIN, 'government', 'county_health_director', 'data_entry_clerk',
    'medical_superintendent', 'hospital_manager', 'records_hmis_officer',
  ],
  hospital: [...ADMIN, 'government', 'county_health_director', 'hospital_manager'],
  organization: ADMIN,
  platform_config: ['super_admin'],
  // System administration: which apps/extensions/privileges are enabled, and
  // global property overrides. Absent from this matrix entirely, which meant
  // the CouchDB validator rejected it as an unknown type and the push filter
  // never even offered it — every change a facility admin made in Settings →
  // System administration was written to their device and silently stayed
  // there. Same roles as `organization`: this is tenant configuration.
  system_config: ADMIN,
  // Facility configuration — registration rules, clinical policy, reporting
  // obligations, integrations. Written to the hospitals database by
  // settings/settings-service.ts and, like system_config, listed nowhere: the
  // validator rejected it as an unknown type and the push filter never offered
  // it, so a facility admin's policy changes stayed on their own device. Same
  // roles as hold the /facility-settings route.
  facility_settings: [...ADMIN, 'medical_superintendent', 'hospital_manager'],
  // Every role, without exception — see EVERY_ROLE. A role missing here still
  // writes its audit entry locally; it just never replicates.
  audit_log: EVERY_ROLE,
  sync_event: EVERY_ROLE,
  conflict_queue: [...ADMIN, 'medical_superintendent', 'hospital_manager'],
};

/**
 * Roles that may MODIFY an existing document of a type, but never create one
 * and never delete one.
 *
 * ## Why the matrix needed a second dimension
 *
 * Two of the busiest workflows in a hospital both write the `prescription`
 * document without authoring the order:
 *
 *   - The pharmacist advances it through the dispensing lifecycle.
 *     `advancePrescription` refuses to clear an order for dispensing unless the
 *     actor is a pharmacist — and `pharmacist` was absent from the row, so the
 *     service demanded a pharmacist for a write CouchDB then rejected. The
 *     pharmacy could not dispense.
 *   - Nursing staff append a `MedicationAdministration` entry from the ward MAR
 *     (`recordAdministration`). `/wards/mar` is on the nursing route list; none
 *     of the nursing roles were in the row, so a recorded dose never left the
 *     device.
 *
 * Adding those roles to `DOC_WRITE_ROLES` would have fixed both and quietly
 * created a worse problem: `createPrescription` carries no prescriber check of
 * its own (only the `/api/prescriptions` route does, and UI writes never reach
 * it), so the row is the *only* thing standing between a nurse and authoring a
 * medication order.
 *
 * CouchDB hands the validator `oldDoc`, so it can tell a create from an
 * amendment — which is the distinction these workflows actually need. Roles
 * listed here may write the document only when one already exists.
 *
 * Deletes are excluded deliberately: appending a dose must not become a way to
 * remove the order it was given against.
 */
export const DOC_UPDATE_ONLY_ROLES: Readonly<Record<string, readonly UserRole[]>> = {
  prescription: [
    // Dispensing lifecycle: verify → clear → dispense.
    'pharmacist',
    // Ward MAR: append an administration entry against an existing order.
    'nurse', 'midwife', 'triage_nurse', 'rooming_nurse',
  ],
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
 * Fields naming the facility that OWNS a document.
 *
 * Deliberately just these two. `facility-entitlements.ts` lists seven fields for
 * the *read* selector, because a document is worth showing to a facility if it
 * touches it in any way. Ownership is a narrower question, and the other five
 * name someone else:
 *
 *   - `registrationHospital` / `lastVisitHospital` — where the patient has been,
 *     not who may write. A patient registered at Wau and seen in Juba is the
 *     normal case, and enforcing these would block cross-facility care outright.
 *   - `fromHospitalId` / `toHospitalId` / `recipientHospitalId` — the
 *     counterparty in a referral or a message, which is by definition elsewhere.
 *
 * This happens to be safe by construction for the two riskiest types: neither
 * `PatientDoc` nor `ReferralDoc` carries `hospitalId` at all, so neither is
 * touched by the rule.
 */
export const FACILITY_OWNER_FIELDS = ['hospitalId', 'facilityId'] as const;

/**
 * Document types that belong to the organisation rather than to one facility.
 *
 * Reference data, configuration and org-wide clinical surfaces. A clinician
 * authoring an order-set or a surveillance alert is writing for the whole
 * tenant, so a facility claim must not narrow it.
 */
export const FACILITY_EXEMPT_TYPES: readonly string[] = [
  'organization', 'hospital', 'platform_config', 'fee_schedule',
  'order_set', 'announcement', 'disease_alert', 'visit_reason',
  'booking_policy', 'provider_profile', 'provider_review',
  // Personal, follows the user between facilities.
  'clinical_favorite', 'consultation_template', 'text_shortcut', 'clinician_task',
];

/**
 * Document types that may only ever be created — never modified, never deleted.
 *
 * These are the trails that exist to be evidence. Their value comes entirely
 * from being unalterable by the people they record, and until this list existed
 * nothing enforced that: `audit_log` is writable by every staff role (it has to
 * be — entries are written client-side), `IMMUTABLE_FIELDS` guards only tenancy
 * fields, and a tombstone skipped the validator altogether. So a user could
 * rewrite or erase the entries recording their own actions, and the same
 * tombstone erased the row from the national Postgres projection on its way
 * through `/api/sync`.
 *
 *   - `audit_log`                — who read and changed which record.
 *   - `controlled_substance_log` — narcotics chain of custody; a regulator will
 *                                  ask for this one specifically.
 *   - `ledger_entry`             — the patient financial chain. Its conflict
 *                                  policy in `db/postgres.ts` already *assumes*
 *                                  entries are "never updated or deleted, only
 *                                  appended"; this is what makes that true.
 *
 * A correction is a new reversing entry, which is how all three services
 * already write — every one of them does a single `put` of a freshly minted
 * document and never reads a `_rev` back to amend one.
 *
 * `sync_event` is deliberately NOT here despite also being push-only:
 * `sync-event-service.ts` legitimately updates an event in place when it
 * reaches `synced`, so an append-only rule would break replication bookkeeping.
 *
 * Kept in sync with `ConflictPolicy.APPEND_ONLY` in `db/postgres.ts` by
 * `src/__tests__/sync/append-only-parity.test.ts`.
 */
export const APPEND_ONLY_TYPES: readonly string[] = [
  'audit_log',
  'controlled_substance_log',
  'ledger_entry',
];

/**
 * Whether a browser database holds nothing but append-only documents.
 *
 * Derived, so adding a type to `APPEND_ONLY_TYPES` covers its database
 * automatically. Two callers need the database-level answer because they see a
 * request or a tombstone rather than a document, and neither carries a `type`:
 * the sync gateway (refuses to forward a deletion) and the push filter (never
 * offers one, which would wedge the checkpoint against a validator that now
 * rejects it).
 */
export function isAppendOnlyDatabase(localName: string): boolean {
  const types = DATABASE_DOCUMENT_TYPES[localName];
  return !!types && types.length > 0 && types.every(type => APPEND_ONLY_TYPES.includes(type));
}

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
 *
 * ## Deletes are writes
 *
 * This function used to open with `if (newDoc._deleted) return;` — before the
 * tenant check, before the immutability rule, before the role matrix. A
 * deletion was therefore subject to no authorisation at all beyond CouchDB
 * database membership: any authenticated user already holds the `_id` and
 * `_rev` of every document they replicated, so a `_bulk_docs` POST of
 * tombstones from their own replica could erase signed medical records,
 * prescriptions, or the narcotics register. A cashier could delete what a
 * cashier could never have written.
 *
 * A tombstone carries no body — CouchDB strips it — which is presumably why
 * the early return was there: there is no `type` and no `orgId` to check. The
 * answer is that both are on `oldDoc`, which CouchDB passes as the revision
 * being replaced. So a delete is judged on the document it is destroying,
 * against the same role row that governs writing that type.
 */
export function buildValidateDocUpdateFn(
  matrix: Readonly<Record<string, readonly string[]>> = DOC_WRITE_ROLES,
  updateOnly: Readonly<Record<string, readonly string[]>> = DOC_UPDATE_ONLY_ROLES,
): string {
  const matrixJson = JSON.stringify(matrix);
  const immutableJson = JSON.stringify(IMMUTABLE_FIELDS);
  const appendOnlyJson = JSON.stringify(APPEND_ONLY_TYPES);
  const updateOnlyJson = JSON.stringify(updateOnly);
  const facilityFieldsJson = JSON.stringify(FACILITY_OWNER_FIELDS);
  const facilityExemptJson = JSON.stringify(FACILITY_EXEMPT_TYPES);
  const multiFacilityJson = JSON.stringify(MULTI_FACILITY_ROLES);

  return `function (newDoc, oldDoc, userCtx, secObj) {
  // Design docs are admin-only; the CouchDB security object handles that.
  if (newDoc._id && newDoc._id.indexOf('_design/') === 0) return;

  var roles = (userCtx && userCtx.roles) || [];

  function hasRole(r) {
    for (var i = 0; i < roles.length; i++) { if (roles[i] === r) return true; }
    return false;
  }

  function contains(list, value) {
    for (var i = 0; i < list.length; i++) { if (list[i] === value) return true; }
    return false;
  }

  // Server-side service writes (sync-worker, migrations, _replicator jobs) run
  // as _admin.
  if (hasRole('_admin')) return;

  var isDelete = newDoc._deleted === true;

  // Deleting what this database does not hold destroys nothing — it writes a
  // deleted stub. Replication depends on that being accepted: a tombstone
  // routinely arrives for a document the target never received.
  if (isDelete && (!oldDoc || oldDoc._deleted)) return;

  // A delete is judged ENTIRELY on the revision it destroys, never on the
  // incoming body. A tombstone normally has no body at all, but a client is
  // free to send one — and a body claiming a broadly-writable type would
  // otherwise pick the permission row the delete is checked against, which is
  // the same escalation the immutable-type rule blocks for updates.
  var docType = isDelete ? oldDoc.type : newDoc.type;
  var docOrgId = isDelete ? oldDoc.orgId : newDoc.orgId;

  // ── Tenant boundary ────────────────────────────────────────────────────
  if (!docOrgId || typeof docOrgId !== 'string') {
    throw({ forbidden: 'orgId is required on this database' });
  }

  for (var i = 0; i < roles.length; i++) {
    if (roles[i].indexOf('org:') === 0) {
      var allowedOrg = roles[i].substring(4);
      if (docOrgId !== allowedOrg) {
        throw({ forbidden: 'orgId mismatch: doc=' + docOrgId + ' user=' + allowedOrg });
      }
    }
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
    throw({ forbidden: 'no role claim on the CouchDB user; cannot write ' + docType });
  }

  // ── Facility boundary ──────────────────────────────────────────────────
  // The org check above stops a write crossing tenants. Nothing stopped it
  // crossing FACILITIES inside one tenant: a nurse at Wau could stamp a record
  // hospitalId=Juba and it replicated cleanly, after which every read filter
  // treated it as Juba's. The facility: claim needed to catch that has been
  // provisioned onto every CouchDB user all along and was never read.
  var FACILITY_FIELDS = ${facilityFieldsJson};
  var FACILITY_EXEMPT = ${facilityExemptJson};
  var MULTI_FACILITY = ${multiFacilityJson};

  if (!contains(FACILITY_EXEMPT, docType) && !contains(MULTI_FACILITY, actingRole)) {
    var facilitySource = isDelete ? oldDoc : newDoc;
    var docFacility = null;
    for (var p = 0; p < FACILITY_FIELDS.length; p++) {
      var candidate = facilitySource[FACILITY_FIELDS[p]];
      if (typeof candidate === 'string' && candidate) { docFacility = candidate; break; }
    }

    if (docFacility) {
      // A user may hold several facility: claims (a clinician covering two
      // sites). Any one of them matching is enough. No claim at all means the
      // account is not facility-scoped, and the rule does not apply.
      var claimed = 0;
      var matched = false;
      for (var q = 0; q < roles.length; q++) {
        if (roles[q].indexOf('facility:') === 0) {
          claimed++;
          if (roles[q].substring(9) === docFacility) { matched = true; break; }
        }
      }
      if (claimed > 0 && !matched) {
        throw({ forbidden: 'facility mismatch: doc=' + docFacility + ' is not a facility this user works at' });
      }
    }
  }

  // ── Immutable fields ───────────────────────────────────────────────────
  // Rewriting orgId/hospitalId would move a record into another tenant's data;
  // rewriting type would move it between permission rows. Skipped for deletes,
  // which carry no body to compare.
  if (oldDoc && !isDelete) {
    var immutable = ${immutableJson};
    for (var j = 0; j < immutable.length; j++) {
      var f = immutable[j];
      if (oldDoc[f] !== undefined && newDoc[f] !== oldDoc[f]) {
        throw({ forbidden: f + ' is immutable (was ' + oldDoc[f] + ', got ' + newDoc[f] + ')' });
      }
    }
  }

  // ── Lifecycle: append-only trails ──────────────────────────────────────
  // Evidence is only evidence if the people it records cannot amend it. These
  // types may be created and never touched again; a correction is a new
  // reversing entry.
  var APPEND_ONLY = ${appendOnlyJson};
  if (oldDoc && contains(APPEND_ONLY, docType)) {
    throw({ forbidden: docType + ' is append-only; an existing entry cannot be ' + (isDelete ? 'deleted' : 'modified') });
  }

  // ── Role-based write permission, by document type ──────────────────────
  var WRITE_ROLES = ${matrixJson};
  var allowed = WRITE_ROLES[docType];

  // Unknown types fail closed. New persisted types require an explicit row.
  if (!allowed) {
    throw({ forbidden: 'unknown document type: ' + docType });
  }

  for (var m = 0; m < allowed.length; m++) {
    if (allowed[m] === actingRole) return;
  }

  // Amend-only roles: permitted to change a document that already exists, but
  // not to create one and not to delete one. This is how the pharmacy advances
  // a prescription and the ward MAR appends a dose without either of them
  // gaining the authority to write a medication order.
  if (oldDoc && !isDelete) {
    var UPDATE_ONLY_ROLES = ${updateOnlyJson};
    var amenders = UPDATE_ONLY_ROLES[docType];
    if (amenders) {
      for (var n = 0; n < amenders.length; n++) {
        if (amenders[n] === actingRole) return;
      }
    }
  }

  throw({ forbidden: 'role ' + actingRole + ' may not ' + (isDelete ? 'delete' : 'write') + ' documents of type ' + docType });
}`;
}

/** The validator source installed on org-scoped databases. */
export const ORG_SCOPED_VALIDATE_FN = buildValidateDocUpdateFn();
