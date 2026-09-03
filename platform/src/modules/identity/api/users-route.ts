/**
 * Identity API implementation for /api/users.
 * GET  — List all users (supports filtering by role, hospitalId, etc.)
 * POST — Create user, update user, reset password, or deactivate user
 */
import { ADMIN } from '@/lib/sync/write-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { forbidden, getAuthPayload, hasRole, logApiError, serverError, unauthorized } from '../core/api-auth';
import type { AuthPayload } from '../core/api-auth';
import { PasswordPolicyError } from '../policy/password-policy';
import {
  FACILITY_REQUIRED_MESSAGE,
  ORG_REQUIRED_MESSAGE,
  PLATFORM_ONLY_ASSIGNABLE_ROLES,
  roleNeedsFacility,
} from '../policy/user-scope-rules';
import { STAFF_DIRECTORY_READ_ROLES } from '../policy/staff-directory-access';
import { withAuditLog, AUDIT_ACTION_HEADER } from '@/lib/audit/with-audit';

import type { UserRole, UserDoc } from '@/lib/db-types';

// The org/facility requirement is stated once, in `lib/user-scope-rules.ts`,
// and read by this route, `user-service.createUser`, and the two admin UIs —
// which previously kept four copies of the same list and had already drifted.

// Reading the staff directory is org-scoped (buildScopeFromAuth) and the rows
// come back through redactUserForClient — it is a colleague list, not PHI.
// `hospital_manager` runs the facility's roster, shifts, leave and payroll off
// exactly this list, and is the role the Facility Management dashboard belongs
// to, so it reads here alongside medical_superintendent. Writes stay narrower:
// only WRITE_ROLES may create or change an account.
// Shared with `useUsers`, so the client stops asking for a directory it is not
// allowed to read instead of retrying a 403 on every mount. This route remains
// the enforcement point — the export only saves a request that would be denied.
const READ_ROLES: UserRole[] = [...STAFF_DIRECTORY_READ_ROLES];
const WRITE_ROLES = ADMIN;
// Platform-wide / national (cross-tenant) roles. A user holding one of these
// bypasses org scoping in filterByScope, so only a platform operator
// (super_admin) may grant them. Without this guard a tenant's org_admin could
// create — or promote themselves into — a super_admin/government account and
// read every other organization's PHI (privilege-escalation → tenant breakout).
const PRIVILEGED_ASSIGNABLE_ROLES: readonly UserRole[] = PLATFORM_ONLY_ASSIGNABLE_ROLES;

/**
 * Roughly 1.4 MB of base64 — a 640px JPEG from `PhotoCaptureModal` is well
 * under 200 KB, so this is generous for a real photo and still small enough
 * that a user document stays syncable over a field connection.
 */
const MAX_PHOTO_CHARS = 1_400_000;

/**
 * Accept only a bona-fide raster image data URL.
 *
 * This value is stored on the user document and rendered by surfaces that
 * include the PUBLIC booking pages, so it must not be free-form. Raster types
 * only: SVG is a document, and an `<img>` is not the only place a URL like
 * this can end up. Returns the value to store, or an Error to return to the
 * caller.
 */
function normalisePhoto(raw: unknown): { value?: string | null } | { error: string } {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') return { error: 'photoUrl must be a string' };
  if (raw.length > MAX_PHOTO_CHARS) return { error: 'Photo is too large' };
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) {
    return { error: 'Photo must be a PNG, JPEG or WebP image' };
  }
  return { value: raw };
}

/**
 * Return a 403 if `actorRole` is not allowed to assign `targetRole`.
 * super_admin may assign anything; everyone else (i.e. org_admin) is confined
 * to non-privileged roles within their own tenant.
 */
function assignableRoleError(actorRole: UserRole, targetRole: UserRole | undefined): NextResponse | null {
  if (!targetRole) return null;
  if (actorRole === 'super_admin') return null;
  if (PRIVILEGED_ASSIGNABLE_ROLES.includes(targetRole)) {
    return forbidden('You are not permitted to assign platform or national roles.');
  }
  return null;
}

/**
 * Machine-readable reasons for a central account-assignment refusal. The
 * editor reads the same central facility source, so this is a race/integrity
 * guard rather than an expected part of the workflow.
 */
type FacilityAssignmentReason = 'not_found' | 'wrong_organization' | 'inactive';

function facilityNotAssignable(
  hospitalId: string,
  reason: FacilityAssignmentReason,
): NextResponse {
  const message = reason === 'inactive'
    ? 'This facility is retired and cannot receive new account assignments.'
    : reason === 'wrong_organization'
      ? 'This facility does not belong to the selected organization.'
      : 'This facility is not available for account assignment. Refresh the facility list and choose an available facility.';
  return NextResponse.json({
    error: message,
    code: 'FACILITY_NOT_ASSIGNABLE',
    reason,
    facilityId: hospitalId,
  }, { status: 400 });
}

/**
 * Validate and canonicalize a user's additional facility grants.
 *
 * Facility ids are authorization claims: they become CouchDB roles, JWT
 * claims, replication selectors and service/API read scope. They therefore
 * receive the same server-side ownership check as the home facility and are
 * never accepted as an opaque client array.
 */
async function canonicalAdditionalFacilities(input: {
  raw: unknown;
  homeFacilityId?: string;
  orgId?: string;
  actorRole: UserRole;
}): Promise<{ ids: string[] } | { response: NextResponse }> {
  if (input.raw === undefined) return { ids: [] };
  if (!Array.isArray(input.raw) || input.raw.some(id => typeof id !== 'string')) {
    return { response: NextResponse.json({ error: 'facilityIds must be an array of facility IDs' }, { status: 400 }) };
  }

  const ids = [...new Set(
    input.raw.map(id => id.trim()).filter(id => id && id !== input.homeFacilityId),
  )];
  if (ids.length > 20) {
    return { response: NextResponse.json({ error: 'A user cannot be assigned to more than 20 additional facilities' }, { status: 400 }) };
  }

  const { getHospitalById } = await import('@/lib/services/hospital-service');
  const facilities = await Promise.all(ids.map(id => (
    getHospitalById(id, { role: input.actorRole, orgId: input.orgId })
  )));
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    const facility = facilities[index];
    if (!facility) {
      return { response: facilityNotAssignable(id, 'not_found') };
    }
    if (!input.orgId || !facility.orgId || facility.orgId !== input.orgId) {
      return { response: facilityNotAssignable(id, 'wrong_organization') };
    }
    if (facility.isActive === false) {
      return { response: facilityNotAssignable(id, 'inactive') };
    }
  }
  return { ids };
}

async function validateActiveOrganization(orgId: string | undefined): Promise<NextResponse | null> {
  if (!orgId) {
    return NextResponse.json({ error: 'Organization assignment is required' }, { status: 400 });
  }
  const { getOrganizationById } = await import('@/lib/services/organization-service');
  const organization = await getOrganizationById(orgId);
  if (!organization) {
    return NextResponse.json({ error: 'Assigned organization was not found or is inactive' }, { status: 400 });
  }
  // `getTenantAccess` is the same kill-switch `getAuthPayload` runs on every
  // request, but that one reads the ACTOR's tenant — and a super_admin carries
  // no orgId and is exempt anyway. So a platform operator could add staff to a
  // suspended or cancelled tenant: accounts billed against a plan the tenant no
  // longer holds, which cannot sign in because their own auth gate denies them.
  const { getTenantAccess } = await import('@/lib/services/tenant-control-service');
  const access = await getTenantAccess(orgId);
  if (!access.allowed) {
    return NextResponse.json(
      { error: `${organization.name} is ${access.reason} — no new accounts can be created in it.` },
      { status: 400 },
    );
  }
  return null;
}

/**
 * Seat limit. `maxUsers` was shown on four screens (the tenant matrix, the
 * billing editor, the org-settings usage meter, the organizations list) and
 * enforced by nothing, so an organization on a 50-seat plan could hold 500.
 *
 * Counted from ACTIVE accounts only: a deactivated leaver should not hold a
 * seat their replacement then cannot have. Fails open on an unreadable count —
 * a transient database error must not stop a clinic hiring.
 */
async function validateSeatAvailable(orgId: string | undefined): Promise<NextResponse | null> {
  if (!orgId) return null;
  try {
    const { getOrganizationById } = await import('@/lib/services/organization-service');
    const organization = await getOrganizationById(orgId);
    const max = organization?.maxUsers;
    if (!max || max <= 0) return null;
    const { getAllUsers } = await import('@/modules/identity/services/user-service');
    const inUse = (await getAllUsers({ orgId, role: 'super_admin' }))
      .filter(u => u.orgId === orgId && u.isActive !== false).length;
    if (inUse >= max) {
      return NextResponse.json(
        {
          error: `${organization!.name} has used all ${max} of its licensed seats. `
            + 'Deactivate an account or raise the seat limit before adding another.',
        },
        { status: 409 },
      );
    }
  } catch (err) {
    logApiError('[API /users] seat check', err);
  }
  return null;
}

/**
 * The organization's display name, for stamping onto the user document.
 *
 * Deliberately read from the organization record rather than accepted from the
 * request body: the name travels with the account to devices that never
 * replicated the organizations database, so a client-supplied value would let
 * a caller label their own account with any organization they liked. Returns
 * undefined when there is no org (platform/national accounts) or it cannot be
 * read — `orgName` is a display convenience and must never fail a write that
 * the tenant checks above have already allowed.
 */
async function resolveOrgName(orgId: string | undefined): Promise<string | undefined> {
  if (!orgId) return undefined;
  try {
    const { getOrganizationById } = await import('@/lib/services/organization-service');
    return (await getOrganizationById(orgId))?.name;
  } catch {
    return undefined;
  }
}

/**
 * Authorize a mutation that targets an EXISTING user (reset_password,
 * deactivate, reactivate, update, delete). Two independent rules, both
 * enforced for every non-super_admin actor:
 *
 *  1. Privileged-target guard — only a super_admin may act on a platform or
 *     national account (super_admin / government / county_health_director).
 *     The seeded super_admin carries NO orgId, so a tenant's org_admin must
 *     never be able to reset, disable, demote, or delete it. Without this an
 *     org_admin could reset the operator's password and take over the whole
 *     platform (privilege-escalation → cross-tenant breakout).
 *
 *  2. Same-tenant guard — an org_admin may act only within their own
 *     organization. A target with a falsy `orgId` is treated as OUTSIDE the
 *     tenant (deny), because platform/national accounts carry no orgId; a
 *     missing orgId must never make the check pass.
 *
 * super_admin bypasses both. `null` target → allowed here (callers issue their
 * own 404). Returns a 403 response, or `null` when the action may proceed.
 */
function targetMutationError(
  actor: AuthPayload,
  target: { role: UserRole; orgId?: string } | null | undefined,
): NextResponse | null {
  if (!target) return null;
  if (actor.role === 'super_admin') return null;
  if (PRIVILEGED_ASSIGNABLE_ROLES.includes(target.role)) {
    return forbidden('You are not permitted to modify platform or national accounts.');
  }
  if (actor.role === 'org_admin') {
    if (!target.orgId || !actor.orgId || target.orgId !== actor.orgId) {
      return forbidden('Cannot modify users outside your own organization');
    }
  }
  return null;
}
/**
 * Tag the response so the audit wrapper records the verb that actually ran.
 *
 * This route serves six of them. A single fixed action name meant every
 * deletion, reset and deactivation was logged as `user.create` — see
 * `AUDIT_ACTION_HEADER`.
 */
function audited(response: NextResponse, action: string): NextResponse {
  response.headers.set(AUDIT_ACTION_HEADER, action);
  return response;
}

/**
 * Refuse an action that would lock somebody — or an entire tenant — out.
 *
 * Two rules, and both were missing:
 *
 *  1. NEVER YOURSELF. `getAuthPayload` re-reads `isActive` on every request,
 *     so an administrator who deactivates their own account is signed out
 *     before the response finishes rendering, with no way back in. `delete`
 *     already refused this; `deactivate` did not, which left the gentler-
 *     sounding action as the one that could not be undone.
 *  2. NEVER THE LAST ADMINISTRATOR. An organization with no active `org_admin`
 *     cannot add staff, reset a password, or reach its own user management at
 *     all. Recovery means a platform operator — who, in this deployment, may
 *     be in another country while the clinic is offline for the afternoon.
 *
 * A `super_admin` is exempt from rule 2 for other people's tenants (that is
 * the point of a platform operator) but NOT from rule 1: locking the platform
 * operator out of the platform is the worst version of this bug, not an
 * exception to it.
 */
async function lastAdminLockoutError(
  actor: AuthPayload,
  target: UserDoc,
  verb: 'deactivate' | 'delete' | 'change the role of',
): Promise<NextResponse | null> {
  if (target._id === actor.sub) {
    return NextResponse.json(
      {
        error: verb === 'change the role of'
          ? 'You cannot change your own role. Ask another administrator to do it.'
          : `You cannot ${verb} your own account — you would be signed out immediately with no way back in. `
            + 'Ask another administrator to do it.',
      },
      { status: 400 },
    );
  }
  if (target.role !== 'org_admin' || !target.orgId) return null;

  // Rule 2 does not bind the platform operator. The docstring above has always
  // said so — "a `super_admin` is exempt from rule 2 for other people's
  // tenants (that is the point of a platform operator)" — but the check was
  // never written, so the one role that exists to resolve a tenant's problems
  // was refused by a guard designed to protect tenants from themselves.
  // Decommissioning a tenant, or removing an administrator who should not have
  // one, both legitimately leave an organization with no admin; the operator
  // can then appoint one, which is precisely what nobody inside that
  // organization could do. Rule 1 above still binds them: this exemption is
  // reached only for OTHER people's accounts.
  if (actor.role === 'super_admin') return null;

  const { countRemainingOrgAdmins } = await import('@/modules/identity/services/user-service');
  const remaining = await countRemainingOrgAdmins(target.orgId, target._id);
  if (remaining > 0) return null;
  return NextResponse.json(
    {
      error: `${target.name} is the only active administrator for this organization. `
        + `Give someone else the administrator role first, or the organization will have nobody who can manage its staff.`,
    },
    { status: 409 },
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllUsers } = await import('@/modules/identity/services/user-service');
    const { redactUserForClient } = await import('@/modules/identity/services/user-service');
    const { buildScopeFromAuth } = await import('@/lib/services/data-scope');
    const scope = buildScopeFromAuth(auth);
    const users = await getAllUsers(scope);
    return NextResponse.json({ users: users.map(redactUserForClient) });
  } catch (err) {
    logApiError('[API /users GET]', err);
    return serverError();
  }
}
async function postHandler(request: NextRequest) {
  try {
    const { checkRateLimit } = await import('@/lib/api-security');
    const rateLimitResponse = await checkRateLimit(request, 'users:write', 20);
    if (rateLimitResponse) return rateLimitResponse;
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    // Credentials are opaque secrets, not display text. Generic string
    // sanitization trims and rewrites HTML-like substrings, which meant the
    // password shown in the one-time handoff could differ from the hash that
    // was stored. Preserve them byte-for-byte and reject invisible edge spaces
    // explicitly instead of silently changing what the administrator entered.
    const rawPassword = body.password;
    const rawNewPassword = body.newPassword;
    const { sanitizePayload } = await import('@/lib/validation');
    body = sanitizePayload(body);
    if (typeof rawPassword === 'string') body.password = rawPassword;
    if (typeof rawNewPassword === 'string') body.newPassword = rawNewPassword;
    for (const [field, value] of [['password', rawPassword], ['newPassword', rawNewPassword]] as const) {
      if (typeof value === 'string' && value !== value.trim()) {
        return NextResponse.json({ error: `${field} cannot start or end with spaces` }, { status: 400 });
      }
    }
    const action = body.action as string;
    const { getUserById } = await import('@/modules/identity/services/user-service');

    // Self-service lane: any authenticated user may update their OWN benign
    // profile fields (name, phone) — nothing role- or tenancy-bearing. All
    // other mutations require an admin role below. Password changes go through
    // /api/auth/change-password (which verifies the current password), never here.
    if (action === 'update' && body.userId === auth.sub && !hasRole(auth, WRITE_ROLES)) {
      const { updateUser } = await import('@/modules/identity/services/user-service');
      // A staff member's own photo is as benign as their own phone number, and
      // "edit it yourself" is the only way a directory of faces stays current.
      const selfPhoto = normalisePhoto(body.photoUrl);
      if ('error' in selfPhoto) {
        return NextResponse.json({ error: selfPhoto.error }, { status: 400 });
      }
      const updated = await updateUser(
        auth.sub,
        {
          name: body.name as string | undefined,
          phone: body.phone as string | undefined,
          photoUrl: selfPhoto.value,
          department: body.department as string | undefined,
          specialty: body.specialty as string | undefined,
        },
        auth.sub,
        auth.username
      );
      const { redactUserForClient } = await import('@/modules/identity/services/user-service');
      return NextResponse.json({ user: redactUserForClient(updated) });
    }

    if (!hasRole(auth, WRITE_ROLES)) return forbidden();
    // Reset password
    if (action === 'reset_password') {
      if (!body.userId || !body.newPassword) {
        return NextResponse.json(
          { error: 'userId and newPassword are required' },
          { status: 400 }
        );
      }
      const target = await getUserById(body.userId as string);
      if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      const authzError = targetMutationError(auth, target);
      if (authzError) return authzError;
      const { resetPassword } = await import('@/modules/identity/services/user-service');
      await resetPassword(
        body.userId as string,
        body.newPassword as string,
        auth.sub,
        auth.username
      );
      return audited(NextResponse.json({ success: true }), 'user.password_reset');
    }

    // Re-send the set-your-password invitation.
    //
    // The invite issuer had exactly one call site — account creation — so an
    // invitation that expired (72 hours), went to a mistyped address, or was
    // deleted unread left an admin password reset as the only way forward, and
    // that hands a plaintext credential back into the room. Re-issuing
    // overwrites any outstanding token, so the previous link dies here, which
    // is what an administrator means by "send it again".
    if (action === 'resend_invite') {
      if (!body.userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 });
      }
      const target = await getUserById(body.userId as string);
      if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      const authzError = targetMutationError(auth, target);
      if (authzError) return authzError;
      if (target.isActive === false) {
        return NextResponse.json(
          { error: 'This account is deactivated. Reactivate it before sending an invitation.' },
          { status: 400 },
        );
      }
      const { deliverAccountInvite } = await import('@/modules/identity/services/invite-delivery');
      const invitation = await deliverAccountInvite(target);
      return audited(NextResponse.json({ success: true, invitation }), 'user.invite_resend');
    }
    // Deactivate / reactivate user (toggle via `activate` boolean; default off)
    if (action === 'deactivate' || action === 'reactivate') {
      if (!body.userId) {
        return NextResponse.json(
          { error: 'userId is required' },
          { status: 400 }
        );
      }
      const target = await getUserById(body.userId as string);
      if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
      const authzError = targetMutationError(auth, target);
      if (authzError) return authzError;
      const activate = action === 'reactivate';
      if (activate) {
        // A reactivated account takes a seat back. Skipping the check here was
        // how an organization on a 50-seat plan could hold 60: deactivate ten,
        // create ten, reactivate the ten.
        const seatError = await validateSeatAvailable(target.orgId);
        if (seatError) return seatError;
        const { reactivateUser } = await import('@/modules/identity/services/user-service');
        await reactivateUser(body.userId as string, auth.sub, auth.username);
        return audited(NextResponse.json({ success: true }), 'user.reactivate');
      }

      // Closing your own account signs you out on the next request — the live
      // isActive check in getAuthPayload sees to that — and if you were the
      // last administrator, it takes the whole tenant's user management with
      // it. `delete` has always refused to self-target; `deactivate` did not,
      // which made the safer-sounding action the dangerous one.
      const lockoutError = await lastAdminLockoutError(auth, target, 'deactivate');
      if (lockoutError) return lockoutError;

      const { deactivateUser } = await import('@/modules/identity/services/user-service');
      await deactivateUser(body.userId as string, auth.sub, auth.username);
      const { summarizeOpenWork } = await import('@/modules/identity/services/offboarding-service');
      // Reported AFTER the deactivation, never as a gate on it: access must be
      // revocable the moment someone leaves, whatever is still assigned to
      // them. The caller shows it so the work gets reassigned.
      return audited(
        NextResponse.json({ success: true, openWork: await summarizeOpenWork(body.userId as string) }),
        'user.deactivate',
      );
    }
    // Delete user (permanent). Confined like other mutations: org_admin only
    // within their own tenant, never a platform/national account, never self.
    if (action === 'delete') {
      if (!body.userId) {
        return NextResponse.json(
          { error: 'userId is required' },
          { status: 400 }
        );
      }
      if (body.userId === auth.sub) {
        return NextResponse.json(
          { error: 'You cannot delete your own account' },
          { status: 400 }
        );
      }
      const target = await getUserById(body.userId as string);
      if (!target) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      const deleteAuthzError = targetMutationError(auth, target);
      if (deleteAuthzError) return deleteAuthzError;
      const deleteLockoutError = await lastAdminLockoutError(auth, target, 'delete');
      if (deleteLockoutError) return deleteLockoutError;
      const { deleteUser } = await import('@/modules/identity/services/user-service');
      await deleteUser(body.userId as string, auth.sub, auth.username);
      return audited(NextResponse.json({ success: true }), 'user.delete');
    }
    // Update existing user
    if (action === 'update' && body.userId) {
      const roleError = assignableRoleError(auth.role, body.role as UserRole | undefined);
      if (roleError) return roleError;
      const existingUser = await getUserById(body.userId as string);
      // Same privileged-target + same-tenant guard as every other mutation:
      // blocks an org_admin from editing a platform/national account or a
      // user in another (or no) organization.
      const updateAuthzError = targetMutationError(auth, existingUser);
      if (updateAuthzError) return updateAuthzError;
      // Demotion is deactivation by another name where the last administrator
      // is concerned: an org whose only org_admin becomes a nurse has nobody
      // who can undo it. Same guard, same reasoning.
      if (existingUser && body.role && body.role !== existingUser.role) {
        const demotionError = await lastAdminLockoutError(auth, existingUser, 'change the role of');
        if (demotionError) return demotionError;
      }
      if (auth.role === 'org_admin') {
        const targetOrgId = (body.orgId as string | undefined) || existingUser?.orgId;
        if (targetOrgId && auth.orgId && targetOrgId !== auth.orgId) {
          return forbidden('Cannot modify users outside your own organization');
        }
        body.orgId = auth.orgId;
        if (body.hospitalId) {
          const { getHospitalById } = await import('@/lib/services/hospital-service');
          const targetHospital = await getHospitalById(body.hospitalId as string, {
            role: auth.role, orgId: auth.orgId,
          });
          if (!targetHospital || (targetHospital.orgId && targetHospital.orgId !== auth.orgId)) {
            return forbidden('Cannot assign user to a facility outside your organization');
          }
        }
      }
      const { updateUser } = await import('@/modules/identity/services/user-service');
      const adminPhoto = normalisePhoto(body.photoUrl);
      if ('error' in adminPhoto) {
        return NextResponse.json({ error: adminPhoto.error }, { status: 400 });
      }
      const effectiveRole = (body.role as UserRole | undefined) ?? existingUser?.role;
      if (!existingUser || !effectiveRole) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      const requestedOrgId = (body.orgId as string | undefined) ?? existingUser.orgId;
      const requestedHospitalId = (body.hospitalId as string | undefined) ?? existingUser.hospitalId;
      let canonicalHospitalName: string | undefined;
      let canonicalOrgId = requestedOrgId;
      if (effectiveRole === 'org_admin' && !requestedOrgId) {
        return NextResponse.json({ error: ORG_REQUIRED_MESSAGE }, { status: 400 });
      }
      if (roleNeedsFacility(effectiveRole)) {
        if (!requestedHospitalId) {
          return NextResponse.json({ error: FACILITY_REQUIRED_MESSAGE }, { status: 400 });
        }
        const { getHospitalById } = await import('@/lib/services/hospital-service');
        const canonicalHospital = await getHospitalById(requestedHospitalId, {
          role: auth.role, orgId: requestedOrgId || auth.orgId,
        });
        if (!canonicalHospital) {
          return facilityNotAssignable(requestedHospitalId, 'not_found');
        }
        if (requestedOrgId && canonicalHospital.orgId && requestedOrgId !== canonicalHospital.orgId) {
          return facilityNotAssignable(requestedHospitalId, 'wrong_organization');
        }
        if (canonicalHospital.isActive === false) return facilityNotAssignable(requestedHospitalId, 'inactive');
        canonicalHospitalName = canonicalHospital.name;
        canonicalOrgId = canonicalHospital.orgId || requestedOrgId;
      }
      if (effectiveRole === 'org_admin' || roleNeedsFacility(effectiveRole)) {
        const organizationError = await validateActiveOrganization(canonicalOrgId);
        if (organizationError) return organizationError;
      }
      const additionalFacilities = roleNeedsFacility(effectiveRole)
        ? await canonicalAdditionalFacilities({
            raw: body.facilityIds ?? existingUser.facilityIds ?? [],
            homeFacilityId: requestedHospitalId,
            orgId: canonicalOrgId,
            actorRole: auth.role,
          })
        : { ids: [] };
      if ('response' in additionalFacilities) return additionalFacilities.response;

      const updated = await updateUser(
        body.userId as string,
        {
          name: body.name as string | undefined,
          phone: body.phone as string | undefined,
          role: body.role as UserRole | undefined,
          hospitalId: roleNeedsFacility(effectiveRole) ? requestedHospitalId : undefined,
          hospitalName: roleNeedsFacility(effectiveRole) ? canonicalHospitalName : undefined,
          facilityIds: additionalFacilities.ids,
          orgId: canonicalOrgId,
          orgName: await resolveOrgName(canonicalOrgId),
          isActive: body.isActive as boolean | undefined,
          photoUrl: adminPhoto.value,
          department: body.department as string | undefined,
          specialty: body.specialty as string | undefined,
        },
        auth.sub,
        auth.username
      );
      const { redactUserForClient } = await import('@/modules/identity/services/user-service');
      return audited(NextResponse.json({ user: redactUserForClient(updated) }), 'user.update');
    }
    // Create new user
    if (!body.username || !body.password || !body.name || !body.role) {
      return NextResponse.json(
        { error: 'username, password, name, and role are required' },
        { status: 400 }
      );
    }
    const createRoleError = assignableRoleError(auth.role, body.role as UserRole);
    if (createRoleError) return createRoleError;
    if (auth.role === 'org_admin') {
      const targetOrgId = body.orgId as string | undefined;
      if (targetOrgId && auth.orgId && targetOrgId !== auth.orgId) {
        return forbidden('Cannot modify users outside your own organization');
      }
      body.orgId = auth.orgId;
      if (body.hospitalId) {
        const { getHospitalById } = await import('@/lib/services/hospital-service');
        // Scoped so the lookup reads the ORG'S database, not only the shared
        // aggregate — after the tenant cutover the aggregate never receives a
        // facility a clinic registers. See serverHospitalDatabases().
        const targetHospital = await getHospitalById(body.hospitalId as string, {
          role: auth.role, orgId: auth.orgId,
        });
        if (!targetHospital || (targetHospital.orgId && targetHospital.orgId !== auth.orgId)) {
          return forbidden('Cannot assign user to a facility outside your organization');
        }
      }
    }
    const targetRole = body.role as UserRole;
    if (targetRole === 'org_admin' && !body.orgId) {
      return NextResponse.json({ error: ORG_REQUIRED_MESSAGE }, { status: 400 });
    }
    if (roleNeedsFacility(targetRole)) {
      if (!body.hospitalId) {
        return NextResponse.json({ error: FACILITY_REQUIRED_MESSAGE }, { status: 400 });
      }
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      const canonicalHospital = await getHospitalById(body.hospitalId as string, {
        role: auth.role, orgId: (body.orgId as string | undefined) || auth.orgId,
      });
      if (!canonicalHospital) {
        return facilityNotAssignable(body.hospitalId as string, 'not_found');
      }
      if (body.orgId && canonicalHospital.orgId && body.orgId !== canonicalHospital.orgId) {
        return facilityNotAssignable(body.hospitalId as string, 'wrong_organization');
      }
      if (canonicalHospital.isActive === false) return facilityNotAssignable(body.hospitalId as string, 'inactive');
      // Never trust client-supplied names or a contradictory tenant. Login
      // scope comes from these fields, so persist the canonical relationship.
      body.hospitalName = canonicalHospital.name;
      body.orgId = canonicalHospital.orgId || body.orgId;
    } else {
      body.hospitalId = undefined;
      body.hospitalName = undefined;
    }
    if (targetRole === 'org_admin' || roleNeedsFacility(targetRole)) {
      const organizationError = await validateActiveOrganization(body.orgId as string | undefined);
      if (organizationError) return organizationError;
      const seatError = await validateSeatAvailable(body.orgId as string | undefined);
      if (seatError) return seatError;
    }
    const additionalFacilities = roleNeedsFacility(targetRole)
      ? await canonicalAdditionalFacilities({
          raw: body.facilityIds,
          homeFacilityId: body.hospitalId as string | undefined,
          orgId: body.orgId as string | undefined,
          actorRole: auth.role,
        })
      : { ids: [] };
    if ('response' in additionalFacilities) return additionalFacilities.response;
    const newPhoto = normalisePhoto(body.photoUrl);
    if ('error' in newPhoto) {
      return NextResponse.json({ error: newPhoto.error }, { status: 400 });
    }
    const { createUser } = await import('@/modules/identity/services/user-service');
    const user = await createUser(
      {
        username: body.username as string,
        password: body.password as string,
        name: body.name as string,
        role: body.role as UserRole,
        hospitalId: body.hospitalId as string | undefined,
        hospitalName: body.hospitalName as string | undefined,
        facilityIds: additionalFacilities.ids,
        orgId: body.orgId as string | undefined,
        orgName: await resolveOrgName(body.orgId as string | undefined),
        photoUrl: newPhoto.value ?? undefined,
        department: body.department as string | undefined,
        specialty: body.specialty as string | undefined,
        phone: body.phone as string | undefined,
        email: body.email as string | undefined,
      },
      auth.sub,
      auth.username
    );

    // Invite the new user to set their own password.
    //
    // Deliberately NOT emailing the temporary password: a plaintext credential
    // lands in a mailbox that is often shared at a facility and survives in
    // sent-mail and backups. The link is single-use and expires, so nothing
    // reusable sits in an inbox. See lib/user-invite.ts.
    //
    // Entirely best-effort. The account exists either way, and the response
    // reports what happened so the administrator knows whether to hand the
    // temporary password over another way instead of assuming mail arrived.
    // See lib/services/invite-delivery.ts.
    // this step entirely — see lib/services/invite-delivery.ts.
    const { deliverAccountInvite } = await import('@/modules/identity/services/invite-delivery');
    const invitation = await deliverAccountInvite(user);

    const { redactUserForClient } = await import('@/modules/identity/services/user-service');
    return audited(
      NextResponse.json({ user: redactUserForClient(user), invitation }, { status: 201 }),
      'user.create',
    );
  } catch (err) {
    // The user-service throws plain `Error` for validation problems
    // ("Invalid role", "Clinical users must be assigned to a hospital",
    // "Username already exists", "Invalid username"). Translate those into
    // 400/409 instead of 500 so callers can correct their input.
    // A rejected password is the caller's to fix, and it is recognised by TYPE
    // rather than by matching its wording — which used to make the copy part
    // of the control flow, so rewording an error turned a 400 into a 500.
    if (err instanceof PasswordPolicyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof Error) {
      const msg = err.message;
      if (/already exists/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 409 });
      }
      if (
        /must be assigned to a hospital/i.test(msg) ||
        /must be assigned to an organization/i.test(msg) ||
        /^Invalid role/i.test(msg) ||
        /^Invalid username/i.test(msg) ||
        /^Password/i.test(msg)
      ) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }
    logApiError('[API /users POST]', err);
    return serverError();
  }
}
export const POST = withAuditLog(postHandler, { action: 'user.create' });
