/**
 * API: POST /api/patient-portal/activate
 *
 * A patient redeems the activation code from their enrolment slip and chooses
 * their own password. The same three rules as /api/auth/accept-invite, and for
 * the same reasons:
 *
 *   1. Every failure answers identically. Distinguishing "no such code" from
 *      "expired" tells someone probing which guesses were closer.
 *   2. Rate limited by IP — the code is 256 bits, so the traffic is the threat,
 *      not the guessing, and this endpoint scans the patient register.
 *   3. It issues NO session. Holding the slip proves you were handed it, not
 *      that you are the patient named on it. They sign in afterwards, where the
 *      SMS second factor and the portal's own rate limits apply.
 */
import { NextRequest, NextResponse } from 'next/server';
import { PORTAL_MIN_PASSWORD_LENGTH, logApiError, serverError } from '@/modules/identity';

export const runtime = 'nodejs';

const GENERIC_FAILURE =
  'This activation code is not valid or has expired. Ask the health facility for a new one.';

export async function POST(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimited = await checkRateLimit(request, 'portal:activate', 10);
    if (rateLimited) return rateLimited;

    let body: { code?: string; password?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const password = body.password || '';
    // Password complaints ARE specific — the person is choosing one and has to
    // be told what is wrong. This leaks nothing about the code.
    if (password !== password.trim()) {
      return NextResponse.json({ error: 'Password cannot start or end with spaces' }, { status: 400 });
    }
    if (password.length < PORTAL_MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${PORTAL_MIN_PASSWORD_LENGTH} characters` },
        { status: 400 },
      );
    }

    const { activatePortalAccount } = await import('@/modules/identity/services/patient-portal-enrolment');
    const result = await activatePortalAccount(body.code || '', password);
    if (!result.ok) {
      return NextResponse.json({ error: GENERIC_FAILURE }, { status: 400 });
    }

    // No session — see rule 3. The username is returned so the sign-in form
    // can be pre-filled, which matters when it was printed on a slip.
    return NextResponse.json({ ok: true, username: result.username });
  } catch (err) {
    logApiError('POST /api/patient-portal/activate', err);
    return serverError();
  }
}
