/**
 * @jest-environment node
 *
 * M7 / L7 — a session is a family of tokens, and the family has an end.
 *
 * Before: revocation was keyed by the exact token string and /api/auth/me
 * re-minted any token older than 6 h with no ceiling, so a stolen token
 * outlived logout (the thief held an older or newer string) and renewed
 * forever. Now every token carries `sid` (copied across renewals) and `sat`
 * (original sign-in time); logout revokes the sid; renewal stops at the
 * absolute ceiling; the verifier pins HS256 and the claims it relies on.
 */
// No JWT_SECRET assignment here: imports are hoisted above it, so auth-token
// would load one secret and a test signing later would use another. The helper
// below resolves whatever auth-token resolved at load.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SignJWT } from 'jose';
import { resolveJwtSecret } from '@/modules/identity/core/jwt-secret';

const getUserById = jest.fn();
jest.mock('@/modules/identity/services/user-service', () => ({ getUserById }));
jest.mock('@/lib/services/tenant-control-service', () => ({
  isOrgAccessAllowed: jest.fn(async () => true),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn(async () => ({ allowed: true, resetAt: 0, remaining: 10 })),
}));

import { NextRequest } from 'next/server';
import { createToken, verifyToken } from '@/modules/identity/core/auth-token';
import { SESSION_ABSOLUTE_MAX_SEC, SESSION_RENEW_AFTER_SEC, SESSION_TTL_SEC } from '@/modules/identity/core/session';
import { getAuthPayload } from '@/modules/identity/core/api-auth';
import {
  isTokenRevoked, revokeUserSessions, _resetTokenBlacklistForTest,
} from '@/modules/identity/core/token-blacklist';
import { GET as authMe } from '@/app/api/auth/me/route';
import { POST as authLogout } from '@/app/api/auth/logout/route';
import { POST as logoutAll } from '@/app/api/auth/logout-all/route';

const USER = { _id: 'user-nurse.jane', username: 'nurse.jane', role: 'nurse', name: 'Jane Poni', hospitalId: 'hosp-001' };
const DAY = 24 * 60 * 60;

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}
function req(url: string, token?: string, init: { method?: string } = {}): NextRequest {
  return new NextRequest(url, {
    method: init.method ?? 'GET',
    headers: token ? { cookie: `tamamhealth-token=${token}` } : {},
  });
}
function cookieFrom(res: Response, name: string): string | undefined {
  const m = (res.headers.get('set-cookie') || '').match(new RegExp(`${name}=([^;]*)`));
  return m ? m[1] : undefined;
}
/** Only Date is faked, so jose's `new Date()` and the file store both follow it. */
function setNow(sec: number) {
  jest.useFakeTimers({
    now: sec * 1000,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'hrtime'],
  });
}

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tamam-family-'));
  process.env.TOKEN_BLACKLIST_FILE = path.join(tmpDir, '.token-blacklist.json');
  _resetTokenBlacklistForTest();
  getUserById.mockReset();
  getUserById.mockResolvedValue({ ...USER, type: 'user', isActive: true });
});
afterEach(async () => {
  jest.useRealTimers();
  _resetTokenBlacklistForTest();
  delete process.env.TOKEN_BLACKLIST_FILE;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('session id and renewal', () => {
  it('mints a sid and sat at sign-in, different per sign-in', async () => {
    const a = claims(await createToken(USER));
    const b = claims(await createToken(USER));
    expect(typeof a.sid).toBe('string');
    expect(typeof a.sat).toBe('number');
    expect(a.sid).not.toBe(b.sid);
  });

  it('carries sid and sat unchanged across a renewal', async () => {
    const start = Math.floor(Date.now() / 1000);
    setNow(start);
    const original = await createToken(USER);
    setNow(start + SESSION_RENEW_AFTER_SEC + 60);
    const res = await authMe(req('http://localhost/api/auth/me', original));
    const renewed = cookieFrom(res, 'tamamhealth-token');
    expect(renewed).toBeTruthy();
    expect(renewed).not.toBe(original);
    expect(claims(renewed!).sid).toBe(claims(original).sid);
    expect(claims(renewed!).sat).toBe(claims(original).sat);
  });

  it('stops renewing at the absolute ceiling and refuses the token after it', async () => {
    const start = Math.floor(Date.now() / 1000);
    setNow(start);
    const original = await createToken(USER);
    // Pretend the sign-in happened long ago but the last renewal is recent.
    setNow(start + SESSION_ABSOLUTE_MAX_SEC - SESSION_RENEW_AFTER_SEC - 120);
    const stale = await createToken({ ...USER, sid: claims(original).sid as string, sessionStart: start });
    setNow(start + SESSION_ABSOLUTE_MAX_SEC - 60);
    const near = await authMe(req('http://localhost/api/auth/me', stale));
    const last = cookieFrom(near, 'tamamhealth-token');
    // Renewed, but only up to the ceiling, not a full TTL beyond it.
    expect(last).toBeTruthy();
    expect(claims(last!).exp as number).toBeLessThanOrEqual(start + SESSION_ABSOLUTE_MAX_SEC + 1);

    setNow(start + SESSION_ABSOLUTE_MAX_SEC + 10);
    expect(await verifyToken(last!)).toBeNull();
    const after = await authMe(req('http://localhost/api/auth/me', stale));
    expect(after.status).toBe(401);
  });

  it('a pre-sid token still works and renews once into a session with an id', async () => {
    const secret = new TextEncoder().encode(resolveJwtSecret());
    const legacy = await new SignJWT({ sub: USER._id, username: USER.username, role: USER.role, name: USER.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - SESSION_RENEW_AFTER_SEC - 60)
      .setIssuer('tamamhealth').setAudience('tamamhealth-web')
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(secret);
    expect(await verifyToken(legacy)).not.toBeNull();
    const res = await authMe(req('http://localhost/api/auth/me', legacy));
    expect(res.status).toBe(200);
    const renewed = cookieFrom(res, 'tamamhealth-token');
    expect(renewed).toBeTruthy();
    expect(typeof claims(renewed!).sid).toBe('string');
    expect(typeof claims(renewed!).sat).toBe('number');
  });
});

describe('logout revokes the whole family', () => {
  it('an older token of the same session dies with the renewed one', async () => {
    const start = Math.floor(Date.now() / 1000);
    setNow(start);
    const stolen = await createToken(USER); // thief copied this string
    setNow(start + SESSION_RENEW_AFTER_SEC + 60);
    const res = await authMe(req('http://localhost/api/auth/me', stolen));
    const renewed = cookieFrom(res, 'tamamhealth-token')!;

    // The user logs out with the renewed token. The stolen string differs.
    await authLogout(req('http://localhost/api/auth/logout', renewed, { method: 'POST' }));

    expect(await isTokenRevoked(renewed)).toBe(true);
    expect(await isTokenRevoked(stolen)).toBe(true);
    expect(await getAuthPayload(req('http://localhost/api/x', stolen))).toBeNull();
    expect((await authMe(req('http://localhost/api/auth/me', stolen))).status).toBe(401);
  });

  it('does not touch another sign-in of the same user', async () => {
    const a = await createToken(USER);
    const b = await createToken(USER);
    await authLogout(req('http://localhost/api/auth/logout', a, { method: 'POST' }));
    expect(await isTokenRevoked(a)).toBe(true);
    expect(await isTokenRevoked(b)).toBe(false);
  });
});

describe('sign out everywhere', () => {
  it('kills every earlier token for the user and none issued later', async () => {
    const start = Math.floor(Date.now() / 1000);
    setNow(start);
    const phone = await createToken(USER);
    const laptop = await createToken(USER);
    const other = await createToken({ ...USER, _id: 'user-other', username: 'other' });
    setNow(start + 5);
    const res = await logoutAll(req('http://localhost/api/auth/logout-all', laptop, { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(await isTokenRevoked(phone)).toBe(true);
    expect(await isTokenRevoked(laptop)).toBe(true);
    expect(await isTokenRevoked(other)).toBe(false);
    setNow(start + 10);
    const fresh = await createToken(USER);
    expect(await isTokenRevoked(fresh)).toBe(false);
  });

  it('requires a session', async () => {
    const res = await logoutAll(req('http://localhost/api/auth/logout-all', undefined, { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  it('revokeUserSessions ignores an empty id', async () => {
    await expect(revokeUserSessions('')).resolves.toBeUndefined();
  });
});

describe('L7 — pinned algorithm and required claims', () => {
  const secret = () => new TextEncoder().encode(resolveJwtSecret());
  const base = () => ({ sub: 'u1', username: 'u', role: 'nurse', name: 'U' });

  it('accepts a well-formed HS256 token', async () => {
    const t = await new SignJWT(base()).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setIssuer('tamamhealth').setAudience('tamamhealth-web').setExpirationTime('1h').sign(secret());
    expect(await verifyToken(t)).not.toBeNull();
  });

  it('rejects a token signed with another HMAC algorithm', async () => {
    const t = await new SignJWT(base()).setProtectedHeader({ alg: 'HS512' }).setIssuedAt()
      .setIssuer('tamamhealth').setAudience('tamamhealth-web').setExpirationTime('1h').sign(secret());
    expect(await verifyToken(t)).toBeNull();
  });

  it('rejects a token with no iat', async () => {
    const t = await new SignJWT(base()).setProtectedHeader({ alg: 'HS256' })
      .setIssuer('tamamhealth').setAudience('tamamhealth-web').setExpirationTime('1h').sign(secret());
    expect(await verifyToken(t)).toBeNull();
  });

  it('rejects a token with no expiry', async () => {
    const t = await new SignJWT(base()).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setIssuer('tamamhealth').setAudience('tamamhealth-web').sign(secret());
    expect(await verifyToken(t)).toBeNull();
  });

  it('rejects a token with no subject', async () => {
    const { sub: _sub, ...noSub } = base();
    void _sub;
    const t = await new SignJWT(noSub).setProtectedHeader({ alg: 'HS256' }).setIssuedAt()
      .setIssuer('tamamhealth').setAudience('tamamhealth-web').setExpirationTime('1h').sign(secret());
    expect(await verifyToken(t)).toBeNull();
  });

  it('rejects the unsigned dev-fallback token unless explicitly enabled', async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
    const now = Math.floor(Date.now() / 1000);
    const forged = `${b64({ alg: 'none' })}.${b64({
      sub: 'x', username: 'x', role: 'super_admin', name: 'X',
      iss: 'tamamhealth', aud: 'tamamhealth-web', iat: now, exp: now + 600,
    })}.dev-fallback`;
    delete process.env.ALLOW_INSECURE_DEV_TOKENS;
    expect(await verifyToken(forged)).toBeNull();
  });
});

describe('constants', () => {
  it('ceiling is 30 days by default and longer than one TTL', () => {
    expect(SESSION_ABSOLUTE_MAX_SEC).toBe(30 * DAY);
    expect(SESSION_ABSOLUTE_MAX_SEC).toBeGreaterThan(SESSION_TTL_SEC);
  });
});
