/**
 * GET /api/booking/slots
 *
 * The public availability read. Everything the patient-facing grids draw comes
 * from here, computed by the same `computeSlots` the front desk uses — a slot
 * offered on a practice's website is a slot the desk would also have offered.
 *
 * Query: practice, reason, patientClass, modality, from, to, provider?
 *
 * Returns free/busy only. No names, no reasons, nothing about who is in the
 * diary — see `publicSlotView`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getAvailableSlots } from '@/lib/services/booking-service';
import { getVisitReasonById, getVisitReasonBySlug } from '@/lib/services/visit-reason-service';
import { addDays, daysBetween } from '@/lib/booking/slot-engine';
import { facilityNow } from '@/lib/services/booking-service';
import type { PatientClass } from '@/lib/db-types-booking';
import { resolvePractice, publicSlotView, guardPublicRate } from '@/lib/booking/public-context';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const limited = await guardPublicRate(request, 'slots', 120, 60_000);
  if (limited) return limited;

  const q = request.nextUrl.searchParams;
  const practiceSlug = q.get('practice') || '';
  const resolved = await resolvePractice(practiceSlug);
  if ('error' in resolved) return resolved.error;
  const { policy, facilityId, orgId } = resolved.practice;

  const reasonKey = q.get('reason') || '';
  if (!reasonKey) {
    return NextResponse.json({ error: 'A visit reason is required' }, { status: 400 });
  }
  // Accept either the document id or the slug — the practice page links by
  // slug, the embed round-trips the id.
  const visitReason = await getVisitReasonById(reasonKey)
    ?? await getVisitReasonBySlug(reasonKey, orgId);
  if (!visitReason || !visitReason.isActive) {
    return NextResponse.json({ error: 'Visit reason not found' }, { status: 404 });
  }

  const patientClass: PatientClass = q.get('patientClass') === 'returning' ? 'returning' : 'new';
  // A reason that is not offered to this kind of patient must not quietly
  // return an empty list — that reads as "fully booked" rather than "not for
  // you", and the page can say the right thing with a distinct code.
  const offered = patientClass === 'new'
    ? visitReason.availableToNewPatients
    : visitReason.availableToReturningPatients;
  if (!offered) {
    return NextResponse.json({ slots: [], notOfferedToPatientClass: true, from: '', to: '' });
  }

  const today = facilityNow().date;
  const requestedFrom = q.get('from') || today;
  // Never look backwards, whatever the caller asks for.
  const from = requestedFrom < today ? today : requestedFrom;
  const horizon = addDays(today, policy.maxAdvanceDays);
  const requestedTo = q.get('to') || addDays(from, 6);
  const to = requestedTo > horizon ? horizon : requestedTo;

  if (daysBetween(from, to) > 60) {
    return NextResponse.json({ error: 'Range too wide' }, { status: 400 });
  }
  if (to < from) {
    return NextResponse.json({ slots: [], from, to, beyondHorizon: true });
  }

  const providerParam = q.get('provider');

  const result = await getAvailableSlots({
    facilityId,
    orgId,
    visitReason,
    patientClass,
    // Always the strict channel here: a window must have opted into online
    // booking, and every policy rule (lead time, horizon, buffers) applies.
    channel: 'public',
    from,
    to,
    providerIds: providerParam ? [providerParam] : undefined,
  });

  return NextResponse.json({
    slots: result.slots.map(publicSlotView),
    from: result.from,
    to: result.to,
    durationMinutes: visitReason.durationMinutes,
  });
}
