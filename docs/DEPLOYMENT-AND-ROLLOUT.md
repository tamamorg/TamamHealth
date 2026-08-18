# TamamHealth — Data-Flow Audit + Deployment & Rollout Guide (South Sudan)

_Last updated: 2026-06-15. This consolidates `docs/DEPLOY-SOUTH-SUDAN.md`,
`deploy.sh`, `docker-compose.yml`, and `docs/operations/*` into one runbook,
and opens with the current state of the data flow._

---

## Part 1 — Data-flow audit (current state)

### The shape of the system

TamamHealth is **offline-first and federated**. There are three tiers:

1. **Facility node (the browser).** The Next.js app runs in the clinician's
   browser and reads/writes a local **PouchDB** per data domain (`getDB('tamamhealth_*')`).
   Everything works with **no network** — registration, triage, consultation,
   lab, pharmacy, billing. This is the clinical runtime.
2. **Facility/country server (the sync hub).** A single in-country Ubuntu server
   runs the platform, **CouchDB** (the durable store PouchDB replicates to),
   a **sync-worker**, and optionally **Postgres** (analytics). PHI never leaves
   this server.
3. **Country node (national layer, Phase 3).** Receives `sync_events` batches,
   feeds **DHIS2**, and serves national metadata/analytics. Clinicians keep
   working even when it's unreachable.

```
Browser (PouchDB, offline-first)
      │  live replication when online
      ▼
CouchDB  ──_changes──►  sync-worker  ──HMAC POST /api/sync──►  Postgres (analytics, downstream only)
  (durable PHI store)                                   │
      │ sync_events outbox                              ▼
      └──────────────────────────────────────►  Country node → DHIS2 / national FHIR (Phase 3)
```

### How data flows through a visit (verified)

Registration → triage → consultation → orders → lab/pharmacy → billing, all
linked by ids:

- **Registration** writes a `PatientDoc` (org/hospital stamped, unique hospital
  number, duplicate check, audited + sync-emitted).
- **Triage** writes a `TriageDoc` (ETAT priority). The consultation links it,
  prefills vitals from it, and the dashboard worklist sorts by acuity.
- **Consultation** creates **one `EncounterDoc` per visit** (the canonical visit
  record), then lab orders, prescriptions, and a `MedicalRecordDoc` that
  references them by id (`encounterId`/`triageId`/`labOrderIds`/`prescriptionIds`).
  The save is an **idempotent, journaled staged commit** — re-pressing Complete
  after a failure resumes without duplicating anything (PouchDB has no
  cross-document transactions, so this is the offline-first stand-in for ACID).
- **Lab** drives the order lifecycle (ordered → … → resulted → reviewed) with an
  SLA escalation banner for unreviewed criticals.
- **Pharmacy** dispenses the prescribed course quantity behind a stock gate, with
  a two-signatory controlled-substance log.
- **Billing** charges once via `chargeForServices` (BillingDoc canonical), carries
  `encounterId`, applies insurance coverage when a policy exists, and FK-checks
  references before writing.

### Sync & integrity contract

- Every `getDB` database is registered in `lib/sync/sync-config.ts`
  (`DATABASE_SYNC_CONFIGS`) with a direction (`both`/`push`/`pull`) and org
  scope; clinical DBs are bidirectional, audit/controlled-substance logs are
  push-only, identity/config are pull-only.
- Each create/update emits a `sync_event` and an audit entry.
- `resetAllDatabases()` lists every DB **except** the controlled-substance log
  (append-only regulatory trail). **This runs only on a seed-version change and
  is destructive — see the production caveat in Part 4.**

### Known-open (by design)

A true ACID/rollback transaction (impossible on PouchDB — mitigated with
idempotent retry) and the physical legacy-BillingDoc → ledger migration. Neither
blocks deployment.

---

## Part 2 — Deployment topology for South Sudan

**Recommended MVP: one in-country server per deployment (the "country node"),
many facilities syncing to it.** This keeps all PHI on one encrypted box you
control, and every facility keeps working offline between syncs.

| Concern | Choice | Why |
|---|---|---|
| Data residency | Single Ubuntu server **in South Sudan** (MoH data centre or in-country host) | No PHI leaves the country; no third-party cloud holds patient data |
| Server size | 4 vCPU / 16 GB / 100 GB SSD (2 vCPU / 8 GB for a pilot) | Load is batched sync + reporting, not heavy realtime |
| Power | **UPS** + generator fallback | Intermittent grid; offline-first means facilities keep working during outages |
| Network | Public IP + domain; DDNS if only dynamic IP; ideally two uplinks | Facility browsers reach `app.<domain>` / `couch.<domain>` when syncing |
| Facility devices | Any modern browser (Chrome/Edge/Firefox) on laptop, tablet, or low-cost PC | App is a PWA-style web app; no install per device |
| Disk | **LUKS-encrypted data volume** | Protects PHI if hardware is stolen/decommissioned |

Facilities need **no server of their own** — just a browser. Their data lives in
the browser (offline) and syncs to the country node when connectivity allows.

---

## Part 3 — Host it: stand up the server

The repo ships a one-shot script (`deploy.sh`) and `docker-compose.yml`
(platform + website + CouchDB + nightly CouchDB backup; Postgres under the
`analytics` profile). Do these in order.

### 3.1 Provision

1. Fresh **Ubuntu 22.04 LTS** server in-country, public IP.
2. Three DNS A records → server IP:
   - `tamamhealth.org` (marketing site)
   - `app.tamamhealth.org` (the platform)
   - `couch.tamamhealth.org` (CouchDB sync endpoint, TLS-proxied)

### 3.2 Encrypt the data disk FIRST (privacy)

```bash
cryptsetup luksFormat /dev/sdb
cryptsetup open /dev/sdb cryptdata
mkfs.ext4 /dev/mapper/cryptdata
mkdir -p /opt/tamamhealth-data && mount /dev/mapper/cryptdata /opt/tamamhealth-data
# Point Docker's data-root / named volumes at /opt/tamamhealth-data.
```

### 3.3 Firewall

```bash
ufw default deny incoming
ufw allow 22/tcp    # SSH (restrict to admin IPs if you can)
ufw allow 80/tcp    # HTTP → Caddy redirects to HTTPS
ufw allow 443/tcp   # HTTPS
ufw enable
```

CouchDB (5984) and Postgres (5432) stay bound to `127.0.0.1` only — reachable
**only** through the TLS reverse proxy. Never add public port mappings for them.

### 3.4 Secrets / env (three gitignored files)

Copy the `.example` files and fill them in (strong random secrets; never commit):

- `./.env` — compose-level: `COUCHDB_USER`, `COUCHDB_PASSWORD`, `COUCHDB_WEBHOOK_SECRET`, ports.
- `./platform/.env.production` — `JWT_SECRET`, `ADMIN_INITIAL_PASSWORD`, sync + domain vars.
- `./website/.env.production` — ops notify email / provider keys.

**Critical build-time vars** (Next.js bakes `NEXT_PUBLIC_*` into the browser
bundle at `docker compose build`, so set them BEFORE building):

```ini
# platform/.env.production
NEXT_PUBLIC_DEMO_MODE=false                       # MUST be false in production
NEXT_PUBLIC_SYNC_ENABLED=true
NEXT_PUBLIC_COUCHDB_URL=https://couch.tamamhealth.org
NEXT_PUBLIC_ORG_NAME=...           NEXT_PUBLIC_ORG_COUNTRY=SS
NEXT_PUBLIC_APP_URL=https://app.tamamhealth.org
```

For larger deployments, manage secrets with **Doppler** (`DOPPLER_TOKEN` in the
host shell makes the compose entrypoint fetch them at boot) — see
`docs/operations/secrets.md`.

> **Gotcha:** `website/.env.production.example` doesn't exist in the repo, so
> nothing auto-generates `website/.env.production` — `deploy.sh` still checks
> for the file and refuses to run without it. `touch website/.env.production`
> is enough; the website container currently loads no env file at all
> (`docker-compose.yml` has no `env_file:` on that service).

### 3.5 Bring up the stack

```bash
# One-shot on a fresh VPS (installs Docker + Caddy + Let's Encrypt TLS, builds, starts):
sudo REPO_URL=<your-git-url> DOMAIN_ROOT=tamamhealth.org \
     DOMAIN_APP=app.tamamhealth.org DOMAIN_COUCH=couch.tamamhealth.org \
     bash deploy.sh

# …or manually:
docker compose build          # bakes NEXT_PUBLIC_* — env files must be ready
docker compose up -d
docker compose --profile analytics up -d   # only if you want Postgres analytics + sync-worker
```

Caddy auto-provisions TLS for the three domains. The platform health-checks at
`/`, CouchDB is reached only via `https://couch.<domain>`.

### 3.6 First-run / bootstrap

With `NEXT_PUBLIC_DEMO_MODE=false`, the app seeds a **clean production slate** —
only the initial super-admin user and a default organization (`seedProduction`),
**no demo patients**. Log in with the admin bootstrap credentials from
`platform/.env.production`, then create the facility (hospital), then real users.

### 3.7 Backups & DR

- The `couchdb-backup` service dumps every `tamamhealth_*` DB nightly (02:15 UTC)
  to a local volume. **Rotate that volume offsite** (encrypted) with rclone/rsync
  or a snapshotter — see `docs/operations/backups.md`.
- Test a restore quarterly. Keep the LUKS key escrowed securely off the server.

---

## Part 4 — Ship it to hospitals (per-facility rollout)

For each hospital/clinic/PHCU:

1. **Provision the facility in the platform.** Super-admin creates the hospital
   record and a `facility_administrator`; that admin creates local users with the
   right roles (front desk, nurse, clinical officer, lab tech, pharmacist,
   cashier, etc. — see `docs/RBAC-MATRIX.md`).
2. **Devices.** Any modern browser. Bookmark `https://app.<domain>`. No install.
   Add it to the home screen for a full-screen PWA feel.
3. **First sync.** On first login online, the browser pulls org/config/users and
   pushes nothing yet. Thereafter it works offline and syncs in the background
   when connectivity returns (`NEXT_PUBLIC_SYNC_ENABLED=true`).
4. **Offline behavior to train staff on:** everything saves locally and turns
   green/syncs later; the app never blocks care waiting for the network. The
   "Facility Sync" card shows what's pushed.
5. **Train by role**, following the live flow: register → triage → consult
   (the stepped wizard) → order labs / send to pharmacy → dispense → checkout.
   Use the seeded demo patient on a **non-production** demo build for training,
   never on the production server.
6. **Data ownership.** Each facility's records are org/hospital-scoped; the
   country node aggregates only what sync pushes.

### Production caveat — never re-seed a live database

`SEED_VERSION` bumps trigger `resetAllDatabases()` (destructive) and are for the
**demo** dataset only. On a production server (`NEXT_PUBLIC_DEMO_MODE=false`) you
run the clean `seedProduction` path and **must not** bump `SEED_VERSION` against a
DB holding real patient data — it would wipe it. Treat seed-version changes as
demo-only.

---

## Part 5 — Run it: monitoring, updates, support

- **Errors:** Sentry is wired (`NEXT_PUBLIC_SENTRY_DSN`, `sentry.*.config.ts`).
  Point it at an in-country or self-hosted Sentry to keep telemetry local.
- **National reporting / DHIS2:** stand up the **country node** (`country-node/`,
  Phase-3 scaffold) when a ministry/partner commits; the facility platform
  already emits `sync_events` and serves a metadata stand-in until then.
- **Updates:** `git pull` → `docker compose build` (re-bakes `NEXT_PUBLIC_*`) →
  `docker compose up -d`. Because clients are offline-first, roll updates during
  a low-traffic window; browsers pick up the new bundle on next load.
- **Health:** `docker compose ps` + the per-service healthchecks; watch disk on
  the encrypted volume (CouchDB grows with attachments).

---

## Part 6 — Get started (checklist)

1. [ ] Procure in-country Ubuntu 22.04 server + UPS + domain/DNS (3 records).
2. [ ] LUKS-encrypt the data volume; set the firewall (22/80/443 only).
3. [ ] Fill the 3 env files; set `NEXT_PUBLIC_DEMO_MODE=false`, `SYNC_ENABLED=true`,
       `NEXT_PUBLIC_COUCHDB_URL=https://couch.<domain>`.
4. [ ] Run `deploy.sh` (or `docker compose build && up -d`); confirm TLS on all 3 domains.
5. [ ] Log in as bootstrap admin; create the first hospital + facility admin.
6. [ ] Configure offsite encrypted backup rotation; test a restore.
7. [ ] Onboard one pilot facility: create users, train by role, run a real visit end to end.
8. [ ] Verify a record syncs (browser → CouchDB) and the Facility Sync card shows green.
9. [ ] (Later) stand up Postgres analytics + the country node for DHIS2/national reporting.

---

### Pointers to existing files

- `deploy.sh` — one-shot VPS bring-up (Docker + Caddy + TLS).
- `docker-compose.yml` — platform + website + CouchDB + nightly backup (+ Postgres `analytics` profile).
- `docs/DEPLOY-SOUTH-SUDAN.md` — the single-server runbook this guide builds on.
- `docs/operations/secrets.md`, `docs/operations/backups.md` — secrets (Doppler) and backup/DR detail.
- `country-node/`, `sync-worker/`, `regional-exchange/` — federation/analytics tiers.
- `docs/RBAC-MATRIX.md` — roles and what each can do.
