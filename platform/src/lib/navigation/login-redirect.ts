/**
 * When the sign-in screen is allowed to send a live session to its dashboard.
 *
 * Extracted from the page and named because getting it wrong is invisible in
 * review and total in production: the form simply never leaves, with a valid
 * session sitting behind it.
 */

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
