/**
 * @jest-environment node
 *
 * "Keep me signed in" (login/page.tsx's checkbox) was state-only: the value
 * lived in a `useState` and was never sent with the login request, so every
 * session got the platform's usual 30-day persistent cookie regardless of
 * what the checkbox said.
 *
 * The fix threads a `keepSignedIn` choice from the login form, through the
 * login route, into `issueSessionResponse`, as a `persist` claim on the JWT
 * itself (so /api/auth/me's sliding renewal can preserve it — see
 * session-lifetime.test.ts for the constants this shares) and finally into
 * `applySessionCookies`, which sets NO Max-Age at all when `persist` is
 * false — a real browser-session cookie, not merely a short-lived one. The
 * JWT's own `exp` is unaffected either way: SESSION_TTL_SEC governs how long
 * the TOKEN is valid; `persist` governs only whether the COOKIE carrying it
 * survives the browser closing.
 */
export {};

import { SESSION_TTL_SEC, applySessionCookies } from '@/modules/identity/core/session';
import { CSRF_COOKIE_NAME } from '@/modules/identity/core/csrf';
import { createToken, verifyToken } from '@/modules/identity/core/auth-token';

const SESSION_COOKIE_NAME = 'tamamhealth-token';

const BASE_USER = {
  _id: 'user-nurse.jane',
  username: 'nurse.jane',
  role: 'nurse',
  name: 'Jane Poni',
  hospitalId: 'hosp-001',
};

describe('applySessionCookies persist flag', () => {
  test('defaults to persistent — no 5th argument means the full-TTL cookie, unchanged', () => {
    const set = jest.fn();
    applySessionCookies({ set }, 'jwt-value', 'csrf-value');
    expect(set).toHaveBeenCalledWith(SESSION_COOKIE_NAME, 'jwt-value', expect.objectContaining({ maxAge: SESSION_TTL_SEC }));
    expect(set).toHaveBeenCalledWith(CSRF_COOKIE_NAME, 'csrf-value', expect.objectContaining({ maxAge: SESSION_TTL_SEC }));
  });

  test('persist: true is the same as the default', () => {
    const set = jest.fn();
    applySessionCookies({ set }, 'jwt-value', 'csrf-value', true);
    expect(set).toHaveBeenCalledWith(SESSION_COOKIE_NAME, 'jwt-value', expect.objectContaining({ maxAge: SESSION_TTL_SEC }));
  });

  test('persist: false sets NO Max-Age at all on either cookie — a real browser-session cookie', () => {
    const set = jest.fn();
    applySessionCookies({ set }, 'jwt-value', 'csrf-value', false);
    const [, , sessionOpts] = set.mock.calls.find(call => call[0] === SESSION_COOKIE_NAME)!;
    const [, , csrfOpts] = set.mock.calls.find(call => call[0] === CSRF_COOKIE_NAME)!;
    expect(sessionOpts).not.toHaveProperty('maxAge');
    expect(csrfOpts).not.toHaveProperty('maxAge');
    // Every other attribute (httpOnly, sameSite, secure, path) is unaffected —
    // only the lifetime changes, not the cookie's other protections.
    expect(sessionOpts).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/' });
  });

  test('a non-persistent cookie still carries the full-TTL JWT — only the COOKIE is session-scoped', async () => {
    const token = await createToken({ ...BASE_USER, persist: false });
    const payload = await verifyToken(token);
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { exp: number };
    expect(exp - payload!.iat!).toBe(SESSION_TTL_SEC);
  });
});

describe('the persist claim on the token itself', () => {
  test('createToken carries persist:false through to the verified payload', async () => {
    const token = await createToken({ ...BASE_USER, persist: false });
    const payload = await verifyToken(token);
    expect(payload!.persist).toBe(false);
  });

  test('createToken defaults to persist:true when the caller does not pass it', async () => {
    // Every caller that predates this claim (password reset, MFA completion,
    // the patient portal) must keep minting a persistent session exactly as
    // before — this is what makes that safe.
    const token = await createToken(BASE_USER);
    const payload = await verifyToken(token);
    expect(payload!.persist).toBe(true);
  });

  test('an explicit persist:true round-trips the same as the default', async () => {
    const token = await createToken({ ...BASE_USER, persist: true });
    const payload = await verifyToken(token);
    expect(payload!.persist).toBe(true);
  });
});
