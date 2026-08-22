/**
 * Browser-side wrapper around `fetch` for our same-origin /api/* endpoints.
 *
 * Every state-changing request automatically picks up the CSRF token from
 * the non-httpOnly `tamamhealth-csrf` cookie and echoes it in the
 * X-CSRF-Token header. The middleware refuses any POST/PUT/PATCH/DELETE
 * that lacks a matching, HMAC-valid pair — so missing this wrapper is a
 * caller bug that surfaces immediately as a 403, not a silent breach.
 *
 * Use this for any client-side mutation against /api/. Pure GETs work too,
 * but they don't require the CSRF dance — using `fetch` directly is fine.
 */

import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/modules/identity/client';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const IDEMPOTENCY_HEADER = 'X-Idempotency-Key';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return null;
}

/**
 * Same shape as `fetch`. Detects state-changing methods and adds the CSRF
 * header. Server-side imports of this module short-circuit to plain fetch
 * since there is no document.cookie in the Node runtime — server-to-server
 * calls inside the Next.js process don't go through the public middleware
 * anyway.
 *
 * Also intercepts 401 responses: when the JWT silently expires mid-session
 * (default 8h life), every subsequent /api/* call will 401. Without this
 * hook each caller has to remember to redirect — easy to miss. We redirect
 * once here so the user gets routed back to /login with a return path,
 * instead of a string of unexplained "request failed" toasts.
 */
let redirecting = false;
function redirectToLogin(): void {
  if (typeof window === 'undefined' || redirecting) return;
  // Don't bounce out of the login page itself, and don't fight a redirect
  // that's already in flight.
  if (window.location.pathname.startsWith('/login')) return;
  redirecting = true;
  const here = window.location.pathname + window.location.search;
  window.location.href = `/login?next=${encodeURIComponent(here)}`;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  let response: Response;
  if (typeof document === 'undefined' || !MUTATION_METHODS.has(method)) {
    response = await fetch(input, init);
  } else {
    const token = readCookie(CSRF_COOKIE_NAME);
    const headers = new Headers(init.headers);
    if (!headers.has(IDEMPOTENCY_HEADER)) {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      headers.set(IDEMPOTENCY_HEADER, key);
    }
    if (!token) {
      // Don't fail outright — the request hits the server, gets a 403 with a
      // descriptive body, and the caller's normal error path takes over. That
      // gives one consistent shape for "you weren't authorized" errors.
      response = await fetch(input, { ...init, headers });
    } else {
      if (!headers.has(CSRF_HEADER_NAME)) {
        headers.set(CSRF_HEADER_NAME, token);
      }
      response = await fetch(input, { ...init, headers });
    }
  }

  // Mid-session JWT expiry surfaces as 401 from /api/* — redirect to /login
  // so the user can re-authenticate instead of seeing opaque toast errors.
  // We deliberately do NOT redirect on 403 (RBAC denial, CSRF mismatch); those
  // are caller errors, not stale-session errors.
  if (response.status === 401) {
    redirectToLogin();
  }
  return response;
}
