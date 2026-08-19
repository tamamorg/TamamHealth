#!/usr/bin/env node
/**
 * Provision the seed organizations into CouchDB.
 *
 * Why this exists: `tamamhealth_organizations` carries a server-writes-only
 * validate_doc_update, so a browser can hold organization documents in its
 * local PouchDB replica but can never push them up. On an installation seeded
 * only through the browser, CouchDB therefore ends up with the hospitals and
 * the user accounts but with NO organization documents at all — and every
 * server-side check against an organization then fails closed. The visible
 * symptom is that creating a staff account answers "Assigned organization was
 * not found or is inactive", so an organization admin cannot add anybody.
 *
 * Organizations created through the super-admin console no longer have this
 * problem (organization-service routes browser writes through
 * /api/organizations, which writes with the server's admin credentials). This
 * script is for the installations that predate that fix.
 *
 * Idempotent: an organization that already exists is left exactly as it is,
 * because its live record — renamed, rebranded, resubscribed — is worth more
 * than the seed defaults it started from.
 *
 * Required env (same fallbacks as platform/src/lib/db.ts):
 *   COUCHDB_URL              (or NEXT_PUBLIC_COUCHDB_URL, default http://couchdb:5984)
 *   COUCHDB_ADMIN_USER       (or COUCHDB_USER)
 *   COUCHDB_ADMIN_PASSWORD   (or COUCHDB_PASSWORD)
 *
 * Usage:
 *   node --import tsx scripts/seed-organizations.mjs           # write missing organizations
 *   DRY_RUN=true node --import tsx scripts/seed-organizations.mjs   # report only
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';
import seedOrganizationsModule from '../src/lib/seed-organizations.ts';

const DB_NAME = 'tamamhealth_organizations';

/**
 * The seed organizations, read from the same module the browser seeds from so
 * the two can never drift into describing different tenants.
 */
const { DEFAULT_ORGANIZATIONS: SEED_ORGANIZATIONS } = seedOrganizationsModule;

function resolveConfig() {
  const url =
    process.env.COUCHDB_URL ||
    process.env.NEXT_PUBLIC_COUCHDB_URL ||
    'http://couchdb:5984';
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!user || !pass) {
    console.error(
      '[seed-organizations] Missing CouchDB admin credentials. Set ' +
      'COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD (or COUCHDB_USER / ' +
      'COUCHDB_PASSWORD) in the environment.',
    );
    process.exit(1);
  }
  const authHeader = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  return { baseUrl: url.replace(/\/+$/, ''), authHeader };
}

async function seedOne(baseUrl, authHeader, org, dryRun) {
  const docUrl = `${baseUrl}/${DB_NAME}/${encodeURIComponent(org._id)}`;

  const probe = await fetch(docUrl, { method: 'GET', headers: { Authorization: authHeader } });
  if (probe.status === 200) return { status: 'exists' };
  if (probe.status !== 404) return { status: 'failed', reason: `GET ${probe.status}` };

  if (dryRun) return { status: 'would-create' };

  const put = await fetch(docUrl, {
    method: 'PUT',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify(org),
  });
  if (put.status === 201 || put.status === 202) return { status: 'created' };

  let reason = `PUT ${put.status}`;
  try {
    const err = await put.json();
    if (err && (err.error || err.reason)) reason += ` ${err.error || ''} ${err.reason || ''}`.trim();
  } catch {
    // non-JSON error body
  }
  return { status: 'failed', reason };
}

async function main() {
  const dryRun = process.env.DRY_RUN === 'true';
  const { baseUrl, authHeader } = resolveConfig();

  console.log(`[seed-organizations] ${baseUrl}/${DB_NAME}${dryRun ? ' (DRY RUN)' : ''}`);

  let failures = 0;
  for (const org of SEED_ORGANIZATIONS) {
    const result = await seedOne(baseUrl, authHeader, org, dryRun);
    const line = `  ${org._id} (${org.name})`;
    if (result.status === 'failed') {
      failures += 1;
      console.error(`${line} — FAILED: ${result.reason}`);
    } else {
      console.log(`${line} — ${result.status}`);
    }
  }

  if (failures > 0) {
    console.error(`[seed-organizations] ${failures} organization(s) could not be written.`);
    process.exit(1);
  }
  console.log('[seed-organizations] done.');
}

main().catch(err => {
  console.error('[seed-organizations] failed:', err);
  process.exit(1);
});
