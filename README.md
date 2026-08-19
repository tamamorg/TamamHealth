# TamamHealth — Electronic Health Record System for South Sudan

**TamamHealth** is an offline-first electronic medical record (EMR) system designed for South Sudan's health infrastructure. Built to work across all five levels of the South Sudanese health system — from village Boma facilities to the Ministry of Health — TamamHealth addresses the unique challenges of low-resource, low-connectivity, and low-literacy environments.

> *"Make it so simple a primary school child can do it."* — Health system expert on South Sudan

---

## Why TamamHealth Exists

South Sudan faces critical health data challenges:

- **67% of facilities do not report to DHIS2** — not because they don't want to, but because existing systems are too complex
- **No national ID system** — "National ID is like gold. If they have national ID, they don't need to do census."
- **Civil salaries unpaid for over a year** — sustainability must be built into the design
- **Less than 33% reporting rate** — the system must make data collection effortless
- **Widespread illiteracy** — visual interfaces and photo identification are essential

TamamHealth solves these problems by being **offline-first**, **icon-driven**, **simple enough for frontline staff**, and **compliant with WHO/DHIS2 standards** for government reporting.

---

## Getting Started

### Prerequisites

- **Node.js 20** — pinned in [`.nvmrc`](.nvmrc); run `nvm use` in each shell
- **npm** >= 10 (ships with Node 20)
- **Git**
- **Docker** — optional, only for the full-stack (CouchDB) path

Works on **Windows**, **macOS**, and **Linux**. The platform runs fully offline in the browser once loaded; CouchDB and PostgreSQL are optional server-side components.

### From a clone

```bash
git clone https://github.com/tamamorg/TamamHealth.git
cd TamamHealth

# One command: pins Node, installs every package, activates the git hooks,
# seeds platform/.env.local, and finishes with a type-check.
./scripts/setup.sh            # add --fast to skip the mobile app install

cd platform && npm run dev    # http://localhost:3000
```

There is no repo-level install of application code — every subproject
(`platform/`, `website/`, `mobile/`, `sync-worker/`, `fingerprint-bridge/`)
carries its own `package.json` and lockfile. The root `package.json` holds
git-hook tooling only.

For a guided config walkthrough that generates secrets into
`platform/.env.local`, run `node platform/scripts/setup.mjs`.

### With Docker

```bash
cp .env.example .env          # set COUCHDB_USER / COUCHDB_PASSWORD first
docker compose up -d
```

That brings up four services: **platform** (3000), **website** (3001),
**couchdb** (5984, bound to loopback), and a CouchDB backup sidecar. The
national-analytics half — `sync-worker` and `postgres` — sits behind a profile:

```bash
docker compose --profile analytics up -d
```

### Signing in

Accounts are issued by an administrator; the login page does not hand out
credentials. A fresh install is reachable through the platform bootstrap
account `superadmin`, whose initial password is `Superadmin!` unless
`SUPERADMIN_INITIAL_PASSWORD` is set — and which is forced to change on first
login. From there, `/admin/users` creates real accounts, and the login form's
role picker lets the super-admin enter any role's workspace directly.

See [platform/README.md](platform/README.md) for the full environment-variable
reference, and [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

---

## Architecture

### Five-Level Health System Support

TamamHealth models the complete South Sudanese health administrative hierarchy
(`FacilityLevel` = `boma | payam | county | state | national`), and the
diagnosis a record can carry is scoped to the level that made it:

```
LEVEL 1 — BOMA (Village)
├─ Suspected diagnosis only
├─ Photo-based patient identification
├─ Household geocode IDs (BOMA-XY-HH1001)
└─ Offline-first with SMS fallback

LEVEL 2 — PAYAM (Sub-county)
├─ Primary Health Care Units (PHCUs)
├─ Clinical diagnosis with ICD-11 coding
├─ Basic lab results and pharmacy
└─ Referral management

LEVEL 3 — COUNTY (County Hospitals)
├─ Inpatient records, wards and beds
├─ Definitive diagnosis, advanced lab
└─ DHIS2 reporting

LEVEL 4 — STATE (General/Specialist Hospitals)
├─ Specialist diagnosis, complication tracking
└─ Aggregate state-level analytics

LEVEL 5 — NATIONAL (Teaching Hospitals + MoH)
├─ National disease surveillance
├─ Ministry of Health dashboard
├─ DHIS2 export (JSON + CSV)
└─ International reporting (WHO)
```

### Repository Structure

```text
TamamHealth/
├── platform/           EHR application (Next.js) — port 3000
├── website/            Marketing site, tamamhealth.org (Next.js) — port 3001
├── mobile/             Expo / React Native companion app
├── fingerprint-bridge/ Localhost USB-scanner bridge for the registration desk
│                       (Node service on 127.0.0.1:7345; see its README)
├── sync-worker/        CouchDB → PostgreSQL national-analytics sync worker
├── country-node/       Country-level aggregation node
├── regional-exchange/  Cross-facility / cross-border record exchange
├── infra/              Terraform (aws, digitalocean, digitalocean-website),
│                       systemd units and backup config
├── scripts/            Setup, backup, preflight and deploy scripts
├── docs/               Documentation, specs, research, operator runbooks
├── docker-compose.yml       local/self-hosted stack (+ .data.yml, .ghcr.yml)
└── package.json             repo-root tooling only (husky + lint-staged)
```

> The **fingerprint-bridge** runs on the same machine as the USB scanner (the
> registration-desk PC), not on the server — the platform talks to it over
> loopback HTTP and degrades gracefully when it's unavailable. See
> [fingerprint-bridge/README.md](fingerprint-bridge/README.md).

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (pinned in `.nvmrc`), npm 10 |
| Platform | Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 3 |
| Website | Next.js 16 + React 19 (marketing site) |
| Mobile | Expo / React Native |
| Client database | PouchDB 9 on browser IndexedDB — offline-first, 76 databases |
| Sync | CouchDB 3 — one database per organization, optional |
| Analytics database | PostgreSQL 16, fed by `sync-worker` |
| Auth | JWT (jose, HS256) + bcryptjs; RBAC across 25 roles |
| Telehealth | LiveKit (server SDK + browser client) |
| Charts | Recharts |
| Tests | Jest 30 |
| Languages | English and Juba Arabic (RTL), checked by `npm run i18n:check` |

### Patient Identification

Every patient carries a facility-issued **hospital number** (`JTH-000001`) as
the primary identifier. Because most South Sudanese lack national IDs, the
record also supports **household geocoding** as a secondary, field-friendly
identifier:

```
Format: BOMA-{bomaCode}-HH{householdNumber}
Example: BOMA-KJ-HH1001

  hospitalNumber:   "JTH-000001"        ← Primary identifier
  geocodeId:        "BOMA-KJ-HH1001"    ← Optional household geocode
  nationalId:       null                ← Optional (most won't have one)
  householdNumber:  1001
  bomaCode:         "KJ"
  boma / payam / county / state         ← South Sudan hierarchy
```

Alongside these, the registration desk can identify a patient by **photo**,
**fingerprint** (via the localhost bridge), or **QR code**, and a fuzzy
**master patient index** (`/api/mpi/match`) catches duplicates across
facilities — the name-collision problem the geocode system was designed for.

---

## Roles & Dashboards

Twenty-five roles are defined in
[`platform/src/lib/role-routes.ts`](platform/src/lib/role-routes.ts) (the
edge-safe route allow-list) and
[`platform/src/lib/permissions.ts`](platform/src/lib/permissions.ts) (labels,
nav and icons). Each role has a route allow-list and a landing page:

| Landing page | Roles |
|---|---|
| `/dashboard` — shared clinical workspace | Doctor, Clinical Officer, Clinician, Nurse, Midwife, Triage Nurse, Rooming Nurse, Medical Superintendent |
| `/dashboard/lab` | Lab Technician |
| `/dashboard/pharmacy` | Pharmacist |
| `/dashboard/front-desk` | Medical Receptionist, Registration Clerk, Clinic Clerk |
| `/payments` | Cashier, Medical Biller |
| `/dashboard/data-entry` | Data Entry Clerk, Health Records Officer, Records / HMIS Officer |
| `/dashboard/nutrition` | Nutritionist |
| `/dashboard/radiology` | Radiologist |
| `/dashboard/state` | County Health Director |
| `/facility-management` | Hospital Manager, Organization Admin |
| `/government` | Ministry of Health |
| `/admin` — super-admin command center | Super Admin |

Nurse-family roles share the clinical workspace at `/dashboard` rather than a
separate station; the ward surfaces they used to own now live at `/triage`,
`/rooming`, `/wards`, `/wards/mar` and `/wards/handoff`.

Route access is enforced in three places from the same table: the edge proxy
([`platform/src/proxy.ts`](platform/src/proxy.ts)), a server check on every
`/api/*` route, and a client guard.

---

## Features

### Clinical

- **Patient Registration** — Multi-step form with demographics, contact, next of kin, medical history, photo, fingerprint and QR identification
- **Patient Chart** — OpenMRS O3-style chart shell at `/patients/[id]`: vitals, problems, allergies, medications, orders, notes and timeline
- **Consultation Workflow** — Vitals, chief complaint, physical exam, ICD-11 diagnosis, prescriptions, lab and imaging orders, order sets and templates
- **Clinical Decision Support** — WHO/IMAI-derived vital-sign bands that tint the chart, drug-interaction and allergy checking at prescribing time, care alerts, diagnosis validation, and a structured note scribe. (Rule-based, not a model — there is no AI diagnosis engine.)
- **Triage & Rooming** — ETAT-based triage assessment, room assignment, patient queue
- **Wards** — Bed management, medication administration record (MAR), SBAR shift handoff
- **Laboratory & Imaging** — Order → accept → result entry → critical flagging, with imaging studies on the same order lifecycle
- **Pharmacy** — Prescription queue, dispensing, inventory, drug-interaction and allergy checks, controlled-substance log
- **Blood Bank** — Stock, cross-match and transfusion records
- **Referrals & Transfers** — Transfer package assembly with full patient history and status tracking
- **Telehealth** — LiveKit video consultations with device checks and consent capture
- **Appointments & Online Booking** — Staff scheduling plus a public booking route (`/book/[practice]`) with slot holds and intake forms

### Public Health

- **Antenatal Care (ANC)** — WHO 8-contact model, risk stratification, IPTp tracking, birth plans
- **Immunizations (EPI)** — Full vaccine schedule tracking with overdue alerts
- **Birth Registration (CRVS)** — WHO-compliant birth certificates with auto-generated numbers
- **Death Registration (CRVS)** — WHO 4-line medical certificate format with ICD-11 coding
- **Disease Surveillance** — Active alerts, outbreak detection, IDSR reporting context
- **Epidemic Intelligence** — Disease trend analysis with South Sudan-specific context
- **Nutrition** — Screening and supply tracking

### Administration & Finance

- **Billing & Payments** — Charges, invoices, fee schedules, insurance eligibility and claims, payment plans, refunds, an append-only ledger, and payment links with a public checkout page
- **Facility Management** — Facility registry, settings, assessments, equipment/assets, emergency preparedness
- **HR** — Leave requests, shift schedules, payroll
- **User Accounts** — Admin-issued credentials, forced first-login password change, and a public account-request queue (`/request-account` → approval in `/admin/users` or `/org-admin/users`)
- **Multi-tenancy** — Organizations own facilities; every scoped read passes through a tenant filter, and CouchDB gives each organization its own database

### Government & Analytics

- **National Dashboard** — Population health overview across all 10 states, with real ADM1 boundaries for offline SVG maps
- **Vital Statistics** — Birth/death rates, cause-of-death analysis
- **Facility Assessments** — WHO SARA-aligned readiness scoring
- **Data Quality Monitoring** — Completeness, timeliness, DHIS2 adoption rates
- **DHIS2 Export** — JSON and CSV export, plus a push adapter (`/api/admin/dhis2-push`)
- **MCH Analytics** — Maternal and child health indicators

### Standards & Interoperability

- **ICD-11** — 90+ codes curated for South Sudan's disease burden, searchable by code, title, chapter or local keyword, with notifiable diseases flagged for DHIS2/IDSR reporting and diagnoses typed as suspected → clinical → definitive → confirmed
- **FHIR R4** — CapabilityStatement (`/api/fhir/metadata`, public), `Patient`, `Encounter`, `Observation`, `MedicationRequest`, and a referral `Bundle`
- **DHIS2** — Aggregate exports and a direct push adapter
- **SMS / WhatsApp** — Africa's Talking and Twilio providers, no-op when unconfigured

### Cross-Cutting

- **Offline-First** — Every write commits to PouchDB locally before any remote call; the clinic works through power and network outages and syncs on return
- **Multi-Language** — English and Juba Arabic UI (RTL); patient records carry 14 languages including Dinka, Nuer, Bari, Zande, Shilluk, Murle
- **Input Validation** — Patient data, vital signs, file uploads
- **Audit Logging** — Login, logout, PHI reads/searches, and data mutations
- **Printing** — Every worklist prints through a shared list dialog (list selection, print or CSV)

---

## Data Model

Operational data lives in **76 PouchDB databases**, one per document family,
declared in [`platform/src/lib/db.ts`](platform/src/lib/db.ts). A
representative slice:

| Collection | Purpose |
|-----------|---------|
| `tamamhealth_users` | Staff accounts — server-only, never replicated to browsers |
| `tamamhealth_patients` | Patient records |
| `tamamhealth_hospitals` | Facility registry with the 5-level hierarchy |
| `tamamhealth_encounters` / `_medical_records` | Clinical visits and notes |
| `tamamhealth_lab_results` | Laboratory and imaging orders and results |
| `tamamhealth_prescriptions` | Medication prescriptions |
| `tamamhealth_referrals` / `_patient_transfers` | Inter-facility movement |
| `tamamhealth_births` / `_deaths` | CRVS registrations |
| `tamamhealth_immunizations` / `_anc` | EPI and antenatal care |
| `tamamhealth_wards` / `_handoffs` | Beds and shift handoff |
| `tamamhealth_charges` / `_invoices` / `_ledger` | Billing and the append-only ledger |
| `tamamhealth_disease_alerts` | Surveillance alerts |
| `tamamhealth_audit_log` | Security audit trail (push-only) |
| `tamamhealth_conflict_queue` | Sync conflicts awaiting human reconciliation |

### Sync

When CouchDB is configured, each database replicates to a per-organization
remote (`tamamhealth_patients--org-moh-ss`) with its own `_security` object.
Pushes are filtered so a device only sends what it owns; pulls poll on a ~15s
cycle so the 74 configured replications cannot starve the live push feed
([`sync-config.ts`](platform/src/lib/sync/sync-config.ts)). Direction is
per-database — audit trails push only, reference data pulls only, and
`tamamhealth_users` never leaves the server.

The `sync-worker` projects CouchDB changes into PostgreSQL for national
analytics; nothing in the clinical path depends on it.

---

## DHIS2 Integration

TamamHealth complements — not competes with — DHIS2. The system generates DHIS2-compatible exports:

- **JSON export** for programmatic integration
- **CSV export** for manual upload
- **Direct push** to a national DHIS2 server via `/api/admin/dhis2-push`
- **Aggregate data**: Total patients, sex disaggregation, disease profiles, notifiable diseases
- **Notifiable disease codes** flagged automatically via ICD-11 integration

> *"Our tool complements DHIS2 to make data transfer quicker, easier, and more efficient with high quality."*

---

## Design Principles

Validated by a South Sudan health system expert:

1. **Appropriate for context** — Low literacy, low connectivity, multiple languages
2. **Fit for purpose** — Actually solves the data collection problem
3. **Value for money** — Cheap to deploy and maintain
4. **Binary choices** — Minimize free-text; use treated/referred, alive/dead/follow-up
5. **Photo-based ID** — Critical for patient identification in illiterate populations
6. **Offline-first** — 100% functionality without internet
7. **Five-level support** — From village facilities to the Ministry of Health

The longer form lives in [docs/PRINCIPLES.md](docs/PRINCIPLES.md), which the
pull-request template checks against.

### Data Quality Parameters

| Parameter | Description |
|-----------|-------------|
| **Completeness** | All required fields filled (validation enforced) |
| **Correctness** | Accurate data (range checks, ICD-11 codes) |
| **Consistency** | Same format everywhere (hospital numbers, geocode IDs, date formats) |
| **Timeliness** | Real-time or near-real-time data entry |

---

## Project Structure

```
platform/
├── src/
│   ├── app/
│   │   ├── (dashboard)/          # Authenticated modules (~44 route folders)
│   │   │   ├── dashboard/        # Shared clinical workspace + role stations
│   │   │   │   ├── lab/  pharmacy/  front-desk/  data-entry/
│   │   │   │   ├── nutrition/  radiology/  state/  hr/
│   │   │   ├── patients/         # Registry + OpenMRS-style chart
│   │   │   ├── consultation/  notes/  triage/  rooming/  wards/
│   │   │   ├── lab/  pharmacy/  blood-bank/  controlled-substances/
│   │   │   ├── referrals/  appointments/  telehealth/  messages/
│   │   │   ├── anc/  births/  deaths/  immunizations/
│   │   │   ├── billing/  payments/  hr/  equipment/  it/
│   │   │   ├── surveillance/  epidemic-intelligence/  data-quality/
│   │   │   ├── government/  dhis2-export/  vital-statistics/  mch-analytics/
│   │   │   ├── facility-management/  facility-settings/  facility-assessments/
│   │   │   ├── admin/            # Super-admin command center
│   │   │   └── org-admin/        # Organization admin console
│   │   ├── (booking)/book/       # Public online booking
│   │   ├── patient-portal/       # Patient-facing portal
│   │   ├── login/  request-account/  checkout/  privacy/  terms/
│   │   ├── api/                  # ~50 route groups (auth, fhir, mpi, sync, …)
│   │   └── globals.css           # Design tokens — the only colour source
│   ├── components/               # Shared UI (ehr/, patients/, admin/, …)
│   ├── data/mock.ts              # Seed dataset + core type definitions
│   ├── lib/
│   │   ├── db.ts  db-types*.ts  db-seed.ts   # PouchDB layer and schema
│   │   ├── permissions.ts  role-routes.ts    # RBAC
│   │   ├── icd11-codes.ts                    # ICD-11 reference
│   │   ├── sync/                             # CouchDB replication + tenancy
│   │   ├── services/                         # Data access services
│   │   ├── i18n/                             # en + apd (Juba Arabic)
│   │   ├── hooks/  context.tsx               # React state
│   │   └── seed-credentials.ts               # Server-only bootstrap creds
│   └── proxy.ts                  # Edge auth/CSRF/route gate (Next 16 middleware)
└── scripts/                      # setup, migrations, i18n check
```

---

## Security Notes

**Implemented controls:**

- CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and
  Permissions-Policy headers (`platform/next.config.mjs`)
- bcrypt password hashing; admin-issued and bootstrap credentials force a
  password change on first use
- Server-issued JWT (HS256, env `JWT_SECRET`, TTL from `SESSION_TTL_HOURS`,
  30 days by default) with role-based route gating; the server refuses to
  start on a default or short secret in production
- Token revocation enforced at `/api/auth/me` and every `/api/*` route
- Two-layer CSRF: Origin/Host check + HMAC double-submit token (`src/proxy.ts`)
- Rate limiting on login, per-user and per-IP (shared store via Upstash when
  configured; bounded in-memory fallback otherwise)
- Server-side persistence and sync (CouchDB) with per-organization databases,
  per-database `_security`, and org-scoped replication filters
- Per-tab AES-GCM encryption of in-progress PHI drafts; full local database
  wipe on logout and on session expiry
- Demo-only data paths gated by `NEXT_PUBLIC_DEMO_MODE`; authentication itself
  has no demo branch — every account comes from the users database

**Remaining hardening for a real PHI / in-country deployment** — see
[`docs/operations/production-hardening.md`](docs/operations/production-hardening.md),
enforced by [`scripts/preflight.sh`](scripts/preflight.sh):

- TLS termination for **CouchDB** (not just the app) and encryption-at-rest for the
  CouchDB/Postgres volumes on an in-country / MoH-approved host (data residency)
- Nightly **encrypted, offsite** backups with a tested restore drill
- Secret rotation procedure + a secrets manager (avoid plaintext env files on disk)
- Completing CouchDB per-database `_security` rollout across every tenant database
- A shared rate-limit store before running more than one app instance

---

## Cultural Considerations

Key insights from expert consultation:

- **Common names**: "This one is Deng. This is Deng. This is Deng." — hospital numbers, household geocodes and the fuzzy patient matcher solve the name collision problem
- **Hidden populations**: Disability and mental health data will be underreported due to cultural stigma — system uses sensitive data collection methods
- **Livestock engagement**: Community members may engage more readily with animal health tracking — a possible future gateway
- **Traditional birth attendants**: Many births occur outside facilities — the CRVS module supports births attended outside the facility
- **Multiple languages**: South Sudan has 60+ languages; patient records carry the major ones — Dinka, Nuer, Shilluk, Murle, Bari, Zande, Mundari, Toposa, Acholi, Madi, Lotuko, Didinga, Arabic (Juba), English

---

## Contributing

`main` is protected: work lands through a pull request with CI green and one
approving review. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, hooks, CI
gates and the review workflow.

Contributions should align with:

1. WHO standards (ICD-11, CRVS, SARA)
2. South Sudan DHIS2 requirements
3. Offline-first architecture
4. Low-literacy accessibility
5. The five-level health system hierarchy

---

## License

Proprietary — see [LICENSE](LICENSE). Designed for deployment in South Sudan's public health system.

---

*Built with care for the people of South Sudan.*
