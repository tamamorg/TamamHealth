import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';

const ACCOUNT_PROVISIONING_ROLES = ['super_admin', 'org_admin'] as const;

/**
 * Server-authoritative facility choices for central account provisioning.
 * This endpoint must never fall back to a browser replica.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, [...ACCOUNT_PROVISIONING_ROLES])) return forbidden();

    const requestedOrgId = new URL(request.url).searchParams.get('orgId')?.trim();
    const orgId = auth.role === 'super_admin' ? requestedOrgId : auth.orgId;
    if (!orgId) {
      return NextResponse.json({ facilities: [], total: 0 }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const { getAllHospitals, isFacilityActive } = await import('@/lib/services/hospital-service');
    const visible = await getAllHospitals({ role: auth.role, orgId });
    const facilities = visible
      .filter(facility => facility.orgId === orgId && isFacilityActive(facility))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ facilities, total: facilities.length }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    logApiError('[API /hospitals/assignment-options GET]', error);
    return serverError();
  }
}
