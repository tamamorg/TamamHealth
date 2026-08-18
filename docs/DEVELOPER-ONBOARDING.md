# TamamHealth Developer Onboarding

> From clone to productive in under an hour. Read
> [PRINCIPLES.md](PRINCIPLES.md) first — it's short and every PR is reviewed
> against it. [ARCHITECTURE.md](ARCHITECTURE.md) explains where data lives.

---

## 1. First run (no backend services needed)

The platform runs fully offline against browser-local PouchDB databases with
seeded demo data. You do **not** need CouchDB, Postgres, or Docker for
feature work.

```bash
git clone <repo-url> && cd TamamHealth/platform
npm install

# Interactive setup: writes .env.local (node scripts/setup.mjs)
npm run setup

# macOS/Linux: raise the file-descriptor limit first or Next.js dev mode
# hits EMFILE errors and every route 404s:
ulimit -n 10240

npm run dev          # http://localhost:3000
```

(There's also a repo-root `npm run setup`, which runs `scripts/setup.sh` —
prereq checks plus seeding `platform/.env.local` from `.env.example`
non-interactively. Either gets you a working `.env.local`; the one above is
the interactive per-developer version.)

First page load takes a while: Next.js cold-compiles, then the browser seeds
~77 demo databases ("Initializing offline database..."). One-time per
browser profile.

Log in with the demo credentials (generated into
`platform/.seed-credentials.json` on first seed; never committed).

Gotchas:

- Leave `DATABASE_URL` unset unless you are working on the analytics tier.
  With it set, startup runs Postgres migrations and refuses to boot if
  Postgres isn't reachable.
- Changing `NEXT_PUBLIC_*` env values requires a dev-server restart (they're
  inlined at build time).
- To force a full re-seed of demo data, bump `SEED_VERSION` in
  `src/lib/db.ts` (destroys all local data) — or call
  `resetAllDatabases()` from the console.

## 2. Repository map

```
TamamHealth/
├── platform/          # The EMR (Next.js 16, App Router) — most work happens here
│   └── src/
│       ├── app/       # Routes: pages + /api/* handlers
│       ├── components/
│       └── lib/
│           ├── db.ts             # PouchDB accessors — ~77 typed databases
│           ├── db-types*.ts      # Document schemas (split by domain)
│           ├── db-seed.ts        # Demo data seeding (SEED_VERSION gate)
│           ├── db/               # Postgres migrations + client (analytics only)
│           ├── sync/             # Replication: sync-config, manager, CouchDB guards
│           ├── services/         # ALL business logic — 100+ domain services
│           ├── permissions.ts    # Role configs + nav
│           ├── role-routes.ts    # Route gating table (Edge proxy + server + client)
│           └── observability.ts  # Sentry shim (no-ops without DSN)
├── website/           # Marketing site (Next.js)
├── mobile/            # React Native client (early)
├── sync-worker/       # CouchDB _changes → /api/sync poller (analytics)
├── fingerprint-bridge/ # Localhost HTTP bridge for USB fingerprint scanners
├── country-node/      # National aggregation tier (skeleton)
├── regional-exchange/ # Cross-border tier (skeleton)
├── infra/             # Terraform (DigitalOcean App Platform, AWS CloudFormation)
├── scripts/           # Backups, preflight, CouchDB dumps
├── docs/              # You are here
└── docker-compose.yml # Full-stack production deployment
```

## 3. The golden rules of the codebase

1. **Components never touch the database.** UI → service function
   (`src/lib/services/*-service.ts`) → `db.ts` accessor. If you find
   yourself calling `getDB()` in a component, stop.
2. **Everything works offline.** The primary data path is local PouchDB.
   Test your feature with DevTools → Network → Offline before opening a PR.
3. **Every synced document carries `orgId`.** Multi-tenant isolation depends
   on it (CouchDB validators reject docs without it).
4. **Append-only domains stay append-only.** Audit log, controlled-substance
   log, ledger, MAR entries: corrections are new rows, never edits.
5. **Postgres is optional.** Nothing in the operational path may require it.

## 4. Common tasks

### Add a new data domain

Follow the checklist at the bottom of [ARCHITECTURE.md](ARCHITECTURE.md):
types → `db.ts` accessor → `sync-config.ts` entry → seed (optional) →
service → UI. Sync direction and `orgScoped` need explicit justification in
the PR.

### Add a page/route

1. Create the page under `src/app/`.
2. Add the path to the allowed routes of each role that needs it in
   `src/lib/role-routes.ts` (narrowest set wins — see
   [RBAC-MATRIX.md](RBAC-MATRIX.md)).
3. Add a nav item in `permissions.ts` if it should appear in the sidebar.

### Work on the sync/analytics tier

```bash
# Full stack locally:
docker compose up -d                          # CouchDB + platform
docker compose --profile analytics up -d      # + Postgres + sync-worker

# Install CouchDB validators (org isolation guards):
npm run setup:couchdb:validators

# Run Postgres migrations manually:
npm run db:migrate
```

### Tests and quality gates

```bash
npm test                 # Jest
npm run lint             # next lint
npx tsc --noEmit         # type-check (CI runs this)
```

CI (`.github/workflows/ci.yml`) runs lint + type-check + test + build for
`platform`, `website`, `mobile`, and `fingerprint-bridge` on every PR, plus
an `infrastructure` job (Terraform fmt/validate). The build step catches
server/client boundary mistakes — run `npm run build` locally if you touched
env handling or `instrumentation.ts`.

## 5. Glossary (domain terms you'll meet in code)

| Term | Meaning |
|---|---|
| Boma / Payam / County / State / National | South Sudan's five health-system levels (see `FACILITY_LEVELS` in `db-types.ts`) |
| BHW | Boma Health Worker — community-level worker covering ~40 households |
| ETAT | WHO Emergency Triage Assessment & Treatment (RED/YELLOW/GREEN priorities) |
| ANC | Antenatal care — WHO 8-contact model |
| CRVS | Civil Registration & Vital Statistics (births/deaths) |
| MAR | Medication Administration Record (`administrations[]` on prescriptions) |
| DHIS2 | National health information system TamamHealth exports to |
| MPI | Master Patient Index — patient dedup/matching (`mpi-service.ts`) |
| ICD-11 | WHO diagnosis coding standard used throughout |

## 6. Jira, GitHub, and deploy tracking

- **Jira:** tamamorg.atlassian.net, project **KAN** — include `KAN-N` in branches, commits, and PRs ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- **Staging:** `deploy-staging.yml` fires automatically once `ci.yml` passes on `main`.
- **Production:** `deploy-production.yml` is manual (`workflow_dispatch`) and requires environment approval.

Operator guide: [operations/jira-github-do-tracking.md](operations/jira-github-do-tracking.md).
