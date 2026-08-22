/**
 * API: POST /api/auth/verify-mfa
 *
 * Step two of staff sign-in. Exchanges a correct TOTP code — or one of the
 * account's unused recovery codes — for the session that /api/auth/login
 * deliberately withheld.
 *
 * Unauthenticated in the session sense: there is no session yet, which is the
 * whole point. What protects it is the signed hand-off token from step one
 * (five-minute life, its own JWT audience so it can never be presented as a
 * session — see `createMfaPendingToken`), plus per-IP and per-account rate
 * limits on top of the replay protection inside `verifySecondFactor`.
 *
 * The session it issues is built by exactly the same code as the one-step
 * path, so an account with a second factor cannot end up with a subtly
 * different session from an account without one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ROLES_WITHOUT_HOSPITAL, issueSessionResponse, logApiError, resolveEffectiveIdentity, verifyMfaPendingToken } from '@/modules/identity';

import { getClientIp } from '@/lib/request-utils';
import { rateLimit, resetRateLimit } from '@/lib/rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 30;
/**
 * Ten tries per account per fifteen minutes. A six-digit code has a million
 * values and a thirty-second life, so guessing is not the realistic threat —
 * but an unbounded endpoint that reads the users store on every call is.
 */
const ACCOUNT_LIMIT = 10;

/** One message for every failure. Which of them it was is nobody's business. */
const GENERIC_FAILURE = 'That code is not valid or has expired. Sign in again.';

export async function POST(request: NextRequest) {
  try {
    const ipKey = `mfa:ip:${getClientIp(request)}`;
    const ipVerdict = await rateLimit({ key: ipKey, limit: IP_LIMIT, windowMs: WINDOW_MS });
    if (!ipVerdict.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    let body: { mfaToken?: string; code?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const claims = await verifyMfaPendingToken((body.mfaToken || '').trim());
    if (!claims) return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });

    const accountKey = `mfa:account:${claims.sub}`;
    const accountVerdict = await rateLimit({ key: accountKey, limit: ACCOUNT_LIMIT, windowMs: WINDOW_MS });
    if (!accountVerdict.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const { verifySecondFactor } = await import('@/modules/identity/services/mfa-service');
    const verdict = await verifySecondFactor(claims.sub, body.code || '');
    if (!verdict.ok) {
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
    }
    await Promise.all([resetRateLimit(ipKey), resetRateLimit(accountKey)]);

    // Re-read the account rather than trusting anything carried in the token.
    // Between step one and step two an administrator may have deactivated the
    // account or reset the password, and the hand-off token records neither.
    const { getUserById } = await import('@/modules/identity/services/user-service');
    const account = await getUserById(claims.sub);
    if (!account || account.isActive === false) {
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
    }
    if (!ROLES_WITHOUT_HOSPITAL.includes(account.role)
      && claims.hospitalId && account.hospitalId && account.hospitalId !== claims.hospitalId) {
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 401 });
    }

    const identity = await resolveEffectiveIdentity(account, claims.requestedRole);
    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: identity.status });
    }

    return await issueSessionResponse(account, identity.effective, {
      // Surfaced so the client can warn someone who has just spent one of a
      // dwindling set. Running out silently is how a lost phone becomes a
      // support ticket nobody can resolve offline.
      usedRecoveryCode: verdict.usedRecoveryCode,
      recoveryCodesRemaining: verdict.recoveryCodesRemaining,
    });
  } catch (err) {
    logApiError('POST /api/auth/verify-mfa', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
