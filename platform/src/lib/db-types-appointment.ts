/**
 * Appointment Booking (Payam Level & Above).
 *
 * Distinct from db-types-booking.ts, which holds the online-booking-facing
 * metadata (visit reasons, booking policy, provider profiles, slot holds,
 * reviews) rather than the appointment record itself.
 */
import type { BaseDoc, FacilityLevel } from './db-types';

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
export type AppointmentType = 'general' | 'follow_up' | 'specialist' | 'anc' | 'immunization' | 'lab' | 'telehealth' | 'surgical' | 'dental' | 'mental_health' | 'walk_in';
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
  /**
   * How the visit happens, independent of what kind of visit it is. Legacy rows
   * carry no mode and are read as in-office unless `appointmentType` is
   * 'telehealth', which is how a remote visit used to be recorded.
   */
  appointmentMode?: 'in_office' | 'telehealth';
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
