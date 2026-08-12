/**
 * sync-worker smoke tests.
 *
 * Run with:  node --test index.test.mjs
 *
 * These tests are intentionally narrow — they cover the pieces of the worker
 * that are easy to break silently (HMAC framing, env validation, state-file
 * round-trip, _changes shape adaptation). The main loop is exercised via the
 * docker-compose integration path, not here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

import {
  buildSignedHeaders,
  readEnv,
  loadState,
  saveState,
  saveHeartbeat,
  pollDatabase,
  recoverStateFromPlatform,
  FALLBACK_DBS,
} from './index.mjs';

test('buildSignedHeaders signs timestamp, nonce, method, path, and body', () => {
  const secret = 'x'.repeat(32);
  const body = JSON.stringify({ db: 'tamamhealth_patients', changes: [] });
  const headers = buildSignedHeaders({ secret, method: 'POST', url: 'https://app.example.org/api/sync', body });
  assert.match(headers['x-tamamhealth-signature'], /^sha256=[0-9a-f]{64}$/);
  assert.match(headers['x-tamamhealth-timestamp'], /^\d{10}$/);
  assert.match(headers['x-tamamhealth-nonce'], /^[0-9a-f-]{36}$/);
  const canonical = [
    headers['x-tamamhealth-timestamp'],
    headers['x-tamamhealth-nonce'],
    'POST',
    '/api/sync',
    body,
  ].join('\n');
  const expected = 'sha256=' + createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  assert.equal(headers['x-tamamhealth-signature'], expected);
});

test('readEnv reports every missing required var', () => {
  const saved = {
    COUCHDB_URL: process.env.COUCHDB_URL,
    COUCHDB_WEBHOOK_SECRET: process.env.COUCHDB_WEBHOOK_SECRET,
    PLATFORM_SYNC_URL: process.env.PLATFORM_SYNC_URL,
  };
  delete process.env.COUCHDB_URL;
  delete process.env.COUCHDB_WEBHOOK_SECRET;
  delete process.env.PLATFORM_SYNC_URL;
  try {
    const { errors } = readEnv();
    assert.ok(errors.some((e) => e.includes('COUCHDB_URL')));
    assert.ok(errors.some((e) => e.includes('COUCHDB_WEBHOOK_SECRET')));
    assert.ok(errors.some((e) => e.includes('PLATFORM_SYNC_URL')));
  } finally {
    if (saved.COUCHDB_URL !== undefined) process.env.COUCHDB_URL = saved.COUCHDB_URL;
    if (saved.COUCHDB_WEBHOOK_SECRET !== undefined) process.env.COUCHDB_WEBHOOK_SECRET = saved.COUCHDB_WEBHOOK_SECRET;
    if (saved.PLATFORM_SYNC_URL !== undefined) process.env.PLATFORM_SYNC_URL = saved.PLATFORM_SYNC_URL;
  }
});

test('readEnv rejects short secrets', () => {
  const saved = process.env.COUCHDB_WEBHOOK_SECRET;
  process.env.COUCHDB_URL = 'http://couchdb:5984';
  process.env.COUCHDB_WEBHOOK_SECRET = 'too-short';
  process.env.PLATFORM_SYNC_URL = 'http://platform:3000/api/sync';
  try {
    const { errors } = readEnv();
    assert.ok(errors.some((e) => e.includes('>=32 chars')));
  } finally {
    if (saved === undefined) delete process.env.COUCHDB_WEBHOOK_SECRET;
    else process.env.COUCHDB_WEBHOOK_SECRET = saved;
  }
});

test('readEnv requires HTTPS for an external platform webhook when requested', () => {
  const saved = process.env.REQUIRE_HTTPS;
  process.env.COUCHDB_URL = 'http://couchdb:5984';
  process.env.COUCHDB_WEBHOOK_SECRET = 'x'.repeat(32);
  process.env.PLATFORM_SYNC_URL = 'http://platform:3000/api/sync';
  process.env.REQUIRE_HTTPS = 'true';
  try {
    const { errors } = readEnv();
    assert.ok(errors.some((e) => e.includes('must use https://')));
  } finally {
    if (saved === undefined) delete process.env.REQUIRE_HTTPS;
    else process.env.REQUIRE_HTTPS = saved;
  }
});

test('readEnv rejects a partially configured CouchDB credential pair', () => {
  const savedUser = process.env.COUCHDB_USER;
  const savedPassword = process.env.COUCHDB_PASSWORD;
  process.env.COUCHDB_URL = 'http://couchdb:5984';
  process.env.COUCHDB_WEBHOOK_SECRET = 'x'.repeat(32);
  process.env.PLATFORM_SYNC_URL = 'https://app.example.org/api/sync';
  process.env.COUCHDB_USER = 'worker';
  delete process.env.COUCHDB_PASSWORD;
  try {
    const { errors } = readEnv();
    assert.ok(errors.some((e) => e.includes('must either both be set')));
  } finally {
    if (savedUser === undefined) delete process.env.COUCHDB_USER;
    else process.env.COUCHDB_USER = savedUser;
    if (savedPassword === undefined) delete process.env.COUCHDB_PASSWORD;
    else process.env.COUCHDB_PASSWORD = savedPassword;
  }
});

test('saveState/loadState round-trips JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-state-'));
  try {
    const path = join(dir, 'state.json');
    const initial = await loadState(path);
    assert.deepEqual(initial, {});
    const wanted = { tamamhealth_patients: { seq: '42-abc', lastUpdated: '2026-05-09T00:00:00.000Z' } };
    await saveState(path, wanted);
    const reread = await loadState(path);
    assert.deepEqual(reread, wanted);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('saveHeartbeat writes a current service status atomically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-heartbeat-'));
  try {
    const path = join(dir, 'heartbeat.json');
    await saveHeartbeat(path, { status: 'ok', totalErrors: 0 });
    const parsed = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8')));
    assert.equal(parsed.status, 'ok');
    assert.equal(parsed.totalErrors, 0);
    assert.ok(Number.isFinite(Date.parse(parsed.timestamp)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FALLBACK_DBS includes patients and audit_log', () => {
  assert.ok(FALLBACK_DBS.includes('tamamhealth_patients'));
  assert.ok(FALLBACK_DBS.includes('tamamhealth_audit_log'));
});

test('pollDatabase advances seq and POSTs an HMAC signed body', async (t) => {
  const realFetch = globalThis.fetch;
  let postedBody = null;
  let postedHeaders = null;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/_changes')) {
      return new Response(JSON.stringify({
        last_seq: '7-deadbeef',
        pending: 0,
        results: [
          { seq: '5-aaa', id: 'p:1', doc: { _id: 'p:1', name: 'A' }, changes: [{ rev: '1-x' }] },
          { seq: '7-deadbeef', id: 'p:2', doc: { _id: 'p:2', name: 'B' }, changes: [{ rev: '1-y' }] },
        ],
      }), { status: 200 });
    }
    if (u.endsWith('/api/sync')) {
      postedBody = opts.body;
      postedHeaders = opts.headers;
      return new Response(JSON.stringify({ ok: true, processed: 2, errors: 0, lastSeq: '7-deadbeef' }), { status: 200 });
    }
    return new Response('not mocked', { status: 500 });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const env = {
    COUCHDB_URL: 'http://couchdb:5984',
    COUCHDB_WEBHOOK_SECRET: 'x'.repeat(32),
    PLATFORM_SYNC_URL: 'http://platform:3000/api/sync',
    BATCH_SIZE: 100,
  };
  const state = {};
  const r = await pollDatabase({ env, state, db: 'tamamhealth_patients' });
  assert.equal(r.processed, 2);
  assert.equal(r.advancedTo, '7-deadbeef');
  assert.equal(state.tamamhealth_patients.seq, '7-deadbeef');

  // Verify the replay-resistant HMAC matches what /api/sync expects.
  const canonical = [
    postedHeaders['x-tamamhealth-timestamp'],
    postedHeaders['x-tamamhealth-nonce'],
    'POST',
    '/api/sync',
    postedBody,
  ].join('\n');
  const expected = 'sha256=' + createHmac('sha256', env.COUCHDB_WEBHOOK_SECRET).update(canonical, 'utf8').digest('hex');
  assert.equal(postedHeaders['x-tamamhealth-signature'], expected);
});

// ---------------------------------------------------------------------------
// State recovery from the platform (KAN-55 / MED-06)
//
// Losing the state file makes all ~46 databases replay from seq=0, re-posting
// every historical patient record and prescription through /api/sync. These
// cases cover recovering the checkpoints the platform already holds in the
// sync_metadata Postgres table.
// ---------------------------------------------------------------------------

test('recoverStateFromPlatform maps sync_metadata rows to worker state', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    databases: [
      { db_name: 'tamamhealth_patients', last_seq: '412-abc', last_synced_at: '2026-07-27T00:00:00Z' },
      { db_name: 'tamamhealth_lab_results', last_seq: '77-def', last_synced_at: '2026-07-27T00:00:00Z' },
    ],
  }), { status: 200 });
  t.after(() => { globalThis.fetch = realFetch; });

  const state = await recoverStateFromPlatform('http://platform:3000/api/sync', 'x'.repeat(32));
  assert.deepEqual(state, {
    tamamhealth_patients: { seq: '412-abc' },
    tamamhealth_lab_results: { seq: '77-def' },
  });
});

test('recoverStateFromPlatform keeps CouchDB seqs opaque strings', async (t) => {
  // CouchDB 3 seqs look like "42-g1AAAABXeJzLYWBg...". Coercing to a number
  // would silently truncate to 42 and replay everything after it.
  const realFetch = globalThis.fetch;
  const opaque = '42-g1AAAABXeJzLYWBgYMpgTmHgzcvPy09JdcjLz8gvLskBCjMlMiTJ';
  globalThis.fetch = async () => new Response(JSON.stringify({
    databases: [{ db_name: 'tamamhealth_patients', last_seq: opaque }],
  }), { status: 200 });
  t.after(() => { globalThis.fetch = realFetch; });

  const state = await recoverStateFromPlatform('http://platform:3000/api/sync', 'x'.repeat(32));
  assert.equal(state.tamamhealth_patients.seq, opaque);
});

test('recoverStateFromPlatform returns null when Postgres is unconfigured (503)', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'not configured' }), { status: 503 });
  t.after(() => { globalThis.fetch = realFetch; });

  assert.equal(await recoverStateFromPlatform('http://platform:3000/api/sync', 'x'.repeat(32)), null);
});

test('recoverStateFromPlatform returns null when the platform is unreachable', async (t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  t.after(() => { globalThis.fetch = realFetch; });

  assert.equal(await recoverStateFromPlatform('http://platform:3000/api/sync', 'x'.repeat(32)), null);
});

test('recoverStateFromPlatform ignores rows still at seq 0', async (t) => {
  // A database registered but never synced carries no useful checkpoint;
  // returning it would be indistinguishable from a real seq and mask the
  // full-replay warning.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    databases: [{ db_name: 'tamamhealth_patients', last_seq: '0' }],
  }), { status: 200 });
  t.after(() => { globalThis.fetch = realFetch; });

  assert.equal(await recoverStateFromPlatform('http://platform:3000/api/sync', 'x'.repeat(32)), null);
});

test('replaying the identical batch twice posts identical payloads (idempotency contract)', async (t) => {
  // /api/sync upserts on document id, so a replay must be a no-op. This asserts
  // the worker's half of that contract: the same changes feed produces a
  // byte-identical signed body, so a duplicate delivery is genuinely duplicate
  // and the route's ON CONFLICT DO UPDATE lands on the same rows.
  const realFetch = globalThis.fetch;
  const posted = [];
  const changesResponse = () => new Response(JSON.stringify({
    last_seq: '9-zzz',
    pending: 0,
    results: [
      { seq: '9-zzz', id: 'pat-1', doc: { _id: 'pat-1', type: 'patient', firstName: 'Achol' }, changes: [{ rev: '2-b' }] },
    ],
  }), { status: 200 });

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/_changes')) return changesResponse();
    if (u.endsWith('/api/sync')) {
      posted.push(opts.body);
      return new Response(JSON.stringify({ ok: true, processed: 1, errors: 0, lastSeq: '9-zzz' }), { status: 200 });
    }
    return new Response('not mocked', { status: 500 });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const env = {
    COUCHDB_URL: 'http://couchdb:5984',
    COUCHDB_WEBHOOK_SECRET: 'x'.repeat(32),
    PLATFORM_SYNC_URL: 'http://platform:3000/api/sync',
    BATCH_SIZE: 100,
  };

  // First delivery, then a state-file loss (state reset to {}) and a replay.
  const first = {};
  await pollDatabase({ env, state: first, db: 'tamamhealth_patients' });
  const afterLoss = {};
  await pollDatabase({ env, state: afterLoss, db: 'tamamhealth_patients' });

  assert.equal(posted.length, 2);
  assert.equal(posted[0], posted[1], 'replayed batch must be byte-identical');
  // Compare the checkpoint only — `lastUpdated` is a wall-clock stamp and will
  // differ between the two runs by design.
  assert.equal(
    first.tamamhealth_patients.seq,
    afterLoss.tamamhealth_patients.seq,
    'resulting state must converge to the same seq',
  );
});
