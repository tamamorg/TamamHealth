#!/usr/bin/env node
/**
 * Remove demo seed documents the current seed no longer produces.
 *
 * Before the seed became deterministic (src/data/mock.ts keyed PRNG) and
 * server-side (scripts/seed-demo-corpus.mjs), every fresh browser planted a
 * slightly different id set (e.g. rx-<patient>-<visit>-<k> prescriptions), so
 * shared stacks accumulated documents no seed run will ever recreate.
 *
 * A document is removed only when it carries `dataOrigin: 'demo_seed'` AND its
 * id is absent from the corpus the current seed builds. Documents the seed
 * still produces are kept whatever their revision or conflicts; real records
 * never carry the marker; organisations, facilities and platform config are
 * not touched. Every leaf revision of a removed document is deleted, so a
 * conflicting sibling cannot resurface.
 *
 * DRY RUN BY DEFAULT. Pass DRY_RUN=false to delete.
 *
 * Usage (from platform/):
 *   npm run db:cleanup:stale-demo-seed                 # report
 *   DRY_RUN=false npm run db:cleanup:stale-demo-seed   # delete
 *   DATABASES=tamamhealth_prescriptions ...            # limit (comma list)
 *
 * Covers the aggregate databases and any per-organisation tenant databases.
 * Env: as seed-demo-corpus.mjs (ALLOW_REMOTE_DEMO_SEED=true for non-loopback).
 */

import process from 'node:process';
import { assertLocalStack, buildDemoCorpus, resolveCouchConfig } from './lib/demo-corpus.mjs';
import planModule from '../src/lib/demo-corpus-plan.ts';
import tenantModule from '../src/lib/sync/tenant-database.ts';

const { CLEANUP_EXCLUDED_DATABASES } = planModule;
const { parseTenantDatabaseName } = tenantModule;

const TAG = 'cleanup-stale-demo-seed';
const DRY_RUN = process.env.DRY_RUN !== 'false';
const ONLY = (process.env.DATABASES || '').split(',').map((s) => s.trim()).filter(Boolean);
const BATCH = 500;

async function main() {
  const { url, couch } = resolveCouchConfig(TAG);
  assertLocalStack(url, TAG, 'ALLOW_REMOTE_DEMO_SEED');
  console.log(`[${TAG}] ${DRY_RUN ? 'DRY RUN (set DRY_RUN=false to delete)' : 'DELETING'} on ${url}`);

  const { corpus, plan } = await buildDemoCorpus();
  const corpusIds = new Map([...corpus].map(([name, docs]) => [name, new Set(docs.map((d) => d._id))]));
  const allDbs = (await couch('/_all_dbs')) ?? [];
  let total = 0;

  for (const dbName of allDbs) {
    const tenant = parseTenantDatabaseName(dbName);
    const base = tenant ? tenant.baseName : dbName;
    if (!corpusIds.has(base) || CLEANUP_EXCLUDED_DATABASES.includes(base)) continue;
    if (ONLY.length && !ONLY.includes(base)) continue;

    const rows = (await couch(`/${dbName}/_all_docs?include_docs=true&conflicts=true`))?.rows ?? [];
    const docs = rows.map((r) => r.doc).filter(Boolean);
    const stale = new Set(plan.planStaleDocs(docs, corpusIds.get(base)));
    if (stale.size === 0) continue;

    const tombstones = [];
    const sample = [];
    for (const doc of docs) {
      if (!stale.has(doc._id)) continue;
      if (sample.length < 3) sample.push(doc._id);
      for (const rev of [doc._rev, ...(doc._conflicts ?? [])]) {
        tombstones.push({ _id: doc._id, _rev: rev, _deleted: true });
      }
    }
    total += stale.size;
    console.log(`[${TAG}] ${dbName}: ${stale.size} stale document(s), ${tombstones.length} revision(s) (e.g. ${sample.join(', ')})`);
    if (DRY_RUN) continue;
    for (let i = 0; i < tombstones.length; i += BATCH) {
      const result = await couch(`/${dbName}/_bulk_docs`, {
        method: 'POST',
        body: JSON.stringify({ docs: tombstones.slice(i, i + BATCH) }),
      });
      for (const row of result) if (row.error) console.warn(`[${TAG}]   ${dbName}/${row.id}: ${row.error} (${row.reason})`);
    }
  }
  console.log(`[${TAG}] ${DRY_RUN ? 'would remove' : 'removed'} ${total} document(s)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
