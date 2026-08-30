/**
 * @jest-environment node
 *
 * S3: `POST /api/auth/change-password` re-mints the session JWT (so the
 * `mustChangePassword` gate clears without a re-login) but dropped the
 * ORIGINAL sign-in's "Keep me signed in" choice while doing it — both
 * `createToken(...)` and `applySessionCookies(...)` default `persist` to
 * `true` when it isn't passed. A user who signed in with the checkbox
 * UNCHECKED (a browser-session cookie) and then changed their password —
 * including the forced first-login change every admin-issued account goes
 * through — walked away with a 30-day persistent cookie on a shared machine.
 *
 * This drives the REAL route handler (as `token-revocation.test.ts` does for
 * /api/auth/me and /api/auth/logout) with the user-service and password
 * policy mocked out, so the assertion is against the actual `Set-Cookie`
 * the route produces, not against a mocked call.
 */
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test'; // 40 chars

const getUserById = jest.fn();
const changeOwnPassword = jest.fn();
jest.mock('@/modules/identity/services/user-service', () => ({ getUserById, changeOwnPassword }));
// Real policy screening needs the platform config DB; this route's job here
// is the cookie it mints, not password strength rules, which have their own
// dedicated coverage (user-password-policy.test.ts).
jest.mock('@/modules/identity/policy/password-policy-server', () => ({
  screenPasswordForDeployment: jest.fn(async () => null),
}));
jest.mock('@/lib/services/audit-service', () => ({ logAuditSafe: jest.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { createToken } from '@/modules/identity/core/auth-token';
import { SESSION_TTL_SEC } from '@/modules/identity/core/session';
import { POST as changePassword } from '@/app/api/auth/change-password/route';

const SESSION_COOKIE_NAME = 'tamamhealth-token';

const BASE_USER = {
  _id: 'user-nurse.jane',
  username: 'nurse.jane',
  role: 'nurse',
  name: 'Jane Poni',
  hospitalId: 'hosp-001',
};

const NEW_PASSWORD = 'Bramble-Falcon-58';
const CURRENT_PASSWORD = 'Old-Meadow-Ridge-3';

function changePasswordRequest(token: string): NextRequest {
  return new NextRequest('http://localhost/api/auth/change-password', {
    method: 'POST',
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD }),
  });
}

beforeEach(() => {
  getUserById.mockReset();
  changeOwnPassword.mockReset();
  // No `passwordUpdatedAt` here — keeps getAuthPayload's password-epoch check
  // a no-op so the token minted below is accepted regardless of `iat`.
  getUserById.mockResolvedValue({ ...BASE_USER, type: 'user', isActive: true });
  changeOwnPassword.mockResolvedValue({ ...BASE_USER, passwordUpdatedAt: new Date().toISOString() });
});

describe('POST /api/auth/change-password preserves the original session persistence', () => {
  it('a session signed in WITHOUT "keep me signed in" gets a re-minted cookie with no Max-Age', async () => {
    const token = await createToken({ ...BASE_USER, persist: false });

    const res = await changePassword(changePasswordRequest(token));

    expect(res.status).toBe(200);
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    // THE REGRESSION: this used to always carry SESSION_TTL_SEC (30 days),
    // silently upgrading a browser-session cookie into a persistent one.
    expect(cookie?.maxAge).toBeUndefined();
  });

  it('a session signed in WITH "keep me signed in" keeps its persistent cookie', async () => {
    const token = await createToken({ ...BASE_USER, persist: true });

    const res = await changePassword(changePasswordRequest(token));

    expect(res.status).toBe(200);
    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.maxAge).toBe(SESSION_TTL_SEC);
  });
});
