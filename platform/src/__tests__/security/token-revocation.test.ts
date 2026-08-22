/**
 * @jest-environment node
 *
 * JWT revocation enforcement — the gap this file closes.
 *
 * `lib/token-blacklist.ts` (persistence + Upstash shared store) already has
 * dedicated coverage in `token-blacklist.test.ts`. What was untested is the
 * two call sites documented in `lib/api-auth.ts` and `proxy.ts` as the
 * ENFORCEMENT points — the Edge proxy explicitly does not check revocation
 * (it can't; the store uses `node:fs`), so a revoked-but-unexpired token is
 * only actually stopped by:
 *
 *   1. `getAuthPayload()`      — every /api/* route.
 *   2. `GET /api/auth/me`      — the client's app-load bootstrap.
 *
 * These tests use the REAL `token-blacklist` store (file-backed, pointed at a
 * tmp file) and the REAL route handlers, so a regression in the wiring
 * between "logout revokes" and "the next request is rejected" would actually
 * fail here — not just a mocked assertion that a function was called.
 */
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test'; // 40 chars

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// user-service and tenant-control-service are mocked (as in
// session-lifetime.test.ts) so these tests exercise the revocation gate
// specifically, without needing a live PouchDB user store. token-blacklist
// itself is deliberately left UNMOCKED.
const getUserById = jest.fn();
jest.mock('@/modules/identity/services/user-service', () => ({ getUserById }));
jest.mock('@/lib/services/tenant-control-service', () => ({
  isOrgAccessAllowed: jest.fn(async () => true),
}));

import { NextRequest } from 'next/server';
import { createToken } from '@/modules/identity/core/auth-token';
import { getAuthPayload } from '@/modules/identity/core/api-auth';
import {
  isTokenRevoked,
  revokeToken,
  _resetTokenBlacklistForTest,
} from '@/modules/identity/core/token-blacklist';
import { GET as authMe } from '@/app/api/auth/me/route';
import { POST as authLogout } from '@/app/api/auth/logout/route';

const BASE_USER = {
  _id: 'user-nurse.jane',
  username: 'nurse.jane',
  role: 'nurse',
  name: 'Jane Poni',
  hospitalId: 'hosp-001',
};

function reqWithCookie(cookie: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/me', { headers: { cookie } });
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tamam-revocation-'));
  process.env.TOKEN_BLACKLIST_FILE = path.join(tmpDir, '.token-blacklist.json');
  _resetTokenBlacklistForTest();
  getUserById.mockReset();
  getUserById.mockResolvedValue({ ...BASE_USER, type: 'user', isActive: true });
});

afterEach(async () => {
  _resetTokenBlacklistForTest();
  delete process.env.TOKEN_BLACKLIST_FILE;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('getAuthPayload — revocation gate', () => {
  it('accepts a token that was never revoked', async () => {
    const token = await createToken(BASE_USER);
    const req = { cookies: { get: () => ({ value: token }) } } as unknown as NextRequest;
    const auth = await getAuthPayload(req);
    expect(auth?.username).toBe('nurse.jane');
  });

  it('rejects a token once it has been revoked, WITHOUT consulting the live user record', async () => {
    const token = await createToken(BASE_USER);
    await revokeToken(token);

    const req = { cookies: { get: () => ({ value: token }) } } as unknown as NextRequest;
    const auth = await getAuthPayload(req);

    expect(auth).toBeNull();
    // The revocation check runs before the user-service lookup — a revoked
    // token must not even reach the (potentially slow) live-hydration path.
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('a token accepted on one request is rejected on the very next one after logout revokes it', async () => {
    const token = await createToken(BASE_USER);
    const req = () => ({ cookies: { get: () => ({ value: token }) } } as unknown as NextRequest);

    expect(await getAuthPayload(req())).not.toBeNull();

    await revokeToken(token);

    expect(await getAuthPayload(req())).toBeNull();
  });

  it('revoking one session token does not affect a different session', async () => {
    const tokenA = await createToken(BASE_USER);
    const tokenB = await createToken({ ...BASE_USER, _id: 'user-dr.wani', username: 'dr.wani' });
    await revokeToken(tokenA);

    const reqA = { cookies: { get: () => ({ value: tokenA }) } } as unknown as NextRequest;
    const reqB = { cookies: { get: () => ({ value: tokenB }) } } as unknown as NextRequest;

    expect(await getAuthPayload(reqA)).toBeNull();
    expect(await getAuthPayload(reqB)).not.toBeNull();
  });
});

describe('GET /api/auth/me — revocation gate', () => {
  it('rejects a revoked token with 401 + user:null, before touching the live user record', async () => {
    const token = await createToken(BASE_USER);
    await revokeToken(token);

    const res = await authMe(reqWithCookie(`tamamhealth-token=${token}`));

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ user: null });
    // /api/auth/me is exempt from the page-middleware auth gate, so this
    // explicit check is the ONLY thing standing between a revoked token and
    // hydrating a "logged in" client session — see the route's own comment.
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('accepts a live (non-revoked) token and hydrates the user from the live record', async () => {
    const token = await createToken(BASE_USER);

    const res = await authMe(reqWithCookie(`tamamhealth-token=${token}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe('nurse.jane');
    expect(body.user.role).toBe('nurse');
  });

  it('returns 401 for a request with no session cookie at all', async () => {
    const res = await authMe(reqWithCookie(''));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ user: null });
  });
});

describe('POST /api/auth/logout → GET /api/auth/me — end to end', () => {
  it('logout revokes the token in the real store', async () => {
    const token = await createToken(BASE_USER);
    expect(await isTokenRevoked(token)).toBe(false);

    const logoutReq = new NextRequest('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `tamamhealth-token=${token}` },
    });
    const logoutRes = await authLogout(logoutReq);

    expect(logoutRes.status).toBe(200);
    expect(await isTokenRevoked(token)).toBe(true);
  });

  it('a session cookie captured before logout can no longer authenticate afterwards', async () => {
    const token = await createToken(BASE_USER);

    // The session is valid before logout...
    const before = await authMe(reqWithCookie(`tamamhealth-token=${token}`));
    expect(before.status).toBe(200);

    // ...the user logs out on this device (or a browser tab replays a
    // stolen cookie captured before that logout)...
    await authLogout(new NextRequest('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `tamamhealth-token=${token}` },
    }));

    // ...and the SAME still-unexpired JWT is now refused everywhere.
    const after = await authMe(reqWithCookie(`tamamhealth-token=${token}`));
    expect(after.status).toBe(401);
    await expect(after.json()).resolves.toEqual({ user: null });

    const apiReq = { cookies: { get: () => ({ value: token }) } } as unknown as NextRequest;
    expect(await getAuthPayload(apiReq)).toBeNull();
  });

  it('logout on an already-missing token is a harmless no-op (no crash, still clears cookies)', async () => {
    const res = await authLogout(new NextRequest('http://localhost/api/auth/logout', { method: 'POST' }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });
});
