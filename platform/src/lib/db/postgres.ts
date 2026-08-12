/**
 * PostgreSQL Client — server-side only.
 *
 * Uses the `pg` package to connect to the national analytics database.
 * Connection pooling is used for efficiency across API route invocations.
 *
 * NOTE: This module must only be imported in server-side code (API routes,
 * server components). Never import it in client components.
 *
 * ============================================================================
 * Per-table conflict policy (CouchDB → PostgreSQL writeback)
 * ============================================================================
 * The sync writeback path runs `upsertDocument` for every CouchDB change. The
 * documents originate on offline-first clients, so two devices can legitimately
 * post divergent updates for the same row. A naive last-write-wins UPSERT can
 * silently destroy clinical data — e.g. a clinician's appended note overwritten
 * by a stale demographics push, or a finalized lab result rolled back by a
 * resurrected draft. To keep the writeback safe we resolve conflicts per
 * table using one of three policies:
 *
 *   - LAST_WRITE_WINS    Default. `INSERT … ON CONFLICT (id) DO UPDATE SET …`.
 *                        Used for rows where each post represents the latest
 *                        complete snapshot (demographics, organizations,
 *                        sync_metadata, per-visit records).
 *
 *   - APPEND_ONLY        `INSERT … ON CONFLICT (id) DO NOTHING`. Used for the
 *                        audit log: an audit row is immutable once written,
 *                        and any later sync of the same id is a duplicate to
 *                        be dropped, never an overwrite.
 *
 *   - CLINICAL_FINALIZED `INSERT … ON CONFLICT (id) DO UPDATE SET …
 *                          WHERE <table>.status NOT IN
 *                            ('closed','resolved','cancelled','finalized')
 *                            AND incoming.updated_at >= COALESCE(<table>.updated_at, epoch)`.
 *                        Refuses to roll back a finalized clinical record and
 *                        refuses to apply an older snapshot on top of a newer
 *                        one. Used for medical records, lab results,
 *                        prescriptions, births, deaths, disease alerts, and
 *                        referrals.
 *
 * The mapping is `TABLE_CONFLICT_POLICY`. Tables not in the map are rejected
 * by `assertSafeTable` with the same allowlist error as before — adding a new
 * table is a deliberate, reviewed change.
 *
 * Full reasoning is in `docs/architecture/sync-conflict-policy.md`.
 * ============================================================================
 */

import { Pool, type PoolConfig } from 'pg';
import { connectionStringForExplicitSsl, postgresSslOptions } from './postgres-ssl';

// ============================================================================
// SQL-injection allowlists.
//
// upsertDocument() and deleteDocument() build dynamic SQL where the table and
// column names cannot be parameterized by `pg`. Any identifier that slips
// through becomes executable SQL, so we lock both down to strict allowlists
// populated from the known CouchDB → PostgreSQL schema. Anything not in the
// allowlist is rejected before a query is built.
// ============================================================================

const ALLOWED_TABLES = new Set<string>([
  'patients',
  'hospitals',
  'medical_records',
  'lab_results',
  'referrals',
  'disease_alerts',
  'prescriptions',
  'births',
  'deaths',
  'immunizations',
  'anc_visits',
  'facility_assessments',
  'audit_log',
  'organizations',
  'sync_metadata',
  // Phase 2 analytics writeback (see migrations/0003_clinical_workflow_tables.sql)
  'problems',
  'triage_events',
  'appointments',
  'follow_ups',
  // Phase 3 analytics writeback (see migrations/0004_analytics_writeback_phase3.sql)
  'messages',
  'controlled_substance_log',
  'pharmacy_inventory',
  'telehealth_sessions',
  'wards',
  // Ward inpatient writeback (see migrations/0006_ward_inpatient_writeback.sql).
  // The FIELD_MAPPERS + migration existed but these were never allowlisted, so
  // every bed/admission upsert was rejected and dropped — revived here.
  'beds',
  'admissions',
  // Nutrition screening writeback (see migrations/0008_nutrition_screenings_writeback.sql).
  'nutrition_screenings',
  // Program enrollment writeback (see migrations/0009_program_enrollments_writeback.sql).
  'program_enrollments',
  'blood_bank',
  'emergency_plans',
  'assets',
  'staff_schedules',
  'leave_requests',
  'payroll_entries',
  'patient_feedback',
  'billing',
  'fee_schedule',
  'insurance_policies',
  'eligibility_checks',
  'charges',
  'claims',
  'adjustments',
  'payments',
  'refunds',
  'payment_plans',
  'invoices',
  'ledger_entries',
]);

// Union of every column name emitted by the FIELD_MAPPERS in the sync route.
// Any identifier outside this set is refused — so an attacker can't smuggle
// in a column like `x; DROP TABLE patients;--` via a poisoned CouchDB doc.
const ALLOWED_COLUMNS = new Set<string>([
  'id', 'hospital_number', 'name', 'gender', 'date_of_birth', 'age', 'state',
  'county', 'hospital_id', 'org_id', 'created_at', 'updated_at',
  'facility_type', 'facility_level', 'latitude', 'longitude', 'total_beds',
  'patient_id', 'record_type', 'diagnosis', 'icd11_code', 'severity',
  'visit_date', 'test_name', 'specimen', 'status', 'result', 'abnormal',
  'critical', 'ordered_at', 'completed_at', 'from_hospital_id',
  'to_hospital_id', 'urgency', 'reason', 'disease', 'cases', 'deaths',
  'reported_by', 'medication', 'dose', 'child_first_name', 'child_surname',
  'child_gender', 'place_of_birth', 'facility_id', 'facility_name',
  'mother_name', 'mother_age', 'birth_weight', 'birth_type', 'delivery_type',
  'attended_by', 'certificate_number', 'deceased_first_name',
  'deceased_surname', 'deceased_gender', 'date_of_death', 'age_at_death',
  'place_of_death', 'immediate_cause', 'immediate_icd11', 'underlying_cause',
  'underlying_icd11', 'manner_of_death', 'maternal_death', 'patient_name',
  'vaccine', 'dose_number', 'date_given', 'next_due_date', 'adverse_reaction',
  'mother_id', 'visit_number', 'gestational_age', 'risk_level', 'worker_id',
  'worker_name', 'geocode_id', 'chief_complaint', 'suspected_condition',
  'action', 'outcome', 'payam', 'boma', 'gps_latitude', 'gps_longitude',
  'assessment_date', 'overall_score', 'general_equipment_score',
  'diagnostic_capacity_score', 'essential_medicines_score', 'staffing_score',
  'data_quality_score', 'user_id', 'username', 'details', 'success',
  'slug', 'org_type', 'subscription_status', 'subscription_plan', 'is_active',
  'contact_email', 'country', 'db_name', 'last_seq', 'last_synced_at',
  // Phase 2 analytics writeback columns
  'icd10_code', 'onset_date', 'resolved_date',                       // problems
  'priority', 'airway', 'breathing', 'circulation', 'consciousness', // triage_events
  'triaged_at',
  'provider_id', 'provider_name',                                    // appointments
  'appointment_date', 'appointment_time', 'duration',
  'appointment_type', 'department',
  'assigned_worker', 'assigned_worker_name', 'condition',            // follow_ups
  'scheduled_date', 'completed_date',
  // Phase 3 analytics writeback columns
  'recipient_type', 'direction', 'patient_phone',                    // messages
  'from_doctor_id', 'from_doctor_name', 'from_hospital_id',
  'from_hospital_name', 'subject', 'body', 'channel', 'sent_at',
  'inventory_id', 'schedule', 'movement', 'quantity', 'unit',        // controlled_substance_log
  'before_balance', 'after_balance', 'prescription_id',
  'operator_id', 'operator_name', 'witness_id', 'witness_name',
  'hospital_name', 'medication_name', 'category', 'stock_level',     // pharmacy_inventory
  'reorder_level', 'batch_number', 'expiry_date', 'last_received',
  'last_dispensed', 'dispensed_today', 'controlled_schedule',
  'requires_witness',
  'appointment_id', 'session_type', 'scheduled_time',                // telehealth_sessions
  'actual_start_time', 'actual_end_time', 'follow_up_required',
  'referral_required', 'session_quality', 'connection_drops',
  'patient_consent_given', 'session_recorded', 'patient_rating',
  'consultation_fee', 'payment_status',
  'ward_type', 'floor', 'occupied_beds', 'available_beds',           // wards
  'nurse_in_charge',
  'unit_id', 'blood_group', 'component', 'volume', 'collection_date',// blood_bank
  'donor_id', 'donor_name',
  'plan_name', 'emergency_type', 'phase', 'description',             // emergency_plans
  'activated_at', 'deactivated_at', 'estimated_capacity',
  'current_load', 'total_cases_managed', 'total_deaths',
  'total_referrals_out',
  'serial_number', 'asset_tag', 'manufacturer', 'model', 'location', // assets
  'condition', 'acquired_date', 'cost_currency', 'cost', 'donor',
  'warranty_expires_at', 'last_serviced_at', 'next_service_due_at',
  'service_interval_months',
  'user_name', 'role', 'shift_type', 'shift_date', 'start_time',     // staff_schedules
  'end_time', 'is_on_call',
  'leave_type', 'start_date', 'end_date', 'days', 'requested_at',    // leave_requests
  'decided_at', 'decided_by',
  'period', 'base_salary', 'allowances', 'deductions', 'net_pay',    // payroll_entries
  'paid_at', 'paid_by',
  'nps_score', 'sentiment', 'comment', 'follow_up_status',           // patient_feedback
  'resolved_at',
  'encounter_date', 'encounter_id', 'subtotal', 'discount',          // billing
  'tax_rate', 'tax_amount', 'total_amount', 'amount_paid',
  'balance_due', 'currency', 'invoice_number', 'insurance_provider',
  'insurance_claim_status', 'insurance_approved_amount',
  'service_code', 'service_name', 'unit_price', 'effective_from',    // fee_schedule
  'effective_to',
  'payer_type', 'payer_name', 'payer_code', 'member_id',             // insurance_policies
  'group_number', 'policy_number', 'subscriber_name',
  'subscriber_relationship', 'effective_date', 'termination_date',
  'is_primary', 'copay_amount', 'coinsurance_pct',
  'deductible_amount', 'deductible_remaining', 'oop_max', 'oop_used',
  'donor_program_id', 'donor_coverage_type',
  'policy_id', 'check_date', 'estimated_patient_responsibility',     // eligibility_checks
  'source', 'expires_at', 'checked_by',
  'cpt_code', 'modifier', 'description', 'units', 'billed_amount',   // charges
  'allowed_amount', 'claim_id', 'denial_reason_code', 'service_date',
  'claim_number', 'total_billed', 'total_allowed', 'total_approved', // claims
  'total_denied', 'total_write_off', 'patient_responsibility',
  'submitted_date', 'adjudicated_date', 'era_reference',
  'donor_reporting_period', 'submitted_by',
  'charge_id', 'adjustment_type', 'amount', 'reason_code',           // adjustments
  'approved_by', 'approved_date',
  'invoice_id', 'payment_plan_id', 'method', 'reference',            // payments
  'mobile_money_phone', 'card_last4', 'processed_at', 'processed_by',
  'reversed_at',
  'payment_id',                                                       // refunds
  'total_balance', 'term_months', 'monthly_amount', 'apr',           // payment_plans
  'next_due_date', 'paid_to_date', 'remaining_balance',
  'missed_payments', 'last_payment_date', 'auto_pay_enabled',
  'insurance_payments', 'adjustments', 'prior_payments',             // invoices
  'total_due', 'issued_date', 'due_date', 'sent_via', 'viewed_at',
  'paid_at',
  'entry_type', 'running_balance', 'reference_id', 'reference_type', // ledger_entries
  // Ward inpatient writeback (migrations/0006_ward_inpatient_writeback.sql).
  // beds:
  'bed_number', 'ward_id', 'ward_name', 'current_patient_id',
  'current_patient_name', 'current_admission_id', 'last_cleaned_at',
  // admissions:
  'admission_date', 'admitting_diagnosis', 'admitted_by', 'admitted_by_name',
  'bed_id', 'attending_physician', 'attending_physician_name', 'nurse_assigned',
  'nurse_assigned_name', 'isolation_required', 'isolation_reason',
  'discharge_date', 'discharge_type', 'discharge_diagnosis', 'discharged_by',
  'discharged_by_name', 'follow_up_date', 'length_of_stay', 'transferred_from',
  'transferred_to',
  // Nutrition screening writeback (migrations/0008_nutrition_screenings_writeback.sql).
  'sex', 'muac', 'weight_kg', 'height_cm', 'edema', 'is_anc', 'screening_date',
  'screened_by_id', 'screened_by_name',
  // Program enrollment writeback (migrations/0009_program_enrollments_writeback.sql).
  // `notes` intentionally omitted — free-text PHI must not reach national analytics.
  'program_key', 'program_name', 'enrollment_date', 'outcome_date',
  'recorded_by', 'recorded_by_name',
]);

// Final defence: every identifier must match a strict pattern. This catches
// anything weird (whitespace, quotes, semicolons, comments) even if it
// somehow gets into an allowlist at build time.
const IDENTIFIER_RE = /^[a-z][a-z0-9_]*$/;

function assertSafeTable(table: string): void {
  if (!IDENTIFIER_RE.test(table) || !ALLOWED_TABLES.has(table)) {
    throw new Error(`[SQL-SAFE] Table '${table}' is not in the allowlist`);
  }
}

function assertSafeColumn(column: string): void {
  if (!IDENTIFIER_RE.test(column) || !ALLOWED_COLUMNS.has(column)) {
    throw new Error(`[SQL-SAFE] Column '${column}' is not in the allowlist`);
  }
}

// ============================================================================
// Conflict policy
// ============================================================================

/**
 * How `upsertDocument` should resolve an `ON CONFLICT (id)` collision.
 *
 * The enum is a string literal union (not a TS `enum`) so the values survive
 * `JSON.stringify`, are easy to log, and stay tree-shake-friendly. New
 * variants — e.g. a future `MERGE_NOTES` for patient narrative columns —
 * should extend this union and gain a branch in `upsertDocument`.
 */
export const ConflictPolicy = {
  LAST_WRITE_WINS: 'LAST_WRITE_WINS',
  APPEND_ONLY: 'APPEND_ONLY',
  CLINICAL_FINALIZED: 'CLINICAL_FINALIZED',
} as const;
export type ConflictPolicy = typeof ConflictPolicy[keyof typeof ConflictPolicy];

/**
 * Per-table conflict policy. Every row in `ALLOWED_TABLES` MUST appear here;
 * `assertPolicyForTable` enforces that at runtime in case the two lists drift.
 */
export const TABLE_CONFLICT_POLICY: Record<string, ConflictPolicy> = {
  // Demographics: each push is the latest snapshot. Note merging will arrive
  // via a follow-up policy variant; today every column overwrites.
  patients: ConflictPolicy.LAST_WRITE_WINS,

  // Facility / org / sync metadata: latest snapshot wins.
  hospitals: ConflictPolicy.LAST_WRITE_WINS,
  organizations: ConflictPolicy.LAST_WRITE_WINS,
  facility_assessments: ConflictPolicy.LAST_WRITE_WINS,
  sync_metadata: ConflictPolicy.LAST_WRITE_WINS,

  // Each row is its own visit — natural last-write-wins.
  immunizations: ConflictPolicy.LAST_WRITE_WINS,
  anc_visits: ConflictPolicy.LAST_WRITE_WINS,

  // Clinical-grade rows: refuse to roll back a finalized record and refuse
  // to apply a stale snapshot.
  medical_records: ConflictPolicy.CLINICAL_FINALIZED,
  lab_results: ConflictPolicy.CLINICAL_FINALIZED,
  prescriptions: ConflictPolicy.CLINICAL_FINALIZED,
  births: ConflictPolicy.CLINICAL_FINALIZED,
  deaths: ConflictPolicy.CLINICAL_FINALIZED,

  // Workflow records that may carry a terminal status — `closed`/`resolved`
  // must not be silently rolled back by a stale incoming doc.
  referrals: ConflictPolicy.CLINICAL_FINALIZED,
  disease_alerts: ConflictPolicy.CLINICAL_FINALIZED,

  // Append-only: an audit row is immutable.
  audit_log: ConflictPolicy.APPEND_ONLY,

  // ----- Phase 2 analytics writeback policies -----

  // Problem list: each clinician push is the latest snapshot for that problem
  // record (status/severity/notes can change). The CLINICAL_FINALIZED policy
  // would refuse rollbacks once a problem is `resolved`, but the canonical
  // resolution flow re-opens problems too — so LAST_WRITE_WINS is correct.
  problems: ConflictPolicy.LAST_WRITE_WINS,

  // Triage event: a single ETAT encounter. Status moves pending → seen →
  // admitted/discharged/referred; once `discharged` we should not allow a
  // stale snapshot to re-open it, so use CLINICAL_FINALIZED.
  triage_events: ConflictPolicy.CLINICAL_FINALIZED,

  // Appointment: status moves through scheduled → completed/cancelled/no_show
  // — once finalized, do not allow rollback. CLINICAL_FINALIZED handles both
  // the terminal-status guard and stale-snapshot guard.
  appointments: ConflictPolicy.CLINICAL_FINALIZED,

  // Follow-up: each push is the latest state of an open follow-up plan.
  // Workers may legitimately update notes after a `completed` outcome (e.g.
  // recording a missed re-attendance), so LAST_WRITE_WINS over a fixed
  // terminal-status guard.
  follow_ups: ConflictPolicy.LAST_WRITE_WINS,

  // ----- Phase 3 analytics writeback policies -----

  // Messages: each push is the latest state of a message; no rollback risk
  // (the canonical doc lives in CouchDB and is rarely edited after send).
  messages: ConflictPolicy.LAST_WRITE_WINS,

  // Controlled substance log: regulatory chain of custody. Once a movement
  // is logged it must never be overwritten. Identical to audit_log.
  controlled_substance_log: ConflictPolicy.APPEND_ONLY,

  // Pharmacy inventory: a stock-level snapshot per SKU; the latest push wins.
  pharmacy_inventory: ConflictPolicy.LAST_WRITE_WINS,

  // Telehealth: status moves scheduled → in_session → completed/cancelled/no_show.
  // Once finalized do not allow rollback. The terminal-status vocabulary doesn't
  // match TERMINAL_STATUSES exactly, so we rely on the updated_at monotonicity
  // guard alone — same approach as triage_events / appointments.
  telehealth_sessions: ConflictPolicy.CLINICAL_FINALIZED,

  // Wards / blood_bank / assets / staff_schedules / leave_requests /
  // payroll_entries / patient_feedback / emergency_plans / fee_schedule /
  // insurance_policies / eligibility_checks / payment_plans:
  // mutable lookup / state snapshots — last write wins.
  wards: ConflictPolicy.LAST_WRITE_WINS,
  // beds & admissions share the wards CouchDB database but project to their own
  // national tables (inpatient occupancy & admission/discharge analytics).
  beds: ConflictPolicy.LAST_WRITE_WINS,
  admissions: ConflictPolicy.LAST_WRITE_WINS,
  nutrition_screenings: ConflictPolicy.LAST_WRITE_WINS,
  // Program enrollment: status moves active -> completed/transferred_out/
  // lost_to_follow_up/discontinued, but the canonical flow can re-open a
  // lost-to-follow-up enrollment (patient returns to care) just like
  // `problems` re-opens a resolved condition — so LAST_WRITE_WINS, not
  // CLINICAL_FINALIZED.
  program_enrollments: ConflictPolicy.LAST_WRITE_WINS,
  blood_bank: ConflictPolicy.LAST_WRITE_WINS,
  assets: ConflictPolicy.LAST_WRITE_WINS,
  staff_schedules: ConflictPolicy.LAST_WRITE_WINS,
  leave_requests: ConflictPolicy.LAST_WRITE_WINS,
  payroll_entries: ConflictPolicy.LAST_WRITE_WINS,
  patient_feedback: ConflictPolicy.LAST_WRITE_WINS,
  emergency_plans: ConflictPolicy.LAST_WRITE_WINS,
  fee_schedule: ConflictPolicy.LAST_WRITE_WINS,
  insurance_policies: ConflictPolicy.LAST_WRITE_WINS,
  eligibility_checks: ConflictPolicy.LAST_WRITE_WINS,
  payment_plans: ConflictPolicy.LAST_WRITE_WINS,

  // Billing / charges / claims / invoices: revenue-cycle workflow rows that
  // close when paid/cancelled. Refuse to roll back a paid/cancelled invoice
  // or a paid/voided charge with a stale snapshot. CLINICAL_FINALIZED's
  // terminal-status set ('closed','resolved','cancelled','finalized') doesn't
  // cover 'paid' / 'voided' / 'denied', so for these tables the policy
  // degrades to the updated_at monotonicity guard alone — that's still
  // correct: a stale snapshot can't overwrite a fresher row.
  billing: ConflictPolicy.CLINICAL_FINALIZED,
  charges: ConflictPolicy.CLINICAL_FINALIZED,
  claims: ConflictPolicy.CLINICAL_FINALIZED,
  invoices: ConflictPolicy.CLINICAL_FINALIZED,

  // Payments / refunds: financial transactions; once posted/processed, the
  // status moves into a terminal value but reversals/refunds are recorded
  // by adding new rows, not by rewriting old ones. LAST_WRITE_WINS is fine
  // because the row is identified by id (one row per transaction).
  payments: ConflictPolicy.LAST_WRITE_WINS,
  refunds: ConflictPolicy.LAST_WRITE_WINS,

  // Adjustments: typically immutable once approved; treat as last-write-wins
  // because the approval flow does set fields after creation.
  adjustments: ConflictPolicy.LAST_WRITE_WINS,

  // Ledger entries: append-only patient financial chain. Each entry is
  // immutable by design (a correction is a NEW reversing entry), so any
  // re-sync of the same id is a duplicate, not a rewrite.
  ledger_entries: ConflictPolicy.APPEND_ONLY,
};

// Status values that mark a clinical row as finalized. The CLINICAL_FINALIZED
// policy refuses to update a row whose status is already in this set.
const TERMINAL_STATUSES = ['closed', 'resolved', 'cancelled', 'finalized'] as const;

// Tables governed by CLINICAL_FINALIZED that actually carry a `status` column
// in the schema. For these we emit the terminal-status guard. The remaining
// CLINICAL_FINALIZED tables (medical_records, births, deaths) have no
// status column — we still enforce the updated_at monotonicity guard so a
// stale snapshot can't roll back a newer one.
const TABLES_WITH_STATUS_COLUMN = new Set<string>([
  'lab_results', 'referrals', 'disease_alerts', 'prescriptions', 'immunizations',
  // triage_events and appointments are CLINICAL_FINALIZED but use a different
  // terminal-status vocabulary (completed/discharged/admitted/no_show/cancelled)
  // than the shared TERMINAL_STATUSES set, so they intentionally rely on the
  // updated_at monotonicity guard alone — a stale snapshot still cannot
  // overwrite a fresher row. Refactor the policy to support per-table terminal
  // sets if a real-world rollback case appears.
]);

function assertPolicyForTable(table: string): ConflictPolicy {
  const policy = TABLE_CONFLICT_POLICY[table];
  if (!policy) {
    // The two allowlists drifted — refuse, don't fall back to a default that
    // could quietly clobber clinical rows.
    throw new Error(`[SQL-SAFE] Table '${table}' has no conflict policy defined`);
  }
  return policy;
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    const ssl = postgresSslOptions();
    const config: PoolConfig = {
      connectionString: connectionStringForExplicitSsl(connectionString, ssl),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // Verify the provider certificate in production. A cluster-specific CA
      // can be supplied through DATABASE_CA_CERT_BASE64.
      ...(ssl ? { ssl } : {}),
    };

    pool = new Pool(config);

    pool.on('error', (err) => {
      console.error('[PostgreSQL] Unexpected pool error:', err);
    });
  }

  return pool;
}

/** Execute a parameterized query */
export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  } finally {
    client.release();
  }
}

/**
 * Result of an `upsertDocument` call. `inserted` is true when a new row was
 * written, false when an existing row was either updated or (under
 * APPEND_ONLY / CLINICAL_FINALIZED) intentionally left in place.
 */
export interface UpsertResult {
  /** Whether a row was inserted or updated; false for a conflict-suppressed write. */
  written: boolean;
  /** The conflict policy that was applied, for logging / metrics. */
  policy: ConflictPolicy;
}

/**
 * Build the SQL for a given conflict policy. Pure (no I/O) so it's easy to
 * unit-test the emitted string.
 *
 * NOTE: every identifier in `table`/`columns` must already have passed
 * `assertSafeTable` / `assertSafeColumn` before reaching this function.
 */
export function buildUpsertSql(
  table: string,
  columns: string[],
  policy: ConflictPolicy,
): string {
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const updateColumns = columns.filter(c => c !== 'id');

  if (policy === ConflictPolicy.APPEND_ONLY) {
    return `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (id) DO NOTHING
  `;
  }

  const setClauses = updateColumns.map(c => {
    const idx = columns.indexOf(c) + 1;
    return `${c} = $${idx}`;
  });

  if (policy === ConflictPolicy.CLINICAL_FINALIZED) {
    // Build the WHERE-clause guard.
    //   1. Block a write when the existing row is already in a terminal
    //      status (only if the table actually has a `status` column).
    //   2. Block a stale overwrite when the incoming row carries an
    //      `updated_at` value: the new value must be >= the stored one.
    const guards: string[] = [];
    if (TABLES_WITH_STATUS_COLUMN.has(table)) {
      const terminalList = TERMINAL_STATUSES.map(s => `'${s}'`).join(', ');
      guards.push(
        `${table}.status IS NULL OR ${table}.status NOT IN (${terminalList})`,
      );
    }
    const updatedAtIdx = columns.indexOf('updated_at');
    if (updatedAtIdx >= 0) {
      guards.push(
        `$${updatedAtIdx + 1}::timestamptz >= COALESCE(${table}.updated_at, '1970-01-01'::timestamptz)`,
      );
    }
    // Always emit at least one guard so the SQL stays syntactically valid.
    // If neither status nor updated_at is available we degrade to a permissive
    // guard (TRUE) — the operator should have filtered the doc upstream.
    if (guards.length === 0) guards.push('TRUE');
    return `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (id) DO UPDATE SET
      ${setClauses.join(',\n      ')}
    WHERE (${guards.join(') AND (')})
  `;
  }

  // LAST_WRITE_WINS — the original behaviour, preserved verbatim.
  return `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (id) DO UPDATE SET
      ${setClauses.join(',\n      ')}
  `;
}

/**
 * Upsert a document from CouchDB into the corresponding PostgreSQL table.
 * Table + column identifiers are validated against strict allowlists so that
 * a poisoned CouchDB doc cannot inject executable SQL (the pg driver has no
 * way to parameterize identifiers).
 *
 * The exact `ON CONFLICT` behaviour is dictated by `TABLE_CONFLICT_POLICY` —
 * see the policy block at the top of this file.
 */
export async function upsertDocument(
  table: string,
  id: string,
  data: Record<string, unknown>
): Promise<UpsertResult> {
  assertSafeTable(table);
  const policy = assertPolicyForTable(table);

  // Build column list and values dynamically — every column must pass the
  // allowlist before it enters the SQL string.
  const columns = Object.keys(data);
  columns.forEach(assertSafeColumn);

  const values = Object.values(data);
  const sql = buildUpsertSql(table, columns, policy);

  const result = await query(sql, values);
  // `pg` reports rowCount=0 when ON CONFLICT DO NOTHING suppresses the write
  // or when the CLINICAL_FINALIZED guard prevents the UPDATE. Anything > 0
  // means the row was actually inserted/updated.
  const written = (result.rowCount ?? 0) > 0;
  return { written, policy };
}

/** Delete a document by ID from a table (table name allowlist-validated). */
export async function deleteDocument(table: string, id: string): Promise<void> {
  assertSafeTable(table);
  await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

/** Close the connection pool (for graceful shutdown) */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
