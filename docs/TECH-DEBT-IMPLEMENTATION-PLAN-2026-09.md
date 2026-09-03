# Technical-debt implementation plan — September 2026

This plan turns the repository audit into independently shippable changes. Each
phase must finish with lint, tests, localization checks, and a production build.

## Implementation status

- Phase 1 is complete.
- Phase 2 has landed the route extractions, boundary checks, and the
  prescription/ward query-cycle split. Appointment/encounter coordination is
  deliberately retained for the scheduling/clinical domain migrations, where
  it can move behind one workflow coordinator without duplicating status rules.
- Phase 3 is enforced for migrated domains; the legacy optional-scope baseline
  is ratcheted and cannot grow.
- Phase 4 has a shared primitive and three pilot hook migrations.
- Phase 5 remains the next multi-commit tranche.
- Phase 6 now collects module and hook coverage; per-domain thresholds follow
  as each domain migration lands.

## Verification finding

The normal Turbopack build cannot run in the managed workspace because its
loader attempts to bind an internal port. A network-enabled webpack fallback
confirmed the browser identity directory now uses the browser-safe
`user-client`, then exposed the next pre-existing boundary leak:
`patient-assignment-service` dynamically loads the server `user-service`, which
reaches `node:crypto`. Move patient assignment behind an authenticated API (or
split its lookup/write coordinator into explicit client and server surfaces)
before claiming webpack compatibility; do not add a bundler shim for crypto.

## Phase 1 — correctness and cleanup

- Wire `lab.tat` into the laboratory worklist's overdue state.
- Remove unused declarations and unreachable source subgraphs.
- Make dead-code validation traverse from real application entrypoints.
- Retire the obsolete TamamHealth v6 Vercel mutation/deployment scripts.

## Phase 2 — enforce architectural promises

- Add an architecture test that prevents new optional `DataScope` parameters.
- Add an architecture test that keeps migrated API routes as named re-exports.
- Move `/api/users` implementation into the identity module.
- Move `/api/sync` mapping and ingestion into an analytics-sync module.
- Break appointment/encounter and prescription/ward dependency cycles by
  extracting explicit workflow coordinators.

## Phase 3 — tenant-scope hardening

- Make scoped service entrypoints require `DataScope`.
- Give trusted national/background operations explicitly named system-scope
  entrypoints rather than using an omitted argument as authority.
- Migrate callers one domain at a time, starting with patient, payment,
  encounter, and communication reads.
- Add cross-tenant contract tests for every migrated service.

## Phase 4 — reusable offline query infrastructure

- Introduce one tested live-query primitive for initial load, PouchDB changes,
  cancellation, scope changes, loading, and error state.
- Migrate the repeated hook pattern domain by domain.
- Turn the React effect warnings back into errors after the migration.

## Phase 5 — vertical domain extraction

- Revenue: split payments, links/providers, insurance/claims, refunds/plans,
  and invoices from `payment-service.ts`.
- Patients: split chart orchestration, panels, printing, and demographics from
  `PatientDetailPage.tsx`.
- Diagnostics: own laboratory and radiology workflows and shared lifecycle UI.
- Demo data: replace `db-seed.ts` with a seed runner and per-domain fixtures.
- Persistence vocabulary: move domain documents out of `db-types.ts`, retaining
  only shared persistence primitives in the shared layer.

## Phase 6 — coverage gates

- Collect coverage from modules, hooks, and API handler implementations, not
  services alone.
- Establish ratcheted per-domain thresholds, beginning with tenancy, payments,
  sync ingestion, transfers, and medication safety.
- Require every newly migrated domain to meet its threshold before it is added
  to `MIGRATED_MODULES`.
