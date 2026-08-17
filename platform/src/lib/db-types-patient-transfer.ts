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
import type { BaseDoc, UserRole } from './db-types';

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
