/**
 * @jest-environment node
 *
 * Session lifetime policy (lib/session.ts + lib/auth-token.ts + the
 * password-epoch check in getAuthPayload).
 *
 * The browser "remembers" a login because the JWT and its cookies share a
 * long TTL and /api/auth/me silently re-mints aging tokens. That is only safe
 * because a token minted before the account's latest password change is
 * rejected on its next request — these tests pin both halves of that deal.
 */

export {};

jest.mock('@/lib/token-blacklist', () => ({
  isTokenRevoked: jest.fn(async () => false),
  revokeToken: jest.fn(async () => undefined),
}));

const getUserById = jest.fn();
jest.mock('@/lib/services/user-service', () => ({ getUserById }));

// api-auth's tenant kill-switch import — tokens below carry no orgId, so this
// must never be reached; mocking it makes an accidental reach loud.
jest.mock('@/lib/services/tenant-control-service', () => ({
  isOrgAccessAllowed: jest.fn(async () => { throw new Error('unexpected tenant check'); }),
}));

import type { NextRequest } from 'next/server';
import { SESSION_TTL_SEC, SESSION_RENEW_AFTER_SEC, applySessionCookies, SESSION_COOKIE_NAME } from '@/lib/session';
import { CSRF_COOKIE_NAME } from '@/lib/csrf';
import { createToken, verifyToken, pwdAtClaim } from '@/lib/auth-token';
import { getAuthPayload } from '@/lib/api-auth';
import { generateTempPassword, TEMP_PASSWORD_LENGTH } from '@/lib/temp-password';

const BASE_USER = {
  _id: 'user-nurse.jane',
  username: 'nurse.jane',
  role: 'nurse',
  name: 'Jane Poni',
  hospitalId: 'hosp-001',
};

function requestWithToken(token: string): NextRequest {
  return {
    cookies: { get: (name: string) => (name === SESSION_COOKIE_NAME ? { value: token } : undefined) },
  } as unknown as NextRequest;
}

beforeEach(() => {
  getUserById.mockReset();
});

describe('session policy constants', () => {
  test('default TTL is 30 days and cookies/JWT share it', () => {
    expect(SESSION_TTL_SEC).toBe(30 * 24 * 60 * 60);
  });

  test('renewal threshold never exceeds half the TTL', () => {
    expect(SESSION_RENEW_AFTER_SEC).toBeLessThanOrEqual(SESSION_TTL_SEC / 2);
    expect(SESSION_RENEW_AFTER_SEC).toBeGreaterThan(0);
  });

  test('applySessionCookies sets the session cookie and its CSRF twin for the full TTL', () => {
    const set = jest.fn();
    applySessionCookies({ set }, 'jwt-value', 'csrf-value');
    expect(set).toHaveBeenCalledWith(SESSION_COOKIE_NAME, 'jwt-value', expect.objectContaining({
      httpOnly: true, sameSite: 'strict', maxAge: SESSION_TTL_SEC, path: '/',
    }));
    expect(set).toHaveBeenCalledWith(CSRF_COOKIE_NAME, 'csrf-value', expect.objectContaining({
      httpOnly: false, sameSite: 'strict', maxAge: SESSION_TTL_SEC, path: '/',
    }));
  });

  test('applySessionCookies without a CSRF token touches only the session cookie', () => {
    const set = jest.fn();
    applySessionCookies({ set }, 'jwt-value');
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe('JWT claims for long-lived sessions', () => {
  test('token carries iat, pwdAt, and a TTL-length expiry', async () => {
    const changedAt = '2026-08-01T10:00:00.000Z';
    const token = await createToken({ ...BASE_USER, passwordUpdatedAt: changedAt });
    const payload = await verifyToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.pwdAt).toBe(Math.floor(Date.parse(changedAt) / 1000));
    expect(typeof payload!.iat).toBe('number');
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { exp: number };
    expect(exp - payload!.iat!).toBe(SESSION_TTL_SEC);
  });

  test('pwdAtClaim tolerates absent and malformed timestamps', () => {
    expect(pwdAtClaim(undefined)).toBeUndefined();
    expect(pwdAtClaim('not-a-date')).toBeUndefined();
    expect(pwdAtClaim('2026-08-01T10:00:00.000Z')).toBe(1785578400);
  });
});

describe('password-epoch revocation (getAuthPayload)', () => {
  test('token minted before the latest password change is rejected', async () => {
    const token = await createToken({ ...BASE_USER, passwordUpdatedAt: '2026-08-01T10:00:00.000Z' });
    getUserById.mockResolvedValue({
      ...BASE_USER, type: 'user', isActive: true,
      passwordUpdatedAt: '2026-08-10T10:00:00.000Z', // changed AFTER the token was minted
    });
    expect(await getAuthPayload(requestWithToken(token))).toBeNull();
  });

  test('legacy token with no pwdAt claim is rejected once the account has a password epoch', async () => {
    const token = await createToken(BASE_USER); // no passwordUpdatedAt → no pwdAt claim
    getUserById.mockResolvedValue({
      ...BASE_USER, type: 'user', isActive: true,
      passwordUpdatedAt: '2026-08-10T10:00:00.000Z',
    });
    expect(await getAuthPayload(requestWithToken(token))).toBeNull();
  });

  test('token matching the current password epoch is accepted', async () => {
    const changedAt = '2026-08-10T10:00:00.000Z';
    const token = await createToken({ ...BASE_USER, passwordUpdatedAt: changedAt });
    getUserById.mockResolvedValue({
      ...BASE_USER, type: 'user', isActive: true, passwordUpdatedAt: changedAt,
    });
    const auth = await getAuthPayload(requestWithToken(token));
    expect(auth).not.toBeNull();
    expect(auth!.username).toBe('nurse.jane');
  });

  test('account predating the epoch field keeps working', async () => {
    const token = await createToken(BASE_USER);
    getUserById.mockResolvedValue({ ...BASE_USER, type: 'user', isActive: true });
    expect(await getAuthPayload(requestWithToken(token))).not.toBeNull();
  });
});

describe('temporary password generator', () => {
  test('generates readable CSPRNG passwords of the documented length', () => {
    const pw = generateTempPassword();
    expect(pw).toHaveLength(TEMP_PASSWORD_LENGTH);
    // No look-alike characters — safe to relay verbally or on paper.
    expect(pw).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]+$/);
    expect(generateTempPassword(20)).toHaveLength(20);
    expect(generateTempPassword()).not.toBe(generateTempPassword());
  });
});
