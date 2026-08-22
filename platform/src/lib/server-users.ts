/**
 * Server-safe user registry for API route authentication.
 *
 * PouchDB (pouchdb-browser) cannot run in Node.js API routes because it
 * references `self` (a browser global). This module provides a static user
 * roster (DEMO_USER_PROFILES) and verifies passwords against
 * `seed-credentials.ts`, which lazily generates and persists random
 * passwords on first boot. There is no plaintext password in this file.
 */

import bcrypt from 'bcryptjs';
import { hashPassword } from './auth';
import { DEMO_USER_PROFILES, getOrCreateSeedCredentials } from './seed-credentials';

export interface ServerUser {
  _id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  hospitalId?: string;
  hospitalName?: string;
  /** Extra facilities this user covers — see UserDoc.facilityIds. */
  facilityIds?: string[];
  orgId?: string;
  /** Organization display name denormalised onto the user doc — see UserDoc.orgName. */
  orgName?: string;
  /** ISO 3166-1 alpha-2 — facility's country (e.g. "SS" for South Sudan). */
  countryId?: string;
  /** Geographic tier fields for sub-org scoping (P0 tier-isolation). */
  payam?: string;
  county?: string;
  state?: string;
  isActive: boolean;
  /** True when the user must set a new password before using the app. */
  mustChangePassword?: boolean;
  /** ISO timestamp of the last password change — feeds the JWT `pwdAt` epoch
   *  claim so tokens minted before a change/reset are rejected. */
  passwordUpdatedAt?: string;
}

/**
 * Authenticate against the shared users database (CouchDB via the server http
 * adapter). This is where admin-created users live — the static DEMO_USER_PROFILES
 * roster only covers seeded demo accounts, so without this lookup a user created
 * through the admin UI could never log in. Returns null on any miss (unknown
 * user, wrong password, inactive, or DB unreachable) so the caller can fall
 * back to a constant-time dummy hash.
 */
/**
 * Thrown when the users database could not be consulted at all.
 *
 * "No such user" and "the database is unreachable" are the same outcome for
 * the caller — nobody is signed in — but they are not the same problem, and
 * collapsing them is how a broken deployment spends an afternoon looking like
 * a forgotten password. Every login on a healthy system that simply has no
 * such account still returns null; only an infrastructure fault raises this.
 */
export class UsersDbUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('The user database could not be reached');
    this.name = 'UsersDbUnavailableError';
    this.cause = cause;
  }
}

async function authenticateFromUsersDb(
  username: string,
  password: string,
): Promise<{ user: ServerUser | null; exists: boolean }> {
  try {
    const { usersDB } = await import('./db');
    const db = usersDB();
    const doc = await db.get(`user-${username}`) as import('./db-types').UserDoc;
    if (!doc || doc.type !== 'user' || typeof doc.passwordHash !== 'string') {
      return { user: null, exists: true };
    }
    const valid = await bcrypt.compare(password, doc.passwordHash);
    if (!valid || doc.isActive === false) return { user: null, exists: true };
    return { user: {
      _id: doc._id,
      username: doc.username,
      passwordHash: doc.passwordHash,
      name: doc.name,
      role: doc.role,
      hospitalId: doc.hospitalId,
      hospitalName: doc.hospitalName,
      facilityIds: doc.facilityIds,
      orgId: doc.orgId,
      orgName: doc.orgName,
      isActive: doc.isActive,
      mustChangePassword: doc.mustChangePassword,
      passwordUpdatedAt: doc.passwordUpdatedAt,
    }, exists: true };
  } catch (err) {
    // A 404 is a real answer: there is no such account. Anything else — the
    // database missing, CouchDB refusing the connection, a network fault — is
    // an infrastructure failure wearing the same clothes, and reporting it as
    // "invalid credentials" tells an operator to go and check a password when
    // they should be checking a server.
    const status = (err as { status?: number; name?: string })?.status;
    if (status === 404) return { user: null, exists: false };
    throw new UsersDbUnavailableError(err);
  }
}

const profileByUsername = new Map(DEMO_USER_PROFILES.map(p => [p.username, p]));

/**
 * Accounts that may bootstrap themselves into the shared users DB on first
 * login. Production auth is authoritative against the users DB, but nothing
 * else provisions these platform-operator docs, so a fresh production deploy
 * would have no way in. The bootstrap below is the one exception, and it is
 * deliberately narrow: only these usernames, only when NO doc exists yet
 * (so a changed password can never be shadowed by the seed credential), and
 * only against the seed credential (SUPERADMIN_INITIAL_PASSWORD /
 * ADMIN_INITIAL_PASSWORD or their defaults).
 */
const BOOTSTRAP_USERNAMES = new Set(['admin', 'superadmin']);

/**
 * First-login provisioning for a platform bootstrap account. Returns the user
 * only when (a) the username is a bootstrap account, (b) no users-DB doc
 * exists yet, and (c) the password matches the seed credential. On success it
 * writes the authoritative doc so subsequent logins — and password changes —
 * go through `authenticateFromUsersDb` and this path is never taken again.
 */
async function bootstrapUserLogin(
  username: string,
  password: string,
  userDocKnownMissing = false,
): Promise<ServerUser | null> {
  if (!BOOTSTRAP_USERNAMES.has(username)) return null;
  const profile = profileByUsername.get(username);
  if (!profile) return null;

  const { usersDB } = await import('./db');
  const db = usersDB();

  // A doc already exists → the DB is authoritative from here on. Do NOT let
  // the seed credential authenticate against an account whose password may
  // have been changed. (A DB match would already have returned in the caller;
  // reaching here with an existing doc means the seed password was offered
  // for an account that has one — reject it.)
  if (!userDocKnownMissing) {
    try {
      await db.get(`user-${username}`);
      return null;
    } catch (err) {
      const status = (err as { status?: number; name?: string })?.status;
      // Anything other than "not found" (e.g. CouchDB unreachable) is not a
      // safe bootstrap condition — fail closed.
      if (status !== 404) return null;
    }
  }

  const credentials = await getOrCreateSeedCredentials();
  const expected = credentials.passwords[username];
  if (!expected) return null;
  const hash = await getHash(username, expected);
  if (!(await bcrypt.compare(password, hash))) return null;

  const now = new Date().toISOString();
  const doc = {
    _id: `user-${username}`,
    type: 'user' as const,
    username,
    passwordHash: hash,
    name: profile.name,
    role: profile.role,
    hospitalId: profile.hospitalId,
    hospitalName: profile.hospitalName,
    orgId: profile.orgId,
    isActive: true,
    // This path is production-only (the demo branch of authenticateUser never
    // reaches it). A bootstrap credential is single-use by design, so force a
    // change on first login — combined with the config-validation guard that
    // requires a strong SUPERADMIN_INITIAL_PASSWORD, the operator sets a strong
    // secret AND rotates it immediately, and no default survives first login.
    mustChangePassword: true,
    passwordUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.put(doc);
  } catch (putErr) {
    // Never issue a session backed only by the bootstrap secret. If another
    // first login won the create race, accept only when the persisted account
    // still verifies this same password. On an infrastructure/write failure,
    // fail closed so the initial credential cannot remain a reusable shadow
    // login indefinitely.
    try {
      const persisted = await db.get(`user-${username}`) as import('./db-types').UserDoc;
      if (!persisted || persisted.isActive === false || !(await bcrypt.compare(password, persisted.passwordHash))) {
        return null;
      }
      return {
        _id: persisted._id,
        username: persisted.username,
        passwordHash: persisted.passwordHash,
        name: persisted.name,
        role: persisted.role,
        hospitalId: persisted.hospitalId,
        hospitalName: persisted.hospitalName,
        orgId: persisted.orgId,
        isActive: persisted.isActive,
        mustChangePassword: persisted.mustChangePassword,
        passwordUpdatedAt: persisted.passwordUpdatedAt,
      };
    } catch {
      throw new UsersDbUnavailableError(putErr);
    }
  }
  return {
    _id: doc._id,
    username,
    passwordHash: hash,
    name: profile.name,
    role: profile.role,
    hospitalId: profile.hospitalId,
    hospitalName: profile.hospitalName,
    orgId: profile.orgId,
    isActive: true,
    mustChangePassword: true,
    passwordUpdatedAt: now,
  };
}

// Per-username bcrypt-hash cache. Each entry remembers which plaintext we
// hashed against, so a regenerated password file invalidates automatically.
const hashCache: Record<string, { plaintext: string; hash: string }> = {};

// A fixed verifier for unknown usernames. Comparing against a real cost-12
// hash keeps misses timing-compatible with a bad password without generating
// a brand-new hash on every request (which previously doubled CPU cost and
// made typo-heavy login bursts noticeably slow).
const DUMMY_PASSWORD_HASH = '$2b$12$gNB1VUNmx6fi4XsavwguR.3iwu6bqFy0LDcaFxb4ygNt/dTUKcIlq';

async function getHash(username: string, plaintext: string): Promise<string> {
  const cached = hashCache[username];
  if (cached && cached.plaintext === plaintext) return cached.hash;
  const hash = await hashPassword(plaintext);
  hashCache[username] = { plaintext, hash };
  return hash;
}

/**
 * Whether this server has a CouchDB users database at all.
 *
 * `db.ts` refuses to build a server-side database handle without admin
 * credentials, so their absence is not a misconfiguration to route around —
 * it IS the standalone demo deployment, where the roster lives only in each
 * browser's PouchDB and no server-side user store exists to consult.
 */
function couchIsConfigured(): boolean {
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  return Boolean(user && pass);
}

/**
 * The standalone demo deployment: demo mode explicitly on AND no users
 * database to authenticate against.
 *
 * Both halves are load-bearing. The demo branch that used to live in
 * `authenticateUser` keyed on `NEXT_PUBLIC_DEMO_MODE` alone and failed OPEN —
 * a container that never promoted the build argument to an `ENV` would have
 * accepted three dozen seeded credentials on a production server, which is
 * why it was removed. This gate fails closed twice over: the flag must be
 * exactly the string 'true', AND the deployment must have no users database.
 * A real server always has one, so a mis-set flag there changes nothing.
 */
export function isStandaloneDemo(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true' && !couchIsConfigured();
}

/**
 * Verify a seeded demo account with no users database behind it.
 *
 * Only the canned roster (DEMO_USER_PROFILES) and only against the seed
 * credentials — deterministic per username from `SEED_CREDENTIALS_SECRET`,
 * or the operator-pinned initial password for `admin` / `superadmin`. The
 * plaintexts are computed server-side and never leave it; the browser is
 * given a session cookie, not a credential.
 */
async function authenticateStandaloneDemoUser(
  username: string,
  password: string,
): Promise<ServerUser | null> {
  const profile = profileByUsername.get(username);
  if (!profile) return null;

  let expected: string | undefined;
  try {
    const credentials = await getOrCreateSeedCredentials();
    expected = credentials.passwords[username];
  } catch {
    // A demo whose credential source cannot be read signs nobody in.
    return null;
  }
  if (!expected) return null;
  if (!(await bcrypt.compare(password, await getHash(username, expected)))) return null;

  return {
    _id: `user-${username}`,
    username,
    passwordHash: '',
    name: profile.name,
    role: profile.role,
    hospitalId: profile.hospitalId,
    hospitalName: profile.hospitalName,
    orgId: profile.orgId,
    isActive: true,
    // Nothing can persist a password change on a deployment with no users
    // database, so forcing one would dead-end the first sign-in rather than
    // protect anything. The bootstrap path keeps its `true` — that one writes.
    mustChangePassword: false,
  };
}

/**
 * Look up a user by username and verify the password — server-safe.
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<ServerUser | null> {
  // The shared users database is the only authority on who may sign in.
  //
  // There used to be a demo branch here that accepted the seeded roster's
  // generated passwords whenever `NEXT_PUBLIC_DEMO_MODE` was not exactly the
  // string 'false'. That flag is read from the process environment at runtime,
  // the container never promoted the build argument to an `ENV`, and the check
  // fails OPEN — so a production server with the variable simply unset would
  // have accepted three dozen demo credentials. A deployment should not be one
  // missing environment variable away from a public login.
  //
  // Accounts are now created exactly one way: by an administrator, or by
  // approving an account request, which calls the same `createUser`.
  //
  // The one exception is a deployment that HAS no users database: the
  // standalone demo. There is no document to read and no administrator to
  // create one, so the seeded credentials are the only way in. It returns
  // rather than falling through, because the lookup below would only raise
  // UsersDbUnavailableError and the login route would answer 503.
  if (isStandaloneDemo()) {
    const demoUser = await authenticateStandaloneDemoUser(username, password);
    if (demoUser) return demoUser;
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  const lookup = await authenticateFromUsersDb(username, password);
  if (lookup.user) return lookup.user;

  // An existing document is authoritative. Its bcrypt comparison above is
  // already the constant-work password check; do not query CouchDB again or
  // add a second cost-12 hash for a simple wrong password.
  if (lookup.exists) return null;

  // First-login provisioning for the platform operator accounts, so a fresh
  // deployment is reachable at all. Narrow and create-if-absent — see
  // bootstrapUserLogin.
  const bootstrapped = await bootstrapUserLogin(username, password, true);
  if (bootstrapped) return bootstrapped;

  // No match — constant-time dummy hash so a non-existent user takes roughly
  // as long as a valid one (anti username-enumeration).
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
  return null;
}
