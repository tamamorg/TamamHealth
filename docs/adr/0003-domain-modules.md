# ADR 0003 — Domain modules with enforced boundaries

- **Status:** Accepted (migration in progress — `identity`, `communication`,
  `tenancy`, and the first `analytics` route have landed)
- **Supersedes:** nothing
- **Interacts with:** ADR 0001 (tenant scoping), `docs/ARCHITECTURE.md`

## Context

`platform/src` is 1,036 files and ~235,000 lines organised **by kind**: every
service in `lib/services/` (105 of them), every component in `components/`,
every page under `app/`. That layout answers "what kind of thing is this?" and
nothing else.

The cost is not aesthetic. It shows up in four measurable ways:

1. **No boundary exists to violate.** Any file may import any other. A billing
   component reaches into a pharmacy service, a clinical hook imports the
   admin console's helpers, and nothing objects — not the compiler, not the
   linter, not review, because the import looks exactly like every other
   import.
2. **Change lands far from where it starts.** Touching `user-service.ts` puts
   31 files at risk, spread across seven unrelated areas of the product. The
   blast radius of a change is unknowable without grepping.
3. **Files grow because nothing says where else to put anything.**
   `PatientDetailPage.tsx` is 2,704 lines; `payment-service.ts` is 1,944. Both
   grew because "the patient chart" and "payments" have no *place*, only a
   file.
4. **The seed data problem.** `db-seed.ts` is 4,378 lines because it seeds
   every domain from one file — the single clearest symptom of a codebase with
   no domain edges.

## Decision

Reorganise `src/` into **vertical domain modules** with a **single public
surface each**, and enforce the boundaries mechanically.

```
src/
  modules/
    identity/            auth, users, provisioning, MFA, account requests
      api/               route handler implementations
      services/          business logic + data access
      components/        UI owned by this domain
      types.ts           the domain's own types
      index.ts           ← the ONLY thing other modules may import
    clinical/
    pharmacy/
    diagnostics/
    patients/
    scheduling/
    revenue/
    maternal-child/
    public-health/
    facility-ops/
    communication/
    platform/            tenants, config, policy, audit, usage
  shared/                db, sync, i18n, design tokens, ui primitives,
                         date/format utils — things every domain needs and
                         no domain owns
  app/                   Next.js routing ONLY (see below)
```

### The three rules

1. **A module's internals are private.** A module has exactly three public
   entrypoints, and everything else is closed:

   ```
   @/modules/<name>              server surface — guards, policy, vocabulary
   @/modules/<name>/client       browser-safe surface
   @/modules/<name>/services/*   one service at a time
   ```

   The first two exist because a single barrel cannot serve both sides: the
   server surface reaches `node:crypto` and the database, and a client
   component that imported it put `node:fs` in the browser bundle and failed
   the production build. Splitting them makes that a decision rather than a
   property of the bundler on a given day.

   The third exists for a measured reason. Re-exporting services from the
   barrel turned every `await import()` into an eager one — a route that
   wanted `getAuthPayload` loaded PouchDB at module-init, before its first
   request — and this codebase reaches for services lazily precisely to keep
   route cold-start light. Naming the service keeps the laziness. It also
   resolves genuine ambiguity: `communication` has two services that both
   export `deleteMessage`, and a barrel would have had to rename one.
2. **`shared/` may not import a module.** It is the bottom of the graph. If
   something in `shared/` needs domain knowledge, it is not shared.
3. **Modules do not import each other's internals, and cycles are errors.**
   Two domains that genuinely need each other talk through their public
   surfaces, and if that turns out to be circular it is a signal the boundary
   is drawn in the wrong place — which is information we currently cannot get.

### Why `app/` stays thin rather than moving

Next.js App Router derives every URL from the filesystem under `src/app`. A
route cannot live inside a module. So the route file stays where the framework
requires it and contains **nothing but a re-export**:

```ts
// src/app/api/users/route.ts
export { GET, POST } from '@/modules/identity/api/users-route';
```

The handler, its guards and its tests live in the module with the rest of the
domain. This is the part of the migration that carries real risk, so it is
worth being explicit: the re-export must name its exports, because Next reads
`runtime`, `dynamic` and the HTTP verbs as static named exports and a
`export *` does not reliably satisfy that contract.

### How the rules are enforced

ESLint `no-restricted-imports` listing each module's private directories
explicitly, in `platform/eslint.config.mjs`. The first attempt expressed this
as "everything except the public entrypoints" with a negated glob —
`!(client|services)` — which reads better and silently matched nothing:
minimatch's extglob binds to a single path segment, so `core/auth` walked
straight through. An explicit list cannot fail that way.

Ordering matters too. Flat config resolves last-wins, and the carve-out that
lets a test reach into the module it is testing must come AFTER the boundary
rules; placed before them it does nothing at all.

**No new dependency** — the repo pins ajv 6 for
the eslint core binary and force-upgrades ajv/minimatch through
`package.json` overrides, so adding a graph tool like dependency-cruiser risks
the exact resolution conflict the flat-config comment already documents.

Boundary violations are **errors**, not warnings. The 449 existing warnings
demonstrate what happens to a rule nobody has to act on.

## Consequences

**Good.** The blast radius of a change becomes visible in the import graph. A
new engineer looking for "how does dispensing work" finds one directory instead
of eleven. Extracting a domain into a package later (`@tamam/pharmacy` for the
mobile app) becomes a move rather than an excavation.

**Costly.** Every import path in the codebase changes. That is a large diff
with a low defect rate — the compiler catches essentially all of it — but it
churns `git blame`. `git mv` preserves history; `git log --follow` works.

**Not free of judgement.** Some services genuinely straddle two domains.
`drug-interaction-service` is read by prescribing (clinical) and by dispensing
(pharmacy). The rule for these: it belongs to the domain that OWNS the
invariant, and the other consumes it through the public surface. Interaction
checking is a medication-safety rule, so it lives in `pharmacy` and `clinical`
imports it.

### Guards, because the failures are invisible to `tsc`

`src/__tests__/architecture/module-boundaries.test.ts` walks the static import
graph of every module's entrypoints and asserts:

- the client surface reaches no Node built-in and no database;
- the server surface pulls neither the services layer nor React;
- no file inside a module imports its own barrel (a cycle waiting to become an
  initialisation-order bug — which is exactly how it failed once);
- every module exposes a public surface at all.

It models RUNTIME reachability: `import type` is erased and dynamic `import()`
is deferred, so neither counts as an edge. Both distinctions matter — counting
type imports reported `node:crypto` against the client surface for a type that
does not exist at runtime.

The guards run over whatever is in `src/modules/`, so a new domain is covered
the day it lands. The migration itself is scripted (phases A→D plus a
service-repointing pass); the script carries the lessons above, including
re-inserting a merged import block AFTER the last surviving import so a leading
`'use client'` is never displaced.

## Migration order

One domain per commit, each landing green (tsc, jest, lint, build). Ordered by
independence, so the pattern is proven before it meets the tangled parts:

1. ~~**identity**~~ — landed. Self-contained, recently reviewed end to end, and
   the domain whose boundary matters most (it is the only one that can grant
   access). 40 files.
2. ~~**communication**~~ — landed. Messages, announcements, the notification
   bell. 11 files, and the mirror image of identity: client-heavy, so its
   `client.ts` is the main surface.
3. **platform** — partially landed as `tenancy`; config, policy, audit, and
   usage remain. Server-heavy, high fan-in; the third shape the tooling needs
   to handle.
4. **analytics** — started with the `/api/sync` ingestion and projection
   handler. Reporting and export ownership remain.
5. `revenue`, `scheduling`, `pharmacy`, `diagnostics`.
6. `patients`, `clinical` — the tangled core, done last with the most edges
   already resolved.
7. `maternal-child`, `public-health`, `facility-ops`.

Until a domain has moved, its code stays where it is and the boundary rules
simply do not match it. The lint config therefore lists modules explicitly
rather than globbing, so a half-migrated tree is a legal state rather than a
wall of errors.
