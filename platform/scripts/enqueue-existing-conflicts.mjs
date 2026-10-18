#!/usr/bin/env node
/**
 * Put conflicts that already exist on CouchDB into the admin conflict queue.
 *
 * The queue (Admin → Conflicts) is fed only when a device PULLS a changed
 * document that carries `_conflicts` (surfaceHighRiskConflicts in
 * sync-service.ts). A conflict that formed before that detection existed, or
 * on a document nobody has edited since, therefore never reaches the queue:
 * the front desk's Pending sync list shows it as "Conflicting edits" and the
 * admin page shows nothing to resolve.
 *
 * This walks the aggregate tamamhealth_* databases (the per-org copies hold
 * the same documents; the tenant replicator mirrors the queue rows) and, for
 * every document of a HIGH-RISK type with live `_conflicts`, writes the same
 * queue row the app would (deterministic id, so re-runs and later device
 * detections land on the same row).
 *
 * It never modifies or deletes a record. Lower-risk and retained types
 * (messages, conversations) are reported and left alone: retained records
 * keep their branches by design, and none of them appear in Pending sync.
 *
 * Usage (from platform/):
 *   COUCHDB_URL=… COUCHDB_ADMIN_USER=… COUCHDB_ADMIN_PASSWORD=… \
 *     npx tsx scripts/enqueue-existing-conflicts.mjs              # dry run (default)
 *   DRY_RUN=false … npx tsx scripts/enqueue-existing-conflicts.mjs # write queue rows
 */
import process from 'node:process';
import conflictServiceModule from '../src/lib/services/conflict-service.ts';

const { HIGH_RISK_RESOURCES, conflictQueueId, riskFor } = conflictServiceModule;

const COUCH = (process.env.COUCHDB_URL || 'http://localhost:5984').replace(/\/$/, '');
const USER = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
const PASS = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
const DRY_RUN = process.env.DRY_RUN !== 'false';
const QUEUE_DB = 'tamamhealth_conflict_queue';

if (!USER || !PASS) {
  console.error('COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD are required.');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

async function couch(path, init = {}) {
  const res = await fetch(`${COUCH}${path}`, {
    ...init,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

const all = (await couch('/_all_dbs')).body;
if (!Array.isArray(all)) {
  console.error('Could not list databases:', all);
  process.exit(1);
}
// Aggregate databases only: `<name>--org-…` copies hold the same documents.
const targets = all.filter(name => name.startsWith('tamamhealth_') && !name.includes('--') && name !== QUEUE_DB);
console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Scanning ${targets.length} databases on ${COUCH}…`);

const totals = { queued: 0, alreadyQueued: 0, skippedLowRisk: 0, failed: 0 };
for (const db of targets) {
  const enc = encodeURIComponent(db);
  let startkey;
  for (;;) {
    const qs = new URLSearchParams({ include_docs: 'true', conflicts: 'true', limit: '500' });
    if (startkey) { qs.set('startkey', JSON.stringify(startkey)); qs.set('skip', '1'); }
    const page = (await couch(`/${enc}/_all_docs?${qs}`)).body;
    if (!page.rows?.length) break;
    for (const row of page.rows) {
      const doc = row.doc;
      if (!doc || doc._id.startsWith('_design/') || !doc._conflicts?.length) continue;
      const type = doc.type || '(no type)';
      if (!HIGH_RISK_RESOURCES.has(type)) {
        totals.skippedLowRisk++;
        console.log(`  leave ${db}/${doc._id} (${type}, ${doc._conflicts.length} branch(es)) — not a queued type`);
        continue;
      }
      const now = new Date().toISOString();
      const queueDoc = {
        _id: conflictQueueId(type, doc._id, doc._rev),
        type: 'conflict_queue',
        resourceType: type,
        resourceId: doc._id,
        risk: riskFor(type),
        winningRev: doc._rev,
        losingRevs: doc._conflicts,
        status: 'pending',
        orgId: doc.orgId,
        countryId: doc.countryId,
        createdAt: now,
        updatedAt: now,
      };
      if (DRY_RUN) {
        totals.queued++;
        console.log(`  queue ${db}/${doc._id} (${type}, ${doc._conflicts.length} competing version(s), org ${doc.orgId || '—'})`);
        continue;
      }
      const res = await couch(`/${QUEUE_DB}/${encodeURIComponent(queueDoc._id)}`, { method: 'PUT', body: JSON.stringify(queueDoc) });
      if (res.status === 201 || res.status === 202) { totals.queued++; console.log(`  queued ${doc._id} (${type})`); }
      else if (res.status === 409) totals.alreadyQueued++;
      else { totals.failed++; console.warn(`  FAILED ${doc._id}: ${res.status} ${JSON.stringify(res.body)}`); }
    }
    startkey = page.rows[page.rows.length - 1].key;
    if (page.rows.length < 500) break;
  }
}

console.log(`\n${DRY_RUN ? '[DRY RUN] would queue' : 'queued'} ${totals.queued}; already queued ${totals.alreadyQueued}; left alone (not queued types) ${totals.skippedLowRisk}; failed ${totals.failed}.`);
if (DRY_RUN) console.log('Re-run with DRY_RUN=false to write the queue rows.');
