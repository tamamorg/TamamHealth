/**
 * API: /api/auth/mfa — manage your own second factor.
 *
 * GET  — what this account has, and whether it is obliged to have one.
 * POST — { action: 'begin' | 'confirm' | 'disable' | 'regenerate_recovery' }
 *
 * Always about the SIGNED-IN user and never about anyone else. An
 * administrator cannot enrol a factor on a colleague's behalf, because a
 * second factor whose secret was known to a second person is not one; the
 * administrative action that does exist is `disable`, on the users route,
 * for the phone that is genuinely gone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, unauthorized, serverError, logApiError, type AuthPayload } from '@/lib/api-auth';
import { withAuditLog, AUDIT_ACTION_HEADER } from '@/lib/audit/with-audit';

export const runtime = 'nodejs';

function audited(response: NextResponse, action: string): NextResponse {
  response.headers.set(AUDIT_ACTION_HEADER, action);
  return response;
}

/**
 * Re-mint the session cookie with a freshly evaluated `mfaPending` claim.
 *
 * Best-effort: enrolment has already succeeded and must not be rolled back
 * because a cookie could not be rewritten. The claim is re-derived on the next
 * `/api/auth/me` in any case, so the worst outcome is one extra page load.
 */
async function reissueSession(response: NextResponse, auth: AuthPayload): Promise<void> {
  try {
    const { getUserById } = await import('@/lib/services/user-service');
    const { isMfaRequiredFor } = await import('@/lib/services/mfa-service');
    const { createToken } = await import('@/lib/auth-token');
    const { mintCsrfToken } = await import('@/lib/csrf');
    const { applySessionCookies } = await import('@/lib/session');
    const user = await getUserById(auth.sub);
    if (!user) return;
    const token = await createToken({
      _id: auth.sub,
      username: auth.username,
      role: auth.role,
      actualRole: auth.actualRole,
      name: auth.name,
      hospitalId: auth.hospitalId,
      hospitalName: auth.hospitalName,
      facilityIds: auth.facilityIds,
      orgId: auth.orgId,
      countryId: auth.countryId,
      payam: auth.payam,
      county: auth.county,
      state: auth.state,
      mustChangePassword: auth.mustChangePassword,
      mfaPending: await isMfaRequiredFor(user),
      passwordUpdatedAt: user.passwordUpdatedAt,
    });
    applySessionCookies(response.cookies, token, await mintCsrfToken(auth.sub));
  } catch {
    /* the claim is re-derived on the next /api/auth/me */
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    const { getUserById } = await import('@/lib/services/user-service');
    const { isMfaRequiredFor } = await import('@/lib/services/mfa-service');
    const user = await getUserById(auth.sub);
    if (!user) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json({
      enabled: Boolean(user.totpEnabledAt),
      enabledAt: user.totpEnabledAt,
      recoveryCodesRemaining: user.totpRecoveryCodeHashes?.length ?? 0,
      // `required` is the only distinction the panel needs: it decides both
      // whether enrolment is being demanded and whether the user may turn the
      // factor off again. Reporting the policy flag and the role list
      // separately just gave the client two more things to get out of step.
      required: await isMfaRequiredFor(user),
    });
  } catch (err) {
    logApiError('GET /api/auth/mfa', err);
    return serverError();
  }
}

async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimited = await checkRateLimit(request, 'auth:mfa', 20);
    if (rateLimited) return rateLimited;

    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    let body: { action?: string; code?: string; password?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const mfa = await import('@/lib/services/mfa-service');

    if (body.action === 'begin') {
      try {
        const start = await mfa.beginTotpEnrolment(auth.sub);
        // The secret IS the credential. It crosses this boundary exactly once,
        // to the account's own signed-in session, and is never returned again
        // — `GET` above reports only whether a factor exists.
        return audited(NextResponse.json(start), 'user.mfa_enrolment_started');
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Could not start enrolment' },
          { status: 400 },
        );
      }
    }

    if (body.action === 'confirm') {
      const result = await mfa.confirmTotpEnrolment(auth.sub, (body.code || '').trim());
      if (!result.ok) {
        const message = result.reason === 'invalid_code'
          ? 'That code is not right. Check your authenticator app and try the current code.'
          : result.reason === 'already_enabled'
            ? 'Two-factor authentication is already on for this account.'
            : 'Start setup again — no enrolment is in progress.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      // Re-issue the session immediately. The proxy gate reads `mfaPending`
      // off the TOKEN — it runs at the edge and has no database — so without
      // this the user would enrol successfully and stay locked out of the
      // application until their token happened to renew.
      const response = audited(
        NextResponse.json({ ok: true, recoveryCodes: result.recoveryCodes }),
        'user.mfa_enabled',
      );
      await reissueSession(response, auth);
      // Shown once and never again: only the hashes are stored.
      return response;
    }

    if (body.action === 'disable') {
      // Costs a password even though the user is already signed in. Removing a
      // second factor is the single most useful thing an attacker can do with
      // a borrowed session, so it is the one self-service change that asks the
      // person to prove they are still there.
      const { getUserById } = await import('@/lib/services/user-service');
      const { verifyPassword } = await import('@/lib/auth');
      const user = await getUserById(auth.sub);
      if (!user) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      if (!body.password || !(await verifyPassword(body.password, user.passwordHash))) {
        return NextResponse.json({ error: 'Your password is not correct.' }, { status: 400 });
      }
      await mfa.disableTotp(auth.sub, auth.username);
      // Symmetrically: an account whose role REQUIRES a factor and has just
      // removed one owes another. Re-minting here means the gate comes back
      // on the next request rather than whenever the token next renews.
      const response = audited(NextResponse.json({ ok: true }), 'user.mfa_disabled');
      await reissueSession(response, auth);
      return response;
    }

    if (body.action === 'regenerate_recovery') {
      const codes = await mfa.regenerateRecoveryCodes(auth.sub);
      if (!codes) {
        return NextResponse.json(
          { error: 'Turn on two-factor authentication first.' },
          { status: 400 },
        );
      }
      return audited(
        NextResponse.json({ ok: true, recoveryCodes: codes }),
        'user.mfa_recovery_regenerated',
      );
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    logApiError('POST /api/auth/mfa', err);
    return serverError();
  }
}

export const POST = withAuditLog(postHandler, { action: 'user.mfa_change' });
