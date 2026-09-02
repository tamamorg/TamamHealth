import { NextRequest, NextResponse } from 'next/server';
import { CSRF_COOKIE_NAME, SESSION_RENEW_AFTER_SEC, SESSION_TTL_SEC, applySessionCookies, createToken, isTokenRevoked, mintCsrfToken, verifyToken } from '@/modules/identity';

/**
 * The display name of an organization, for accounts whose own record predates
 * `UserDoc.orgName`. Never throws: a session must still hydrate when the
 * organizations store is unreachable — the caller simply gets no name.
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

async function lookupHospitalName(hospitalId?: string): Promise<string | undefined> {
  if (!hospitalId) return undefined;
  try {
    const { getHospitalById } = await import('@/lib/services/hospital-service');
    return (await getHospitalById(hospitalId))?.name;
  } catch {
    return undefined;
  }
}

/**
 * The slice of `superAdminPolicies` a client is allowed to act on.
 *
 * An explicit allow-list, not the whole document: the config also carries
 * break-glass and continuity settings that are the operator's business and
 * have no business in a nurse's browser.
 *
 * Never throws — an unreadable platform config must not stop anybody signing
 * in; the client simply falls back to the facility/org chain it used before.
 */
async function platformPolicyForClient(): Promise<{ sessionTimeoutMinutes?: number; screenLockRequired?: boolean }> {
  try {
    const { getPlatformConfig } = await import('@/lib/services/platform-config-service');
    const policies = (await getPlatformConfig()).superAdminPolicies;
    const minutes = policies?.sessionTimeoutMinutes;
    return {
      ...(Number.isFinite(minutes) && (minutes as number) > 0 ? { sessionTimeoutMinutes: minutes } : {}),
      // Only the true case is worth sending: absent reads as "not required",
      // which is what a deployment that never set it means.
      ...(policies?.screenLockRequired === true ? { screenLockRequired: true } : {}),
    };
  } catch {
    return {};
  }
}

export async function GET(request: NextRequest) {
  const token = request.cookies.get('tamamhealth-token')?.value;

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // /api/auth/me is exempt from the page-middleware auth gate (so an
  // unauthenticated browser can call it on app load and get {user:null}
  // instead of a redirect). That means the blacklist check must run here
  // explicitly — otherwise a logged-out token would still hydrate the user.
  if (await isTokenRevoked(token)) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  // Hydrate from the live user record, not the 8h-stale JWT, so a
  // deactivation or an admin-forced password reset takes effect on the next
  // app load instead of lingering until the token expires. Falls back to the
  // JWT claims when the DB is unavailable or the account is the synthetic
  // "admin" bootstrap (whose JWT predates any users DB). Mirrors the live
  // re-check in getAuthPayload (lib/api-auth.ts).
  const isProduction = process.env.NODE_ENV === 'production';
  let fresh: {
    name?: string; role?: string; actualRole?: string; hospitalId?: string; hospitalName?: string;
    orgId?: string; orgName?: string; mustChangePassword?: boolean;    /** Staff department — routes department-addressed patient transfers to the
     *  right inbox. Not a JWT claim, so it is only populated from the live user
     *  record; a JWT-only fallback leaves it undefined rather than stale. */
    department?: string;
    preferences?: import('@/lib/db-types').UserPreferences;
  } = {
    name: payload.name,
    role: payload.role,
    actualRole: payload.actualRole,
    hospitalId: payload.hospitalId,
    hospitalName: payload.hospitalName,
    orgId: payload.orgId,
    mustChangePassword: payload.mustChangePassword,
  };
  // Set when the live record was loaded — gates session renewal below, and
  // carries the current password epoch into any re-minted token.
  let liveUser: { passwordUpdatedAt?: string } | null = null;
  try {
    const { getUserById } = await import('@/modules/identity/services/user-service');
    const user = await getUserById(payload.sub);
    if (user) {
      // Deactivated mid-session → drop the session on next load.
      if (user.isActive === false) {
        return NextResponse.json({ user: null }, { status: 401 });
      }
      // Password epoch: a token minted before the account's latest password
      // change must not hydrate a session (mirrors getAuthPayload).
      if (user.passwordUpdatedAt) {
        const liveSec = Math.floor(Date.parse(user.passwordUpdatedAt) / 1000);
        if (Number.isFinite(liveSec) && liveSec > (payload.pwdAt ?? 0)) {
          return NextResponse.json({ user: null }, { status: 401 });
        }
      }
      liveUser = user;
      // A super-admin signed in AS another role (login role picker). Keep the
      // token's impersonated role + facility scope across reloads — but ONLY
      // while the live record still IS a super_admin; if the account was
      // demoted mid-session, the live role wins and the impersonation ends.
      const impersonating = payload.actualRole === 'super_admin' && user.role === 'super_admin';
      fresh = {
        name: user.name,
        role: impersonating ? payload.role : user.role,
        actualRole: impersonating ? payload.actualRole : undefined,
        hospitalId: impersonating ? payload.hospitalId : user.hospitalId,
        hospitalName: impersonating
          ? (payload.hospitalName || await lookupHospitalName(payload.hospitalId))
          : (user.hospitalName || await lookupHospitalName(user.hospitalId)),
        orgId: impersonating ? payload.orgId : user.orgId,
        // Not carried on the JWT — the organization the account belongs to is
        // stable, so it is read from the live record rather than adding another
        // claim that would go stale on a rename.
        //
        // Resolved from the organization when the account itself does not carry
        // the name. Every account created before `orgName` existed is in that
        // state, and they are the majority — without this fallback the header
        // and settings would name the organization only for accounts created
        // after the field shipped, which reads as the feature being broken.
        // Doing it here rather than in a migration means existing users are
        // fixed on their next page load, with nothing to run.
        orgName: impersonating ? undefined : (user.orgName || await lookupOrgName(user.orgId)),
        mustChangePassword: user.mustChangePassword,
        department: user.department,
        preferences: user.preferences,
      };
    } else if (isProduction && payload.sub !== 'admin' && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
      // Account no longer exists in production → deny. Demo deployments are
      // exempt: with no CouchDB attached the server has no user store at all
      // (the roster lives in each browser's PouchDB), so a not-found there
      // falls back to the signed JWT claims like the DB-unavailable case.
      return NextResponse.json({ user: null }, { status: 401 });
    }
  } catch {
    // DB unavailable — fall back to JWT claims (already seeded in `fresh`).
  }

  const response = NextResponse.json({
    user: {
      _id: payload.sub,
      username: payload.username,
      name: fresh.name,
      role: fresh.role,
      actualRole: fresh.actualRole,
      hospitalId: fresh.hospitalId,
      hospitalName: fresh.hospitalName,
      orgId: fresh.orgId,
      orgName: fresh.orgName,
      mustChangePassword: fresh.mustChangePassword,
      department: fresh.department,
      preferences: fresh.preferences,
    },
    // Deployment-wide operational policy, sent with the session because every
    // signed-in user's client needs it and none of it is sensitive: an idle
    // timeout is not a secret, and the alternative is a second request on
    // every app load. Read by `useAutoLock`, which treats it as a ceiling.
    platform: await platformPolicyForClient(),
  });

  // Sliding renewal — the mechanism behind "the browser remembers I'm logged
  // in". The client calls /api/auth/me on every app load; when the presented
  // token is older than SESSION_RENEW_AFTER_SEC we mint a fresh one from the
  // live-hydrated claims and reset both cookies to a full TTL, so an actively
  // used session never expires. Renewal requires the live user record (or a
  // demo deployment, which has no server-side user store) — in production a
  // session we cannot re-validate is left to age out rather than extended.
  const isDemoDeployment = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const nowSec = Math.floor(Date.now() / 1000);
  const tokenAgeSec = typeof payload.iat === 'number' ? nowSec - payload.iat : 0;
  // "Keep me signed in" (login/page.tsx), carried as a token claim so it
  // survives a renewal. Absent on tokens minted before the claim existed —
  // treat that the same as `true`, matching every session's behaviour before
  // this existed, rather than silently downgrading it to a browser-session
  // cookie on its first renewal.
  const persist = payload.persist !== false;
  if (tokenAgeSec > SESSION_RENEW_AFTER_SEC && (liveUser || isDemoDeployment)) {
    try {
      const renewed = await createToken({
        _id: payload.sub,
        username: payload.username,
        role: fresh.role ?? payload.role,
        actualRole: fresh.actualRole,
        name: fresh.name ?? payload.name,
        hospitalId: fresh.hospitalId,
        hospitalName: fresh.hospitalName,
        orgId: fresh.orgId,
        countryId: payload.countryId,
        payam: payload.payam,
        county: payload.county,
        state: payload.state,
        mustChangePassword: fresh.mustChangePassword,
        passwordUpdatedAt: liveUser?.passwordUpdatedAt,
        // Demo deployments have no live record; carry the claim forward.
        pwdAt: liveUser ? undefined : payload.pwdAt,
        // Preserve the ORIGINAL sign-in's choice — a renewal must not quietly
        // upgrade a browser-session cookie into a persistent one, which is
        // exactly what re-applying `applySessionCookies` at its old default
        // would have done on every session's first renewal.
        persist,
      });
      const csrf = await mintCsrfToken(payload.sub);
      applySessionCookies(response.cookies, renewed, csrf, persist);
      return response;
    } catch {
      // Renewal is best-effort — the current token is still valid, so fall
      // through to the plain response (and the lazy CSRF mint below).
    }
  }

  // Lazy-mint the CSRF cookie if the client has a valid session JWT but no
  // CSRF cookie — handles the upgrade-across-deploy case and the "user
  // cleared cookies but session JWT still valid" case. /api/auth/me is the
  // right bootstrap trigger because the client calls it on every app load.
  if (!request.cookies.get(CSRF_COOKIE_NAME)) {
    try {
      const csrf = await mintCsrfToken(payload.sub);
      response.cookies.set(CSRF_COOKIE_NAME, csrf, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        // Mirrors the session cookie's own persistence character — a CSRF
        // cookie that outlives a browser-session token cookie is a stray with
        // nothing left to pair with once the browser closes.
        ...(persist ? { maxAge: SESSION_TTL_SEC } : {}),
        path: '/',
      });
    } catch {
      // Non-fatal: client gets a CSRF rejection on its next mutation.
    }
  }

  return response;
}
