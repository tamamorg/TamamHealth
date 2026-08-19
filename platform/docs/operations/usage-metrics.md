# Usage metrics

TamamHealth records **product usage events** separately from compliance
`audit_log` entries.

## What is captured

- `session_start` / `session_end`
- `page_view` (templated paths — IDs replaced with `[id]`)
- `click` / `change` (full clickstream via event delegation)

Events never include input values, passwords, cookies, or free-text clinical
fields. Labels are truncated; keys matching a PHI-pattern list are dropped.
That list lives in `src/lib/usage/sanitize.ts`'s own `PHI_KEY_PATTERNS` —
it's hand-maintained to stay aligned with the Sentry-side list in
`src/lib/observability.ts` (see
[monitoring.md](./monitoring.md#pii-stripping-policy)), not literally
shared or imported from it. The two currently differ slightly:
`sanitize.ts` adds `/cookie/i` (observability.ts redacts the cookie header
by name instead) and omits the redundant `/passwordhash/i` (already
covered by `/password/i` in both). Keep both lists in sync by hand when
either one changes.

## Storage

| Store | Role |
|-------|------|
| CouchDB `tamamhealth_usage_events` | System of record for first-party dashboards |
| PostHog (optional) | Deeper funnels when `NEXT_PUBLIC_POSTHOG_KEY` is set |

## APIs

- `POST /api/usage/events` — authenticated batch ingest (max 50). Identity is
  stamped from the JWT.
- `GET /api/usage/events` — recent events (`super_admin`, `org_admin`).
- `GET /api/usage/summary` — DAU/WAU and top paths/actions.

Org admins only see their own `orgId`. Super admins may pass `?orgId=` to
filter.

## Dashboards

- Super admin: `/admin/analytics` (Usage section)
- Org admin: `/org-admin/analytics`

## Retention

Intent for v1: retain raw usage events for ~90 days. Purge is an operational
task (CouchDB `_purge` / filtered delete) when volume demands it — no automated
job ships in v1.

## PostHog

Set:

```
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

There is no PostHog SDK dependency and no `posthog.init()` call — the
integration (`src/lib/usage/posthog.ts`) is a hand-rolled `fetch` POST of
already-sanitized events straight to PostHog's `/batch/` HTTP capture
endpoint, with `$autocapture: false` stamped on every event. Autocapture
and session replay are **not** enabled (there's no client-side SDK
present to enable them with). Only sanitized events from
`src/lib/usage/tracker.ts` are ever forwarded.
