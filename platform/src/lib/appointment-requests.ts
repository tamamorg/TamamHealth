/**
 * Pure rules behind the front desk's "Appointment requests" list: which
 * bookings are waiting for a person to answer them, in what order, and how a
 * phone number becomes a tel:/sms: link. Kept out of the component so the
 * filtering and formatting are testable without a DOM.
 */
import type { AppointmentDoc } from './db-types';
import { isPendingApproval } from './appointment-workflow';

/**
 * Requests across ALL future dates (today included), soonest first. When a
 * facility id is given, rows stamped for another facility are dropped; rows
 * with no facility stamp are kept (older rows predate the field).
 */
export function pendingRequests(
  appointments: AppointmentDoc[],
  today: string,
  facilityId?: string,
): AppointmentDoc[] {
  return appointments
    .filter(a => isPendingApproval(a, today))
    .filter(a => !facilityId || !a.facilityId || a.facilityId === facilityId)
    .sort((a, b) =>
      (a.appointmentDate || '').localeCompare(b.appointmentDate || '')
      || (a.appointmentTime || '').localeCompare(b.appointmentTime || ''));
}

/** Strip spaces, dashes, dots and brackets; keep a leading + and digits. */
export function normalizePhone(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

export function telHref(raw?: string | null): string | null {
  const n = normalizePhone(raw);
  return n ? `tel:${n}` : null;
}

export function smsHref(raw?: string | null): string | null {
  const n = normalizePhone(raw);
  return n ? `sms:${n}` : null;
}

/** The number to reach the requester on: their stated phone, else the booker's. */
export function requestPhone(appt: AppointmentDoc): string {
  return appt.patientPhone || appt.requester?.phone || '';
}

export type RequestSourceKey = 'portal' | 'public_widget' | 'directory' | 'staff';

export function requestSourceKey(appt: AppointmentDoc): RequestSourceKey {
  if (appt.source) return appt.source;
  // Older portal requests carry no source. A request the patient booked for
  // themselves is not a staff booking, whatever else it says.
  if (appt.patientId && appt.bookedBy === appt.patientId) return 'portal';
  return 'staff';
}

export const REQUEST_SOURCE_LABELS: Record<RequestSourceKey, string> = {
  portal: 'Portal',
  public_widget: 'Online booking',
  directory: 'Directory',
  staff: 'Staff',
};

export function requestSourceLabel(appt: AppointmentDoc): string {
  return REQUEST_SOURCE_LABELS[requestSourceKey(appt)];
}

export type ContactPreference = 'call' | 'sms' | 'either';

/** Read defensively: the field is optional and absent on older rows. */
export function contactPreferenceOf(appt: AppointmentDoc): ContactPreference | null {
  const v = (appt as { contactPreference?: string }).contactPreference;
  return v === 'call' || v === 'sms' || v === 'either' ? v : null;
}
