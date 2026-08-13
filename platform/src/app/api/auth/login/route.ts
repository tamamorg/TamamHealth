import { NextRequest, NextResponse } from 'next/server';
import { createToken } from '@/lib/auth-token';
import { CSRF_COOKIE_NAME, mintCsrfToken } from '@/lib/csrf';
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

    // Server-safe user authentication (no PouchDB — uses static user registry)
    const { authenticateUser } = await import('@/lib/server-users');

    const user = await authenticateUser(sanitizedUsername, password);

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

    // Provision (or refresh) the matching CouchDB user. Runs with admin
    // credentials server-side so the browser never sees them. The browser
    // then issues its own POST /_session to mint an AuthSession cookie.
    // Best-effort: if CouchDB is down, platform login still succeeds — the
    // user just won't sync until CouchDB is back.
    if (
      process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true' &&
      process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED !== 'true'
    ) {
      try {
        const { ensureCouchUser } = await import('@/lib/sync/couch-auth');
        await ensureCouchUser({
          username: sanitizedUsername,
          password,
          orgId: effective.orgId,
          hospitalId: effective.hospitalId,
          platformRole: effective.role,
        });
      } catch (err) {
        // Expected when CouchDB isn't running (e.g. local dev) — login still
        // succeeds; the session is simply offline-only. Concise, single line.
        const reason = err instanceof Error ? err.message : String(err);
        const unreachable = /fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(reason);
        console.warn(`[login] CouchDB ${unreachable ? 'unreachable' : 'provisioning failed'} — sync unavailable this session (${reason})`);
      }
    }

    // Create JWT
    const token = await createToken({
      _id: user._id,
      username: user.username,
      role: effective.role,
      actualRole: effective.actualRole,
      name: user.name,
      hospitalId: effective.hospitalId,
      hospitalName: effective.hospitalName,
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
        orgId: effective.orgId,
        mustChangePassword: user.mustChangePassword,
      },
    });

    // Set HTTP-only cookie
    response.cookies.set('tamamhealth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 8, // 8 hours
      path: '/',
    });

    // Mint a CSRF token bound to this session and set it as a NON-httpOnly
    // cookie so the browser's apiFetch wrapper can read it and echo it back
    // in the X-CSRF-Token header on every state-changing request. The HMAC
    // binds the token to the JWT subject (user._id), so a token issued for
    // one session can't be replayed against another even if it leaks. The
    // middleware refuses any /api/* mutation that doesn't present a matching
    // pair — without this cookie every client write would 403.
    const csrfToken = await mintCsrfToken(user._id);
    response.cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    return response;
  } catch (err) {
    console.error('Login error:', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
