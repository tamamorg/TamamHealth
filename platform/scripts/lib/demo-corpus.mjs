/**
 * Shared plumbing for the demo-corpus scripts: CouchDB access with the admin
 * credentials, and the demo corpus itself.
 *
 * The corpus is produced by running the REAL seed (src/lib/db-seed.ts) into
 * in-memory PouchDB databases, so the server-side seed and the standalone
 * demo's browser seed are the same code and cannot drift into different data.
 * Nothing here talks to CouchDB while the seed runs.
 */

import { Buffer } from 'node:buffer';
import process from 'node:process';

export function resolveCouchConfig(tag) {
  const url = (process.env.COUCHDB_URL || process.env.NEXT_PUBLIC_COUCHDB_URL || 'http://localhost:5984')
    .replace(/\/$/, '');
  const user = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD;
  if (!user || !pass) {
    console.error(`[${tag}] Missing CouchDB admin credentials (COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD).`);
    process.exit(1);
  }
  const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  async function couch(path, init = {}) {
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${await res.text()}`);
    return res.json();
  }
  return { url, couch };
}

/** Refuse anything that is not a loopback CouchDB unless explicitly allowed. */
export function assertLocalStack(url, tag, allowEnv) {
  const host = new URL(url).hostname;
  const local = ['localhost', '127.0.0.1', '::1', 'couchdb'].includes(host);
  if (!local && process.env[allowEnv] !== 'true') {
    console.error(`[${tag}] ${url} is not a local CouchDB. Set ${allowEnv}=true to run against it deliberately.`);
    process.exit(1);
  }
}

/** Run the demo seed in memory and return Map<databaseName, docs[]>. */
export async function buildDemoCorpus() {
  process.env.NEXT_PUBLIC_DEMO_MODE = 'true';
  // The seed is a no-op outside demo mode; and it must take the full path
  // (the browser skips it when sync is configured), which `window` being
  // undefined guarantees.
  const dbModule = await import('../../src/lib/db.ts');
  const db = dbModule.default ?? dbModule;
  db.useInMemoryDatabases();
  const seedModule = await import('../../src/lib/db-seed.ts');
  const seed = seedModule.default ?? seedModule;
  const planModule = await import('../../src/lib/demo-corpus-plan.ts');
  const plan = planModule.default ?? planModule;

  await seed.seedDatabase();

  const corpus = new Map();
  for (const name of plan.corpusDatabases()) {
    const result = await db.getRawDB(name).allDocs({ include_docs: true });
    corpus.set(name, result.rows.map((row) => row.doc).filter(Boolean));
  }
  return { corpus, plan };
}
