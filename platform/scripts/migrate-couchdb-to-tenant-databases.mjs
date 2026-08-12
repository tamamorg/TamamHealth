#!/usr/bin/env node
/**
 * Non-destructive shared → database-per-organization CouchDB migration.
 *
 * Required:
 *   COUCHDB_URL, COUCHDB_ADMIN_USER, COUCHDB_ADMIN_PASSWORD
 *   COUCHDB_TENANT_ORG_IDS=org-one,org-two
 * Optional:
 *   DRY_RUN=true
 *
 * Source databases are never deleted. Re-running is safe: CouchDB replication
 * is revision-aware and tenant database provisioning is idempotent.
 */
import { Buffer } from 'node:buffer';
import {
  ORG_SCOPED_DATABASES,
  installOne,
  installReadOnly,
  applySecurity,
} from './install-validate-doc-updates.mjs';
import databasePolicyModule from '../src/lib/sync/couch-database-policy.ts';

const { databasePolicy } = databasePolicyModule;

const ORG_ID_RE = /^org-[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const dryRun = process.env.DRY_RUN === 'true';
const finalizeSharedAccess = process.env.FINALIZE_SHARED_ACCESS === 'true';
const baseUrl = (process.env.COUCHDB_URL || '').replace(/\/+$/, '');
const adminUser = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER || '';
const adminPassword = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD || '';
const orgIds = (process.env.COUCHDB_TENANT_ORG_IDS || '')
  .split(',').map(value => value.trim()).filter(Boolean);

if (!baseUrl || !adminUser || !adminPassword || orgIds.length === 0) {
  console.error('Set COUCHDB_URL, CouchDB admin credentials, and COUCHDB_TENANT_ORG_IDS.');
  process.exit(1);
}
for (const orgId of orgIds) {
  if (!ORG_ID_RE.test(orgId)) {
    console.error(`Invalid canonical organization ID: ${orgId}`);
    process.exit(1);
  }
}

const authHeader = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString('base64')}`;
const headers = { Authorization: authHeader, 'Content-Type': 'application/json' };
const PULL_ONLY_DATABASES = new Set(['tamamhealth_fee_schedule']);
const PUSH_ONLY_DATABASES = new Set([
  'tamamhealth_sync_events',
  'tamamhealth_audit_log',
  'tamamhealth_controlled_substance_log',
]);

async function expectStatus(response, allowed, action) {
  if (allowed.includes(response.status)) return;
  const reason = await response.text().catch(() => '');
  throw new Error(`${action} failed: HTTP ${response.status} ${reason}`.trim());
}

async function migrateOne(orgId, source) {
  const target = `${source}--${orgId}`;
  if (dryRun) {
    console.log(`[dry-run] ${source} -> ${target} selector orgId=${orgId}`);
    return;
  }

  const create = await fetch(`${baseUrl}/${encodeURIComponent(target)}`, { method: 'PUT', headers });
  await expectStatus(create, [201, 202, 412], `create ${target}`);

  // Same policy the validator installer applies, so a later idempotent re-run
  // of `setup:couchdb:validators` cannot disagree with what we set up here.
  const policy = databasePolicy(target, { tenantDatabasesEnabled: true });
  if (policy.orgScopedValidator) {
    const validator = await installOne(baseUrl, authHeader, target);
    if (!validator.ok) throw new Error(`validator ${target}: ${validator.reason}`);
  }
  if (policy.serverOnlyValidator) {
    const readOnly = await installReadOnly(baseUrl, authHeader, target);
    if (!readOnly.ok) throw new Error(`read-only policy ${target}: ${readOnly.reason}`);
  }
  const security = await applySecurity(baseUrl, authHeader, target, policy.memberRoles);
  if (!security.ok) throw new Error(`security ${target}: ${security.reason}`);

  // Initial copy applies to every direction so the isolated database is a
  // complete tenant backup at cutover. Continuous jobs below still honour the
  // browser direction (push-only databases do not keep flowing back out).
  const replication = await fetch(`${baseUrl}/_replicate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source,
      target,
      create_target: false,
      selector: { orgId: { $eq: orgId } },
    }),
  });
  await expectStatus(replication, [200, 201, 202], `replicate ${source} -> ${target}`);
  const result = await replication.json().catch(() => ({}));

  // Persist both directions so API writes to the server-only aggregate reach
  // browsers and offline browser writes return to the aggregate after restart.
  const idBase = `${source.replace(/^tamamhealth_/, '')}--${orgId}`;
  const jobs = [];
  if (!PUSH_ONLY_DATABASES.has(source)) {
    jobs.push({ _id: `tamamhealth-out--${idBase}`, source, target });
  }
  if (!PULL_ONLY_DATABASES.has(source)) {
    jobs.push({ _id: `tamamhealth-in--${idBase}`, source: target, target: source });
  }
  for (const job of jobs) {
    const path = `${baseUrl}/_replicator/${encodeURIComponent(job._id)}`;
    const existing = await fetch(path, { headers });
    const existingBody = existing.status === 200 ? await existing.json() : null;
    if (existing.status !== 200 && existing.status !== 404) {
      await expectStatus(existing, [200, 404], `read replication ${job._id}`);
    }
    const put = await fetch(path, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        ...job,
        ...(existingBody?._rev ? { _rev: existingBody._rev } : {}),
        continuous: true,
        create_target: false,
        selector: { orgId: { $eq: orgId } },
      }),
    });
    await expectStatus(put, [201, 202], `persist replication ${job._id}`);
  }
  console.log(`[ok] ${source} -> ${target} docs_written=${result.docs_written ?? 'unknown'}`);
}

for (const orgId of orgIds) {
  for (const source of ORG_SCOPED_DATABASES) {
    await migrateOne(orgId, source);
  }
}


if (finalizeSharedAccess && !dryRun) {
  // Cutover gate: browsers must no longer be members of aggregate databases.
  // The server and `_replicator` jobs continue using CouchDB admin context.
  for (const source of ORG_SCOPED_DATABASES) {
    const result = await applySecurity(baseUrl, authHeader, source, []);
    if (!result.ok) throw new Error(`revoke shared access ${source}: ${result.reason}`);
  }
  console.log('Shared org-scoped databases are now admin-only.');
} else if (!dryRun) {
  console.log('Shared database membership was retained. Verify counts, then rerun with FINALIZE_SHARED_ACCESS=true.');
}

console.log(
  dryRun
    ? 'Dry run complete. No databases were changed.'
    : `Migration complete. Shared source databases were ${finalizeSharedAccess ? 'retained as admin-only' : 'retained with existing membership'}.`,
);
