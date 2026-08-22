#!/usr/bin/env node
/**
 * One-off cleanup: remove the retired second factor's fields from user docs.
 *
 * The authenticator feature is gone from the code, but a document written
 * while it existed still carries what enrolment wrote:
 *
 *   totpSecret               the shared secret — a standing credential, and
 *                            the reason this script exists. Anyone holding it
 *                            can generate that account's codes forever, and
 *                            unlike a password nothing ever prompts a rotation.
 *   totpRecoveryCodeHashes   ten single-use bypass hashes
 *   totpLastUsedStep         replay guard, useless on its own
 *   totpEnabledAt            when the factor went live
 *
 * `redactUserForClient` strips all four by name, so they are not reachable
 * through the API today. This removes them from storage so that stops being
 * the only thing standing between a retired credential and a response body.
 *
 * `tamamhealth_users` does NOT replicate to browsers (see
 * NON_REPLICATING_LOCAL_DATABASES in lib/db.ts), so the server copy is the
 * only one that matters. Browsers seeded before that change hold a legacy copy
 * that `resetAllDatabases()` already wipes.
 *
 * Usage:
 *   DRY_RUN=true npm run db:strip-totp    # report only, change nothing
 *   npm run db:strip-totp                 # apply
 *
 * Reads COUCHDB_URL and admin credentials the same way the other CouchDB
 * maintenance scripts do.
 */
import { Buffer } from 'node:buffer';

const DB_NAME = 'tamamhealth_users';
const FIELDS = ['totpSecret', 'totpRecoveryCodeHashes', 'totpLastUsedStep', 'totpEnabledAt'];

const baseUrl = (process.env.COUCHDB_URL || '').replace(/\/+$/, '');
const adminUser = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER || '';
const adminPassword = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD || '';
const dryRun = process.env.DRY_RUN === 'true';

if (!baseUrl || !adminUser || !adminPassword) {
  console.error('Set COUCHDB_URL, COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD.');
  process.exit(1);
}

const headers = {
  Authorization: `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString('base64')}`,
  'Content-Type': 'application/json',
};

async function json(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path}: HTTP ${response.status}`);
  return response.json();
}

/** Every user document, paged — a cluster's roster does not fit in one request. */
async function* allUsers() {
  let startkey = '';
  const limit = 500;
  for (;;) {
    const params = new URLSearchParams({ include_docs: 'true', limit: String(limit + 1) });
    if (startkey) params.set('startkey', JSON.stringify(startkey));
    const body = await json(`/${encodeURIComponent(DB_NAME)}/_all_docs?${params}`);
    const rows = (body.rows || []).filter(row => !row.id.startsWith('_design/'));
    const page = rows.slice(0, limit);
    for (const row of page) if (row.doc) yield row.doc;
    if (rows.length <= limit) return;
    startkey = rows[limit].id;
  }
}

const carrying = [];
for await (const doc of allUsers()) {
  const present = FIELDS.filter(field => doc[field] !== undefined);
  if (present.length) carrying.push({ doc, present });
}

if (carrying.length === 0) {
  console.log(`No user document carries a retired second factor. Nothing to do (${DB_NAME}).`);
  process.exit(0);
}

// Named so the operator can see WHOSE credential is being cleared — an account
// that actually enrolled is one whose secret was live, and that is worth
// knowing rather than counting.
console.log(`${carrying.length} user document(s) carry retired second-factor fields:`);
for (const { doc, present } of carrying) {
  const enrolled = doc.totpSecret !== undefined ? ' [HAD A LIVE SECRET]' : '';
  console.log(`  ${doc.username || doc._id}: ${present.join(', ')}${enrolled}`);
}

if (dryRun) {
  console.log('\nDRY_RUN=true — nothing was written.');
  process.exit(0);
}

// One bulk write. `_bulk_docs` is not atomic across documents, so a partial
// failure leaves the rest cleared and is reported per-id: re-running is safe
// and is the fix, because the script is idempotent by construction.
const updates = carrying.map(({ doc }) => {
  const next = { ...doc };
  for (const field of FIELDS) delete next[field];
  return next;
});

const results = await json(`/${encodeURIComponent(DB_NAME)}/_bulk_docs`, {
  method: 'POST',
  body: JSON.stringify({ docs: updates }),
});

const failed = (results || []).filter(row => row.error);
const ok = updates.length - failed.length;
console.log(`\nCleared ${ok} document(s).`);
if (failed.length) {
  for (const row of failed) console.error(`  FAILED ${row.id}: ${row.error} — ${row.reason}`);
  console.error('Re-run to retry the failures; the script only touches documents that still carry a field.');
  process.exit(1);
}
