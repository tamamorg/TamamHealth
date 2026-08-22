/**
 * API: /api/admin/conflicts
 * GET  — list conflicts queued for human reconciliation
 * POST — enqueue a conflict (used by the sync pipeline when it detects one)
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole, ConflictQueueDoc } from '@/lib/db-types';

const ADMIN_ROLES: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent', 'hrio'];

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ADMIN_ROLES)) return forbidden();

    const url = new URL(request.url);
    const status = (url.searchParams.get('status') as ConflictQueueDoc['status']) || 'pending';
    const risk = (url.searchParams.get('risk') as ConflictQueueDoc['risk']) || undefined;

    const { listConflicts } = await import('@/lib/services/conflict-service');
    const conflicts = await listConflicts({
      status,
      risk,
      orgId: auth.role !== 'super_admin' ? auth.orgId : undefined,
    });

    return NextResponse.json({ conflicts, total: conflicts.length });
  } catch (err) {
    logApiError('[API /admin/conflicts GET]', err);
    return serverError();
  }
}

async function postHandler(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ADMIN_ROLES)) return forbidden();

    let body: {
      resourceType?: string;
      resourceId?: string;
      winningRev?: string;
      losingRevs?: string[];
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.resourceType || !body.resourceId || !body.winningRev || !Array.isArray(body.losingRevs)) {
      return NextResponse.json(
        { error: 'resourceType, resourceId, winningRev, losingRevs are required' },
        { status: 400 }
      );
    }

    const { enqueueConflict } = await import('@/lib/services/conflict-service');
    const conflict = await enqueueConflict({
      resourceType: body.resourceType,
      resourceId: body.resourceId,
      winningRev: body.winningRev,
      losingRevs: body.losingRevs,
      orgId: auth.orgId,
    });

    return NextResponse.json({ conflict }, { status: 201 });
  } catch (err) {
    logApiError('[API /admin/conflicts POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'conflict.create' });
