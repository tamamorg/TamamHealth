<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# TamamHealth Platform

Offline-first EHR for South Sudan. Next.js 16 (App Router) + React 19 + TypeScript, port 3000. Package name `tamamhealth`. Requires Node >=20 <25, npm >=10.

This is one package in a monorepo (`platform/`, `website/`, `mobile/`, `sync-worker/`, `country-node/`, `regional-exchange/`, `fingerprint-bridge/`). Each has its own `package.json` and lockfile — run npm commands from inside `platform/`, never the repo root. `README.md` here is the full developer reference.

## Commands

```bash
npm run dev            # dev server, localhost:3000
npm run build          # production build
npm run lint           # ESLint 9
npm test               # Jest 30 (jsdom); only src/**/*.test.ts(x) is collected
npm run test:ci        # + coverage
npm run i18n:check     # locale parity + no NEW untranslated UI text (ratcheted)
npm run db:migrate     # Postgres analytics migrations (also run at boot)
npm run setup:couchdb:validators      # validate_doc_update + _security on org-scoped DBs
npm run db:migrate:couchdb-tenants    # shared -> database-per-org (DRY_RUN=true to preview)
npm run db:verify:couchdb-tenants     # read-only cutover check
```

Never rewrite `package-lock.json` casually; the repo regenerates lockfiles with `npx npm@10`.

## Layout

- `src/app/(dashboard)/**` — ~45 protected modules (patients, consultation, notes, triage, rooming, wards, lab, pharmacy, blood-bank, controlled-substances, anc, births, deaths, immunizations, surveillance, epidemic-intelligence, billing, payments, hr, it, equipment, facility-*, government, admin, org-admin, system-admin, …).
- `src/app/` also holds `(booking)/book`, `patient-portal/`, `checkout/[linkId]`, `request-account/`, `login/`, `privacy/`, `terms/`, and `api/`.
- `src/proxy.ts` — Edge middleware (auth gate, role routing, CSRF). Next 16 name for `middleware.ts`. Only import Edge-safe modules from it.
- `src/instrumentation.ts` — server boot: fail-closed config validation, Sentry, Postgres migrations.
- `src/lib/services/**` (100+) — all business logic and DB access. `src/lib/hooks/**` (60+) — one hook per service area.
- `src/lib/db.ts` — 76 `tamamhealth_*` PouchDB databases; `src/lib/sync/**` — replication, tenant DBs, CouchDB auth/policy.
- `src/app/globals.css` — the single source of design tokens.
- `src/__tests__/**` — 59 Jest test files.

## Conventions

**Data access.** The browser calls services directly (hooks → `lib/services/*` → local PouchDB); that is what makes the app work offline, and CouchDB replication carries writes to the server. `/api/*` is for consumers with no browser — mobile, integrations, cron. Do not route UI writes through `/api`.

**Tenancy.** `filterByScope` (`lib/services/data-scope.ts`) is the only tenant barrier — the local database holds documents for every org the device replicated. Always pass a `DataScope`; never call a scoped service bare. It fails closed (missing `orgId` returns nothing); only `super_admin` and `government` see everything.

**Roles.** `lib/role-routes.ts` is the Edge-safe source of truth for 25 roles → allowed routes + default dashboard. `lib/permissions.ts` derives `allowedRoutes` from it and adds nav/icons/colours (not Edge-safe). Add a route in both directions or the proxy will 302 it away. Nurse-family roles have no station dashboard — they land on `/dashboard`; handoff is `/wards/handoff`.

**Styling.** `globals.css` owns the tokens: flat clinical look, blue for actions, ward-colour accent tints, no glassmorphism. Two traps live in it:
- a bare `label` selector force-uppercases **every** `<label>` (display:block, bold, tracked);
- `svg.lucide:not([style*="color"])` recolours icons globally, and several rules override `stroke` with `!important`.
Escape both with a scoped namespace rather than fighting specificity. Existing namespaces: `ehr-*` (shared EHR), `omrs-*` (patient chart), `pp-*` (patient portal), `sa-*` / `sadb-*` (super-admin), `msgs-*` (messages), `lg-*` (login).

**Icons.** Import from `@/components/icons` (in-repo duotone set) or the name-compat shim `@/components/icons/lucide`. Do not add new direct `lucide-react` imports.

**Dates.** Client-side "today" is local — `todayIso()` / `toIsoDate()` from `lib/date-utils.ts` (re-exported by `components/ehr/EhrMiniCalendar` for older importers). Anything bucketed by clinical day/month goes through `lib/time-juba.ts` (Africa/Juba, UTC+2, no DST). Raw `toISOString().slice()` belongs only in `app/api` server code — in the browser it reports tomorrow after 22:00 local, which silently mis-dated births, deaths, immunizations and ANC visits until the 2026-08 sweep.

**Names.** Lists and rows use `patientDisplayName` / `shortenPersonName` (first + last). Full legal name (`patientFullName`) is for the chart header, registration review, printed bills, and search matching. Staff names keep their titles ("Dr. James Igga").

**Printing.** Worklists open `PrintListDialog` (pick lists, print or CSV, pure-list iframe output). A bare `window.print()` is only correct on a page that *is* the document — see `PrintDocumentButton`.

**Lists.** The column-header row stays rendered when a list is empty; the empty message sits inside the body below it, never in place of it.

**i18n.** Two locales, both carried end to end: `en` and `apd` (Juba Arabic, RTL). Every new user-facing string needs both — `npm run i18n:check` fails otherwise. That check does two things: **locale parity** (apd covers every en key and placeholder) and an **untranslated-text ratchet**. The parity half is blind to a string that never became a key at all, which is how 152 files accumulated 661 hardcoded strings while the check passed — including 41 that DO call `useTranslation` and are half-translated, showing an Arabic reader both languages in one sentence. The ratchet lists those files as pending and fails when a file that had none gains literal JSX text. Remove a file from `UNTRANSLATED_BASELINE` in `scripts/check-i18n.mjs` once it is translated; never add one to silence a violation.

**Security.** JWT via `jose` (HS256, TTL from `SESSION_TTL_HOURS`); two-layer CSRF (Origin/Host check + HMAC double-submit bound to the session subject); login rate limits 5/username and 20/IP over 15 minutes (Upstash when configured, in-memory otherwise); token revocation is enforced in `/api/auth/me` and `getAuthPayload`, not in the Edge proxy. PHI drafts are AES-GCM encrypted with a per-tab key. `NEXT_PUBLIC_DEMO_MODE` gates demo behaviour.

**Sync.** Push is live; pull **polls** (~15 s) because ~76 concurrent longpolls saturate the browser connection limit and starve push. Per-DB `_security` uses `org:` / `role:` / `facility:` role prefixes, and the push filter plus the `validate_doc_update` validator are load-bearing — changing one without the others silently breaks replication. CouchDB 3 `_replicator` docs need absolute URLs and `auth.basic`; `/_replicate` still accepts bare names, which hides the bug.

**Config.** `lib/config-validation.ts` refuses production boot on unsafe config (JWT secret, superadmin default password, PHI-at-rest declaration, shared Redis, sync/CouchDB URLs). Add new required secrets there, and document them in `.env.example`.

## Before you call it done

- `npm run lint` and `npm test` pass.
- New user-facing strings exist in both locales (`npm run i18n:check`).
- UI changes are verified in a browser, not just typechecked.
- Multi-file changes are re-read end to end — a whole-file write can silently revert an earlier edit while `tsc` still passes.
