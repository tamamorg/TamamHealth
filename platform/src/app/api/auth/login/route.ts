import { NextRequest, NextResponse } from 'next/server';
import { createToken } from '@/lib/auth-token';
import { mintCsrfToken } from '@/lib/csrf';
import { applySessionCookies } from '@/lib/session';
import { getClientIp } from '@/lib/request-utils';
import { logApiError } from '@/lib/api-auth';
import { rateLimit, resetRateLimit } from '@/lib/rate-limit';

const USER_LOCK_THRESHOLD = 5;       // failed tries before user lock
const USER_LOCK_MS = 15 * 60 * 1000; // 15 minutes
const IP_LOCK_THRESHOLD = 20;        // failed tries from one IP before IP lock
const IP_LOCK_MS = 15 * 60 * 1000;   // 15 minutes

/**
 * The display name of an organization, for accounts whose own record predates
 * `UserDoc.orgName`. Never throws — a sign-in must not fail because the
 * organizations store is briefly unreachable; the session just carries no name.
 */
async function lookupOrgName(orgId?: string): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    const { getOrganizationById } = await import('@/lib/services/organization-service');
    return (await getOrganizationById(orgId))?.name;
  } catch {
    return undefined;
  }
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
    const { authenticateUser, UsersDbUnavailableError } = await import('@/lib/server-users');

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
    const ROLES_WITHOUT_HOSPITAL = ['super_admin', 'org_admin', 'government', 'county_health_director'];
    if (!ROLES_WITHOUT_HOSPITAL.includes(user.role) && hospitalId && user.hospitalId && user.hospitalId !== hospitalId) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Role picker on the login form. Everyone signs in as their assigned
    // role; ONLY the platform super-admin may pick a different role and enter
    // that role's workspace ("total access"). The session then carries the
    // chosen role as `role` (so every dashboard, nav, guard, and data scope
    // behaves natively) plus `actualRole: 'super_admin'` for session restore
    // and audit. A super-admin account has no facility of its own, so an
    // impersonated clinical session adopts the platform's demo flagship
    // facility — otherwise facility-scoped queries fail closed and every
    // screen renders empty.
    let effective = {
      role: user.role,
      actualRole: undefined as string | undefined,
      hospitalId: user.hospitalId,
      hospitalName: user.hospitalName,
      orgId: user.orgId,
    };
    if (requestedRole && requestedRole !== user.role) {
      const { hasRoleRouteConfig } = await import('@/lib/role-routes');
      if (user.role !== 'super_admin' || !hasRoleRouteConfig(requestedRole)) {
        return NextResponse.json(
          { error: 'You can only sign in as your assigned role.' },
          { status: 403 },
        );
      }
      const needsFacility = !ROLES_WITHOUT_HOSPITAL.includes(requestedRole);
      effective = {
        role: requestedRole,
        actualRole: user.role,
        hospitalId: needsFacility ? (user.hospitalId ?? 'hosp-001') : user.hospitalId,
        hospitalName: needsFacility ? (user.hospitalName ?? 'Juba Teaching Hospital') : user.hospitalName,
        orgId: user.orgId ?? 'org-moh-ss',
      };
    }

    // Clear failed attempts on successful login (both counters)
    await Promise.all([resetRateLimit(userRateKey), resetRateLimit(ipRateKey)]);

    // Create JWT
    const token = await createToken({
      _id: user._id,
      username: user.username,
      role: effective.role,
      actualRole: effective.actualRole,
      name: user.name,
      hospitalId: effective.hospitalId,
      hospitalName: effective.hospitalName,
      // Extra facilities this account covers. Read from the account itself, not
      // from `effective`: a super-admin signing in AS another role borrows a
      // facility, and must not also inherit somebody's multi-site coverage.
      facilityIds: user.facilityIds,
      orgId: effective.orgId,
      // May be undefined if the user record predates countryId — that's fine.
      countryId: user.countryId,
      // Geographic tier fields — undefined for users without sub-org scope.
      payam: user.payam,
      county: user.county,
      state: user.state,
      // Carry the forced-change flag so the client can route a freshly created
      // or reset user straight to the "set your password" screen.
      mustChangePassword: user.mustChangePassword,
      // Password epoch — a later change/reset invalidates this token.
      passwordUpdatedAt: user.passwordUpdatedAt,
    });

    const response = NextResponse.json({
      user: {
        _id: user._id,
        username: user.username,
        name: user.name,
        role: effective.role,
        actualRole: effective.actualRole,
        hospitalId: effective.hospitalId,
        hospitalName: effective.hospitalName,
        facilityIds: user.facilityIds,
        orgId: effective.orgId,
        // Denormalised on the user record (see UserDoc.orgName), and resolved
        // from the organization for accounts created before that field existed
        // — see the same fallback in /api/auth/me. Suppressed while
        // impersonating, where `effective.orgId` may be a substituted org the
        // account itself does not belong to; showing that account's real
        // organization name next to a borrowed org id would be a lie.
        orgName: effective.actualRole ? undefined : (user.orgName || await lookupOrgName(user.orgId)),
        mustChangePassword: user.mustChangePassword,
      },
    });

    // Session cookie plus its CSRF twin (non-httpOnly so the browser's
    // apiFetch wrapper can echo it in the X-CSRF-Token header on every
    // state-changing request; the HMAC binds it to the JWT subject). Both
    // share the session TTL, and /api/auth/me silently re-mints the token on
    // app loads, so the browser stays signed in across restarts until the
    // session is idle a full TTL, the user logs out, or their password
    // changes (see lib/session.ts).
    const csrfToken = await mintCsrfToken(user._id);
    applySessionCookies(response.cookies, token, csrfToken);

    return response;
  } catch (err) {
    console.error('Login error:', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
