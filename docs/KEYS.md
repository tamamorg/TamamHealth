# SafeguardJunub / TamamHealth — API Keys & Database Credentials

> **NEVER commit real credentials to git.** All secrets go in `.env.local` (gitignored).
> This document describes what each credential is, where it's used, and how to configure it.

---

## Quick Setup

Copy the template and fill in your values:

```bash
cp .env.example .env.local
```

---

## Environment Variables Reference

### Client-Side (Public — exposed to browser)

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `NEXT_PUBLIC_SYNC_ENABLED` | Enable PouchDB ↔ CouchDB replication | `false` | No |
| `NEXT_PUBLIC_COUCHDB_URL` | CouchDB server URL (with credentials for auth) | `http://localhost:5984` | Only if sync enabled |

### Server-Side (Private — never sent to browser)

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://tamamhealth:password@localhost:5432/safeguard_junub` | For national analytics |
| `JWT_SECRET` | Secret key for signing session JWTs | Hardcoded fallback (INSECURE) | **Yes for production** |
| `COUCHDB_ADMIN_USER` | CouchDB admin username | `admin` | For setup script |
| `COUCHDB_ADMIN_PASSWORD` | CouchDB admin password | (empty) | For setup script & sync webhook |
| `COUCHDB_WEBHOOK_SECRET` | HMAC secret shared with `sync-worker`, signs every `/api/sync` request | — | Yes if the analytics sync worker is enabled |
| `COUCHDB_GATEWAY_SECRET` | Signs the same-origin `/api/couch` replication gateway used by the App Platform / database-per-org deployment | — | Yes if `NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED=true` |
| `PHI_ENCRYPTION_KEY` | Application-level AES key that encrypts the most sensitive patient fields before they hit CouchDB/PouchDB | — | **Yes for production** (on by default; see `lib/config-validation.ts`) |
| `TAMAMHEALTH_LICENSE_SECRET` | HMAC secret that signs this deployment's license key (SaaS control plane), per `platform/.env.production.example`'s comment | — | Template says required, but nothing in `platform/src` currently reads this variable or a `license` npm script — treat as not-yet-enforced until verified against a current build |
| `SUPERADMIN_INITIAL_PASSWORD` | Login password for the seeded `superadmin` bootstrap account | `Superadmin!` (demo only) | **Yes whenever `NEXT_PUBLIC_SYNC_ENABLED=true`** — `config-validation.ts` refuses to boot without a real, 16+ char value. Not listed in either `.example` template today; add it yourself. Distinct from the older, optional `ADMIN_INITIAL_PASSWORD` (legacy `admin` account). |

This table is not exhaustive — `platform/.env.production.example` is the
authoritative, current list of every variable the platform reads, including
the optional payment/SMS/email/DHIS2 integration keys.

---

## Credential Details

### 1. JWT Authentication Secret

- **Variable:** `JWT_SECRET`
- **Used in:** `src/lib/auth-token.ts`
- **Algorithm:** HS256 (HMAC SHA256)
- **Token lifetime:** 30 days by default (`DEFAULT_TTL_HOURS` in `src/lib/session.ts`), overridable with the `SESSION_TTL_HOURS` env var. A session that's still active gets silently re-minted on every `/api/auth/me` call (sliding renewal), so it doesn't expire mid-shift; changing or resetting the account's password invalidates every outstanding token immediately regardless of remaining life.
- **Cookie name:** `tamamhealth-token` (HTTP-only, SameSite=lax)
- **Fallback secret:** `tamamhealth-south-sudan-health-2026-secret-key` (development only — **NEVER use in production**)

**Generate a secure secret:**
```bash
openssl rand -base64 64
```

### 2. PostgreSQL (National Analytics Database)

- **Variable:** `DATABASE_URL`
- **Format:** `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`
- **Used in:** `src/lib/db/postgres.ts` (server-side API routes only)
- **Pool settings:** Max 10 connections, 30s idle timeout, SSL in production

| Parameter | Development | Production |
|-----------|-------------|------------|
| User | `tamamhealth` | Use a dedicated service account |
| Password | `password` | Strong random password |
| Host | `localhost` | Your PostgreSQL server |
| Port | `5432` | `5432` (default) |
| Database | `safeguard_junub` | `safeguard_junub` |
| SSL | Disabled | Enabled |

**Initialize / migrate the schema** (run from `platform/`; this also runs
automatically on server boot per `src/instrumentation.ts`):
```bash
npm run db:migrate
```
`src/lib/db/schema.sql` no longer exists — the migration script
(`scripts/migrate.ts`) is the current source of truth for the Postgres schema.

### 3. CouchDB (Regional Sync Server)

- **Variable:** `NEXT_PUBLIC_COUCHDB_URL`
- **Used in:** `src/lib/db.ts` (getRemoteDB), `src/lib/sync/` (sync layer)
- **Note:** This URL is public (sent to browser). Use CouchDB's built-in auth or a proxy.

| Parameter | Development | Production |
|-----------|-------------|------------|
| URL | `http://localhost:5984` | `https://couchdb.yourdomain.com` |
| Admin user | `admin` | Dedicated admin account |
| Admin password | (your choice) | Strong random password |

**Setup CouchDB** (run from `platform/`; there is no root-level
`scripts/setup-couchdb.sh` anymore):
```bash
COUCHDB_URL=http://admin:yourpassword@localhost:5984 npm run setup:couchdb:validators
```
This installs `validate_doc_update` + `_security` on every org-scoped
database. For the database-per-organization production model (App Platform
cutover), see `npm run db:migrate:couchdb-tenants` / `db:verify:couchdb-tenants`
and [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md).

### 4. Sync Webhook Authentication

- **Endpoint:** `POST /api/sync`
- **Auth:** HMAC-SHA256 machine-request signature (`verifySyncMachineRequest`
  in the route), not a bearer token — the caller signs the timestamp, a
  one-time nonce, HTTP method, path, and body with `COUCHDB_WEBHOOK_SECRET`
  (min 32 chars). The platform stores each nonce in shared Redis for ten
  minutes and rejects a stale or replayed request.
- **Purpose:** CouchDB `_changes` feed → PostgreSQL upserts, for national
  analytics only (many `tamamhealth_*` databases are deliberately excluded —
  see the coverage matrix at the top of `src/app/api/sync/route.ts`)
- **Used by:** the `sync-worker` service (`sync-worker/index.mjs`), which
  polls CouchDB `_changes` and posts signed batches — see `sync-worker/README.md`

### 5. Password Hashing

- **Library:** `bcryptjs` v3.0.3
- **Rounds:** 12
- **Location:** `src/lib/auth.ts`
- **Storage:** User passwords are stored as bcrypt hashes in PouchDB/CouchDB under the `passwordHash` field
- **No additional credentials needed** — bcrypt is self-contained

---

## Security Configuration

### Login Rate Limiting

- **Max attempts:** 5 failed logins per username, 20 failed logins per IP
  (`src/app/api/auth/login/route.ts`)
- **Lockout duration:** 15 minutes for both
- **Backing store:** Upstash Redis when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are
  configured (required once you run more than one app instance), in-memory
  per-instance counters otherwise — see `src/lib/rate-limit.ts`
- **Protection:** Constant-time password comparison, generic error messages (no username enumeration)

### Route Protection (Edge middleware)

- **Cookie:** `tamamhealth-token` (JWT)
- **Protected:** All routes except `/`, `/api/auth/*`, static assets
- **RBAC:** Role-based access enforced per route in `src/proxy.ts` — Next.js
  16's renamed `middleware.ts` entry point (`src/middleware.ts` no longer
  exists)

### Content Security Policy

- CouchDB URL is dynamically added to `connect-src` in `next.config.mjs`
- `frame-ancestors: 'none'` prevents clickjacking
- HSTS enabled with 2-year max-age

---

## Database Architecture

```
Browser (each hospital)         Regional Server              National Server
+-------------------+          +------------------+         +------------------+
|                   |          |                  |         |                  |
|   PouchDB         |  sync   |   CouchDB        |  POST   |   PostgreSQL     |
|   (IndexedDB)     | <-----> |   (document DB)  | ------> |   (analytics)    |
|                   |          |                  |  /api/  |                  |
+-------------------+          +------------------+  sync   +------------------+
  No credentials needed         COUCHDB_URL                   DATABASE_URL
                                COUCHDB_ADMIN_*               JWT_SECRET
                                COUCHDB_WEBHOOK_SECRET
```

### PouchDB Databases (this list is illustrative, not exhaustive)

The platform has grown well past the 20 databases this table once listed.
Three related but different counts, per `platform/README.md` /
`platform/AGENTS.md` — don't conflate them:

- **76** unique `tamamhealth_*` PouchDB databases declared in `src/lib/db.ts`.
- **74** of those have a replication entry in `src/lib/sync/sync-config.ts`
  (`DATABASE_SYNC_CONFIGS`) — the authoritative, current source for each
  database's sync direction and org-scoping.
- **44** entries in `DB_TABLE_MAP` in `src/app/api/sync/route.ts` — the subset
  that also writes back to the Postgres analytics tables.

Treat the sample below as illustrative of the pattern, not a full list:

| Database | Sync Direction | Org-Scoped |
|----------|---------------|------------|
| `tamamhealth_patients` | Both | Yes |
| `tamamhealth_medical_records` | Both | Yes |
| `tamamhealth_referrals` | Both | Yes |
| `tamamhealth_lab_results` | Both | Yes |
| `tamamhealth_prescriptions` | Both | Yes |
| `tamamhealth_disease_alerts` | Both | No (national) |
| `tamamhealth_messages` | Both | Yes |
| `tamamhealth_births` | Both | Yes |
| `tamamhealth_deaths` | Both | Yes |
| `tamamhealth_facility_assessments` | Both | Yes |
| `tamamhealth_immunizations` | Both | Yes |
| `tamamhealth_anc` | Both | Yes |
| `tamamhealth_follow_ups` | Both | Yes |
| `tamamhealth_hospitals` | Both | Yes |
| `tamamhealth_users` | Pull only | Yes |
| `tamamhealth_organizations` | Pull only | No |
| `tamamhealth_platform_config` | Pull only | No |
| `tamamhealth_audit_log` | Push only | Yes |

Some of the newer databases (e.g. `tamamhealth_saved_payment_methods`,
`tamamhealth_biometric_templates`) are intentionally excluded from the
national-analytics sync path entirely — see the exclusion list documented at
the top of `src/app/api/sync/route.ts`.

---

## Production Checklist

- [ ] Generate a strong `JWT_SECRET` (64+ characters)
- [ ] Set up PostgreSQL with a dedicated user and strong password
- [ ] Set up CouchDB with admin credentials and TLS
- [ ] Set `NEXT_PUBLIC_COUCHDB_URL` to the production CouchDB URL (HTTPS)
- [ ] Set `NEXT_PUBLIC_SYNC_ENABLED=true`
- [ ] Set `SUPERADMIN_INITIAL_PASSWORD` (required whenever sync is enabled — not in either `.example` template)
- [ ] Run `npm run setup:couchdb:validators` (from `platform/`) to install `validate_doc_update` + `_security`
- [ ] Run `npm run db:migrate` (from `platform/`) to initialize/migrate PostgreSQL — also runs automatically at boot
- [ ] Restrict CORS origins in CouchDB to your domain only
- [ ] Enable PostgreSQL SSL (`ssl: { rejectUnauthorized: true }` with proper certs)
- [ ] Set up the CouchDB → PostgreSQL `sync-worker` (calls `POST /api/sync`, HMAC-signed with `COUCHDB_WEBHOOK_SECRET`)
- [ ] Verify `.env.local` is in `.gitignore` (it is by default)
