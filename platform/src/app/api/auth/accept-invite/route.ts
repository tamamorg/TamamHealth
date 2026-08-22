/**
 * API: POST /api/auth/accept-invite
 *
 * Redeems an account invitation: the holder of a valid, unexpired, single-use
 * token sets the account's password.
 *
 * This is an UNAUTHENTICATED endpoint that writes a credential, so three rules
 * shape it:
 *
 *   1. Every failure answers the same way. "No such token", "expired" and
 *      "already used" are one message and one status, because distinguishing
 *      them tells an attacker which guesses were closer. The real reason goes
 *      to the audit log instead.
 *   2. It is rate limited by IP. The token is 256 bits so guessing is not the
 *      threat; the traffic is — this endpoint scans the user roster on every
 *      call.
 *   3. It issues no session. Redeeming proves you hold the invitation, not
 *      that you are the person it was addressed to. The user then signs in
 *      normally, which is where rate limiting, role routing and audit already
 *      live. An endpoint that both accepts an emailed token AND hands back a
 *      session is a mail-interception away from account takeover.
 */
import { NextRequest, NextResponse } from 'next/server';
import { serverError, logApiError } from '@/lib/api-auth';

/** One message for every failure mode — see rule 1 above. */
const GENERIC_FAILURE =
  'This invitation link is no longer valid. Ask your administrator to send a new one.';

export async function POST(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimited = await checkRateLimit(request, 'auth:accept-invite', 10);
    if (rateLimited) return rateLimited;

    let body: { token?: string; password?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const token = (body.token || '').trim();
    const password = body.password || '';

    if (!token) {
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
    }
    // Password complaints ARE specific: the person is choosing a password and
    // has to be told what is wrong with it. This leaks nothing about the token,
    // which is checked afterwards. The rules — length, blocklist, and "not
    // built from your own name" — live in `lib/password-policy.ts` and are
    // applied inside `redeemUserInvite`, which is the only place that knows
    // WHOSE account the token belongs to.
    const { redeemUserInvite } = await import('@/lib/services/user-service');
    const result = await redeemUserInvite(token, password);

    if (!result.ok) {
      if (result.reason === 'weak_password') {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }
      // Every remaining reason is a token problem and answers identically.
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
    }

    // No session. The user signs in with the password they just chose.
    return NextResponse.json({ ok: true, username: result.user.username });
  } catch (err) {
    logApiError('POST /api/auth/accept-invite', err);
    return serverError();
  }
}
