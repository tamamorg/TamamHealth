/**
 * Tests for the persisted token revocation store in lib/token-blacklist.ts.
 *
 * Each test points the store at a fresh tmp file via the
 * TOKEN_BLACKLIST_FILE env var, then resets the in-memory cache between
 * cases so the store reloads from disk.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  revokeToken,
  isTokenRevoked,
  _resetTokenBlacklistForTest,
  _flushTokenBlacklistForTest,
} from '@/modules/identity/core/token-blacklist';

let tokenCounter = 0;

/**
 * Build a JWT-shaped string with a payload claiming a specific `exp`. Each
 * call gets a unique `jti` so two tokens with the same expiry are still
 * distinct strings.
 */
function buildToken(expSec: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: 'user-x', exp: expSec, jti: `t-${++tokenCounter}` }),
  ).toString('base64url');
  return `${header}.${payload}.signature-not-checked-at-this-layer`;
}

describe('token-blacklist (persisted)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tamam-blacklist-'));
    process.env.TOKEN_BLACKLIST_FILE = path.join(tmpDir, '.token-blacklist.json');
    _resetTokenBlacklistForTest();
  });

  afterEach(async () => {
    _resetTokenBlacklistForTest();
    delete process.env.TOKEN_BLACKLIST_FILE;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('a fresh token is not revoked', async () => {
    const t = buildToken(Math.floor(Date.now() / 1000) + 3600);
    await expect(isTokenRevoked(t)).resolves.toBe(false);
  });

  it('after revoke, the same token reads as revoked', async () => {
    const t = buildToken(Math.floor(Date.now() / 1000) + 3600);
    await revokeToken(t);
    await expect(isTokenRevoked(t)).resolves.toBe(true);
  });

  it('revoking does not blacklist a different token', async () => {
    const t1 = buildToken(Math.floor(Date.now() / 1000) + 3600);
    const t2 = buildToken(Math.floor(Date.now() / 1000) + 3600);
    await revokeToken(t1);
    await expect(isTokenRevoked(t2)).resolves.toBe(false);
  });

  it('a revocation persists across an in-process restart (file-backed)', async () => {
    const t = buildToken(Math.floor(Date.now() / 1000) + 3600);
    await revokeToken(t);
    await _flushTokenBlacklistForTest();

    // Simulate the process restarting: clear the in-memory cache. The next
    // isTokenRevoked() call must reload from disk and still see the entry.
    _resetTokenBlacklistForTest();

    await expect(isTokenRevoked(t)).resolves.toBe(true);
  });

  it('an entry whose exp is past now is not considered revoked (lazy eviction)', async () => {
    const expired = buildToken(Math.floor(Date.now() / 1000) - 60);
    await revokeToken(expired);
    await expect(isTokenRevoked(expired)).resolves.toBe(false);
  });

  it('expired entries do not leak across a process restart', async () => {
    const expired = buildToken(Math.floor(Date.now() / 1000) - 60);
    await revokeToken(expired);
    await _flushTokenBlacklistForTest();
    _resetTokenBlacklistForTest();
    await expect(isTokenRevoked(expired)).resolves.toBe(false);
  });

  it('the store does not flush itself on size growth (the old MAX_SIZE bug)', async () => {
    // Add 5,000 distinct revoked tokens. A previous in-memory implementation
    // hit a MAX_SIZE cap and called Set.clear() — a denial-of-revocation: an
    // attacker could log in enough times to flush the blacklist, replaying
    // any previously-revoked token. Make sure that class of bug is gone.
    const expSec = Math.floor(Date.now() / 1000) + 3600;
    const tokens: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const t = buildToken(expSec);
      tokens.push(t);
      await revokeToken(t);
    }
    // Spot-check the first, middle, and last — each must still be revoked.
    await expect(isTokenRevoked(tokens[0])).resolves.toBe(true);
    await expect(isTokenRevoked(tokens[2500])).resolves.toBe(true);
    await expect(isTokenRevoked(tokens[4999])).resolves.toBe(true);
  });

  it('isTokenRevoked is safe on an empty token', async () => {
    await expect(isTokenRevoked('')).resolves.toBe(false);
  });

  it('revokeToken is safe on an empty token (no-op)', async () => {
    await revokeToken('');
    await expect(isTokenRevoked('')).resolves.toBe(false);
  });

  it('a malformed JWT still gets a fallback expiry, not an immediate eviction', async () => {
    // A malformed JWT must still be tracked as revoked with a bounded
    // fallback expiry — otherwise crafting a malformed token would bypass
    // revocation entirely.
    const garbage = 'not.a.real.jwt';
    await revokeToken(garbage);
    await expect(isTokenRevoked(garbage)).resolves.toBe(true);
  });
});

/**
 * Shared-store (Upstash) backend.
 *
 * The file-backed store is per-instance: a logout recorded on replica A was
 * invisible to replica B, so the revoked token kept working there until its
 * `exp` passed. These cases pin the shared-store behaviour that fixes it.
 */
describe('token-blacklist (shared Upstash backend)', () => {
  const ORIGINAL_ENV = { ...process.env };
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    process.env.TOKEN_BLACKLIST_FILE = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'tbl-shared-')),
      'blacklist.json',
    );
    _resetTokenBlacklistForTest();
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  const upstashOk = (results: Array<{ result?: unknown }>) => ({
    ok: true,
    status: 200,
    json: async () => results,
  });

  it('revokeToken writes to the shared store, and never stores the raw JWT', async () => {
    fetchMock.mockResolvedValue(upstashOk([{ result: 'OK' }]));
    const token = buildToken(Math.floor(Date.now() / 1000) + 3600);

    await revokeToken(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const [cmd, key, value, ex] = body[0];
    expect(cmd).toBe('SET');
    // A revoked JWT stays cryptographically valid until exp — storing it raw
    // would turn the revocation list into a store of usable session tokens.
    expect(key).not.toContain(token);
    expect(key).toMatch(/^revoked:[a-f0-9]{16}$/);
    expect(value).toBe('1');
    // TTL tracks the JWT's own expiry, so Redis evicts it exactly on time.
    expect(ex).toBe('EX');
    expect(body[0][4]).toBeGreaterThan(0);
    expect(body[0][4]).toBeLessThanOrEqual(3600);
  });

  it('honours a revocation recorded by ANOTHER replica', async () => {
    // Nothing was revoked locally — the hit comes only from the shared store.
    fetchMock.mockResolvedValue(upstashOk([{ result: '1' }]));
    const token = buildToken(Math.floor(Date.now() / 1000) + 3600);

    await expect(isTokenRevoked(token)).resolves.toBe(true);
  });

  it('returns false when the shared store has no entry and neither does disk', async () => {
    fetchMock.mockResolvedValue(upstashOk([{ result: null }]));
    await expect(isTokenRevoked(buildToken(Math.floor(Date.now() / 1000) + 3600)))
      .resolves.toBe(false);
  });

  it('falls back to the local store when Upstash is down, rather than reporting "not revoked"', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const token = buildToken(Math.floor(Date.now() / 1000) + 3600);

    // Revocation succeeds against the shared store...
    fetchMock.mockResolvedValue(upstashOk([{ result: 'OK' }]));
    await revokeToken(token);
    await _flushTokenBlacklistForTest();

    // ...then Upstash goes down. Answering "not revoked" because the network
    // hiccuped would hand a live session back to a logged-out token.
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(isTokenRevoked(token)).resolves.toBe(true);

    errSpy.mockRestore();
  });

  it('still records locally when the shared write fails', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const token = buildToken(Math.floor(Date.now() / 1000) + 3600);

    fetchMock.mockRejectedValue(new Error('upstash unreachable'));
    await revokeToken(token);
    await _flushTokenBlacklistForTest();

    // This replica is protected even though the shared write failed.
    await expect(isTokenRevoked(token)).resolves.toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
