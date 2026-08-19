# JWT revocation

This document describes how the platform invalidates a session JWT before
its `exp` claim and where that check is enforced.

## Why a blacklist at all

JWTs in this platform are HMAC-signed by `JWT_SECRET` and, by default,
live for 30 days (`SESSION_TTL_SEC` in
[`lib/session.ts`](../../src/lib/session.ts), overridable via
`SESSION_TTL_HOURS` — this was a flat 8 hours until a 2026-08-13 change
made it configurable). Either way, the session window is too long for
clinical contexts on shared devices: when a clinician logs out at the end
of a shift, the next clinician on the same tablet must not be able to
replay the previous session's cookie. Short expiries don't solve this —
only an explicit revocation does.

## Store

`lib/token-blacklist.ts` keeps a **local file-backed store**, plus an
**optional shared Upstash Redis tier** layered on top of it (KAN-34 — see
below). The local tier is a `Map<jwt, { expSec }>`:

- Persisted to `<platform>/.token-blacklist.json` (gitignored, mode 0600)
  so a server restart doesn't reset the revocation list.
- Keyed by the full JWT string. Forged tokens never reach this layer
  because `verifyToken()` HMAC-checks first.
- Each entry carries the JWT's `exp` claim. Entries are evicted lazily on
  read and proactively on a 60-second sweep — once the JWT itself expires
  it can't be replayed anyway, so we stop tracking it.
- The previous in-memory implementation flushed on a 1,000-entry cap. That
  was a denial-of-revocation: an attacker could log in 1,000 times to
  empty the blacklist. The current store has no such cap; the only
  shrinking mechanism is exp-based eviction.

### Shared backend (Upstash Redis) — no longer just a roadmap item

When `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or the
Vercel-managed `KV_REST_API_URL` / `KV_REST_API_TOKEN` aliases) are
configured, `revokeToken()` writes to **both** the shared Redis store and
the local file, and `isTokenRevoked()` checks the shared store first,
falling back to local only on an Upstash failure. This closes the
horizontal-scaling gap described further down — a logout on one replica is
now honoured by every other replica, not just the one that handled it.

The raw JWT is never stored as the Redis key — it's hashed
(`hashKey(token, 'tamam-revoked')`) first, specifically so a compromised
Upstash dashboard doesn't hand an attacker a list of currently-valid
session tokens (a revoked JWT is still cryptographically valid until its
own `exp`; the blacklist is what makes it unusable, not the signature).
The Redis key's own TTL is set to the token's remaining lifetime, so
eviction there needs no sweep.

## Where the check runs

JWT revocation has to be enforced in *Node* runtime (the file-backed store
needs `node:fs`). Every authenticated path passes through one of two Node
chokepoints:

| Chokepoint | What it protects | File |
|---|---|---|
| `/api/auth/me` | The session bootstrap that `context.tsx` calls on every app load. A revoked token → `401 { user: null }` → client logs out the user. | [route.ts](../../src/app/api/auth/me/route.ts) |
| `getAuthPayload(request)` | Used by every authenticated `/api/*` route handler. A revoked token never returns a payload, so no PHI read or mutation can land. | [api-auth.ts](../../src/lib/api-auth.ts) |

The page-level Edge proxy **does not** call `isTokenRevoked` —
Next.js proxy runs on the Edge runtime which has no `node:fs`. A
stolen-cookie page navigation can render the route shell, but the
shell's bootstrap call to `/api/auth/me` triggers the logout flow and any
subsequent API call (mutation or PHI read) is rejected at `getAuthPayload`.
Logout also clears the cookie on the same browser, so this only matters
for cross-browser cookie theft.

## Logout flow

[`/api/auth/logout`](../../src/app/api/auth/logout/route.ts):

1. Reads the token from the request cookie.
2. `await revokeToken(token)` — the store extracts `exp` from the JWT,
   inserts the entry, and debounces a write to the persistence file.
3. Clears both `tamamhealth-token` (httpOnly) and `tamamhealth-csrf` cookies
   on the response.

All three steps are best-effort: if the cookie is absent or the token is
malformed, logout still succeeds with the cookie cleared.

## Failure modes

- **Server restart loses entries written in the last ~250ms.** The persist
  is debounced. For most contexts this is acceptable; if a logout request
  succeeds the response is sent and the user is redirected before the
  debounce timer fires. Critical environments can call
  `_flushTokenBlacklistForTest()` (or a future operator-facing equivalent)
  to force-flush before redeploying.
- **Process crash mid-write** can leave the file partially written. The
  loader catches JSON-parse failures and starts empty rather than
  refusing to boot — fail-open here is the lesser evil.
- **Horizontal scaling — shipped.** The file-backed store alone is
  single-instance, so a rolling deploy across N instances used not to
  share revocations. That gap is closed when Upstash is configured (see
  "Shared backend" above, KAN-34): `revokeToken`/`isTokenRevoked` check
  the shared store first, and the local file becomes a warm fallback for
  when Upstash itself is unreachable — at that point a revocation made on
  one replica is genuinely local-only again until Upstash recovers.
  Without Upstash configured, the single-instance limitation still applies
  exactly as described.

## Operator notes

- `TOKEN_BLACKLIST_FILE` env var overrides the default path
  (`<cwd>/.token-blacklist.json`). Useful for tests and for operators who
  want to put the file on a faster volume.
- The file is gitignored. Don't commit it.
- Configure `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (shared
  with [rate-limiting.md](./rate-limiting.md)'s Upstash backend) in any
  horizontally-scaled deployment so revocation is honoured across all
  replicas, not just the one that handled the logout.
- A production audit of "who logged out and when" needs to combine this
  store with the audit log — the blacklist intentionally keeps no
  per-session metadata beyond `exp`.

## Tests

There is currently no dedicated test file for this module —
`token-blacklist.test.ts` (which covered round-trip revoke/check,
isolation between tokens, persistence across an in-process restart,
expired-entry lazy eviction, expired entries not surviving a restart, the
no-flush-at-N regression, empty-token safety, and malformed-JWT fallback
expiry) was deleted along with a large batch of other test files in an
unrelated sync-refactor commit and never restored, nor updated for the
Upstash tier added since. `src/__tests__/services/session-lifetime.test.ts`
mocks `token-blacklist` entirely rather than exercising it, so it provides
no coverage here. This is a real gap worth restoring — `revokeToken`,
`isTokenRevoked`, and the Upstash/local dual-write path are currently
unverified by any automated test.
