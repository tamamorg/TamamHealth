import { usersDB } from '../db';
import type { UserDoc, UserRole } from '../db-types';
import type { DataScope } from './data-scope';
import { filterByScope } from './data-scope';
import { findByType } from './db-query';
import { ROLE_LABEL } from '../role-display';

// Single source of truth: every role defined in ROLE_LABEL (a
// Record<UserRole, …>) is a valid role. Deriving the list here means new roles
// can never go stale/missing in user validation again.
const VALID_ROLES = Object.keys(ROLE_LABEL) as UserRole[];

// Matches the /api/auth/change-password minimum — the "Password …" error
// prefix is what POST /api/users translates into a 400 for the client.
const MIN_PASSWORD_LENGTH = 8;

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

export type ClientSafeUser = Omit<UserDoc, 'passwordHash' | 'pinHash'>;

/** Strip credential verifiers before a user document crosses an API boundary. */
export function redactUserForClient(user: UserDoc): ClientSafeUser {
  const { passwordHash: _passwordHash, pinHash: _pinHash, ...safe } = user;
  void _passwordHash;
  void _pinHash;
  return safe;
}

/** POST an action to /api/users and translate failures into readable errors. */
async function postUsersApi(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { apiFetch } = await import('../api-fetch');
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
    const { apiFetch } = await import('../api-fetch');
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

export async function createUser(
  data: CreateUserData,
  actorId?: string,
  actorUsername?: string
): Promise<UserDoc> {
  // Browser: provision through the central API (see note at top of file).
  // The server route authenticates the actor and re-runs this function on the
  // Node side, where the direct DB path below writes to CouchDB.
  if (isBrowserRuntime()) {
    const body = await postUsersApi({
      username: data.username,
      password: data.password,
      name: data.name,
      role: data.role,
      hospitalId: data.hospitalId,
      hospitalName: data.hospitalName,
      orgId: data.orgId,
      photoUrl: data.photoUrl,
      department: data.department,
      specialty: data.specialty,
      phone: data.phone,
    });
    return body.user as UserDoc;
  }

  const db = usersDB();

  // Validate
  if (!data.username || !data.password || !data.name || !data.role) {
    throw new Error('Missing required fields: username, password, name, role');
  }
  if (data.password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const username = data.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  /* istanbul ignore next -- defensive: username is always validated before reaching here */
  if (!username) throw new Error('Invalid username');

  if (!VALID_ROLES.includes(data.role)) {
    throw new Error(`Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
  }

  const ROLES_WITHOUT_HOSPITAL: UserRole[] = ['super_admin', 'org_admin', 'government', 'county_health_director'];
  if (data.role === 'org_admin' && !data.orgId) {
    throw new Error('Organization administrators must be assigned to an organization');
  }
  if (!ROLES_WITHOUT_HOSPITAL.includes(data.role) && (!data.hospitalId || !data.hospitalName)) {
    throw new Error('Clinical users must be assigned to a hospital');
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
  const { hashPassword } = await import('../auth');
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
  const { logAudit } = await import('./audit-service');
  await logAudit('user_created', actorId, actorUsername, `Created user "${username}" with role ${data.role}`, true);
  return doc;
}

interface UpdateUserData {
  name?: string;
  phone?: string;
  role?: UserRole;
  hospitalId?: string;
  hospitalName?: string;
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
  const { logAudit } = await import('./audit-service');
  await logAudit('user_updated', actorId, actorUsername, `Updated user "${existing.username}"`, true);
  return updated;
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

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const { hashPassword } = await import('../auth');
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
  const { logAudit } = await import('./audit-service');
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

  const { verifyPassword, hashPassword } = await import('../auth');
  const ok = await verifyPassword(currentPassword, existing.passwordHash);
  if (!ok) throw new Error('Current password is incorrect');

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
  const { logAudit } = await import('./audit-service');
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

  const updated: UserDoc = {
    ...existing,
    isActive: false,
    updatedAt: new Date().toISOString(),
  };

  const resp3 = await db.put(updated);
  updated._rev = resp3.rev;
  const { logAudit } = await import('./audit-service');
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
    updatedAt: new Date().toISOString(),
  };

  const resp = await db.put(updated);
  updated._rev = resp.rev;
  const { logAudit } = await import('./audit-service');
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
  const { logAudit } = await import('./audit-service');
  await logAudit('user_deleted', actorId, actorUsername, `Deleted user "${existing.username}"`, true);
}
