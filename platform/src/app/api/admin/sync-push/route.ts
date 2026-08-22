/**
 * API: POST /api/admin/sync-push
 * Manually drain the facility outbox to the configured country-node endpoint.
 * Used by the sync button in the admin UI. Also safe to call from a cron job.
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

const ALLOWED: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent', 'hrio'];

async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ALLOWED)) return forbidden();

    const { pushPendingToCountryNode } = await import('@/lib/services/sync-event-service');
    const result = await pushPendingToCountryNode();
    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
    }, { status: result.error ? 502 : 200 });
  } catch (err) {
    logApiError('[API /admin/sync-push POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'admin.sync.push' });
