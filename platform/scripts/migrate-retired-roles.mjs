#!/usr/bin/env node
/**
 * One-time conversion of accounts still holding a retired role.
 *
 * Signing in already converts an account (server-users.ts), so this exists for
 * the people who have not signed in since their role retired. Nothing can drop
 * a role from `UserRole` while a stored account or an organization's staff
 * roster still names it.
 *
 * Only the two places that decide what someone may do are touched: `role` on a
 * user document and `enabledRoles` on an organization. Clinical records, audit
 * rows and announcements keep the role written at the time; they are history,
 * and announcements are matched canonically when read.
 *
 * Usage:
 *   DRY_RUN=true  node --import tsx scripts/migrate-retired-roles.mjs   # preview (default)
 *   DRY_RUN=false node --import tsx scripts/migrate-retired-roles.mjs   # apply
 *
 * Env: COUCHDB_URL (default http://localhost:5984),
 *      COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD (required).
 */

import { pathToFileURL } from 'node:url';

/** Convert one document in place. Returns the `old -> new` moves it made. */
export function migrateRoleDocument(doc, canonicalize) {
  const moves = [];
  if (typeof doc.role === 'string') {
    const next = canonicalize(doc.role);
    if (next !== doc.role) {
      moves.push(`${doc.role} -> ${next}`);
      doc.role = next;
    }
  }
  if (Array.isArray(doc.enabledRoles)) {
    const next = [...new Set(doc.enabledRoles.map(canonicalize))];
    if (next.join() !== doc.enabledRoles.join()) {
      moves.push('enabledRoles');
      doc.enabledRoles = next;
    }
  }
  return moves;
}

async function main() {
  const COUCH = (process.env.COUCHDB_URL || 'http://localhost:5984').replace(/\/$/, '');
  const USER = process.env.COUCHDB_ADMIN_USER;
  const PASS = process.env.COUCHDB_ADMIN_PASSWORD;
  const DRY_RUN = process.env.DRY_RUN !== 'false';
  if (!USER || !PASS) throw new Error('Set COUCHDB_ADMIN_USER and COUCHDB_ADMIN_PASSWORD.');

  // tsx hands a TypeScript module over as named exports or as `default`,
  // depending on how it was compiled; take whichever carries the functions.
  const loaded = await import('../src/lib/user-role.ts');
  const { canonicalizeUserRole } = loaded.canonicalizeUserRole ? loaded : loaded.default;

  const auth = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  const couch = async (path, init = {}) => {
    const res = await fetch(`${COUCH}${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${await res.text()}`);
    return res.json();
  };

  const counts = new Map();
  let written = 0;
  let refused = 0;

  // A document the app saves while this runs is refused as a conflict: re-read
  // its newest revision and convert that, so the count is only what landed.
  const writeWithRetry = async (db, docs) => {
    let pending = docs;
    for (let attempt = 0; attempt < 3 && pending.length; attempt += 1) {
      const results = await couch(`/${db}/_bulk_docs`, { method: 'POST', body: JSON.stringify({ docs: pending }) });
      const failed = results.filter(r => r.error);
      written += results.length - failed.length;
      const retry = [];
      for (const { id } of failed.filter(r => r.error === 'conflict')) {
        const fresh = await couch(`/${db}/${encodeURIComponent(id)}`);
        if (migrateRoleDocument(fresh, canonicalizeUserRole).length) retry.push(fresh);
      }
      refused += failed.length - failed.filter(r => r.error === 'conflict').length;
      pending = retry;
    }
    refused += pending.length;
  };

  for (const db of ['tamamhealth_users', 'tamamhealth_organizations']) {
    let startkey = null;
    for (;;) {
      const qs = `include_docs=true&limit=500${startkey ? `&startkey=${encodeURIComponent(JSON.stringify(startkey))}&skip=1` : ''}`;
      const page = await couch(`/${db}/_all_docs?${qs}`);
      if (!page.rows.length) break;
      const updates = [];
      for (const { doc } of page.rows) {
        if (!doc || doc._id.startsWith('_design/')) continue;
        const moves = migrateRoleDocument(doc, canonicalizeUserRole);
        if (!moves.length) continue;
        for (const move of moves) counts.set(`${db}: ${move}`, (counts.get(`${db}: ${move}`) || 0) + 1);
        doc.updatedAt = new Date().toISOString();
        updates.push(doc);
      }
      if (updates.length && !DRY_RUN) await writeWithRetry(db, updates);
      startkey = page.rows[page.rows.length - 1].id;
      if (page.rows.length < 500) break;
    }
  }

  for (const [move, count] of [...counts].sort()) console.log(`${count}\t${move}`);
  if (!counts.size) console.log('No document holds a retired role.');
  if (DRY_RUN) console.log('Dry run: nothing was written. Set DRY_RUN=false to apply.');
  else console.log(`Converted ${written} document(s).${refused ? ` ${refused} still refused: re-run to retry them.` : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(err => { console.error(err.message || err); process.exit(1); });
}
