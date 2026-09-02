#!/usr/bin/env node
/**
 * Install the org-scoping validate_doc_update design doc on every CouchDB
 * database flagged orgScoped: true in lib/sync/sync-config.ts.
 *
 * Run as part of deployment (after the databases themselves exist).
 * Idempotent: re-running updates the existing _design/tamamhealth-org-scope.
 *
 * Required env (same fallbacks as platform/src/lib/db.ts):
 *   COUCHDB_URL              (or NEXT_PUBLIC_COUCHDB_URL, default http://couchdb:5984)
 *   COUCHDB_ADMIN_USER       (or COUCHDB_USER)
 *   COUCHDB_ADMIN_PASSWORD   (or COUCHDB_PASSWORD)
 *
 * Run through `tsx` so the database list and validator come from the exact
 * same TypeScript modules as the application. Security policy must never be
 * duplicated in a deployment script because a stale copy silently weakens the
 * database even when application tests pass.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';
import syncConfigModule from '../src/lib/sync/sync-config.ts';
import writePermissionsModule from '../src/lib/sync/write-permissions.ts';
import databasePolicyModule from '../src/lib/sync/couch-database-policy.ts';

const { DATABASE_SYNC_CONFIGS } = syncConfigModule;
const { ORG_SCOPED_VALIDATE_FN } = writePermissionsModule;
const {
  databasePolicy,
  resolveMemberRoles,
  ORG_SCOPE_DESIGN_DOC_ID,
  SERVER_ONLY_DESIGN_DOC_ID,
} = databasePolicyModule;

export const ORG_SCOPED_DATABASES = DATABASE_SYNC_CONFIGS
  .filter(config => config.orgScoped)
  .map(config => config.localName);
export { ORG_SCOPED_VALIDATE_FN };

const DESIGN_DOC_ID = ORG_SCOPE_DESIGN_DOC_ID;
const READ_ONLY_DESIGN_DOC_ID = SERVER_ONLY_DESIGN_DOC_ID;
const READ_ONLY_VALIDATE_FN = `function (newDoc, oldDoc, userCtx, secObj) {
  var roles = (userCtx && userCtx.roles) || [];
  for (var i = 0; i < roles.length; i++) {
    if (roles[i] === '_admin') return;
  }
  throw({ forbidden: 'This database is server-managed and read-only to clients' });
}`;

function resolveConfig() {
  const url =
    process.env.COUCHDB_URL ||
    process.env.NEXT_PUBLIC_COUCHDB_URL ||
    'http://couchdb:5984';
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!user || !pass) {
    console.error(
      '[install-validate-doc-updates] Missing CouchDB admin credentials. ' +
      'Set COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD (or COUCHDB_USER / ' +
      'COUCHDB_PASSWORD) in the environment.',
    );
    process.exit(1);
  }
  const authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  return { baseUrl: url.replace(/\/+$/, ''), authHeader };
}

export async function installOne(baseUrl, authHeader, dbName) {
  const designUrl = `${baseUrl}/${dbName}/${DESIGN_DOC_ID}`;

  // 1. Probe for an existing design doc to capture _rev (idempotent updates).
  let existingRev = null;
  const probe = await fetch(designUrl, {
    method: 'GET',
    headers: { Authorization: authHeader },
  });
  if (probe.status === 200) {
    const body = await probe.json();
    existingRev = body && body._rev ? body._rev : null;
  } else if (probe.status !== 404) {
    return { ok: false, reason: `GET ${probe.status}` };
  }

  // 2. PUT the new (or updated) design doc body.
  const body = {
    _id: DESIGN_DOC_ID,
    validate_doc_update: ORG_SCOPED_VALIDATE_FN,
  };
  if (existingRev) body._rev = existingRev;

  const put = await fetch(designUrl, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (put.status === 201 || put.status === 202) {
    return { ok: true };
  }
  let reason = `PUT ${put.status}`;
  try {
    const errBody = await put.json();
    if (errBody && (errBody.error || errBody.reason)) {
      reason += ` ${errBody.error || ''} ${errBody.reason || ''}`.trim();
    }
  } catch {
    // ignore — non-JSON error body
  }
  return { ok: false, reason };
}

export async function installReadOnly(baseUrl, authHeader, dbName) {
  const designUrl = `${baseUrl}/${dbName}/${READ_ONLY_DESIGN_DOC_ID}`;
  const probe = await fetch(designUrl, {
    method: 'GET',
    headers: { Authorization: authHeader },
  });
  let existingRev = null;
  if (probe.status === 200) {
    const existing = await probe.json();
    existingRev = existing && existing._rev ? existing._rev : null;
  } else if (probe.status !== 404) {
    return { ok: false, reason: `GET ${probe.status}` };
  }
  const body = {
    _id: READ_ONLY_DESIGN_DOC_ID,
    validate_doc_update: READ_ONLY_VALIDATE_FN,
  };
  if (existingRev) body._rev = existingRev;
  const put = await fetch(designUrl, {
    method: 'PUT',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return put.status === 201 || put.status === 202
    ? { ok: true }
    : { ok: false, reason: `PUT ${put.status}` };
}

/**
 * Organizations granted membership on the *shared aggregate* databases, so
 * authenticated CouchDB users (provisioned by lib/sync/couch-auth.ts with
 * `org:<orgId>` roles) can replicate them. Without this, CouchDB 3.x's
 * admins-only default blocks every browser pull/push with 403.
 *
 * With no explicit org IDs this script GRANTS nothing — production must never
 * silently hand access to demo organization roles. It does not REVOKE either;
 * see `resolveMemberRoles`. Tenant databases do not consult this list — their
 * single owning organization is read from the database name.
 */
function memberOrgIds() {
  return (process.env.COUCHDB_MEMBER_ORG_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether an omitted `COUCHDB_MEMBER_ORG_IDS` should CLEAR the member roles a
 * shared aggregate already carries. Off by default: this script is documented
 * as idempotent and is run as a routine deployment step, so forgetting one
 * environment variable must not cut every organization off from replication.
 * Set COUCHDB_REVOKE_UNLISTED_MEMBERS=true to actually lock the aggregates
 * down (the intended state once tenant databases are live).
 */
function revokeUnlistedMembers() {
  return process.env.COUCHDB_REVOKE_UNLISTED_MEMBERS === 'true';
}

/** Current `_security` for a database, or null when it has none / is unreadable. */
export async function readSecurity(baseUrl, authHeader, dbName) {
  try {
    const res = await fetch(`${baseUrl}/${dbName}/_security`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // Unreadable is treated as "no current state": the policy's answer is then
    // written as-is, which is what this script did before it read at all.
    return null;
  }
}

export async function applySecurity(baseUrl, authHeader, dbName, roles, existing) {
  const res = await fetch(`${baseUrl}/${dbName}/_security`, {
    method: 'PUT',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // `role:super_admin` is a DATABASE ADMIN, not a member: a platform
      // super-admin deliberately carries no `org:` role, so membership alone
      // would leave them unable to replicate anything at all.
      admins: { names: [], roles: ['role:super_admin'] },
      // Named members are an operator's manual grant to a single account; this
      // script has no opinion on them, so it carries them through rather than
      // dropping them on every run.
      members: { names: existing?.members?.names ?? [], roles },
    }),
  });
  if (res.status === 200 || res.status === 201) return { ok: true };
  let reason = `PUT _security ${res.status}`;
  try {
    const errBody = await res.json();
    if (errBody && (errBody.error || errBody.reason)) {
      reason += ` ${errBody.error || ''} ${errBody.reason || ''}`.trim();
    }
  } catch {
    // ignore — non-JSON error body
  }
  return { ok: false, reason };
}

async function main() {
  const { baseUrl, authHeader } = resolveConfig();

  // Every decision below is made against the databases CouchDB actually has,
  // not against a static list — that is the only way tenant databases created
  // by the migration receive the policy they need.
  const allDbsRes = await fetch(`${baseUrl}/_all_dbs`, {
    headers: { Authorization: authHeader },
  });
  const allDbs = (await allDbsRes.json()).filter(
    (name) => typeof name === 'string' && name.startsWith('tamamhealth_'),
  );

  const options = {
    // Compose exposes the browser/build flag in existing installations. Accept
    // both names so the deployment policy cannot accidentally treat a tenant
    // cutover as aggregate mode and preserve cross-tenant aggregate access.
    tenantDatabasesEnabled:
      (process.env.COUCHDB_TENANT_DATABASES_ENABLED ||
        process.env.NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED) === 'true',
    memberOrgIds: memberOrgIds(),
  };
  const revokeUnlisted = revokeUnlistedMembers();
  console.log(
    `[install-validate-doc-updates] target=${baseUrl.replace(/\/\/[^@]*@/, '//***@')} ` +
    `databases=${allDbs.length} tenantMode=${options.tenantDatabasesEnabled}`,
  );

  let errCount = 0;
  let secErr = 0;
  let okCount = 0;
  let secOk = 0;
  let tenantCount = 0;
  let preservedCount = 0;

  for (const db of allDbs) {
    const policy = databasePolicy(db, options);
    if (policy.orgId) tenantCount++;
    try {
      if (policy.orgScopedValidator) {
        const result = await installOne(baseUrl, authHeader, db);
        if (result.ok) {
          okCount++;
        } else {
          console.log(`[error] ${db} org-scope validator ${result.reason}`);
          errCount++;
        }
      }
      if (policy.serverOnlyValidator) {
        const result = await installReadOnly(baseUrl, authHeader, db);
        if (!result.ok) {
          console.log(`[error] ${db} server-only validator ${result.reason}`);
          errCount++;
        }
      }
    } catch (err) {
      console.log(`[error] ${db} ${err && err.message ? err.message : String(err)}`);
      errCount++;
    }

    try {
      // Read before write: the member list is only fully known once the
      // database's current state is in hand (see resolveMemberRoles).
      const current = await readSecurity(baseUrl, authHeader, db);
      const currentRoles = current?.members?.roles ?? [];
      const { roles, preserved } = resolveMemberRoles(policy, currentRoles, { revokeUnlisted });
      if (preserved) {
        preservedCount++;
        console.log(
          `[keep] ${db} members ${JSON.stringify(roles)} — COUCHDB_MEMBER_ORG_IDS is unset, ` +
          'so nothing was granted and nothing revoked ' +
          '(set COUCHDB_REVOKE_UNLISTED_MEMBERS=true to clear them)',
        );
      }
      const result = await applySecurity(baseUrl, authHeader, db, roles, current);
      if (result.ok) {
        secOk++;
      } else {
        console.log(`[error] ${db} ${result.reason}`);
        secErr++;
      }
    } catch (err) {
      console.log(`[error] ${db} _security ${err && err.message ? err.message : String(err)}`);
      secErr++;
    }
  }

  console.log(
    `[install-validate-doc-updates] validators ok=${okCount} error=${errCount} · ` +
    `_security ok=${secOk} error=${secErr} · tenant databases=${tenantCount} · ` +
    `members preserved=${preservedCount} · ` +
    `aggregate members=[${options.tenantDatabasesEnabled ? '' : options.memberOrgIds.join(', ')}]`,
  );

  if (errCount > 0 || secErr > 0) process.exit(1);
}

const invokedDirectly = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[install-validate-doc-updates] fatal', err);
    process.exit(1);
  });
}
