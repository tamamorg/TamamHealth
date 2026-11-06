import { CSRF_COOKIE_NAME, logApiError, revokeToken, verifyToken } from '@/modules/identity';
import { getClientIp } from '@/lib/request-utils';
import { rateLimit } from '@/lib/rate-limit';
import { NextRequest, NextResponse } from 'next/server';

// Logout is public (it runs before the auth gate so an expired session can
// still clear its cookies), so it must not become an amplification vector. A
// generous per-IP ceiling bounds the verify+revoke work; a clinic behind one
// NAT address logs out far below this. Exceeding it skips the store write, not
// the cookie clearing — the user is always logged out locally.
const LOGOUT_IP_LIMIT = 60;
const LOGOUT_IP_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  // Add the token to the persisted revocation list so it can't be replayed
  // within its remaining JWT life (every authenticated /api/* request consults
  // the same store via getAuthPayload). Only a validly SIGNED token is written:
  // this endpoint takes an unauthenticated cookie, and revoking whatever string
  // arrives let anyone flood the store with forged, never-expiring entries.
  const token = request.cookies.get('tamamhealth-token')?.value;
  if (token) {
    const verdict = await rateLimit({
      key: `logout:${getClientIp(request)}`,
      limit: LOGOUT_IP_LIMIT,
      windowMs: LOGOUT_IP_WINDOW_MS,
    });
    if (verdict.allowed && (await verifyToken(token))) {
      try {
        await revokeToken(token);
      } catch (error) {
        // Cookie invalidation must still happen if the shared revocation store
        // is temporarily unavailable. The browser is logged out locally, while
        // the failure is visible in server logs for remediation.
        logApiError('[auth/logout] token revocation failed:', error);
      }
    }
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set('tamamhealth-token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  // Clear the CSRF cookie too so the next sign-in mints a fresh, session-bound
  // token. Leaving the old one around would let an attacker who scraped it
  // pair it with a future session of the same user.
  response.cookies.set(CSRF_COOKIE_NAME, '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  return response;
}
