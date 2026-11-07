/**
 * API: POST /api/auth/logout-all
 *
 * "Sign out of every device." Revokes every session the caller holds, this one
 * included: any token issued to this account up to now stops working on its
 * next request, on every device, and renewal of those sessions is refused. A
 * sign-in after this call is unaffected.
 *
 * Authenticated and CSRF-protected like any other state-changing /api route
 * (unlike /logout, which is public so an expired session can still clear its
 * cookies). The use case is a lost or stolen device, so it works from any
 * remaining session and does not need the lost device to be reachable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { CSRF_COOKIE_NAME, getAuthPayload, logApiError, revokeUserSessions, unauthorized } from '@/modules/identity';
import { logAuditSafe } from '@/lib/services/audit-service';

export async function POST(request: NextRequest) {
  const auth = await getAuthPayload(request);
  if (!auth) return unauthorized();

  try {
    await revokeUserSessions(auth.sub);
  } catch (error) {
    logApiError('[auth/logout-all] revocation failed:', error);
    return NextResponse.json(
      { error: 'Sessions not signed out. Try again, or contact IT.' },
      { status: 503 },
    );
  }
  void logAuditSafe('logout_all', auth.sub, auth.username, 'Signed out of all devices', true);

  const response = NextResponse.json({ success: true });
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set('tamamhealth-token', '', { httpOnly: true, secure, sameSite: 'strict', maxAge: 0, path: '/' });
  response.cookies.set(CSRF_COOKIE_NAME, '', { httpOnly: false, secure, sameSite: 'strict', maxAge: 0, path: '/' });
  return response;
}
