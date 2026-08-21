import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './lib/auth-token';
import { SESSION_TTL_SEC } from './lib/session';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  mintCsrfToken,
  verifyCsrfToken,
} from './lib/csrf';
import { addBreadcrumb } from './lib/observability';
import { buildContentSecurityPolicy } from './lib/security/content-security-policy';
import {
  getDefaultDashboard,
  hasRoleRouteConfig,
  isPathAllowed,
} from './lib/role-routes';

function nextWithCsp(request: NextRequest): NextResponse {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const policy = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV !== 'production',
    couchdbUrl: process.env.NEXT_PUBLIC_COUCHDB_URL,
    posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

// NOTE: The authoritative token-revocation check (lib/token-blacklist.ts)
// uses node:fs and therefore can't run in this Edge-runtime proxy.
// It is enforced instead in two Node-runtime locations that every request
// has to pass through:
//
//   1. /api/auth/me   — called by context.tsx on every app load.
//                       A revoked token returns 401 and the client logs out.
//   2. getAuthPayload — used by every /api/* route. A revoked token
//                       cannot perform any mutation or read any PHI.
//
// The proxy here does not duplicate that check. Logout already clears
// the cookie on the same browser; any stolen-cookie use from another
// browser hits the API gate immediately.

/**
 * API paths exempt from CSRF enforcement. These are either public (no
 * authenticated session to abuse), use a separate auth scheme, or are the
 * login flow itself (no session yet to bind a token to).
 */
const CSRF_EXEMPT_API_PATHS = new Set<string>([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  // Public account request. Exempt for the same reason as login: the caller
  // has no session, so there is none to ride. The route grants nothing and
  // is rate-limited by IP.
  '/api/account-requests',
  // Invitation redemption. Same reasoning: the caller has no session yet —
  // that is what they are here to earn. Authorisation is the single-use token
  // in the body, and the route is rate-limited by IP.
  '/api/auth/accept-invite',
]);

/**
 * Scheduled-job endpoints, and the request header each uses to authenticate.
 *
 * These routes accept TWO kinds of caller: a staff user with a session (manual
 * trigger from the UI), and a scheduled job holding a shared secret. A cron
 * `curl` has no session cookie, no CSRF token, and — crucially — no `Origin`
 * header, so it is rejected twice over by the gates below before the route's
 * own secret check ever runs. Without this exemption the jobs 403 silently in
 * production and the features they drive simply never happen: reminders are
 * never sent, and scheduled transfers never take effect.
 *
 * The exemption is deliberately keyed on the PRESENCE of the secret header,
 * not just the path:
 *   - A cross-site attacker cannot set a custom header on a form/img request,
 *     and a fetch that tries triggers a CORS preflight the browser will block.
 *   - So the session-authenticated path keeps full CSRF protection; only a
 *     request already claiming to be a machine caller skips it.
 *   - The header's VALUE is still verified in the route with a constant-time
 *     compare, so presence alone authorises nothing.
 */
const MACHINE_CALLER_ROUTES: Record<string, string> = {
  '/api/sync': 'x-tamamhealth-signature',
  '/api/patient-reminders/dispatch': 'x-reminder-dispatch-secret',
  '/api/patient-transfers/sweep': 'x-transfer-sweep-secret',
};

export function isMachineCallerRequest(pathname: string, request: NextRequest): boolean {
  const header = MACHINE_CALLER_ROUTES[pathname];
  return Boolean(header && request.headers.get(header));
}

// The public pay-by-link checkout helper. No staff session exists (a payer
// opens the link), so the cookie+header CSRF gate can't apply; the Origin
// check above still guards it against cross-site abuse.
function isCheckoutApiPath(pathname: string): boolean {
  return pathname === '/api/checkout' || pathname.startsWith('/api/checkout/');
}

function isCsrfExemptApiPath(pathname: string): boolean {
  if (CSRF_EXEMPT_API_PATHS.has(pathname)) return true;
  // Patient portal has its own JWT scheme; it issues + checks its own
  // anti-forgery tokens internally. Skip the staff CSRF gate here.
  if (pathname.startsWith('/api/patient-portal/')) return true;
  // Public booking. There is no session cookie here to protect, so the staff
  // CSRF gate has nothing to check and would only reject every request from a
  // practice's own website. The real guards are the per-IP/per-phone rate
  // limits and the required slot hold — see the booking plan, §5.
  if (pathname.startsWith('/api/booking/')) return true;
  // Read-only public reference data.
  if (pathname === '/api/fhir/metadata') return true;
  if (pathname === '/api/country/metadata') return true;
  if (pathname.startsWith('/api/terminology/')) return true;
  // Public pay-by-link checkout helper — unauthenticated payer, no session
  // cookie to bind a CSRF token to.
  if (isCheckoutApiPath(pathname)) return true;
  return false;
}

// Role -> route allow-list lives in `lib/role-routes.ts` so the richer
// `ROLE_PERMISSIONS` map (nav items + icons, not Edge-safe) can derive its
// `allowedRoutes` from the same source. Only the helpers below are pulled in.

/**
 * Structured request logging for operational visibility and audit trails.
 * Logs: timestamp, method, path, user (if authenticated), status, duration.
 * In production, this would feed into a log aggregation service (e.g. ELK, Loki).
 */
function logRequest(
  request: NextRequest,
  response: NextResponse,
  userId?: string,
  role?: string,
  durationMs?: number,
) {
  // Skip noisy static asset requests
  const path = request.nextUrl.pathname;
  if (path.startsWith('/_next') || path === '/favicon.ico') return;

  const logEntry = {
    timestamp: new Date().toISOString(),
    method: request.method,
    path,
    status: response.status || 200,
    userId: userId || 'anonymous',
    role: role || 'none',
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown',
    userAgent: request.headers.get('user-agent')?.slice(0, 100) || '',
    durationMs: durationMs || 0,
  };

  // Use structured JSON logging for machine-parseable logs
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(logEntry));
  } else if (request.method !== 'GET' || path.startsWith('/api/')) {
    // In dev, only log API calls and state-changing requests to reduce noise
    console.log(`[REQ] ${logEntry.method} ${logEntry.path} → ${logEntry.status} (${logEntry.userId}/${logEntry.role}) ${logEntry.durationMs}ms`);
  }

  // Sentry breadcrumb — only for non-2xx responses, so successful traffic
  // doesn't bloat the breadcrumb buffer or the bundle in dev (the helper
  // no-ops when the SDK isn't initialised). The trail of redirects + 4xx /
  // 5xx that preceded a captured exception is what we actually want.
  if (logEntry.status >= 300) {
    addBreadcrumb({
      category: 'request',
      message: `${logEntry.method} ${logEntry.path} → ${logEntry.status}`,
      level: logEntry.status >= 500 ? 'error' : 'warning',
      data: {
        method: logEntry.method,
        path: logEntry.path,
        status: logEntry.status,
        role: logEntry.role,
        durationMs: logEntry.durationMs,
      },
    });
  }
}

export async function proxy(request: NextRequest) {
  const startTime = Date.now();
  const { pathname } = request.nextUrl;

  // Static assets — always public
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/assets') ||
    pathname.startsWith('/icons') ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js' ||
    pathname === '/favicon.ico'
  ) {
    return nextWithCsp(request);
  }

  // Auth API routes — always public (needed for login/logout flow, and for a
  // new user redeeming an invitation, who has no session by definition).
  if (
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/me' ||
    pathname === '/api/auth/accept-invite'
  ) {
    return nextWithCsp(request);
  }

  // Public account request — POST only. Someone who needs an account has no
  // session yet, so the submission must reach the route; GET is the approver's
  // queue and stays behind the session gate below. Scoping this by method
  // rather than by path is the difference between a public form and a public
  // list of everyone who has asked for access.
  if (pathname === '/api/account-requests' && request.method.toUpperCase() === 'POST') {
    return nextWithCsp(request);
  }

  // The organisation list the request form chooses from. Names only — see the
  // route for what it withholds and why.
  if (pathname === '/api/account-requests/options') {
    return nextWithCsp(request);
  }

  // CSRF defence layer 1: Origin/Host check on state-changing API requests.
  // Runs BEFORE the patient-portal early-return so the patient portal still
  // gets cross-site protection — only the cookie+header CSRF gate is skipped
  // for that path (it uses Bearer auth instead, see below).
  if (pathname.startsWith('/api/') && !isMachineCallerRequest(pathname, request)) {
    const method = request.method.toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const origin = request.headers.get('origin');
      const host = request.headers.get('host');
      const isProd = process.env.NODE_ENV === 'production';

      // In production, require Origin header for state-changing API calls
      if (isProd && !origin) {
        return NextResponse.json({ error: 'Missing Origin header' }, { status: 403 });
      }

      // Verify Origin matches Host when both are present
      if (origin && host) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== host) {
            return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 });
          }
        } catch {
          return NextResponse.json({ error: 'Invalid Origin' }, { status: 403 });
        }
      }
    }
  }

  // Patient portal API — uses its own JWT auth (not staff auth). The Origin
  // check above still applies; only the cookie-based CSRF gate is skipped.
  if (pathname.startsWith('/api/patient-portal/')) {
    return nextWithCsp(request);
  }

  // Public booking API. Unauthenticated by design — the caller is a patient on
  // a practice's website, not a staff member. The Origin/Host check above still
  // runs on the POSTs. These routes return free/busy only, and the write paths
  // are rate-limited and require a slot hold.
  if (pathname.startsWith('/api/booking/')) {
    return nextWithCsp(request);
  }

  // FHIR CapabilityStatement is intentionally public so external clients can
  // discover the API before authenticating. All other FHIR resource paths
  // still require a session token.
  if (pathname === '/api/fhir/metadata') {
    return nextWithCsp(request);
  }

  // Country metadata is static reference data (no PHI) — facility nodes
  // fetch it to sync code mappings without requiring a session.
  if (pathname === '/api/country/metadata') {
    return nextWithCsp(request);
  }

  // Liveness/readiness probe — intentionally unauthenticated (see health route).
  if (pathname === '/api/health') {
    return nextWithCsp(request);
  }

  // Seeded demo roster for the sign-in picker — GET only. The route answers
  // an empty list unless the deployment is a standalone demo (no users
  // database AND NEXT_PUBLIC_DEMO_MODE exactly 'true'), so there is nothing
  // here for a real server to disclose. Public because the picker lives on
  // the sign-in page, where there is no session yet by definition.
  if (pathname === '/api/demo-credentials' && request.method.toUpperCase() === 'GET') {
    return nextWithCsp(request);
  }

  // Terminology registry — shared CodeSystems / ValueSets. Reference data,
  // no PHI; public so external tooling can bind forms to our vocabularies.
  if (pathname.startsWith('/api/terminology/')) {
    return nextWithCsp(request);
  }

  // Pay-by-link checkout helper — public so an unauthenticated payer can load
  // the link details (GET) and submit a pending payment (POST). The route
  // itself returns only payer-facing fields and never posts to the ledger.
  if (isCheckoutApiPath(pathname)) {
    return nextWithCsp(request);
  }

  // Login page — always public
  if (pathname === '/login') {
    return nextWithCsp(request);
  }

  // Public pages — root (redirects to /login), public-stats, patient-portal, legal pages
  if (
    pathname === '/' ||
    pathname === '/public-stats' ||
    pathname === '/patient-portal' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/request-account'
  ) {
    return nextWithCsp(request);
  }

  // Account invitation — a new staff member opening the link from their email
  // has no session yet, and bouncing them to /login is a dead end: they have no
  // password, which is the entire reason they are here. The page and its API
  // are guarded by the single-use token itself, not by a session.
  if (pathname === '/accept-invite') {
    return nextWithCsp(request);
  }

  // Public booking — a patient following a link from an SMS, a QR code or the
  // practice's own website has no staff session and must not be bounced to
  // /login. The routes underneath return free/busy only; nothing here reaches
  // patient data without the unguessable booking reference.
  if (pathname === '/book' || pathname.startsWith('/book/')) {
    return nextWithCsp(request);
  }

  // Pay-by-link checkout page — a patient/payer opens the link without a staff
  // session, so the public checkout route must not redirect to /login.
  if (pathname === '/checkout' || pathname.startsWith('/checkout/')) {
    return nextWithCsp(request);
  }

  // Scheduled-job endpoints presenting their secret header. These have no
  // session cookie, so the gate below would 401 them before the route ever ran
  // — the job would fail every time and the work it drives would silently never
  // happen. Handing off here is safe because the route does NOT trust the
  // header's presence: it compares the value in constant time and, failing
  // that, falls back to `getAuthPayload` and returns 401 itself. A wrong or
  // guessed secret therefore gets exactly as far as a missing one.
  if (isMachineCallerRequest(pathname, request)) {
    return nextWithCsp(request);
  }

  // All other routes require authentication
  const token = request.cookies.get('tamamhealth-token')?.value;

  if (!token) {
    // API routes return 401, page routes redirect to login
    if (pathname.startsWith('/api/')) {
      const resp = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      logRequest(request, resp, undefined, undefined, Date.now() - startTime);
      return resp;
    }
    const resp = NextResponse.redirect(new URL('/login', request.url));
    logRequest(request, resp, undefined, undefined, Date.now() - startTime);
    return resp;
  }

  const payload = await verifyToken(token);
  if (!payload) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set('tamamhealth-token', '', { maxAge: 0, path: '/' });
    logRequest(request, response, undefined, undefined, Date.now() - startTime);
    return response;
  }

  // Role-based route enforcement
  const role = payload.role;
  const userId = payload.sub;

  // CSRF defence layer 2: HMAC-bound double-submit token. For any
  // state-changing API request (POST/PUT/PATCH/DELETE) we require both:
  //   - the X-CSRF-Token header,
  //   - the tamamhealth-csrf cookie,
  //   - both equal, and
  //   - the HMAC verifies for this session subject.
  // The Origin check above stops the simple cross-site form attack; this
  // layer holds even if a future change weakens SameSite cookies or a same-
  // site sub-resource gets compromised.
  if (pathname.startsWith('/api/')
      && !isCsrfExemptApiPath(pathname)
      && !isMachineCallerRequest(pathname, request)) {
    const method = request.method.toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const cookieToken = request.cookies.get(CSRF_COOKIE_NAME)?.value || '';
      const headerToken = request.headers.get(CSRF_HEADER_NAME) || '';
      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        const resp = NextResponse.json(
          { error: 'CSRF token missing or mismatched' },
          { status: 403 },
        );
        logRequest(request, resp, userId, role, Date.now() - startTime);
        return resp;
      }
      const ok = await verifyCsrfToken(cookieToken, userId);
      if (!ok) {
        const resp = NextResponse.json(
          { error: 'CSRF token invalid for session' },
          { status: 403 },
        );
        logRequest(request, resp, userId, role, Date.now() - startTime);
        return resp;
      }
    }
  }

  // Page-level routing only. /api/* routes enforce their own role checks via
  // hasRole(auth, ROLES) inside each handler — redirecting them to the
  // default dashboard (a page) would break every authenticated API call.
  // Unknown roles fall through (`hasRoleRouteConfig` returns false), matching
  // the previous behaviour where a missing role entry meant no page gating.
  if (
    hasRoleRouteConfig(role) &&
    !pathname.startsWith('/api/') &&
    !isPathAllowed(role, pathname)
  ) {
    const resp = NextResponse.redirect(
      new URL(getDefaultDashboard(role), request.url),
    );
    logRequest(request, resp, userId, role, Date.now() - startTime);
    return resp;
  }

  const response = nextWithCsp(request);

  // Lazy-mint the CSRF cookie if a valid session is missing one (e.g. a user
  // upgraded across the deploy that introduced this defence, or their cookie
  // was cleared but the session JWT is still valid). Sets the cookie on the
  // outbound response so the next mutation will succeed without a re-login.
  if (!request.cookies.get(CSRF_COOKIE_NAME)) {
    try {
      const fresh = await mintCsrfToken(userId);
      response.cookies.set(CSRF_COOKIE_NAME, fresh, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: SESSION_TTL_SEC,
        path: '/',
      });
    } catch {
      // Minting failure is non-fatal here — the request still succeeds; the
      // user's next mutation will be rejected and they'll see a clean error.
    }
  }

  logRequest(request, response, userId, role, Date.now() - startTime);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
