#!/usr/bin/env node
/**
 * Install the org-scoping validate_doc_update design doc on every CouchDB
 * database flagged orgScoped: true in lib/sync/sync-config.ts.
 *
 * Run as part of deployment (after the databases themselves exist).
 * Idempotent: re-running updates the existing _design/tamamhealth-org-scope.
 *
 * Required env (same fallbacks as platform/src/lib/db.ts):
 *   COUCHDB_URL              (or NEXT_PUBLIC_COUCHDB_URL, default http://couchdb:5984)
 *   COUCHDB_ADMIN_USER       (or COUCHDB_USER)
 *   COUCHDB_ADMIN_PASSWORD   (or COUCHDB_PASSWORD)
 *
 * NOTE: This script is intentionally a plain Node ESM module so it can run
 * without tsx / a TypeScript toolchain. The orgScoped database list and the
 * validate function string are duplicated below to keep the script free of
 * .ts imports. Keep them in sync with:
 *   - platform/src/lib/sync/sync-config.ts  (orgScoped flags)
 *   - platform/src/lib/sync/validate-doc-update.ts  (ORG_SCOPED_VALIDATE_FN)
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Duplicated from platform/src/lib/sync/sync-config.ts — orgScoped: true only.
// If you add/remove orgScoped databases there, update this list too.
// ---------------------------------------------------------------------------
const ORG_SCOPED_DATABASES = [
  // Core clinical
  'tamamhealth_patients',
  'tamamhealth_medical_records',
  'tamamhealth_referrals',
  'tamamhealth_lab_results',
  'tamamhealth_prescriptions',
  'tamamhealth_messages',
  'tamamhealth_births',
  'tamamhealth_deaths',
  'tamamhealth_facility_assessments',
  'tamamhealth_facility_census',
  'tamamhealth_immunizations',
  'tamamhealth_anc',
  'tamamhealth_follow_ups',
  'tamamhealth_hospitals',
  'tamamhealth_problems',
  'tamamhealth_disease_alerts',
  'tamamhealth_triage',
  'tamamhealth_appointments',
  'tamamhealth_availability',
  'tamamhealth_announcements',
  'tamamhealth_conversations',
  'tamamhealth_patient_notes',
  'tamamhealth_encounters',
  'tamamhealth_consultation_progress',
  'tamamhealth_handoffs',
  'tamamhealth_patient_transfers',
  'tamamhealth_order_sets',
  'tamamhealth_phone_notes',
  'tamamhealth_assessments',
  'tamamhealth_clinical_favorites',
  'tamamhealth_consultation_templates',
  'tamamhealth_clinician_tasks',
  'tamamhealth_patient_documents',
  'tamamhealth_patient_reminders',
  'tamamhealth_nutrition_screenings',
  'tamamhealth_nutrition_supplies',
  'tamamhealth_telehealth',
  'tamamhealth_program_enrollments',
  'tamamhealth_procedures',
  'tamamhealth_biometric_templates',
  'tamamhealth_clinical_notes',
  'tamamhealth_text_shortcuts',
  // Operational / facility
  'tamamhealth_pharmacy_inventory',
  'tamamhealth_wards',
  'tamamhealth_blood_bank',
  'tamamhealth_emergency_plans',
  'tamamhealth_assets',
  'tamamhealth_staff_schedules',
  'tamamhealth_leave_requests',
  'tamamhealth_payroll_entries',
  'tamamhealth_patient_feedback',
  // Billing / payments / insurance
  'tamamhealth_billing',
  'tamamhealth_fee_schedule',
  'tamamhealth_insurance_policies',
  'tamamhealth_eligibility_checks',
  'tamamhealth_charges',
  'tamamhealth_claims',
  'tamamhealth_adjustments',
  'tamamhealth_payments',
  'tamamhealth_refunds',
  'tamamhealth_saved_payment_methods',
  'tamamhealth_payment_plans',
  'tamamhealth_invoices',
  // Sync infrastructure
  'tamamhealth_sync_events',
  'tamamhealth_conflict_queue',
  // Identity / config (orgScoped subset)
  'tamamhealth_users',
  // Append-only audit trails
  'tamamhealth_audit_log',
  'tamamhealth_controlled_substance_log',
  'tamamhealth_ledger',
  'tamamhealth_intake_forms',
  'tamamhealth_visit_reasons',
  'tamamhealth_booking_policies',
  'tamamhealth_provider_profiles',
  'tamamhealth_provider_reviews',
];

// ---------------------------------------------------------------------------
// Duplicated verbatim from platform/src/lib/sync/validate-doc-update.ts.
// Keep these byte-for-byte identical.
// ---------------------------------------------------------------------------
const ORG_SCOPED_VALIDATE_FN = `function (newDoc, oldDoc, userCtx, secObj) {
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
    var immutable = ["orgId","hospitalId","type"];
    for (var j = 0; j < immutable.length; j++) {
      var f = immutable[j];
      if (oldDoc[f] !== undefined && newDoc[f] !== oldDoc[f]) {
        throw({ forbidden: f + ' is immutable (was ' + oldDoc[f] + ', got ' + newDoc[f] + ')' });
      }
    }
  }

  // ── Role-based write permission, by document type ──────────────────────
  var WRITE_ROLES = {"patient":["super_admin","org_admin","doctor","clinical_officer","clinician","nurse","midwife","front_desk","medical_superintendent","hrio","data_entry_clerk"],"medical_record":["super_admin","doctor","clinical_officer","clinician","medical_superintendent"],"clinical_note":["super_admin","doctor","clinical_officer","clinician","medical_superintendent"],"lab_result":["super_admin","doctor","clinical_officer","clinician","nurse","lab_tech","medical_superintendent"],"prescription":["super_admin","doctor","clinical_officer","clinician","medical_superintendent"],"triage":["super_admin","doctor","clinical_officer","clinician","nurse","front_desk","medical_superintendent"],"referral":["super_admin","doctor","clinical_officer","clinician","nurse","midwife","medical_superintendent"],"birth":["super_admin","doctor","clinical_officer","clinician","nurse","midwife","medical_superintendent","data_entry_clerk"],"death":["super_admin","doctor","clinical_officer","clinician","nurse","midwife","medical_superintendent","data_entry_clerk"],"anc_visit":["super_admin","doctor","clinical_officer","clinician","nurse","midwife","medical_superintendent","data_entry_clerk"],"immunization":["super_admin","doctor","clinical_officer","clinician","nurse","midwife","medical_superintendent","data_entry_clerk"],"telehealth_session":["super_admin","org_admin","doctor","clinical_officer","clinician","nurse"],"patient_transfer":["super_admin","org_admin","medical_superintendent","hospital_manager","doctor","clinician","clinical_officer","nurse","midwife","triage_nurse","rooming_nurse","nutritionist"]};
  var allowed = WRITE_ROLES[newDoc.type];

  // Unknown type: no rule to apply. See the note in write-permissions.ts.
  if (!allowed) return;

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

const DESIGN_DOC_ID = '_design/tamamhealth-org-scope';
const READ_ONLY_DESIGN_DOC_ID = '_design/tamamhealth-server-writes-only';
const READ_ONLY_DATABASES = [
  'tamamhealth_users',
  'tamamhealth_organizations',
  'tamamhealth_platform_config',
  'tamamhealth_fee_schedule',
];
const READ_ONLY_VALIDATE_FN = `function (newDoc, oldDoc, userCtx, secObj) {
  var roles = (userCtx && userCtx.roles) || [];
  for (var i = 0; i < roles.length; i++) {
    if (roles[i] === '_admin') return;
  }
  throw({ forbidden: 'This database is server-managed and read-only to clients' });
}`;

function resolveConfig() {
  const url =
    process.env.COUCHDB_URL ||
    process.env.NEXT_PUBLIC_COUCHDB_URL ||
    'http://couchdb:5984';
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!user || !pass) {
    console.error(
      '[install-validate-doc-updates] Missing CouchDB admin credentials. ' +
      'Set COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD (or COUCHDB_USER / ' +
      'COUCHDB_PASSWORD) in the environment.',
    );
    process.exit(1);
  }
  const authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  return { baseUrl: url.replace(/\/+$/, ''), authHeader };
}

async function installOne(baseUrl, authHeader, dbName) {
  const designUrl = `${baseUrl}/${dbName}/${DESIGN_DOC_ID}`;

  // 1. Probe for an existing design doc to capture _rev (idempotent updates).
  let existingRev = null;
  const probe = await fetch(designUrl, {
    method: 'GET',
    headers: { Authorization: authHeader },
  });
  if (probe.status === 200) {
    const body = await probe.json();
    existingRev = body && body._rev ? body._rev : null;
  } else if (probe.status !== 404) {
    return { ok: false, reason: `GET ${probe.status}` };
  }

  // 2. PUT the new (or updated) design doc body.
  const body = {
    _id: DESIGN_DOC_ID,
    validate_doc_update: ORG_SCOPED_VALIDATE_FN,
  };
  if (existingRev) body._rev = existingRev;

  const put = await fetch(designUrl, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (put.status === 201 || put.status === 202) {
    return { ok: true };
  }
  let reason = `PUT ${put.status}`;
  try {
    const errBody = await put.json();
    if (errBody && (errBody.error || errBody.reason)) {
      reason += ` ${errBody.error || ''} ${errBody.reason || ''}`.trim();
    }
  } catch {
    // ignore — non-JSON error body
  }
  return { ok: false, reason };
}

async function installReadOnly(baseUrl, authHeader, dbName) {
  const designUrl = `${baseUrl}/${dbName}/${READ_ONLY_DESIGN_DOC_ID}`;
  const probe = await fetch(designUrl, {
    method: 'GET',
    headers: { Authorization: authHeader },
  });
  let existingRev = null;
  if (probe.status === 200) {
    const existing = await probe.json();
    existingRev = existing && existing._rev ? existing._rev : null;
  } else if (probe.status !== 404) {
    return { ok: false, reason: `GET ${probe.status}` };
  }
  const body = {
    _id: READ_ONLY_DESIGN_DOC_ID,
    validate_doc_update: READ_ONLY_VALIDATE_FN,
  };
  if (existingRev) body._rev = existingRev;
  const put = await fetch(designUrl, {
    method: 'PUT',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return put.status === 201 || put.status === 202
    ? { ok: true }
    : { ok: false, reason: `PUT ${put.status}` };
}

/**
 * Grant per-DB read/write membership to org roles so authenticated CouchDB
 * users (provisioned by lib/sync/couch-auth.ts with `org:<orgId>` roles) can
 * replicate. Without this, CouchDB 3.x's admins-only default blocks every
 * browser pull/push with 403. Admin operations stay with the server admin
 * credentials — the admins block is intentionally left empty.
 *
 * Org list comes from COUCHDB_MEMBER_ORG_IDS (comma-separated orgIds);
 * With no explicit org IDs, membership stays empty (admin-only). Production
 * must never silently grant access to demo organization roles.
 */
function memberRoles() {
  const orgIds = (process.env.COUCHDB_MEMBER_ORG_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return orgIds.map((id) => `org:${id}`);
}

async function applySecurity(baseUrl, authHeader, dbName, roles) {
  const res = await fetch(`${baseUrl}/${dbName}/_security`, {
    method: 'PUT',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      admins: { names: [], roles: ['role:super_admin'] },
      members: { names: [], roles },
    }),
  });
  if (res.status === 200 || res.status === 201) return { ok: true };
  let reason = `PUT _security ${res.status}`;
  try {
    const errBody = await res.json();
    if (errBody && (errBody.error || errBody.reason)) {
      reason += ` ${errBody.error || ''} ${errBody.reason || ''}`.trim();
    }
  } catch {
    // ignore — non-JSON error body
  }
  return { ok: false, reason };
}

async function main() {
  const { baseUrl, authHeader } = resolveConfig();
  console.log(
    `[install-validate-doc-updates] target=${baseUrl.replace(/\/\/[^@]*@/, '//***@')} ` +
    `databases=${ORG_SCOPED_DATABASES.length}`,
  );

  let okCount = 0;
  let errCount = 0;
  for (const db of ORG_SCOPED_DATABASES) {
    try {
      const result = await installOne(baseUrl, authHeader, db);
      if (result.ok) {
        console.log(`[ok] ${db}`);
        okCount++;
      } else {
        console.log(`[error] ${db} ${result.reason}`);
        errCount++;
      }
    } catch (err) {
      console.log(`[error] ${db} ${err && err.message ? err.message : String(err)}`);
      errCount++;
    }
  }

  console.log(
    `[install-validate-doc-updates] done ok=${okCount} error=${errCount} ` +
    `total=${ORG_SCOPED_DATABASES.length}`,
  );

  for (const db of READ_ONLY_DATABASES) {
    const result = await installReadOnly(baseUrl, authHeader, db);
    if (!result.ok) {
      console.log(`[error] ${db} read-only policy ${result.reason}`);
      errCount++;
    }
  }

  // ── _security membership on every app database ──────────────────────────
  // Replication needs membership on all tamamhealth_* DBs, not only the
  // org-scoped subset above, so enumerate the live database list.
  const roles = memberRoles();
  let secOk = 0;
  let secErr = 0;
  const allDbsRes = await fetch(`${baseUrl}/_all_dbs`, {
    headers: { Authorization: authHeader },
  });
  const allDbs = (await allDbsRes.json()).filter(
    (name) => typeof name === 'string' && name.startsWith('tamamhealth_'),
  );
  for (const db of allDbs) {
    try {
      // Account requests are server-only PII. Unlike clinical databases they
      // are intentionally absent from sync-config, so CouchDB members must
      // not receive direct access even if they know the database name.
      const dbRoles = db === 'tamamhealth_account_requests' ? [] : roles;
      const result = await applySecurity(baseUrl, authHeader, db, dbRoles);
      if (result.ok) {
        secOk++;
      } else {
        console.log(`[error] ${db} ${result.reason}`);
        secErr++;
      }
    } catch (err) {
      console.log(`[error] ${db} _security ${err && err.message ? err.message : String(err)}`);
      secErr++;
    }
  }
  console.log(
    `[install-validate-doc-updates] _security membership roles=[${roles.join(', ')}] ` +
    `ok=${secOk} error=${secErr} total=${allDbs.length}`,
  );

  if (errCount > 0 || secErr > 0) process.exit(1);
}

main().catch((err) => {
  console.error('[install-validate-doc-updates] fatal', err);
  process.exit(1);
});
