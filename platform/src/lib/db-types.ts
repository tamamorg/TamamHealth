import type { Hospital, Patient, Referral, DiseaseAlert, VitalSigns, Diagnosis, Prescription, LabResult, MedicalRecord, Attachment, TransferPackage, CareTeamMember } from '@/data/mock';
import type { EncounterStatus, EncounterStageKey } from './clinical-flow/encounter-journey';
import type { LabOrderStatus, PrescriptionStatus, ProcedureStatus } from './clinical-flow/order-lifecycles';
import type { CriticalityTier } from './clinical-flow/payment-model';

export interface BaseDoc {
  _id: string;
  _rev?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  /**
   * Device-local sync lifecycle. This is separate from domain fields named
   * `syncStatus` (for example facility online/offline status) and is safe to
   * attach to any PouchDB document that should work offline-first.
   */
  offlineSync?: {
    status: 'local' | 'pending' | 'synced' | 'conflict' | 'failed';
    lastLocalChangeAt?: string;
    lastSyncedAt?: string;
    lastSyncedRev?: string;
    error?: string;
  };
  /**
   * ISO 3166-1 alpha-2 country code of the facility that owns this record.
   * Populated at create time by the facility node so the country node
   * aggregator can partition records by jurisdiction for DHIS2 reporting
   * and cross-border referral routing.
   */
  countryId?: string;
}

export type UserRole = 'super_admin' | 'org_admin' | 'doctor' | 'clinical_officer' | 'nurse' | 'midwife' | 'lab_tech' | 'pharmacist' | 'front_desk' | 'cashier' | 'government' | 'county_health_director' | 'data_entry_clerk' | 'medical_superintendent' | 'hrio' | 'nutritionist' | 'radiologist' | 'hospital_manager' | 'medical_biller'
  // Clinical-flow workflow roles (EHR Clinical Flow doc §4) — capability-gated stations.
  | 'central_registration_clerk' | 'clinic_clerk' | 'triage_nurse' | 'rooming_nurse' | 'clinician' | 'records_hmis_officer';

export interface UserDoc extends BaseDoc {
  type: 'user';
  username: string;
  email?: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  /**
   * Additional facilities this user may work at, beyond `hospitalId`.
   *
   * The entitlement model in `sync/facility-entitlements.ts` was built to read
   * this and it was never populated, so the only way to give a clinician who
   * covers two sites access to both was to hand them an org-wide role — which
   * grants every facility in the tenant, not the two they actually attend.
   *
   * Each entry becomes a `facility:<id>` claim on the CouchDB user, which the
   * replication selector narrows reads by and the write validator checks
   * writes against.
   */
  facilityIds?: string[];
  orgId?: string;
  /**
   * Display name of the owning organization, denormalised alongside `orgId`
   * exactly as `hospitalName` sits alongside `hospitalId`.
   *
   * The name is stamped server-side from the organization record at create /
   * update time, so it is never client-supplied. It exists because the org
   * document itself is not always on the device: an account created by an org
   * admin, replicated to a phone that never pulled the organizations database,
   * had an `orgId` no screen could turn into a name — so every surface that
   * wanted to say who the user works for said nothing at all.
   */
  orgName?: string;
  isActive: boolean;
  /**
   * Set when an admin creates the account or resets the password. Forces the
   * user to choose a new password at next login before they can use the app,
   * so the admin's temporary password never becomes a permanent credential.
   * Cleared once the user sets their own password.
   */
  mustChangePassword?: boolean;
  /**
   * SHA-256 of the outstanding account-invitation token, and when it lapses.
   *
   * The raw token is emailed and never stored, so a database dump cannot be
   * replayed into an account takeover. Both fields are cleared the moment the
   * invitation is redeemed, which is what makes it single-use.
   */
  inviteTokenHash?: string;
  inviteExpiresAt?: string;
  /** ISO timestamp of the last password change (admin reset or self-service). */
  passwordUpdatedAt?: string;
  /**
   * ISO timestamp of the last successful sign-in.
   *
   * Absent means "has never signed in" — which for a freshly provisioned
   * account is the difference between an invitation that worked and one that
   * silently never arrived. Nothing recorded this before, so the roster could
   * not distinguish the two, dormant accounts could not be found, and a
   * periodic access review had no data to run on. Written by the login route
   * on success only; a failed attempt must never move it.
   */
  lastLoginAt?: string;
  /** Who deactivated this account and when — offboarding needs a paper trail
   *  that `isActive: false` alone does not carry. */
  deactivatedAt?: string;
  deactivatedBy?: string;
  /** Hashed 4-6 digit PIN for screen-lock quick unlock */
  pinHash?: string;
  /** Staff directory: department (e.g. "Cardiology", "Pediatrics", "OPD"). */
  department?: string;
  /** Staff directory: clinical specialty (e.g. "Cardiologist"). */
  specialty?: string;
  /** Staff directory: contact phone for messaging. */
  phone?: string;
  /**
   * Staff photo, as a downscaled data URL (see `PhotoCaptureModal`, 640px max
   * edge). Stored inline rather than as an attachment so it survives offline
   * sync the same way every other field does — a worklist that shows faces on
   * the ward but monograms in the field would be worse than monograms
   * everywhere. Absent for every account created before photos existed, which
   * is why every reader falls back to initials.
   */
  photoUrl?: string;
  /** Lightweight messaging presence/status (defaults to 'active' when unset). */
  presence?: StaffPresence;
  /**
   * First-run "Get Started" onboarding progress. Absent for users created
   * before the feature shipped — treated as "not yet started", so the
   * onboarding surfaces once and then records completion/dismissal here.
   * Stored on the (synced) user doc so progress follows the user across
   * devices.
   */
  onboarding?: OnboardingState;
}

export interface OnboardingState {
  /** Stable IDs of the checklist steps the user has finished. */
  completedStepIds: string[];
  /** Set when the user finishes every step. Hides the panel for good. */
  completedAt?: string;
  /** Set when the user explicitly skips setup. Hides the panel for good. */
  dismissedAt?: string;
  /** Whether the user minimised the panel to the launcher pill. */
  collapsed?: boolean;
}

export interface PatientDoc extends BaseDoc, Omit<Patient, 'id'> {
  type: 'patient';
  orgId?: string;
  /**
   * Patient-portal enrolment.
   *
   * `portalUsername` / `portalPasswordHash` (on `Patient`) are what the portal
   * login route reads. Nothing in the platform ever WROTE them — the only
   * account that had them was a seeded demo patient, so the portal was a
   * working front door with no way to issue a key. These fields are the
   * missing half: front-desk staff enrol a patient, which mints a single-use
   * activation token exactly like a staff invitation, and the patient chooses
   * their own password from it.
   */
  portalEnabledAt?: string;
  /** Who enrolled them, for the audit trail. */
  portalEnabledBy?: string;
  /** SHA-256 of the outstanding portal activation token, and its expiry. */
  portalInviteTokenHash?: string;
  portalInviteExpiresAt?: string;
  /** ISO timestamp of the patient's last portal sign-in; absent means never. */
  portalLastLoginAt?: string;
  /** Set when the portal account is suspended without deleting the credential
   *  (a disputed account, a shared phone, a request from the patient). */
  portalDisabledAt?: string;
  /** Medications review: clinician attested the patient takes no medications. */
  noKnownMedications?: boolean;
  /** Problems review: clinician attested the patient has no known problems. */
  noKnownProblems?: boolean;
  /** "Problem reconciliation performed" attestation (Include Problems popup). */
  problemReconciledAt?: string;
  /** Allergies review: clinician attested no known drug allergies (NKDA). */
  noKnownDrugAllergies?: boolean;
  /** Medication reconciliation status recorded in the Medications popup. */
  medReconciliation?: string;
  medReconciliationAt?: string;
  /**
   * Consent gate for viewing the patient's network medication history (their
   * prescriptions across facilities). PHI: viewing is recorded, not assumed —
   * the record keeps who obtained the answer and when, whichever way it went.
   */
  medHistoryConsent?: { granted: boolean; byId?: string; byName?: string; at: string };
}

/**
 * NAMING CONVENTION — "hospital" vs "facility":
 * The product UI uses the word **Facility** throughout. The data layer keeps
 * the historical `hospital*` identifiers (`HospitalDoc`, `hospitalsDB`,
 * `hospital-service`, `hospitalId`, `registrationHospital`) for backward
 * compatibility — renaming the persisted keys would require a data migration
 * across every synced DB and CouchDB remote, so they are intentionally left
 * as-is. Treat `hospitalId` / `facilityId` as synonyms (a facility = a
 * hospital record); prefer "facility" in user-facing copy, "hospital" in the
 * storage/types layer.
 */
export interface HospitalDoc extends BaseDoc, Omit<Hospital, 'id' | 'type'> {
  type: 'hospital';
  facilityType: Hospital['type'];
  facilityLevel?: FacilityLevel;  // boma | payam | county | state | national
  orgId?: string;
  /**
   * Whether the facility is still part of the organization's network.
   *
   * Retiring is a soft delete, never a document removal: admissions, visits,
   * bills and staff records all carry `hospitalId`, and deleting the facility
   * would orphan every one of them. A retired facility keeps its history, drops
   * out of the pickers new work is assigned through, and releases the
   * `maxHospitals` slot it was holding.
   *
   * `undefined` means active — every facility created before this field
   * existed, which is why every read tests `!== false` rather than `=== true`.
   */
  isActive?: boolean;
  /** When it was retired, and by whom — set together with `isActive: false`. */
  retiredAt?: string;
  retiredBy?: string;
}

/**
 * Per-patient context carried in a shift handoff, captured in SBAR form so the
 * oncoming nurse has structured situational awareness rather than free text.
 */
export interface HandoffPatientEntry {
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  priority?: 'RED' | 'YELLOW' | 'GREEN';
  /** SBAR */
  situation?: string;
  background?: string;
  assessment?: string;
  recommendation?: string;
  /** Outstanding tasks the oncoming shift must action. */
  tasks?: string[];
}

/**
 * A nurse shift handoff record. Persisted so the oncoming shift can retrieve
 * and acknowledge the previous shift's handoff (closing the loop), and so the
 * record survives reload/re-seed and syncs across devices.
 */
export interface ShiftHandoffDoc extends BaseDoc {
  type: 'shift_handoff';
  facilityId?: string;
  facilityName?: string;
  orgId?: string;
  /** Local date key (YYYY-MM-DD) + shift, used to detect duplicate sign-offs. */
  shiftDate: string;
  shift: 'day' | 'evening' | 'night';
  // Outgoing (signing) nurse
  outgoingNurseId: string;
  outgoingNurseName: string;
  // Oncoming nurse (free text at compose time; id filled on acknowledge)
  incomingNurseName?: string;
  incomingNurseId?: string;
  /** Shift-wide summary notes. */
  notes?: string;
  /** Structured per-patient SBAR + tasks. */
  patients: HandoffPatientEntry[];
  /** Snapshot of shift workload metrics at sign-off (real, not fabricated). */
  metrics?: {
    totalPatients?: number;
    critical?: number;
    overdueMar?: number;
    dueMar?: number;
  };
  signedAt: string;
  /** Lifecycle: signed by outgoing nurse, then acknowledged by oncoming nurse. */
  status: 'signed' | 'acknowledged';
  acknowledgedBy?: string;
  acknowledgedByName?: string;
  acknowledgedAt?: string;
}

/** Fluid balance (intake/output) captured during ward nursing rounds, in mL. */
export interface FluidBalance {
  oralIntakeMl?: number;
  ivIntakeMl?: number;
  urineOutputMl?: number;
  otherOutputMl?: number;
}

/**
 * Append-only amendment to a signed clinical document (P0.1).
 *
 * Once a record is signed it is locked against in-place edits; corrections and
 * additions are captured as addenda so the original signed content stays
 * immutable and the full clinical/legal history is preserved.
 */
export interface RecordAddendum {
  text: string;
  authorId?: string;
  authorName: string;
  authorRole?: string;
  createdAt: string;
}

export interface MedicalRecordDoc extends BaseDoc, Omit<MedicalRecord, 'id'> {
  type: 'medical_record';
  orgId?: string;
  /** Referential links to the documents created during this visit, so the
   *  record can be traced to the actual orders rather than only a snapshot. */
  encounterId?: string;
  triageId?: string;
  labOrderIds?: string[];
  prescriptionIds?: string[];
  /** Intake/output recorded with a nursing vitals observation (ward). */
  fluidBalance?: FluidBalance;

  /**
   * What kind of record this is. Absent is treated as 'consultation' for
   * backward compatibility. 'nursing_vitals' marks a standalone nurse vitals
   * snapshot so queues (e.g. the signing inbox) can exclude it structurally
   * rather than by matching the chief-complaint string.
   */
  recordKind?: 'consultation' | 'nursing_vitals';

  // --- Document signing & locking (P0.1) ------------------------------------
  /**
   * Document lifecycle. Absent is treated as 'draft' for backward
   * compatibility — legacy records remain editable until first signed.
   *  - 'draft'    : editable, not yet attested.
   *  - 'signed'   : attested and locked; clinical fields are immutable.
   *  - 'amended'  : signed and locked, with one or more addenda appended.
   *  - 'awaiting_cosign' : signed by a trainee, pending supervisor co-signature.
   */
  documentStatus?: 'draft' | 'signed' | 'amended' | 'awaiting_cosign';
  /** User id of the clinician who signed (attested) the document. */
  signedBy?: string;
  /** Display name captured at signing time (denormalised for the chart). */
  signedByName?: string;
  /** Role of the signer at signing time (e.g. doctor, clinical_officer). */
  signedByRole?: string;
  /** ISO timestamp the document was signed. */
  signedAt?: string;
  /** Co-signature (supervising provider) — see P0.2. */
  cosignedBy?: string;
  cosignedByName?: string;
  cosignedAt?: string;
  /** Append-only amendments made after signing. */
  addenda?: RecordAddendum[];
}

export interface ReferralDoc extends BaseDoc, Omit<Referral, 'id'> {
  type: 'referral';
  orgId?: string;
}

export interface LabResultDoc extends BaseDoc {
  type: 'lab_result';
  patientId: string;
  patientName: string;
  hospitalNumber: string;
  testName: string;
  specimen: string;
  status: 'pending' | 'in_progress' | 'completed';
  result: string;
  unit: string;
  referenceRange: string;
  abnormal: boolean;
  critical: boolean;
  orderedBy: string;
  /**
   * User `_id` of the ordering clinician. `orderedBy` is a free-text display
   * name; anything that must land on a specific user's worklist (e.g. the
   * critical-result task) needs this id, not the name.
   */
  orderedById?: string;
  /**
   * Modality discriminator: imaging studies share this doc type with lab
   * tests, and without it every CT scan renders as "Lab order".
   */
  orderKind?: 'lab' | 'imaging';

  // ── Imaging study detail (orderKind: 'imaging') ───────────────────────────
  // Studies run the same lifecycle as lab orders — they are the same order
  // store — but none of the specimen columns mean anything to a radiographer.
  // These carry what the reading room actually records, so a scan never has to
  // be filed as if it were a blood draw. All optional: lab orders never set
  // them, and imaging orders placed before this simply have none.

  /** X-Ray, Ultrasound, CT Scan, MRI, Fluoroscopy, Mammography … */
  modality?: string;
  /** Anatomy requested — "Chest", "Right knee", "Abdomen & pelvis". */
  bodyRegion?: string;
  /** Which side, where the region is paired. Left unset for midline studies. */
  laterality?: 'left' | 'right' | 'bilateral';
  contrast?: 'none' | 'oral' | 'iv' | 'both';
  /** Modality slot the study is booked into. */
  studyScheduledAt?: string;
  studyScheduledBy?: string;
  /**
   * Pre-scan screening. Radiation and contrast both have contraindications
   * that are only answerable before the patient is on the table, so the
   * answers are stamped on the order rather than asked again in the room.
   */
  safetyChecks?: {
    pregnancyStatus?: 'not_applicable' | 'excluded' | 'possible' | 'confirmed';
    contrastAllergy?: boolean;
    implantsOrDevices?: boolean;
    renalRisk?: boolean;
    consentGiven?: boolean;
    note?: string;
    checkedBy?: string;
    checkedAt?: string;
  };
  /** Acquisition — the study as actually performed. */
  acquiredAt?: string;
  acquiredBy?: string;
  /** Projections/sequences run, where they differ from what was requested. */
  technique?: string;
  imageCount?: number;
  /** PatientDocument ids for the films filed against this study. */
  studyDocumentIds?: string[];
  /** The report. `impression` is the answer to the clinical question; the
   *  coarse `result` field mirrors it so existing result readers still work. */
  findings?: string;
  impression?: string;
  reportedAt?: string;
  reportedBy?: string;
  /** Why a study had to be repeated (motion, positioning, patient unable). */
  repeatReason?: string;
  orderedAt: string;
  completedAt: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
  /** Optional clinical notes from the ordering clinician (symptoms, suspected Dx) */
  clinicalNotes?: string;
  /** Specimen handling traceability for the diagnostics bench. */
  accessionNumber?: string;
  specimenCollectedAt?: string;
  specimenCollectedBy?: string;
  specimenReceivedAt?: string;
  specimenReceivedBy?: string;
  specimenContainer?: string;
  specimenCondition?: 'acceptable' | 'hemolyzed' | 'clotted' | 'insufficient_quantity' | 'wrong_container' | 'unlabeled' | 'leaking' | 'delayed_transport' | 'other';
  specimenRejectionReason?: string;
  specimenRejectionNotes?: string;
  specimenRejectedAt?: string;
  specimenRejectedBy?: string;
  /** 'basic' = routine panel (CBC, urinalysis); 'special' = doctor-selected
   *  targeted investigation (cultures, ANA, vitamin D, etc.). */
  tier?: 'basic' | 'special';
  /** Granular diagnostics lifecycle stage (Stage 6 of the patient journey):
   *  ordered → specimen_collected → received_at_lab → in_process → resulted →
   *  reviewed_by_clinician → … . The coarse `status` field above is derived
   *  from this. Optional for backward-compatibility with older orders. */
  orderStatus?: LabOrderStatus;
  /**
   * Visit this test belongs to (KAN-72). Previously the link ran only the other
   * way — `MedicalRecordDoc.labOrderIds` / `EncounterDoc` pointed AT the lab
   * result — so a test ordered straight from the lab desk, with no consultation
   * behind it, had no anchor at all: unbillable and not attributable to a
   * facility encounter. Optional because orders created before this, and the
   * consultation path's own orders, are still reached through the record.
   */
  encounterId?: string;

  // ── Requisition detail captured by the Create Lab Order wizard ────────────
  // All optional: orders placed by the consultation path and by older builds
  // simply don't carry them, and every read site treats them as extra context
  // rather than something to branch on.

  /** Clinical urgency as ordered. The coarse `status` above still carries STAT
   *  into the queue; this keeps the ordered intent legible after the fact. */
  priority?: 'routine' | 'urgent' | 'stat';
  /** Coded indications (ICD-11) justifying the order — what the requisition
   *  answers, and what a payer or auditor asks for. */
  indications?: { code: string; title: string }[];
  /** Ask-at-Order-Entry answers (fasting state, recent antibiotics, pregnancy
   *  status before an X-ray …) captured with the order rather than chased. */
  aoeAnswers?: { question: string; answer: string }[];
  /** Fasting state declared at order entry. */
  fasting?: 'yes' | 'no' | 'unknown';
  /** Where/when the specimen is taken. */
  collectionTiming?: 'draw_now' | 'lab_collect' | 'future';
  /** Scheduled collection datetime when `collectionTiming` is 'future'. */
  scheduledCollectionAt?: string;
  /** Run at this facility or sent to a reference lab. */
  processing?: 'in_house' | 'send_out';
  /** Every test placed on one requisition shares this id, so the requisition
   *  can be reprinted and the group cancelled as a unit. */
  orderGroupId?: string;

  // ── Closing out the lifecycle ────────────────────────────────────────────
  // Who carried the result past `resulted`, and when. Without these the tail
  // of LAB_ORDER_TRANSITIONS was unreachable and every reported result
  // escalated against its review SLA for ever.

  /** Clinician who reviewed the reported value. */
  reviewedBy?: string;
  reviewedAt?: string;
  /** Clinician who acted on it — treatment changed, repeat ordered, referred. */
  actedUponBy?: string;
  actedUponAt?: string;
  /** Who told the patient, and when. */
  communicatedBy?: string;
  communicatedAt?: string;

  // ── Amendments ───────────────────────────────────────────────────────────

  /**
   * Set once a reported value has been corrected. A corrected result must be
   * visibly distinguishable from an original one — a clinician who acted on
   * the first value needs to know it moved. The audit log recorded the change
   * but nothing on the document did, so every read site showed an amended
   * result as though it had always said that.
   */
  amended?: boolean;
  amendedAt?: string;
  amendedBy?: string;
  /** What the value said before the correction, for the amendment note. */
  amendedFrom?: string;
  /** Why it changed — required by the amend form. */
  amendmentReason?: string;
}

export interface DiseaseAlertDoc extends BaseDoc, Omit<DiseaseAlert, 'id'> {
  type: 'disease_alert';
  orgId?: string;
  reportedBy?: string;
  /** Facility that reported the case. Feeds IDSR facilities-reporting counts. */
  hospitalId?: string;
  /** Patient the case belongs to — set on alerts auto-raised from a consultation; manual reports have none. */
  patientId?: string;
  /** ICD-11 code of the notifiable diagnosis behind this alert. */
  icd11Code?: string;
  /** MedicalRecordDoc the alert was raised from. (record, icd11Code) is the dedupe key that keeps re-saves from double-counting a case. */
  sourceRecordId?: string;
}

/**
 * One batch's contribution to a dispense. A single dispense can draw from
 * several batches when the earliest-expiring one cannot cover the full
 * quantity, so this is a list rather than a single batch reference.
 */
export interface DispenseAllocation {
  inventoryId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  /** Stock on that batch before this dispense — lets the ledger be replayed. */
  beforeBalance: number;
  afterBalance: number;
}

export interface PrescriptionDoc extends BaseDoc {
  type: 'prescription';
  patientId: string;
  patientName: string;
  medication: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  prescribedBy: string;
  /** Coarse status kept for backward compatibility + queue filters. Derived
   *  from the granular `orderStatus` below. */
  status: 'pending' | 'dispensed' | 'discontinued';
  /** Discontinuation — set when a clinician or patient reports stopping the medication. */
  stoppedAt?: string;
  stoppedReason?: string;
  stoppedBy?: string;
  stoppedByName?: string;
  /** Source of the stop: 'clinician' | 'patient_reported' */
  stoppedSource?: 'clinician' | 'patient_reported';
  /** Clinical indication (Reason for Rx), e.g. "1A40 · Malaria". */
  indication?: string;
  /** Prescriber allowed generic substitution at the pharmacy. */
  allowSubstitution?: boolean;
  /** Number of refills authorised (0 = none). */
  refills?: number;
  /** Date the prescription becomes effective (YYYY-MM-DD). */
  effectiveOn?: string;
  /** Free-text note to the dispensing pharmacy. */
  pharmacyInstructions?: string;
  /**
   * Medication criticality tier (Principle 2.11): 1 life-sustaining,
   * 2 important/time-sensitive, 3 routine. Stamped at prescribing time from
   * the formulary's ATC class unless the prescriber sets it explicitly — a
   * free-text order the catalogue does not carry can still be marked
   * life-sustaining, which the catalogue is not entitled to overrule.
   * Drives pharmacy queue priority and the Tier-1 checkout safety flag.
   */
  criticalityTier?: CriticalityTier;
  /** Granular pharmacy dispensing lifecycle (Stage 8): prescribed →
   *  received_in_pharmacy_queue → under_review → cleared_for_dispensing →
   *  dispensed → counseled → complete, plus stockout/held/recalled branches.
   *  Optional for backward-compatibility with older prescriptions. */
  orderStatus?: PrescriptionStatus;
  /** Links back to the consultation/encounter and record that ordered this
   *  prescription, so the pharmacy can trace it to its clinical context. */
  encounterId?: string;
  medicalRecordId?: string;
  /** Quantity (in dispensing units) the full course requires. Defaults to 1
   *  when not computed; the pharmacy decrements stock by this amount. */
  quantityToDispense?: number;
  /**
   * Quantity actually handed to the patient. Differs from `quantityToDispense`
   * on a partial fill (short stock), so the two must be recorded separately —
   * the prescribed course is a clinical decision, the dispensed amount is what
   * left the shelf and what the register must reconcile against.
   */
  quantityDispensed?: number;
  /**
   * Which batch(es) satisfied this dispense, in FEFO order. Required for a
   * recall: without it there is no way to answer "who received batch X?".
   */
  dispenseAllocations?: DispenseAllocation[];
  /** Identity of the pharmacist who performed the dispense. */
  dispensedBy?: string;
  dispensedByName?: string;
  /**
   * How the dispense resolved. `partial` and `stock_out` leave the order
   * active (`stockout_partial_referred`) so the balance can still be filled;
   * `clarification_requested` parks it on the prescriber.
   */
  dispenseOutcome?: 'full' | 'partial' | 'stock_out' | 'clarification_requested';
  /** Free-text reason recorded with a stock-out / clarification outcome. */
  dispenseNote?: string;
  /** Controlled-substance register entry proving the two-signature sign-off. */
  controlledLogId?: string;
  /** 'immediate' = emergency/stat med given before results (IV fluids, antipyretic,
   *  anticonvulsant); 'definitive' = started after diagnosis. */
  urgency?: 'immediate' | 'definitive';
  dispensedAt?: string;
  /**
   * Counselling, recorded at the `counseled` stage of the dispensing
   * lifecycle. Without these the stage was reachable but left no trace, so
   * "was this patient told how to take it?" had no answer on the record —
   * the same gap the lab had at the tail of its own lifecycle.
   */
  counselledAt?: string;
  counselledBy?: string;
  /** Which counselling points were covered, by key (see COUNSELLING_POINTS). */
  counselledPoints?: string[];
  counsellingNote?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
  /**
   * Active inpatient admission this prescription is administered against.
   * Set when the prescription belongs to an admitted patient so the MAR
   * (Medication Administration Record) can scope to a single admission.
   */
  admissionId?: string;
  /**
   * Bedside Medication Administration Record. Each entry is one nurse
   * actually giving (or refusing/missing) one scheduled dose. The
   * prescription itself is the order; this array is the legal record of
   * administration.
   */
  administrations?: MedicationAdministration[];
  /**
   * Problem this medication is pinned to (problem-oriented charting). When set,
   * the chart summary groups the medicine under the linked problem — e.g. a
   * chronic inhaler pinned to "Asthma". Denormalised label kept for display.
   */
  linkedProblemId?: string;
  linkedProblemLabel?: string;
}

/** One medication line inside an order set / clinical protocol. */
export interface OrderSetMedication {
  medication: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  instructions?: string;
  /** 'immediate' = give stat (emergency); 'definitive' = after diagnosis. */
  urgency?: 'immediate' | 'definitive';
  /** When true the dose is weight-based; `dose` holds the per-kg rule
   *  (e.g. "10 mg/kg") for the dosing calculator to expand. */
  weightBased?: boolean;
}

/**
 * Order set / clinical protocol — a reusable bundle of orders (labs +
 * medications + a treatment-plan note) for a presenting condition, e.g.
 * "Malaria — uncomplicated" or "ETAT — convulsing child". Encodes national /
 * WHO standard treatment guidelines so a clinician (or task-shifted clinical
 * officer) can place the guideline-concordant order set in one action.
 * Reference data: org-scoped, rarely edited.
 */
export interface OrderSetDoc extends BaseDoc {
  type: 'order_set';
  /** Display name, e.g. "Malaria — uncomplicated (adult)". */
  name: string;
  /** Grouping for the picker, e.g. 'malaria' | 'respiratory' | 'diarrhoea' |
   *  'maternal' | 'emergency' | 'general'. Free string for extensibility. */
  category: string;
  /** Guideline provenance shown to the clinician, e.g. "WHO IMCI", "ETAT",
   *  "South Sudan STG 2019". */
  source?: string;
  /** Who the protocol is for. */
  ageGroup?: 'adult' | 'paediatric' | 'neonatal' | 'all';
  description?: string;
  /** Suggested diagnoses to attach when the set is applied. */
  diagnoses?: { code?: string; label: string }[];
  /** Lab test names to order (should match the facility lab catalog; any
   *  unmatched name falls through as a custom lab). */
  labs?: string[];
  /** Medications to prescribe. */
  medications?: OrderSetMedication[];
  /** Treatment-plan / care-instructions text appended on apply. */
  planText?: string;
  /** Active sets show in the picker; inactive are retired without deletion. */
  isActive?: boolean;
  orgId?: string;
  hospitalId?: string;
}

/**
 * One row of the MAR — one nurse administering (or recording the absence
 * of) one scheduled dose. Append-only; corrections are recorded as new
 * entries with status='corrected' rather than mutating prior rows.
 */
export interface MedicationAdministration {
  /** Stable id within the prescription's administrations[] array */
  id: string;
  /** Scheduled dose time the row corresponds to (ISO datetime) */
  scheduledFor: string;
  /** When the dose was actually given / refused / missed (ISO datetime) */
  recordedAt: string;
  status: 'given' | 'missed' | 'refused' | 'held' | 'corrected';
  /** Actual dose given (e.g. "500mg") — defaults to prescription.dose */
  doseGiven?: string;
  /** Route used (po, iv, im, sc, etc.) — defaults to prescription.route */
  route?: string;
  /** Nurse / clinician who administered */
  administeredBy: string;
  administeredByName: string;
  /** Required for controlled substances (Schedule II–V) */
  witnessId?: string;
  witnessName?: string;
  /** Free-text reason when status is missed/refused/held */
  reason?: string;
  notes?: string;
  /**
   * Void marker — set when a mis-recorded administration is reversed. The row
   * is never deleted (append-only legal record); a voided entry no longer
   * satisfies its scheduled dose, so the slot returns to due/overdue.
   */
  voided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidedReason?: string;
}

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
  recordedBy?: string;
  recordedByName?: string;
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
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

export interface AuditLogDoc extends BaseDoc {
  type: 'audit_log';
  action: string;
  userId?: string;
  username?: string;
  details: string;
  ip?: string;
  success: boolean;
  orgId?: string;
  // ── Structured PHI-read fields (KAN-97) ──────────────────────────────
  // Previously every audit entry was a free-text `details` string, which is
  // fine for a human reading the log and useless for answering "who accessed
  // this patient's record?" — the question an access review actually asks.
  // Optional because write-audit entries and older rows don't carry them.
  /** Acting user's role at the time of access. */
  role?: string;
  /** Facility the actor was working at. */
  hospitalId?: string;
  /** Patient whose PHI was read — the field an access review pivots on. */
  patientId?: string;
  /** Document type read (e.g. 'lab_result', 'prescription'). */
  resourceType?: string;
  /** Specific document id, when the read was of one record. */
  resourceId?: string;
  /** API route or UI page the read came through. */
  route?: string;
  /** For search reads: the query string that produced the results. */
  query?: string;
  /** For search/list reads: how many records were returned. */
  resultCount?: number;
}

/** Product-analytics interaction event (not compliance audit). */
export type UsageEventName =
  | 'session_start'
  | 'session_end'
  | 'page_view'
  | 'click'
  | 'change';

export interface UsageEventDoc extends BaseDoc {
  type: 'usage_event';
  eventName: UsageEventName;
  /** Pathname with dynamic IDs templated (e.g. /patients/[id]). */
  path: string;
  /** Compact element descriptor or data-track value. */
  element?: string;
  userId?: string;
  username?: string;
  role?: string;
  orgId?: string;
  hospitalId?: string;
  sessionId: string;
  /** Client event timestamp (ISO). */
  ts: string;
  /** Small scrubbed metadata bag only — never PHI. */
  meta?: Record<string, unknown>;
}

/**
 * Sync-event outbox row — one written for every clinical mutation. Gives us
 * an auditable, queryable stream independent of PouchDB's internal _changes
 * feed. Matches the spec schema (event_id, resource_type, resource_version,
 * operation, occurred_at, sync_status).
 */
export interface SyncEventDoc extends BaseDoc {
  type: 'sync_event';
  /** Resource being changed (e.g. 'patient', 'medical_record', 'lab_result') */
  resourceType: string;
  /** PouchDB _id of the changed resource */
  resourceId: string;
  /** create | update | delete | archive */
  operation: 'create' | 'update' | 'delete' | 'archive';
  /** _rev of the resource AFTER the mutation — pairs with resourceId for traceability */
  resourceVersion?: string;
  /** When the mutation occurred (== createdAt for this row) */
  occurredAt: string;
  /** Authenticated user id */
  userId?: string;
  /** Authenticated username (for convenience) */
  username?: string;
  /** Facility / hospital id the mutation happened at */
  hospitalId?: string;
  /** Organization (tenant) id */
  orgId?: string;
  /** Country ISO-3166 alpha-2 (populated once countryId rollout lands) */
  countryId?: string;
  /** sync lifecycle: pending → syncing → synced | failed */
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed';
  /** Error message if syncStatus === 'failed' */
  syncError?: string;
  /** Optional compact payload for downstream consumers */
  payloadJson?: string;
}

/**
 * Conflict-queue row — populated when high-risk clinical data (allergies,
 * active medications, referrals, discharge status) has a PouchDB revision
 * conflict. An admin resolves each entry manually rather than letting
 * most-recent-rev-wins auto-merge them.
 */
export interface ConflictQueueDoc extends BaseDoc {
  type: 'conflict_queue';
  resourceType: string;
  resourceId: string;
  /** 'low' | 'medium' | 'high' — risk tier per spec */
  risk: 'low' | 'medium' | 'high';
  /** The winning revision PouchDB chose by default */
  winningRev: string;
  /** Competing revisions that were NOT chosen */
  losingRevs: string[];
  /** 'pending' | 'resolved' | 'dismissed' */
  status: 'pending' | 'resolved' | 'dismissed';
  /** User who resolved */
  resolvedBy?: string;
  resolvedAt?: string;
  /** Chosen winning rev after human resolution (may match or override winningRev) */
  resolvedRev?: string;
  /** Free-text note from the resolver */
  resolutionNote?: string;
  orgId?: string;
  countryId?: string;
}

export interface MessageDoc extends BaseDoc {
  type: 'message';
  /**
   * Recipient discriminator. Defaults to 'patient' for legacy messages
   * written before staff-to-staff messaging existed.
   */
  recipientType?: 'patient' | 'staff';
  /**
   * Direction of the message. Defaults to 'staff_to_patient' for legacy
   * documents written before this field existed. The patient-portal Chat
   * tab writes messages with direction === 'patient_to_staff'; staff-to-staff
   * messages use 'staff_to_staff'.
   */
  direction?: 'staff_to_patient' | 'patient_to_staff' | 'staff_to_staff';
  /**
   * Recipient identity. For backward compatibility the canonical fields stay
   * named patientId/Name/Phone; for staff recipients these hold the staff
   * member's id/name/phone and `recipientType` is 'staff'.
   */
  patientId: string;
  patientName: string;
  patientPhone: string;
  /** Optional staff metadata, populated when recipientType === 'staff'. */
  recipientRole?: string;
  recipientDepartment?: string;
  recipientHospitalId?: string;
  recipientHospitalName?: string;
  fromDoctorId: string;
  fromDoctorName: string;
  fromHospitalName: string;
  /**
   * Optional sender hospital id. Populated for patient_to_staff messages
   * (so facility scope filters can match) and for staff-authored messages
   * that have a known sender hospital.
   */
  fromHospitalId?: string;
  subject: string;
  body: string;
  channel: 'app' | 'sms' | 'both';
  /**
   * DELIVERY status — whether the message left the building. This is not a
   * triage state; an inbound patient enquiry that has been answered still
   * reads 'sent'. Front-desk triage lives in `enquiryStatus` below.
   */
  status: 'sent' | 'delivered' | 'failed';
  sentAt: string;
  /**
   * Front-desk triage state for an inbound patient enquiry
   * (`direction === 'patient_to_staff'`). Optional and absent on every
   * message written before enquiry triage existed — readers must treat
   * "absent" as 'new' (see `deriveEnquiryStatus` in services/enquiry-service).
   * Deliberately separate from `status`, which means delivery, not handling.
   */
  enquiryStatus?: 'new' | 'contacted' | 'appointment_scheduled' | 'closed';
  /** Staff member who owns this enquiry. Absent = unassigned. */
  enquiryAssignedToId?: string;
  enquiryAssignedToName?: string;
  /**
   * Set when the message was sent as patient education (the chart header's
   * "Patient education" action) — the chart's Documents ▸ Patient education
   * view lists these as material already delivered to the patient. A flag
   * rather than a subject match, so the classification survives the sender
   * editing the subject line.
   */
  patientEducation?: boolean;
  orgId?: string;
  /**
   * Internal staff chat: groups a message into a conversation thread.
   * Absent on legacy patient messages.
   */
  conversationId?: string;
  /** User ids who have read this message (staff chat read receipts). */
  readBy?: string[];
  /** Lightweight emoji reactions on a staff chat message. */
  reactions?: { emoji: string; userId: string }[];
  /** Id of the message this one is replying to (staff chat). */
  replyToId?: string;
  /** Soft-delete tombstone for staff chat ("This message was deleted"). */
  deleted?: boolean;
  /** Set when the author edits a message within the edit window. */
  editedAt?: string;
  /** File/image attachments (PDF, JPG, PNG — base64 encoded for offline-first sync). */
  attachments?: Array<{
    name: string;
    mimeType: string;
    base64Data: string;
    sizeBytes: number;
    phiWarningAcknowledged?: boolean;
  }>;
  /** PHI acknowledgement — true when sender confirmed content may contain patient data. */
  phiAcknowledged?: boolean;
  /**
   * SMS gateway delivery status, stamped after the provider call resolves.
   * Absent when the message was app-only or when the gateway hasn't yet
   * responded. Surfaced in the message UI as a delivery indicator.
   */
  smsResult?: {
    ok: boolean;
    providerId: string;
    providerMessageId?: string;
    error?: string;
  };
}

/**
 * Internal clinical note attached to a patient — staff-only.
 *
 * These live in their OWN database (tamamhealth_patient_notes), entirely
 * separate from MessageDoc, so they can never leak into any patient-facing
 * query (getMessagesByPatient and the patient portal only ever read the
 * messages DB). Patients never see these notes.
 */
export interface PatientNoteDoc extends BaseDoc {
  type: 'patient_note';
  patientId: string;
  body: string;
  authorId: string;
  authorName: string;
  authorRole?: string;
  orgId?: string;
  hospitalId?: string;
}

/**
 * Outcome-measure / intake assessment (P2.2) — a scored questionnaire (e.g.
 * PHQ-9) entered at check-in (front desk) and reviewed + signed by the provider.
 * Mirrors the Centricity "outcome measures" document: held as a draft, then
 * signed. The instrument definitions + scoring live in
 * lib/clinical/assessment-instruments.ts.
 */
export interface AssessmentDoc extends BaseDoc {
  type: 'assessment';
  patientId: string;
  patientName?: string;
  instrumentId: string;
  instrumentName: string;
  /** questionId → selected option value. */
  answers: Record<string, number>;
  totalScore: number;
  answeredCount: number;
  questionCount: number;
  /** Interpretation band label + severity at the (partial) total. */
  interpretation?: string;
  severity?: string;
  /** held = entered, awaiting provider review; signed = attested + locked. */
  documentStatus: 'held' | 'signed';
  enteredById?: string;
  enteredByName?: string;
  signedBy?: string;
  signedByName?: string;
  signedAt?: string;
  encounterId?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/**
 * Phone note (P1.4) — documents a patient call when the provider is unavailable,
 * routes it to a provider for response, and becomes a permanent part of the
 * chart. Mirrors the Centricity phone note.
 */
export interface PhoneNoteDoc extends BaseDoc {
  type: 'phone_note';
  patientId: string;
  patientName?: string;
  /** Who called (patient, relative, pharmacy, etc.). */
  callerName?: string;
  callerPhone?: string;
  subject: string;
  /** The question / reason for the call. */
  message: string;
  /** Provider the note is routed to for a response. */
  routedToId?: string;
  routedToName?: string;
  status: 'open' | 'responded' | 'closed';
  /** Provider's response (added when actioned). */
  response?: string;
  respondedById?: string;
  respondedByName?: string;
  respondedAt?: string;
  recordedById?: string;
  recordedByName?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/** Which clinical picker a favorite belongs to. */
export type FavoriteKind = 'diagnosis' | 'medication' | 'procedure';

/**
 * A per-clinician "favorite" — a one-tap shortcut to a diagnosis, medicine or
 * procedure the provider reaches for often. Stored one doc per (user, kind,
 * code) so toggling is idempotent and the picker can show stars instantly.
 * Personal/operational data: synced org-scoped so a clinician's favorites
 * follow them to any workstation, but never flows to national analytics.
 */
export interface ClinicalFavoriteDoc extends BaseDoc {
  type: 'clinical_favorite';
  /** Owning clinician. */
  userId: string;
  kind: FavoriteKind;
  /** Canonical code (ICD-10 / drug code / procedure code) — the identity key. */
  code: string;
  /** Human label shown in the picker. */
  label: string;
  /** Optional default dosing/instructions carried for medication favorites. */
  meta?: {
    dosage?: string;
    frequency?: string;
    durationDays?: number;
    price?: number;
    category?: string;
  };
  /** Usage counter — lets the UI sort favorites by how often they're used. */
  useCount?: number;
  hospitalId?: string;
  orgId?: string;
}

/**
 * A clinician-saved consultation template — a named bundle of diagnoses,
 * medicines, labs and plan text captured from a real visit and re-applied in
 * one click (HealthBridge "save this as a template … bronchitis adult"). Unlike
 * order sets (admin-curated reference protocols), these are personal and owned
 * by the clinician who saved them. Shapes mirror OrderSetDoc so the same merge
 * applies both. Synced org-scoped, excluded from national analytics.
 */
export interface ConsultationTemplateDoc extends BaseDoc {
  type: 'consultation_template';
  userId: string;
  name: string;
  diagnoses?: { code?: string; label: string }[];
  labs?: string[];
  medications?: OrderSetMedication[];
  planText?: string;
  useCount?: number;
  hospitalId?: string;
  orgId?: string;
}

/**
 * Category a scanned/uploaded chart document is filed under.
 *
 * Two of these also decide which view of the chart's Documents section a
 * document lands in: `referral_letter` files it under Referrals and
 * `patient_education` under Patient education. Everything else is a general
 * chart document.
 */
export type PatientDocumentCategory =
  | 'radiology' | 'lab_report' | 'referral_letter' | 'discharge_summary'
  | 'consent' | 'advance_directive' | 'legal_document' | 'treatment_agreement'
  | 'insurance' | 'id_document' | 'prescription' | 'scanned_record'
  | 'external_medical_record' | 'patient_education' | 'other';

/**
 * A scanned or uploaded document filed on the patient chart — radiology films,
 * a referral letter, an ID, a previous paper record, etc. The HealthBridge
 * "drop a PDF/photo, categorise it, filter on the timeline" capability. Stored
 * in its own database (not on the patient doc) so large base64 payloads don't
 * bloat patient reads. Facility-operational PHI; excluded from national
 * analytics.
 */
export interface PatientDocumentDoc extends BaseDoc {
  type: 'patient_document';
  patientId: string;
  title: string;
  category: PatientDocumentCategory;
  /** File payload + metadata (name, mimeType, base64Data, sizeBytes). */
  fileName: string;
  mimeType: string;
  base64Data: string;
  sizeBytes: number;
  note?: string;
  uploadedById?: string;
  uploadedByName?: string;
  hospitalId?: string;
  orgId?: string;
}

/** WHO-aligned malnutrition classification from MUAC + edema. */
export type NutritionStatus = 'SAM' | 'MAM' | 'At Risk' | 'Underweight' | 'Normal';

/**
 * A MUAC-based nutrition screening (child 6–59m or ANC mother), recorded by
 * nutrition staff. Feeds the nutrition dashboard and program reports.
 * Facility-operational PHI; org-scoped sync.
 */
export type NutritionFollowUpAction = 'needed' | 'followed_up' | 'referred' | 'treatment_started';

export interface NutritionScreeningDoc extends BaseDoc {
  type: 'nutrition_screening';
  /** Optional link to a registered patient (screenings may precede registration). */
  patientId?: string;
  patientName: string;
  /** Display age, e.g. '2y', '18m', '28w ANC'. */
  age: string;
  sex: string;
  /** Mid-upper-arm circumference in cm. */
  muac: number;
  weightKg?: number;
  heightCm?: number;
  /** Bilateral pitting edema (any grade ⇒ SAM). */
  edema: boolean;
  /** Pregnant/lactating (ANC) — uses the adult MUAC threshold. */
  isAnc: boolean;
  status: NutritionStatus;
  /** Free-text nutritionist notes (counselling, plan, observations). */
  notes?: string;
  /** Care follow-up after a flagged screening (SAM/MAM/at-risk). */
  followUpAction?: NutritionFollowUpAction;
  followUpAt?: string;
  /** yyyy-mm-dd. */
  screeningDate: string;
  screenedById?: string;
  screenedByName?: string;
  hospitalId?: string;
  orgId?: string;
}

export type ReminderChannel = 'sms' | 'whatsapp' | 'call' | 'in_person';
/**
 * `failed` is terminal (KAN-104): the gateway rejected this reminder on every
 * permitted attempt. Kept distinct from `queued` so staff can see the patient
 * was NOT reached — a delivery failure that leaves the reminder looking queued
 * is indistinguishable from one still waiting its turn, and a clinical recall
 * nobody chased is exactly the thing this queue exists to prevent.
 */
export type ReminderStatus = 'queued' | 'sent' | 'cancelled' | 'failed';

/**
 * A patient reminder queued to go out on a future date — e.g. "Come fasted in 3
 * weeks for your path tests." The HealthBridge "SMS the patient, queued and sent
 * a few days before" idea. NOTE: this app has no SMS gateway wired in, so this
 * is an honest reminder QUEUE that staff work from (and mark sent), not a claim
 * of automated delivery; a real gateway can later consume `status === 'queued'`
 * rows whose sendDate has arrived. Facility-operational; excluded from national
 * analytics.
 */
export interface PatientReminderDoc extends BaseDoc {
  type: 'patient_reminder';
  patientId: string;
  patientName?: string;
  message: string;
  /** Date the reminder should go out (yyyy-mm-dd). */
  sendDate: string;
  channel: ReminderChannel;
  status: ReminderStatus;
  createdById?: string;
  createdByName?: string;
  sentAt?: string;
  /** Gateway dispatch attempts so far (KAN-104). Absent means none. */
  attempts?: number;
  /** ISO timestamp of the most recent attempt — drives retry backoff. */
  lastAttemptAt?: string;
  /** Why the last attempt failed, surfaced to staff working the queue. */
  lastError?: string;
  hospitalId?: string;
  orgId?: string;
}

export type ClinicianTaskStatus = 'open' | 'completed';

/**
 * A clinician's personal to-do — the HealthBridge "tasks" / sticky-note
 * replacement: "phone John", "contact Dr Smith", with an optional reminder date
 * and patient link. Completed tasks are retained (not deleted) so the done list
 * stays visible. Owned by one user; synced org-scoped, excluded from national
 * analytics.
 */
export interface ClinicianTaskDoc extends BaseDoc {
  type: 'clinician_task';
  userId: string;
  title: string;
  description?: string;
  /** ISO date (yyyy-mm-dd) the task should resurface / is due. */
  dueDate?: string;
  status: ClinicianTaskStatus;
  priority?: 'low' | 'normal' | 'medium' | 'high';
  /** Optional patient this task is about. */
  patientId?: string;
  patientName?: string;
  completedAt?: string;
  hospitalId?: string;
  orgId?: string;
}

/**
 * An in-progress / paused clinical encounter (the consultation workflow state).
 * Lets a clinician order labs, pause the visit (status `awaiting_labs`), and
 * resume it once results return — driven by the clinical-flow state machine
 * (lib/clinical-flow/encounter-journey.ts). The `snapshot` carries the
 * consultation form draft so it can be resumed on any device. When the visit is
 * finalised, a normal `medical_record` is written and the encounter is closed.
 */
export interface EncounterDoc extends BaseDoc {
  type: 'clinical_encounter';
  patientId: string;
  patientName: string;
  hospitalNumber?: string;
  clinicianId: string;
  clinicianName: string;
  hospitalId: string;
  hospitalName?: string;
  /** Canonical encounter status (see ENCOUNTER_TRANSITIONS). */
  status: EncounterStatus;
  /** The journey stage the status belongs to. */
  stageKey: EncounterStageKey;
  /**
   * Append-only trail of every status change, with who moved it and why.
   *
   * The clinical-flow spec has always defined this (`EncounterTransitionRecord`
   * in encounter-types.ts) and the persisted document never carried it, so the
   * only record of a visit's path was a free-text line in the audit log. That
   * loses the two things a reviewer actually needs: WHY a patient was escalated
   * or left without being seen, and the ORDER of what happened — an audit log
   * is shared by every document type and cannot be read back per visit.
   *
   * Optional because encounters written before it exists have none; readers
   * must treat an absent trail as "unknown", never as "no transitions".
   * Mirrors `AppointmentDoc.statusHistory`, which solves the same problem.
   */
  statusHistory?: Array<{
    from: EncounterStatus | null;
    to: EncounterStatus;
    at: string;
    byUserId?: string;
    /** Required by the spec for escalations, aborts, refusals and overrides. */
    reason?: string;
  }>;
  /** Consultation form draft (chiefComplaint, vitals, diagnoses, labOrders, …). */
  snapshot: Record<string, unknown>;
  /**
   * Shape version of `snapshot`. Bump whenever the draft's structure changes
   * incompatibly, and add a migration step in `migrateEncounterSnapshot`.
   *
   * Why this exists: `snapshot` is `Record<string, unknown>` and is written by
   * one app version but resumed by another — a clinician can pause a visit,
   * the facility updates, and the encounter is resumed against a newer form.
   * Without a version stamp, structurally incompatible data is applied to the
   * current form fields silently. Absent/undefined means version 1 (every
   * document written before this field existed).
   */
  snapshotVersion?: number;
  /** Lab order doc ids created when the encounter was sent to the lab. */
  labOrderIds: string[];
  /** Triage record that fed this encounter, when the patient was triaged. */
  triageId?: string;
  startedAt: string;
  /** Set when the encounter is finalised into a medical_record. */
  medicalRecordId?: string;
  closedAt?: string;
  orgId?: string;
  /**
   * New case vs re-attendance, captured once at arrival (front desk or
   * auto-derived). See docs/EMR-FIELD-AUDIT-2026-07.md §3.
   */
  attendanceType?: 'new' | 'repeat';
  /** How the patient arrived — the encounter's front door. */
  arrivalChannel?: 'appointment' | 'walk_in' | 'referral';
  /**
   * The scheduled appointment this visit matched at check-in, when one
   * existed. Previously computed and discarded by check-in-service.ts.
   */
  appointmentId?: string;
  /**
   * Exam room the patient was placed in during rooming (KAN-99).
   *
   * Typed on the encounter rather than buried in `snapshot` because it is
   * operational state the rooming and clinician worklists both read — a value
   * inside the free-form snapshot cannot be queried or relied on to exist.
   */
  roomNumber?: string;
  /** Clinic/department the patient was routed to for this visit. */
  destinationClinic?: string;
  /** Who completed rooming, and when — the handoff to the clinician. */
  roomedByName?: string;
  roomedAt?: string;
}

export type ConsultationProgressStage =
  | 'new'
  | 'triage'
  | 'waiting_for_provider'
  | 'in_progress'
  | 'orders_pending'
  | 'follow_up_required'
  | 'completed'
  | 'cancelled';

export type ConsultationProgressTaskStatus = 'open' | 'in_progress' | 'blocked' | 'completed';

export interface ConsultationProgressTask {
  id: string;
  title: string;
  status: ConsultationProgressTaskStatus;
  ownerId?: string;
  ownerName?: string;
  ownerRole?: UserRole;
  dueAt?: string;
  priority: 'routine' | 'high' | 'urgent';
  blockedReason?: string;
  createdBy?: string;
  createdAt: string;
  completedAt?: string;
  completedBy?: string;
}

export interface ConsultationProgressMilestone {
  key: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  completedBy?: string;
  completedAt?: string;
  note?: string;
}

export interface ConsultationProgressEvent {
  id: string;
  kind: 'stage' | 'task' | 'milestone' | 'assignment' | 'note';
  message: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
  createdAt: string;
}

/** Shared operational progress state for a consultation. Clinical content
 * remains in MedicalRecordDoc; this document answers who owns the next step
 * and keeps the care team synchronized across stations and shifts. */
export interface ConsultationProgressDoc extends BaseDoc {
  type: 'consultation_progress';
  patientId: string;
  patientName: string;
  hospitalId: string;
  hospitalName?: string;
  orgId?: string;
  encounterId?: string;
  appointmentId?: string;
  currentStage: ConsultationProgressStage;
  ownerId?: string;
  ownerName?: string;
  ownerRole?: UserRole;
  priority: 'routine' | 'high' | 'urgent';
  nextAction?: string;
  dueAt?: string;
  blockedReason?: string;
  milestones: ConsultationProgressMilestone[];
  tasks: ConsultationProgressTask[];
  events: ConsultationProgressEvent[];
}

/**
 * Internal staff messaging conversation (direct message or group chat).
 * Patient communication keeps using flat MessageDocs scoped by patientId;
 * staff chat groups MessageDocs by `conversationId` pointing at one of these.
 */
export interface ConversationDoc extends BaseDoc {
  type: 'conversation';
  kind: 'dm' | 'group';
  /** Group name (groups only). DMs derive their title from the other participant. */
  name?: string;
  participantIds: string[];
  participantNames?: string[];
  createdByName?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  lastMessageFromName?: string;
  /** User ids who have pinned this conversation to the top of their list. */
  pinnedBy?: string[];
  /** User ids who have muted notifications for this conversation. */
  mutedBy?: string[];
  /** User ids who have archived this conversation out of their active list. */
  archivedBy?: string[];
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

/** Lightweight staff presence statuses surfaced next to avatars. */
export type StaffPresence = 'active' | 'busy' | 'away' | 'on_call' | 'in_clinic' | 'offline';

// ===== Birth & Death Registration (CRVS) =====
export interface BirthRegistrationDoc extends BaseDoc {
  type: 'birth';
  childFirstName: string;
  childSurname: string;
  childGender: 'Male' | 'Female';
  dateOfBirth: string;
  placeOfBirth: string;
  facilityId: string;
  facilityName: string;
  motherName: string;
  motherAge: number;
  motherNationality: string;
  fatherName: string;
  fatherNationality: string;
  birthWeight: number; // grams
  birthType: 'single' | 'twin' | 'multiple';
  deliveryType: 'normal' | 'caesarean' | 'assisted';
  attendedBy: string; // doctor/midwife/TBA/none
  registeredBy: string;
  state: string;
  county: string;
  certificateNumber: string;
  childPatientId?: string;
  motherPatientId?: string;
  /** ANC mother record id linked to this birth (if the mother had prenatal
   *  visits in the ANC module). Birth registration writes this back to all
   *  matching ANC visits via linkedBirthId. */
  linkedAncMotherId?: string;
  isDeleted?: boolean;
  orgId?: string;
}

export interface DeathRegistrationDoc extends BaseDoc {
  type: 'death';
  /** The visit during which the death occurred, when registered from one. */
  encounterId?: string;
  deceasedFirstName: string;
  deceasedSurname: string;
  deceasedGender: 'Male' | 'Female';
  dateOfBirth: string;
  dateOfDeath: string;
  ageAtDeath: number;
  placeOfDeath: string;
  facilityId: string;
  facilityName: string;
  // ICD-11 Cause of Death (WHO Medical Certificate format)
  immediateCause: string;         // Line a: immediate cause
  immediateICD11: string;         // ICD-11 code
  antecedentCause1: string;       // Line b: due to
  antecedentICD11_1: string;
  antecedentCause2: string;       // Line c: due to
  antecedentICD11_2: string;
  underlyingCause: string;        // Line d: underlying cause
  underlyingICD11: string;
  contributingConditions: string;
  contributingICD11: string;
  mannerOfDeath: 'natural' | 'accident' | 'intentional_self_harm' | 'assault' | 'pending_investigation' | 'unknown';
  maternalDeath: boolean;
  pregnancyRelated: boolean;
  certifiedBy: string;
  certifierRole: string;
  state: string;
  county: string;
  certificateNumber: string;
  deathNotified: boolean;
  deathRegistered: boolean;
  patientId?: string;
  isDeleted?: boolean;
  orgId?: string;
}

// ===== Health Facility Assessment =====
export interface FacilityAssessmentDoc extends BaseDoc {
  type: 'facility_assessment';
  facilityId: string;
  facilityName: string;
  assessmentDate: string;
  assessedBy: string;
  // Service readiness
  generalEquipmentScore: number;     // 0-100
  diagnosticCapacityScore: number;
  essentialMedicinesScore: number;
  infectionControlScore: number;
  // Infrastructure
  hasCleanWater: boolean;
  hasSanitation: boolean;
  hasWasteManagement: boolean;
  hasEmergencyTransport: boolean;
  hasCommunication: boolean;
  powerReliabilityScore: number;     // 0-100
  // Staffing adequacy
  staffingScore: number;             // 0-100
  hisStaffCount: number;
  hisStaffTrained: number;
  // Data management
  hasPatientRegisters: boolean;
  hasDHIS2Reporting: boolean;
  reportingCompleteness: number;     // 0-100
  reportingTimeliness: number;       // 0-100
  dataQualityScore: number;          // 0-100
  // Summary
  overallScore: number;              // 0-100
  state: string;
  recommendations: string;
  orgId?: string;
}

// ===== ICD-11 Common Codes Reference =====
export interface ICD11Code {
  code: string;
  title: string;
  chapter: string;
}

// ===== Immunization Tracker =====
export interface ImmunizationDoc extends BaseDoc {
  type: 'immunization';
  patientId: string;
  patientName: string;
  /** Visit/note that ordered the dose, when given from a consultation plan. */
  encounterId?: string;
  noteId?: string;
  gender: 'Male' | 'Female';
  dateOfBirth: string;
  vaccine: string; // BCG, OPV0-3, Penta1-3, PCV1-3, Rota1-2, Measles1-2, Yellow Fever, Vitamin A
  doseNumber: number;
  dateGiven: string;
  nextDueDate: string;
  facilityId: string;
  facilityName: string;
  state: string;
  administeredBy: string;
  batchNumber: string;
  site: 'left arm' | 'right arm' | 'left thigh' | 'right thigh' | 'oral';
  adverseReaction: boolean;
  adverseReactionDetails?: string;
  status: 'completed' | 'scheduled' | 'overdue' | 'missed';
  orgId?: string;
}

// ===== ANC (Antenatal Care) Module =====
export interface ANCVisitDoc extends BaseDoc {
  type: 'anc_visit';
  motherId: string;
  patientId?: string;
  motherName: string;
  motherAge: number;
  gravida: number;
  parity: number;
  visitNumber: number; // 1-8 (WHO recommends 8 contacts)
  visitDate: string;
  gestationalAge: number; // weeks
  facilityId: string;
  facilityName: string;
  state: string;
  bloodPressure: string;
  weight: number;
  fundalHeight: number;
  fetalHeartRate: number;
  hemoglobin: number;
  urineProtein: string;
  bloodGroup: string;
  rhFactor: string;
  hivStatus: string;
  malariaTest: string;
  syphilisTest: string;
  ironFolateGiven: boolean;
  tetanusVaccine: boolean;
  iptpDose: number;
  riskFactors: string[];
  riskLevel: 'low' | 'moderate' | 'high';
  birthPlan: { facility: string; transport: string; bloodDonor: string };
  nextVisitDate: string;
  notes: string;
  attendedBy: string;
  attendedByRole: string;
  orgId?: string;
  /** Set when the mother gives birth and the birth registration links back
   *  to this ANC visit. Lets the ANC module display "Delivered" status and
   *  lets the birth module surface the prenatal history. */
  linkedBirthId?: string;
  isDeleted?: boolean;
}

// ===== Triage (ETAT — Emergency Triage Assessment & Treatment) =====
// Captures the WHO ETAT ABCC assessment plus vitals taken at triage.
// One record per triage encounter; a patient may have many over time.
export type TriagePriority = 'RED' | 'YELLOW' | 'GREEN';
export type TriageDisposition = 'emergency' | 'general_clinic' | 'specialty_clinic' | 'home_care';
export type TriageHandoffStatus = 'awaiting_room' | 'awaiting_provider' | 'assigned' | 'acknowledged' | 'in_consultation' | 'completed';

export interface TriageDoc extends BaseDoc {
  type: 'triage';
  patientId: string;
  patientName: string;
  /**
   * Where this walk-in sits on the front desk's visit ladder (the same
   * vocabulary a booked appointment uses: arrived → checked_in → in_progress →
   * completed). Kept separate from `status`, which is triage's own clinical
   * state — a desk clerk moving someone to "Checked Out" must not silently
   * rewrite the ETAT record. Absent on older docs; the queue stage stands in.
   */
  visitStatus?: AppointmentStatus;
  hospitalNumber?: string;
  // ETAT ABCC. 'not_assessed' means exactly that — no clinician has examined
  // this dimension yet (e.g. a clerical check-in). It must never be defaulted
  // to a normal-looking value: fabricated ETAT was a KAN-100 record-integrity
  // finding.
  airway: 'clear' | 'obstructed' | 'not_assessed';
  breathing: 'normal' | 'distressed' | 'absent' | 'not_assessed';
  circulation: 'normal' | 'impaired' | 'absent' | 'not_assessed';
  consciousness: 'alert' | 'verbal' | 'pain' | 'unresponsive' | 'not_assessed';
  priority: TriagePriority;
  /**
   * Who produced the ABCC values (KAN-100): a clinician running the ETAT
   * decision tree, or clerical check-in (which records 'not_assessed' ABCC and
   * only the clerk-selected acuity). Absent on records created before the
   * field existed — treat those as unknown provenance, not as clinical.
   */
  assessmentSource?: 'clinician' | 'clerical_checkin';
  // Vitals captured at triage (optional — string for partial entry)
  temperature?: string;
  pulse?: string;
  respiratoryRate?: string;
  systolic?: string;
  diastolic?: string;
  oxygenSaturation?: string;
  weight?: string;
  painScore?: string;       // 0–10 numeric rating scale
  bloodGlucose?: string;    // mmol/L
  gcs?: string;             // Glasgow Coma Scale 3–15
  muac?: string;            // mid-upper arm circumference, cm
  /** Highest priority recommended after combining ABCC with vital warnings. */
  vitalUrgencyRecommendation?: TriagePriority;
  /** Clinical warning snapshot shown to the nurse when this record was saved. */
  vitalUrgencyWarnings?: Array<{
    field: string;
    code: string;
    urgency: 'RED' | 'YELLOW';
    message: string;
  }>;
  /** True only when the nurse deliberately saved below the recommendation. */
  vitalUrgencyOverridden?: boolean;
  /** Mandatory clinical rationale whenever vitalUrgencyOverridden is true. */
  vitalUrgencyOverrideReason?: string;
  // Context
  chiefComplaint?: string;
  notes?: string;
  modeOfArrival?: 'walk-in' | 'ambulance' | 'referral' | 'police' | 'other' | '';
  symptomDuration?: string;   // free text, e.g. "2 days"
  referralSource?: string;    // referring facility / person
  knownAllergies?: string;    // free text; "" / "None known" when none
  /** Clinical destination selected by the triage nurse. */
  disposition?: TriageDisposition;
  destinationClinic?: string;
  assignedProviderId?: string;
  assignedProviderName?: string;
  handoffStatus?: TriageHandoffStatus;
  handoffNote?: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  acknowledgedByName?: string;
  // Audit
  triagedBy: string;       // user id
  triagedByName: string;   // display name at time of triage
  triagedAt: string;       // ISO datetime (distinct from createdAt to allow backfill)
  facilityId?: string;
  facilityName?: string;
  orgId?: string;
  // Follow-through. 'lwbs' = left without being seen (terminal; pairs with the
  // encounter-level lwbs transition, KAN-100).
  status: 'pending' | 'seen' | 'admitted' | 'discharged' | 'referred' | 'lwbs';
  /**
   * OPD rooming: the exam room / bay the patient has been placed in to meet
   * the provider (e.g. "Room 3", "Bay B"). Set by front-desk/rooming staff.
   * Optional — only walk-in (triage-sourced) queue entries carry this.
   */
  assignedRoom?: string;
  handoffTo?: string;      // clinician id who took over
  handoffToName?: string;
  handoffAt?: string;
  /** The visit this triage belongs to — set by check-in-service.ts at arrival. */
  encounterId?: string;
}

// ===== Pharmacy Inventory =====
// One row per SKU per facility. The stock level decrements when a
// prescription is dispensed and increments when a receipt is recorded.
export interface PharmacyInventoryDoc extends BaseDoc {
  type: 'pharmacy_inventory';
  hospitalId: string;
  hospitalName: string;
  medicationName: string;
  category: string;
  stockLevel: number;
  unit: string;                      // tablets, vials, bottles, sachets, tubes
  reorderLevel: number;              // when to reorder
  batchNumber: string;
  expiryDate: string;                // YYYY-MM-DD
  lastReceived?: string;             // ISO datetime of last stock-in
  lastDispensed?: string;            // ISO datetime of last decrement
  dispensedToday: number;
  /**
   * The Juba clinical day `dispensedToday` counts. Writers reset the counter
   * when this rolls over; readers must treat the counter as 0 when this is
   * not today (see `dispensedTodayOf` in pharmacy-inventory-service). Without
   * it the field was a LIFETIME total wearing a per-day label — by day 30 the
   * "today" figure was a month's cumulative dispensing, and the days-of-stock
   * indicator it fed was understated ~30×. Absent on docs written before
   * 2026-08, which correctly makes their stale totals read as "not tracked".
   */
  dispensedTodayDate?: string;
  /**
   * Drug control schedule. Schedule II/III/IV require two-staff
   * witness sign-off on every movement (intake, dispense, waste).
   * Sourced from the South Sudan Drug & Food Control Authority list.
   */
  controlledSchedule?: 'I' | 'II' | 'III' | 'IV' | 'V';
  /** When true, dispense flow forces a witness staff selection. */
  requiresWitness?: boolean;
  orgId?: string;
}

/**
 * Audit log entry for every controlled-substance movement.
 * Two staff signatures (operator + witness) are mandatory by SSDFCA rules.
 */
export interface ControlledSubstanceLogDoc extends BaseDoc {
  type: 'controlled_substance_log';
  inventoryId: string;
  medicationName: string;
  schedule: 'I' | 'II' | 'III' | 'IV' | 'V';
  movement: 'intake' | 'dispense' | 'waste' | 'reconciliation' | 'transfer';
  quantity: number;
  unit: string;
  beforeBalance: number;
  afterBalance: number;
  patientId?: string;        // for dispense
  patientName?: string;
  prescriptionId?: string;
  // Two-signature audit
  operatorId: string;
  operatorName: string;
  witnessId: string;
  witnessName: string;
  reason?: string;
  facilityId: string;
  facilityName: string;
  orgId?: string;
}

// ===== Follow-Up Tracking =====
export interface FollowUpDoc extends BaseDoc {
  type: 'follow_up';
  patientId: string;
  patientName: string;
  /** The visit that asked for this follow-up. */
  encounterId?: string;
  /** Facility that owns the follow-up — without it filterByScope can only narrow to org. */
  hospitalId?: string;
  geocodeId?: string;
  assignedWorker: string;        // Health worker responsible
  assignedWorkerName: string;
  status: 'active' | 'completed' | 'missed' | 'lost_to_followup';
  outcome?: 'recovered' | 'died' | 'referred' | 'under_treatment';
  condition: string;
  facilityLevel: FacilityLevel;
  scheduledDate: string;
  completedDate?: string;
  notes?: string;
  state: string;
  county: string;
  sourceVisitId?: string;
  orgId?: string;
}

// ===== Five-Level Facility Hierarchy (South Sudan Health System) =====
export type FacilityLevel = 'boma' | 'payam' | 'county' | 'state' | 'national';

export interface FacilityLevelConfig {
  level: FacilityLevel;
  name: string;
  description: string;
  diagnosisCapability: 'suspected' | 'clinical' | 'definitive' | 'specialist';
  exampleFacility: string;
}

export const FACILITY_LEVELS: FacilityLevelConfig[] = [
  {
    level: 'boma',
    name: 'Boma (Village)',
    description: '40 households per Boma health worker. Most basic care, referrals up.',
    diagnosisCapability: 'suspected',
    exampleFacility: 'Community Health Post',
  },
  {
    level: 'payam',
    name: 'Payam (Sub-county)',
    description: 'Primary Health Care Units (PHCUs). Basic diagnoses and treatments.',
    diagnosisCapability: 'clinical',
    exampleFacility: 'Primary Health Care Unit',
  },
  {
    level: 'county',
    name: 'County',
    description: 'County hospitals with more advanced care, lab, and pharmacy.',
    diagnosisCapability: 'definitive',
    exampleFacility: 'County Hospital',
  },
  {
    level: 'state',
    name: 'State',
    description: 'State general hospitals with specialist services.',
    diagnosisCapability: 'specialist',
    exampleFacility: 'Wau State Hospital',
  },
  {
    level: 'national',
    name: 'National',
    description: 'Teaching hospitals with highest level of care and training.',
    diagnosisCapability: 'specialist',
    exampleFacility: 'Juba Teaching Hospital',
  },
];


// ===== Organization (Multi-Tenant) =====
export interface OrganizationDoc extends BaseDoc {
  type: 'organization';
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor?: string;
  subscriptionStatus: 'trial' | 'active' | 'suspended' | 'cancelled';
  subscriptionPlan: 'basic' | 'professional' | 'enterprise';
  maxUsers: number;
  maxHospitals: number;
  featureFlags: {
    epidemicIntelligence: boolean;
    mchAnalytics: boolean;
    dhis2Export: boolean;
    communityHealth: boolean;
    facilityAssessments: boolean;
  };
  orgType: 'public' | 'private';
  /**
   * The staff roles this organization actually staffs, chosen by the platform
   * super-admin when the organization is created.
   *
   * Absent (the default, and every organization created before this field) means
   * "no restriction" — the org admin may hand out every role its `orgType`
   * allows. It is a scoping convenience, NOT a security boundary: the API
   * re-checks what an actor may assign regardless of what is listed here, so a
   * stale or hand-edited list cannot widen anyone's privileges.
   */
  enabledRoles?: UserRole[];
  contactEmail: string;
  country: string;
  isActive: boolean;
  /** Screen lock timeout in minutes (default 1). Set by org admin. */
  lockTimeoutMinutes?: number;
  /** App language for this organization's facilities. Set by org admin / hospital head. */
  locale?: string;
  /**
   * Free-text, multi-line bank-transfer instructions shown to patients in the
   * payment portals (bank name / account number / branch / reference
   * instructions). When unset, the portals fall back to a "contact billing"
   * placeholder rather than displaying a fabricated account. Set by the org
   * admin on the branding page.
   */
  bankDetails?: string;
}

export interface PlatformConfigDoc extends BaseDoc {
  /**
   * When a backup was last reported as completed (KAN-117).
   *
   * Written by the backup job through `recordBackupCompleted`, never by the
   * UI. Absent means no backup has been reported — which the status service
   * reports as `unknown`, NOT as overdue or healthy.
   */
  lastBackupAt?: string;

  type: 'platform_config';
  platformName: string;
  maintenanceMode: boolean;
  globalFeatureFlags: {
    signupsEnabled: boolean;
    trialDays: number;
    maxOrganizations: number;
  };
  defaultPrimaryColor: string;
  defaultSecondaryColor: string;
  superAdminPolicies?: {
    passwordMinLength: number;
    sessionTimeoutMinutes: number;
    emergencyAccessEnabled: boolean;
    emergencyAccessReviewHours: number;
    impersonationEnabled: boolean;
    impersonationMaxMinutes: number;
    dualApprovalForHighRisk: boolean;
    auditRetentionYears: number;
    phiExportRequiresReason: boolean;
    dataDeletionRequiresApproval: boolean;
    ssoEnabled: boolean;
    apiKeysEnabled: boolean;
    backupRpoHours: number;
    backupRtoHours: number;
    supportAccessRequiresTicket: boolean;
  };
}

/**
 * An operator's record that a risk signal has been dealt with.
 *
 * The Risk Center derives its queue from live signals — a failed audit entry, a
 * pending conflict, a suspended tenant, an overdue backup. Nothing in those
 * sources can say "someone looked at this and fixed it", so before this
 * existed the only way to clear a row was for the underlying data to change,
 * and rows that never change (a login failure last Tuesday) sat in the queue
 * until they aged out. This document is that missing acknowledgement.
 *
 * Stored in `tamamhealth_platform_config` beside the platform config and the
 * backup marker: it is global operational state read by the same admin
 * screens, not tenant data, and it needs no database of its own.
 */
export interface RiskResolutionDoc extends BaseDoc {
  type: 'risk_resolution';
  /** The derived row's stable id — `audit-<id>`, `continuity-backup-overdue`. */
  riskId: string;
  /**
   * Which occurrence of the signal was resolved.
   *
   * Event-shaped risks (an audit failure, a conflict) carry a document id that
   * never recurs, so their signature is the id itself. Condition-shaped risks
   * (backup overdue, maintenance mode, a suspended tenant) reuse one id every
   * time they occur, so their signature is the state that was true when the
   * operator resolved it. When the condition returns in a different state the
   * signature no longer matches and the row reopens by itself, rather than
   * staying silently suppressed by a resolution from weeks ago.
   */
  signature: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: string;
  /** Copied from the row so the resolved list reads without re-deriving it. */
  signal: string;
  /** What was done about it. Optional — an operator may just acknowledge. */
  note?: string;
  resolvedAt: string;
  resolvedById?: string;
  resolvedByName?: string;
}

// ===== Staff Scheduling =====
export interface StaffScheduleDoc extends BaseDoc {
  type: 'staff_schedule';
  userId: string;
  userName: string;
  role: string;
  facilityId: string;
  facilityName: string;
  shiftType: 'morning' | 'afternoon' | 'night' | 'on_call';
  shiftDate: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  department?: string;
  isOnCall: boolean;
  notes?: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'absent' | 'swapped';
  swappedWith?: string; // userId of swap partner
  orgId?: string;
}

// ===== Provider Availability (bookable windows for appointments) =====
/**
 * Kept as a single-member union rather than deleted outright: availability rows
 * already carry a modality, and widening a stored value to nothing would make
 * every existing document fail validation. Every visit is in person now.
 */
export type AvailabilityModality = 'in_person';
export type AvailabilityStatus = 'open' | 'partially_booked' | 'full' | 'cancelled';

export interface AvailabilityDoc extends BaseDoc {
  type: 'availability';
  providerId: string;
  providerName: string;
  facilityId: string;
  facilityName: string;
  date: string;            // YYYY-MM-DD
  startTime: string;       // HH:MM (24h)
  endTime: string;         // HH:MM (24h)
  slotMinutes: number;     // length of each bookable slot
  modality: AvailabilityModality;
  department?: string;
  notes?: string;
  status: AvailabilityStatus;
  orgId?: string;
  payam?: string;

  // ── Online booking (all optional; absent fields read as the old behaviour) ──
  /**
   * Weekly recurrence. When set, `date` is the first day of the series and the
   * window repeats on `daysOfWeek` until `until`.
   *
   * Without this a clinic running Mon–Fri needs ~260 rows per provider per
   * year, which is why availability was only ever filled in for demo days.
   */
  recurrence?: {
    /** 0 = Sunday … 6 = Saturday. */
    daysOfWeek: number[];
    until: string;                 // YYYY-MM-DD, inclusive
    /** Dates in range that are skipped (leave, holiday, conference). */
    exceptions?: string[];
  };
  /** Restrict this window to specific visit reasons. Empty/unset = all. */
  visitReasonIds?: string[];
  /** Restrict to new or returning patients. Unset = both. */
  patientClass?: 'new' | 'returning';
  /** Concurrent bookings per slot. Unset = the facility policy default. */
  capacity?: number;
  /** Exam room this window occupies, for room-level conflict checking. */
  roomId?: string;
  /**
   * Offered to patients booking themselves.
   *
   * Opt-in, not opt-out: an unset value means NO on the public channel. A
   * window recorded before online booking existed was never reviewed for
   * public exposure, and the seeded 00:00–23:59 demo windows would otherwise
   * advertise a 24-hour clinic. Staff booking ignores this flag.
   */
  bookableOnline?: boolean;
}

// ===== Announcements (broadcast notices to staff) =====
export type AnnouncementAudience = 'organization' | 'facility' | 'role';
export type AnnouncementPriority = 'normal' | 'important' | 'urgent';

export interface AnnouncementDoc extends BaseDoc {
  type: 'announcement';
  title: string;
  body: string;
  audience: AnnouncementAudience;
  /** When audience === 'role', the roles this announcement targets. */
  targetRoles?: UserRole[];
  priority: AnnouncementPriority;
  authorId: string;
  authorName: string;
  facilityId?: string;
  facilityName?: string;
  /** Optional auto-expiry (ISO). After this the announcement is hidden. */
  expiresAt?: string;
  /** User IDs that have dismissed this announcement. */
  dismissedBy?: string[];
  orgId?: string;
  payam?: string;
}

// ===== Account requests =====
/**
 * Someone asking to be given an account, from the public request form.
 *
 * This is a *claim*, never an identity: every field is typed by an
 * unauthenticated stranger and is shown to the approver as such. Nothing here
 * grants access — approval calls the same `createUser` an admin uses by hand,
 * with the same role guards, so a request cannot mint an account the approver
 * could not have created themselves.
 */
export interface AccountRequestDoc extends BaseDoc {
  type: 'account_request';
  fullName: string;
  email: string;
  phone?: string;
  requestedRole: UserRole;
  /** The organisation and facility the requester says they belong to. */
  orgId?: string;
  orgName?: string;
  hospitalId?: string;
  hospitalName?: string;
  /** Why they need access — free text, shown to the approver. */
  note?: string;
  /**
   * Who is allowed to decide this, derived on the server from the requested
   * role and organisation. Never accepted from the client: it is the whole
   * authorization decision, and a requester who could set it would choose
   * their own approver.
   */
  approverTier: 'super_admin' | 'org_admin';
  status: AccountRequestStatus;
  decidedBy?: string;
  decidedByName?: string;
  decidedAt?: string;
  /** Reason shown on rejection, or a note recorded on approval. */
  decisionNote?: string;
  /** Username minted when approved, so the request records what it produced. */
  createdUsername?: string;
  /**
   * Proof that whoever filled the form can read the mailbox they named.
   *
   * The form is the only place someone outside the organisation can start a
   * process that ends in prescribing rights, and every field in it was
   * self-asserted with nothing checked. An unverified request is still
   * recorded — losing it would just move the problem — but it does not reach
   * an approver's queue, so approver attention is spent only on people who
   * have at least demonstrated control of the address.
   */
  emailVerifiedAt?: string;
  /** SHA-256 of the outstanding verification token, and when it lapses. The
   *  raw token is emailed and never stored — same construction as the account
   *  invitation in `lib/user-invite.ts`. */
  verificationTokenHash?: string;
  verificationExpiresAt?: string;
  /**
   * Council / board registration number, for roles that require one.
   *
   * Free text, and deliberately NOT validated against a format: the South
   * Sudan Medical & Dental Council and the Nursing & Midwifery Council issue
   * numbers in shapes that have changed over the years, and rejecting a real
   * clinician's real number because it does not match a regex would be worse
   * than storing it as typed. It exists to be CHECKED BY A HUMAN against the
   * register, which is what the attestation below records.
   */
  professionalRegistrationNumber?: string;
  /** How the approver satisfied themselves this is who they say they are.
   *  Required on approval — see `IDENTITY_ATTESTATION_METHODS`. */
  identityAttestation?: string;
}

export type AccountRequestStatus = 'pending' | 'approved' | 'rejected';

// ===== Blood Bank Management =====
export interface BloodBankDoc extends BaseDoc {
  type: 'blood_bank';
  unitId: string;
  bloodGroup: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  component: 'whole_blood' | 'packed_rbc' | 'platelets' | 'ffp' | 'cryoprecipitate';
  volume: number; // ml
  collectionDate: string;
  expiryDate: string;
  donorId?: string;
  donorName?: string;
  status: 'available' | 'reserved' | 'crossmatched' | 'transfused' | 'expired' | 'discarded';
  facilityId: string;
  facilityName: string;
  reservedForPatient?: string;
  crossmatchResult?: 'compatible' | 'incompatible' | 'pending';
  transfusedTo?: string;
  transfusedAt?: string;
  transfusedBy?: string;
  screeningResults?: {
    hiv: boolean;
    hepatitisB: boolean;
    hepatitisC: boolean;
    syphilis: boolean;
    malaria: boolean;
  };
  notes?: string;
  orgId?: string;
}

// ===== Appointment Booking (Payam Level & Above) =====
/**
 * Where a booking sits on the front desk's ladder. `src/lib/appointment-status.ts`
 * owns the order, labels and groupings — including that `in_progress` is shown
 * as "Roomed" and `completed` as "Checked Out" (the stored names predate that
 * vocabulary and are load-bearing in the analytics pipeline).
 *
 * `requested` comes from the patient portal, not the desk: a patient asking for
 * a slot they have not been given yet.
 */
export type AppointmentStatus =
  | 'requested' | 'scheduled' | 'reminder_sent' | 'confirmed' | 'arrived'
  // `triaged` sits between check-in and the room: the nurse has assessed the
  // patient (ETAT/ABCC + vitals) and they are waiting to be roomed. Before it
  // existed a triaged patient still read "Checked In", so the ward board could
  // not tell who had been assessed from who was still waiting for a nurse.
  | 'checked_in' | 'triaged' | 'in_progress' | 'completed'
  | 'cancelled' | 'no_show' | 'rescheduled';
export type AppointmentType = 'general' | 'follow_up' | 'specialist' | 'anc' | 'immunization' | 'lab' | 'surgical' | 'dental' | 'mental_health' | 'walk_in';
export type AppointmentPriority = 'routine' | 'urgent' | 'emergency';
/**
 * Which door the booking came in through. Absent on rows written before online
 * booking existed, which are all staff-booked.
 *
 * `portal` — the signed-in patient portal.
 * `public_widget` — the practice's own website (embedded widget) or link.
 * `directory` — a provider's public profile page.
 */
export type AppointmentSource = 'staff' | 'portal' | 'public_widget' | 'directory';

export interface AppointmentDoc extends BaseDoc {
  type: 'appointment';
  patientId: string;
  patientName: string;
  patientPhone?: string;
  providerId: string;         // Doctor/clinical officer assigned
  providerName: string;
  facilityId: string;
  facilityName: string;
  facilityLevel: FacilityLevel;
  // Scheduling
  appointmentDate: string;    // YYYY-MM-DD
  appointmentTime: string;    // HH:MM (24h)
  endTime?: string;           // HH:MM estimated end
  duration: number;           // minutes
  appointmentType: AppointmentType;
  priority: AppointmentPriority;
  /** Second staff member on the visit (rooming nurse, interpreter, scribe). */
  staffId?: string;
  staffName?: string;
  /** Exam room or bay this visit is booked into. */
  room?: string;
  department: string;
  // Clinical context
  reason: string;             // Chief complaint or reason for visit
  notes?: string;
  referralId?: string;        // If appointment was created from a referral
  previousAppointmentId?: string; // For follow-up chain
  // Status tracking
  status: AppointmentStatus;
  cancelledReason?: string;
  cancelledBy?: string;
  cancelledByName?: string;
  cancelledAt?: string;
  confirmedAt?: string;
  confirmedBy?: string;
  confirmedByName?: string;
  checkedInAt?: string;
  checkedInBy?: string;
  checkedInByName?: string;
  startedAt?: string;
  startedBy?: string;
  startedByName?: string;
  completedAt?: string;
  completedBy?: string;
  completedByName?: string;
  noShowAt?: string;
  noShowBy?: string;
  noShowByName?: string;
  statusHistory?: Array<{
    from: AppointmentStatus;
    to: AppointmentStatus;
    at: string;
    by?: string;
    byName?: string;
    note?: string;
    automated?: boolean;
  }>;
  // Reminders
  reminderSent: boolean;
  reminderChannel?: 'sms' | 'app' | 'both';
  // Recurrence (for regular follow-ups)
  isRecurring: boolean;
  recurrencePattern?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  recurrenceEndDate?: string;
  // Administrative
  bookedBy: string;
  bookedByName: string;
  state: string;
  county?: string;
  orgId?: string;

  // ── Online booking (all optional; absent = staff-booked, the old shape) ──
  /** Where the booking came from. Absent on every pre-existing row. */
  source?: AppointmentSource;
  /** What the booker said about themselves. Claimed, not verified. */
  isNewPatient?: boolean;
  visitReasonId?: string;
  /** Denormalised: the exact label the patient chose, kept even if the
   *  underlying visit reason is later renamed or retired. */
  visitReasonName?: string;
  /**
   * Contact details for a booker with no chart yet.
   *
   * Public traffic never creates a `PatientDoc` — an unmatched booking parks
   * its identity here until someone at the desk links it to an existing
   * patient or registers a new one. Cleared on merge.
   */
  requester?: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    dateOfBirth?: string;      // YYYY-MM-DD
  };
  /** Insurance as the patient typed it, plus the result of checking it. */
  insuranceSubmitted?: {
    provider: string;
    memberId: string;
    groupId?: string;
    verifiedAt?: string;
    verificationStatus?: 'verified' | 'denied' | 'pending';
  };
  /** "Additional notes for the practice" from the booking form. */
  patientNotes?: string;
  /** What the patient agreed to, and to which version of the wording. */
  consent?: {
    privacyAcceptedAt: string;
    smsOptIn: boolean;
    policyVersion: string;
  };
  /** Short public reference shown on the confirmation screen (e.g. TMH-8F3K2).
   *  Also the key for the unauthenticated status/cancel links. */
  bookingReference?: string;
}

// ===== Emergency Preparedness =====
export type EmergencyType = 'disease_outbreak' | 'flood' | 'conflict' | 'famine' | 'cholera_outbreak' | 'measles_outbreak' | 'ebola' | 'mass_casualty' | 'infrastructure_failure';
export type EmergencyPhase = 'preparedness' | 'alert' | 'response' | 'recovery' | 'closed';
export type EmergencySeverity = 'level_1' | 'level_2' | 'level_3'; // WHO scale: 1=watch, 2=mobilize, 3=full activation

export interface EmergencyPlanDoc extends BaseDoc {
  type: 'emergency_plan';
  planName: string;
  emergencyType: EmergencyType;
  phase: EmergencyPhase;
  severity: EmergencySeverity;
  description: string;
  facilityId: string;
  facilityName: string;
  // Activation
  activatedAt?: string;
  activatedBy?: string;
  deactivatedAt?: string;
  // Resource readiness
  resources: {
    surgeBeds: number;
    availableSurgeBeds: number;
    emergencyKits: number;
    oralRehydrationSachets: number;
    choleraCots: number;
    ppe: number; // sets
    emergencyMedications: string[];
  };
  // Communication chain
  incidentCommander: string;
  incidentCommanderPhone: string;
  contactChain: { name: string; role: string; phone: string; order: number }[];
  // Capacity
  estimatedCapacity: number; // patients per day
  currentLoad: number;
  // Geographic scope
  state: string;
  county?: string;
  affectedAreas?: string[];
  // Tracking
  totalCasesManaged: number;
  totalDeaths: number;
  totalReferralsOut: number;
  orgId?: string;
}

// ── Internal patient transfer (care-ownership hand-off) ──────────────────
//
// NAMING — "transfer" is overloaded in this codebase; keep the two apart:
//   * `ReferralDoc` + `transfer-service.assembleTransferPackage` move a patient
//     BETWEEN FACILITIES and ship a copy of the chart with them.
//   * `PatientTransferDoc` (below) moves CARE OWNERSHIP inside the org — from
//     one provider/department/facility to another. Nothing is copied; the
//     patient's assignment changes and a durable record of who owned the
//     patient when, and why it moved, is kept.
//
// A transfer is modelled as its own workflow entity rather than an edit to
// `patient.assignedDoctor`, because an edit answers "who owns this patient
// now?" and nothing else. The questions that actually get asked after the fact
// — who was responsible on 3 March, who approved the move, why did it happen,
// was the hand-off acknowledged — are only answerable if the request, the
// decision, and the ownership window are all persisted. `assignedDoctor` is
// the derived cache; these docs are the ledger.

/**
 * Transfer lifecycle.
 *
 * `draft`      — composed but not yet sent; only the author sees it.
 * `requested`  — awaiting a decision from the receiving side.
 * `accepted`   — receiver took responsibility. For an immediate transfer the
 *                assignment has already moved and the doc goes straight to
 *                `completed`; a future-dated one waits in `accepted` (see
 *                `effectiveAt`) until its effective date arrives.
 * `rejected`   — receiver declined; ownership never moved.
 * `cancelled`  — sender (or an admin) withdrew it before a decision.
 * `completed`  — ownership has moved and the hand-off is closed.
 * `expired`    — a temporary/shared-care grant whose `expiresAt` has passed;
 *                the receiving side's access has lapsed back to the owner.
 */
export type PatientTransferStatus =
  | 'draft'
  | 'requested'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'completed'
  | 'expired';

/**
 * What the transfer does to ownership.
 *
 * `permanent`   — the receiving side becomes the owner; the sender's primary
 *                 ownership ends.
 * `temporary`   — the receiver holds ownership for a bounded window
 *                 (`expiresAt`), after which it returns to the sender. Used for
 *                 covering providers and short facility moves.
 * `shared_care` — ownership does NOT move at all. The receiver gains care-team
 *                 access alongside the existing owner. Specialist consults and
 *                 co-management.
 */
export type PatientTransferType = 'permanent' | 'temporary' | 'shared_care';

/** Urgency, driving inbox ordering and the acknowledgement SLA. */
export type PatientTransferUrgency = 'routine' | 'urgent' | 'emergency';

/** Physical movement is separate from care ownership. Older records may not
 * have this field; those records continue to use their legacy status. */
export type PatientTransferPhysicalStatus =
  | 'not_scheduled'
  | 'bed_reserved'
  | 'ready_for_transport'
  | 'departed'
  | 'in_transit'
  | 'arrived'
  | 'receiving_assessment'
  | 'closed';

export interface PatientTransferLocation {
  wardId?: string;
  wardName?: string;
  bedId?: string;
  bedNumber?: string;
  facilityId?: string;
  facilityName?: string;
}

export interface PatientTransferTransport {
  status: 'not_requested' | 'requested' | 'assigned' | 'ready' | 'departed' | 'arrived' | 'cancelled';
  teamId?: string;
  teamName?: string;
  equipment?: string[];
  escortRequired?: boolean;
  requestedAt?: string;
  departedAt?: string;
  arrivedAt?: string;
  notes?: string;
}

export interface PatientTransferClinicalReadiness {
  vitalsReviewed?: boolean;
  medicationsReconciled?: boolean;
  linesTubesDrainsReviewed?: boolean;
  oxygenAndMonitoringReviewed?: boolean;
  precautionsReviewed?: boolean;
  codeStatusReviewed?: boolean;
  pendingResultsReviewed?: boolean;
  equipmentReady?: boolean;
  senderSignedAt?: string;
  senderSignedById?: string;
  receiverAssessedAt?: string;
  receiverAssessedById?: string;
  receiverAssessmentNotes?: string;
}

export interface PatientTransferCommunication {
  patientInformedAt?: string;
  patientInformedById?: string;
  familyContactedAt?: string;
  familyContactedById?: string;
  familyContactMethod?: 'phone' | 'in_person' | 'portal' | 'not_available';
  concerns?: string;
  acknowledgement?: 'accepted' | 'declined' | 'unable_to_obtain';
}

/**
 * Audit events. Every state change appends one — the array is never rewritten,
 * so the event log is the authoritative history even if the summary fields on
 * the doc are later corrected.
 */
export type PatientTransferEventKind =
  | 'TRANSFER_DRAFTED'
  | 'TRANSFER_REQUESTED'
  | 'TRANSFER_ACCEPTED'
  | 'TRANSFER_REJECTED'
  | 'TRANSFER_CANCELLED'
  | 'TRANSFER_COMPLETED'
  | 'TRANSFER_EXPIRED'
  | 'TRANSFER_REASSIGNED'
  | 'TRANSFER_NOTE_ADDED'
  | 'TRANSFER_CHECKLIST_UPDATED'
  | 'TRANSFER_TASKS_REASSIGNED'
  | 'TRANSFER_LOGISTICS_UPDATED'
  | 'TRANSFER_RECEIVING_ASSESSMENT';

/** One immutable entry in a transfer's history. */
export interface PatientTransferEvent {
  id: string;
  kind: PatientTransferEventKind;
  /** Human-readable summary shown in the history tab. */
  message: string;
  actorId?: string;
  actorName?: string;
  actorRole?: UserRole;
  /** Status before/after, when this event changed status. */
  fromStatus?: PatientTransferStatus;
  toStatus?: PatientTransferStatus;
  /** Assignment snapshot either side of the event, for "who owned them when". */
  fromAssignment?: PatientTransferAssignment;
  toAssignment?: PatientTransferAssignment;
  reason?: string;
  notes?: string;
  /** Free-form extras (e.g. counts of reassigned tasks). Never PHI values. */
  metadata?: Record<string, string | number | boolean>;
  createdAt: string;
}

/**
 * One end of a transfer. Every field is optional because a transfer may move
 * only one axis — a patient can change provider without changing department,
 * or change department without changing facility.
 */
export interface PatientTransferAssignment {
  providerId?: string;
  providerName?: string;
  department?: string;
  facilityId?: string;
  facilityName?: string;
  orgId?: string;
}

/**
 * The safety checklist the sender works through before a transfer can be sent.
 * Items are recorded individually (not as one "I confirm" tick) so the record
 * shows exactly what was reviewed. `required` items block sending.
 */
export interface PatientTransferChecklistItem {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  completedAt?: string;
  completedById?: string;
}

/**
 * A snapshot of the clinical picture at the moment the transfer was raised,
 * so the receiving clinician can make an accept/reject decision without first
 * having to go digging through the chart — and so the history shows what they
 * were actually shown when they accepted.
 *
 * Counts and short labels only. The full chart stays where it is; this is a
 * hand-off summary, not a copy of the record.
 */
export interface PatientTransferSummary {
  activeProblems?: string[];
  activeMedications?: string[];
  allergies?: string[];
  riskFlags?: string[];
  openTaskCount?: number;
  lastEncounterDate?: string;
  lastEncounterSummary?: string;
  carePlan?: string;
}

/**
 * An internal transfer of care ownership. Org-scoped operational PHI.
 *
 * Cross-facility and cross-org moves are represented here too (the `to`
 * assignment simply names a different facility/org); they are gated behind a
 * stronger capability rather than a different document type, so one history
 * answers "where has this patient been owned" regardless of how far they moved.
 */
export interface PatientTransferDoc extends BaseDoc {
  type: 'patient_transfer';
  patientId: string;
  patientName?: string;
  hospitalNumber?: string;

  transferType: PatientTransferType;
  status: PatientTransferStatus;
  urgency: PatientTransferUrgency;

  from: PatientTransferAssignment;
  to: PatientTransferAssignment;

  /** Why the patient is moving. Required to send. */
  reason: string;
  /** Narrative hand-off note from sender to receiver. */
  handoffNotes?: string;
  /** Clinical snapshot captured at request time (see PatientTransferSummary). */
  summary?: PatientTransferSummary;
  checklist?: PatientTransferChecklistItem[];

  // ── Actors ──
  requestedById?: string;
  requestedByName?: string;
  requestedByRole?: UserRole;
  requestedAt?: string;
  decidedById?: string;
  decidedByName?: string;
  decidedAt?: string;
  /** Receiver's reason when `status === 'rejected'`. */
  decisionNotes?: string;
  cancelledById?: string;
  cancelledByName?: string;
  cancelledAt?: string;
  completedAt?: string;

  /**
   * When ownership should actually move. Absent (or in the past) means "as soon
   * as it is accepted". A future value parks an accepted transfer until the
   * date arrives — see `autoCompleteOnEffectiveDate`.
   */
  effectiveAt?: string;
  /** End of a `temporary` / `shared_care` grant. */
  expiresAt?: string;
  /**
   * Whether a future-dated accepted transfer completes by itself when
   * `effectiveAt` passes, or waits for someone to confirm the patient actually
   * arrived. Defaults to true.
   */
  autoCompleteOnEffectiveDate?: boolean;

  /** Physical movement and destination logistics. */
  physicalStatus?: PatientTransferPhysicalStatus;
  destination?: PatientTransferLocation;
  transport?: PatientTransferTransport;
  clinicalReadiness?: PatientTransferClinicalReadiness;
  communication?: PatientTransferCommunication;
  /** Set when the receiving nurse/provider confirms bedside arrival. */
  arrivedAt?: string;
  arrivedById?: string;
  closedAt?: string;
  closedById?: string;

  /**
   * Set on a `permanent`/`temporary` transfer that was force-applied by an
   * admin without the receiver accepting (the Option-1 direct path). Kept as a
   * flag rather than a separate status so these are auditable as a class.
   */
  forced?: boolean;

  /** Open tasks moved to the receiving provider when the transfer completed. */
  reassignedTaskIds?: string[];

  /** Append-only audit trail. */
  events: PatientTransferEvent[];

  /**
   * Scoping. `hospitalId` / `orgId` are the SENDING facility and org.
   *
   * `toHospitalId` and `toOrgId` mirror `ReferralDoc`'s field NAMES on purpose:
   * `filterByScope` matches those exact top-level keys, so a transfer addressed
   * to another facility (or another tenant) is visible to the receiving side.
   * They must stay top-level and flat — the facilities also live inside
   * `from`/`to`, but the scope filter cannot see nested fields, so a transfer
   * carrying only `to.facilityId` is invisible to the very people who have to
   * answer it: their inbox stays empty, no notification fires, and the request
   * times out unacknowledged.
   */
  hospitalId?: string;
  toHospitalId?: string;
  orgId?: string;
  toOrgId?: string;
}

// Re-export mock types for convenience
export type { Hospital, Patient, Referral, DiseaseAlert, VitalSigns, Diagnosis, Prescription, LabResult, MedicalRecord, Attachment, TransferPackage, CareTeamMember };
