/**
 * When the sign-in screen is allowed to send a live session to its dashboard.
 *
 * Extracted from the page and named because getting it wrong is invisible in
 * review and total in production: the form simply never leaves, with a valid
 * session sitting behind it.
 */

import { isPathAllowed } from '@/lib/role-routes';

export interface SignInRedirectState {
  /** A sign-in request is in flight. */
  loading: boolean;
  /** That request RESOLVED successfully. */
  signedIn: boolean;
  /** The visitor asked to sign in as somebody else. */
  switching: boolean;
  /** There is a session. */
  isAuthenticated: boolean;
  /** …and the identity behind it has loaded. */
  hasUser: boolean;
}

/**
 * The guard exists to stop the redirect firing mid-sign-in on the OLD
 * identity — which used to push the operator into the previous session's
 * workspace and cancel the login they had just started.
 *
 * Its subject is therefore "is `currentUser` still the old identity", NOT "is
 * a request in flight". The two came apart on the success path: a successful
 * sign-in returns early and leaves `loading` true on purpose, so the button
 * does not flash back to "Log in" while the redirect runs. Gating on `loading`
 * alone meant the guard could never lift — the screen sat on "Signing in…"
 * indefinitely and only a manual refresh, which remounts with `loading` false,
 * ever reached the dashboard. `signedIn` is what says the identity is new.
 */
export function canRedirectAfterSignIn(state: SignInRedirectState): boolean {
  if (state.switching) return false;
  if (state.loading && !state.signedIn) return false;
  return state.isAuthenticated && state.hasUser;
}

/**
 * Validate a `?next=` redirect target from the URL.
 *
 * `apiFetch`'s 401 handler sends an expired session to
 * `/login?next=<path>` so a resumed sign-in can return to the page it was
 * bounced from. The value is attacker-controllable query-string input, so it
 * is accepted ONLY when it names a same-origin relative path that the
 * signed-in role may actually open — anything else returns `null`, and the
 * caller falls back to the role's normal landing page
 * (`resolveLandingPage`).
 *
 * Rejects:
 *   - anything without a leading "/" (`https://evil.example`, `evil.example`)
 *     — the one thing every same-origin relative path has in common;
 *   - a leading "//" (`//evil.example`) — a browser resolves that as
 *     protocol-relative, i.e. against ITS OWN scheme but a DIFFERENT host,
 *     not as a path;
 *   - any backslash (`/\evil.example`) — some URL parsers (older browsers
 *     among them) treat "\" the same as "/", so this is "//evil.example" in
 *     a disguise the leading-slash checks above would otherwise miss;
 *   - a path this role may not open (`/admin` for a nurse) — `next` must not
 *     become a way to reach a screen the role picker and route table both
 *     agree the role cannot see.
 */
export function resolveNextPath(next: string | null | undefined, role: string): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return null;
  }
  const path = next.split(/[?#]/)[0];
  return isPathAllowed(role, path) ? next : null;
}
