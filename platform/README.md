# TAMAMHEALTH - Digital Health Records System for South Sudan

A comprehensive, offline-first healthcare information system built for South Sudan's health sector. TAMAMHEALTH provides electronic medical records, clinical decision support, disease surveillance, vital registration, and government health oversight across all levels of the health system — from community boma health workers to the national Ministry of Health.

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Authentication & Roles](#authentication--roles)
- [Modules & Features](#modules--features)
- [Clinical Decision Support](#clinical-decision-support)
- [Data Architecture](#data-architecture)
- [Offline-First Design](#offline-first-design)
- [Multi-Tenancy & Organizations](#multi-tenancy--organizations)
- [Security](#security)
- [Testing](#testing)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)

---

## Overview

TAMAMHEALTH is purpose-built for the South Sudanese health system, addressing the unique challenges of delivering healthcare across 10 states with limited connectivity, infrastructure, and resources. The system supports:

- **Hospital networks** — Patient registration, consultations, wards, referrals, lab, pharmacy, billing
- **Community health** — household follow-up tracking across boma/payam administrative geography
- **Maternal & child health** — 8-contact ANC protocol (WHO), birth registration, immunization tracking
- **Disease surveillance** — Real-time outbreak alerts, epidemic intelligence
- **Vital registration** — Birth and death CRVS with ICD-11 cause coding
- **Government oversight** — National health statistics, facility assessments, DHIS2 export
- **Patient-facing access** — Patient portal, public online booking, telehealth visits

The system works entirely offline and syncs when connectivity is available.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack in dev) |
| Language | TypeScript 5 |
| UI | React 19.2, Tailwind CSS 3.4 |
| Icons | In-repo duotone set — `@/components/icons` (`@/components/icons/lucide` is a name-compatibility shim) |
| Charts | Recharts 3.7 |
| Calendar | react-big-calendar |
| Mapping | Offline SVG — real ADM1 boundaries in `src/data/south-sudan-geo.ts` + `src/lib/maps/south-sudan-projection.ts` (no tile server, no Leaflet) |
| Client Database | PouchDB 9 (browser IndexedDB) |
| Server Database | CouchDB 3 (sync), PostgreSQL 16 (analytics) |
| Authentication | JWT (jose, HS256), bcryptjs |
| Telehealth video | LiveKit (self-hosted; optional) |
| Observability | Sentry (`@sentry/nextjs`, no-op without a DSN) |
| Testing | Jest 30 (via `next/jest` / SWC, JSDOM) |
| Linting | ESLint 9 (`eslint-config-next`) |

---

## Getting Started

### Prerequisites

- **Node.js** >= 20.0.0 and < 25 ([download](https://nodejs.org))
- **npm** >= 10.0.0 (comes with Node.js)
- **Git** ([download](https://git-scm.com))
- **PostgreSQL** 16 (optional, for national analytics)
- **CouchDB** 3+ (optional, for multi-facility sync)

Works on **Windows**, **macOS**, and **Linux**.

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd TamamHealth/platform

# 2. Install dependencies
npm install

# 3. Run the setup script (interactive env configuration)
npm run setup
```

`npm run setup` checks your Node version, then copies `.env.example` to
`.env.local`, generates a random JWT secret, and prompts for organization name,
demo mode, and (in production mode) the initial admin details. It does not
install dependencies — run `npm install` yourself.

Then start the server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

In demo mode the app seeds demo data automatically on first load — sample
patients, hospitals, users, and health records are created in your browser's
local database.

### Demo Credentials

When running in demo mode (default), a password is generated for each seeded
user on first server boot and written to `platform/.seed-credentials.json`
(mode `0600`, gitignored). Hardcoded passwords in this README would have meant
every install shipped the same secrets — the per-install design avoids that.

Read the passwords after the first boot:

```bash
cat platform/.seed-credentials.json
```

The one exception is the platform super-admin: `superadmin` ships with the
well-known initial password `Superadmin!` so the account is always reachable
out of the box. Override it with `SUPERADMIN_INITIAL_PASSWORD` — production
boot is **refused** if it is unset or still the default (see
`src/lib/config-validation.ts`).

On serverless / multi-instance hosts where no shared writable filesystem
exists, set `SEED_CREDENTIALS_SECRET` instead. Every instance then derives the
same passwords by HMAC from that secret and no credentials file is written.

The login page deliberately offers **no** account picker or role chips — a
sign-in page that hands working credentials to anyone who loads it is not
something to keep behind a flag. Accounts are issued by an administrator, or
requested through `/request-account`.

Seeded usernames include:

| Username | Role |
|----------|------|
| `superadmin` | Platform Super Admin |
| `admin` | Government (Ministry of Health) |
| `dr.wani` / `dr.achol` / `dr.ochalla` | Doctor |
| `co.deng` | Clinical Officer |
| `nurse.stella` / `nurse.wau` | Nurse |
| `triage.mary` / `rooming.sara` | Triage / Rooming Nurse |
| `midwife.nyakong` | Midwife |
| `lab.gatluak` | Lab Technician |
| `pharma.rose` | Pharmacist |
| `desk.amira` | Front Desk |
| `cashier.deng` / `biller.nyandeng` | Cashier / Medical Biller |
| `supt.lado` / `manager.aluel` | Medical Superintendent / Hospital Manager |
| `county.lopez` | County Health Director |
| `org.admin` / `dr.mercy` / `nurse.mercy` | Private-org accounts (Mercy General Hospital) |

The full roster lives in `DEMO_USER_PROFILES` in
[`src/lib/seed-credentials.ts`](src/lib/seed-credentials.ts).

### Docker Installation

Run the whole stack from the **repository root** with Docker Compose:

```bash
docker compose up --build
```

Required before the first run: `./.env` (compose-level credentials) and
`./platform/.env.production` (platform runtime env). `NEXT_PUBLIC_*` values are
baked in at build time, so they must be present in `.env.production` **before**
`docker compose build`.

Services and default host ports:

| Service | Host port | Notes |
|---|---|---|
| `platform` | `3000` (`PLATFORM_PORT`) | this app |
| `website` | `3001` (`WEBSITE_PORT`) | marketing site (`website/`) |
| `couchdb` | `127.0.0.1:5984` (`COUCHDB_PORT`) | loopback only — reverse-proxy with TLS for external access |
| `postgres` | `127.0.0.1:5432` (`POSTGRES_PORT`) | postgres:16-alpine, DB `safeguard_junub` |
| `sync-worker` | — | polls CouchDB `_changes` and POSTs batches to this app's `/api/sync` for Postgres ingestion (`sync-worker/`) |
| `couchdb-backup` | — | nightly `dump-couchdb.sh`, 14-day retention |

### Optional: PostgreSQL (National Analytics)

PostgreSQL is only needed for government dashboards and cross-facility analytics. The app works fully without it using browser-local PouchDB.

```bash
# 1. Create the database
createdb safeguard_junub

# 2. Set the connection string in .env.local
#    DATABASE_URL=postgresql://user:password@localhost:5432/safeguard_junub

# 3. Apply schema migrations
npm run db:migrate
```

Migrations also run automatically at server boot via Next.js
[`instrumentation.ts`](src/instrumentation.ts), so `npm run db:migrate` is
only needed for ad-hoc operator use (e.g. before swapping container images).
The runner takes a Postgres advisory lock so rolling-deploy replicas can't
race; set `SKIP_DB_MIGRATIONS=true` to disable the boot-time runner. Each
`*.sql` file under [`src/lib/db/migrations/`](src/lib/db/migrations/) runs once
and its hash is recorded in the tracking table; edit an applied migration and
the runner refuses to start. If your `DATABASE_URL` points at a transaction
pooler, also set `DATABASE_DIRECT_URL` so the session-level lock works.

### Database Runtimes

The platform uses a **single PouchDB API with two runtime backings** so the same code paths work client-side and server-side:

| Runtime | Package | Backing store | Used for |
|---|---|---|---|
| Browser | `pouchdb-browser` (+ `pouchdb-find`) | IndexedDB | Clinician dashboard — offline-first writes, background replication to CouchDB |
| Server (Node) | `pouchdb-core` + `pouchdb-adapter-http` (+ `mapreduce`, `find`) | CouchDB over HTTP | `/api/*` REST routes — mobile apps, integrations, cron jobs |

Both share the same service functions (`patientsDB()`, `medicalRecordsDB()`, etc.), so route handlers don't care which runtime they run in. See [`src/lib/db.ts`](src/lib/db.ts). The server path deliberately avoids the full `pouchdb` package because it bundles leveldb native binaries.

**Databases auto-create**: PouchDB's http adapter issues `PUT /<db>` on first access when the admin credentials permit it (they do on a fresh CouchDB install). No manual bootstrap is required — the 76 `tamamhealth_*` databases appear the first time a service touches them.

### Server-side CouchDB env (required for `/api/*` in production)

```bash
COUCHDB_URL=http://couchdb:5984              # internal network URL
COUCHDB_ADMIN_USER=admin
COUCHDB_ADMIN_PASSWORD=<strong-random>       # >= 20 chars when tenant DBs are on
```

In `docker-compose.yml` these are wired automatically from the root `./.env`; the platform container reaches CouchDB over the internal docker network. This is separate from `NEXT_PUBLIC_COUCHDB_URL`, which is the public HTTPS endpoint the **browser** hits during replication.

### Optional: CouchDB Sync

CouchDB enables multi-device sync across facilities. Without it, the app runs fully offline in the browser.

```bash
# 1. Start CouchDB (via Docker or native install)
docker run -d -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=<password> couchdb:3

# 2. Create databases and configure CORS
COUCHDB_URL=http://admin:<password>@localhost:5984 bash scripts/setup-couchdb.sh

# 3. Enable sync in .env.local
#    NEXT_PUBLIC_SYNC_ENABLED=true
#    NEXT_PUBLIC_COUCHDB_URL=http://admin:<password>@localhost:5984
#    COUCHDB_WEBHOOK_SECRET=<32+ chars>
```

> **Windows users**: The CouchDB setup script requires bash. Use WSL2, Git Bash, or run CouchDB via Docker.

**Pull replication polls, it does not longpoll.** A single client runs ~76
databases; left as continuous longpolls their pull feeds saturate the browser's
per-host connection limit and starve push, so new local writes never reach the
server. Pull therefore uses `poll` on a 15 s interval while push stays live.
Override for debugging with `NEXT_PUBLIC_SYNC_PULL_MODE=live` /
`NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS`. See
[`src/lib/sync/sync-manager.ts`](src/lib/sync/sync-manager.ts).

#### Server-side org-scoping enforcement (validate_doc_update)

`scripts/setup-couchdb.sh` installs a `_design/tamamhealth-org-scope` design doc on every `orgScoped: true` database (or run it standalone with `npm run setup:couchdb:validators`). The script runs through `tsx` so the database list and validator function come from the same TypeScript modules as the app — security policy is never duplicated into a deployment script.

It is a **one-way migration** — once installed, any client writing a document without a string `orgId` will be rejected and the write won't replicate. Existing docs that are missing `orgId` keep their current state but become unupdateable until backfilled. A syntax error in the `validate_doc_update` function **blocks ALL writes** to the affected database, so always test on staging before running against production.

Per-database `_security` grants membership by role name — `org:<orgId>`,
`facility:<id>`, `role:<platformRole>` — which is what the validator inspects
to decide whether a write is allowed.

#### Database-per-organization (tenant databases)

Shared CouchDB databases cannot enforce per-document *read* ACLs. Production
must therefore either route each organization to its own database or stay
explicitly in single-org mode:

```bash
# Non-destructive copy of shared DBs into <base>--<orgId> tenant databases.
# Source databases are never deleted; re-running is safe.
COUCHDB_URL=... COUCHDB_ADMIN_USER=... COUCHDB_ADMIN_PASSWORD=... \
COUCHDB_TENANT_ORG_IDS=org-moh-ss,org-mercy \
  npm run db:migrate:couchdb-tenants          # DRY_RUN=true to preview

# Read-only verification of the cutover
COUCHDB_TENANT_ORG_IDS=org-moh-ss,org-mercy npm run db:verify:couchdb-tenants
```

Then set `NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true` (and unset
`SINGLE_ORG_MODE`). Naming and parsing live in
[`src/lib/sync/tenant-database.ts`](src/lib/sync/tenant-database.ts); the
separator is `--`.

> CouchDB 3 `_replicator` documents need **absolute** source/target URLs with
> `auth.basic` credentials. Bare database names still work through the ad-hoc
> `/_replicate` endpoint, which is what hides the bug during testing.

### Production Deployment

```bash
# Build the production bundle
npm run build

# Start the production server
npm start
```

Boot is fail-closed: `src/instrumentation.ts` runs
`validateProductionConfig()` and **refuses to start** when the configuration is
unsafe. The rules it enforces (all skipped when `NEXT_PUBLIC_DEMO_MODE=true`):

- [ ] `NEXT_PUBLIC_DEMO_MODE=false`
- [ ] `JWT_SECRET` set, non-placeholder, >= 32 chars (`openssl rand -base64 48`)
- [ ] `SUPERADMIN_INITIAL_PASSWORD` set, >= 16 chars, not `Superadmin!`
- [ ] `ADMIN_INITIAL_PASSWORD` non-placeholder if set; `NEXT_PUBLIC_ADMIN_PASSWORD` must **not** be set
- [ ] PHI at rest declared: `PHI_AT_REST_STRATEGY=disk-encryption` (the supported strategy for offline-first) **or** `PHI_ENCRYPTION_ENABLED=true` with a 32-byte `PHI_ENCRYPTION_KEY`
- [ ] `UPSTASH_REDIS_REST_URL`/`_TOKEN` set — or `SINGLE_REPLICA_ACK=true` to confirm exactly one replica
- [ ] `NEXT_PUBLIC_SYNC_ENABLED=true` and `COUCHDB_URL` set (https, non-local hostname; the internal compose hop `http://couchdb:5984` is allowed)
- [ ] `NEXT_PUBLIC_COUCHDB_URL` set and `COUCHDB_WEBHOOK_SECRET` >= 32 chars
- [ ] `NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true` or `SINGLE_ORG_MODE=true`
- [ ] LiveKit: all three of `LIVEKIT_URL` (wss://), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — or none
- [ ] `DATABASE_URL` set if you want national analytics
- [ ] HTTPS terminated in front of the app (secure cookies and CSP headers)

Deployment paths and runbooks live outside this package:
`docs/DEPLOY-PRODUCTION.md`, `docs/DEPLOY-DIGITALOCEAN.md`,
`docs/GO-LIVE-STEP-BY-STEP.md`, `docs/OPERATOR-RUNBOOK.md`, and the workflows
under `.github/workflows/` (`ci.yml`, `deploy-production.yml`,
`deploy-staging.yml`, `deploy-app-platform.yml`).

---

## Project Structure

```text
src/
├── proxy.ts                   # Edge middleware: auth gate, role routing, CSRF
├── instrumentation.ts         # Server boot: config validation, Sentry, migrations
├── instrumentation-client.ts  # Browser Sentry init
├── app/
│   ├── (dashboard)/           # Protected app routes (~45 modules)
│   │   ├── dashboard/         # Shared clinical workspace (doctors, clinicians, nurses)
│   │   ├── patients/          # Patient registry; [id] is the OpenMRS-style chart
│   │   ├── consultation/      # Clinical documentation
│   │   ├── notes/             # Clinical notes & signing inbox
│   │   ├── triage/ rooming/   # ETAT triage and rooming stations
│   │   ├── wards/             # Ward roster, MAR, handoff
│   │   ├── appointments/      # Scheduling
│   │   ├── telehealth/        # Video visit scheduling & sessions
│   │   ├── referrals/         # Referral management
│   │   ├── lab/ pharmacy/     # Orders, results, dispensing, inventory
│   │   ├── blood-bank/        # Blood stock & transfusion
│   │   ├── controlled-substances/  # Controlled drug register
│   │   ├── anc/ births/ deaths/ immunizations/
│   │   ├── surveillance/ epidemic-intelligence/ alerts/
│   │   ├── mch-analytics/ vital-statistics/ data-quality/ reports/
│   │   ├── dhis2-export/      # DHIS2 interoperability
│   │   ├── billing/ payments/ # Charges, invoices, claims, payment links
│   │   ├── hr/ it/ equipment/ # Staffing, IT ops, asset register
│   │   ├── facility-management/ facility-overview/ facility-settings/
│   │   ├── facility-assessments/ emergency-preparedness/
│   │   ├── hospitals/ my-facility/ inquiries/ messages/ notifications/
│   │   ├── government/ public-stats/
│   │   ├── admin/             # Super-admin command center
│   │   ├── org-admin/         # Organization management
│   │   ├── system-admin/      # Platform/system operations
│   │   └── settings/          # User + facility preferences
│   ├── (booking)/book/        # Public online booking (per-practice)
│   ├── patient-portal/        # Patient-facing portal
│   ├── telehealth/join/       # Patient video join links
│   ├── checkout/[linkId]/     # Public payment links
│   ├── request-account/       # Public account request form
│   ├── login/ privacy/ terms/
│   ├── api/                   # ~50 REST route groups (auth, patients, fhir, sync, …)
│   └── globals.css            # Single source of design tokens
├── components/                # 44 shared components + 28 feature folders
│   ├── ehr/chart/             # OpenMRS O3-style patient chart shell
│   ├── icons/                 # Duotone icon set (+ lucide-name shim)
│   ├── admin/ patients/ patient-portal/ telehealth/ payments/ …
│   ├── PrintListDialog.tsx    # Pick-lists + print/CSV, iframe output
│   └── ClinicalScribe.tsx     # Voice/text clinical note parser
├── lib/
│   ├── context.tsx            # AppContext & useApp hook
│   ├── db.ts                  # PouchDB database factory (76 databases)
│   ├── db-types*.ts           # Document interfaces, split by domain
│   ├── db-seed.ts             # Demo data seeding
│   ├── permissions.ts         # Role permissions, nav, module gating
│   ├── role-routes.ts         # Edge-safe role → route allow-list (25 roles)
│   ├── auth-token.ts / session.ts / csrf.ts / rate-limit.ts / token-blacklist.ts
│   ├── config-validation.ts   # Fail-closed production boot checks
│   ├── field-encryption.ts / draft-storage.ts   # PHI at rest, PHI drafts
│   ├── hooks/                 # 60+ React hooks (one per service area)
│   ├── services/              # 100+ business-logic modules (incl. data-scope.ts)
│   ├── sync/                  # Sync manager, tenant DBs, CouchDB auth & policy
│   ├── i18n/                  # en + apd (Juba Arabic) locales
│   ├── db/migrations/         # PostgreSQL analytics schema
│   └── maps/                  # South Sudan projection helpers
├── data/
│   ├── mock.ts                # Seed/reference data (hospitals, patients, alerts)
│   ├── south-sudan-geo.ts     # Real ADM1 boundaries for offline SVG maps
│   └── allergens.ts
└── __tests__/                 # 59 Jest test files
```

---

## Authentication & Roles

### Authentication Flow

1. User submits credentials at `/login`
2. Server validates against the bcrypt-hashed password on the user document
3. JWT (HS256, `jose`) is set as an HTTP-only cookie; TTL comes from `SESSION_TTL_HOURS` and is shared by the cookie `Max-Age` and the JWT `exp`
4. A non-httpOnly CSRF twin cookie (`tamamhealth-csrf`, `SameSite=strict`) is minted alongside it
5. `src/proxy.ts` (Edge middleware) enforces route-level access per role and both CSRF layers
6. Rate limiting: 5 failed attempts per username, 20 per IP, each a 15-minute lockout

### RBAC — 25 User Roles

`src/lib/role-routes.ts` is the Edge-safe single source of truth for
role → allowed routes and default dashboard. `src/lib/permissions.ts` derives
its `allowedRoutes` from that table and adds nav labels, icons, and colours
(which are not Edge-safe).

| Role | Default dashboard |
|------|-------------------|
| `super_admin` | `/admin` |
| `org_admin` | `/facility-management` |
| `doctor`, `clinical_officer`, `clinician` | `/dashboard` |
| `nurse`, `midwife`, `triage_nurse`, `rooming_nurse` | `/dashboard` |
| `medical_superintendent` | `/dashboard` |
| `lab_tech` | `/dashboard/lab` |
| `pharmacist` | `/dashboard/pharmacy` |
| `front_desk`, `central_registration_clerk`, `clinic_clerk` | `/dashboard/front-desk` |
| `cashier`, `medical_biller` | `/payments` |
| `government` | `/government` |
| `county_health_director` | `/dashboard/state` |
| `data_entry_clerk`, `hrio`, `records_hmis_officer` | `/dashboard/data-entry` |
| `nutritionist` | `/dashboard/nutrition` |
| `radiologist` | `/dashboard/radiology` |
| `hospital_manager` | `/facility-management` |

Nurse-family roles have **no** standalone station dashboard — they land on the
shared clinical workspace at `/dashboard`, role-adapted the same way doctors
are. The retired station pages live at `/triage`, `/wards`, `/wards/mar`, and
`/wards/handoff`.

Unauthorized routes redirect to the user's default dashboard.

---

## Modules & Features

### Clinical

- **Patient Registry** — Registration, search, filtering by demographics and location. `/patients/[id]` is an OpenMRS O3-style chart shell (`components/ehr/chart/`) with deep-linkable tabs (`?tab=&focus=`).
- **Consultation & Notes** — Chief complaint, vital signs, physical examination, structured allergies, problem list, prescribing, lab ordering, and a signing inbox for note completion.
- **Triage & Rooming** — ETAT triage assessment and rooming stations feeding the shared worklists.
- **Wards** — Ward roster, medication administration record (MAR), and shift handoff.
- **Referrals** — Inter-facility referral with urgency levels, status tracking, and clinical reason documentation.
- **Laboratory** — Test ordering, sample tracking, result entry with status workflow.
- **Pharmacy** — Prescription queue, dispensing, inventory, plus a controlled-substances register.
- **Blood Bank** — Stock, crossmatch, and transfusion records.
- **Telehealth** — Scheduled video visits over LiveKit, with patient join links at `/telehealth/join/[sessionId]`, device checks, consent policy, and a maintenance sweep for abandoned sessions.

### Maternal & Child Health

- **Antenatal Care (ANC)** — WHO 8-contact protocol. Gravida/parity, vitals, fetal assessment, risk stratification, birth planning.
- **Birth Registration** — CRVS-compliant registration with child and parent details, birth weight, delivery method, attendant type, certificate number.
- **Immunizations** — Schedule tracking, coverage monitoring, campaign management.
- **MCH Analytics** — Cascade analysis, mortality tracking, outcomes visualization.

### Public Health

- **Disease Surveillance** — Disease alerts with severity classification, geographic distribution, and trend analysis over offline SVG maps.
- **Epidemic Intelligence** — Outbreak tracking, cluster detection, response coordination.
- **Emergency Preparedness** — Facility emergency plans and readiness.
- **Death Registration** — CRVS-compliant registration with ICD-11 cause coding (immediate, antecedent, underlying), manner of death, maternal death linkage.
- **Vital Statistics** — Population health metrics and demographic analysis.

### Revenue & Operations

- **Billing & Payments** — Charges, fee schedule, invoices, claims, eligibility checks, refunds, payment plans, saved methods, and public payment links at `/checkout/[linkId]` (M-Pesa / Airtel / Flutterwave webhooks).
- **HR** — Leave, schedules, and payroll entries (staff roster itself lives in User Accounts).
- **Equipment & Assets** — Asset register and maintenance.
- **IT / System Admin** — Platform and facility operations surfaces.
- **Supply Chain** — Stock and consumption tracking behind pharmacy/nutrition.

### Administration & Reporting

- **Facility Management / Overview / Settings** — Facility hierarchy, entitlements, and configuration.
- **Facility Assessments** — Readiness evaluations (infrastructure, staffing, services, equipment).
- **Data Quality** — Completeness and quality monitoring for submitted health data.
- **DHIS2 Export** — Interoperability with the national DHIS2 health information system.
- **FHIR & Terminology** — `/api/fhir` and `/api/terminology` expose identifiers and code systems under `NEXT_PUBLIC_FHIR_NAMESPACE_BASE`.
- **Reports** — Configurable health system reporting.
- **Public Statistics** — Public-facing health dashboard (no login required).

### Communication & Patient Access

- **Messaging** — In-app messaging between providers and patients, with an optional SMS channel.
- **Patient Portal** — Patient-facing record, appointments, and messages (optional SMS OTP second factor).
- **Online Booking** — Public per-practice booking at `/book/[practice]` with slot holds and intake forms.
- **Account Requests** — Public `/request-account` form feeding an `AccountRequestQueue` in the admin and org-admin user pages.
- **Reminders** — Appointment and patient reminders dispatched by a scheduled job.

### Platform Administration

- **Super-Admin Command Center** — `/admin` with organizations, users, billing, analytics, risk, audit, support, sync, interop, data governance, security, configuration, and feature flags.
- **Organization Management** — Create and manage organizations with custom branding and feature flags.
- **Audit Logging** — Audit trail of authentication, data access, and modifications.

---

## Clinical Decision Support

Decision support runs entirely in the browser with no network dependency:

- **Vital-sign thresholds** — `lib/clinical-guidelines.ts` bands temperature, blood pressure, pulse, respiratory rate, SpO2, BMI, and glucose into `normal | warning | danger`, sourced from WHO IMAI, the PIH Clinical Handbook, and the South Sudan MoH triage protocol. The bands tint tiles and badges across the EHR.
- **Drug interactions** — `lib/services/drug-interaction-service.ts` (and `/api/drug-interactions`) checks contraindicated / serious / moderate drug-drug pairs, based on WHO Essential Medicines interactions and BNF/BNFC, scoped to medicines common in South Sudanese hospitals.
- **Allergy checking** — `lib/services/allergy-service.ts` keeps structured allergies on the patient document so they ride the patient's own sync and scoping, and surface in the chart, prescribing screen, MAR, SBAR, and referrals.
- **Care alerts** — `lib/services/care-alert-service.ts` raises follow-up and safety alerts on the worklists.
- **Assessment instruments & symptom templates** — `lib/clinical/` holds the ETAT triage display, scored assessment instruments, vitals maths, and diagnosis validation.
- **ICD-11 coding** — `lib/icd11-codes.ts` plus the terminology API back cause-of-death and diagnosis coding.

### Clinical Scribe

`components/ClinicalScribe.tsx` with `lib/services/clinical-scribe-service.ts`:

- Voice-to-text and typed transcription of clinical encounters
- Extraction of chief complaint, vital signs, exam findings, and assessment into structured fields
- Transcript / fields / SOAP preview before the clinician applies anything to the note

---

## Data Architecture

### PouchDB Collections (Client-Side)

76 `tamamhealth_*` databases are declared in [`src/lib/db.ts`](src/lib/db.ts). A representative sample:

| Database | Purpose |
|----------|---------|
| `tamamhealth_patients` | Patient demographics, registration, structured allergies |
| `tamamhealth_users` | User accounts |
| `tamamhealth_hospitals` | Health facility records |
| `tamamhealth_medical_records` | Consultations & diagnoses |
| `tamamhealth_encounters` | Encounter/visit records |
| `tamamhealth_referrals` | Patient referral network |
| `tamamhealth_lab_results` | Laboratory orders & results |
| `tamamhealth_prescriptions` | Medication orders |
| `tamamhealth_appointments` | Scheduling |
| `tamamhealth_telehealth` | Video visit sessions |
| `tamamhealth_wards` / `_handoffs` | Admissions, ward state, shift handoff |
| `tamamhealth_triage` | Triage assessments |
| `tamamhealth_messages` / `_conversations` | Messaging |
| `tamamhealth_births` / `_deaths` | CRVS registration |
| `tamamhealth_immunizations` / `_anc` | Vaccination and antenatal care |
| `tamamhealth_invoices` / `_charges` / `_claims` / `_payments` | Revenue cycle |
| `tamamhealth_blood_bank` / `_controlled_substance_log` | Regulated stock |
| `tamamhealth_organizations` / `_platform_config` | Tenancy & platform settings |
| `tamamhealth_audit_log` | Audit trail |

### Server-Side

- **CouchDB 3** — Optional bidirectional sync with PouchDB for multi-device/multi-site access, with per-database `_security` and `validate_doc_update` org scoping
- **PostgreSQL 16** — Aggregated analytics and reporting. The separate `sync-worker` package polls CouchDB `_changes` and POSTs batches to `/api/sync`, which writes them to Postgres (server-only, never exposed to the browser)

### Business Logic

`lib/services/` holds 100+ modules encapsulating database operations, validation, and business rules. Each service area is paired with a React hook in `lib/hooks/` (60+ hooks) that the UI consumes.

**The browser talks to services, not to `/api`.** Hooks import services directly and read/write local PouchDB, which is what makes the app usable offline; CouchDB replication carries the writes to the server. `/api/*` exists for consumers that have no browser in the loop — mobile, integrations, cron jobs — and enforces its own auth on every route.

---

## Offline-First Design

TAMAMHEALTH is built for environments with limited or intermittent connectivity:

- **All data stored locally** in PouchDB — the app is fully functional without internet
- **Service Worker** (`public/sw.js`, cache-busted by `NEXT_PUBLIC_BUILD_ID`) for offline page access and asset caching
- **Sync queue** — Changes are queued when offline and replicated when connectivity returns
- **Online/offline detection** with visual indicators in the UI
- **Sync Manager** (`lib/sync/sync-manager.ts`) elects a single leader tab and coordinates per-database replication (live push, polled pull) with status tracking
- **Conflict handling** — see `docs/architecture/sync-conflict-policy.md` and the `/admin/conflicts` queue

---

## Multi-Tenancy & Organizations

- **Public organizations** — Ministry of Health, government departments (see all national data)
- **Private organizations** — Hospital groups, NGOs (scoped to their own data)
- **Custom branding** — Each organization can configure colors, logo, and name
- **Feature flags** — Org admins enable/disable modules (epidemic intelligence, MCH analytics, DHIS2 export, etc.)
- **Subscription plans** — Basic, professional, and enterprise tiers with different feature access
- **Data scoping** — `filterByScope` in `lib/services/data-scope.ts` is the tenant barrier: the local database holds documents for every org the device has replicated, so scoped services must always be called with a `DataScope`. It fails closed — a missing `orgId` returns nothing. `super_admin` and `government` see everything.
- **Database-per-organization** — Optional CouchDB routing to `<base>--<orgId>` databases, which is what actually enforces *read* isolation on the server

---

## Security

- **HTTPS-only cookies** in production with `HttpOnly` and `SameSite` flags
- **Two-layer CSRF** — Origin/Host check on state-changing API requests, plus an HMAC-bound double-submit token (`tamamhealth-csrf` cookie ↔ `x-csrf-token` header) that binds to the session subject
- **Rate limiting** — 5 failed logins per username and 20 per IP, 15-minute windows; backed by Upstash Redis when configured, in-memory otherwise
- **Token revocation** — Logout adds the token to a revocation list checked by `/api/auth/me` and by `getAuthPayload` on every `/api/*` route (the Edge proxy can't do it — the store uses `node:fs`)
- **Timing-attack resistance** — Constant-time password comparison with a dummy hash on user-not-found
- **Password hashing** — bcryptjs with salt rounds
- **PHI drafts** — In-progress clinical drafts are encrypted with a per-tab AES-GCM key (`lib/draft-storage.ts`); the key lives in `sessionStorage` and dies with the tab, leaving the `localStorage` ciphertext meaningless
- **PHI at rest** — Field-level AES-GCM (`lib/field-encryption.ts`) or declared disk encryption; production refuses to boot without one
- **Content Security Policy** and security headers set in `next.config.mjs` (no `unsafe-eval` in production)
- **Audit logging** — Authentication events and data modifications logged; see `docs/security/audit-logging.md`

Further detail: `docs/security/` (csrf, rate-limiting, token-revocation, draft-storage, audit-logging).

---

## Testing

```bash
# Run all tests
npm test

# Run tests in CI mode with coverage
npm run test:ci

# Lint
npm run lint

# Locale parity (en vs apd) — every key and {{placeholder}} must match
npm run i18n:check
```

Tests use Jest 30 via `next/jest` (SWC transform) with a JSDOM environment.
59 test files live in `src/__tests__/`; only `*.test.ts` / `*.test.tsx` are
collected, so helpers under `src/__tests__/helpers/` are ignored. Coverage is
collected from `src/lib/services/**`, `src/lib/validation.ts`, and
`src/lib/db-seed.ts`.

---

## Environment Variables

Run `npm run setup` to configure automatically, or copy `.env.example` to `.env.local` and edit manually. `.env.example` is the authoritative, commented list — the tables below are the highlights.

**Required for production** (enforced at boot by `lib/config-validation.ts`):

| Variable | Purpose | How to generate |
|----------|---------|-----------------|
| `JWT_SECRET` | Session token signing (also the CSRF HMAC secret) | `openssl rand -base64 48` |
| `NEXT_PUBLIC_DEMO_MODE` | Set to `false` for production | |
| `SUPERADMIN_INITIAL_PASSWORD` | Replaces the well-known `Superadmin!` default | `openssl rand -base64 24` |
| `NEXT_PUBLIC_ADMIN_NAME` | Initial admin display name (browser-visible) | |
| `ADMIN_INITIAL_PASSWORD` | Initial `admin` password — **server-only**. Leave unset to auto-generate into `.seed-credentials.json`. | `openssl rand -base64 24` |
| `PHI_AT_REST_STRATEGY` *or* `PHI_ENCRYPTION_ENABLED` + `PHI_ENCRYPTION_KEY` | Declare how PHI is protected at rest | `openssl rand -base64 32` |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` *or* `SINGLE_REPLICA_ACK` | Shared rate-limit + revocation state across replicas | |
| `NEXT_PUBLIC_SYNC_ENABLED`, `COUCHDB_URL`, `NEXT_PUBLIC_COUCHDB_URL`, `COUCHDB_WEBHOOK_SECRET` | Shared CouchDB replication | `openssl rand -hex 32` |

**Optional:**

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATABASE_URL` / `DATABASE_DIRECT_URL` | PostgreSQL analytics connection (direct URL for migration locks) | _(none, app uses PouchDB)_ |
| `DATABASE_CA_CERT_BASE64` | Base64 provider CA PEM for strict managed-DB TLS | |
| `SKIP_DB_MIGRATIONS` | Disable the boot-time migration runner | `false` |
| `SESSION_TTL_HOURS` | Session cookie / JWT lifetime | |
| `SEED_CREDENTIALS_SECRET` | Derive seed passwords deterministically (serverless-safe) | _(file-based)_ |
| `NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED` / `SINGLE_ORG_MODE` | Database-per-organization routing | `false` / `true` |
| `NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED` + `COUCHDB_GATEWAY_SECRET` | Proxy replication through `/api/couch` on the app origin | `false` |
| `NEXT_PUBLIC_SYNC_PULL_MODE` / `NEXT_PUBLIC_SYNC_PULL_INTERVAL_MS` | Debug overrides for pull replication | `poll` / `15000` |
| `NEXT_PUBLIC_AUTO_LOCK_DISABLED` | Turn off the inactivity screen lock (dev only) | `false` |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Telehealth video (all three or none) | _(video reports itself unavailable)_ |
| `EMAIL_PROVIDER` + `RESEND_API_KEY` / `SENDGRID_API_KEY` / `SMTP_URL` | Outbound email | _(disabled)_ |
| `FLUTTERWAVE_SECRET_HASH`, `MPESA_WEBHOOK_SECRET`, `AIRTEL_WEBHOOK_SECRET` | Payment webhook HMAC secrets | |
| `NEXT_PUBLIC_APP_URL` | Base URL for payment and join links | |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | Default ledger currency | `SSP` |
| `NEXT_PUBLIC_FHIR_NAMESPACE_BASE` | FHIR `identifier.system` / CodeSystem URL base | `https://tamamhealth.org` |
| `NEXT_PUBLIC_DHIS2_BASE_URL` / `DHIS2_BASE_URL` + credentials | DHIS2 export target | |
| `NEXT_PUBLIC_FINGERPRINT_ENABLED` + bridge URL/token | Fingerprint enrolment & identification | `false` |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_RELEASE` | Error reporting | _(no-op)_ |
| `NEXT_PUBLIC_POSTHOG_KEY` / `_HOST` | Forward sanitized usage events (autocapture off) | _(CouchDB only)_ |
| `PATIENT_PORTAL_OTP_ENABLED` | SMS second factor for the patient portal | `false` |
| `REMINDER_DISPATCH_SECRET`, `TRANSFER_SWEEP_SECRET`, `TELEHEALTH_MAINTENANCE_SECRET` | Shared secrets for the scheduled cron jobs; unset = no machine access | |
| `DOPPLER_TOKEN` | Fetch secrets via the Doppler CLI at boot | _(env-file path)_ |

**Optional integrations — SMS gateway:**

The messaging UI supports `channel: 'sms' | 'app' | 'both'`. Without an SMS
provider configured, sms-channel sends are written to the audit log but no
real text leaves the server (the `noop` provider). To enable real SMS, set
`SMS_PROVIDER` and the corresponding credentials.

```bash
# SMS (optional). Set SMS_PROVIDER=africastalking or twilio to enable.
SMS_PROVIDER=noop
AFRICAS_TALKING_USERNAME=
AFRICAS_TALKING_API_KEY=
AFRICAS_TALKING_SENDER_ID=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
PATIENT_REMINDER_SMS_ENABLED=false
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run setup` | Interactive first-time env configuration (`scripts/setup.mjs`) |
| `npm run dev` | Start development server on `localhost:3000` |
| `npm run build` | Create production build |
| `npm start` | Run production server |
| `npm run lint` | Run ESLint checks |
| `npm test` | Run the Jest suite (59 test files) |
| `npm run test:ci` | Run tests with coverage reporting |
| `npm run db:migrate` | Apply pending PostgreSQL migrations (requires `DATABASE_URL`; also runs at server boot) |
| `npm run setup:couchdb:validators` | Install `validate_doc_update` + `_security` on every org-scoped CouchDB database |
| `npm run db:migrate:couchdb-tenants` | Non-destructive shared → database-per-organization CouchDB migration (`COUCHDB_TENANT_ORG_IDS`, `DRY_RUN=true` to preview) |
| `npm run db:verify:couchdb-tenants` | Read-only verification of the tenant-database cutover |
| `npm run i18n:check` | Locale parity check — `apd` must cover every `en` key and placeholder |
| `npm run docs:api` | Generate TypeDoc API docs into `docs-api/` |

`scripts/setup-couchdb.sh` (bash) creates the databases, configures CORS, and
installs the validators in one pass. `scripts/doppler-bootstrap.sh` is used by
the container entrypoint when `DOPPLER_TOKEN` is set.

---

## South Sudan Health System Context

TAMAMHEALTH is designed around South Sudan's administrative and health system structure:

- **Facility levels** — National referral hospitals, state hospitals, county health departments, PHCCs (Primary Health Care Centers), PHCUs (Primary Health Care Units)
- **Administrative divisions** — 10 states, counties, payams, bomas
- **Disease priorities** — Malaria-endemic protocols, maternal mortality reduction, immunization coverage expansion
- **Vital registration** — CRVS (Civil Registration and Vital Statistics) integration for births and deaths
- **National reporting** — DHIS2 export for Ministry of Health data aggregation
- **Time zone** — All clinical date bucketing goes through `lib/time-juba.ts` (Africa/Juba, UTC+2, no DST), never a raw `toISOString()` slice
- **Languages** — English and Juba Arabic (`apd`, RTL), both carried end to end

---

## License

Proprietary. Copyright (c) 2026 TamamHealth Health Technologies. See
[`LICENSE`](../LICENSE) at the repository root.
