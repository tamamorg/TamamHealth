/**
 * GET /api/patient-portal/booking/slots?reason=<visitReasonId>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The openings the front desk would see, for the signed-in patient's own
 * facility. Computed by the same slot engine on the `portal` channel. The range
 * is clamped to [today, policy horizon] and to 31 days per call. Free/busy
 * only: no patient data and no facility fields in the response.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logApiError } from '@/modules/identity';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { resolvePortalBookingContext, findOfferedReason } from '@/lib/patient-portal-booking';
import { getAvailableSlots, facilityNow } from '@/lib/services/booking-service';
import { getEffectiveBookingPolicy } from '@/lib/services/booking-policy-service';
import { addDays, daysBetween } from '@/lib/booking/slot-engine';

export const dynamic = 'force-dynamic';

const MAX_DAYS = 31;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  const limited = await guardPortalWrite(auth.sub, 'portal-booking-read', 60, 60_000);
  if (limited) return limited;

  const q = req.nextUrl.searchParams;
  const reasonId = q.get('reason') || '';
  if (!reasonId) {
    return NextResponse.json({ error: 'A visit reason is required' }, { status: 400 });
  }
  const rawFrom = q.get('from');
  const rawTo = q.get('to');
  for (const value of [rawFrom, rawTo]) {
    if (value && (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) {
      return NextResponse.json({ error: 'Dates must be in YYYY-MM-DD format' }, { status: 400 });
    }
  }

  try {
    const ctx = await resolvePortalBookingContext(auth.sub);
    if (!ctx) {
      return NextResponse.json(
        { error: 'Your account is not linked to a facility yet. Please contact your facility.' },
        { status: 409 },
      );
    }
    const visitReason = await findOfferedReason(ctx, reasonId);
    if (!visitReason) {
      return NextResponse.json({ error: 'Visit reason not found' }, { status: 404 });
    }

    const today = facilityNow().date;
    const policy = await getEffectiveBookingPolicy(ctx.facilityId, ctx.orgId);
    const horizon = addDays(today, policy.maxAdvanceDays);

    // Never look backwards, never past the horizon, never more than 31 days.
    let from = rawFrom || today;
    if (from < today) from = today;
    let to = rawTo || addDays(from, 6);
    if (to > horizon) to = horizon;
    const cap = addDays(from, MAX_DAYS - 1);
    if (to > cap) to = cap;
    if (to < from || daysBetween(from, to) < 0) {
      return NextResponse.json({ slots: [], from, to });
    }

    const result = await getAvailableSlots({
      facilityId: ctx.facilityId,
      orgId: ctx.orgId,
      visitReason,
      patientClass: ctx.patientClass,
      channel: 'portal',
      from,
      to,
    });

    const { bookableProviderIds } = await import('@/lib/patient-portal-booking');
    const providers = await bookableProviderIds(ctx.facilityId);
    // One open visit per patient per day at a facility (assertNoBookingConflicts).
    // Offering times on a day the patient already has one only produced a
    // 409 on every pick; drop those days and say why instead.
    const { getAppointmentsByPatient } = await import('@/lib/services/appointment-service');
    const { APPOINTMENT_SLOT_RELEASED_STATUSES } = await import('@/lib/appointment-status');
    const own = await getAppointmentsByPatient(auth.sub).catch(() => []);
    const ownVisitDates = [...new Set(own
      .filter(a => a.orgId === ctx.orgId
        && (!a.facilityId || a.facilityId === ctx.facilityId)
        && !APPOINTMENT_SLOT_RELEASED_STATUSES.includes(a.status)
        && a.appointmentDate >= from && a.appointmentDate <= to)
      .map(a => a.appointmentDate))].sort();
    const blockedDates = new Set(ownVisitDates);
    return NextResponse.json({
      ownVisitDates,
      slots: result.slots.filter(s => providers.has(s.providerId) && !blockedDates.has(s.date)).map(s => ({
        providerId: s.providerId,
        providerName: s.providerName,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        durationMinutes: s.durationMinutes,
      })),
      from,
      to,
    });
  } catch (err) {
    logApiError('[patient-portal/booking/slots]', err);
    return NextResponse.json({ error: 'Could not load available times' }, { status: 500 });
  }
}
