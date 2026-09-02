#!/usr/bin/env node
/**
 * One-time cleanup for the offlineSync metadata feedback loop (fixed in
 * lib/sync/offline-metadata.ts + sync-service.ts, 2026-09-02).
 *
 * The loop wrote sync-status stamps as ordinary document revisions from every
 * device at once, so CouchDB accumulated sibling revisions that differ ONLY
 * in their `offlineSync` block — seed patients reached 4000+ revisions with
 * ~80 live conflict branches each, and every one of those documents renders
 * as "Pending sync" in the client forever.
 *
 * A second garbage family rides along: SEED-COLLISION branches. Every fresh
 * demo device seeds the same document ids with its own clock and pushes, so
 * each device plants a rev-1 sibling that differs from the winner only in
 * timestamp fields (createdAt/updatedAt/triagedAt/…) and the
 * `dataOrigin: 'demo_seed'` marker. Same record, different seed clock.
 *
 * This script walks every tamamhealth_* database and, for each document with
 * live `_conflicts`:
 *   1. deletes each losing revision that is IDENTICAL to the winning revision
 *      once `offlineSync`/`dataOrigin` are ignored and every remaining
 *      difference is a timestamp-shaped value on both sides (metadata-race
 *      twins and seed-clock drift — deleting either loses nothing);
 *   2. if that leaves the document conflict-free, rewrites the winner's
 *      `offlineSync.status` to `synced` so clients stop showing it as
 *      pending/conflicted;
 *   3. leaves any sibling with REAL content divergence untouched — those
 *      belong to the admin conflict queue, not a script.
 *
 * Usage:
 *   DRY_RUN=true  node scripts/cleanup-offline-metadata-conflicts.mjs   # preview (default)
 *   DRY_RUN=false node scripts/cleanup-offline-metadata-conflicts.mjs   # apply
 *
 * Env: COUCHDB_URL (default http://localhost:5984),
 *      COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD (required).
 */

const COUCH = process.env.COUCHDB_URL || 'http://localhost:5984';
const USER = process.env.COUCHDB_ADMIN_USER;
const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
const DRY_RUN = process.env.DRY_RUN !== 'false';

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

/** Doc with volatile fields removed — the shape whose equality means "same
 *  content, only sync metadata / seed markers differ". */
function stripVolatile(doc) {
  const { _rev, _revisions, _conflicts, offlineSync, dataOrigin, ...rest } = doc;
  void _rev; void _revisions; void _conflicts; void offlineSync; void dataOrigin;
  return rest;
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const stable = v => Array.isArray(v)
  ? JSON.stringify(v.map(x => JSON.parse(stable(x))))
  : v && typeof v === 'object'
    ? JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k => [k, JSON.parse(stable(v[k]))])))
    : JSON.stringify(v ?? null);

/** True when the losing revision carries no content of its own: after the
 *  volatile strip, every field it disagrees with the winner on is a
 *  timestamp-shaped string on BOTH sides (seed-clock drift). Any other
 *  difference — a value, a missing field, a changed structure — keeps it. */
function isDisposableSibling(winner, loser) {
  const w = stripVolatile(winner);
  const l = stripVolatile(loser);
  for (const key of new Set([...Object.keys(w), ...Object.keys(l)])) {
    if (stable(w[key]) === stable(l[key])) continue;
    if (typeof w[key] === 'string' && typeof l[key] === 'string'
      && TIMESTAMP_RE.test(w[key]) && TIMESTAMP_RE.test(l[key])) continue;
    return false;
  }
  return true;
}

async function cleanDb(db) {
  const enc = encodeURIComponent(db);
  const stats = { docsWithConflicts: 0, siblingsDeleted: 0, siblingsKept: 0, winnersHealed: 0 };
  let startkey;
  for (;;) {
    const qs = new URLSearchParams({ include_docs: 'true', conflicts: 'true', limit: '500' });
    if (startkey) { qs.set('startkey', JSON.stringify(startkey)); qs.set('skip', '1'); }
    const page = await couch(`/${enc}/_all_docs?${qs}`);
    if (!page.rows.length) break;
    for (const row of page.rows) {
      const doc = row.doc;
      if (!doc || doc._id.startsWith('_design/')) continue;
      const conflicts = doc._conflicts || [];
      if (!conflicts.length) continue;
      stats.docsWithConflicts++;
      const deletions = [];
      for (const rev of conflicts) {
        const losing = await couch(`/${enc}/${encodeURIComponent(doc._id)}?rev=${rev}`);
        if (isDisposableSibling(doc, losing)) deletions.push({ _id: doc._id, _rev: rev, _deleted: true });
        else stats.siblingsKept++;
      }
      if (deletions.length && !DRY_RUN) {
        const results = await couch(`/${enc}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs: deletions }) });
        const failed = results.filter(r => r.error);
        if (failed.length) console.warn(`  ${db}/${doc._id}: ${failed.length} deletions failed`, failed[0]);
      }
      stats.siblingsDeleted += deletions.length;
      // Fully de-conflicted: clear the stale conflict/pending stamp so every
      // client converges without waiting for its own heal pass.
      if (deletions.length === conflicts.length && doc.offlineSync && doc.offlineSync.status !== 'synced') {
        stats.winnersHealed++;
        if (!DRY_RUN) {
          const { _conflicts, ...winner } = doc;
          void _conflicts;
          await couch(`/${enc}/${encodeURIComponent(doc._id)}`, {
            method: 'PUT',
            body: JSON.stringify({
              ...winner,
              offlineSync: { ...winner.offlineSync, status: 'synced', lastSyncedAt: new Date().toISOString(), error: undefined },
            }),
          });
        }
      }
    }
    startkey = page.rows[page.rows.length - 1].key;
    if (page.rows.length < 500) break;
  }
  return stats;
}

const all = await couch('/_all_dbs');
const targets = all.filter(name => name.startsWith('tamamhealth_'));
console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Scanning ${targets.length} databases on ${COUCH}…`);

const totals = { docsWithConflicts: 0, siblingsDeleted: 0, siblingsKept: 0, winnersHealed: 0 };
for (const db of targets) {
  try {
    const s = await cleanDb(db);
    if (s.docsWithConflicts) {
      console.log(`${db}: ${s.docsWithConflicts} conflicted docs — delete ${s.siblingsDeleted} metadata siblings, keep ${s.siblingsKept} real divergences, heal ${s.winnersHealed} winners`);
      for (const k of Object.keys(totals)) totals[k] += s[k];
    }
  } catch (err) {
    console.error(`${db}: FAILED — ${err.message}`);
  }
}
console.log(`\n${DRY_RUN ? '[DRY RUN] would ' : ''}delete ${totals.siblingsDeleted} pure-metadata sibling revisions across ${totals.docsWithConflicts} docs; keep ${totals.siblingsKept} with real divergence; heal ${totals.winnersHealed} winners.`);
if (DRY_RUN) console.log('Re-run with DRY_RUN=false to apply.');
