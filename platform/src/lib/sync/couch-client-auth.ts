/**
 * Browser-side CouchDB session login.
 *
 * After the platform server has authenticated the user (and provisioned a
 * matching CouchDB user via lib/sync/couch-auth.ts), the browser logs into
 * CouchDB directly. CouchDB sets an `AuthSession` cookie on the response,
 * scoped to the CouchDB host. Subsequent fetches with `credentials:'include'`
 * — including those issued by PouchDB during sync — carry that cookie.
 *
 * Why client-side and not server-mediated?  Because CouchDB's cookie binds to
 * its own host (e.g., couch.tamamhealth.org). A Next.js Set-Cookie response
 * can't write a cookie scoped to a different host, so the browser has to
 * make the call itself. CORS already allows credentials (see setup-couchdb.sh).
 */

import { getCouchDBUrl } from './sync-config';

const SESSION_PATH = '/_session';

/**
 * How long any single CouchDB auth call may take before it is abandoned.
 *
 * Every caller here is best-effort — a failure means "no sync this session",
 * and offline-first PouchDB carries on regardless. But `loginCouch` is
 * `await`ed inline by the sign-in handler, and a bare `fetch` to a host that
 * drops packets does not fail: it hangs for the browser's own TCP timeout,
 * which is tens of seconds. That turned a dead CouchDB into a sign-in button
 * stuck on "Signing in…" long enough for people to reload the page.
 *
 * Three seconds is far longer than a reachable CouchDB needs (the production
 * server answers `_session` in single-digit milliseconds) and short enough that
 * an unreachable one costs a beat rather than a minute.
 */
const COUCH_AUTH_TIMEOUT_MS = 3000;

/**
 * `fetch` that gives up rather than hanging. Returns null on timeout or
 * network failure, so callers treat "unreachable" exactly like "refused".
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = COUCH_AUTH_TIMEOUT_MS,
): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    // AbortError (timed out) and TypeError (DNS/refused/CORS) are the same
    // answer to the only question the callers ask: is CouchDB usable now?
    return null;
  }
}

export interface CouchSessionResult {
  ok: boolean;
  /** CouchDB returns the user's roles in the session response */
  roles?: string[];
  /** HTTP status from /_session — useful for diagnostics */
  status: number;
  /** Free-form error text from CouchDB on failure */
  error?: string;
}

/**
 * POST /_session with form-encoded credentials. Per CouchDB docs the endpoint
 * also accepts JSON, but form encoding is the documented happy path and works
 * with CouchDB 2.x and 3.x identically.
 *
 * Returns ok=true on success. The browser will now hold an `AuthSession`
 * cookie on the CouchDB host that it sends on credentialled requests.
 */
export async function loginCouch(
  username: string,
  password: string,
): Promise<CouchSessionResult> {
  if (typeof window === 'undefined') {
    return { ok: false, status: 0, error: 'loginCouch must run in the browser' };
  }
  const couchUrl = getCouchDBUrl();
  if (!couchUrl) {
    return { ok: false, status: 0, error: 'NEXT_PUBLIC_COUCHDB_URL is not set' };
  }
  const res = await fetchWithTimeout(`${couchUrl.replace(/\/+$/, '')}${SESSION_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: username, password }).toString(),
  });
  if (!res) {
    return { ok: false, status: 0, error: `unreachable within ${COUCH_AUTH_TIMEOUT_MS}ms` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  const body = (await res.json().catch(() => ({}))) as { roles?: string[] };
  return { ok: true, status: res.status, roles: body.roles ?? [] };
}

/**
 * DELETE /_session — drops the AuthSession cookie. Called on logout so a
 * subsequent user on the same browser cannot replay the previous session.
 */
export async function logoutCouch(): Promise<void> {
  if (typeof window === 'undefined') return;
  const couchUrl = getCouchDBUrl();
  if (!couchUrl) return;
  try {
    await fetch(`${couchUrl.replace(/\/+$/, '')}${SESSION_PATH}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    // best-effort; offline logout is fine
  }
}

/**
 * In-memory CouchDB credentials for session renewal.
 *
 * CouchDB's AuthSession cookie expires after `couch_httpd_auth.timeout`
 * seconds (600 by default). Without renewal, every live replication starts
 * failing with 401 mid-session and sync silently dies — the platform session
 * (8h JWT) outlives the CouchDB one. The credentials are held in module
 * memory only (never storage): a page reload drops them, which is safe
 * because the cookie itself survives the reload and the timeout is aligned
 * with the platform session length by setup-couchdb.sh.
 */
let sessionCreds: { username: string; password: string } | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

export function registerCouchCredentials(username: string, password: string): void {
  sessionCreds = { username, password };
}

export function clearCouchCredentials(): void {
  sessionCreds = null;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Verify the CouchDB session is alive; re-login with the registered
 * credentials when it is not. Returns true when a valid session exists
 * after the call.
 */
export async function ensureCouchSession(): Promise<boolean> {
  const who = await whoamiCouch();
  if (who.ok) return true;
  if (!sessionCreds) return false;
  const res = await loginCouch(sessionCreds.username, sessionCreds.password);
  return res.ok;
}

/**
 * Restore a CouchDB session when the platform session is restored (page
 * reload / new tab) but no CouchDB credentials are held in memory. Asks the
 * server — which holds admin creds — for a fresh single-use CouchDB password
 * bound to the already-authenticated platform JWT, exchanges it at /_session,
 * and registers it for renewal. Returns true when a live session results.
 *
 * Without this, replication 401-loops for the rest of a restored session and
 * locally-entered data never pushes.
 */
export async function refreshCouchSessionFromServer(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  // If a valid cookie already survived the reload, nothing to do.
  if (await whoamiCouch().then((w) => w.ok).catch(() => false)) return true;
  try {
    const { apiFetch } = await import('../api-fetch');
    const res = await apiFetch('/api/sync/couch-session', { method: 'POST' });
    if (!res.ok) return false;
    const body = (await res.json()) as { enabled?: boolean; username?: string; password?: string };
    if (!body.enabled || !body.username || !body.password) return false;
    const login = await loginCouch(body.username, body.password);
    if (!login.ok) return false;
    registerCouchCredentials(body.username, body.password);
    startCouchSessionHeartbeat();
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a periodic session check (default every 4 minutes — well inside the
 * shortest realistic `couch_httpd_auth.timeout` of 600s). Singleton: calling
 * again replaces the previous timer.
 */
export function startCouchSessionHeartbeat(intervalMs = 4 * 60 * 1000): void {
  if (typeof window === 'undefined') return;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    void ensureCouchSession();
  }, intervalMs);
}

/**
 * GET /_session — returns the current session info, used by sync init to
 * decide whether the cookie is still good before starting replication.
 */
export async function whoamiCouch(): Promise<{
  ok: boolean;
  username?: string;
  roles?: string[];
}> {
  if (typeof window === 'undefined') return { ok: false };
  const couchUrl = getCouchDBUrl();
  if (!couchUrl) return { ok: false };
  // Bounded for the same reason as loginCouch: this runs on every page load,
  // ahead of restoring a session, so an unreachable CouchDB would stall the
  // app's boot rather than just its replication.
  const res = await fetchWithTimeout(`${couchUrl.replace(/\/+$/, '')}${SESSION_PATH}`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res?.ok) return { ok: false };
  try {
    const body = (await res.json()) as {
      userCtx?: { name: string | null; roles: string[] };
    };
    if (!body.userCtx?.name) return { ok: false };
    return { ok: true, username: body.userCtx.name, roles: body.userCtx.roles };
  } catch {
    return { ok: false };
  }
}
