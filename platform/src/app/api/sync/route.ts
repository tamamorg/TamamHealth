/**
 * CouchDB → PostgreSQL Sync Webhook
 *
 * This endpoint receives CouchDB _changes feed notifications and upserts
 * the corresponding documents into PostgreSQL for national analytics.
 *
 * Deployment: Configure CouchDB to POST changes to this endpoint, or use
 * a worker process that polls _changes and calls this route.
 *
 * POST /api/sync
 * Body: { db: string, changes: Array<{ id, seq, doc, deleted }> }
 *
 * ============================================================================
 * Coverage matrix vs DATABASE_SYNC_CONFIGS
 * ============================================================================
 * Every CouchDB database that participates in sync (DATABASE_SYNC_CONFIGS) has
 * an analytics writeback path here EXCEPT the following intentional exclusions:
 *
 *   - tamamhealth_users               Identity / auth surface. Personally
 *                                     identifiable; access via /api/users.
 *                                     Not an analytics target.
 *   - tamamhealth_platform_config     Server-pushed configuration, not data.
 *                                     Read-only on the client.
 *   - tamamhealth_organizations       Has a writeback (kept for slug/state
 *                                     joins on the dashboards).
 *   - tamamhealth_sync_events         Sync infrastructure. Ephemeral local
 *                                     event buffer; consumed by the
 *                                     conflict-queue UI then expired.
 *   - tamamhealth_conflict_queue      Sync infrastructure. Per-client
 *                                     conflict surface; not analytics-bound.
 *   - tamamhealth_saved_payment_methods  PCI-sensitive tokens. Must never
 *                                        leave the clinic perimeter.
 *   - tamamhealth_availability        Provider booking windows. Facility-
 *                                     operational scheduling, not a national
 *                                     analytics target.
 *   - tamamhealth_announcements       Staff broadcast notices. Facility-
 *                                     operational, not a national analytics
 *                                     target.
 *   - tamamhealth_conversations       Internal staff chat. Facility-operational
 *                                     PHI, not a national analytics target.
 *   - tamamhealth_patient_notes       Internal clinical notes. Facility-
 *                                     operational PHI, not a national
 *                                     analytics target.
 *   - tamamhealth_encounters          In-progress consultation workflow state.
 *                                     Facility-operational; not a national
 *                                     analytics target.
 *   - tamamhealth_consultation_progress Shared consultation tracker state.
 *                                     Facility-operational; not a national
 *                                     analytics target.
 *   - tamamhealth_biometric_templates Fingerprint minutiae templates. Highly
 *                                     sensitive biometric identifiers used
 *                                     only for in-org patient identification;
 *                                     must never flow to national analytics.
 *   - tamamhealth_order_sets          Clinical protocol/order-set templates.
 *                                     Org-scoped reference data, not a national
 *                                     analytics target.
 *   - tamamhealth_phone_notes         Patient call notes / callback workflow.
 *                                     Facility-operational PHI, not a national
 *                                     analytics target.
 *   - tamamhealth_assessments         Scored intake / outcome-measure forms.
 *                                     Facility-operational PHI, not a national
 *                                     analytics target.
 *   - tamamhealth_clinical_favorites  Per-clinician picker shortcuts. Personal
 *                                     preference data, not a national analytics
 *                                     target.
 *   - tamamhealth_consultation_templates  Clinician-saved consultation bundles.
 *                                     Personal templates, not a national
 *                                     analytics target.
 *   - tamamhealth_clinician_tasks     Per-clinician personal to-dos. Personal
 *                                     operational data, not a national analytics
 *                                     target.
 *   - tamamhealth_patient_documents   Scanned chart documents (films, letters,
 *                                     IDs). Facility-operational PHI blobs, not
 *                                     a national analytics target.
 *   - tamamhealth_patient_reminders   Queued patient reminders. Facility-
 *                                     operational, not a national analytics
 *                                     target.
 *   - tamamhealth_procedures          Bedside/theatre procedures performed on
 *                                     a patient. Facility-operational clinical
 *                                     detail (like patient_notes/phone_notes);
 *                                     not a national/DHIS2 indicator today.
 *   - tamamhealth_patient_transfers   Internal transfers of care ownership
 *                                     (provider/department/facility). Who is
 *                                     accountable for a patient inside a
 *                                     facility is operational staffing detail,
 *                                     not a national health indicator — and the
 *                                     records name individual clinicians, so
 *                                     projecting them nationally would export a
 *                                     staff-activity trail nobody asked for.
 *                                     (Cross-FACILITY patient movement that IS
 *                                     nationally meaningful already flows via
 *                                     tamamhealth_referrals.)
 *   - tamamhealth_clinical_notes      Clinical-notes module (SOAP/H&P/consult/
 *                                     etc. — the signed encounter record; see
 *                                     lib/clinical-notes/note-service.ts).
 *                                     Facility-operational PHI narrative, like
 *                                     patient_notes above; not a national
 *                                     analytics target.
 *   - tamamhealth_text_shortcuts      Per-clinician "dot phrase" shortcuts for
 *                                     the notes module. Personal/operational
 *                                     preference data, like clinical_favorites
 *                                     above; not a national analytics target.
 *   - tamamhealth_facility_census     Per-facility periodic census submissions
 *                                     (data-entry dashboard). Facility-
 *                                     operational reporting; not yet wired to
 *                                     a national analytics table.
 *
 * (tamamhealth_nutrition_screenings now HAS a national projection —
 * SAM/MAM is a DHIS2 MCH indicator — via DB_TABLE_MAP + FIELD_MAPPER +
 * migration 0008, so it is no longer excluded. tamamhealth_program_enrollments
 * likewise HAS a national projection — ART/TB/PMTCT/ANC/Nutrition/EPI/NCD
 * enrollment are core DHIS2 care-cascade indicators — via DB_TABLE_MAP +
 * FIELD_MAPPER + migration 0009.)
 *
 * All remaining databases land in DB_TABLE_MAP below; a missing entry causes a
 * 400 from this route, so the sync-worker surfaces a hard failure rather than
 * silently dropping data.
 *
 * Multi-type fan-out: a few databases co-locate several doc `type`s. The wards
 * DB holds ward + bed + admission docs and fans out to the `wards`, `beds`, and
 * `admissions` analytics tables (see resolveTable / WARDS_DB_TABLES) so inpatient
 * and bed-occupancy data reaches the national level instead of being flattened
 * into `wards`.
 * ============================================================================
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySyncMachineRequest } from '@/lib/sync-auth';
import { query, upsertDocument, deleteDocument } from '@/lib/db/postgres';
import { patientAgeInYears } from '@/lib/validation';

/**
 * Age for the national projection: derived from date of birth when present,
 * otherwise the registration-time estimate. Whole years — the analytics tier
 * bands by year, and sub-year precision would imply an accuracy the source
 * data does not have. See KAN-16.
 */
function derivePatientAge(doc: Record<string, unknown>): number | undefined {
  const age = patientAgeInYears(doc);
  return age === undefined ? undefined : Math.floor(age);
}

// Map CouchDB database names to PostgreSQL table names
const DB_TABLE_MAP: Record<string, string> = {
  tamamhealth_patients: 'patients',
  tamamhealth_hospitals: 'hospitals',
  tamamhealth_medical_records: 'medical_records',
  tamamhealth_lab_results: 'lab_results',
  tamamhealth_referrals: 'referrals',
  tamamhealth_disease_alerts: 'disease_alerts',
  tamamhealth_prescriptions: 'prescriptions',
  tamamhealth_births: 'births',
  tamamhealth_deaths: 'deaths',
  tamamhealth_immunizations: 'immunizations',
  tamamhealth_anc: 'anc_visits',
  tamamhealth_facility_assessments: 'facility_assessments',
  tamamhealth_audit_log: 'audit_log',
  tamamhealth_organizations: 'organizations',
  // Phase 2 — analytics writeback for clinical workflow tables.
  // Each one already has a CouchDB peer in DATABASE_SYNC_CONFIGS; the
  // table definition lives in `0003_clinical_workflow_tables.sql`.
  tamamhealth_problems: 'problems',
  tamamhealth_triage: 'triage_events',
  tamamhealth_appointments: 'appointments',
  tamamhealth_follow_ups: 'follow_ups',
  // Phase 3 — analytics writeback for messaging, financial revenue cycle,
  // regulatory append-only logs, operations, HR, facility infrastructure.
  // Table definitions live in `0004_analytics_writeback_phase3.sql`.
  tamamhealth_messages: 'messages',
  tamamhealth_controlled_substance_log: 'controlled_substance_log',
  tamamhealth_pharmacy_inventory: 'pharmacy_inventory',
  tamamhealth_wards: 'wards',
  tamamhealth_blood_bank: 'blood_bank',
  tamamhealth_emergency_plans: 'emergency_plans',
  tamamhealth_assets: 'assets',
  tamamhealth_staff_schedules: 'staff_schedules',
  tamamhealth_leave_requests: 'leave_requests',
  tamamhealth_payroll_entries: 'payroll_entries',
  tamamhealth_patient_feedback: 'patient_feedback',
  tamamhealth_billing: 'billing',
  tamamhealth_fee_schedule: 'fee_schedule',
  tamamhealth_insurance_policies: 'insurance_policies',
  tamamhealth_eligibility_checks: 'eligibility_checks',
  tamamhealth_charges: 'charges',
  tamamhealth_claims: 'claims',
  tamamhealth_adjustments: 'adjustments',
  tamamhealth_payments: 'payments',
  tamamhealth_refunds: 'refunds',
  tamamhealth_payment_plans: 'payment_plans',
  tamamhealth_invoices: 'invoices',
  tamamhealth_ledger: 'ledger_entries',
  // Nutrition screening — SAM/MAM is a national/DHIS2 MCH indicator.
  // Table definition lives in `0008_nutrition_screenings_writeback.sql`.
  tamamhealth_nutrition_screenings: 'nutrition_screenings',
  // Program enrollment — ART/TB/PMTCT/ANC/Nutrition/EPI/NCD are core national/
  // DHIS2 care-cascade indicators. Table definition lives in
  // `0009_program_enrollments_writeback.sql`.
  tamamhealth_program_enrollments: 'program_enrollments',
};

// A few CouchDB databases co-locate several doc `type`s in one database. The
// wards DB holds ward + bed + admission docs, so a single per-database table
// would flatten inpatient and bed data into the `wards` projection (dropping
// admissions/mortality/occupancy at the national level). These DBs fan out to
// one analytics table per doc type instead.
const WARDS_DB_TABLES: Record<string, string> = {
  ward: 'wards',
  bed: 'beds',
  admission: 'admissions',
};
const WARDS_DB_ALL_TABLES = ['wards', 'beds', 'admissions'];

/**
 * Resolve the PostgreSQL table for a single change. Defaults to the per-database
 * mapping; for multi-type databases (currently only the wards DB) it routes by
 * the document's `type` so each type lands in its own analytics table.
 */
function resolveTable(db: string, doc?: Record<string, unknown>): string | undefined {
  if (db === 'tamamhealth_wards') {
    const t = typeof doc?.type === 'string' ? WARDS_DB_TABLES[doc.type] : undefined;
    return t || DB_TABLE_MAP[db];
  }
  return DB_TABLE_MAP[db];
}

// Map CouchDB doc fields to PostgreSQL column names per table
type FieldMapper = (doc: Record<string, unknown>) => Record<string, unknown>;

const FIELD_MAPPERS: Record<string, FieldMapper> = {
  patients: (doc) => ({
    id: doc._id,
    hospital_number: doc.hospitalNumber,
    // Patient docs store the name as firstName/middleName/surname, not a single `name`.
    name: [doc.firstName, doc.middleName, doc.surname].filter(Boolean).join(' ') || undefined,
    gender: doc.gender,
    date_of_birth: doc.dateOfBirth,
    // Age is DERIVED from date of birth when one exists, and only falls back to
    // the stored `estimatedAge` when it doesn't (KAN-16). `estimatedAge` is
    // captured once at registration and never re-computed, so projecting it
    // straight through meant a patient registered at 4 was still reported as 4
    // years old three years later — and under-5 mortality and immunisation
    // coverage are both age-banded, so the drift lands directly in national
    // indicators.
    age: derivePatientAge(doc),
    state: doc.state,
    county: doc.county,
    // Full geographic hierarchy (KAN-14). state → county alone stops two levels
    // short of where an outbreak actually is; surveillance aggregates to payam
    // and boma.
    payam: doc.payam,
    boma: doc.boma,
    // South Sudan's primary patient identifier — without it national
    // de-duplication has nothing stable to match on, and household linkage
    // (how contact tracing works here) is lost.
    geocode_id: doc.geocodeId,
    national_id: doc.nationalId,
    household_number: doc.householdNumber,
    // Doc field is `registrationHospital`; there is no `hospitalId`.
    hospital_id: doc.registrationHospital,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  hospitals: (doc) => ({
    id: doc._id,
    name: doc.name,
    facility_type: doc.facilityType,
    facility_level: doc.facilityLevel,
    state: doc.state,
    county: doc.county,
    latitude: doc.latitude,
    longitude: doc.longitude,
    total_beds: doc.totalBeds,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  medical_records: (doc) => {
    // A medical record carries a `diagnoses: Diagnosis[]` array, not top-level
    // diagnosis scalars. Flatten the primary diagnosis (fall back to the first)
    // so national morbidity analytics get the coded diagnosis instead of NULLs.
    const diagnoses = Array.isArray(doc.diagnoses)
      ? (doc.diagnoses as Array<Record<string, unknown>>)
      : [];
    const primary = diagnoses.find((d) => d.type === 'primary') ?? diagnoses[0];
    return {
      id: doc._id,
      patient_id: doc.patientId,
      hospital_id: doc.hospitalId,
      record_type: doc.visitType,
      diagnosis: primary?.name,
      // The platform codes in ICD-11; the value lives in either slot depending
      // on write path, so prefer icd11Code and fall back to icd10Code.
      icd11_code: primary?.icd11Code ?? primary?.icd10Code,
      severity: primary?.severity,
      visit_date: doc.visitDate,
      org_id: doc.orgId,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
    };
  },

  lab_results: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    test_name: doc.testName,
    specimen: doc.specimen,
    status: doc.status,
    result: doc.result,
    abnormal: doc.abnormal,
    critical: doc.critical,
    hospital_id: doc.hospitalId,
    org_id: doc.orgId,
    ordered_at: doc.orderedAt,
    completed_at: doc.completedAt,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  referrals: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    from_hospital_id: doc.fromHospitalId || doc.from,
    to_hospital_id: doc.toHospitalId || doc.to,
    status: doc.status,
    urgency: doc.urgency,
    reason: doc.reason,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  disease_alerts: (doc) => ({
    id: doc._id,
    disease: doc.disease,
    icd11_code: doc.icd11Code,
    severity: doc.severity,
    state: doc.state,
    county: doc.county,
    cases: doc.cases,
    deaths: doc.deaths,
    status: doc.status,
    reported_by: doc.reportedBy,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  prescriptions: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    medication: doc.medication,
    dose: doc.dose,
    status: doc.status,
    hospital_id: doc.hospitalId,
    org_id: doc.orgId,
    // Clinical provenance — lets the analytics tier trace a dispensed drug to
    // the visit and the note that ordered it (migration 0010).
    encounter_id: doc.encounterId,
    medical_record_id: doc.medicalRecordId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  births: (doc) => ({
    id: doc._id,
    child_first_name: doc.childFirstName,
    child_surname: doc.childSurname,
    child_gender: doc.childGender,
    date_of_birth: doc.dateOfBirth,
    place_of_birth: doc.placeOfBirth,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    mother_name: doc.motherName,
    mother_age: doc.motherAge,
    birth_weight: doc.birthWeight,
    birth_type: doc.birthType,
    delivery_type: doc.deliveryType,
    attended_by: doc.attendedBy,
    state: doc.state,
    county: doc.county,
    certificate_number: doc.certificateNumber,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  deaths: (doc) => ({
    id: doc._id,
    deceased_first_name: doc.deceasedFirstName,
    deceased_surname: doc.deceasedSurname,
    deceased_gender: doc.deceasedGender,
    date_of_birth: doc.dateOfBirth,
    date_of_death: doc.dateOfDeath,
    age_at_death: doc.ageAtDeath,
    place_of_death: doc.placeOfDeath,
    facility_id: doc.facilityId,
    immediate_cause: doc.immediateCause,
    immediate_icd11: doc.immediateICD11,
    underlying_cause: doc.underlyingCause,
    underlying_icd11: doc.underlyingICD11,
    manner_of_death: doc.mannerOfDeath,
    maternal_death: doc.maternalDeath,
    state: doc.state,
    county: doc.county,
    certificate_number: doc.certificateNumber,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  nutrition_screenings: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    age: doc.age,
    sex: doc.sex,
    muac: doc.muac,
    weight_kg: doc.weightKg,
    height_cm: doc.heightCm,
    edema: doc.edema,
    is_anc: doc.isAnc,
    status: doc.status,
    screening_date: doc.screeningDate,
    screened_by_id: doc.screenedById,
    screened_by_name: doc.screenedByName,
    hospital_id: doc.hospitalId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  program_enrollments: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    program_key: doc.programKey,
    // `program_name` is a curated display label for the known program_keys,
    // but arbitrary clinician-typed free text when program_key === 'other' —
    // i.e. uncontrolled PHI. Project the curated label only; suppress the
    // free-text 'other' case (same stance as the excluded `notes` field).
    program_name: doc.programKey === 'other' ? null : doc.programName,
    status: doc.status,
    enrollment_date: doc.enrollmentDate,
    outcome_date: doc.outcomeDate,
    // NB: free-text `notes` is deliberately NOT projected to national
    // analytics. Enrollment in art_hiv_care/tb_dr/pmtct already encodes
    // stigmatizing status against a named patient; narrative notes would add
    // uncontrolled PHI to the broader-access national tier. Care-cascade
    // indicators need status/dates/keys, not free text — same stance as the
    // patient_notes / phone_notes / assessments national-sync exclusions.
    recorded_by: doc.recordedBy,
    recorded_by_name: doc.recordedByName,
    hospital_id: doc.hospitalId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  immunizations: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    vaccine: doc.vaccine,
    dose_number: doc.doseNumber,
    date_given: doc.dateGiven,
    next_due_date: doc.nextDueDate,
    facility_id: doc.facilityId,
    state: doc.state,
    status: doc.status,
    adverse_reaction: doc.adverseReaction,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  anc_visits: (doc) => ({
    id: doc._id,
    mother_id: doc.motherId,
    mother_name: doc.motherName,
    visit_number: doc.visitNumber,
    visit_date: doc.visitDate,
    gestational_age: doc.gestationalAge,
    risk_level: doc.riskLevel,
    facility_id: doc.facilityId,
    state: doc.state,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  facility_assessments: (doc) => ({
    id: doc._id,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    assessment_date: doc.assessmentDate,
    overall_score: doc.overallScore,
    general_equipment_score: doc.generalEquipmentScore,
    diagnostic_capacity_score: doc.diagnosticCapacityScore,
    essential_medicines_score: doc.essentialMedicinesScore,
    staffing_score: doc.staffingScore,
    data_quality_score: doc.dataQualityScore,
    state: doc.state,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  audit_log: (doc) => ({
    id: doc._id,
    action: doc.action,
    user_id: doc.userId,
    username: doc.username,
    details: doc.details,
    success: doc.success,
    org_id: doc.orgId,
    created_at: doc.createdAt,
  }),

  organizations: (doc) => ({
    id: doc._id,
    name: doc.name,
    slug: doc.slug,
    org_type: doc.orgType,
    subscription_status: doc.subscriptionStatus,
    subscription_plan: doc.subscriptionPlan,
    is_active: doc.isActive,
    contact_email: doc.contactEmail,
    country: doc.country,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  // ----- Phase 2 analytics writeback -----

  problems: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    name: doc.name,
    icd11_code: doc.icd11Code,
    icd10_code: doc.icd10Code,
    status: doc.status,
    onset_date: doc.onsetDate,
    resolved_date: doc.resolvedDate,
    severity: doc.severity,
    hospital_id: doc.hospitalId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  triage_events: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    priority: doc.priority,
    airway: doc.airway,
    breathing: doc.breathing,
    circulation: doc.circulation,
    consciousness: doc.consciousness,
    chief_complaint: doc.chiefComplaint,
    facility_id: doc.facilityId,
    triaged_at: doc.triagedAt,
    status: doc.status,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  appointments: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    provider_id: doc.providerId,
    provider_name: doc.providerName,
    facility_id: doc.facilityId,
    appointment_date: doc.appointmentDate,
    appointment_time: doc.appointmentTime,
    duration: doc.duration,
    appointment_type: doc.appointmentType,
    priority: doc.priority,
    department: doc.department,
    status: doc.status,
    state: doc.state,
    county: doc.county,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  follow_ups: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    assigned_worker: doc.assignedWorker,
    assigned_worker_name: doc.assignedWorkerName,
    status: doc.status,
    outcome: doc.outcome,
    condition: doc.condition,
    facility_level: doc.facilityLevel,
    scheduled_date: doc.scheduledDate,
    completed_date: doc.completedDate,
    state: doc.state,
    county: doc.county,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  // ----- Phase 3 analytics writeback -----

  messages: (doc) => ({
    id: doc._id,
    recipient_type: doc.recipientType,
    direction: doc.direction,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    patient_phone: doc.patientPhone,
    from_doctor_id: doc.fromDoctorId,
    from_doctor_name: doc.fromDoctorName,
    from_hospital_id: doc.fromHospitalId,
    from_hospital_name: doc.fromHospitalName,
    subject: doc.subject,
    body: doc.body,
    channel: doc.channel,
    status: doc.status,
    sent_at: doc.sentAt,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  controlled_substance_log: (doc) => ({
    id: doc._id,
    inventory_id: doc.inventoryId,
    medication_name: doc.medicationName,
    schedule: doc.schedule,
    movement: doc.movement,
    quantity: doc.quantity,
    unit: doc.unit,
    before_balance: doc.beforeBalance,
    after_balance: doc.afterBalance,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    prescription_id: doc.prescriptionId,
    operator_id: doc.operatorId,
    operator_name: doc.operatorName,
    witness_id: doc.witnessId,
    witness_name: doc.witnessName,
    reason: doc.reason,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    org_id: doc.orgId,
    created_at: doc.createdAt,
  }),

  pharmacy_inventory: (doc) => ({
    id: doc._id,
    hospital_id: doc.hospitalId,
    hospital_name: doc.hospitalName,
    medication_name: doc.medicationName,
    category: doc.category,
    stock_level: doc.stockLevel,
    unit: doc.unit,
    reorder_level: doc.reorderLevel,
    batch_number: doc.batchNumber,
    expiry_date: doc.expiryDate,
    last_received: doc.lastReceived,
    last_dispensed: doc.lastDispensed,
    dispensed_today: doc.dispensedToday,
    controlled_schedule: doc.controlledSchedule,
    requires_witness: doc.requiresWitness,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),


  wards: (doc) => ({
    id: doc._id,
    name: doc.name,
    ward_type: doc.wardType,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    facility_level: doc.facilityLevel,
    floor: doc.floor,
    total_beds: doc.totalBeds,
    occupied_beds: doc.occupiedBeds,
    available_beds: doc.availableBeds,
    nurse_in_charge: doc.nurseInCharge,
    is_active: doc.isActive,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  blood_bank: (doc) => ({
    id: doc._id,
    unit_id: doc.unitId,
    blood_group: doc.bloodGroup,
    component: doc.component,
    volume: doc.volume,
    collection_date: doc.collectionDate,
    expiry_date: doc.expiryDate,
    donor_id: doc.donorId,
    donor_name: doc.donorName,
    status: doc.status,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  beds: (doc) => ({
    id: doc._id,
    bed_number: doc.bedNumber,
    ward_id: doc.wardId,
    ward_name: doc.wardName,
    facility_id: doc.facilityId,
    status: doc.status,
    current_patient_id: doc.currentPatientId,
    current_patient_name: doc.currentPatientName,
    current_admission_id: doc.currentAdmissionId,
    last_cleaned_at: doc.lastCleanedAt,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  admissions: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    hospital_number: doc.hospitalNumber,
    admission_date: doc.admissionDate,
    admitting_diagnosis: doc.admittingDiagnosis,
    icd11_code: doc.icd11Code,
    severity: doc.severity,
    admitted_by: doc.admittedBy,
    admitted_by_name: doc.admittedByName,
    ward_id: doc.wardId,
    ward_name: doc.wardName,
    bed_id: doc.bedId,
    bed_number: doc.bedNumber,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    facility_level: doc.facilityLevel,
    attending_physician: doc.attendingPhysician,
    attending_physician_name: doc.attendingPhysicianName,
    nurse_assigned: doc.nurseAssigned,
    nurse_assigned_name: doc.nurseAssignedName,
    isolation_required: doc.isolationRequired,
    isolation_reason: doc.isolationReason,
    status: doc.status,
    discharge_date: doc.dischargeDate,
    discharge_type: doc.dischargeType,
    discharge_diagnosis: doc.dischargeDiagnosis,
    discharge_icd11: doc.dischargeIcd11,
    discharged_by: doc.dischargedBy,
    discharged_by_name: doc.dischargedByName,
    follow_up_required: doc.followUpRequired,
    follow_up_date: doc.followUpDate,
    length_of_stay: doc.lengthOfStay,
    transferred_from: doc.transferredFrom,
    transferred_to: doc.transferredTo,
    state: doc.state,
    county: doc.county,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  emergency_plans: (doc) => ({
    id: doc._id,
    plan_name: doc.planName,
    emergency_type: doc.emergencyType,
    phase: doc.phase,
    severity: doc.severity,
    description: doc.description,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    activated_at: doc.activatedAt,
    deactivated_at: doc.deactivatedAt,
    estimated_capacity: doc.estimatedCapacity,
    current_load: doc.currentLoad,
    total_cases_managed: doc.totalCasesManaged,
    total_deaths: doc.totalDeaths,
    total_referrals_out: doc.totalReferralsOut,
    state: doc.state,
    county: doc.county,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  assets: (doc) => ({
    id: doc._id,
    name: doc.name,
    serial_number: doc.serialNumber,
    asset_tag: doc.assetTag,
    category: doc.category,
    manufacturer: doc.manufacturer,
    model: doc.model,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    facility_level: doc.facilityLevel,
    department: doc.department,
    location: doc.location,
    status: doc.status,
    condition: doc.condition,
    acquired_date: doc.acquiredDate,
    cost_currency: doc.costCurrency,
    cost: doc.cost,
    donor: doc.donor,
    warranty_expires_at: doc.warrantyExpiresAt,
    last_serviced_at: doc.lastServicedAt,
    next_service_due_at: doc.nextServiceDueAt,
    service_interval_months: doc.serviceIntervalMonths,
    state: doc.state,
    county: doc.county,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  staff_schedules: (doc) => ({
    id: doc._id,
    user_id: doc.userId,
    user_name: doc.userName,
    role: doc.role,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    shift_type: doc.shiftType,
    shift_date: doc.shiftDate,
    start_time: doc.startTime,
    end_time: doc.endTime,
    department: doc.department,
    is_on_call: doc.isOnCall,
    status: doc.status,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  leave_requests: (doc) => ({
    id: doc._id,
    user_id: doc.userId,
    user_name: doc.userName,
    role: doc.role,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    leave_type: doc.leaveType,
    start_date: doc.startDate,
    end_date: doc.endDate,
    days: doc.days,
    reason: doc.reason,
    status: doc.status,
    requested_at: doc.requestedAt,
    decided_at: doc.decidedAt,
    decided_by: doc.decidedBy,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  payroll_entries: (doc) => ({
    id: doc._id,
    user_id: doc.userId,
    user_name: doc.userName,
    role: doc.role,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    period: doc.period,
    base_salary: doc.baseSalary,
    allowances: doc.allowances,
    deductions: doc.deductions,
    net_pay: doc.netPay,
    currency: doc.currency,
    status: doc.status,
    paid_at: doc.paidAt,
    paid_by: doc.paidBy,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  patient_feedback: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    department: doc.department,
    visit_date: doc.visitDate,
    rating: doc.rating,
    nps_score: doc.npsScore,
    sentiment: doc.sentiment,
    category: doc.category,
    comment: doc.comment,
    channel: doc.channel,
    follow_up_required: doc.followUpRequired,
    follow_up_status: doc.followUpStatus,
    resolved_at: doc.resolvedAt,
    state: doc.state,
    county: doc.county,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  billing: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    facility_level: doc.facilityLevel,
    encounter_date: doc.encounterDate,
    encounter_id: doc.encounterId,
    appointment_id: doc.appointmentId,
    subtotal: doc.subtotal,
    discount: doc.discount,
    tax_rate: doc.taxRate,
    tax_amount: doc.taxAmount,
    total_amount: doc.totalAmount,
    amount_paid: doc.amountPaid,
    balance_due: doc.balanceDue,
    currency: doc.currency,
    status: doc.status,
    invoice_number: doc.invoiceNumber,
    insurance_provider: doc.insuranceProvider,
    insurance_claim_status: doc.insuranceClaimStatus,
    insurance_approved_amount: doc.insuranceApprovedAmount,
    state: doc.state,
    county: doc.county,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  fee_schedule: (doc) => ({
    id: doc._id,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    category: doc.category,
    service_code: doc.serviceCode,
    service_name: doc.serviceName,
    unit_price: doc.unitPrice,
    currency: doc.currency,
    is_active: doc.isActive,
    effective_from: doc.effectiveFrom,
    effective_to: doc.effectiveTo,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  insurance_policies: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    payer_type: doc.payerType,
    payer_name: doc.payerName,
    payer_code: doc.payerCode,
    member_id: doc.memberId,
    group_number: doc.groupNumber,
    policy_number: doc.policyNumber,
    subscriber_name: doc.subscriberName,
    subscriber_relationship: doc.subscriberRelationship,
    effective_date: doc.effectiveDate,
    termination_date: doc.terminationDate,
    is_primary: doc.isPrimary,
    copay_amount: doc.copayAmount,
    coinsurance_pct: doc.coinsurancePct,
    deductible_amount: doc.deductibleAmount,
    deductible_remaining: doc.deductibleRemaining,
    oop_max: doc.oopMax,
    oop_used: doc.oopUsed,
    is_active: doc.isActive,
    donor_program_id: doc.donorProgramId,
    donor_coverage_type: doc.donorCoverageType,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  eligibility_checks: (doc) => ({
    id: doc._id,
    policy_id: doc.policyId,
    patient_id: doc.patientId,
    check_date: doc.checkDate,
    status: doc.status,
    deductible_remaining: doc.deductibleRemaining,
    copay_amount: doc.copayAmount,
    coinsurance_pct: doc.coinsurancePct,
    oop_used: doc.oopUsed,
    oop_max: doc.oopMax,
    estimated_patient_responsibility: doc.estimatedPatientResponsibility,
    source: doc.source,
    expires_at: doc.expiresAt,
    checked_by: doc.checkedBy,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  charges: (doc) => ({
    id: doc._id,
    encounter_id: doc.encounterId,
    patient_id: doc.patientId,
    cpt_code: doc.cptCode,
    modifier: doc.modifier,
    description: doc.description,
    category: doc.category,
    units: doc.units,
    billed_amount: doc.billedAmount,
    allowed_amount: doc.allowedAmount,
    status: doc.status,
    claim_id: doc.claimId,
    denial_reason_code: doc.denialReasonCode,
    service_date: doc.serviceDate,
    provider_id: doc.providerId,
    provider_name: doc.providerName,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  claims: (doc) => ({
    id: doc._id,
    encounter_id: doc.encounterId,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    policy_id: doc.policyId,
    payer_name: doc.payerName,
    payer_type: doc.payerType,
    claim_number: doc.claimNumber,
    total_billed: doc.totalBilled,
    total_allowed: doc.totalAllowed,
    total_approved: doc.totalApproved,
    total_denied: doc.totalDenied,
    total_write_off: doc.totalWriteOff,
    patient_responsibility: doc.patientResponsibility,
    submitted_date: doc.submittedDate,
    adjudicated_date: doc.adjudicatedDate,
    status: doc.status,
    era_reference: doc.eraReference,
    donor_reporting_period: doc.donorReportingPeriod,
    submitted_by: doc.submittedBy,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  adjustments: (doc) => ({
    id: doc._id,
    encounter_id: doc.encounterId,
    patient_id: doc.patientId,
    charge_id: doc.chargeId,
    claim_id: doc.claimId,
    adjustment_type: doc.adjustmentType,
    amount: doc.amount,
    reason: doc.reason,
    reason_code: doc.reasonCode,
    approved_by: doc.approvedBy,
    approved_date: doc.approvedDate,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  payments: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    encounter_id: doc.encounterId,
    invoice_id: doc.invoiceId,
    payment_plan_id: doc.paymentPlanId,
    method: doc.method,
    amount: doc.amount,
    currency: doc.currency,
    reference: doc.reference,
    mobile_money_phone: doc.mobileMoneyPhone,
    card_last4: doc.cardLast4,
    status: doc.status,
    processed_at: doc.processedAt,
    processed_by: doc.processedBy,
    reversed_at: doc.reversedAt,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  refunds: (doc) => ({
    id: doc._id,
    payment_id: doc.paymentId,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    amount: doc.amount,
    currency: doc.currency,
    method: doc.method,
    reference: doc.reference,
    reason: doc.reason,
    status: doc.status,
    processed_at: doc.processedAt,
    processed_by: doc.processedBy,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  payment_plans: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    total_balance: doc.totalBalance,
    term_months: doc.termMonths,
    monthly_amount: doc.monthlyAmount,
    apr: doc.apr,
    start_date: doc.startDate,
    end_date: doc.endDate,
    status: doc.status,
    next_due_date: doc.nextDueDate,
    paid_to_date: doc.paidToDate,
    remaining_balance: doc.remainingBalance,
    missed_payments: doc.missedPayments,
    last_payment_date: doc.lastPaymentDate,
    auto_pay_enabled: doc.autoPayEnabled,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  invoices: (doc) => ({
    id: doc._id,
    invoice_number: doc.invoiceNumber,
    patient_id: doc.patientId,
    patient_name: doc.patientName,
    encounter_id: doc.encounterId,
    subtotal: doc.subtotal,
    insurance_payments: doc.insurancePayments,
    adjustments: doc.adjustments,
    prior_payments: doc.priorPayments,
    total_due: doc.totalDue,
    currency: doc.currency,
    issued_date: doc.issuedDate,
    due_date: doc.dueDate,
    status: doc.status,
    sent_via: doc.sentVia,
    sent_at: doc.sentAt,
    viewed_at: doc.viewedAt,
    paid_at: doc.paidAt,
    facility_id: doc.facilityId,
    facility_name: doc.facilityName,
    org_id: doc.orgId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  }),

  ledger_entries: (doc) => ({
    id: doc._id,
    patient_id: doc.patientId,
    encounter_id: doc.encounterId,
    entry_type: doc.entryType,
    amount: doc.amount,
    running_balance: doc.runningBalance,
    description: doc.description,
    reference_id: doc.referenceId,
    reference_type: doc.referenceType,
    method: doc.method,
    currency: doc.currency,
    facility_id: doc.facilityId,
    org_id: doc.orgId,
    created_at: doc.createdAt,
  }),
};

interface ChangeEntry {
  id: string;
  seq: string;
  doc?: Record<string, unknown>;
  deleted?: boolean;
}

interface SyncPayload {
  db: string;
  changes: ChangeEntry[];
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const verification = await verifySyncMachineRequest(request, rawBody);
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.status === 503 ? 'Sync authentication unavailable' : 'Unauthorized' },
        { status: verification.status },
      );
    }
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'Sync not configured: DATABASE_URL not set' }, { status: 503 });
    }

    let body: SyncPayload;
    try {
      body = JSON.parse(rawBody) as SyncPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { db, changes } = body;

    if (!db || !changes || !Array.isArray(changes)) {
      return NextResponse.json({ error: 'Invalid payload: requires db and changes array' }, { status: 400 });
    }

    const baseTable = DB_TABLE_MAP[db];
    if (!baseTable) {
      return NextResponse.json({ error: `Unknown database: ${db}` }, { status: 400 });
    }

    let processed = 0;
    let errors = 0;
    let lastSeq = '';

    for (const change of changes) {
      try {
        if (change.deleted) {
          // A deleted change carries no doc, so for multi-type databases the
          // type is unknown — clear the id from every projection the DB feeds.
          // Document ids are globally unique, so the extra deletes are no-ops.
          const targets = db === 'tamamhealth_wards' ? WARDS_DB_ALL_TABLES : [baseTable];
          for (const tbl of targets) await deleteDocument(tbl, change.id);
        } else if (change.doc) {
          // Skip design documents
          if (change.id.startsWith('_design/')) continue;

          const table = resolveTable(db, change.doc) || baseTable;
          const mapper = FIELD_MAPPERS[table];
          if (!mapper) {
            console.error(`[Sync] No field mapper for table: ${table} (db ${db}, doc ${change.id})`);
            errors++;
            lastSeq = change.seq;
            continue;
          }

          const mapped = mapper(change.doc);
          // Filter out undefined values
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(mapped)) {
            if (v !== undefined) cleaned[k] = v;
          }
          await upsertDocument(table, change.id, cleaned);
        }
        processed++;
        lastSeq = change.seq;
      } catch (err) {
        console.error(`[Sync] Error processing ${change.id}:`, err);
        errors++;
      }
    }

    // Update sync metadata with last processed sequence
    if (lastSeq) {
      await query(
        `INSERT INTO sync_metadata (db_name, last_seq, last_synced_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (db_name) DO UPDATE SET last_seq = $2, last_synced_at = NOW()`,
        [db, lastSeq]
      );
    }

    return NextResponse.json({
      ok: true,
      processed,
      errors,
      lastSeq,
    });
  } catch (err) {
    // Same 503 mapping as GET — a Postgres outage during webhook delivery is
    // a transient infrastructure condition, not a sync-worker bug. Returning
    // 503 lets the worker back off + retry instead of declaring the payload
    // poisoned (which would happen on a 500-class response).
    const e = err as { code?: string; message?: string } | undefined;
    const code = e?.code;
    const msg = e?.message || '';
    const unreachable =
      code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
      code === '28000' /* invalid_authorization_specification */ ||
      code === '28P01' /* invalid_password */ ||
      code === '3D000' /* invalid_catalog_name (database missing) */ ||
      code === '42P01' /* undefined_table — migrations not applied */ ||
      /role .* does not exist/i.test(msg);
    if (unreachable) {
      console.warn('[Sync] Postgres unavailable for webhook:', code || msg);
      return NextResponse.json(
        { error: 'Sync analytics database is unavailable', code: code || 'UNAVAILABLE' },
        { status: 503 }
      );
    }
    console.error('[Sync] Webhook error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** GET /api/sync — return sync metadata to the authenticated sync worker. */
export async function GET(request: NextRequest) {
  try {
    const verification = await verifySyncMachineRequest(request, '');
    if (!verification.ok) {
      return NextResponse.json(
        { error: verification.status === 503 ? 'Sync authentication unavailable' : 'Unauthorized' },
        { status: verification.status },
      );
    }
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'Sync not configured: DATABASE_URL not set' }, { status: 503 });
    }

    const result = await query<{ db_name: string; last_seq: string; last_synced_at: string }>(
      'SELECT db_name, last_seq, last_synced_at FROM sync_metadata ORDER BY db_name'
    );
    return NextResponse.json({ databases: result.rows });
  } catch (err) {
    // Postgres unreachable / role missing / migrations not applied — surface a
    // 503 (service unavailable) rather than a generic 500. Any of these means
    // the analytics writeback is operationally offline; callers (status pages,
    // health checks, the conflicts UI) need that signal to be specific so they
    // can render a meaningful banner instead of a red "Internal Server Error".
    const e = err as { code?: string; message?: string } | undefined;
    const code = e?.code;
    const msg = e?.message || '';
    const unreachable =
      code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
      code === '28000' /* invalid_authorization_specification */ ||
      code === '28P01' /* invalid_password */ ||
      code === '3D000' /* invalid_catalog_name (database missing) */ ||
      code === '42P01' /* undefined_table — migrations not applied */ ||
      /role .* does not exist/i.test(msg);
    if (unreachable) {
      console.warn('[Sync] Postgres unavailable for status check:', code || msg);
      return NextResponse.json(
        { error: 'Sync analytics database is unavailable', code: code || 'UNAVAILABLE' },
        { status: 503 }
      );
    }
    console.error('[Sync] Status error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch sync status' },
      { status: 500 }
    );
  }
}
