/**
 * API: /api/admin/conflicts/:id
 * POST — resolve or dismiss a queued conflict.
 * Body: { action: 'resolve' | 'dismiss', chosenRev?: string, note?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

const ADMIN_ROLES: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent', 'hrio'];

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, ADMIN_ROLES)) return forbidden();

    let body: { action?: string; chosenRev?: string; note?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.action !== 'resolve' && body.action !== 'dismiss') {
      return NextResponse.json(
        { error: "action must be 'resolve' or 'dismiss'" },
        { status: 400 }
      );
    }

    if (body.action === 'resolve' && !body.chosenRev) {
      return NextResponse.json(
        { error: "chosenRev is required when action='resolve'" },
        { status: 400 }
      );
    }

    const { resolveConflict, dismissConflict } = await import('@/lib/services/conflict-service');
    const actor = { userId: auth.sub, username: auth.name || auth.username, note: body.note };

    const result = body.action === 'resolve'
      ? await resolveConflict(id, { ...actor, chosenRev: body.chosenRev! })
      : await dismissConflict(id, actor);

    if (!result) {
      return NextResponse.json({ error: 'Conflict not found' }, { status: 404 });
    }
    return NextResponse.json({ conflict: result });
  } catch (err) {
    logApiError('[API /admin/conflicts/:id POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'conflict.resolve' });
