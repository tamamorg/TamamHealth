/**
 * API: POST /api/auth/change-password
 *
 * Self-service password change for the signed-in user. Serves two cases:
 *   1. First-login forced change (UserDoc.mustChangePassword === true) — the
 *      user signs in with the admin's temporary password and must replace it.
 *   2. Ordinary "change my password" from account settings.
 *
 * Verifies the current password, writes the new hash, clears the forced-change
 * flag, and re-issues the session JWT so the flag clears without a re-login.
 */
import { NextRequest, NextResponse } from 'next/server';
import { applySessionCookies, createToken, getAuthPayload, logApiError, mintCsrfToken, serverError, unauthorized } from '@/modules/identity';
import { logAuditSafe } from '@/lib/services/audit-service';

export async function POST(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimited = await checkRateLimit(request, 'auth:change-password', 10);
    if (rateLimited) return rateLimited;

    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    let body: { currentPassword?: string; newPassword?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const currentPassword = body.currentPassword || '';
    const newPassword = body.newPassword || '';

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: 'currentPassword and newPassword are required' },
        { status: 400 }
      );
    }
    if (currentPassword !== currentPassword.trim() || newPassword !== newPassword.trim()) {
      return NextResponse.json(
        { error: 'Passwords cannot start or end with spaces' },
        { status: 400 }
      );
    }
    // Length, blocklist and the "not built from your own name" rule all come
    // from `lib/password-policy.ts` — one validator, five call sites, instead
    // of the literal `8` this file used to carry while /admin/security
    // advertised a minimum of 12 that nothing enforced. `changeOwnPassword`
    // screens again server-side; this pass exists so the message names the
    // real problem rather than surfacing as a generic 500.
    const { screenPasswordForDeployment } = await import('@/modules/identity/policy/password-policy-server');
    const weak = await screenPasswordForDeployment(newPassword, [auth.username, auth.name]);
    if (weak) {
      return NextResponse.json({ error: weak }, { status: 400 });
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: 'New password must be different from your current password' },
        { status: 400 }
      );
    }

    const { changeOwnPassword } = await import('@/modules/identity/services/user-service');
    let updatedUser: import('@/lib/db-types').UserDoc;
    try {
      updatedUser = await changeOwnPassword(auth.sub, currentPassword, newPassword);
    } catch (err) {
      if (err instanceof Error && /current password is incorrect/i.test(err.message)) {
        // Worth its own row for the same reason a failed login is: repeated
        // wrong-current-password attempts against one account are exactly
        // what an account-takeover attempt looks like. Fire-and-forget, like
        // every other audit write — see auditLogin in the login route for
        // why this uses a direct logAuditSafe call rather than
        // `withAuditLog`: this body carries currentPassword/newPassword.
        void logAuditSafe('password_change_failed', auth.sub, auth.username, 'Current password is incorrect', false);
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
      }
      const { PasswordPolicyError } = await import('@/modules/identity/policy/password-policy');
      if (err instanceof PasswordPolicyError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      // No user document (e.g. a seed-only demo account) — can't self-change.
      if (err instanceof Error && /missing|not_found|404/i.test(err.message)) {
        return NextResponse.json(
          { error: 'Password change is not available for this account' },
          { status: 400 }
        );
      }
      throw err;
    }

    // The change succeeded — record it. Successful password changes are as
    // auditable as failed ones: an admin resetting an account, or an account
    // whose password was just changed by someone other than its owner, both
    // need a row an access review can find.
    void logAuditSafe('password_change_success', auth.sub, auth.username, 'Password changed', true);

    // "Keep me signed in" from the original login — carried as the `persist`
    // JWT claim (see createToken / login-session.ts), which `AuthPayload`
    // itself doesn't declare (it's a route-auth concern, not a claim the JWT
    // layer types), but the token this route just verified does carry it.
    // Absent means a token minted before the claim existed — treat that as
    // persistent, matching every session's behaviour before it existed,
    // exactly like /api/auth/me's own renewal does.
    const persist = (auth as unknown as { persist?: boolean }).persist !== false;

    // Re-issue the session JWT without the forced-change flag so the gate
    // clears immediately, no re-login required. The fresh passwordUpdatedAt
    // becomes this token's `pwdAt` claim — every OTHER session for this
    // account now fails the password-epoch check on its next request, so a
    // stolen or forgotten session can't outlive a password change.
    //
    // `persist` is threaded through here and into `applySessionCookies`
    // below for the same reason /api/auth/me's renewal threads it: re-minting
    // a token must not silently upgrade a browser-session cookie (unchecked
    // "Keep me signed in") into a 30-day persistent one just because this
    // endpoint happens to reissue the session.
    const token = await createToken({
      _id: auth.sub,
      username: auth.username,
      role: auth.role,
      actualRole: auth.actualRole,
      name: auth.name,
      hospitalId: auth.hospitalId,
      hospitalName: auth.hospitalName,
      orgId: auth.orgId,
      countryId: auth.countryId,
      payam: auth.payam,
      county: auth.county,
      state: auth.state,
      mustChangePassword: false,
      passwordUpdatedAt: updatedUser.passwordUpdatedAt,
      persist,
    });

    // The bootstrap credentials file has now served its only purpose: it
    // existed so the first operator could learn the generated admin password.
    // Once that password has been changed the file is a plaintext credential
    // sitting on disk with no remaining use, so shred it here rather than
    // relying on an operator remembering to.
    //
    // Admin only — a nurse changing their own password must not delete the
    // file before the admin has read it. Non-fatal: the password change has
    // already succeeded and must not be rolled back over cleanup.
    if (auth.role === 'super_admin' || auth.role === 'org_admin' || auth.username === 'admin') {
      try {
        const { deleteSeedCredentialsFile } = await import('@/modules/identity/core/seed-credentials');
        await deleteSeedCredentialsFile();
      } catch (cleanupErr) {
        console.warn('[change-password] could not remove seed credentials file', cleanupErr);
      }
    }

    const response = NextResponse.json({ success: true });
    const csrfToken = await mintCsrfToken(auth.sub);
    applySessionCookies(response.cookies, token, csrfToken, persist);
    return response;
  } catch (err) {
    logApiError('[API /auth/change-password POST]', err);
    return serverError();
  }
}
