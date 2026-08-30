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
 * A raw C0 control character (0x00–0x1F) or DEL (0x7F) — the ASCII
 * tab/newline/carriage-return the WHATWG URL parser silently strips before
 * parsing sit inside this range, and the whole range is refused rather than
 * enumerating exactly which of them a given browser tolerates.
 */
const HAS_CONTROL_CHAR = /[\x00-\x1f\x7f]/;

/**
 * True when `value` — or its percent-decoding — carries a control character.
 *
 * `URLSearchParams.get('next')` already percent-decodes its value, so in
 * production this normally sees the control character directly (a literal
 * tab, not the text `%09`). Decoding here too is defence in depth against a
 * caller that hands this function the still-escaped form — a malformed
 * escape sequence fails closed (treated as carrying one) rather than being
 * assumed safe because it didn't parse.
 */
function hasControlCharacter(value: string): boolean {
  if (HAS_CONTROL_CHAR.test(value)) return true;
  try {
    return HAS_CONTROL_CHAR.test(decodeURIComponent(value));
  } catch {
    return true;
  }
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
 *   - a control character anywhere in the value (`/\t/evil.example`,
 *     `/%09/evil.example`, a bare `\r` or `\n`) — checked FIRST, before any
 *     other guard below. The WHATWG URL parser strips ASCII tab/newline from
 *     a URL before parsing it, so `/\t/evil.example` becomes
 *     `//evil.example` by the time `window.location.assign` (which every
 *     role, including super_admin, ultimately reaches) resolves it — a
 *     protocol-relative redirect to a different host wearing a disguise the
 *     checks below, on their own, do not see through;
 *   - a leading "/", then any run of whitespace or control characters, then
 *     another "/" — the same protocol-relative shape one layer up, refused
 *     by pattern rather than by trusting the control-character list above to
 *     be exhaustive across every browser's own tolerance;
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
 *     agree the role cannot see. This still applies to super_admin, whose
 *     `isPathAllowed` allows every path — which is exactly why the checks
 *     above cannot rely on it to catch a disguised cross-origin target.
 */
export function resolveNextPath(next: string | null | undefined, role: string): string | null {
  if (!next) return null;
  if (hasControlCharacter(next)) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
    return null;
  }
  if (/^\/[\s\x00-\x1f\x7f]+\//.test(next)) {
    return null;
  }
  const path = next.split(/[?#]/)[0];
  return isPathAllowed(role, path) ? next : null;
}
