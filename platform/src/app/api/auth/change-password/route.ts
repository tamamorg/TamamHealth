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
import { getAuthPayload, unauthorized, serverError, logApiError } from '@/lib/api-auth';
import { createToken } from '@/lib/auth-token';
import { mintCsrfToken } from '@/lib/csrf';
import { applySessionCookies } from '@/lib/session';

const MIN_PASSWORD_LENGTH = 8;

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
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (newPassword === currentPassword) {
      return NextResponse.json(
        { error: 'New password must be different from your current password' },
        { status: 400 }
      );
    }

    const { changeOwnPassword } = await import('@/lib/services/user-service');
    let updatedUser: import('@/lib/db-types').UserDoc;
    try {
      updatedUser = await changeOwnPassword(auth.sub, currentPassword, newPassword);
    } catch (err) {
      if (err instanceof Error && /current password is incorrect/i.test(err.message)) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
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

    // Re-issue the session JWT without the forced-change flag so the gate
    // clears immediately, no re-login required. The fresh passwordUpdatedAt
    // becomes this token's `pwdAt` claim — every OTHER session for this
    // account now fails the password-epoch check on its next request, so a
    // stolen or forgotten session can't outlive a password change.
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
        const { deleteSeedCredentialsFile } = await import('@/lib/seed-credentials');
        await deleteSeedCredentialsFile();
      } catch (cleanupErr) {
        console.warn('[change-password] could not remove seed credentials file', cleanupErr);
      }
    }

    const response = NextResponse.json({ success: true });
    const csrfToken = await mintCsrfToken(auth.sub);
    applySessionCookies(response.cookies, token, csrfToken);
    return response;
  } catch (err) {
    logApiError('[API /auth/change-password POST]', err);
    return serverError();
  }
}
