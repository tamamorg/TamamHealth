/**
 * Postgres migration runner — server-only.
 *
 * Applies SQL files in `src/lib/db/migrations/` in monotonic order, recording
 * each one in a `_migrations` tracking table. Idempotent: a migration that
 * has already been applied is skipped (and its hash verified). Concurrent
 * platform instances starting at the same time cannot race because the
 * runner takes a Postgres advisory lock for the duration.
 *
 * Triggered automatically at server boot from instrumentation.ts and also
 * exposed via `npm run db:migrate` for ad-hoc operator use.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { postgresSslOptions } from './postgres-ssl';

// 64-bit signed integer, picked once and never changed. Any process that
// holds a Postgres advisory lock under this key serializes migration runs
// across the whole platform fleet. Stays under Number.MAX_SAFE_INTEGER
// so we don't need BigInt and can pass it through as a JS number.
const MIGRATION_LOCK_KEY = 8743219475634210;

const TRACKING_TABLE = '_migrations';

const MIGRATION_FILE_RE = /^(\d{4,})_[a-z0-9_]+\.sql$/;

export interface MigrationSummary {
  applied: string[];          // versions newly applied this run
  skipped: string[];          // versions already on record
  durationMs: number;
}

export interface RunMigrationsOptions {
  /** Directory containing the *.sql files. Defaults to `<this-file>/../db/migrations`. */
  migrationsDir?: string;
  /** Pre-built pool — useful for tests. If omitted, one is built from DATABASE_URL. */
  pool?: Pool;
  /** Sink for progress messages. Defaults to console. */
  logger?: (line: string) => void;
}

interface MigrationFile {
  version: string;
  name: string;
  body: string;
  hash: string;
}

function defaultMigrationsDir(): string {
  // Compiled by Next.js: __dirname will land in the `.next` build, so resolve
  // from process.cwd() instead. The conventional layout is platform/.
  return path.resolve(process.cwd(), 'src/lib/db/migrations');
}

async function loadMigrationFiles(dir: string): Promise<MigrationFile[]> {
  const entries = await fs.readdir(dir);
  const out: MigrationFile[] = [];
  for (const entry of entries.sort()) {
    const m = MIGRATION_FILE_RE.exec(entry);
    if (!m) continue;
    const body = await fs.readFile(path.join(dir, entry), 'utf8');
    out.push({
      version: m[1],
      name: entry,
      body,
      hash: crypto.createHash('sha256').update(body).digest('hex'),
    });
  }
  // Detect duplicate version prefixes — a developer renaming a migration
  // would otherwise silently shadow the prior one.
  const seen = new Set<string>();
  for (const f of out) {
    if (seen.has(f.version)) {
      throw new Error(`[migrate] duplicate migration version ${f.version} (${f.name})`);
    }
    seen.add(f.version);
  }
  return out;
}

async function ensureTrackingTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hash TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(client: PoolClient): Promise<Map<string, { name: string; hash: string }>> {
  const res = await client.query<{ version: string; name: string; hash: string }>(
    `SELECT version, name, hash FROM ${TRACKING_TABLE}`,
  );
  const map = new Map<string, { name: string; hash: string }>();
  for (const row of res.rows) map.set(row.version, { name: row.name, hash: row.hash });
  return map;
}

async function applyOne(client: PoolClient, file: MigrationFile): Promise<void> {
  await client.query('BEGIN');
  try {
    // Run the entire .sql body as a single statement. pg's simple-query
    // protocol supports multiple statements separated by semicolons.
    await client.query(file.body);
    await client.query(
      `INSERT INTO ${TRACKING_TABLE} (version, name, hash) VALUES ($1, $2, $3)`,
      [file.version, file.name, file.hash],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

/**
 * Acquire the migration advisory lock, run all pending migrations, release.
 * Throws on the first migration that fails — the failing migration is rolled
 * back, but earlier successful ones in the same run remain applied.
 */
export async function runMigrations(opts: RunMigrationsOptions = {}): Promise<MigrationSummary> {
  const t0 = Date.now();
  const log = opts.logger ?? ((line) => console.log(line));
  const dir = opts.migrationsDir ?? defaultMigrationsDir();

  const ownsPool = !opts.pool;
  const pool = opts.pool ?? buildPoolFromEnv();

  const files = await loadMigrationFiles(dir);
  if (files.length === 0) {
    log('[migrate] no migration files found — nothing to do.');
    if (ownsPool) await pool.end();
    return { applied: [], skipped: [], durationMs: Date.now() - t0 };
  }

  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await ensureTrackingTable(client);
      const onRecord = await getApplied(client);

      for (const f of files) {
        const prior = onRecord.get(f.version);
        if (prior) {
          if (prior.hash !== f.hash) {
            throw new Error(
              `[migrate] migration ${f.version} (${prior.name}) was already applied with a different hash — ` +
              `the file has been edited after deploy. Roll forward with a NEW migration instead of editing this one.`,
            );
          }
          skipped.push(f.version);
          continue;
        }
        log(`[migrate] applying ${f.name}`);
        await applyOne(client, f);
        applied.push(f.version);
      }

      if (applied.length === 0) {
        log(`[migrate] schema up to date (${skipped.length} migration(s) on record).`);
      } else {
        log(`[migrate] applied ${applied.length} migration(s); ${skipped.length} already on record.`);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
    if (ownsPool) await pool.end();
  }

  return { applied, skipped, durationMs: Date.now() - t0 };
}

function buildPoolFromEnv(): Pool {
  // Serverless traffic uses a transaction pool, but the migration advisory
  // lock is session-scoped and must use the provider's direct endpoint.
  const connectionString = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('[migrate] DATABASE_URL is not set');
  }
  return new Pool({
    connectionString,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 10000,
    ...(postgresSslOptions() ? { ssl: postgresSslOptions() } : {}),
  });
}
