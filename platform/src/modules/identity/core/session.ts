/**
 * Session lifetime policy — the single source of truth for how long a login
 * lasts and when it is silently renewed.
 *
 * A session is a signed JWT in the httpOnly `tamamhealth-token` cookie plus a
 * non-httpOnly CSRF twin. Cookie Max-Age and JWT `exp` share SESSION_TTL_SEC
 * so neither outlives the other. "The browser remembers I logged in" comes
 * from the long TTL plus sliding renewal: /api/auth/me (called on every app
 * load) re-mints any token older than SESSION_RENEW_AFTER_SEC, so an actively
 * used session never expires while an abandoned one dies TTL after its last
 * renewal.
 *
 * A long-lived token is safe to carry here only because possession alone is
 * not enough: getAuthPayload re-checks the live user record on every API
 * request (deactivation, tenant kill-switch) and rejects tokens minted before
 * the account's latest password change (`pwdAt` claim vs the user document's
 * passwordUpdatedAt) — so changing or resetting a password immediately kills
 * every other session for that account, no matter how much token life remains.
 *
 * Client-safe: constants only, no Node APIs. `SESSION_TTL_HOURS` is a
 * server-side env override; the browser bundle simply sees the default.
 */

import { CSRF_COOKIE_NAME } from '@/modules/identity/core/csrf';

const HOUR_SEC = 60 * 60;
const DEFAULT_TTL_HOURS = 24 * 30; // 30 days

function ttlHoursFromEnv(): number {
  const raw = process.env.SESSION_TTL_HOURS;
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TTL_HOURS;
  return parsed;
}

/** Whole-session lifetime: JWT `exp` and session/CSRF cookie Max-Age. */
export const SESSION_TTL_SEC = ttlHoursFromEnv() * HOUR_SEC;

/**
 * Tokens older than this get re-minted on the next /api/auth/me call.
 * Capped at half the TTL so a short operator-configured TTL still renews
 * instead of expiring before its first renewal opportunity.
 */
export const SESSION_RENEW_AFTER_SEC = Math.min(24 * HOUR_SEC, Math.floor(SESSION_TTL_SEC / 2));

export const SESSION_COOKIE_NAME = 'tamamhealth-token';

/** Anything with a `set(name, value, options)` — NextResponse.cookies fits. */
interface CookieSetter {
  set(name: string, value: string, options: {
    httpOnly?: boolean; secure?: boolean; sameSite?: 'strict' | 'lax' | 'none';
    maxAge?: number; path?: string;
  }): unknown;
}

/**
 * Set (or refresh) the session cookie, and optionally its CSRF twin, with the
 * canonical attributes. Every place that issues a session goes through this so
 * the cookie lifetime can never drift from the JWT lifetime again.
 *
 * `persist` is "Keep me signed in" (default true, so every existing caller
 * that doesn't pass it keeps the prior always-persistent behaviour). When
 * false the cookies carry NO Max-Age at all, making them session cookies the
 * browser drops on its own close — while the JWT inside keeps the same
 * SESSION_TTL_SEC `exp` either way. That split is deliberate: a short browser
 * session and a long-lived token are two different questions, and only the
 * person at the keyboard gets to answer the first one.
 */
export function applySessionCookies(
  cookies: CookieSetter,
  token: string,
  csrfToken?: string,
  persist: boolean = true,
): void {
  const secure = process.env.NODE_ENV === 'production';
  const maxAge = persist ? SESSION_TTL_SEC : undefined;
  cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    ...(maxAge !== undefined ? { maxAge } : {}),
    path: '/',
  });
  if (csrfToken !== undefined) {
    // The CSRF cookie is deliberately readable by JS — the double-submit
    // pattern requires the browser to echo it in the X-CSRF-Token header.
    cookies.set(CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: false,
      secure,
      sameSite: 'strict',
      ...(maxAge !== undefined ? { maxAge } : {}),
      path: '/',
    });
  }
}
