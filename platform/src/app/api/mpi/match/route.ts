/**
 * API: POST /api/mpi/match
 *
 * Master Patient Index matcher. POST a partial patient identity; returns
 * candidates ranked by confidence. Used to dedupe at registration time and
 * to route cross-facility referrals.
 *
 * Body:
 *   {
 *     firstName?, surname?, dateOfBirth?, phone?,
 *     nationalId?, geocodeId?, hospitalNumber?, countryId?
 *   }
 *
 * Response:
 *   {
 *     candidates: [{ patient, score, method, reasons }]
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

const ALLOWED: UserRole[] = [
  'super_admin', 'org_admin', 'government', 'doctor', 'clinical_officer',
  'nurse', 'front_desk', 'medical_superintendent', 'hrio', 'data_entry_clerk',
];

async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ALLOWED)) return forbidden();

    let body: Record<string, string | undefined>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { matchPatient } = await import('@/lib/services/mpi-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const candidates = await matchPatient({
      firstName: body.firstName,
      surname: body.surname,
      dateOfBirth: body.dateOfBirth,
      phone: body.phone,
      nationalId: body.nationalId,
      geocodeId: body.geocodeId,
      hospitalNumber: body.hospitalNumber,
      countryId: body.countryId,
    }, 10, buildScopeFromAuth(auth));

    return NextResponse.json({ candidates });
  } catch (err) {
    logApiError('[API /mpi/match POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'mpi.match' });
