# TamamHealth Engineering Principles

> The project constitution. Every pull request, feature proposal, and
> architectural decision is checked against these rules. If a change violates
> one of them, the burden of proof is on the change — not on the principle.
>
> Companion documents: [VISION-MINDMAP.md](VISION-MINDMAP.md) (why we exist),
> [ARCHITECTURE.md](ARCHITECTURE.md) (how data flows),
> [RBAC-MATRIX.md](RBAC-MATRIX.md) (who can do what).

---

## 1. Offline-first is non-negotiable

**Rule:** No clinical workflow may require connectivity to complete. A
clinician at a Boma health post with no signal must be able to register a
patient, record a visit, prescribe, dispense, and look up history — entirely
offline.

**Why:** Most of the facilities we serve have intermittent or no
connectivity. The vision is "all of it working offline on a $50 Android
phone." A feature that silently assumes a network connection is broken for
the majority of our users.

**How to check a PR:**
- All operational reads/writes go through the PouchDB accessors in
  `platform/src/lib/db.ts` via the service layer — never directly to a remote
  API as the primary path.
- Any `fetch()` to an external service must degrade gracefully (queue, retry,
  or clearly inform the user) when offline.
- New features are tested with the network disabled (DevTools → Offline).

## 2. CouchDB is the source of truth; Postgres is disposable

**Rule:** CouchDB (and its PouchDB replicas) is the durable clinical store.
PostgreSQL is a downstream, read-only analytics projection that must be
rebuildable at any time from CouchDB's `_changes` feed. No operational code
path may write to or depend on Postgres.

**Why:** Two sources of truth means data loss and conflict ambiguity. Keeping
Postgres disposable means a facility can run with zero Postgres footprint,
and the analytics tier can be dropped/rebuilt without touching patient data.

**How to check a PR:**
- New data domains get a PouchDB database (`db.ts` accessor + entry in
  `platform/src/lib/sync/sync-config.ts`), not a Postgres table as primary
  storage.
- Postgres writes happen only inside the `/api/sync` webhook pipeline fed by
  `sync-worker/`.
- The app must boot and function with `DATABASE_URL` unset.

## 3. No mandatory cloud dependencies

**Rule:** Every external service (Sentry, SMS gateways, AI providers, payment
processors) must no-op or degrade gracefully when unconfigured. The full
stack must be self-hostable from `docker-compose.yml` with no third-party
account required.

**Why:** Independence is a survival property. Deployments in-country cannot
depend on foreign SaaS accounts, credit cards, or vendors that may become
unavailable.

**How to check a PR:**
- Follow the shim pattern in `platform/src/lib/observability.ts`: helpers
  short-circuit when no DSN/key is configured, with zero warnings spammed in
  dev.
- A fresh clone with only `.env.example` values (minus secrets) must build
  and run.
- No feature gates behind a vendor-hosted service without an offline/
  self-hosted fallback.

## 4. Deployment stays operator-simple

**Rule:** Deployment of the full stack must remain possible by a
non-specialist from the operator runbook, with no phone-home activation step.

**Why:** The people installing the system in the field are health workers,
not DevOps engineers.

**How to check a PR:**
- Changes to deployment keep `docker-compose.yml` as the single entry point
  for the facility tier; if a step gets more complicated, the
  [OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md) is updated in the same PR.

## 5. Trust boundaries are enforced by sync direction

**Rule:** The per-database sync directions in
`platform/src/lib/sync/sync-config.ts` are security boundaries, not
suggestions:

- **Push-only** (client → server, append-only): `audit_log`,
  `controlled_substance_log`, `sync_events`. Clients can never receive or
  rewrite history. (`ledger` is append-only in *content* but syncs `both`
  ways — a charge raised at one station and a payment taken at another have
  to converge live — so append-only and push-only are not the same thing.)
- **Not synced at all**: `users` — a server-only control-plane database
  (password/PIN hashes). Clients never receive user documents; the staff
  directory goes through the redacted, tenant-scoped `/api/users`.
- **Pull-only** (server → client, read-only on client): `organizations`,
  `platform_config`, `fee_schedule`. Clients can never mint accounts or
  alter pricing/config.
- **Both**: everything else, scoped to the user's `orgId`.

**Why:** In an offline-first system, the client is partially trusted. The
sync direction is what keeps audit trails tamper-resistant and identity
admin-controlled even when a device is compromised.

**How to check a PR:**
- A new database gets an explicit, justified entry in `sync-config.ts`.
- Append-only domains never mutate existing rows — corrections are new
  entries (see `MedicationAdministration.status = 'corrected'` in
  `db-types.ts` for the pattern).
- Multi-tenant isolation: every synced doc carries `orgId`; the CouchDB
  `validate_doc_update` guard (`sync/validate-doc-update.ts`) and
  `filterByScope()` (`services/data-scope.ts`) must keep working for the new
  data.

## 6. Deployment simplicity at the facility tier

**Rule:** The facility tier runs on a single machine with Docker Compose.
Orchestration platforms (Kubernetes, Nomad, ECS) are out of scope for the
facility tier. Cloud-tier complexity may grow only when a measured scaling
problem exists.

**Why:** Facility servers are cheap machines on unreliable power, maintained
by non-specialists. Every layer of operational complexity is a layer that
fails in the field with nobody to fix it. Restorability by a primary-school
teacher beats elegance.

**How to check a PR:**
- Infrastructure changes do not add new moving parts to the facility install.
- Anything that needs a second machine, a control plane, or a cloud account
  belongs to the optional cloud tier and must keep the facility tier working
  without it.

## 7. Patient data is protected by default

**Rule:** PHI never leaves the system unprotected: no patient identifiers in
logs, error reports (see `stripPHI()` in `observability.ts`), URLs, or
analytics. Access is role-scoped (`role-routes.ts`, `data-scope.ts`) and
auditable (`audit_log`).

**Why:** We hold clinical records for vulnerable populations. A leak is not
recoverable.

**How to check a PR:**
- No `console.log` of document contents in production paths.
- New routes are added to the role-route table with the narrowest set of
  roles that need them.
- Sensitive actions write an audit log entry.

---

## Using this document

- **In PR review:** the [pull request template](../.github/PULL_REQUEST_TEMPLATE.md)
  asks the author to confirm the change against these principles. Reviewers
  reject PRs that cannot answer them.
- **In planning:** when a proposal conflicts with a principle (e.g. "move to
  Kubernetes", "require an online license check"), cite the principle number
  and move on. If a principle itself needs to change, that is a deliberate,
  team-wide decision recorded by amending this file in its own PR.
