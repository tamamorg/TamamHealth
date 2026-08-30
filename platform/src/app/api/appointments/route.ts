/**
 * API: /api/appointments
 * GET  — List appointments (supports ?date=YYYY-MM-DD&patientId=xxx&providerId=xxx)
 * POST — Create a new appointment
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
// medical_biller holds the /appointments route in role-routes.ts (billing
// context needs the appointment a charge/claim is tied to) — read-only,
// since a biller does not schedule visits.
const READ_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'midwife', 'front_desk', 'cashier', 'medical_superintendent', 'hospital_manager',
  'central_registration_clerk', 'clinic_clerk', 'triage_nurse', 'rooming_nurse', 'clinician',
  'medical_biller',
];
const CREATE_ROLES: UserRole[] = [
  'super_admin', 'org_admin', 'doctor', 'clinical_officer', 'nurse',
  'midwife', 'front_desk', 'medical_superintendent', 'central_registration_clerk',
  'clinic_clerk', 'triage_nurse', 'rooming_nurse', 'clinician',
];

/**
 * Reject appointment slots that have already passed. Allow today (any time)
 * — clinicians legitimately walk-in-book for a slot a few minutes from now,
 * and the cost of a stale clock skewed by a minute or two would be too many
 * false rejections. We compare at day granularity for the date and at
 * minute granularity for today's same-day slots.
 *
 * Returns an error message string or null when the slot is acceptable.
 */
function validateFutureDate(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Invalid appointment date';
  if (!/^\d{2}:\d{2}$/.test(time)) return 'Invalid appointment time';
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return 'Appointment date cannot be in the past';
  // For today's date, also reject slots whose wall-clock time has already
  // passed by more than 5 minutes (accommodating a tiny grace for clock skew
  // / round-trip latency). 5 min keeps the UX of "book me into the slot the
  // doctor is already in" intact while blocking a deliberately back-dated
  // booking.
  if (date === today) {
    const now = new Date();
    const [hh, mm] = time.split(':').map(Number);
    const slot = new Date(now);
    slot.setHours(hh, mm, 0, 0);
    if (slot.getTime() < now.getTime() - 5 * 60_000) {
      return 'Appointment time has already passed';
    }
  }
  return null;
}
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const {
      getAllAppointments, getAppointmentsByDate, getAppointmentsByPatient,
      getAppointmentsByProvider, getTodaysAppointments, getUpcomingAppointments,
      appointmentStatsFrom,
    } = await import('@/lib/services/appointment-service');
    const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
    const { appointmentsVisibleToUser } = await import('@/lib/appointment-visibility');
    const visible = (rows: import('@/lib/db-types').AppointmentDoc[]) => appointmentsVisibleToUser(
      rows,
      { _id: auth.sub, role: auth.role as UserRole },
    );
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const patientId = url.searchParams.get('patientId');
    const providerId = url.searchParams.get('providerId');
    const view = url.searchParams.get('view'); // 'today', 'upcoming', 'stats'
    if (view === 'stats') {
      const scope = buildScopeFromAuth(auth);
      const stats = appointmentStatsFrom(visible(await getAllAppointments(scope)));
      return NextResponse.json(stats);
    }
    if (view === 'today') {
      const scope = buildScopeFromAuth(auth);
      const appointments = visible(await getTodaysAppointments(scope));
      return NextResponse.json({ appointments, total: appointments.length });
    }
    if (view === 'upcoming') {
      const scope = buildScopeFromAuth(auth);
      const appointments = visible(await getUpcomingAppointments(scope));
      return NextResponse.json({ appointments, total: appointments.length });
    }
    let appointments;
    if (date) {
      const scope = buildScopeFromAuth(auth);
      appointments = await getAppointmentsByDate(date, scope);
    } else if (patientId) {
      const rows = await getAppointmentsByPatient(patientId);
      appointments = filterByScope(rows, buildScopeFromAuth(auth));
    } else if (providerId) {
      const rows = await getAppointmentsByProvider(providerId);
      appointments = filterByScope(rows, buildScopeFromAuth(auth));
    } else {
      const scope = buildScopeFromAuth(auth);
      appointments = await getAllAppointments(scope);
    }
    appointments = visible(appointments);
    return NextResponse.json({ appointments, total: appointments.length });
  } catch (err) {
    logApiError('[API /appointments GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, CREATE_ROLES)) return forbidden();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    // Status update action
    if (body.action === 'update_status') {
      if (!body.appointmentId || !body.status) {
        return NextResponse.json(
          { error: 'appointmentId and status are required' },
          { status: 400 }
        );
      }
      const { updateAppointmentStatus, getAppointmentById } = await import('@/lib/services/appointment-service');
      const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
      // Tenant guard: without this any CREATE_ROLES caller could drive the
      // status of an arbitrary appointmentId regardless of org/facility. 404
      // (not 403) so an out-of-scope id reads identically to a missing one.
      const existingForStatus = await getAppointmentById(body.appointmentId as string);
      if (!existingForStatus || filterByScope([existingForStatus], buildScopeFromAuth(auth)).length === 0) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      }
      const { canViewAppointment } = await import('@/lib/appointment-visibility');
      if (!canViewAppointment(existingForStatus, { _id: auth.sub, role: auth.role as UserRole })) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      }
      const requestedExtra = body.extra && typeof body.extra === 'object'
        ? body.extra as Record<string, unknown>
        : {};
      const result = await updateAppointmentStatus(
        body.appointmentId as string,
        body.status as Parameters<typeof updateAppointmentStatus>[1],
        {
          cancelledReason: typeof requestedExtra.cancelledReason === 'string' ? requestedExtra.cancelledReason : undefined,
          note: typeof requestedExtra.note === 'string' ? requestedExtra.note : undefined,
          actorId: auth.sub,
          actorName: auth.name,
          actorRole: auth.role as UserRole,
        },
      );
      if (!result) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      return NextResponse.json({ appointment: result });
    }
    // Reschedule action
    if (body.action === 'reschedule') {
      if (!body.appointmentId || !body.newDate || !body.newTime) {
        return NextResponse.json(
          { error: 'appointmentId, newDate, and newTime are required' },
          { status: 400 }
        );
      }
      const { getAppointmentById } = await import('@/lib/services/appointment-service');
      const { buildScopeFromAuth, filterByScope } = await import('@/lib/services/data-scope');
      // Same tenant guard as update_status above.
      const existingForReschedule = await getAppointmentById(body.appointmentId as string);
      if (!existingForReschedule || filterByScope([existingForReschedule], buildScopeFromAuth(auth)).length === 0) {
        return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      }
      const { APPOINTMENT_SCHEDULING_ROLES } = await import('@/lib/appointment-status');
      if (!APPOINTMENT_SCHEDULING_ROLES.includes(auth.role as UserRole)) return forbidden();
      const newDateErr = validateFutureDate(body.newDate as string, body.newTime as string);
      if (newDateErr) return NextResponse.json({ error: newDateErr }, { status: 400 });
      const { rescheduleAppointment } = await import('@/lib/services/appointment-service');
      const result = await rescheduleAppointment(
        body.appointmentId as string,
        body.newDate as string,
        body.newTime as string,
      );
      if (!result) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
      return NextResponse.json({ appointment: result });
    }
    // Create new appointment
    if (!body.patientId || !body.providerId || !body.appointmentDate || !body.appointmentTime) {
      return NextResponse.json(
        { error: 'patientId, providerId, appointmentDate, and appointmentTime are required' },
        { status: 400 }
      );
    }
    // Future-date validation: a clinician booking yesterday's slot is almost
    // always a typo or a tampered client. The service-layer conflict check
    // doesn't cover this — past slots never overlap a future scheduled one.
    const dateErr = validateFutureDate(body.appointmentDate as string, body.appointmentTime as string);
    if (dateErr) return NextResponse.json({ error: dateErr }, { status: 400 });
    body.bookedBy = body.bookedBy || auth.sub;
    body.bookedByName = body.bookedByName || auth.name;
    // Tenancy is stamped from the verified auth claim, never trusted from the
    // client — see the matching comment in /api/referrals for the rationale.
    if (auth.orgId) {
      body.orgId = auth.orgId;
    } else if (!(auth.role === 'super_admin' || auth.role === 'government')) {
      delete body.orgId;
    }
    if (!body.facilityId && auth.hospitalId) body.facilityId = auth.hospitalId;
    const { createAppointment } = await import('@/lib/services/appointment-service');
    const appointment = await createAppointment(body as Parameters<typeof createAppointment>[0]);
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (err: unknown) {
    // Scheduling conflict errors should return 409
    const message = err instanceof Error ? err.message : '';
    if (message.toLowerCase().includes('conflict')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    logApiError('[API /appointments POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'appointment.create' });
