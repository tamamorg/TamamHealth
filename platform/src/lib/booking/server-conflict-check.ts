/**
 * Ask the server whether a slot clashes, for the bookings this device cannot
 * see: a device holds only its own facility's appointments, so a doctor or
 * nurse already booked at another facility of the organisation passes the
 * local check. The server holds every facility (GET /api/appointments/conflicts).
 *
 * Offline-first: when the device is offline or the server cannot be reached,
 * the answer is "no known clash" and the local rule — which `create` always
 * runs — stands alone. A network problem never blocks a booking.
 */
import type { AppointmentDoc } from '@/lib/db-types';

type Slot = Pick<AppointmentDoc, 'appointmentDate' | 'appointmentTime' | 'duration'>
  & Partial<Pick<AppointmentDoc, 'providerId' | 'providerName' | 'staffId' | 'staffName' | 'patientId' | 'facilityId'>>;

export async function serverBookingConflict(slot: Slot, opts: { excludeId?: string; signal?: AbortSignal } = {}): Promise<string | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const params = new URLSearchParams({
    date: slot.appointmentDate,
    time: slot.appointmentTime,
    duration: String(slot.duration || 30),
  });
  for (const key of ['providerId', 'providerName', 'staffId', 'staffName', 'patientId', 'facilityId'] as const) {
    const value = slot[key];
    if (value) params.set(key, value);
  }
  if (opts.excludeId) params.set('excludeId', opts.excludeId);
  try {
    const res = await fetch(`/api/appointments/conflicts?${params}`, { credentials: 'same-origin', signal: opts.signal });
    if (!res.ok) return null;
    const body = await res.json() as { conflict?: string | null };
    return body.conflict || null;
  } catch {
    return null;
  }
}

/** A clash the server reported, shaped like the local rule's error so the
 *  booking forms handle both the same way. */
class ServerBookingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookingConflictError';
  }
}

/** Wrap a `create` so each booking also clears the server's conflict check. */
export function withServerConflictCheck<T extends Slot>(create: (data: T) => Promise<AppointmentDoc>) {
  return async (data: T): Promise<AppointmentDoc> => {
    const conflict = await serverBookingConflict(data);
    if (conflict) throw new ServerBookingConflictError(conflict);
    return create(data);
  };
}
