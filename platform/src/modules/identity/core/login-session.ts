/**
 * Turning a verified staff identity into a session.
 *
 * Every caller that has decided "this person is who they say" arrives here, so
 * they all produce EXACTLY the same session — the same claims, the same
 * cookies, the same role-picker handling. Building one inline anywhere else is
 * how two sign-in paths drift and one quietly grants what the other does not.
 */

import { NextResponse } from 'next/server';
import { createToken } from '@/modules/identity/core/auth-token';
import { mintCsrfToken } from '@/modules/identity/core/csrf';
import { applySessionCookies } from '@/modules/identity/core/session';
import type { ServerUser } from '@/modules/identity/core/server-users';

/** Roles that carry no facility of their own — see `user-scope-rules.ts`. */
export const ROLES_WITHOUT_HOSPITAL = ['super_admin', 'org_admin', 'government', 'county_health_director'];

/**
 * The platform's demo flagship facility.
 *
 * A super-admin account has no facility, so an impersonated clinical session
 * has nothing to scope its worklists to and every screen renders empty. This
 * is the fallback that makes "sign in as any role" usable at all.
 */
const IMPERSONATION_FALLBACK_FACILITY = { id: 'hosp-001', name: 'Juba Teaching Hospital', orgId: 'org-moh-ss' };

export interface EffectiveIdentity {
  role: string;
  actualRole?: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
}

export type RolePickerResult =
  | { ok: true; effective: EffectiveIdentity }
  | { ok: false; error: string; status: number };

/**
 * Resolve the role a session will actually run as.
 *
 * Everyone signs in as their assigned role. ONLY the platform super-admin may
 * pick a different one and enter that role's workspace — and only when the
 * platform policy allows it. `impersonationEnabled` has sat on /admin/security
 * since the screen shipped, defaulting to OFF, while this path ignored it
 * entirely: the control said impersonation was disabled and it was not.
 */
export async function resolveEffectiveIdentity(
  user: ServerUser,
  requestedRole: string | undefined,
): Promise<RolePickerResult> {
  const base: EffectiveIdentity = {
    role: user.role,
    actualRole: undefined,
    hospitalId: user.hospitalId,
    hospitalName: user.hospitalName,
    orgId: user.orgId,
  };
  if (!requestedRole || requestedRole === user.role) return { ok: true, effective: base };

  const { hasRoleRouteConfig } = await import('@/lib/role-routes');
  if (user.role !== 'super_admin' || !hasRoleRouteConfig(requestedRole)) {
    return { ok: false, error: 'You can only sign in as your assigned role.', status: 403 };
  }

  let impersonationEnabled = false;
  try {
    const { getPlatformConfig } = await import('@/lib/services/platform-config-service');
    impersonationEnabled = (await getPlatformConfig()).superAdminPolicies?.impersonationEnabled === true;
  } catch {
    // A policy that cannot be read must not silently enable the most powerful
    // capability in the product. Fail closed: the operator can still sign in
    // as themselves and switch it on.
    impersonationEnabled = false;
  }
  if (!impersonationEnabled) {
    return {
      ok: false,
      error: 'Signing in as another role is switched off for this platform. '
        + 'Turn on support impersonation in Security settings first.',
      status: 403,
    };
  }

  const needsFacility = !ROLES_WITHOUT_HOSPITAL.includes(requestedRole);
  return {
    ok: true,
    effective: {
      role: requestedRole,
      actualRole: user.role,
      hospitalId: needsFacility ? (user.hospitalId ?? IMPERSONATION_FALLBACK_FACILITY.id) : user.hospitalId,
      hospitalName: needsFacility ? (user.hospitalName ?? IMPERSONATION_FALLBACK_FACILITY.name) : user.hospitalName,
      orgId: user.orgId ?? IMPERSONATION_FALLBACK_FACILITY.orgId,
    },
  };
}

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

/**
 * Mint the session and attach both cookies.
 *
 * Also stamps `lastLoginAt`. That happens HERE rather than in the login route
 * so it records the moment a session actually existed — an account with a
 * second factor that never completes the code step has not signed in, and
 * recording it as though it had would make every dormancy report wrong in the
 * one direction that matters.
 */
export async function issueSessionResponse(
  user: ServerUser,
  effective: EffectiveIdentity,
  extra: Record<string, unknown> = {},
): Promise<NextResponse> {
  // Whether this account still owes the platform a second factor. Resolved
  // here, once, and carried as a token claim — the Edge proxy enforces it and
  // has no database. Never blocks the sign-in itself: the person has to get
  // far enough in to enrol, and the gate is what keeps them from going
  // further.
  // How long an impersonated session may last. The console has advertised
  // `impersonationMaxMinutes` since it shipped and nothing shortened anything,
  // so a support session opened "for thirty minutes" lived the full session
  // TTL like any other. Only applied when a role is actually being borrowed.
  let ttlSeconds: number | undefined;
  if (effective.actualRole) {
    try {
      const { getPlatformConfig } = await import('@/lib/services/platform-config-service');
      const minutes = (await getPlatformConfig()).superAdminPolicies?.impersonationMaxMinutes;
      if (Number.isFinite(minutes) && (minutes as number) > 0) ttlSeconds = (minutes as number) * 60;
    } catch {
      // A policy that cannot be read must not silently grant a LONGER session
      // than the operator asked for, so fall back to the documented default
      // rather than to the full session TTL.
      ttlSeconds = 30 * 60;
    }
  }

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
    ttlSeconds,
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
    ...extra,
  });

  // Session cookie plus its CSRF twin (non-httpOnly so the browser's
  // apiFetch wrapper can echo it in the X-CSRF-Token header on every
  // state-changing request; the HMAC binds it to the JWT subject).
  const csrfToken = await mintCsrfToken(user._id);
  applySessionCookies(response.cookies, token, csrfToken);

  const { recordSuccessfulLogin } = await import('@/modules/identity/services/user-service');
  await recordSuccessfulLogin(user._id);

  // An impersonated session is the single most powerful thing that happens on
  // this platform, and it left no trace: the login route wrote no audit row at
  // all, so "who entered which tenant as which role, and when" was
  // unanswerable. Recorded against the REAL account, which is the identity an
  // investigation starts from.
  if (effective.actualRole) {
    const { logAudit } = await import('@/lib/services/audit-service');
    await logAudit(
      'session_impersonation_started', user._id, user.username,
      `${user.username} (${effective.actualRole}) signed in as ${effective.role}`
        + `${effective.orgId ? ` in ${effective.orgId}` : ''}`
        + `${ttlSeconds ? ` — session capped at ${Math.round(ttlSeconds / 60)} minutes` : ''}`,
      true,
    );
  }

  return response;
}
