/**
 * API: /api/appointments/conflicts
 * GET — Would this slot clash? `?date=YYYY-MM-DD&time=HH:MM&duration=30
 *       &providerId=…&staffId=…&patientId=…&facilityId=…&excludeId=…`
 *
 * The booking forms check clashes on the device first, but a device only holds
 * its own facility's bookings: a doctor or nurse booked at another facility of
 * the same organisation is invisible there. The server holds every facility,
 * so the forms ask it too when online. It runs the one conflict rule
 * (`assertNoBookingConflicts`) and answers `{ conflict: string | null }`.
 *
 * Read-only and org-bound: the organisation always comes from the caller's
 * session, never the query, so one tenant can never probe another's diary.
 * The message names the colliding patient, as the booking forms already do
 * for bookings the caller can see; it is only returned to booking roles.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import type { UserRole } from '@/lib/db-types';

const BOOKING_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'midwife', 'front_desk', 'medical_superintendent', 'central_registration_clerk',
  'clinic_clerk', 'triage_nurse', 'rooming_nurse', 'clinician',
];

const ID = /^[A-Za-z0-9:_.-]{1,128}$/;

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, BOOKING_ROLES)) return forbidden();

    const q = request.nextUrl.searchParams;
    const date = q.get('date') || '';
    const time = q.get('time') || '';
    const duration = Number(q.get('duration') || '30');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)
      || !Number.isFinite(duration) || duration < 5 || duration > 480) {
      return NextResponse.json({ error: 'Check the date, time and duration.' }, { status: 400 });
    }
    const optional = (key: string): string | undefined => {
      const value = q.get(key);
      return value && ID.test(value) ? value : undefined;
    };

    const { assertNoBookingConflicts } = await import('@/lib/services/appointment-service');
    try {
      await assertNoBookingConflicts({
        providerId: optional('providerId'),
        providerName: q.get('providerName')?.slice(0, 120) || undefined,
        staffId: optional('staffId'),
        staffName: q.get('staffName')?.slice(0, 120) || undefined,
        patientId: optional('patientId'),
        orgId: auth.orgId,
        facilityId: optional('facilityId'),
        appointmentDate: date,
        appointmentTime: time,
        duration,
      }, optional('excludeId'));
      return NextResponse.json({ conflict: null });
    } catch (error) {
      if (error instanceof Error && error.name === 'BookingConflictError') {
        return NextResponse.json({ conflict: error.message });
      }
      throw error;
    }
  } catch (err) {
    logApiError('[API /appointments/conflicts GET]', err);
    return serverError();
  }
}
