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

import { canRedirectAfterSignIn, type SignInRedirectState } from '@/lib/navigation/login-redirect';

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
