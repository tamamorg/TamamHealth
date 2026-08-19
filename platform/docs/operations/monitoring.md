# Monitoring & alerting

This document describes how the platform is observed in production: error
tracking via Sentry, external uptime probes, and the on-call alert
thresholds. The platform boots fine with all of this disabled (current dev
default) — every helper is a no-op until a DSN is configured.

## Layers

The platform stacks three independent observability layers. None of them is
load-bearing for correctness — they are diagnostic only.

### 1. Sentry (in-process error & performance)

The `@sentry/nextjs` SDK is wired in three runtimes:

- **Browser** — [`src/instrumentation-client.ts`](../../src/instrumentation-client.ts).
- **Node server** — [`sentry.server.config.ts`](../../sentry.server.config.ts),
  loaded via `register()` in [`src/instrumentation.ts`](../../src/instrumentation.ts)
  when `NEXT_RUNTIME === 'nodejs'`.
- **Edge runtime (`proxy.ts` + edge route handlers)** —
  [`sentry.edge.config.ts`](../../sentry.edge.config.ts), also loaded from
  `instrumentation.ts` when `NEXT_RUNTIME === 'edge'`.

All three call `Sentry.init({ dsn, enabled: !!dsn, … })`, so leaving the DSN
unset short-circuits initialisation — no network requests, no client added
to the hub. The codebase calls Sentry only through the wrappers in
[`src/lib/observability.ts`](../../src/lib/observability.ts), which gate on
`Sentry.getClient()` (the v8 idiom). With no DSN configured the gate is
always closed.

`register()` in `instrumentation.ts` does more than load Sentry — on the
Node runtime it also asserts Doppler secret injection landed
(`assertDopplerEnv`), runs fail-closed production config validation
(`assertProductionConfig`), and applies Postgres migrations
(`runMigrations`). Any of those three can throw and refuse to boot; that's
a startup-crash concern, not a Sentry one — see
[production-runbook.md](./production-runbook.md) for what's actually
being validated.

Build wiring lives in [`next.config.mjs`](../../next.config.mjs):
`withSentryConfig(nextConfig, { silent: true, widenClientFileUpload: true,
hideSourceMaps: true })`. Source-map upload only fires when
`SENTRY_AUTH_TOKEN` (and the org/project slugs) are set; otherwise the
wrapper is a transparent passthrough.

### 2. Structured request log (most requests, not all)

[`proxy.ts`](../../src/proxy.ts) writes one JSON line to stdout in
production for every request that reaches its authenticated-session
gate — the unauthenticated-token, CSRF-failure, role-redirect, and final
success branches all call `logRequest()`. It does **not** cover every
request that hits the server: static assets, and the whole list of
publicly-exempt paths (`/api/auth/login`, `/api/auth/logout`,
`/api/auth/me`, `/api/account-requests`, `/api/patient-portal/*`,
`/api/booking/*`, `/api/fhir/metadata`, `/api/country/metadata`,
`/api/health`, `/api/terminology/*`, checkout, `/login`, `/`,
`/public-stats`, `/patient-portal`, `/terms`, `/privacy`,
`/request-account`, and machine-caller requests presenting their secret
header) return early via `NextResponse.next()` before `logRequest()` is
ever called — in any environment, not just filtered out in dev. This is
still the closest thing to a ground-truth audit trail for the requests it
does cover; Sentry is a convenience layer on top of it. In dev, non-GET and
`/api/*` calls also print a human-readable line —
`[REQ] METHOD path → status (userId/role) <durationMs>ms` — richer than a
bare `METHOD path → status`.

### 3. External uptime probe (operator-managed)

A third-party prober hits the platform every 60 seconds. See *Uptime
monitor* below.

## DSN configuration

Two env vars, documented in
[`.env.example`](../../.env.example) and
[`.env.production.example`](../../.env.production.example):

| Var | Side | Notes |
|---|---|---|
| `SENTRY_DSN` | server (Node + edge) | Never exposed to the browser. |
| `NEXT_PUBLIC_SENTRY_DSN` | browser | Baked into the client bundle at build time. Rebuild the image to rotate. |
| `SENTRY_RELEASE` | optional | Tags every event. Recommended value: `$(git rev-parse --short HEAD)` set at build time. |

Either var alone is enough for the corresponding side; the configs accept
`process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN` as a
fallback so a single value works for solo-developer setups.

## PII-stripping policy

Healthcare data must not leave the cluster. Every captured event passes
through `stripPHI` (the Sentry `beforeSend` hook) before transport. The
function lives in
[`src/lib/observability.ts`](../../src/lib/observability.ts) and the policy
is pinned by
[`strip-phi.test.ts`](../../src/__tests__/observability/strip-phi.test.ts).

`stripPHI` walks the event and replaces matching values with the literal
string `"[redacted]"`:

1. **Cookies.** Any `event.request.headers` entry whose lowercased name
   equals `cookie` is redacted (a plain string comparison, not a regex).
   The session JWT (`tamamhealth-token`) and CSRF token
   (`tamamhealth-csrf`) both live here.
2. **Sensitive data keys.** Any key — anywhere in `event.request.data`,
   `event.extra`, `event.contexts`, or breadcrumb `data` — whose name
   substring-matches one of the regexes below is redacted. The match is
   case-insensitive and substring-aware (so `passwordHash`,
   `password_confirm`, `userPhone`, `Email`, `DOB`, `national_id`, etc. all
   match):

   | Pattern | Examples scrubbed |
   |---|---|
   | `/email/i`        | `email`, `Email`, `emailSent`, `userEmail` |
   | `/phone/i`        | `phone`, `userPhone`, `phoneticName` |
   | `/dob/i`          | `dob`, `DOB`, `dobYear` |
   | `/password/i`     | `password`, `passwordHash`, `password_confirm`, `userPassword` |
   | `/passwordhash/i` | `passwordHash` (also covered by `/password/i` — kept explicit) |
   | `/nationalid/i`   | `nationalId`, `nationalID` |
   | `/national_id/i`  | `national_id` |
   | `/notes/i`        | `notes`, `clinicalNotes`, `nurse_notes` |

   Recursion follows nested objects and arrays. Cyclic references are
   guarded with a `WeakSet`.
3. **Top-level `request.data` and `extra`.** Walked the same way as nested
   objects.
4. **Breadcrumb data payloads.** Walked the same way.

The policy is intentionally conservative — keys like `emailSent: true` get
their value redacted even though the value is not PHI. Adding fields to
the *positive* allowlist would require a code change; the cost of a couple
of redacted booleans is much lower than the cost of leaking a patient
record. Update the regex list AND this table together — the
`strip-phi.test.ts` tests pin both sides.

## Uptime monitor (external)

Configure either **Better Stack** or **UptimeRobot** to poll the platform
from at least two regions every 60 seconds. The probe target is
`/api/auth/me`, which:

- requires no authentication to invoke,
- returns `401 {"user": null}` quickly when the cookie is absent (its own
  route handler returns this shape directly — it's exempted from the
  proxy's session gate, so the JWT check happens inside the route, not in
  `proxy.ts`),
- exercises the route handler's own JWT-verify call, though not
  `proxy.ts`'s auth/CSRF logic specifically, since this route is on the
  proxy's public-passthrough allowlist.

Treat any non-`401` response as down. (A `200` would indicate a
mis-configured probe leaking a real session cookie; either way it is the
operator's signal that something is wrong.)

| Provider | Probe URL | Method | Expected status | Interval |
|---|---|---|---|---|
| Better Stack / UptimeRobot | `https://app.your-domain.org/api/auth/me` | `GET` | `401` | `60s` |

A stronger alternative worth considering: `GET /api/health` is
unauthenticated, returns `200`/`503` based on actual CouchDB + Postgres
reachability (not just "the server process is up"), and is already what
the DigitalOcean App Platform deploy pipeline polls as its own post-deploy
smoke test (see `.github/workflows/deploy-app-platform.yml`) — it catches
dependency outages that `/api/auth/me` (which touches neither database)
would miss.

Configure the probe to alert on three consecutive failures (= ~3 minutes
of confirmed downtime) so a single transient timeout doesn't page the
on-call.

## Alert thresholds (PagerDuty / Slack)

These are the recommended rules; tune them after seeing 30 days of
production traffic.

| Signal | Threshold | Page level | Source |
|---|---|---|---|
| HTTP 5xx rate | > 1% of total responses, sustained 5 min | PagerDuty (P1) | Sentry transactions / log aggregator |
| p95 server latency | > 2.0 s, sustained 10 min | PagerDuty (P2) | Sentry transactions |
| Authentication failures | > 50 / min from a single IP | Slack `#sec-alerts` | Structured request log |
| DB connection failures | any | PagerDuty (P1) | Sentry server events whose message contains `[migrate]` or a `pg` connection error — there's no formal Sentry tag for this yet, so alert on message-substring matching, not a tag filter |
| Uptime probe down | 3 consecutive failures | PagerDuty (P1) | Better Stack / UptimeRobot |

The auth-failures rule is a separate channel from the DDoS-style rate
limiter inside [`src/lib/rate-limit.ts`](../../src/lib/rate-limit.ts) —
that one *blocks*; this one *notifies*. Either one fires without the
other.

## What the operator must do

- Set `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser) before
  the build, *or* leave both unset (the SDK no-ops cleanly).
- Set `SENTRY_RELEASE=$(git rev-parse --short HEAD)` at build time so
  events are grouped per deploy.
- Configure the external uptime probe — it is the only layer that catches
  total platform unreachability (a Sentry that can't reach Sentry doesn't
  alert).
- Wire the alert channels above into PagerDuty / Slack with the on-call
  rotation defined in the operations runbook.

## What this does *not* monitor*

- **CouchDB sync lag.** A separate metric, owned by the sync subsystem
  ([`src/lib/sync/sync-manager.ts`](../../src/lib/sync/sync-manager.ts)).
- **Browser-side JS errors on offline-only deployments.** If
  `NEXT_PUBLIC_SENTRY_DSN` is unset (which it should be in air-gapped
  facility deployments), the browser transmits nothing.
- **PHI accidentally written to log files.** PHI scrubbing happens only on
  the Sentry path. The structured request log (layer 2 above) deliberately
  stays close to raw — that's what lets operators reproduce a bug. The
  defence there is `sanitizeError` in
  [`src/lib/api-auth.ts`](../../src/lib/api-auth.ts), not `stripPHI`.

## Tests

`src/__tests__/observability/` is currently an empty directory —
`strip-phi.test.ts` (which pinned the redaction policy for every key
family + cookie header + cyclic-reference safety + breadcrumb scrubbing)
was deleted as apparent collateral damage in a large, unrelated
sync-refactor commit and never restored. The deleted file's own header
comment said its purpose was so the policy documented in this section
"can't silently drift" — that safety net is currently gone. This is a real
regression worth restoring, not just a doc-freshness note: PHI-stripping
for Sentry events has no automated coverage today.
