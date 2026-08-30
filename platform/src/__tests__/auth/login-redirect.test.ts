/**
 * The sign-in screen's redirect guard.
 *
 * This shipped broken: `handleSubmit` leaves `loading` true on success (so the
 * button does not flash back to "Log in" while the redirect runs) and returns,
 * letting the effect navigate — but the effect was gated on `loading` alone,
 * so it could never fire. A correct password produced a live session, a
 * cookie, and a screen stuck on "Signing in…" forever. Only a hard refresh —
 * a fresh mount with `loading` false — ever reached the dashboard, which is
 * exactly how it was reported: "the login only works after I refresh again."
 */

import { canRedirectAfterSignIn, resolveNextPath, type SignInRedirectState } from '@/lib/navigation/login-redirect';

const base: SignInRedirectState = {
  loading: false,
  signedIn: false,
  switching: false,
  isAuthenticated: false,
  hasUser: false,
};

const live = { ...base, isAuthenticated: true, hasUser: true };

describe('canRedirectAfterSignIn', () => {
  test('THE REGRESSION: a resolved sign-in redirects even though loading is still true', () => {
    expect(canRedirectAfterSignIn({ ...live, loading: true, signedIn: true })).toBe(true);
  });

  test('a session restored on mount redirects', () => {
    expect(canRedirectAfterSignIn(live)).toBe(true);
  });

  test('holds while a sign-in is in flight', () => {
    // The reason the guard exists: `currentUser` here is still whoever was
    // signed in BEFORE, and redirecting would cancel the login in progress by
    // pushing the operator into the previous workspace.
    expect(canRedirectAfterSignIn({ ...live, loading: true, signedIn: false })).toBe(false);
  });

  test('holds while the visitor is deliberately switching account', () => {
    expect(canRedirectAfterSignIn({ ...live, switching: true })).toBe(false);
    // Even once the new sign-in has resolved, an explicit switch still owns
    // the screen — `switching` is cleared by the flow that set it.
    expect(canRedirectAfterSignIn({ ...live, switching: true, loading: true, signedIn: true })).toBe(false);
  });

  test('never redirects without a session', () => {
    expect(canRedirectAfterSignIn({ ...base, signedIn: true })).toBe(false);
    expect(canRedirectAfterSignIn({ ...base, isAuthenticated: true, hasUser: false })).toBe(false);
    expect(canRedirectAfterSignIn({ ...base, isAuthenticated: false, hasUser: true })).toBe(false);
  });

  test('a failed sign-in — loading cleared, no session — stays put', () => {
    expect(canRedirectAfterSignIn(base)).toBe(false);
  });
});

/**
 * `resolveNextPath` — the `?next=` query param `apiFetch` attaches when it
 * bounces an expired session to `/login?next=<path>`. Generated for years and
 * never read: the login page only ever consumed `?u=` and `?portal=`, so a
 * resumed sign-in always landed on the role's default dashboard instead of
 * back where the session died. Once read, the value is attacker-controllable
 * query-string input, so every case below is a way to smuggle a redirect
 * somewhere the login page must refuse.
 */
describe('resolveNextPath', () => {
  const NURSE = 'nurse';

  test('accepts a same-origin path the role may actually open', () => {
    expect(resolveNextPath('/patients/abc123', NURSE)).toBe('/patients/abc123');
  });

  test('preserves a query string or hash on an accepted path', () => {
    expect(resolveNextPath('/patients/abc123?tab=labs', NURSE)).toBe('/patients/abc123?tab=labs');
  });

  test('rejects an absolute URL — no leading "/"', () => {
    expect(resolveNextPath('https://evil.example', NURSE)).toBeNull();
    expect(resolveNextPath('evil.example', NURSE)).toBeNull();
  });

  test('rejects a protocol-relative URL ("//evil") — a browser resolves that against a DIFFERENT host', () => {
    expect(resolveNextPath('//evil.example', NURSE)).toBeNull();
  });

  test('rejects a backslash disguise of a protocol-relative URL ("/\\\\evil")', () => {
    // Some URL parsers (older browsers among them) treat "\" the same as "/",
    // so this is "//evil.example" in a form the leading-"//" check alone
    // would not catch.
    expect(resolveNextPath('/\\evil.example', NURSE)).toBeNull();
  });

  test('rejects a path this role may not open', () => {
    expect(resolveNextPath('/admin', NURSE)).toBeNull();
  });

  test('rejects nothing (empty/absent) rather than crashing', () => {
    expect(resolveNextPath(null, NURSE)).toBeNull();
    expect(resolveNextPath(undefined, NURSE)).toBeNull();
    expect(resolveNextPath('', NURSE)).toBeNull();
  });

  test('the platform super-admin may open everything — isPathAllowed’s own rule', () => {
    expect(resolveNextPath('/admin/organizations', 'super_admin')).toBe('/admin/organizations');
  });
});

/**
 * S2: control characters (TAB/LF/CR and the rest of the C0 range) reach
 * `window.location.assign` unstripped by the checks above, but the WHATWG
 * URL parser strips ASCII tab/newline BEFORE parsing — so `/\t/evil.example`
 * resolves as `//evil.example`, a protocol-relative redirect to a different
 * host. This is the one path in this file that a literal super_admin session
 * can walk: `isPathAllowed('super_admin', ...)` is unconditionally true, so
 * nothing downstream of the character checks would ever catch this for that
 * role — the control-character guard has to be the thing that stops it.
 */
describe('resolveNextPath — control-character open redirect (S2)', () => {
  const SUPER = 'super_admin';

  test('rejects a percent-encoded tab (the escaped form, decoded before the check)', () => {
    expect(resolveNextPath('/%09/evil.example', SUPER)).toBeNull();
  });

  test('rejects a literal tab character', () => {
    expect(resolveNextPath('/\t/evil.example', SUPER)).toBeNull();
  });

  test('rejects a literal carriage return', () => {
    expect(resolveNextPath('/\r/evil.example', SUPER)).toBeNull();
  });

  test('rejects a literal newline immediately before a protocol-relative "//"', () => {
    expect(resolveNextPath('/\n//evil.example', SUPER)).toBeNull();
  });

  test('a normal, allowed path is unaffected by the new guard', () => {
    expect(resolveNextPath('/patients/x', SUPER)).toBe('/patients/x');
  });

  test('a role-forbidden path is still rejected — the character guard does not loosen the role check', () => {
    expect(resolveNextPath('/admin', 'nurse')).toBeNull();
  });
});
