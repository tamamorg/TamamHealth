/**
 * @jest-environment node
 *
 * The analytics sync-worker's database list must track the platform's.
 *
 * The worker image copies only package.json and index.mjs, so in a container
 * it can never read the platform source and always polls its built-in
 * FALLBACK_DBS. That list had silently drifted from DB_TABLE_MAP (a database
 * the platform maps was never polled). This test is the only thing that keeps
 * the two honest.
 *
 * Superset is the requirement (a mapped DB that is not polled never reaches
 * national analytics). Equality is asserted as well: a polled DB the platform
 * does not map is answered with HTTP 400 by /api/sync, so the worker would
 * retry it forever.
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.join(process.cwd(), '..');
const ROUTE = path.join(process.cwd(), 'src/modules/analytics/api/sync-route.ts');
const ADAPTER = path.join(process.cwd(), 'src/app/api/sync/route.ts');
const WORKER = path.join(REPO, 'sync-worker/index.mjs');

function platformKeys(): string[] {
  const src = fs.readFileSync(ROUTE, 'utf8');
  const block = src.match(/const\s+DB_TABLE_MAP\b[^=]*=\s*{([\s\S]*?)\n};/);
  if (!block) throw new Error('DB_TABLE_MAP declaration not found in sync-route.ts');
  return [...new Set([...block[1].matchAll(/^\s*(tamamhealth_[A-Za-z0-9_]+)\s*:/gm)].map(m => m[1]))];
}

function workerKeys(): string[] {
  const src = fs.readFileSync(WORKER, 'utf8');
  const block = src.match(/FALLBACK_DBS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
  if (!block) throw new Error('FALLBACK_DBS not found in sync-worker/index.mjs');
  return [...block[1].matchAll(/^\s*'(tamamhealth_[A-Za-z0-9_]+)'/gm)].map(m => m[1]);
}

describe('sync-worker database list', () => {
  it('parses a plausible number of keys from both files', () => {
    expect(platformKeys().length).toBeGreaterThan(30);
    expect(workerKeys().length).toBeGreaterThan(30);
  });

  it("is a superset of the platform's DB_TABLE_MAP keys", () => {
    const worker = new Set(workerKeys());
    const missing = platformKeys().filter(k => !worker.has(k));
    expect(missing).toEqual([]);
  });

  it('does not poll databases the platform would reject with 400', () => {
    const platform = new Set(platformKeys());
    const extra = workerKeys().filter(k => !platform.has(k));
    expect(extra).toEqual([]);
  });

  it('has no duplicate entries', () => {
    const keys = workerKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('autodiscovery points at the real route file, not the two-line re-export', () => {
    // The adapter has no DB_TABLE_MAP; pointing the worker at it finds nothing
    // and falls back silently, which is how the drift went unnoticed.
    expect(fs.readFileSync(ADAPTER, 'utf8')).not.toMatch(/DB_TABLE_MAP/);
    expect(fs.readFileSync(WORKER, 'utf8')).toContain('modules/analytics/api/sync-route.ts');
  });
});
