/**
 * Clinical CRUD document types: problems, histories, programme enrolments,
 * procedures. Split out of db-types.ts (modularization 2026-11, Phase 1 —
 * type-only move, no runtime change). Re-exported from db-types.ts so every
 * existing `@/lib/db-types` import keeps resolving these names.
 */
import type { BaseDoc } from './db-types';
import type { ProcedureStatus } from './clinical-flow/order-lifecycles';

/**
 * Longitudinal Problem List — Epic-style "Active / Resolved / Chronic"
 * clinical problems anchored to the patient (not the encounter). One
 * problem can span many visits. Used for handoff, care continuity, and
 * driving role-aware UI (e.g. show TB protocol when patient has active
 * TB problem).
 */
export type ProblemStatus = 'active' | 'resolved' | 'chronic' | 'inactive';

export interface ProblemDoc extends BaseDoc {
  type: 'problem';
  patientId: string;
  patientName?: string;
  /** Display name (e.g. "Type 2 Diabetes Mellitus") */
  name: string;
  /** ICD-11 code (preferred). ICD-10 kept for legacy / interop fallback. */
  icd11Code?: string;
  icd10Code?: string;
  status: ProblemStatus;
  /** Date the problem first started / was diagnosed (YYYY-MM-DD) */
  onsetDate?: string;
  /** Date the problem was resolved (YYYY-MM-DD), if status='resolved' */
  resolvedDate?: string;
  /** Severity at time of last update */
  severity?: 'mild' | 'moderate' | 'severe';
  /** Free-text clinical context */
  notes?: string;
  /** Encounter that first documented this problem */
  sourceEncounterId?: string;
  /** Set when the entry was recorded on the wrong patient or by mistake. The
   *  document is kept for the audit trail and dropped from every list. */
  recordStatus?: 'active' | 'entered_in_error';
  /** Why the entry was marked entered in error, or why its onset was corrected. */
  correctionReason?: string;
  recordedBy?: string;
  recordedByName?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/**
 * One line of a patient's standing history — past medical, surgical, family or
 * social. Anchored to the patient like the Problem List, so it is recorded once
 * and read at every visit instead of being retyped into each note.
 *
 * One document per entry rather than one history document per patient: two
 * clinicians adding a family-history line and a social-history line at the same
 * moment then write two different documents, and neither can overwrite the
 * other on sync.
 *
 * What is NOT here: coded current diagnoses (the Problem List), allergies
 * (`patient.structuredAllergies`) and procedures done in this facility
 * (`ProcedureDoc`). The History tab reads those alongside these entries; it does
 * not copy them.
 */
export type HistoryDomain = 'medical' | 'surgical' | 'family' | 'social' | 'medication';
// 'medication' is a medicine the patient already takes, as they report it
// (home medicine, a script from elsewhere): `title` the medicine, `detail` how
// it is taken, `when` since when. It is history, not an order: nothing reaches
// the pharmacy, which is why nursing roles may record it while prescribing
// (`PrescriptionDoc`) stays with clinicians. Shown on the Medications tab, not
// among the History tab's four sections.

export interface HistoryEntryDoc extends BaseDoc {
  type: 'history_entry';
  patientId: string;
  patientName?: string;
  domain: HistoryDomain;
  /**
   * The headline of the entry: the illness or event (medical), the operation
   * (surgical), the condition a relative had (family), or the factor being
   * described — "Tobacco", "Occupation" (social).
   */
  title: string;
  /** Family history only: who had it ("Mother", "Maternal grandfather"). */
  relation?: string;
  /** Social history only: which factor `title` names. See SOCIAL_FACTORS. */
  factor?: string;
  /**
   * When it happened, as the patient can give it. Free text on purpose — a
   * history is taken as "2015", "as a child" or "about ten years ago", and a
   * date picker would make the clinician invent a day and a month.
   */
  when?: string;
  /** Surgical history only: where the operation was done. */
  facility?: string;
  /** The finding itself for social history ("Never smoked"); context otherwise. */
  detail?: string;
  /**
   * 'entered_in_error' retires a mistaken entry without deleting it, so the
   * chart can still show that something was recorded and withdrawn.
   * 'stopped' (medication entries) means the patient no longer takes it: true
   * when recorded, off the current list now.
   */
  status: 'active' | 'entered_in_error' | 'stopped';
  /** Medication entries: when and by whom it was marked as no longer taken. */
  stoppedAt?: string;
  stoppedBy?: string;
  stoppedByName?: string;
  /** Clinical note this entry was recorded from, when it was added mid-note. */
  sourceNoteId?: string;
  recordedBy?: string;
  recordedByName?: string;
  /** Who last corrected the entry, when it has been edited since it was recorded. */
  updatedBy?: string;
  updatedByName?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/**
 * Care-program enrollment — clinical programs a patient is enrolled in
 * (ART/HIV care, TB, PMTCT, ANC, Nutrition, EPI/Immunization, NCD clinic, or
 * a free-text "other"). Anchored to the patient like the Problem List.
 *
 * Distinct from `Patient.payorInfo.programEnrollment`, which is an unrelated
 * insurance/NGO-coverage string captured at registration.
 */
export type ProgramKey =
  | 'art_hiv_care'
  | 'tb_ds'
  | 'tb_dr'
  | 'pmtct'
  | 'anc'
  | 'nutrition_otp'
  | 'nutrition_sfp'
  | 'epi_immunization'
  | 'ncd_hypertension_diabetes'
  | 'other';

export type ProgramEnrollmentStatus = 'active' | 'completed' | 'transferred_out' | 'lost_to_follow_up' | 'discontinued';

export interface ProgramEnrollmentDoc extends BaseDoc {
  type: 'program_enrollment';
  patientId: string;
  patientName?: string;
  programKey: ProgramKey;
  /** Display label — the curated program name, or the clinician's free text when programKey === 'other'. */
  programName: string;
  status: ProgramEnrollmentStatus;
  /** Date the patient was enrolled (YYYY-MM-DD) */
  enrollmentDate: string;
  /** Date the enrollment ended (completed/transferred/discontinued/LTFU), if any (YYYY-MM-DD) */
  outcomeDate?: string;
  outcomeReason?: string;
  notes?: string;
  recordedBy?: string;
  recordedByName?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/**
 * Procedure performed on a patient (bedside or theatre) — e.g. wound
 * debridement, incision & drainage, suturing, IUD insertion. Previously no
 * procedure data model existed; procedures done during a visit were only
 * captured as free text inside the consultation note.
 */
export interface ProcedureDoc extends BaseDoc {
  type: 'procedure';
  patientId: string;
  patientName?: string;
  /** Encounter that this procedure was performed during, if any */
  encounterId?: string;
  /** Display name (e.g. "Incision and drainage of abscess") */
  name: string;
  /** Optional procedure code — free text (not validated against a coding system today) */
  code?: string;
  /** Date the procedure was performed (YYYY-MM-DD) */
  date: string;
  /**
   * Stage 7 lifecycle state (`PROCEDURE_TRANSITIONS` in order-lifecycles.ts):
   * ordered → consented → in_progress → completed → in_observation → released,
   * with aborted / complication → ae_reported branches.
   *
   * Optional, and absent means "already done". Every procedure written before
   * this field existed is a historical record of something that had already
   * happened — the document carried `date` and `performedBy` and nothing else —
   * so treating a missing status as in-flight would block discharge on every
   * visit with an old procedure on the chart. `isProcedureSettled` in
   * procedure-service is the single reader of that rule.
   */
  status?: ProcedureStatus;
  consentedAt?: string;
  consentedBy?: string;
  /** Required when `status` is 'aborted' — the lifecycle says "aborted (with reason)". */
  abortedReason?: string;
  performedBy?: string;
  performedByName?: string;
  bodySite?: string;
  outcome?: string;
  notes?: string;
  amended?: boolean;
  amendedAt?: string;
  amendedBy?: string;
  amendmentReason?: string;
  recordStatus?: 'active' | 'entered_in_error';
  statusReason?: string;
  statusChangedAt?: string;
  statusChangedBy?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}
