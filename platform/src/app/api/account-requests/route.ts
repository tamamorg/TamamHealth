/**
 * API: /api/account-requests
 * POST — public. Someone asks for an account. No session, no account created.
 * GET  — approvers only. The requests this viewer may act on.
 *
 * The POST is deliberately the only unauthenticated write in the app besides
 * login, so it is written to be boring: it stores a claim, grants nothing, and
 * answers identically whatever it was given. It must never become an oracle —
 * "that organisation exists", "that email already has an account" — so it
 * returns the same body for a good request, an unknown org and a duplicate.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
} from '@/lib/api-auth';
import { buildScopeFromAuth } from '@/lib/services/data-scope';
import type { UserRole } from '@/lib/db-types';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-utils';
import {
  createAccountRequest, listAccountRequests, isRequestableRole,
} from '@/lib/services/account-request-service';

export const runtime = 'nodejs';

/** Only the two roles that can create an account can approve a request. */
const APPROVER_ROLES: UserRole[] = ['super_admin', 'org_admin'];

/**
 * Ten requests per hour per IP. Generous for a clinic behind one NAT address
 * where several staff sign up the same morning, tight enough that the form
 * cannot be used to flood an approver's queue.
 */
const SUBMIT_LIMIT = 10;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;

/** Same answer for every outcome — see the note at the top of this file. */
const ACCEPTED = {
  ok: true,
  message: 'Request received. An administrator will review it and email you if it is approved.',
};

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const verdict = await rateLimit({
      key: `acctreq:ip:${getClientIp(request)}`,
      limit: SUBMIT_LIMIT,
      windowMs: SUBMIT_WINDOW_MS,
    });
    if (!verdict.allowed) {
      return NextResponse.json(
        { error: 'Too many requests from this connection. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))) } },
      );
    }

    const role = typeof body.requestedRole === 'string' ? body.requestedRole : '';
    if (!isRequestableRole(role)) {
      return NextResponse.json({ error: 'Choose a role from the list' }, { status: 400 });
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    try {
      await createAccountRequest({
        fullName: str(body.fullName) ?? '',
        email: str(body.email) ?? '',
        phone: str(body.phone),
        requestedRole: role,
        orgId: str(body.orgId),
        orgName: str(body.orgName),
        hospitalId: str(body.hospitalId),
        hospitalName: str(body.hospitalName),
        note: str(body.note),
      });
    } catch (err) {
      // Shape problems the person can fix are worth returning; anything else
      // is an internal fault and must not describe the system to a stranger.
      const message = err instanceof Error ? err.message : '';
      if (/required|valid email|from the list/i.test(message)) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      logApiError('POST /api/account-requests', err);
      return serverError();
    }

    return NextResponse.json(ACCEPTED, { status: 202 });
  } catch (err) {
    logApiError('POST /api/account-requests', err);
    return serverError();
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, APPROVER_ROLES)) return forbidden();

    const status = request.nextUrl.searchParams.get('status');
    const requests = await listAccountRequests(
      buildScopeFromAuth(auth),
      status === 'pending' || status === 'approved' || status === 'rejected' ? { status } : {},
    );
    return NextResponse.json({ requests });
  } catch (err) {
    logApiError('GET /api/account-requests', err);
    return serverError();
  }
}
