/**
 * API: POST /api/admin/dhis2-push
 * Generates the current period's DHIS2 dataset and pushes it to the
 * configured DHIS2 server. Admin/government roles only.
 *
 * Body: { period?: string }  — defaults to current YYYYMM
 *
 * For scheduled pushes, configure a cron sidecar that calls this endpoint
 * weekly (see docker-compose.yml documentation).
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

// DHIS2 export is national-aggregate (orgUnit "SS") and crosses every
// organization in the platform. Allowing org_admin to push it would expose
// the other tenants' aggregate counts. Restrict to roles whose data scope
// is naturally national/MoH: super_admin, government, and the in-facility
// reporting roles (HRIO, medical superintendent) that file national
// returns up to MoH.
const ALLOWED: UserRole[] = ['super_admin', 'government', 'hrio', 'medical_superintendent'];

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ALLOWED)) return forbidden();

    let body: { period?: string } = {};
    try { body = await request.json(); } catch { /* optional body */ }

    const period = body.period || currentPeriod();

    const { generateDHIS2Export, pushDataSetToDHIS2 } = await import('@/lib/services/dhis2-export-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const dataset = await generateDHIS2Export(period, buildScopeFromAuth(auth));
    const result = await pushDataSetToDHIS2(dataset);

    return NextResponse.json({
      period,
      dataValues: dataset.dataValues.length,
      result,
    }, { status: result.ok ? 200 : 502 });
  } catch (err) {
    logApiError('[API /admin/dhis2-push POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'admin.dhis2.push' });
