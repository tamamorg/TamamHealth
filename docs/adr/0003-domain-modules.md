# ADR 0003 — Domain modules with enforced boundaries

- **Status:** Accepted (migration in progress; `identity` landed first)
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

1. **A module's internals are private.** Other modules import
   `@/modules/<name>` and get whatever `index.ts` chooses to export. Reaching
   past it — `@/modules/pharmacy/services/dispensing-service` — is a lint
   error.
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

ESLint `no-restricted-imports` with path patterns, in
`platform/eslint.config.mjs`. **No new dependency** — the repo pins ajv 6 for
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

## Migration order

One domain per commit, each landing green (tsc, jest, lint, build). Ordered by
independence, so the pattern is proven before it meets the tangled parts:

1. **identity** — self-contained, recently reviewed end to end, and the domain
   whose boundary matters most (it is the only one that can grant access).
2. `platform`, `communication` — few inbound dependencies.
3. `revenue`, `scheduling`, `pharmacy`, `diagnostics`.
4. `patients`, `clinical` — the tangled core, done last with the most edges
   already resolved.
5. `maternal-child`, `public-health`, `facility-ops`.

Until a domain has moved, its code stays where it is and the boundary rules
simply do not match it. The lint config therefore lists modules explicitly
rather than globbing, so a half-migrated tree is a legal state rather than a
wall of errors.
