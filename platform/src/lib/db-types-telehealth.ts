/**
 * Telehealth Services (Private Sector).
 */
import type { BaseDoc } from './db-types';

export type TelehealthStatus = 'scheduled' | 'waiting_room' | 'in_session' | 'completed' | 'cancelled' | 'failed' | 'no_show';
export type TelehealthType = 'video' | 'audio' | 'chat';
/** Why a telehealth session reached a terminal state (KAN-127). */
export type TelehealthTerminationReason =
  | 'provider_ended'
  | 'patient_left'
  | 'connection_failed'
  | 'abandoned'
  | 'no_show'
  | 'cancelled';
export type SessionQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'failed';

export interface TelehealthSessionDoc extends BaseDoc {
  type: 'telehealth_session';
  // Linked appointment
  appointmentId?: string;
  // Participants
  patientId: string;
  patientName: string;
  patientPhone?: string;
  patientEmail?: string;
  providerId: string;
  providerName: string;
  providerRole: string;
  facilityId: string;
  facilityName: string;
  // Session details
  sessionType: TelehealthType;
  scheduledDate: string;
  scheduledTime: string;
  actualStartTime?: string;
  actualEndTime?: string;
  duration?: number;          // actual minutes — DERIVED server-side from the
                              // timestamps above, never taken from a client's
                              // elapsed timer (KAN-127)
  status: TelehealthStatus;
  /**
   * Why the session ended. Recorded on every terminal transition so a short or
   * missing visit can be told apart from a clean one after the fact — a
   * completed session and one the patient dropped out of otherwise look
   * identical in the record.
   */
  terminationReason?: TelehealthTerminationReason;
  /**
   * Waiting room (KAN-128). The patient's arrival and the clinician's decision
   * on it, recorded rather than inferred.
   *
   * `waitingSince` is what makes an honest wait time possible — before it, the
   * patient's screen could only count from when their own page loaded, which
   * resets on every reconnect and understates the wait exactly when it is
   * longest.
   *
   * It also separates two situations the `status` field alone conflates: a
   * patient who never arrived, and one who waited and was never let in. Those
   * are the same `no_show` without it, and only one of them is the patient's
   * doing.
   */
  waitingSince?: string;
  admittedAt?: string;
  admittedBy?: string;
  admittedByName?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectedByName?: string;
  /** Why the clinician turned the patient away. Shown to the patient. */
  rejectionReason?: string;
  // Connection
  roomId: string;             // Unique room identifier for joining
  joinUrl?: string;           // URL for patient to join
  providerJoinUrl?: string;
  // Clinical
  chiefComplaint: string;
  clinicalNotes?: string;
  diagnosis?: string;
  icd10Code?: string;
  prescriptionsIssued?: string[];
  labOrdersIssued?: string[];
  followUpRequired: boolean;
  followUpDate?: string;
  referralRequired: boolean;
  referralFacility?: string;
  // Quality & compliance (ISO 13131 alignment)
  sessionQuality?: SessionQuality;
  connectionDrops: number;
  patientConsentGiven: boolean;
  consentTimestamp?: string;
  /**
   * HOW consent was obtained. Required whenever `patientConsentGiven` is true —
   * a bare boolean says a patient consented but not who recorded it or on what
   * basis, which is not a defensible record.
   *
   *  - `patient_portal`          the patient themselves ticked consent before
   *                              joining. The only form that is truly
   *                              first-party.
   *  - `provider_attested_verbal` the clinician asked the patient (in the room,
   *                              by phone) and is attesting to it. Carries
   *                              `consentAttestedBy` so the attestation is
   *                              attributable to a named user.
   *  - `written`                 a signed paper/scanned form exists on file.
   *
   * Historical documents may lack this field; treat absent as "unknown
   * provenance", NOT as patient-given.
   */
  consentMethod?: 'patient_portal' | 'provider_attested_verbal' | 'written';
  /** User id of the clinician attesting, when consentMethod is provider-attested. */
  consentAttestedBy?: string;
  /** Display name of that clinician, denormalised for audit readability. */
  consentAttestedByName?: string;
  /**
   * Patient portal user id, when the patient consented themselves. The
   * counterpart to `consentAttestedBy` — between them, every consent record
   * names the person who performed the act rather than only its method.
   */
  consentedBy?: string;
  /**
   * Version of the consent policy the patient was actually shown.
   *
   * Without this a consent record proves someone ticked a box but not what
   * they agreed to, and an audit cannot reproduce the text — which is the
   * whole evidentiary value of the record. Recorded from the server's current
   * policy, never from a client-supplied string.
   */
  consentPolicyVersion?: string;
  /**
   * Withdrawal is recorded, not erased. Clearing `patientConsentGiven` alone
   * would make a withdrawn consent indistinguishable from one never given,
   * losing the fact that the patient made a decision and when.
   */
  consentWithdrawnAt?: string;
  consentWithdrawnReason?: string;
  // Recording & documentation
  sessionRecorded: boolean;
  recordingUrl?: string;
  attachments?: { name: string; type: string; url: string }[];
  // Patient satisfaction
  patientRating?: number;     // 1-5 — the patient's SATISFACTION with the visit
  patientFeedback?: string;
  /**
   * The provider's rating of technical quality — "was the connection usable?"
   *
   * Deliberately a separate field from `patientRating` (KAN-132). They answer
   * different questions: a clinically excellent visit over a terrible line
   * should score high on one and low on the other, and averaging them together
   * would hide exactly the operational problem the technical score exists to
   * surface.
   */
  providerTechnicalRating?: number;  // 1-5
  providerFeedback?: string;
  /** When each rating was captured, so response rate can be reported. */
  patientRatedAt?: string;
  providerRatedAt?: string;
  // Billing (private sector)
  consultationFee?: number;
  currency?: string;
  paymentStatus?: 'pending' | 'paid' | 'waived' | 'insurance';
  insuranceProvider?: string;
  // Administrative
  cancelledReason?: string;
  cancelledBy?: string;
  state: string;
  county?: string;
  orgId?: string;
}
