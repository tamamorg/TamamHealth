/**
 * POST /api/booking/request — the public submit.
 *
 * The order of operations here is the whole security posture of public
 * booking, so it is worth stating plainly:
 *
 *   1. Rate limit, then validate the hold.
 *   2. **Recompute availability.** The hold is a courtesy; this is the truth.
 *      A slot the front desk filled two minutes ago is caught here.
 *   3. Match against the patient index — but never *write* to it. An unmatched
 *      booking creates no `PatientDoc`; its identity lives on the appointment
 *      until a human links or registers it. Public traffic must not be able
 *      to put rows into the patient registry.
 *   4. Book through `createAppointment`, so `assertNoBookingConflicts` runs.
 *   5. Consume the hold, mint a reference, audit, notify best-effort.
 *
 * The response carries the reference and the appointment's own details and
 * nothing else — no patient id, no match confidence, no clinician's diary.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createAppointment } from '@/lib/services/appointment-service';
import { consumeHold, getLiveHold, verifySlotStillOpen } from '@/lib/services/booking-service';
import { getVisitReasonById, getVisitReasonBySlug } from '@/lib/services/visit-reason-service';
import { getProviderProfileByUserId } from '@/lib/services/provider-profile-service';
import { getHospitalById } from '@/lib/services/hospital-service';
import { matchPatient } from '@/lib/services/mpi-service';
import { logAuditSafe } from '@/lib/services/audit-service';
import { toHHMM, toMinutes } from '@/lib/booking/slot-engine';
import type { AppointmentDoc } from '@/lib/db-types';
import type { PatientClass } from '@/lib/db-types-booking';
import {
  resolvePractice, guardPublicRate, generateBookingReference,
} from '@/lib/booking/public-context';

export const dynamic = 'force-dynamic';

/** A match this strong is the same person; anything less waits for a human. */
const AUTO_LINK_SCORE = 0.92;

interface RequestBody {
  practice?: string;
  reason?: string;
  holdToken?: string;
  patientClass?: PatientClass;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  insurance?: { provider?: string; memberId?: string; groupId?: string };
  notes?: string;
  consentPrivacy?: boolean;
  consentSms?: boolean;
  /** Hidden field. A real patient never fills this in; a bot fills everything. */
  website?: string;
}

function trimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export async function POST(request: NextRequest) {
  const limited = await guardPublicRate(request, 'request', 6, 15 * 60_000);
  if (limited) return limited;

  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Honeypot. Answering 200 rather than 400 denies a scripted submitter the
  // signal it would need to learn which field gave it away.
  if (trimmed(body.website)) {
    return NextResponse.json({ reference: generateBookingReference(), status: 'requested' });
  }

  const resolved = await resolvePractice(body.practice || '');
  if ('error' in resolved) return resolved.error;
  const { policy, facilityId, orgId } = resolved.practice;

  // ── Identity ──
  const firstName = trimmed(body.firstName);
  const lastName = trimmed(body.lastName);
  const phone = trimmed(body.phone);
  const email = trimmed(body.email);
  const dateOfBirth = trimmed(body.dateOfBirth);
  if (!firstName || !lastName) {
    return NextResponse.json({ error: 'First and last name are required' }, { status: 400 });
  }
  if (!phone && !email) {
    return NextResponse.json({ error: 'A phone number or email is required' }, { status: 400 });
  }
  if (!body.consentPrivacy) {
    return NextResponse.json({ error: 'The privacy agreement must be accepted' }, { status: 400 });
  }

  // A second bucket keyed on the phone, so one number cannot open a dozen
  // requests from a dozen addresses.
  if (phone) {
    const perPhone = await guardPublicRate(request, 'request-phone', 3, 60 * 60_000, `${policy.publicSlug}:${phone}`);
    if (perPhone) return perPhone;
  }

  // ── The slot ──
  const hold = await getLiveHold(trimmed(body.holdToken));
  if (!hold) {
    return NextResponse.json(
      { error: 'That time is no longer held. Please pick a time again.', code: 'HOLD_EXPIRED' },
      { status: 409 },
    );
  }
  if (hold.facilityId !== facilityId) {
    return NextResponse.json({ error: 'Hold does not belong to this practice' }, { status: 400 });
  }

  const visitReason = await getVisitReasonById(body.reason || '')
    ?? await getVisitReasonBySlug(body.reason || '', orgId);
  if (!visitReason || !visitReason.isActive) {
    return NextResponse.json({ error: 'Visit reason not found' }, { status: 404 });
  }
  if (visitReason.requiresInsurance && !trimmed(body.insurance?.provider)) {
    return NextResponse.json({ error: 'Insurance details are required for this visit' }, { status: 400 });
  }

  const patientClass: PatientClass = body.patientClass === 'returning' ? 'returning' : 'new';

  // The recompute. Everything above was preparation; this is what stops a
  // double booking.
  const stillOpen = await verifySlotStillOpen({
    facilityId,
    orgId,
    visitReason,
    patientClass,
    channel: 'public',
    providerId: hold.providerId,
    date: hold.date,
    startTime: hold.startTime,
    ignoreHoldToken: hold.holdToken,
  });
  if (!stillOpen) {
    return NextResponse.json(
      { error: 'That time has just been taken. Please pick another.', code: 'SLOT_TAKEN' },
      { status: 409 },
    );
  }

  // ── Who is this? Match, never create. ──
  const candidates = await matchPatient(
    { firstName, surname: lastName, dateOfBirth: dateOfBirth || undefined, phone: phone || undefined },
    5,
    { role: 'org_admin', orgId, hospitalId: facilityId },
  ).catch(() => []);
  const best = candidates[0];
  const linked = best && best.score >= AUTO_LINK_SCORE ? best.patient : null;

  const [profile, facility] = await Promise.all([
    getProviderProfileByUserId(hold.providerId).catch(() => null),
    getHospitalById(facilityId, { role: 'org_admin', orgId }).catch(() => null),
  ]);

  const reference = generateBookingReference();
  const nowIso = new Date().toISOString();
  const patientName = `${firstName} ${lastName}`.trim();

  const appointmentInput: Omit<AppointmentDoc, '_id' | '_rev' | 'type' | 'createdAt' | 'updatedAt'> = {
    // An unmatched booking carries no patient id. The desk links it later; the
    // name below is what the requester typed, not a chart.
    patientId: linked?._id ?? '',
    patientName: linked ? `${linked.firstName} ${linked.surname}`.trim() : patientName,
    patientPhone: phone || undefined,
    providerId: hold.providerId,
    providerName: profile?.displayName || 'Assigned clinician',
    facilityId,
    facilityName: facility?.name || 'Clinic',
    facilityLevel: facility?.facilityLevel ?? 'county',
    appointmentDate: hold.date,
    appointmentTime: hold.startTime,
    endTime: toHHMM(toMinutes(hold.startTime) + visitReason.durationMinutes),
    duration: visitReason.durationMinutes,
    appointmentType: visitReason.appointmentType,
    priority: 'routine',
    department: visitReason.department,
    reason: visitReason.name,
    // 'request' keeps a public submission out of the clinician's confirmed
    // diary until a human looks at it. That is the default for a reason.
    status: policy.confirmationMode === 'auto' ? 'scheduled' : 'requested',
    reminderSent: false,
    isRecurring: false,
    // Attributed to the patient, not to a staff account. Every row in the
    // audit trail and the day list should say plainly that nobody at the desk
    // typed this one in.
    bookedBy: 'public_booking',
    bookedByName: patientName,
    state: facility?.state || '',
    county: facility?.town || undefined,
    orgId,
    source: 'public_widget',
    isNewPatient: patientClass === 'new',
    visitReasonId: visitReason._id,
    visitReasonName: visitReason.name,
    requester: {
      firstName, lastName,
      email: email || undefined,
      phone: phone || undefined,
      dateOfBirth: dateOfBirth || undefined,
    },
    insuranceSubmitted: trimmed(body.insurance?.provider)
      ? {
        provider: trimmed(body.insurance?.provider),
        memberId: trimmed(body.insurance?.memberId),
        groupId: trimmed(body.insurance?.groupId) || undefined,
        verificationStatus: 'pending',
      }
      : undefined,
    patientNotes: trimmed(body.notes) || undefined,
    consent: {
      privacyAcceptedAt: nowIso,
      smsOptIn: Boolean(body.consentSms),
      policyVersion: policy.updatedAt || nowIso,
    },
    bookingReference: reference,
  };

  let appointment: AppointmentDoc;
  try {
    appointment = await createAppointment(appointmentInput);
  } catch (err) {
    // The guard rejected it after all — a staff booking landed between our
    // recompute and this write. Tell the patient to pick again rather than
    // leaving them on a spinner.
    const message = err instanceof Error ? err.message : 'Could not book that time';
    return NextResponse.json({ error: message, code: 'SLOT_TAKEN' }, { status: 409 });
  }

  await consumeHold(hold.holdToken);

  // Everything the requester typed already lives on the appointment itself
  // (`requester`, `insuranceSubmitted`, `patientNotes`, `visitReasonName`),
  // so the desk reads it from the booking row rather than a parallel doc.
  // The one fact with nowhere else to go is the near-miss match list — it is
  // named in the audit detail so whoever links an unmatched booking can see
  // what the matcher considered without it deciding for them.
  const nearMisses = !linked && candidates.length
    ? candidates.slice(0, 3)
      .map(c => `${c.patient.firstName} ${c.patient.surname} (${Math.round(c.score * 100)}%)`)
      .join(', ')
    : '';

  await logAuditSafe(
    'PUBLIC_BOOKING_REQUEST',
    undefined,
    'Online booking',
    `${reference}: ${visitReason.name} on ${hold.date} ${hold.startTime}` +
    ` at ${facility?.name || facilityId}${linked ? ' (matched existing chart)' : ' (unmatched)'}` +
    (nearMisses ? ` — possible existing charts: ${nearMisses}` : ''),
  );

  return NextResponse.json({
    reference,
    status: appointment.status,
    date: hold.date,
    startTime: hold.startTime,
    durationMinutes: visitReason.durationMinutes,
    providerName: profile?.displayName || 'Assigned clinician',
    facilityName: facility?.name || 'Clinic',
    visitReasonName: visitReason.name,
  });
}
