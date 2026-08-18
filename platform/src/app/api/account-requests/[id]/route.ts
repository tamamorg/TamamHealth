/**
 * API: /api/account-requests/:id
 * POST — approve or reject one request.
 *
 * Approval creates the account through the same `createUser` an admin uses by
 * hand, so every rule that applies to manual creation applies here: the
 * username shape, the hospital requirement, the uniqueness check, and the
 * temporary-password-then-change flow. The request document is only the paper
 * trail; it is never a second, weaker way to make a user.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import { buildScopeFromAuth } from '@/lib/services/data-scope';
import type { UserRole } from '@/lib/db-types';
import {
  getAccountRequest, canDecide, recordDecision, suggestUsername,
  PLATFORM_APPROVAL_ROLES,
} from '@/lib/services/account-request-service';

export const runtime = 'nodejs';

const APPROVER_ROLES: UserRole[] = ['super_admin', 'org_admin'];

/**
 * 20 characters from an unambiguous alphabet, so an approver can read the
 * password aloud or copy it into a message without 0/O or 1/l confusion. It
 * is shown once and is temporary — `createUser` sets `mustChangePassword`.
 */
function temporaryPassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, APPROVER_ROLES)) return forbidden();

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const action = body.action;
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
    }

    const doc = await getAccountRequest(id);
    // Same answer for "no such request" and "not yours": an approver in one
    // tenant should not be able to probe for another tenant's request ids.
    if (!doc || !canDecide(buildScopeFromAuth(auth), doc)) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }
    if (doc.status !== 'pending') {
      return NextResponse.json({ error: `This request was already ${doc.status}` }, { status: 409 });
    }

    const decisionNote = typeof body.decisionNote === 'string' ? body.decisionNote : undefined;

    if (action === 'reject') {
      await recordDecision(id, 'rejected', { username: auth.username, name: auth.name }, { decisionNote });
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // ── Approval ────────────────────────────────────────────────────────
    // The approver may override the requested role — the person asking says
    // what they do, the administrator decides what they get.
    const grantedRole = (typeof body.role === 'string' ? body.role : doc.requestedRole) as UserRole;

    // Re-check the privileged-role guard against the GRANTED role, not the
    // requested one. Routing already kept platform roles away from org
    // admins, but an org_admin could otherwise approve a request that is
    // legitimately theirs while substituting a national role on the way
    // through — a privilege escalation with a paper trail that looks routine.
    if (auth.role !== 'super_admin' && PLATFORM_APPROVAL_ROLES.includes(grantedRole)) {
      return forbidden('You are not permitted to grant platform or national roles.');
    }

    // An org_admin can only ever create inside their own tenant, whatever the
    // request claims. super_admin may place the account where the request asks.
    const orgId = auth.role === 'super_admin' ? (doc.orgId ?? auth.orgId) : auth.orgId;

    const { createUser, getAllUsers } = await import('@/lib/services/user-service');
    const existing = await getAllUsers();
    const taken = new Set(existing.map(u => u.username));
    const requested = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const username = requested || suggestUsername(doc.fullName, name => taken.has(name));

    const password = temporaryPassword();
    let created;
    try {
      created = await createUser(
        {
          username,
          password,
          name: doc.fullName,
          role: grantedRole,
          hospitalId: (typeof body.hospitalId === 'string' ? body.hospitalId : doc.hospitalId),
          hospitalName: (typeof body.hospitalName === 'string' ? body.hospitalName : doc.hospitalName),
          orgId,
          email: doc.email,
          phone: doc.phone,
        },
        auth.sub,
        auth.username,
      );
    } catch (err) {
      // These are the approver's problem to fix (name taken, missing
      // facility), so hand back what createUser said rather than a 500.
      const message = err instanceof Error ? err.message : 'Could not create the account';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Only close the request once the account exists. If createUser throws,
    // the request stays pending and can be retried; closing first would leave
    // an approved request with no account behind it.
    await recordDecision(
      id, 'approved',
      { username: auth.username, name: auth.name },
      { decisionNote, createdUsername: created.username },
    );

    // The one and only time this password is readable. It is not stored in
    // plaintext anywhere, and the account cannot be used without changing it.
    return NextResponse.json({
      ok: true,
      status: 'approved',
      username: created.username,
      temporaryPassword: password,
      mustChangePassword: true,
    });
  } catch (err) {
    logApiError('POST /api/account-requests/[id]', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, {
  action: 'account_request.decide',
  resourceId: (_request, ctx) => ctx?.params?.id,
});
