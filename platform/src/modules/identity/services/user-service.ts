import { usersDB } from '@/lib/db';
import type { UserDoc, UserRole } from '@/lib/db-types';
import type { InvitationOutcome } from '@/modules/identity/provisioning/user-invite';
import type { DataScope } from '@/lib/services/data-scope';
import { filterByScope } from '@/lib/services/data-scope';
import { findByType } from '@/lib/services/db-query';
import { ROLE_LABEL } from '@/lib/role-display';
import {
  roleNeedsFacility, ORG_REQUIRED_MESSAGE, FACILITY_REQUIRED_MESSAGE,
} from '@/modules/identity/policy/user-scope-rules';
import { assertPasswordForDeployment, screenPasswordForDeployment } from '@/modules/identity/policy/password-policy-server';

// Single source of truth: every role defined in ROLE_LABEL (a
// Record<UserRole, …>) is a valid role. Deriving the list here means new roles
// can never go stale/missing in user validation again.
const VALID_ROLES = Object.keys(ROLE_LABEL) as UserRole[];

// The password rules live in `lib/password-policy.ts` and the deployment's
// enforced minimum in `password-policy-server.ts`. This file used to carry its
// own literal `8`, as did four other places, while /admin/security displayed a
// configured minimum of 12 that nothing read.

// ─── Central provisioning ───────────────────────────────────────────────────
// User accounts are AUTH data: they must live in the central users database or
// the new user can never log in anywhere but the creating device. The users DB
// deliberately syncs PULL-ONLY to browsers (a device must not be able to push
// itself a super_admin), so browser-side mutations cannot go through the local
// PouchDB — they must go through POST /api/users, which authenticates the
// actor, enforces role/tenant rules, and writes to CouchDB directly. The
// server (including /api/users itself) keeps using the direct DB path below.
//
// Reads stay local-first on purpose: the pull replica is the offline staff
// directory, and the live `.changes()` subscription in useUsers refreshes
// lists as soon as an API-side write replicates back down.
//
// JEST_WORKER_ID guard: tests run under jsdom (window exists) but exercise the
// DB path against mocked databases.
const isBrowserRuntime = () => typeof window !== 'undefined' && !process.env.JEST_WORKER_ID;

/** A user document with every credential verifier removed. */
export type ClientSafeUser = Omit<UserDoc, 'passwordHash' | 'pinHash'>;

/**
 * Credential material left on user documents by the retired second factor.
 *
 * The fields are gone from `UserDoc`, so nothing writes them and no
 * destructure can name them — but a document written while the feature existed
 * still CARRIES them, and a shape the type no longer describes is exactly the
 * kind that stops being redacted without anyone noticing. `totpSecret` is a
 * standing credential: anyone holding it can generate that account's codes
 * forever. Stripped by name until `npm run db:strip-totp` has cleared them from
 * storage, and harmless to keep after that.
 */
const RETIRED_MFA_FIELDS = [
  'totpSecret', 'totpRecoveryCodeHashes', 'totpLastUsedStep', 'totpEnabledAt',
] as const;

/** Strip credential verifiers before a user document crosses an API boundary. */
export function redactUserForClient(user: UserDoc): ClientSafeUser {
  const {
    passwordHash: _passwordHash, pinHash: _pinHash,
    // An outstanding invitation hash is a credential: anyone holding it can
    // set this account's password. It must never reach a browser, even one
    // that is already an administrator's.
    inviteTokenHash: _inviteTokenHash,
    ...safe
  } = user;
  const legacy = safe as Record<string, unknown>;
  for (const field of RETIRED_MFA_FIELDS) delete legacy[field];
  return safe;
}

/** POST an action to /api/users and translate failures into readable errors. */
async function postUsersApi(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { apiFetch } = await import('@/lib/api-fetch');
  let res: Response;
  try {
    res = await apiFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network failure. Do NOT fall back to a local write — a locally-created
    // account looks successful but can never authenticate on the server or
    // any other device, which is worse than an honest error.
    throw new Error('User accounts are managed centrally and require a connection. Check your internet and try again.');
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) || `User request failed (${res.status})`);
  }
  return body;
}

export async function getAllUsers(scope?: DataScope): Promise<UserDoc[]> {
  if (isBrowserRuntime()) {
    const { apiFetch } = await import('@/lib/api-fetch');
    const response = await apiFetch('/api/users');
    const body = await response.json().catch(() => ({})) as { users?: UserDoc[]; error?: string };
    if (!response.ok) throw new Error(body.error || `Failed to load staff directory (${response.status})`);
    // The API has already applied the authenticated actor's data scope. A
    // second client-side scope pass is harmless and keeps existing callers'
    // expectations intact without trusting the browser as the boundary.
    const users = body.users ?? [];
    return scope ? filterByScope(users, scope) : users;
  }
  const db = usersDB();
  const all = await findByType<UserDoc>(db, 'user');
  /* istanbul ignore next -- scope filter: tested with and without */
  return scope ? filterByScope(all, scope) : all;
}

export async function getUserById(id: string): Promise<UserDoc | null> {
  if (isBrowserRuntime()) {
    const users = await getAllUsers();
    return users.find(user => user._id === id) ?? null;
  }
  try {
    const db = usersDB();
    return await db.get(id) as UserDoc;
  } catch {
    return null;
  }
}

interface CreateUserData {
  username: string;
  password: string;
  name: string;
  role: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  /** Additional facilities beyond the user's home facility. */
  facilityIds?: string[];
  orgId?: string;
  /**
   * Organization display name. Stamped by POST /api/users from the
   * organization record, never taken from the browser — see `UserDoc.orgName`.
   */
  orgName?: string;
  /** Downscaled data URL from `PhotoCaptureModal`. Optional at every step. */
  photoUrl?: string;
  department?: string;
  specialty?: string;
  phone?: string;
  email?: string;
}

/**
 * The single browser→server provisioning call. Both `createUser` and
 * `createUserWithInvitation` go through it so a field added here reaches the
 * API from every entry point — `email` was previously collected by the form
 * and dropped on this boundary.
 */
async function provisionViaApi(data: CreateUserData): Promise<Record<string, unknown>> {
  return postUsersApi({
    username: data.username,
    password: data.password,
    name: data.name,
    role: data.role,
    hospitalId: data.hospitalId,
    hospitalName: data.hospitalName,
    facilityIds: data.facilityIds,
    orgId: data.orgId,
    photoUrl: data.photoUrl,
    department: data.department,
    specialty: data.specialty,
    phone: data.phone,
    email: data.email,
  });
}

/**
 * Create a user AND report whether the invitation email actually went out.
 *
 * Browser-only, and separate from `createUser` because that function's return
 * type is relied on by six call sites. An administrator needs the real answer:
 * told an email was sent when it was not, they will not hand over the
 * temporary password, and the account is stranded.
 */
export async function createUserWithInvitation(
  data: CreateUserData,
): Promise<{ user: UserDoc; invitation: InvitationOutcome }> {
  const body = await provisionViaApi(data);
  return {
    user: body.user as UserDoc,
    invitation: (body.invitation as InvitationOutcome) ?? { sent: false, reason: 'send_failed' },
  };
}

export async function createUser(
  data: CreateUserData,
  actorId?: string,
  actorUsername?: string
): Promise<UserDoc> {
  // Browser: provision through the central API (see note at top of file).
  // The server route authenticates the actor and re-runs this function on the
  // Node side, where the direct DB path below writes to CouchDB.
  if (isBrowserRuntime()) {
    const body = await provisionViaApi(data);
    return body.user as UserDoc;
  }

  const db = usersDB();

  // Validate
  if (!data.username || !data.password || !data.name || !data.role) {
    throw new Error('Missing required fields: username, password, name, role');
  }

  const username = data.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  /* istanbul ignore next -- defensive: username is always validated before reaching here */
  if (!username) throw new Error('Invalid username');

  // Screened AFTER the username is normalised, because one of the rules is
  // "not built out of the account's own identifiers" and it needs the value
  // that will actually be stored. Raises PasswordPolicyError, which the API
  // route turns into a 400.
  await assertPasswordForDeployment(data.password, [username, data.name, data.email ?? '']);

  if (!VALID_ROLES.includes(data.role)) {
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  // Same rules the API route enforces — `lib/user-scope-rules.ts` states them
  // once so the direct (node-side) path and the HTTP path cannot drift.
  if (data.role === 'org_admin' && !data.orgId) {
    throw new Error(ORG_REQUIRED_MESSAGE);
  }
  if (roleNeedsFacility(data.role) && (!data.hospitalId || !data.hospitalName)) {
    throw new Error(FACILITY_REQUIRED_MESSAGE);
  }

  // Check uniqueness
  try {
    await db.get(`user-${username}`);
    throw new Error(`Username "${username}" already exists`);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status !== 404) {
      /* istanbul ignore next -- re-throw: error is always the 'already exists' one */
      if (e.message?.includes('already exists')) throw err;
      throw err;
    }
  }

  const now = new Date().toISOString();
  const { hashPassword } = await import('@/modules/identity/core/auth');
  const passwordHash = await hashPassword(data.password);

  const needsHospital = !(['super_admin', 'org_admin', 'government', 'county_health_director'] as UserRole[]).includes(data.role);
  const doc: UserDoc = {
    _id: `user-${username}`,
    type: 'user',
    username,
    email: data.email?.trim().toLowerCase(),
    passwordHash,
    name: data.name,
    role: data.role,
    hospitalId: needsHospital ? data.hospitalId : undefined,
    hospitalName: needsHospital ? data.hospitalName : undefined,
    facilityIds: needsHospital
      ? [...new Set(data.facilityIds ?? [])].filter(id => id && id !== data.hospitalId)
      : [],
    orgId: data.orgId,
    orgName: data.orgName,
    photoUrl: data.photoUrl,
    department: data.department,
    specialty: data.specialty,
    phone: data.phone,
    isActive: true,
    // The admin-set password is temporary — force a change at first login so
    // it never becomes the user's permanent credential.
    mustChangePassword: true,
    passwordUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  };

  const resp = await db.put(doc);
  doc._rev = resp.rev;
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('user_created', actorId, actorUsername, `Created user "${username}" with role ${data.role}`, true);
  return doc;
}

interface UpdateUserData {
  name?: string;
  phone?: string;
  role?: UserRole;
  hospitalId?: string;
  hospitalName?: string;
  /** Additional facilities beyond the user's home facility. */
  facilityIds?: string[];
  isActive?: boolean;
  /** Data URL, or null to clear the photo back to initials. */
  photoUrl?: string | null;
  department?: string;
  specialty?: string;
  orgId?: string;
  /** See `CreateUserData.orgName` — server-stamped, never client-supplied. */
  orgName?: string;
}

export async function updateUser(
  id: string,
  data: UpdateUserData,
  actorId?: string,
  actorUsername?: string
): Promise<UserDoc> {
  if (isBrowserRuntime()) {
    const body = await postUsersApi({ action: 'update', userId: id, ...data });
    return body.user as UserDoc;
  }

  const db = usersDB();
  const existing = await db.get(id) as UserDoc;

  if (data.role && !VALID_ROLES.includes(data.role)) {
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  // API callers intentionally omit fields on partial edits. Spreading those
  // `undefined` values over the stored document erased role/name/scope data
  // when an administrator changed just one field (for example orgId).
  const definedChanges = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as UpdateUserData;
  const updated: UserDoc = {
    ...existing,
    ...definedChanges,
    // `null` is the caller asking to clear the photo. Spread as-is it would
    // persist a null the readers all have to special-case, so it becomes an
    // absent field — the same shape as an account that never had one.
    photoUrl: data.photoUrl === null ? undefined : (data.photoUrl ?? existing.photoUrl),
    _id: existing._id,
    _rev: existing._rev,
    updatedAt: new Date().toISOString(),
  };

  if (updated.role === 'org_admin' && !updated.orgId) {
    throw new Error('Organization administrators must be assigned to an organization');
  }

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('user_updated', actorId, actorUsername, `Updated user "${existing.username}"`, true);
  return updated;
}

/**
 * Mint (or replace) an account invitation and return the raw token ONCE.
 *
 * Server-only: the token is generated here, hashed onto the document, and
 * handed back to the caller to put in an email. Re-issuing overwrites any
 * outstanding invitation, so a re-sent invite silently invalidates the first —
 * which is what an administrator means by "send it again".
 */
export async function issueUserInvite(id: string): Promise<{ token: string; expiresAt: string } | null> {
  if (isBrowserRuntime()) {
    throw new Error('issueUserInvite is server-only');
  }
  const db = usersDB();
  let existing: UserDoc;
  try {
    existing = await db.get(id) as UserDoc;
  } catch {
    return null;
  }
  const { issueInvite } = await import('@/modules/identity/provisioning/user-invite');
  const invite = issueInvite();
  const updated: UserDoc = {
    ...existing,
    inviteTokenHash: invite.tokenHash,
    inviteExpiresAt: invite.expiresAt,
    updatedAt: new Date().toISOString(),
  };
  await db.put(updated);
  return { token: invite.token, expiresAt: invite.expiresAt };
}

/**
 * Redeem an invitation: set the password the user chose and burn the token.
 *
 * Returns a discriminated result rather than throwing, because this runs on an
 * UNAUTHENTICATED endpoint and every failure must look identical from outside.
 * The caller maps them all to one generic message — the distinction exists for
 * the audit log, not for the response body.
 *
 * Clears `mustChangePassword` as well: the whole point of choosing your own
 * password is that you are not then asked to change it again at first login.
 */
export type InviteRedemption =
  | { ok: true; user: UserDoc }
  | { ok: false; reason: 'not_found' | 'expired' }
  // A password complaint carries its message: the person is choosing a
  // password and has to be told what is wrong with it. This leaks nothing
  // about the token, which is checked afterwards.
  | { ok: false; reason: 'weak_password'; message: string };

export async function redeemUserInvite(token: string, newPassword: string): Promise<InviteRedemption> {
  if (isBrowserRuntime()) {
    throw new Error('redeemUserInvite is server-only');
  }
  if (!token) {
    return { ok: false, reason: 'not_found' };
  }
  const weak = await screenPasswordForDeployment(newPassword);
  if (weak) return { ok: false, reason: 'weak_password', message: weak };

  const { hashInviteToken, inviteHashMatches, isInviteExpired } = await import('@/modules/identity/provisioning/user-invite');
  const candidateHash = hashInviteToken(token);

  // Scanned rather than queried by index: `inviteTokenHash` is sparse (only
  // accounts with an outstanding invite carry one) and the staff roster is
  // small. A secondary index on a credential is also one more place it exists.
  const all = await findByType<UserDoc>(usersDB(), 'user');
  const match = all.find(u => u.inviteTokenHash && inviteHashMatches(u.inviteTokenHash, candidateHash));
  if (!match) return { ok: false, reason: 'not_found' };
  if (isInviteExpired(match.inviteExpiresAt)) return { ok: false, reason: 'expired' };
  // A disabled account must not be reachable through an old invitation.
  if (match.isActive === false) return { ok: false, reason: 'not_found' };

  // Re-screen now that the account is known: the "not built from your own
  // name" rule cannot run on the first pass, because at that point the token
  // has not yet told us whose account this is.
  const identityWeak = await screenPasswordForDeployment(
    newPassword, [match.username, match.name, match.email ?? ''],
  );
  if (identityWeak) return { ok: false, reason: 'weak_password', message: identityWeak };

  const { hashPassword } = await import('@/modules/identity/core/auth');
  const now = new Date().toISOString();
  const updated: UserDoc = {
    ...match,
    passwordHash: await hashPassword(newPassword),
    passwordUpdatedAt: now,
    mustChangePassword: false,
    inviteTokenHash: undefined,
    inviteExpiresAt: undefined,
    updatedAt: now,
  };
  const resp = await usersDB().put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('user_invite_redeemed', match._id, match.username,
    `${match.username} set their password from an invitation`, true);
  return { ok: true, user: updated };
}

export async function resetPassword(
  id: string,
  newPassword: string,
  actorId?: string,
  actorUsername?: string
): Promise<void> {
  if (isBrowserRuntime()) {
    await postUsersApi({ action: 'reset_password', userId: id, newPassword });
    return;
  }

  const db = usersDB();
  const existing = await db.get(id) as UserDoc;

  // An administrator choosing a temporary password is still choosing a
  // password, and "Temp1234" typed by a hurried admin is the credential the
  // account actually holds until the user changes it.
  await assertPasswordForDeployment(newPassword, [existing.username, existing.name, existing.email ?? '']);

  const { hashPassword } = await import('@/modules/identity/core/auth');
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();
  const updated: UserDoc = {
    ...existing,
    passwordHash,
    // An admin reset is a temporary credential — force the user to choose
    // their own password the next time they sign in. Bumping
    // passwordUpdatedAt also fails the `pwdAt` epoch check on every session
    // the user (or whoever held their credentials) still has open.
    mustChangePassword: true,
    passwordUpdatedAt: now,
    updatedAt: now,
  };

  const resp2 = await db.put(updated);
  updated._rev = resp2.rev;
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('password_reset', actorId, actorUsername, `Reset password for user "${existing.username}"`, true);
}

/**
 * Self-service password change. Verifies the user's current password, sets the
 * new one, and clears the forced-change flag. Used by POST /api/auth/change-password
 * (both for the first-login forced change and ordinary "change my password").
 */
export async function changeOwnPassword(
  id: string,
  currentPassword: string,
  newPassword: string,
): Promise<UserDoc> {
  const db = usersDB();
  const existing = await db.get(id) as UserDoc;

  const { verifyPassword, hashPassword } = await import('@/modules/identity/core/auth');
  const ok = await verifyPassword(currentPassword, existing.passwordHash);
  if (!ok) throw new Error('Current password is incorrect');

  // Screened here rather than only in the route, so the rule holds for every
  // caller of this function rather than for one HTTP path.
  await assertPasswordForDeployment(newPassword, [existing.username, existing.name, existing.email ?? '']);

  const now = new Date().toISOString();
  const updated: UserDoc = {
    ...existing,
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    passwordUpdatedAt: now,
    updatedAt: now,
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('password_changed', existing._id, existing.username, `User "${existing.username}" changed their own password`, true);
  // The caller re-issues the session JWT; the fresh passwordUpdatedAt becomes
  // its `pwdAt` claim so this session survives while every other one dies.
  return updated;
}

export async function deactivateUser(
  id: string,
  actorId?: string,
  actorUsername?: string
): Promise<void> {
  if (isBrowserRuntime()) {
    await postUsersApi({ action: 'deactivate', userId: id });
    return;
  }

  const db = usersDB();
  const existing = await db.get(id) as UserDoc;

  const now = new Date().toISOString();
  const updated: UserDoc = {
    ...existing,
    isActive: false,
    // `isActive: false` alone says an account is closed but not when, or by
    // whom — the two things an offboarding review asks first.
    deactivatedAt: now,
    deactivatedBy: actorUsername ?? actorId,
    updatedAt: now,
  };

  const resp3 = await db.put(updated);
  updated._rev = resp3.rev;
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('user_deactivated', actorId, actorUsername, `Deactivated user "${existing.username}"`, true);
}

/**
 * Restore a previously deactivated account so the user can sign in again.
 * The inverse of deactivateUser. Tenant/role guards live in POST /api/users
 * (action: 'reactivate'), same as deactivate.
 */
export async function reactivateUser(
  id: string,
  actorId?: string,
  actorUsername?: string
): Promise<void> {
  if (isBrowserRuntime()) {
    await postUsersApi({ action: 'reactivate', userId: id });
    return;
  }

  const db = usersDB();
  const existing = await db.get(id) as UserDoc;

  const updated: UserDoc = {
    ...existing,
    isActive: true,
    // Clear the closure stamp, so a reactivated account does not read as
    // deactivated-and-somehow-working in the roster or an access review.
    deactivatedAt: undefined,
    deactivatedBy: undefined,
    updatedAt: new Date().toISOString(),
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('user_reactivated', actorId, actorUsername, `Reactivated user "${existing.username}"`, true);
}

/**
 * Permanently remove a user account. Prefer deactivateUser for routine
 * offboarding — deletion is for accounts created in error. Tenant/role guards
 * live in POST /api/users (action: 'delete').
 */
export async function deleteUser(
  id: string,
  actorId?: string,
  actorUsername?: string
): Promise<void> {
  if (isBrowserRuntime()) {
    await postUsersApi({ action: 'delete', userId: id });
    return;
  }

  const db = usersDB();
  const existing = await db.get(id) as UserDoc;
  await db.remove(existing._id, existing._rev!);
  const { logAudit } = await import('@/lib/services/audit-service');
  await logAudit('user_deleted', actorId, actorUsername, `Deleted user "${existing.username}"`, true);
}

/**
 * Stamp a successful sign-in.
 *
 * Called from the login route AFTER authentication succeeds, and only then —
 * a failed attempt must never move this, or the field becomes "last time
 * somebody guessed at this account" and every review built on it is wrong.
 *
 * Best-effort by design: it returns rather than throws on any failure. A
 * clinician must not be refused entry to a ward because a bookkeeping write
 * lost a revision race, and this value is a management signal, not a control.
 */
export async function recordSuccessfulLogin(id: string, at: string = new Date().toISOString()): Promise<void> {
  if (isBrowserRuntime()) return;
  try {
    const db = usersDB();
    const existing = await db.get(id) as UserDoc;
    // Skip a write when the stamp is already within the same minute. Sign-in
    // is one of the few operations that hits every device every morning, and
    // a document revision per page-load would bloat the replication log that
    // every browser then pulls.
    if (existing.lastLoginAt && at.slice(0, 16) === existing.lastLoginAt.slice(0, 16)) return;
    await db.put({ ...existing, lastLoginAt: at });
  } catch {
    /* never block a sign-in over a bookkeeping write */
  }
}

/**
 * How many ACTIVE administrators an organization would still have if
 * `excludingUserId` were removed, deactivated or demoted.
 *
 * The last-admin guard. Nothing checked this before, so an org_admin could
 * deactivate the only other one — or themselves, since only `delete` blocked
 * self-targeting — and the tenant was locked out of its own user management
 * until a platform operator could be reached. In a deployment where the
 * platform operator may be in another country and the clinic may be offline
 * for a day, that is not a small inconvenience.
 */
export async function countRemainingOrgAdmins(orgId: string, excludingUserId: string): Promise<number> {
  const users = await getAllUsers();
  return users.filter(u =>
    u.orgId === orgId
    && u.role === 'org_admin'
    && u.isActive !== false
    && u._id !== excludingUserId).length;
}

// An access review does not need a service function of its own. "Which
// accounts need somebody to do something?" is answered once, by
// `describeAccountState` in `lib/account-state.ts`, and both rosters apply it
// to the list they already hold — a second implementation here would be a
// second definition of "dormant" waiting to disagree with the rows.

/**
 * Deactivate an account AND report what it still had open.
 *
 * Separate from `deactivateUser` because that function's `Promise<void>` is
 * relied on by several call sites, and because the answer only exists on the
 * API path — the server is where the appointments and encounters live.
 *
 * The handover summary is advisory and arrives AFTER the account is closed.
 * Access has to be revocable the moment someone leaves, whatever is still
 * assigned to them; the point is that the administrator finds out rather than
 * the patient who turns up for an appointment with a doctor who has gone.
 */
export async function deactivateUserReportingOpenWork(
  id: string,
): Promise<{ openWork?: import('@/modules/identity/services/offboarding-service').OpenWorkSummary }> {
  if (isBrowserRuntime()) {
    const body = await postUsersApi({ action: 'deactivate', userId: id });
    return { openWork: body.openWork as import('@/modules/identity/services/offboarding-service').OpenWorkSummary | undefined };
  }
  await deactivateUser(id);
  const { summarizeOpenWork } = await import('@/modules/identity/services/offboarding-service');
  return { openWork: await summarizeOpenWork(id) };
}

/**
 * Re-send the set-your-password invitation, invalidating any outstanding one.
 *
 * Browser-only in practice: the server-side equivalent is
 * `invite-delivery.deliverAccountInvite`, which this ends up calling through
 * `POST /api/users`.
 */
export async function resendUserInvite(id: string): Promise<InvitationOutcome> {
  const body = await postUsersApi({ action: 'resend_invite', userId: id });
  return (body.invitation as InvitationOutcome) ?? { sent: false, reason: 'send_failed' };
}
