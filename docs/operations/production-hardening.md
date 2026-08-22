# Production Hardening — Real PHI / In-Country Deployment

A focused, security-critical checklist for promoting TamamHealth from the demo
deployment to a **live deployment holding real patient data (PHI)**, in or for
South Sudan. This complements the deploy mechanics in
[`STEP-BY-STEP-PLAYBOOK.md`](../STEP-BY-STEP-PLAYBOOK.md),
[`DEPLOY-SOUTH-SUDAN.md`](../DEPLOY-SOUTH-SUDAN.md) and
[`DEPLOYMENT-AND-ROLLOUT.md`](../DEPLOYMENT-AND-ROLLOUT.md); it does not repeat
them. Run [`scripts/preflight.sh`](../../scripts/preflight.sh) before every
deploy — it now enforces several of the gates below automatically.

> **Golden rule:** a build that fails preflight does not ship. Real PHI does not
> go onto a host until every **MUST** item here is satisfied.

---

## 1. Secrets

- **MUST** generate all secrets with `scripts/gen-secrets.sh` (never hand-write
  keys); the files it writes are gitignored and `chmod 600`.
- **MUST NOT** keep plaintext secret backups in the tree (e.g. `*.real.bak`).
  Preflight fails if any `platform/.env*.bak` / `*.real*` exists.
- **MUST** keep the JWT signing key **server-only** (`JWT_SECRET`). Do **not**
  set `NEXT_PUBLIC_JWT_SECRET` in `platform/.env.production` — a `NEXT_PUBLIC_`
  copy is baked into the browser bundle and lets anyone with the client JS forge
  tokens for any role. Preflight fails if it appears. (The production template
  correctly omits it; `auth-token.ts` falls back to a hardcoded default on the
  client only, which the server refuses to verify — so offline-minted tokens are
  never server-valid. See §6.)
- **MUST** rotate every secret before go-live and on staff offboarding:
  `JWT_SECRET`, `COUCHDB_ADMIN_PASSWORD`, the Postgres password in
  `DATABASE_URL`, `COUCHDB_WEBHOOK_SECRET`, and the bootstrap credentials
  (`SUPERADMIN_INITIAL_PASSWORD`, `ADMIN_INITIAL_PASSWORD` if set — see §2).
  Prefer a secrets manager (Doppler — see [`secrets.md`](secrets.md) — or AWS
  SSM / `docker secrets`) over files on disk.

## 2. Demo mode OFF

- **MUST** set `NEXT_PUBLIC_DEMO_MODE=false` in `platform/.env.production`.
  Demo mode seeds the full demo staff roster. Preflight fails if it is `true`.
  (`/api/demo-credentials` has since been removed from the app — the login
  page's demo role chips are gone too; the only bootstrap path today is the
  seeded `superadmin` account, see below.)
- **MUST** set `SUPERADMIN_INITIAL_PASSWORD` in `platform/.env.production`
  whenever `NEXT_PUBLIC_SYNC_ENABLED=true` (the production default) —
  `config-validation.ts` refuses to boot without it, refuses the well-known
  demo value (`Superadmin!`), and requires 16+ characters. Neither
  `platform/.env.production.example` nor `platform/.env.example` currently
  lists this variable, so add it yourself; it is separate from the older,
  optional `ADMIN_INITIAL_PASSWORD` (for the legacy `admin` account).
- **MUST NOT** bump `SEED_VERSION` against a live database — it triggers a
  destructive `resetAllDatabases()`. Seed once on a clean host, then leave it.

## 3. TLS everywhere

- **MUST** terminate HTTPS for the app **and** for CouchDB. `NEXT_PUBLIC_COUCHDB_URL`
  must be `https://…` so browser → CouchDB replication isn't plaintext PHI on
  the wire. Use the Caddy/Let's Encrypt path in the playbook, or a reverse proxy
  with a valid cert; never expose CouchDB on plain `:5984` off-box.
- **MUST** keep CouchDB (`5984`) and Postgres (`5432`) bound to `127.0.0.1`
  (already set in `docker-compose.yml`) — only the reverse proxy is public.
- Enforce HSTS (already sent by `next.config.mjs`) so clients refuse downgrade.

## 4. Encryption at rest (data residency)

- **MUST** store the CouchDB and Postgres data volumes on an **encrypted disk**
  (LUKS on a self-managed host, or the cloud's encrypted-EBS/volume equivalent).
  PHI residency for South Sudan means the encrypted volume must live on an
  MoH-approved / in-country host — see
  [`AFRICA-HOSTING-STRATEGY.md`](../AFRICA-HOSTING-STRATEGY.md). DigitalOcean has
  no Africa region, so it is **demo-only** for real PHI.
- Point Docker's data-root at the encrypted mount so container layers and
  volumes land there, not on the unencrypted root disk.

## 5. Backups & retention

- **MUST** schedule the nightly CouchDB + Postgres dumps
  ([`backup-couchdb.sh`](../../scripts/backup-couchdb.sh),
  [`backup-postgres.sh`](../../scripts/backup-postgres.sh)) and ship them **encrypted,
  offsite** (in-country/approved storage). See [`backups.md`](backups.md).
- **MUST** periodically run [`backup-restore-drill.sh`](../../scripts/backup-restore-drill.sh)
  — an untested backup is not a backup. Document the retention window and who
  holds the restore key.

## 6. Auth & session

- Online login is server-issued (`/api/auth/login`) HS256 JWT, 30 days by
  default (`SESSION_TTL_HOURS` override, sliding renewal on every
  `/api/auth/me` call — see `src/modules/identity/core/session.ts`), with revocation enforced
  at `/api/auth/me` and every `/api/*` route. CSRF is a two-layer gate
  (Origin/Host check + HMAC double-submit) in `src/proxy.ts` (Next.js 16's
  `middleware.ts` equivalent).
- **Offline-first tradeoff (document for operators):** when the API is
  unreachable, the client mints a local session token so a previously-synced
  clinician can keep working offline. In production that token is signed with a
  key the server does not accept, so it is **only** valid on-device and is
  rejected the moment the device reconnects (the user re-logs in online). This
  is intentional — do **not** "fix" it by publishing `NEXT_PUBLIC_JWT_SECRET`
  (that would let clients forge server-valid tokens). For maximum-assurance
  sites that want no client-side minting at all, require online login.
- **MUST** force a password change on every admin-issued credential (already
  enforced via `mustChangePassword`).

## 7. CouchDB multi-tenant isolation

- **SHOULD** set per-database `_security` so a facility/org CouchDB user can only
  read/write its own databases, defence-in-depth behind the org-scoped sync
  filters. Verify a facility account cannot pull another org's `tamamhealth_*`
  databases.

## 8. High availability (multi-instance)

- The login rate limiter and the patient-portal login backoff are **in-memory**
  and fail open; they degrade to per-instance counters behind a load balancer.
  **MUST** configure `UPSTASH_REDIS_REST_URL` / `_TOKEN` (or equivalent shared
  store) before running more than one app instance, or rate limiting is
  effectively disabled.

## 9. The financial ledger

- `tamamhealth_ledger` now replicates **both** ways (it is read for live patient
  balances at the point of care, so every station/device must converge). Confirm
  sync is healthy after deploy — a one-way ledger shows different balances per
  device.

---

## Pre-go-live checklist (copy into the deploy ticket)

- [ ] `scripts/preflight.sh` passes (tsc + lint + jest + env hygiene + leak scan)
- [ ] `NEXT_PUBLIC_DEMO_MODE=false`
- [ ] `SUPERADMIN_INITIAL_PASSWORD` set to a real, 16+ character secret (not `Superadmin!`)
- [ ] No `NEXT_PUBLIC_JWT_SECRET` in `platform/.env.production`; all secrets rotated
- [ ] No `*.real.bak` / plaintext secret files on the host
- [ ] HTTPS for app **and** CouchDB; 5984/5432 bound to 127.0.0.1
- [ ] CouchDB + Postgres volumes on an encrypted, in-country/approved disk
- [ ] Nightly encrypted offsite backups scheduled **and** a restore drill passed
- [ ] CouchDB per-DB `_security` verified (cross-org read denied)
- [ ] Shared rate-limit store configured if running >1 instance
- [ ] Ledger sync confirmed bidirectional and balances consistent across two devices
