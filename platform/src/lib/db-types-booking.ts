/**
 * Online booking types.
 *
 * These back the patient-facing booking surfaces (practice page, provider
 * profile, embeddable widget) and the staff-side configuration that decides
 * what those surfaces are allowed to offer.
 *
 * Design notes worth keeping in mind when extending this file:
 *
 *  - Everything here is *configuration + public presentation*. The clinical
 *    record of a booking is still an `AppointmentDoc`; nothing in this file
 *    duplicates it.
 *
 *  - `ProviderProfileDoc` is a separate document rather than more fields on
 *    `UserDoc` on purpose: `UserDoc` carries `passwordHash` and `pinHash`, and
 *    a public endpoint must never be one careless `select` away from those.
 *
 *  - Times are facility-local wall-clock strings (`HH:MM`, 24h) and dates are
 *    `YYYY-MM-DD`, matching `AvailabilityDoc` and `AppointmentDoc`. The slot
 *    engine is given `now` and a timezone explicitly; nothing in this layer
 *    calls `Date.now()`.
 */

import type { AppointmentType, BaseDoc } from './db-types';

/** How a visit can be attended. Mirrors `AvailabilityModality`. */
/**
 * Kept as a single-member union rather than deleted: visit-reason documents
 * already store a modality, and narrowing a stored value to nothing would make
 * every existing row fail validation. Every visit happens in person now, so
 * the booking UI no longer offers a choice.
 */
export type BookingModality = 'in_person';

/** Whether the booker has been seen at this practice before. */
export type PatientClass = 'new' | 'returning';

// ═══════════════════════════════════════════════════════════════════════════
// Visit reasons — the patient-facing service menu
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One selectable "Reason for visit". This is the patient's vocabulary, not the
 * clinical one: a practice may offer "Annual Gynecology Visit" and "Well
 * Baby/Child Visit" where the chart only knows `general` and `immunization`.
 * `appointmentType` is the bridge, so every existing report keeps working.
 *
 * The duration lives here rather than on the availability window, because how
 * long a visit takes is a property of the visit, not of the doctor's morning.
 */
export interface VisitReasonDoc extends BaseDoc {
  type: 'visit_reason';
  orgId: string;
  /** Unset = offered at every facility in the org. */
  facilityId?: string;
  /** The label the patient reads, e.g. "Annual Gynecology Visit". */
  name: string;
  /** Stable identifier for links and analytics, e.g. "annual-gynecology-visit". */
  slug: string;
  /** Short helper line shown under the name in the picker. */
  description?: string;
  /** Slot length for this reason. Overrides the window's `slotMinutes`. */
  durationMinutes: number;
  /** Both false = the reason exists for staff booking but is not offered online. */
  availableToNewPatients: boolean;
  availableToReturningPatients: boolean;
  modality: BookingModality;
  /** Restrict to a provider subset. Empty = any provider with availability. */
  providerIds: string[];
  department: string;
  /** How this reason is recorded on the chart. */
  appointmentType: AppointmentType;
  /** Optional link to `FeeScheduleDoc.serviceCode` for price display. */
  feeScheduleCode?: string;
  /** Ask for insurance before submitting. Overrides the policy default. */
  requiresInsurance?: boolean;
  sortOrder: number;
  isActive: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Booking policy — the rules every surface obeys
// ═══════════════════════════════════════════════════════════════════════════

/**
 * What lands in the schedule when a patient submits.
 *
 * `request` — the booking arrives as `requested` and a human approves it. The
 *   default, and the only safe setting for a facility that has not yet checked
 *   its availability data.
 * `auto` — the booking arrives as `scheduled`. The conflict guard is still
 *   authoritative; this only removes the human step.
 */
export type BookingConfirmationMode = 'request' | 'auto';

export interface BookingPolicyDoc extends BaseDoc {
  type: 'booking_policy';
  orgId: string;
  facilityId: string;
  /** Master switch. Off by default: no facility becomes bookable on deploy. */
  onlineBookingEnabled: boolean;
  confirmationMode: BookingConfirmationMode;
  /** No booking may start sooner than this many minutes from now. */
  minLeadTimeMinutes: number;
  /** How far ahead the date strip may walk. */
  maxAdvanceDays: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** Slots offered concurrently per window; >1 models a double-booked clinic. */
  defaultCapacity: number;
  /** How close to the visit a patient may still cancel their own booking. */
  cancellationWindowHours: number;
  /** Ask every booker for insurance. `VisitReasonDoc.requiresInsurance` wins. */
  requireInsurance: boolean;
  /**
   * Facility-wide single-slot exclusivity — the historical behaviour of the
   * appointments calendar, where a day is one stack and two bookings at the
   * same time have nowhere to draw.
   *
   * Left ON for facilities that have always had it. Turned OFF when a facility
   * enables online booking, because a practice with two doctors genuinely does
   * see two patients at 09:00. Provider and room exclusivity are enforced
   * regardless and are the checks that actually protect a clinician's day.
   */
  singleSlotPerFacility: boolean;
  /** Free text shown under the consents. Rendered as plain text, never HTML. */
  policyText?: string;
  consentTextPrivacy: string;
  consentTextSms: string;
  publicPhone?: string;
  publicEmail?: string;
  /** URL segment for this practice: /book/<publicSlug>. */
  publicSlug: string;
  /** Exact origins allowed to iframe the widget (frame-ancestors + CORS). */
  embedAllowedOrigins: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider public profile
// ═══════════════════════════════════════════════════════════════════════════

export interface ProviderProfileDoc extends BaseDoc {
  type: 'provider_profile';
  /** → `UserDoc._id`. One profile per clinician. */
  userId: string;
  orgId: string;
  /** URL segment: /book/<practice>/<publicSlug>. */
  publicSlug: string;
  /** "Dr. Sudha Challa, MD" — exactly as the patient should read it. */
  displayName: string;
  credentials?: string;
  /** "Geriatric Medicine Physician". */
  specialtyLabel: string;
  photoUrl?: string;
  bio?: string;
  languages: string[];
  acceptingNewPatients: boolean;
  /** Every facility this clinician practises at, for "+N more location". */
  facilityIds: string[];
  /** Nothing renders publicly until this is true. */
  isPublished: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Slot holds
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A short-lived claim on one slot while the patient fills in the form.
 *
 * Without it, two people can complete the same 10:30 and one of them gets a
 * phone call. A stale hold costs one slot for ten minutes; that is the cheaper
 * failure. The hold is a courtesy — the submit path re-checks availability for
 * real before writing anything.
 */
export interface SlotHoldDoc extends BaseDoc {
  type: 'slot_hold';
  orgId: string;
  facilityId: string;
  providerId: string;
  date: string;              // YYYY-MM-DD
  startTime: string;         // HH:MM
  durationMinutes: number;
  /** ISO. Past this, the hold no longer blocks anyone. */
  expiresAt: string;
  /** Opaque token the submit call must present. */
  holdToken: string;
  /** Set once the booking it was holding for has been created. */
  consumedAt?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Reviews
// ═══════════════════════════════════════════════════════════════════════════

export type ReviewStatus = 'pending_moderation' | 'published' | 'rejected';

/**
 * A patient's review of a completed visit.
 *
 * Anchored to an appointment on purpose: a review can only come from someone
 * who actually attended, which is what keeps a public rating meaningful and
 * makes anonymous submission impossible.
 */
export interface ProviderReviewDoc extends BaseDoc {
  type: 'provider_review';
  providerId: string;
  orgId: string;
  facilityId: string;
  appointmentId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  /** "Latrice B." — derived at write time. The full name is never stored here. */
  authorDisplayName: string;
  visitDate: string;
  status: ReviewStatus;
  moderatedBy?: string;
  moderatedAt?: string;
  moderationNote?: string;
}
