# Go-Live Checklist — production readiness (2026-08)

Status as of 2026-08-13: **NOT production-ready.** The application code is in good
shape (full test suite green, production config validation in place), but there are
infrastructure and security-hardening blockers below. This is a PHI platform, so the
bar is "safe for real patient data."

Full runbook: [DEPLOY-PRODUCTION.md](./DEPLOY-PRODUCTION.md). This file is the
current-state blocker list + exact commands, not a replacement for it.

---

## Blocker 1 — CouchDB is unreachable (CRITICAL, gates everything)

`GET https://tamamhealth-v6.vercel.app/api/health` → `couchdb: unavailable`.
CouchDB is the clinical datastore + sync backbone. Root cause: the live
`COUCHDB_ADMIN_PASSWORD` is stale and cannot be corrected because **SSH to the
data droplet is blocked** (the admin key never landed in `authorized_keys`).

Data droplet: `tamamhealth-data` — public 164.92.196.189, private 10.114.0.3,
droplet id 591879204, `doctl` context `tamamhealth-final-deploy`.

**Recover access (pick one — both need you at the DO console/CLI):**
- DO web console → Droplets → tamamhealth-data → Access → paste the admin public
  key into `~/.ssh/authorized_keys` for root; or
- `doctl compute droplet-action password-reset 591879204` (emails root password;
  **reboots the droplet — CouchDB briefly down**, so do it in a maintenance window).

**Then, on the droplet:**
1. Read the real CouchDB admin password: `grep COUCHDB_PASSWORD /opt/tamamhealth/.env.data`
2. Ensure CouchDB binds to the VPC IP so App Platform can reach it:
   set `COUCHDB_BIND_ADDRESS=10.114.0.3` (compose default is 127.0.0.1) and
   `docker compose -f docker-compose.data.yml up -d`.
3. Put that password into every deploy env below as `COUCHDB_ADMIN_PASSWORD`.

Verify: `/api/health` returns `couchdb: ok`.

---

## Blocker 2 — No production app deployment exists (HIGH)

`app.tamamhealth.org` does not serve; `tamamhealth.org` is the marketing site.
The intended production stack (DO App Platform: per-org CouchDB + same-origin
`/api/couch` gateway), merged to `main`, has never been deployed — cold start,
no fallback.

- Apply infra: `infra/digitalocean/app-platform/` with the local-state override
  (`backend_override.tf`, gitignored, never commit). Reviewed plan preserves SSH
  from your IP + public 80/443 and adds 5984 from the VPC.
- This apply is also what **locks the analytics Postgres cluster's trusted
  sources** (currently open) to the app + data droplet. Do not skip it.
- First apply on the default `*.ondigitalocean.app` ingress (DNS for
  tamamhealth.org is on GoDaddy, not DO), then cut over the domain.
- After boot, confirm the served browser bundle actually shipped the
  `NEXT_PUBLIC_*` sync flags (build-time ARGs default to false).

The v6 Vercel deployment is a demo/staging shim, not this stack. Deploying v6
alone does not make the platform production-ready.

---

## Blocker 3 — Required production secrets (fail-closed at boot)

`instrumentation.ts` runs `validateProductionConfig` and **refuses to boot** on any
missing/placeholder secret. Every one of these must be set in the App Platform env
(and any Vercel deploy meant for real use):

- `JWT_SECRET` (≥32 chars), `PHI_ENCRYPTION_KEY` (32 bytes base64), `PHI_ENCRYPTION_ENABLED=true`
- `COUCHDB_URL` (https or private-VPC http), `COUCHDB_ADMIN_USER`, `COUCHDB_ADMIN_PASSWORD` (≥20, real value from Blocker 1)
- `COUCHDB_GATEWAY_SECRET` (≥32), `COUCHDB_WEBHOOK_SECRET` (≥32)
- `NEXT_PUBLIC_SYNC_ENABLED=true`, `NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true`,
  `NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED=true`, `NEXT_PUBLIC_COUCHDB_URL=<origin>/api/couch`,
  `NEXT_PUBLIC_APP_URL=<origin>`
- Upstash Redis (`UPSTASH_REDIS_REST_URL`/`_TOKEN`) for shared rate limiting
- **NEW this session — `SUPERADMIN_INITIAL_PASSWORD`** (≥16 chars, NOT the demo
  default `Superadmin!`). Boot now refuses without it. Set a strong secret; the
  `superadmin` account is provisioned on first login and **forced to change it**
  immediately (bootstrap credential is single-use). Add this to
  `terraform.tfvars` / the App Platform env before deploying, or the app won't start.

---

## Security hardening applied this session (code, committed separately)

- `superadmin` seeded in all modes with initial `Superadmin!` (env-overridable);
  production auth provisions the operator doc on first login (create-if-absent,
  DB-authoritative so a changed password can't be shadowed).
- Production config now **requires** a strong `SUPERADMIN_INITIAL_PASSWORD`.
- Production bootstrap forces `mustChangePassword` on first login.
- Impersonated ("sign in as") actions stamp `actualRole` into the audit trail.
- `/api/demo-credentials` gate hardened to fail-closed (`=== 'true'`).

## Production-readiness audit findings

_(Filled from the auth/PHI/tenant/deploy audit — see below once complete.)_

---

## Pre-cutover verification gates

1. `/api/health` → all checks `ok` (server, database, couchdb).
2. Boot logs show no `PRODUCTION STARTUP REFUSED`.
3. Log in as `superadmin`, forced password change succeeds, total access works.
4. Cross-tenant isolation smoke test: a non-admin in org A cannot see org B data.
5. Backup + restore drill (`scripts/backup-restore-drill.sh`) passes.
6. Confirm analytics Postgres trusted-sources is locked (not open).
