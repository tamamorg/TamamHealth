/**
 * API: /api/users
 * GET  — List all users (supports filtering by role, hospitalId, etc.)
 * POST — Create user, update user, reset password, or deactivate user
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthPayload, unauthorized, forbidden, hasRole, serverError, logApiError,
  type AuthPayload,
} from '@/lib/api-auth';
import { withAuditLog } from '@/lib/audit/with-audit';
import type { UserRole } from '@/lib/db-types';
import { STAFF_DIRECTORY_READ_ROLES } from '@/lib/staff-directory-access';
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
const WRITE_ROLES: UserRole[] = [
  'super_admin', 'org_admin',
];
// Platform-wide / national (cross-tenant) roles. A user holding one of these
// bypasses org scoping in filterByScope, so only a platform operator
// (super_admin) may grant them. Without this guard a tenant's org_admin could
// create — or promote themselves into — a super_admin/government account and
// read every other organization's PHI (privilege-escalation → tenant breakout).
const PRIVILEGED_ASSIGNABLE_ROLES: UserRole[] = ['super_admin', 'government', 'county_health_director'];

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

async function validateActiveOrganization(orgId: string | undefined): Promise<NextResponse | null> {
  if (!orgId) {
    return NextResponse.json({ error: 'Organization assignment is required' }, { status: 400 });
  }
  const { getOrganizationById } = await import('@/lib/services/organization-service');
  const organization = await getOrganizationById(orgId);
  if (!organization || organization.isActive === false) {
    return NextResponse.json({ error: 'Assigned organization was not found or is inactive' }, { status: 400 });
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
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();
    if (!hasRole(auth, READ_ROLES)) return forbidden();
    const { getAllUsers } = await import('@/lib/services/user-service');
    const { redactUserForClient } = await import('@/lib/services/user-service');
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
    const { getUserById } = await import('@/lib/services/user-service');

    // Self-service lane: any authenticated user may update their OWN benign
    // profile fields (name, phone) — nothing role- or tenancy-bearing. All
    // other mutations require an admin role below. Password changes go through
    // /api/auth/change-password (which verifies the current password), never here.
    if (action === 'update' && body.userId === auth.sub && !hasRole(auth, WRITE_ROLES)) {
      const { updateUser } = await import('@/lib/services/user-service');
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
      const { redactUserForClient } = await import('@/lib/services/user-service');
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
      const { resetPassword } = await import('@/lib/services/user-service');
      await resetPassword(
        body.userId as string,
        body.newPassword as string,
        auth.sub,
        auth.username
      );
      return NextResponse.json({ success: true });
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
        const { reactivateUser } = await import('@/lib/services/user-service');
        await reactivateUser(body.userId as string, auth.sub, auth.username);
      } else {
        const { deactivateUser } = await import('@/lib/services/user-service');
        await deactivateUser(body.userId as string, auth.sub, auth.username);
      }
      return NextResponse.json({ success: true });
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
      const { deleteUser } = await import('@/lib/services/user-service');
      await deleteUser(body.userId as string, auth.sub, auth.username);
      return NextResponse.json({ success: true });
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
      if (auth.role === 'org_admin') {
        const targetOrgId = (body.orgId as string | undefined) || existingUser?.orgId;
        if (targetOrgId && auth.orgId && targetOrgId !== auth.orgId) {
          return forbidden('Cannot modify users outside your own organization');
        }
        body.orgId = auth.orgId;
        if (body.hospitalId) {
          const { getHospitalById } = await import('@/lib/services/hospital-service');
          const targetHospital = await getHospitalById(body.hospitalId as string);
          if (!targetHospital || (targetHospital.orgId && targetHospital.orgId !== auth.orgId)) {
            return forbidden('Cannot assign user to a facility outside your organization');
          }
        }
      }
      const { updateUser } = await import('@/lib/services/user-service');
      const adminPhoto = normalisePhoto(body.photoUrl);
      if ('error' in adminPhoto) {
        return NextResponse.json({ error: adminPhoto.error }, { status: 400 });
      }
      const effectiveRole = (body.role as UserRole | undefined) ?? existingUser?.role;
      if (!existingUser || !effectiveRole) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      const rolesWithoutHospital: UserRole[] = ['super_admin', 'org_admin', 'government', 'county_health_director'];
      const requestedOrgId = (body.orgId as string | undefined) ?? existingUser.orgId;
      const requestedHospitalId = (body.hospitalId as string | undefined) ?? existingUser.hospitalId;
      let canonicalHospitalName: string | undefined;
      let canonicalOrgId = requestedOrgId;
      if (effectiveRole === 'org_admin' && !requestedOrgId) {
        return NextResponse.json(
          { error: 'Organization administrators must be assigned to an organization' },
          { status: 400 },
        );
      }
      if (!rolesWithoutHospital.includes(effectiveRole)) {
        if (!requestedHospitalId) {
          return NextResponse.json({ error: 'Clinical users must be assigned to a hospital' }, { status: 400 });
        }
        const { getHospitalById } = await import('@/lib/services/hospital-service');
        const canonicalHospital = await getHospitalById(requestedHospitalId);
        if (!canonicalHospital) {
          return NextResponse.json({ error: 'Assigned hospital was not found' }, { status: 400 });
        }
        if (requestedOrgId && canonicalHospital.orgId && requestedOrgId !== canonicalHospital.orgId) {
          return NextResponse.json(
            { error: 'Assigned hospital does not belong to the selected organization' },
            { status: 400 },
          );
        }
        canonicalHospitalName = canonicalHospital.name;
        canonicalOrgId = canonicalHospital.orgId || requestedOrgId;
      }
      if (effectiveRole === 'org_admin' || !rolesWithoutHospital.includes(effectiveRole)) {
        const organizationError = await validateActiveOrganization(canonicalOrgId);
        if (organizationError) return organizationError;
      }

      const updated = await updateUser(
        body.userId as string,
        {
          name: body.name as string | undefined,
          phone: body.phone as string | undefined,
          role: body.role as UserRole | undefined,
          hospitalId: rolesWithoutHospital.includes(effectiveRole) ? undefined : requestedHospitalId,
          hospitalName: rolesWithoutHospital.includes(effectiveRole) ? undefined : canonicalHospitalName,
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
      const { redactUserForClient } = await import('@/lib/services/user-service');
      return NextResponse.json({ user: redactUserForClient(updated) });
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
        const targetHospital = await getHospitalById(body.hospitalId as string);
        if (!targetHospital || (targetHospital.orgId && targetHospital.orgId !== auth.orgId)) {
          return forbidden('Cannot assign user to a facility outside your organization');
        }
      }
    }
    const targetRole = body.role as UserRole;
    const rolesWithoutHospital: UserRole[] = ['super_admin', 'org_admin', 'government', 'county_health_director'];
    if (targetRole === 'org_admin' && !body.orgId) {
      return NextResponse.json(
        { error: 'Organization administrators must be assigned to an organization' },
        { status: 400 },
      );
    }
    if (!rolesWithoutHospital.includes(targetRole)) {
      if (!body.hospitalId) {
        return NextResponse.json({ error: 'Clinical users must be assigned to a hospital' }, { status: 400 });
      }
      const { getHospitalById } = await import('@/lib/services/hospital-service');
      const canonicalHospital = await getHospitalById(body.hospitalId as string);
      if (!canonicalHospital) {
        return NextResponse.json({ error: 'Assigned hospital was not found' }, { status: 400 });
      }
      if (body.orgId && canonicalHospital.orgId && body.orgId !== canonicalHospital.orgId) {
        return NextResponse.json(
          { error: 'Assigned hospital does not belong to the selected organization' },
          { status: 400 },
        );
      }
      // Never trust client-supplied names or a contradictory tenant. Login
      // scope comes from these fields, so persist the canonical relationship.
      body.hospitalName = canonicalHospital.name;
      body.orgId = canonicalHospital.orgId || body.orgId;
    } else {
      body.hospitalId = undefined;
      body.hospitalName = undefined;
    }
    if (targetRole === 'org_admin' || !rolesWithoutHospital.includes(targetRole)) {
      const organizationError = await validateActiveOrganization(body.orgId as string | undefined);
      if (organizationError) return organizationError;
    }
    const newPhoto = normalisePhoto(body.photoUrl);
    if ('error' in newPhoto) {
      return NextResponse.json({ error: newPhoto.error }, { status: 400 });
    }
    const { createUser } = await import('@/lib/services/user-service');
    const user = await createUser(
      {
        username: body.username as string,
        password: body.password as string,
        name: body.name as string,
        role: body.role as UserRole,
        hospitalId: body.hospitalId as string | undefined,
        hospitalName: body.hospitalName as string | undefined,
        orgId: body.orgId as string | undefined,
        orgName: await resolveOrgName(body.orgId as string | undefined),
        photoUrl: newPhoto.value ?? undefined,
        department: body.department as string | undefined,
        specialty: body.specialty as string | undefined,
        phone: body.phone as string | undefined,
      },
      auth.sub,
      auth.username
    );
    const { redactUserForClient } = await import('@/lib/services/user-service');
    return NextResponse.json({ user: redactUserForClient(user) }, { status: 201 });
  } catch (err) {
    // The user-service throws plain `Error` for validation problems
    // ("Invalid role", "Clinical users must be assigned to a hospital",
    // "Username already exists", "Invalid username"). Translate those into
    // 400/409 instead of 500 so callers can correct their input.
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
