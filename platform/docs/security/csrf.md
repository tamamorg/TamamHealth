# CSRF threat model

This document describes how the platform defends against Cross-Site Request
Forgery and what residual risks remain.

## Layers

The platform stacks three independent defences. An attack has to defeat all
three to land a forged mutation.

### 1. SameSite=strict session cookie

The session JWT lives in `tamamhealth-token`, an `httpOnly` cookie set
`SameSite=strict; Secure` (the latter in production). A cross-site request
initiated from `evil.com` does not carry this cookie at all — the browser
refuses to attach it on cross-origin loads.

This single mechanism stops the textbook CSRF attack (an `<img>` or
`<form action>` from a malicious page). It is implemented at
[`/api/auth/login`](../../src/app/api/auth/login/route.ts) and
[`/api/auth/logout`](../../src/app/api/auth/logout/route.ts).

### 2. Origin / Host header check (proxy layer 1)

For every state-changing request to `/api/*`,
[`proxy.ts`](../../src/proxy.ts) requires:

- An `Origin` header is present (mandatory in production).
- `URL(origin).host === request.headers.get('host')`.

This catches the residual cases where SameSite is bypassed — most commonly,
buggy or older browsers, exotic deployment misconfigurations, or a downstream
proxy that strips cookie attributes.

### 3. HMAC-bound double-submit token (proxy layer 2)

Implemented in [`lib/csrf.ts`](../../src/lib/csrf.ts).

On successful login the server mints a token of the form

    base64url(nonce_16_random_bytes) "." base64url(HMAC-SHA-256(JWT_SECRET, sub || nonce))

The token is set as a *non-`httpOnly`* cookie `tamamhealth-csrf` so the
browser-side fetch wrapper [`lib/api-fetch.ts`](../../src/lib/api-fetch.ts)
can read it and echo it back in the `X-CSRF-Token` header on every
state-changing request.

The proxy enforces, for any non-exempt POST/PUT/PATCH/DELETE under
`/api/*`:

- both the cookie *and* the header are present;
- they are equal (the "double-submit" check);
- the HMAC verifies for the JWT subject of the current session.

The HMAC is the load-bearing piece. A pure double-submit cookie can be
defeated by an attacker who can write any cookie on the target origin (e.g.
via a sub-domain takeover or a misbehaving downstream that injects headers).
The HMAC binds the token to the *server's* secret and to the *current user's*
identity, so neither writing arbitrary cookies nor leaking another user's
token gives the attacker something that verifies.

## Exempt routes

Some `/api/*` paths are intentionally exempt from layer 3. Two separate
lists in `proxy.ts` implement this — `CSRF_EXEMPT_API_PATHS` (exact-match)
and `isCsrfExemptApiPath()` (exact-match plus a few prefix rules):

| Path | Why |
|---|---|
| `/api/auth/login`  | No session yet — there is nothing to bind a token to. |
| `/api/auth/logout` | Idempotent; failure mode is "user stays logged in". |
| `/api/auth/me`     | Read-only. |
| `/api/account-requests` | Public, no session to protect; rate-limited by IP. |
| `/api/patient-portal/*` | Separate JWT scheme with its own anti-forgery flow. |
| `/api/booking/*` | Public booking requests — no staff session cookie exists to protect; guarded instead by per-IP/per-phone rate limits and a required slot hold. |
| `/api/fhir/metadata` | Public CapabilityStatement. |
| `/api/country/metadata`, `/api/terminology/*` | Public reference data, no PHI. |
| `/api/checkout`, `/api/checkout/*` | Public pay-by-link checkout — an unauthenticated payer has no session cookie to bind a token to; the Origin check still applies. |

`/api/demo-credentials` used to be in this list; the route was removed
(superseded by `/api/account-requests`).

The exempt list lives in [`proxy.ts`](../../src/proxy.ts) — touch
both there and the unit tests when adding to it.

### A fourth, header-gated exemption: scheduled-job callers

A small set of routes accept **two** kinds of caller — a staff user with a
session (manual trigger from the UI), and a scheduled job holding a shared
secret — and skip *both* the Origin/Host check and the CSRF gate when the
request presents the route's designated secret header:

| Route | Required header |
|---|---|
| `/api/sync` | `x-tamamhealth-signature` |
| `/api/patient-reminders/dispatch` | `x-reminder-dispatch-secret` |
| `/api/patient-transfers/sweep` | `x-transfer-sweep-secret` |
| `/api/telehealth/maintenance` | `x-telehealth-maintenance-secret` |

This is deliberately keyed on the *presence* of the header, not just the
path — a cron `curl` has no session cookie, no CSRF token, and no `Origin`
header, so without this exemption the job would 403 before its own secret
check ever runs. A cross-site browser attacker can't set a custom header on
a form/`<img>` request, and a `fetch` that tries triggers a CORS preflight
the browser blocks — so the session-authenticated path keeps full CSRF
protection; only a request already claiming to be a machine caller skips
it. The header's *value* is still verified in the route with a
constant-time compare (see
[`sync-conflict-policy.md`](../architecture/sync-conflict-policy.md) for
the `/api/sync` HMAC scheme specifically) — presence alone authorises
nothing. Implemented as `MACHINE_CALLER_ROUTES` /
`isMachineCallerRequest()` in [`proxy.ts`](../../src/proxy.ts).

## What this does *not* defend against

- **XSS in our own JS payload.** A successful XSS on `app.tamamhealth.org`
  bypasses every CSRF mitigation here — the attacker's script runs
  *as* the user, reads their CSRF cookie, and sends matching headers.
  CSRF is the cross-origin defence; XSS prevention (CSP, output encoding,
  removing inline `dangerouslySetInnerHTML` paths) is the defence against
  same-origin attacks.
- **A compromised browser or OS.** Cookies and headers can both be read by
  malware on the user's machine.
- **Insider threat.** A logged-in clinician using their own session to do
  things they shouldn't is an authorisation problem, not a CSRF one.

## Token rotation

- A fresh token is minted on every login (so a leaked old token from a
  previous session doesn't survive a re-auth).
- The cookie's `maxAge` matches the session JWT's life —
  `SESSION_TTL_SEC` in [`lib/session.ts`](../../src/lib/session.ts),
  which defaults to 30 days and is overridable via `SESSION_TTL_HOURS`.
  (This was a flat 8 hours until a 2026-08-13 change made it configurable;
  update anything that still assumes "8 hours".)
- Logout clears both cookies.
- Lazy mint: if a valid session JWT is present but no CSRF cookie (the
  user upgraded across the deploy that introduced this defence, or they
  cleared cookies), a fresh CSRF cookie is set on the next authenticated
  response. Two independent code paths do this today: the proxy sets it on
  the next authenticated GET, and `/api/auth/me` does the same
  independently in its own handler. The user's next mutation then succeeds
  without forcing a re-login.

## What the operator must do

- Set `JWT_SECRET` to ≥32 bytes of entropy in every environment. The CSRF
  HMAC reuses that secret. The platform refuses to boot in production
  without it.
- Don't expose `tamamhealth-csrf` to a non-same-origin downstream — it is
  intentionally readable by the browser, but a public CDN that caches it
  would break user isolation.

## Tests

There is currently no dedicated CSRF test file — `csrf.test.ts` (mint/
verify unit tests: HMAC binding, nonce randomness, malformed-input
handling) was deleted along with a large batch of other test files in an
unrelated sync-refactor commit and never restored. The only adjacent
coverage today is `src/__tests__/services/session-lifetime.test.ts`, which
touches `CSRF_COOKIE_NAME` as a constant but does not exercise mint/verify
logic. This is a real coverage gap, not just a doc-freshness issue — the
mint/verify functions in `lib/csrf.ts` are currently unverified by any
automated test.

## See also

- [draft-storage.md](./draft-storage.md) — encrypted ephemeral storage for
  in-progress PHI form drafts on shared workstations. Different threat
  surface (next-user-on-the-device, not cross-origin) but the same general
  posture of layering browser-side defences over a session cookie.
- [token-revocation.md](./token-revocation.md) — what happens server-side on
  logout (the same `logout()` flow that triggers draft cleanup).
