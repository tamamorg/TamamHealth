/**
 * Shared server-side authentication helper for API routes.
 * Extracts and verifies the JWT from the request cookie, returning the
 * authenticated user payload or null.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './auth-token';
import { isTokenRevoked } from './token-blacklist';
import { captureException } from './observability';
import type { UserRole } from './db-types';

export interface AuthPayload {
  sub: string;
  username: string;
  role: UserRole;
  /** Real account role when a super-admin is signed in AS another role via
   *  the login role picker. Undefined for ordinary sessions. */
  actualRole?: UserRole;
  name: string;
  hospitalId?: string;
  hospitalName?: string;
  /** Extra facilities this user covers — see UserDoc.facilityIds. */
  facilityIds?: string[];
  orgId?: string;
  /** ISO 3166-1 alpha-2 — facility's country (e.g. "SS" for South Sudan) */
  countryId?: string;
  /** Geographic tier fields for sub-org scoping (P0 tier-isolation). */
  payam?: string;
  county?: string;
  state?: string;
  /** True when the user must set a new password before using the app. */
  mustChangePassword?: boolean;
}

/**
 * Verify the JWT cookie on the incoming request.
 * Returns the decoded payload or null if missing/invalid.
 *
 * Also rejects tokens whose underlying user has been deactivated since the
 * JWT was issued. Without this check a deactivated user keeps full access
 * until the JWT's natural expiry (up to 8h), which defeats the point of
 * deactivation. We look the user up in the users DB and require
 * `isActive !== false`. In production this check fails closed: a missing or
 * unreadable user record invalidates the JWT, except for the synthetic
 * bootstrap "admin" account used before the users DB exists.
 */
export async function getAuthPayload(request: NextRequest): Promise<AuthPayload | null> {
  const token = request.cookies.get('tamamhealth-token')?.value;
  if (!token) return null;

  // Reject tokens that have been explicitly revoked (logout). The store is
  // file-backed and survives restarts.
  if (await isTokenRevoked(token)) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;
  const auth = payload as unknown as AuthPayload;
  const isProduction = process.env.NODE_ENV === 'production';
  // Demo deployments run without a server-side user store (no CouchDB; the
  // roster lives in each browser's PouchDB), so "user not found" there means
  // "no store", not "account deleted" — the signed JWT stays the source of truth.
  const isDemoDeployment = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

  // Live deactivation check. Avoid the lookup for the synthetic "admin"
  // bootstrap account whose JWT is issued before any users DB exists.
  try {
    const { getUserById } = await import('./services/user-service');
    const user = await getUserById(auth.sub);
    // If the user record exists and is explicitly deactivated, deny.
    // Missing user in production → deny; non-production remains permissive for
    // local/demo bootstrap data.
    if (user && user.isActive === false) return null;
    if (!user && isProduction && auth.sub !== 'admin' && !isDemoDeployment) return null;
    // Password epoch: a token minted before the account's latest password
    // change is dead, no matter how much JWT life remains. This is what makes
    // the long "remember me" session TTL safe — change/reset a password and
    // every other session for that account is revoked on its next request.
    if (user?.passwordUpdatedAt) {
      const liveSec = Math.floor(Date.parse(user.passwordUpdatedAt) / 1000);
      if (Number.isFinite(liveSec) && liveSec > (payload.pwdAt ?? 0)) return null;
    }
  } catch (err) {
    if (isProduction && auth.sub !== 'admin' && !isDemoDeployment) {
      captureException(err, { area: 'api-auth', check: 'user-active', sub: auth.sub });
      return null;
    }
  }

  // Tenant kill-switch (SaaS control plane). A suspended / cancelled /
  // deactivated organization loses all access on the next request. Platform
  // operators (super_admin) are exempt so they can lift the suspension. In
  // production, tenant lookup errors fail closed rather than granting access
  // while the control plane is unavailable.
  if (auth.role !== 'super_admin' && auth.orgId) {
    try {
      const { isOrgAccessAllowed } = await import('./services/tenant-control-service');
      if (!(await isOrgAccessAllowed(auth.orgId))) return null;
    } catch (err) {
      if (isProduction) {
        captureException(err, { area: 'api-auth', check: 'tenant-access', orgId: auth.orgId });
        return null;
      }
    }
  }

  return auth;
}

/**
 * Convenience: return a 401 JSON response.
 */
export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Convenience: return a 403 JSON response.
 */
export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

/**
 * Clinical-flow station roles → the legacy role they stand in for.
 *
 * WHY THIS EXISTS: the six clinical-flow station roles (EHR Clinical Flow §4)
 * are real `UserRole`s with routing configs, dashboards and seeded accounts —
 * but they were never added to the hand-maintained `UserRole[]` allow-lists on
 * API routes. The measured result was that five of the six matched **zero** of
 * the 40 role-guarded routes: a `triage_nurse` could sign in, land on
 * `/dashboard`, and then be refused by `/api/triage` itself.
 *
 * Each mapping is the FIRST non-self entry of that station's `mapsToUserRoles`
 * in `lib/clinical-flow/roles.ts` — i.e. taken from the declared migration
 * mapping, not invented here. It is deliberately the narrowest equivalent:
 * `triage_nurse` also maps to `clinical_officer`, but honouring that would
 * hand a triage nurse prescribing rights, which the station's declared
 * capabilities (`triage`, `vitals_capture`, `patient_routing`) plainly exclude.
 *
 * THIS IS A COMPATIBILITY SHIM, NOT THE DESTINATION. `lib/clinical-flow/roles.ts`
 * already defines a full capability model (`hasCapability`, `Capability`) that
 * no API route uses. Guarding routes by capability is the correct fix, but it
 * requires deciding which capability each of the 40 routes demands — a clinical
 * policy decision, not a mechanical one. Until that happens this keeps the
 * stations usable without granting anything their legacy equivalent lacks.
 */
const STATION_ROLE_EQUIVALENT: Readonly<Partial<Record<UserRole, UserRole>>> = {
  central_registration_clerk: 'front_desk',
  clinic_clerk: 'front_desk',
  triage_nurse: 'nurse',
  rooming_nurse: 'nurse',
  clinician: 'doctor',
  records_hmis_officer: 'hrio',
};

/**
 * Check whether the authenticated user has one of the required roles.
 *
 * A clinical-flow station role also satisfies an allow-list that names its
 * legacy equivalent — see `STATION_ROLE_EQUIVALENT` above. Exact matches are
 * always preferred, so a route that lists a station role explicitly keeps
 * working unchanged.
 */
export function hasRole(auth: AuthPayload, allowed: UserRole[]): boolean {
  // The platform super-admin passes every role gate by design ("total
  // access"). Every hand-maintained allow-list under src/app/api already
  // names super_admin explicitly; this wildcard turns that convention into a
  // guarantee so a new route can't accidentally lock the administrator out.
  // It widens nothing for any other role — an allow-list naming
  // 'super_admin' still rejects everyone else.
  if (auth.role === 'super_admin') return true;
  if (allowed.includes(auth.role)) return true;
  const equivalent = STATION_ROLE_EQUIVALENT[auth.role];
  return equivalent ? allowed.includes(equivalent) : false;
}

/**
 * Standard error response for validation errors.
 */
export function validationError(errors: Record<string, string>) {
  return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 422 });
}

/**
 * Standard error response for server errors.
 */
export function serverError(message = 'Internal server error') {
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Extract a safe loggable representation of an unknown error. Avoids dumping
 * raw error objects that may hold request bodies or other PHI in their
 * properties. Only the message, error name, and a short stack preview are
 * returned.
 */
export function sanitizeError(err: unknown): string {
  if (err instanceof Error) {
    // Include the first two stack frames only — enough to locate the throw
    // site without leaking user-supplied values from deeper in the call path.
    const stackHead = err.stack
      ? err.stack.split('\n').slice(0, 3).join(' | ')
      : '';
    return `${err.name}: ${err.message}${stackHead ? ` (${stackHead})` : ''}`;
  }
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

/**
 * Log an API error with a route tag and a sanitized payload. Use this
 * everywhere instead of `console.error('[tag]', err)` so we never
 * accidentally write a raw request body / patient record to the log.
 *
 * Also forwards to Sentry when the SDK is initialised. The local console
 * line is kept for dev visibility; in production the operator gets both a
 * structured log line and a Sentry event with the route tag attached.
 */
export function logApiError(tag: string, err: unknown): void {
  console.error(tag, sanitizeError(err));
  captureException(err, { tag });
}
