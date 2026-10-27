import { logApiError } from '@/modules/identity';
import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { appointmentsDB } from '@/lib/db';
import { logAuditSafe } from '@/lib/services/audit-service';
import { emitSyncEvent } from '@/lib/services/sync-event-service';
import type { AppointmentDoc, AppointmentStatus } from '@/lib/db-types';
import { demoFallbackEnabled, logDemoFallback, getDemoAppointmentsByPatient, recordDemoAppointment } from '@/lib/patient-portal-demo';
import { validatePortalAppointment, portalDocId } from '@/lib/patient-portal-write-validation';
import type { PatientTokenPayload } from '@/lib/patient-portal-auth';

const SLOT_TAKEN_MESSAGE = 'That time was just taken. Please pick another time.';
const CONTACT_PREFERENCES = new Set(['call', 'sms', 'either']);

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
    logApiError('[patient-portal/appointments]', err);
    return NextResponse.json({ error: 'Your appointments could not be loaded. Try again.' }, { status: 500 });
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

  // New-style request: the patient picked a visit reason and a real slot.
  // The legacy body (no visitReasonId) falls through to the free-form path.
  if (typeof body.visitReasonId === 'string' && body.visitReasonId.trim()) {
    return createSlotRequest(auth, body);
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
  const id = portalDocId(body._id, 'apt', uuidv4);
  const validated = validatePortalAppointment(body);
  if (!validated.ok) {
    return NextResponse.json({ error: 'Invalid appointment request', fields: validated.fields }, { status: 400 });
  }

  // The clinic the request is for owns it. Without an organisation the request
  // is invisible to every front desk and never reaches a clinic device — see
  // lib/patient-portal-ownership.ts.
  const { resolvePortalOwnership, missingOwnership } = await import('@/lib/patient-portal-ownership');
  const ownership = await resolvePortalOwnership(auth.sub, validated.value.facilityId);
  if (ownership.foreignFacility) {
    // A real facility, but another organisation's: the request would land in
    // that organisation's front-desk queue from a patient it has never seen.
    return NextResponse.json(
      { error: 'Invalid appointment request', fields: { facilityId: 'This facility cannot be booked from your portal.' } },
      { status: 400 },
    );
  }
  if (missingOwnership(ownership) && !demoFallbackEnabled()) {
    logApiError('[patient-portal/appointments POST]', new Error(`No organisation resolved for patient ${auth.sub}`));
    return NextResponse.json({ error: 'Your request was not sent. Contact your facility.' }, { status: 503 });
  }

  const capped = await pendingRequestCap(auth.sub);
  if (capped) return capped;

  // The facility's real name, from its record — never the client's text.
  let facilityName = '';
  const resolvedFacilityId = ownership.facilityId || validated.value.facilityId;
  try {
    const { getHospitalById } = await import('@/lib/services/hospital-service');
    facilityName = (await getHospitalById(resolvedFacilityId))?.name ?? '';
  } catch { /* the id alone identifies it */ }

  const doc: AppointmentDoc = {
    _id: id,
    type: 'appointment',
    orgId: ownership.orgId,
    patientId: auth.sub,
    patientName: auth.name,
    patientPhone: typeof body.patientPhone === 'string' ? body.patientPhone : undefined,
    // No provider: a slot-less request names nobody. Accepting the client's
    // providerId/providerName let a patient file a request "with" any
    // clinician, which the desk then read as a staff booking.
    providerId: '',
    providerName: '',
    // The facility the server resolved, not the one the request named: an id
    // it could not verify falls back to the patient's own facility.
    facilityId: resolvedFacilityId,
    facilityName,
    facilityLevel: validated.value.facilityLevel,
    appointmentDate: validated.value.appointmentDate,
    appointmentTime: validated.value.appointmentTime,
    duration: validated.value.duration,
    appointmentType: validated.value.appointmentType,
    priority: validated.value.priority,
    department: validated.value.department,
    reason: validated.value.reason,
    status: 'requested' as AppointmentStatus,
    reminderSent: false,
    isRecurring: false,
    bookedBy: auth.sub,
    bookedByName: auth.name,
    source: 'portal',
    state: ownership.patient?.state || '',
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
        // Generic on purpose: the guard's own message names the patient who
        // holds the time, and that is another patient's data.
        return NextResponse.json({ error: SLOT_TAKEN_MESSAGE, code: 'slot_unavailable' }, { status: 409 });
      }
      throw conflict;
    }

    const db = appointmentsDB();
    const resp = await db.put(doc);
    doc._rev = resp.rev;

    await logAuditSafe(
      'PATIENT_REQUEST_APPOINTMENT', auth.sub, auth.name,
      `Patient ${auth.sub} requested appointment ${doc._id} on ${doc.appointmentDate || '(no date)'}`,
      true,
      { orgId: doc.orgId, hospitalId: doc.facilityId, patientId: auth.sub, resourceType: 'appointment', resourceId: doc._id },
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
    logApiError('[patient-portal/appointments POST]', err);
    return NextResponse.json({ error: 'Your appointment request was not sent. Try again.' }, { status: 500 });
  }
}

/**
 * A request for a specific, server-verified slot.
 *
 * Facility and organisation come from the patient's own record. Provider name,
 * duration, end time and the reason text are all resolved here from the slot
 * and the visit reason; the client supplies only ids, a date/time and its own
 * contact details. The request still lands as 'requested': a person at the
 * front desk contacts the patient and confirms.
 */
/** Pending requests one patient may hold at once. Each one blocks a slot (or
 *  a desk callback) until reception answers it, so an unbounded number lets a
 *  single account fill the diary. */
const MAX_PENDING_REQUESTS = 3;

async function pendingRequestCap(patientId: string): Promise<NextResponse | null> {
  try {
    const { getAppointmentsByPatient } = await import('@/lib/services/appointment-service');
    const { facilityNow } = await import('@/lib/services/booking-service');
    const today = facilityNow().date;
    const pending = (await getAppointmentsByPatient(patientId))
      .filter(a => a.status === 'requested' && (a.appointmentDate || today) >= today);
    if (pending.length < MAX_PENDING_REQUESTS) return null;
  } catch {
    return null; // a failed count must not block care; the desk still triages
  }
  return NextResponse.json({
    error: `You already have ${MAX_PENDING_REQUESTS} requests waiting for the facility. Wait for the facility to contact you, or cancel a request first.`,
    code: 'too_many_requests',
  }, { status: 429 });
}

async function createSlotRequest(auth: PatientTokenPayload, body: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const fields: Record<string, string> = {};
  const providerId = str(body.providerId);
  const appointmentDate = str(body.appointmentDate);
  const appointmentTime = str(body.appointmentTime);
  const patientNotes = str(body.patientNotes);
  const patientPhone = str(body.patientPhone);
  const preference = body.contactPreference === undefined || body.contactPreference === ''
    ? undefined : body.contactPreference;

  if (!providerId) fields.providerId = 'Choose a time with a provider';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate) || Number.isNaN(Date.parse(`${appointmentDate}T00:00:00Z`))) {
    fields.appointmentDate = 'Use a valid date in YYYY-MM-DD format';
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(appointmentTime)) fields.appointmentTime = 'Use HH:MM in 24-hour time';
  if (preference !== undefined && !(typeof preference === 'string' && CONTACT_PREFERENCES.has(preference))) {
    fields.contactPreference = 'Choose call, text message, or either';
  }
  if (patientNotes.length > 2_000) fields.patientNotes = 'Must be 2000 characters or fewer';
  if (patientPhone.length > 32) fields.patientPhone = 'Phone number is too long';
  if (Object.keys(fields).length > 0) {
    return NextResponse.json({ error: 'Invalid appointment request', fields }, { status: 400 });
  }

  try {
    const { resolvePortalBookingContext, findOfferedReason } = await import('@/lib/patient-portal-booking');
    const ctx = await resolvePortalBookingContext(auth.sub);
    if (!ctx) {
      logApiError('[patient-portal/appointments POST]', new Error(`No organisation or facility resolved for patient ${auth.sub}`));
      return NextResponse.json({ error: 'Your request was not sent. Contact your facility.' }, { status: 503 });
    }
    const capped = await pendingRequestCap(auth.sub);
    if (capped) return capped;
    const visitReason = await findOfferedReason(ctx, str(body.visitReasonId));
    if (!visitReason) {
      return NextResponse.json(
        { error: 'Invalid appointment request', fields: { visitReasonId: 'That visit reason is not available.' } },
        { status: 400 },
      );
    }

    const taken = () => NextResponse.json({ error: SLOT_TAKEN_MESSAGE, code: 'slot_unavailable' }, { status: 409 });

    const { verifySlotStillOpen, getAvailableSlots } = await import('@/lib/services/booking-service');
    const open = await verifySlotStillOpen({
      facilityId: ctx.facilityId,
      orgId: ctx.orgId,
      visitReason,
      patientClass: ctx.patientClass,
      channel: 'portal',
      providerId,
      date: appointmentDate,
      startTime: appointmentTime,
    });
    if (!open) return taken();
    // Same staff rule as the slot list: never book a clinician the desk
    // cannot see or assign at this facility.
    const { bookableProviderIds } = await import('@/lib/patient-portal-booking');
    if (!(await bookableProviderIds(ctx.facilityId)).has(providerId)) return taken();

    // The provider's name comes from the slot, not from the client.
    const { slots } = await getAvailableSlots({
      facilityId: ctx.facilityId,
      orgId: ctx.orgId,
      visitReason,
      patientClass: ctx.patientClass,
      channel: 'portal',
      from: appointmentDate,
      to: appointmentDate,
      providerIds: [providerId],
    });
    const slot = slots.find(s => s.startTime === appointmentTime);
    if (!slot) return taken();

    const { toHHMM, toMinutes } = await import('@/lib/booking/slot-engine');
    const now = new Date().toISOString();
    const doc: AppointmentDoc = {
      _id: portalDocId(body._id, 'apt', uuidv4),
      type: 'appointment',
      orgId: ctx.orgId,
      patientId: auth.sub,
      patientName: auth.name,
      patientPhone: patientPhone || undefined,
      contactPreference: preference as AppointmentDoc['contactPreference'],
      providerId: slot.providerId,
      providerName: slot.providerName,
      facilityId: ctx.facilityId,
      facilityName: ctx.facilityName || slot.facilityName,
      facilityLevel: ctx.facilityLevel,
      appointmentDate,
      appointmentTime,
      endTime: toHHMM(toMinutes(appointmentTime) + visitReason.durationMinutes),
      duration: visitReason.durationMinutes,
      appointmentType: visitReason.appointmentType || 'general',
      priority: 'routine',
      department: visitReason.department || 'General',
      reason: visitReason.department ? `${visitReason.name} (${visitReason.department})` : visitReason.name,
      visitReasonId: visitReason._id,
      visitReasonName: visitReason.name,
      isNewPatient: ctx.patientClass === 'new',
      patientNotes: patientNotes || undefined,
      status: 'requested' as AppointmentStatus,
      source: 'portal',
      reminderSent: false,
      isRecurring: false,
      bookedBy: auth.sub,
      bookedByName: auth.name,
      state: '',
      createdAt: now,
      updatedAt: now,
      createdBy: auth.sub,
    };
    // Default to the number on the patient's record when none was typed.
    if (!doc.patientPhone && ctx.patientPhone) doc.patientPhone = ctx.patientPhone;

    const { assertNoBookingConflicts, BookingConflictError } = await import('@/lib/services/appointment-service');
    try {
      await assertNoBookingConflicts(doc);
    } catch (conflict) {
      if (conflict instanceof BookingConflictError) return taken();
      throw conflict;
    }

    const resp = await appointmentsDB().put(doc);
    doc._rev = resp.rev;

    await logAuditSafe(
      'PATIENT_REQUEST_APPOINTMENT', auth.sub, auth.name,
      `Patient ${auth.sub} requested appointment ${doc._id} on ${doc.appointmentDate} at ${doc.appointmentTime}`,
      true,
      { orgId: doc.orgId, hospitalId: doc.facilityId, patientId: auth.sub, resourceType: 'appointment', resourceId: doc._id },
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
    logApiError('[patient-portal/appointments POST]', err);
    return NextResponse.json({ error: 'Your appointment request was not sent. Try again.' }, { status: 500 });
  }
}
