/**
 * API: POST /api/account-requests/verify
 *
 * The other half of the account-request form: the holder of a valid,
 * unexpired, single-use token confirms that the address on the request is
 * theirs. Only then does the request become visible to an approver.
 *
 * Unauthenticated by necessity — the person has no account, which is the whole
 * reason they are here — so it follows the same three rules as
 * /api/auth/accept-invite:
 *
 *   1. Every failure answers the same way. "No such token", "expired" and
 *      "already decided" are one message, because distinguishing them tells
 *      someone probing which guesses were closer.
 *   2. Rate limited by IP. The token is 256 bits so guessing is not the
 *      threat; the traffic is — this endpoint scans the request store.
 *   3. It grants nothing. Confirming an address creates no account and no
 *      session. It moves a row into a human's queue, and that human is still
 *      the decision.
 */
import { NextRequest, NextResponse } from 'next/server';
import { logApiError, serverError } from '@/modules/identity';
import { withAuditLog } from '@/lib/audit/with-audit';

const GENERIC_FAILURE =
  'This confirmation link is no longer valid. Ask for an account again to get a new one.';

async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimited = await checkRateLimit(request, 'account-requests:verify', 10);
    if (rateLimited) return rateLimited;

    let body: { token?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const token = (body.token || '').trim();
    if (!token) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });

    const { verifyAccountRequestEmail } = await import('@/modules/identity/services/account-request-service');
    const result = await verifyAccountRequestEmail(token);
    if (!result.ok) {
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
    }

    // Now — and only now — the approvers hear about it. Awaited so a
    // serverless invocation cannot return before the mail is handed off, and
    // non-fatal because a confirmed request that nobody was emailed about is
    // still in the queue for the next person who opens it.
    const { notifyApproversOfRequest } = await import('@/modules/identity/services/account-request-notify');
    await notifyApproversOfRequest(result.doc);

    return NextResponse.json({
      ok: true,
      message: 'Thank you — your address is confirmed. '
        + 'An administrator will review your request and contact you if it is approved.',
    });
  } catch (err) {
    logApiError('POST /api/account-requests/verify', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'account_request.verify_email' });
