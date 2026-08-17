/**
 * Provider Availability (bookable windows for appointments/telehealth).
 */
import type { BaseDoc } from './db-types';

export type AvailabilityModality = 'in_person' | 'telehealth' | 'both';
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
