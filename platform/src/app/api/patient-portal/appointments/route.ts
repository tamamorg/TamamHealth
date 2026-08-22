import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { appointmentsDB } from '@/lib/db';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import type { AppointmentDoc, AppointmentStatus } from '@/lib/db-types';
import { demoFallbackEnabled, logDemoFallback, getDemoAppointmentsByPatient, recordDemoAppointment } from '@/lib/patient-portal-demo';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getAppointmentsByPatient } = await import('@/lib/services/appointment-service');
    const appointments = await getAppointmentsByPatient(auth.sub);

    return NextResponse.json({ appointments });
  } catch (err) {
    if (demoFallbackEnabled()) {
      logDemoFallback('appointments', err);
      return NextResponse.json({ appointments: await getDemoAppointmentsByPatient(auth.sub) });
    }
    console.error('[patient-portal/appointments]', err);
    return NextResponse.json({ error: 'Failed to fetch appointments' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  // Tighter than the per-patient floor: each request reaches the front desk as work, so this is a
  // handfuls-per-visit action and a strict cap never touches real use.
  const limited = await guardPortalWrite(auth.sub, 'portal-appointment', 10, 5 * 60_000);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Patient-initiated requests land in 'requested' for front-desk triage.
  //
  // The conflict guard runs on this path (see below). It used to be skipped —
  // the route wrote straight to the database on the reasoning that the patient
  // app supplies no provider or booker identity. That was survivable while
  // every request was read by a human before it meant anything, but a portal
  // that shows real bookable times is a real double-booking path: two patients
  // pick the same 10:30 and one of them gets a phone call. The guard tolerates
  // the missing identities on its own (an empty providerId is nothing to
  // collide on), so there was never anything to bypass it for.
  const now = new Date().toISOString();
  const id = (typeof body._id === 'string' && body._id) || `apt-${uuidv4()}`;

  const doc: AppointmentDoc = {
    _id: id,
    type: 'appointment',
    patientId: auth.sub,
    patientName: auth.name,
    patientPhone: typeof body.patientPhone === 'string' ? body.patientPhone : undefined,
    providerId: typeof body.providerId === 'string' ? body.providerId : '',
    providerName: typeof body.providerName === 'string' ? body.providerName : '',
    facilityId: typeof body.facilityId === 'string' ? body.facilityId : '',
    facilityName: typeof body.facilityName === 'string' ? body.facilityName : '',
    facilityLevel: (typeof body.facilityLevel === 'string' ? body.facilityLevel : 'county') as AppointmentDoc['facilityLevel'],
    appointmentDate: typeof body.appointmentDate === 'string' ? body.appointmentDate : '',
    appointmentTime: typeof body.appointmentTime === 'string' ? body.appointmentTime : '',
    duration: typeof body.duration === 'number' ? body.duration : 30,
    appointmentType: (typeof body.appointmentType === 'string' ? body.appointmentType : 'general') as AppointmentDoc['appointmentType'],
    priority: (typeof body.priority === 'string' ? body.priority : 'routine') as AppointmentDoc['priority'],
    department: typeof body.department === 'string' ? body.department : 'General',
    reason: typeof body.reason === 'string' ? body.reason : '',
    status: 'requested' as AppointmentStatus,
    reminderSent: false,
    isRecurring: false,
    bookedBy: auth.sub,
    bookedByName: auth.name,
    state: typeof body.state === 'string' ? body.state : '',
    createdAt: now,
    updatedAt: now,
    createdBy: auth.sub,
  };

  try {
    const { assertNoBookingConflicts, BookingConflictError } = await import('@/lib/services/appointment-service');
    try {
      await assertNoBookingConflicts(doc);
    } catch (conflict) {
      if (conflict instanceof BookingConflictError) {
        // 409, not 500: the request was well-formed, the time just went. The
        // patient app shows this message and refreshes the slot list.
        return NextResponse.json({ error: conflict.message, code: 'slot_unavailable' }, { status: 409 });
      }
      throw conflict;
    }

    const db = appointmentsDB();
    const resp = await db.put(doc);
    doc._rev = resp.rev;

    await logAuditSafe(
      'PATIENT_REQUEST_APPOINTMENT', auth.sub, auth.name,
      `Patient ${auth.sub} requested appointment ${doc._id} on ${doc.appointmentDate || '(no date)'}`
    );
    emitSyncEvent({
      resourceType: 'appointment',
      resourceId: doc._id,
      operation: 'create',
      resourceVersion: doc._rev,
      userId: auth.sub,
      username: auth.name,
      hospitalId: doc.facilityId,
    });

    return NextResponse.json({ ok: true, id: doc._id, appointment: doc }, { status: 201 });
  } catch (err) {
    if (demoFallbackEnabled()) {
      // No database to persist to — keep the request for this process's
      // lifetime so it shows up in the patient's own appointment list, same
      // as a real booking would.
      logDemoFallback('appointments POST', err);
      recordDemoAppointment(doc);
      return NextResponse.json({ ok: true, id: doc._id, appointment: doc }, { status: 201 });
    }
    console.error('[patient-portal/appointments POST]', err);
    return NextResponse.json({ error: 'Failed to create appointment request' }, { status: 500 });
  }
}
