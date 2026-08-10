/**
 * Server-side CouchDB user/security provisioning.
 *
 * Replaces the earlier model where every browser used a single shared admin
 * URL with embedded credentials. With this module:
 *
 *   • Each platform user has a matching CouchDB `_users` document, created on
 *     login and refreshed if their password changes.
 *   • DB-level access uses CouchDB's `_security` object scoped to a role
 *     name derived from the user's `orgId` (Phase 1) or `facilityId`
 *     (Phase 2 will add per-facility DBs).
 *   • The browser then logs into CouchDB itself via POST /_session and gets
 *     an `AuthSession` cookie. Sync replicates with that cookie via
 *     `credentials: 'include'`. No admin secret ever reaches the browser.
 *
 * All functions here run with admin credentials and are only invoked from
 * Node.js server code (api routes, scripts). Importing this from browser
 * bundles is a build error by design — admin creds must not be shipped.
 */
import { Buffer } from 'node:buffer';
import { DATABASE_SYNC_CONFIGS } from './sync-config';

interface CouchAdminEnv {
  baseUrl: string;
  authHeader: string;
}

function adminEnv(): CouchAdminEnv {
  const base =
    process.env.COUCHDB_URL ||
    process.env.NEXT_PUBLIC_COUCHDB_URL ||
    'http://localhost:5984';
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      '[couch-auth] COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD (or ' +
      'COUCHDB_USER / COUCHDB_PASSWORD) must be set in the server environment.'
    );
  }
  // Strip any creds the operator may have left embedded in the URL — we
  // build the Authorization header explicitly so the URL never carries
  // them in logs.
  const stripped = (() => {
    try {
      const u = new URL(base);
      u.username = '';
      u.password = '';
      return u.toString().replace(/\/$/, '');
    } catch {
      return base.replace(/\/$/, '');
    }
  })();
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  return { baseUrl: stripped, authHeader: `Basic ${token}` };
}

interface CouchFetchOpts {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  /** When true, treat 404 as a non-error and return null. */
  allow404?: boolean;
}

async function couchFetch(opts: CouchFetchOpts): Promise<unknown> {
  const { baseUrl, authHeader } = adminEnv();
  const url = `${baseUrl}${opts.path}`;
  const res = await fetch(url, {
    method: opts.method,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[couch-auth] ${opts.method} ${opts.path} → ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/**
 * Idempotent: ensure a CouchDB user document exists for `username`, with the
 * supplied plaintext password and the given role list. Re-running with a new
 * password rotates it (CouchDB will re-hash on store).
 *
 * Roles use the `org:<orgId>` / `facility:<id>` / `role:<platformRole>`
 * convention — the same prefixes the validate_doc_update functions compiled
 * from write-permissions.ts inspect (`org:` for the tenant boundary, `role:`
 * for the per-type write matrix), and the prefix per-DB `_security` member
 * grants are keyed on.
 */
export async function ensureCouchUser(input: {
  username: string;
  password: string;
  orgId?: string;
  hospitalId?: string;
  platformRole?: string;
}): Promise<void> {
  const docId = `org.couchdb.user:${input.username}`;
  const path = `/_users/${encodeURIComponent(docId)}`;

  const roles: string[] = [];
  if (input.orgId) roles.push(`org:${input.orgId}`);
  if (input.hospitalId) roles.push(`facility:${input.hospitalId}`);
  if (input.platformRole) roles.push(`role:${input.platformRole}`);

  // Read current rev (if any) so PUT can replace cleanly.
  const existing = (await couchFetch({
    method: 'GET',
    path,
    allow404: true,
  })) as { _rev?: string } | null;

  const body: Record<string, unknown> = {
    _id: docId,
    name: input.username,
    type: 'user',
    roles,
    password: input.password,
  };
  if (existing?._rev) body._rev = existing._rev;

  await couchFetch({ method: 'PUT', path, body });
}

/**
 * Apply a `_security` object to a database so only members of the given
 * roles (typically `org-<orgId>`) can read/write. The `_admins` block is
 * intentionally left empty — admin operations stay with the server admin
 * credentials, never delegated to per-user roles.
 *
 * Idempotent: PUT replaces the existing _security doc atomically.
 */
export async function setDatabaseSecurity(input: {
  dbName: string;
  memberRoles: string[];
  memberUsers?: string[];
}): Promise<void> {
  await couchFetch({
    method: 'PUT',
    path: `/${encodeURIComponent(input.dbName)}/_security`,
    body: {
      admins: { names: [], roles: [] },
      members: {
        names: input.memberUsers ?? [],
        roles: input.memberRoles,
      },
    },
  });
}

/**
 * One-time helper: bind every tamamhealth_* database to a role list. Call this
 * from setup-couchdb.sh's TS counterpart or a one-shot admin route after a
 * fresh CouchDB install. Pass an empty array to make the DB world-readable
 * to any authenticated user (NOT recommended for production).
 */
export async function applyOrgScopedSecurity(roles: string[]): Promise<void> {
  // Derive this from the canonical sync map. Maintaining a second hand-written
  // list caused newly-added clinical databases to miss CouchDB _security
  // membership even though they were already replicating.
  const dbs = DATABASE_SYNC_CONFIGS
    .filter(config => config.orgScoped)
    .map(config => config.localName);
  for (const db of dbs) {
    try {
      await setDatabaseSecurity({ dbName: db, memberRoles: roles });
    } catch (err) {
      console.warn(`[couch-auth] applyOrgScopedSecurity: ${db} failed`, err);
    }
  }
}
