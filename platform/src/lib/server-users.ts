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
import { DEMO_USER_PROFILES, getOrCreateSeedCredentials } from './seed-credentials';

export interface ServerUser {
  _id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: string;
  hospitalId?: string;
  hospitalName?: string;
  orgId?: string;
  /** ISO 3166-1 alpha-2 — facility's country (e.g. "SS" for South Sudan). */
  countryId?: string;
  /** Geographic tier fields for sub-org scoping (P0 tier-isolation). */
  payam?: string;
  county?: string;
  state?: string;
  isActive: boolean;
  /** True when the user must set a new password before using the app. */
  mustChangePassword?: boolean;
}

/**
 * Authenticate against the shared users database (CouchDB via the server http
 * adapter). This is where admin-created users live — the static DEMO_USER_PROFILES
 * roster only covers seeded demo accounts, so without this lookup a user created
 * through the admin UI could never log in. Returns null on any miss (unknown
 * user, wrong password, inactive, or DB unreachable) so the caller can fall
 * back to a constant-time dummy hash.
 */
async function authenticateFromUsersDb(
  username: string,
  password: string,
): Promise<ServerUser | null> {
  try {
    const { usersDB } = await import('./db');
    const db = usersDB();
    const doc = await db.get(`user-${username}`) as import('./db-types').UserDoc;
    if (!doc || doc.type !== 'user' || doc.isActive === false) return null;
    const valid = await bcrypt.compare(password, doc.passwordHash);
    if (!valid) return null;
    return {
      _id: doc._id,
      username: doc.username,
      passwordHash: doc.passwordHash,
      name: doc.name,
      role: doc.role,
      hospitalId: doc.hospitalId,
      hospitalName: doc.hospitalName,
      orgId: doc.orgId,
      isActive: doc.isActive,
      mustChangePassword: doc.mustChangePassword,
    };
  } catch {
    // 404 (no such user) or DB unreachable — treat as an auth miss.
    return null;
  }
}

const profileByUsername = new Map(DEMO_USER_PROFILES.map(p => [p.username, p]));

// Per-username bcrypt-hash cache. Each entry remembers which plaintext we
// hashed against, so a regenerated password file invalidates automatically.
const hashCache: Record<string, { plaintext: string; hash: string }> = {};

async function getHash(username: string, plaintext: string): Promise<string> {
  const cached = hashCache[username];
  if (cached && cached.plaintext === plaintext) return cached.hash;
  const hash = await bcrypt.hash(plaintext, 12);
  hashCache[username] = { plaintext, hash };
  return hash;
}

/**
 * Look up a user by username and verify the password — server-safe.
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<ServerUser | null> {
  const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

  // Production users—including the bootstrap admin—are authoritative only in
  // the shared users database. Falling back to ADMIN_INITIAL_PASSWORD after a
  // password change would leave the old bootstrap password usable forever.
  if (!isDemo) {
    const productionUser = await authenticateFromUsersDb(username, password);
    if (productionUser) return productionUser;
    await bcrypt.hash(password, 12);
    return null;
  }

  // 1) Seeded demo accounts — verified against the generated credentials file.
  //    Checked first so demo logins keep working even when CouchDB is offline.
  const profile = profileByUsername.get(username);
  if (profile) {
    const credentials = await getOrCreateSeedCredentials();
    const expected = credentials.passwords[username];
    if (expected) {
      const hash = await getHash(username, expected);
      if (await bcrypt.compare(password, hash)) {
        return {
          _id: `user-${profile.username}`,
          username: profile.username,
          passwordHash: hash,
          name: profile.name,
          role: profile.role,
          hospitalId: profile.hospitalId,
          hospitalName: profile.hospitalName,
          orgId: profile.orgId,
          isActive: true,
        };
      }
    }
    // Demo username exists but the seed password didn't match. The account may
    // have been re-created/reset into the users DB (which shadows the seed), so
    // fall through to the DB lookup before giving up.
  }

  // 2) Admin-created (and reset) users live in the shared users database.
  const fromDb = await authenticateFromUsersDb(username, password);
  if (fromDb) return fromDb;

  // 3) No match anywhere — constant-time dummy hash so a non-existent user
  //    takes roughly as long as a valid one (anti username-enumeration).
  await bcrypt.hash(password, 12);
  return null;
}
