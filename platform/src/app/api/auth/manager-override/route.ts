/**
 * API: POST /api/auth/manager-override
 *
 * A signed-in staff member (the cashier) asks another staff member to approve
 * something sensitive on the spot. Body: { username, password, purpose }, the
 * approver's own credentials. Nothing is signed in or stored; the answer is
 * the approver's identity or a plain refusal.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, logApiError, serverError, unauthorized, UsersDbUnavailableError } from '@/modules/identity';
import { rateLimit, refundRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/request-utils';

const ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    let body: { username?: unknown; password?: unknown; purpose?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password || !/^[a-z0-9._-]+$/.test(username)) {
      return NextResponse.json({ error: 'Enter the approver username and password.' }, { status: 400 });
    }
    const purpose = typeof body.purpose === 'string' ? body.purpose.slice(0, 200) : 'a waiver';

    // Guessing a manager's password from a cashier's session is the attack
    // here: five FAILED tries per cashier and device per 15 minutes (a
    // successful approval gives its attempt back, so a busy till is not locked).
    const limitKey = `manager-override:${auth.sub}:${getClientIp(request)}`;
    const verdict = await rateLimit({
      key: limitKey,
      limit: ATTEMPT_LIMIT,
      windowMs: ATTEMPT_WINDOW_MS,
    });
    if (!verdict.allowed) {
      return NextResponse.json({ error: 'Too many failed attempts. Wait 15 minutes, then try again.' }, { status: 429 });
    }

    const { verifyManagerOverride } = await import('@/lib/services/manager-override-service');
    const result = await verifyManagerOverride({
      username, password, purpose,
      requester: { sub: auth.sub, username: auth.username, name: auth.name, role: auth.role, orgId: auth.orgId, hospitalId: auth.hospitalId },
    });
    if (!result.ok) {
      // 422, not 401: apiFetch treats every 401 as an expired session and signs the cashier out.
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.code === 'BAD_CREDENTIALS' ? 422 : 403 });
    }
    await refundRateLimit(limitKey);
    return NextResponse.json({ approval: result.approval });
  } catch (err) {
    if (err instanceof UsersDbUnavailableError) {
      return NextResponse.json({ error: 'Approval is temporarily unavailable. Try again in a few minutes.' }, { status: 503 });
    }
    logApiError('POST /api/auth/manager-override', err);
    return serverError();
  }
}
