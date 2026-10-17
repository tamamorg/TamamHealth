/**
 * API: /api/admin/conflicts/:id
 * POST — resolve or dismiss a queued conflict.
 * Body: { action: 'resolve' | 'dismiss', chosenRev?: string, note?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';

// Settling a clinical conflict changes the patient's record, so it is limited
// to the roles accountable for it. The records officer (hrio) can still read
// the queue (GET /api/admin/conflicts) but does not decide clinical content.
const ADMIN_ROLES: UserRole[] = ['super_admin', 'org_admin', 'medical_superintendent'];

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

    // Tenant barrier: the row's org must be the caller's unless super_admin.
    // `auth.role` is the BORROWED role for a super_admin signed in AS another
    // role, so an impersonating super_admin gets no platform-wide reach here
    // (stricter than keeping their real role; actualRole is deliberately ignored).
    const scope = { orgId: auth.orgId, superAdmin: auth.role === 'super_admin' };

    const result = body.action === 'resolve'
      ? await resolveConflict(id, { ...actor, chosenRev: body.chosenRev! }, scope)
      : await dismissConflict(id, actor, scope);

    if (!result.ok) {
      const status = result.error === 'not_found' || result.error === 'target_missing' ? 404
        : result.error === 'already_closed' || result.error === 'invalid_rev' ? 409
        : result.error === 'unsupported' ? 422
        : 500;
      return NextResponse.json({ error: result.message, code: result.error }, { status });
    }
    return NextResponse.json({ conflict: result.conflict });
  } catch (err) {
    logApiError('[API /admin/conflicts/:id POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'conflict.resolve' });
