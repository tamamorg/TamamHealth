/**
 * GET /api/patient-portal/booking/reasons
 *
 * The visit reasons the signed-in patient may request, at the facility on
 * their own record. Facility, organisation and patient class are all resolved
 * server-side; the client names nothing.
 *
 * An empty `reasons` list means the facility offers nothing to this kind of
 * patient online (the portal should fall back to "ask the facility to call me").
 */
import { NextRequest, NextResponse } from 'next/server';
import { logApiError } from '@/modules/identity';
import { verifyPatientToken, guardPortalWrite } from '@/lib/patient-portal-auth';
import { resolvePortalBookingContext } from '@/lib/patient-portal-booking';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  const limited = await guardPortalWrite(auth.sub, 'portal-booking-read', 60, 60_000);
  if (limited) return limited;

  try {
    const ctx = await resolvePortalBookingContext(auth.sub);
    if (!ctx) {
      return NextResponse.json(
        { error: 'Your account is not linked to a facility yet. Contact your facility.' },
        { status: 409 },
      );
    }

    const { getVisitReasonsForFacility, bookableBy } = await import('@/lib/services/visit-reason-service');
    const menu = await getVisitReasonsForFacility(ctx.facilityId, ctx.orgId);
    const reasons = bookableBy(menu.filter(r => r.isActive), ctx.patientClass)
      .map(r => ({
        id: r._id,
        name: r.name,
        durationMinutes: r.durationMinutes,
        ...(r.description ? { description: r.description } : {}),
      }));

    return NextResponse.json({
      facility: { id: ctx.facilityId, name: ctx.facilityName },
      reasons,
      patientClass: ctx.patientClass,
    });
  } catch (err) {
    logApiError('[patient-portal/booking/reasons]', err);
    return NextResponse.json({ error: 'Visit reasons not loaded. Reload the page to try again.' }, { status: 500 });
  }
}
