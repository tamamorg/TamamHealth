/**
 * The chart's Appointments tab splits a patient's bookings the O3 way:
 * Upcoming (after today, soonest first), Today (by time), Past (before today,
 * newest first). One function decides the bucket and the order so the tab and
 * the page's deep-link paging agree on where a row is.
 */
import type { AppointmentDoc } from '@/lib/db-types';

export type ApptView = 'upcoming' | 'today' | 'past';

export function apptBucket(appt: Pick<AppointmentDoc, 'appointmentDate'>, today: string): ApptView {
  if (appt.appointmentDate === today) return 'today';
  return appt.appointmentDate > today ? 'upcoming' : 'past';
}

const key = (a: Pick<AppointmentDoc, 'appointmentDate' | 'appointmentTime'>) =>
  `${a.appointmentDate}T${a.appointmentTime || '00:00'}`;

export function appointmentsInView<T extends Pick<AppointmentDoc, 'appointmentDate' | 'appointmentTime'>>(
  appointments: T[], view: ApptView, today: string,
): T[] {
  const rows = appointments.filter(a => apptBucket(a, today) === view);
  return view === 'past'
    ? rows.sort((a, b) => key(b).localeCompare(key(a)))
    : rows.sort((a, b) => key(a).localeCompare(key(b)));
}
