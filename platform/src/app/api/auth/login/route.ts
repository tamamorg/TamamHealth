/**
 * API: POST /api/auth/login
 *
 * Prove the password, get a session. The session itself is built in
 * `lib/login-session.ts` so every path that issues one issues the same one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { ROLES_WITHOUT_HOSPITAL, issueSessionResponse, logApiError, resolveEffectiveIdentity } from '@/modules/identity';
import { getClientIp } from '@/lib/request-utils';

import { rateLimit, resetRateLimit } from '@/lib/rate-limit';

const USER_LOCK_THRESHOLD = 5;       // failed tries before user lock
const USER_LOCK_MS = 15 * 60 * 1000; // 15 minutes
const IP_LOCK_THRESHOLD = 20;        // failed tries from one IP before IP lock
const IP_LOCK_MS = 15 * 60 * 1000;   // 15 minutes

export async function POST(request: NextRequest) {
  try {
    // Parse request body with explicit error handling
    let body: { username?: string; password?: string; hospitalId?: string; role?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { username, password, hospitalId, role: requestedRole } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    // Validate username format - reject invalid characters instead of silently stripping
    const trimmedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(trimmedUsername)) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    const sanitizedUsername = trimmedUsername;

    const clientIp = getClientIp(request);
    const userRateKey = `login:user:${sanitizedUsername}`;
    const ipRateKey = `login:ip:${clientIp}`;
    // Shared Redis counters are used whenever configured; the limiter falls
    // back to bounded per-instance counters only for local/single-replica use.
    const [userVerdict, ipVerdict] = await Promise.all([
      rateLimit({ key: userRateKey, limit: USER_LOCK_THRESHOLD, windowMs: USER_LOCK_MS }),
      rateLimit({ key: ipRateKey, limit: IP_LOCK_THRESHOLD, windowMs: IP_LOCK_MS }),
    ]);
    if (!userVerdict.allowed || !ipVerdict.allowed) {
      const resetAt = Math.max(
        userVerdict.allowed ? 0 : userVerdict.resetAt,
        ipVerdict.allowed ? 0 : ipVerdict.resetAt,
      );
      const response = NextResponse.json(
        { error: 'Too many failed attempts. Try again later.' },
        { status: 429 },
      );
      response.headers.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
      return response;
    }

    // Server-safe user authentication (no PouchDB — reads the shared users DB)
    const { authenticateUser, UsersDbUnavailableError } = await import('@/modules/identity/core/server-users');

    let user;
    try {
      user = await authenticateUser(sanitizedUsername, password);
    } catch (err) {
      // A database that cannot be reached is not a wrong password, and saying
      // so sends the operator to check the wrong thing. This is the one login
      // failure that is the system's fault, so it says so — without revealing
      // whether the account exists, which is still unknown at this point.
      if (err instanceof UsersDbUnavailableError) {
        logApiError('POST /api/auth/login', err);
        return NextResponse.json(
          { error: 'Sign-in is temporarily unavailable. The user database could not be reached.' },
          { status: 503 },
        );
      }
      throw err;
    }

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Check hospital assignment — super_admin, org_admin, government bypass
    if (!ROLES_WITHOUT_HOSPITAL.includes(user.role) && hospitalId && user.hospitalId && user.hospitalId !== hospitalId) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // The password was right, so clear both failed-attempt streaks.
    await Promise.all([resetRateLimit(userRateKey), resetRateLimit(ipRateKey)]);

    const identity = await resolveEffectiveIdentity(user, requestedRole);
    if (!identity.ok) {
      return NextResponse.json({ error: identity.error }, { status: identity.status });
    }

    return await issueSessionResponse(user, identity.effective);
  } catch (err) {
    console.error('Login error:', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
