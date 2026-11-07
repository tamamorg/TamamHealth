/**
 * @jest-environment node
 *
 * M6 — a stranger must not be able to lock the real owner out of an account.
 *
 * The lockout is keyed on (username, client IP). Five bad passwords from one
 * address lock that address out of that account; the owner signing in from a
 * different address with the right password still gets in. The per-IP limit
 * is unchanged.
 */
const authenticateUser = jest.fn();
jest.mock('@/modules/identity/core/server-users', () => ({
  authenticateUser: (...args: unknown[]) => authenticateUser(...args),
  UsersDbUnavailableError: class UsersDbUnavailableError extends Error {},
}));
jest.mock('@/modules/identity/core/login-session', () => ({
  ROLES_WITHOUT_HOSPITAL: [],
  resolveEffectiveIdentity: jest.fn(async (u: { role: string }) => ({ ok: true, effective: { role: u.role } })),
  issueSessionResponse: jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/login/route';
import { _resetRateLimitForTest } from '@/lib/rate-limit';

const GOOD = 'Correct-Horse-9';
const USER = { _id: 'u1', username: 'superadmin', role: 'super_admin', name: 'S' };

function login(ip: string, password: string, username = 'superadmin'): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ username, password }),
  });
}

beforeEach(() => {
  _resetRateLimitForTest();
  authenticateUser.mockReset();
  authenticateUser.mockImplementation(async (_u: string, pw: string) => (pw === GOOD ? USER : null));
});

describe('lockout scope', () => {
  it('locks the attacker address after five bad tries', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(login('203.0.113.9', 'wrong'))).status).toBe(401);
    }
    const sixth = await POST(login('203.0.113.9', 'wrong'));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBeTruthy();
    // Even the right password from the locked address waits.
    expect((await POST(login('203.0.113.9', GOOD))).status).toBe(429);
  });

  it('lets the real owner in from another address while the attacker is locked', async () => {
    for (let i = 0; i < 6; i++) await POST(login('203.0.113.9', 'wrong'));
    const owner = await POST(login('198.51.100.20', GOOD));
    expect(owner.status).toBe(200);
  });

  it('keeps accounts apart: a lock on one username does not touch another from the same address', async () => {
    for (let i = 0; i < 6; i++) await POST(login('203.0.113.9', 'wrong', 'superadmin'));
    authenticateUser.mockImplementation(async (u: string, pw: string) => (pw === GOOD ? { ...USER, username: u } : null));
    expect((await POST(login('203.0.113.9', GOOD, 'dr.wani'))).status).toBe(200);
  });

  it('still enforces the per-IP limit across usernames', async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) {
      last = (await POST(login('203.0.113.50', 'wrong', `user${i}`))).status;
    }
    expect(last).toBe(429);
  });
});
