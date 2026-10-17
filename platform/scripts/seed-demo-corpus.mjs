#!/usr/bin/env node
/**
 * Write the demo corpus to CouchDB ONCE, from the server.
 *
 * Why this exists: with sync on, every fresh browser used to seed the demo
 * data itself. Each device wrote its own rev 1 of the same document ids (own
 * clock), so the server collected a conflicting sibling per device, the
 * pharmacy queue grew with every new profile, and an amend-only role (the
 * pharmacist clearing a prescription) built a rev 2 on a parent the server
 * had never seen. CouchDB validates such a push as a CREATE and refuses it:
 * "role pharmacist may not write documents of type prescription".
 *
 * Browsers on a sync-enabled stack now skip seeding (db-seed.ts
 * `seedComesFromServer`) and receive these documents by replication, so every
 * copy shares one revision lineage. The standalone demo, which has no
 * CouchDB, is unaffected and still seeds in the browser.
 *
 * What it does: runs the real seed (src/lib/db-seed.ts) into in-memory
 * PouchDB, then creates, in each replicating database, only the documents the
 * server does not already have. Idempotent: a document the server holds in
 * ANY state (edited, conflicted, even deleted) is never touched, so a re-run
 * writes nothing. Accounts are not seeded here: the server bootstraps its own
 * (src/modules/identity/core/server-users.ts) and credentials are its concern.
 *
 * Writes go to the aggregate databases; on a tenant-database stack the
 * `_replicator` jobs carry them into the per-organisation databases.
 *
 * Usage (from platform/):
 *   npm run db:seed:demo-corpus                  # write what is missing
 *   DRY_RUN=true npm run db:seed:demo-corpus     # report only
 *
 * Env: COUCHDB_URL (default http://localhost:5984), COUCHDB_ADMIN_USER,
 *      COUCHDB_ADMIN_PASSWORD. Non-loopback servers need
 *      ALLOW_REMOTE_DEMO_SEED=true.
 */

import process from 'node:process';
import { assertLocalStack, buildDemoCorpus, resolveCouchConfig } from './lib/demo-corpus.mjs';

const TAG = 'seed-demo-corpus';
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH = 500;

async function main() {
  const { url, couch } = resolveCouchConfig(TAG);
  assertLocalStack(url, TAG, 'ALLOW_REMOTE_DEMO_SEED');
  console.log(`[${TAG}] ${DRY_RUN ? 'DRY RUN against' : 'writing to'} ${url}`);

  const { corpus, plan } = await buildDemoCorpus();
  let created = 0;
  let existing = 0;
  let failed = 0;

  for (const [name, docs] of corpus) {
    if (docs.length === 0) continue;
    // Includes deleted documents: a clinician's deletion must not be undone.
    const changes = await couch(`/${name}/_changes?since=0&style=main_only`);
    const known = new Set((changes?.results ?? []).map((row) => row.id));
    const missing = plan.planMissingDocs(docs, known);
    existing += docs.length - missing.length;
    console.log(`[${TAG}] ${name}: ${docs.length} in corpus, ${docs.length - missing.length} already on server, ${missing.length} to create`);
    if (DRY_RUN || missing.length === 0) { created += DRY_RUN ? 0 : missing.length; continue; }
    if (changes === null) {
      await couch(`/${name}`, { method: 'PUT' });
    }
    for (let i = 0; i < missing.length; i += BATCH) {
      const result = await couch(`/${name}/_bulk_docs`, {
        method: 'POST',
        body: JSON.stringify({ docs: missing.slice(i, i + BATCH) }),
      });
      for (const row of result) {
        if (row.error) {
          failed++;
          if (failed <= 20) console.warn(`[${TAG}]   ${name}/${row.id}: ${row.error} (${row.reason})`);
        } else created++;
      }
    }
  }

  console.log(`[${TAG}] ${DRY_RUN ? 'would create' : 'created'}: ${DRY_RUN ? '(see per-database lines)' : created}; already present: ${existing}; refused: ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
