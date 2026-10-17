#!/usr/bin/env node
/**
 * One-time scrub of plaintext message previews from conversation documents.
 *
 * Until 2026-10-17 every staff-chat send copied the first 120 characters of
 * the message onto its conversation document as `lastMessagePreview`. That
 * copy sat outside the field encryption that covers the message body and
 * replicated to every member's device. The app no longer writes it (the list
 * derives the preview from the newest message) and drops it on any later
 * write, but a conversation nobody writes to again keeps its copy — so this
 * clears them on the server, and devices pick the change up on their next pull.
 *
 * For every `tamamhealth_conversations` database (the shared one and each
 * `tamamhealth_conversations<sep><org>` tenant copy) it:
 *   1. rewrites each conversation document that still carries
 *      `lastMessagePreview`, without it;
 *   2. compacts the database, so the earlier revisions holding the text are
 *      purged from disk rather than merely superseded.
 *
 * Usage:
 *   DRY_RUN=true  node scripts/scrub-conversation-previews.mjs   # preview (default)
 *   DRY_RUN=false node scripts/scrub-conversation-previews.mjs   # apply
 *
 * Env: COUCHDB_URL (default http://localhost:5984),
 *      COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD (required).
 */

const COUCH = process.env.COUCHDB_URL || 'http://localhost:5984';
const USER = process.env.COUCHDB_ADMIN_USER;
const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
const DRY_RUN = process.env.DRY_RUN !== 'false';
const BASE = 'tamamhealth_conversations';

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
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function scrubDatabase(db) {
  const path = `/${encodeURIComponent(db)}`;
  const { rows } = await couch(`${path}/_all_docs?include_docs=true`);
  const dirty = rows
    .map(row => row.doc)
    .filter(doc => doc && doc.type === 'conversation' && Object.prototype.hasOwnProperty.call(doc, 'lastMessagePreview'));

  if (dirty.length === 0) {
    console.log(`  ${db}: clean`);
    return 0;
  }
  console.log(`  ${db}: ${dirty.length} conversation(s) carry a stored preview`);
  if (DRY_RUN) return dirty.length;

  const docs = dirty.map(doc => {
    const { lastMessagePreview, ...rest } = doc;
    void lastMessagePreview;
    return rest;
  });
  const results = await couch(`${path}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs }) });
  const failed = results.filter(r => r.error);
  for (const f of failed) console.warn(`    ! ${f.id}: ${f.error} ${f.reason || ''}`);
  // Compaction drops the bodies of non-leaf revisions — without it the old
  // revisions, text and all, stay on disk.
  await couch(`${path}/_compact`, { method: 'POST' });
  console.log(`    scrubbed ${dirty.length - failed.length}, compaction started`);
  return dirty.length - failed.length;
}

const all = await couch('/_all_dbs');
// The shared database and every tenant copy share the base-name prefix.
const dbs = all.filter(name => name.startsWith(BASE));
console.log(`${DRY_RUN ? '[dry run] ' : ''}${dbs.length} conversation database(s)`);

let total = 0;
for (const db of dbs) total += await scrubDatabase(db);
console.log(DRY_RUN
  ? `${total} conversation(s) would be scrubbed. Re-run with DRY_RUN=false to apply.`
  : `${total} conversation(s) scrubbed.`);
