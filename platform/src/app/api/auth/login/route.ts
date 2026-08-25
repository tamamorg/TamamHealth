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
import { logAuditSafe } from '@/lib/services/audit-service';

const USER_LOCK_THRESHOLD = 5;       // failed tries before user lock
const USER_LOCK_MS = 15 * 60 * 1000; // 15 minutes
const IP_LOCK_THRESHOLD = 20;        // failed tries from one IP before IP lock
const IP_LOCK_MS = 15 * 60 * 1000;   // 15 minutes

/**
 * Record the authentication attempt on the SERVER.
 *
 * `context.tsx` already calls `logAudit` for both outcomes — but from the
 * browser, into the device's PouchDB, which then push-replicates. That records
 * a sign-in only when the client code runs. A `curl`, a script, an
 * integration, the mobile client, or someone working through stolen
 * credentials produced no row at all, in either direction. For a patient
 * record system, "who signed in and when" is the log most likely to be asked
 * for and was the one least likely to exist.
 *
 * The client-side call stays: it is the only thing that records an OFFLINE
 * sign-in, which never reaches this route. This is the other half.
 *
 * Why not `withAuditLog`: that decorator serialises request details into the
 * audit row, and a login body contains a password. This logs the username, the
 * outcome and the caller's IP, and nothing else.
 */
function auditLogin(
  action: 'login_success' | 'login_failed',
  username: string,
  details: string,
  request: NextRequest,
  userId?: string,
): void {
  // Fire-and-forget, like every other audit write: a CouchDB hiccup must not
  // turn a valid sign-in into a 500. `logAuditSafe` swallows and warns.
  void logAuditSafe(
    action,
    userId,
    username,
    `${details} (ip ${getClientIp(request) || 'unknown'})`,
    action === 'login_success',
  );
}

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
      // Worth its own row: a username carrying characters the field cannot
      // produce is not a typo, it is somebody probing the parameter. Logged
      // with the rejected value quoted so the pattern is visible, and the
      // value itself is inert — it never reaches a query.
      auditLogin('login_failed', trimmedUsername.slice(0, 64), 'Malformed username rejected', request);
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
      // The single most interesting row in this log: repeated failures against
      // one account, or one address working through many. Which limiter fired
      // is the difference between a clinician who forgot their password and
      // somebody enumerating accounts.
      auditLogin(
        'login_failed',
        sanitizedUsername,
        `Locked out (${!userVerdict.allowed ? 'per-account' : 'per-IP'} limit)`,
        request,
      );
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
        auditLogin('login_failed', sanitizedUsername, 'Users database unreachable', request);
        return NextResponse.json(
          { error: 'Sign-in is temporarily unavailable. The user database could not be reached.' },
          { status: 503 },
        );
      }
      throw err;
    }

    if (!user) {
      auditLogin('login_failed', sanitizedUsername, 'Unknown user or wrong password', request);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Check hospital assignment — super_admin, org_admin, government bypass
    if (!ROLES_WITHOUT_HOSPITAL.includes(user.role) && hospitalId && user.hospitalId && user.hospitalId !== hospitalId) {
      // The password was correct; the facility was not. Worth distinguishing
      // in the log even though the caller is told the same thing.
      auditLogin('login_failed', sanitizedUsername, 'Facility mismatch', request, user._id);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // The password was right, so clear both failed-attempt streaks.
    await Promise.all([resetRateLimit(userRateKey), resetRateLimit(ipRateKey)]);

    const identity = await resolveEffectiveIdentity(user, requestedRole);
    if (!identity.ok) {
      // `code` travels with the prose so the browser can show a translated
      // message. Without it the sign-in form can only fall back to "Invalid
      // credentials", which is the one thing this refusal is not.
      auditLogin('login_failed', sanitizedUsername, `Refused: ${identity.code}`, request, user._id);
      return NextResponse.json(
        { error: identity.error, code: identity.code },
        { status: identity.status },
      );
    }

    auditLogin(
      'login_success',
      sanitizedUsername,
      identity.effective.actualRole
        ? `Signed in as ${identity.effective.role} (actually ${identity.effective.actualRole})`
        : `Signed in as ${identity.effective.role}`,
      request,
      user._id,
    );
    return await issueSessionResponse(user, identity.effective);
  } catch (err) {
    console.error('Login error:', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
