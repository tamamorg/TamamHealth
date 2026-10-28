/**
 * What a provider/staff dropdown has to say about each person before someone
 * can sensibly assign a visit to them.
 *
 * A list of bare names cannot answer the questions actually being asked at the
 * moment of assignment — is this the right kind of clinician, are they even
 * free at this time, and how loaded is their day already? Reception was picking
 * a name and only discovering the clash after saving, which is how a booking
 * ends up double-stacked on one doctor while a colleague sits empty.
 *
 * So each option carries: who they are (role/specialty and department), whether
 * they are free at the slot being edited, and how many visits they already hold
 * that day. `<option>` renders text only, so this is a formatted string rather
 * than markup — kept here, and unit-testable, instead of inline in two files.
 */

import { roleLabel } from './role-display';
import { isTimeOverlap } from './appointment-time';
import { APPOINTMENT_SLOT_RELEASED_STATUSES } from './appointment-status';
import type { AppointmentDoc } from './db-types';

/** The subset of UserDoc these pickers read. */
export interface StaffPickerPerson {
  _id: string;
  name?: string;
  username?: string;
  role?: string;
  department?: string;
  specialty?: string;
  hospitalName?: string;
}

export interface StaffSlotContext {
  /** Every appointment the page has loaded, for the clash + load counts. */
  appointments: AppointmentDoc[];
  date: string;
  time: string;
  duration: number;
  /** The appointment being edited — its own row can never be a clash. */
  excludeAppointmentId?: string;
  /** Append the facility, for org-wide pickers spanning several hospitals. */
  showFacility?: boolean;
}

/** "clinical_officer" → "Clinical Officer", in the role's on-screen name. */
export function humanizeRole(role?: string): string {
  return roleLabel(role);
}

export function staffDisplayName(person: StaffPickerPerson): string {
  return person.name || person.username || 'Unnamed';
}

/**
 * A person counts as booked whether they are carrying the visit (providerId)
 * or assisting on it (staffId) — being the second person on a theatre list
 * makes them just as unavailable as being the first.
 */
function holdsAppointment(person: StaffPickerPerson, appt: AppointmentDoc): boolean {
  if (appt.providerId && appt.providerId === person._id) return true;
  if (appt.staffId && appt.staffId === person._id) return true;
  // Older rows recorded only the provider's name, so fall back to it rather
  // than reporting someone free when their name is on the booking.
  return !!appt.providerName && appt.providerName === staffDisplayName(person);
}

/** Cancelled, no-show and rescheduled rows do not hold a slot — the same
 *  release rule the service's conflict guard enforces, so a dropdown never
 *  reports someone busy on a slot the guard would let through. */
function isLiveBooking(appt: AppointmentDoc): boolean {
  return !APPOINTMENT_SLOT_RELEASED_STATUSES.includes(appt.status);
}

export interface StaffAvailability {
  /** The appointment that collides with this slot, when there is one. */
  clash: AppointmentDoc | null;
  /** How many live bookings this person already holds that day. */
  sameDayCount: number;
}

export function staffAvailability(
  person: StaffPickerPerson,
  ctx: StaffSlotContext,
): StaffAvailability {
  const sameDay = ctx.appointments.filter(appt =>
    appt._id !== ctx.excludeAppointmentId
    && appt.appointmentDate === ctx.date
    && isLiveBooking(appt)
    && holdsAppointment(person, appt));

  const clash = (ctx.date && ctx.time)
    ? sameDay.find(appt => isTimeOverlap(appt.appointmentTime, appt.duration, ctx.time, ctx.duration)) || null
    : null;

  return { clash, sameDayCount: sameDay.length };
}

/**
 * The line shown for one person in a provider/staff dropdown, e.g.
 * "Dr. Peter Garang Deng · Surgeon, Surgery · Busy 16:15 · 4 today".
 *
 * Ordered by what decides the pick: who they are, then whether they are free,
 * then how full their day is. Empty facts are dropped rather than rendered as
 * blanks, so a sparse staff record still reads as a clean name.
 */
export function staffOptionLabel(person: StaffPickerPerson, ctx: StaffSlotContext): string {
  const parts: string[] = [staffDisplayName(person)];

  // Specialty is more specific than role, so it wins when both are recorded.
  const who = [person.specialty || humanizeRole(person.role), person.department]
    .filter(Boolean).join(', ');
  if (who) parts.push(who);

  const { clash, sameDayCount } = staffAvailability(person, ctx);
  parts.push(clash ? `Busy ${clash.appointmentTime}` : 'Free');
  if (sameDayCount > 0) parts.push(`${sameDayCount} today`);

  if (ctx.showFacility && person.hospitalName) parts.push(person.hospitalName);

  return parts.join(' · ');
}
