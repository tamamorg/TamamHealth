# Tamam Health — Production Security & Operations Runbook

**Deployment model:** centrally hosted SaaS (the operator runs the servers; facilities connect over the internet).
As of the 2026-08-12 go-live, the concrete topology is: the platform app runs
on **DigitalOcean App Platform**, and CouchDB + the analytics Postgres cluster
run on a separate **data droplet** behind Caddy, reachable only from the
platform app and never directly from a browser (browsers talk to CouchDB
through the authenticated same-origin `/api/couch` gateway). See
`infra/digitalocean/app-platform/README.md` and `infra/digitalocean/README.md`
for the authoritative infra details. `deploy-production.yml` also offers
`vps` (SSH + docker-compose to a droplet — its default) and `aws`
(CloudFormation) targets; those are alternate/legacy deploy paths that still
exist in CI, not the current production path — know which one you're
operating on before running anything.
**Audience:** the platform operator / SRE team.
**Goal:** launch securely, keep operational control after launch, and protect patient data (PHI).

This runbook is the single source of truth for going from "code is ready" to
"running in production safely." It complements the security notes in
`docs/security/*` (CSRF, rate-limiting, token revocation, audit logging) and the
monitoring guide in `docs/operations/monitoring.md`. A separate, more
detailed root-level `docs/operations/` tree (`backups.md`, `secrets.md`,
`production-hardening.md`) documents the single-VPS/EC2 systemd-timer model
in more depth — useful if you're operating the `vps`/`aws` path, but written
before the DO App Platform + data-droplet topology existed, so cross-check
before assuming it applies unchanged there.

---

## 1. Pre-launch security checklist

Boot is **refused** in production (`NODE_ENV=production`) when any of these are
missing or weak — the rules live in `src/lib/config-validation.ts` and run from
`src/instrumentation.ts`. Set every one before deploying. (`NEXT_PUBLIC_DEMO_MODE`
is listed first because it changes which of the other checks apply — it's a
mode switch, not itself a pass/fail check.)

- [ ] `NEXT_PUBLIC_DEMO_MODE=false` — this doesn't fail boot on its own, but
      leaving it `true` (or unset in a context that defaults to demo) *relaxes*
      several of the checks below (PHI-at-rest declaration, sync/CouchDB
      config, tenant-DB routing, superadmin password) — so a real production
      deploy that's accidentally still in demo mode can boot successfully
      with weaker guarantees than intended. Confirm it's explicitly `false`.
- [ ] `JWT_SECRET` — `openssl rand -base64 48` (≥32 chars, no placeholder). **Enforced at boot.**
- [ ] `ADMIN_INITIAL_PASSWORD` — if you set it, it must not be a placeholder value. Leaving it **entirely unset is not itself an error** (the seed flow auto-generates a password into `platform/.seed-credentials.json` on first boot) — but do set it deliberately rather than relying on that fallback in production.
- [ ] `NEXT_PUBLIC_ADMIN_PASSWORD` — **must be unset** (it would bundle into client JS). **Enforced at boot.**
- [ ] `SUPERADMIN_INITIAL_PASSWORD` — required (outside demo mode), ≥16 chars, must not be the shipped default `Superadmin!` or a placeholder. **Enforced at boot** — easy to miss since it protects the platform's most-privileged account and isn't mentioned by name anywhere else in this checklist historically.
- [ ] PHI-at-rest declaration — set `PHI_AT_REST_STRATEGY=disk-encryption` **or** `PHI_ENCRYPTION_ENABLED=true` + `PHI_ENCRYPTION_KEY` (`openssl rand -base64 32`). **Enforced at boot** (outside demo mode) — this is mandatory, not merely the optional field-level layer described in §3.2. Encrypting the disk without setting this env var still refuses to boot.
- [ ] Shared rate-limit/revocation backend or explicit ack — set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_URL`/`KV_REST_API_TOKEN` aliases), **or** set `SINGLE_REPLICA_ACK=true` if you're deliberately running one replica. **Enforced at boot.** Without this, login rate limits and JWT revocation aren't shared across replicas — see `docs/security/rate-limiting.md` and `docs/security/token-revocation.md`.
- [ ] `NEXT_PUBLIC_SYNC_ENABLED=true` (outside demo/single-org mode) + `COUCHDB_URL` (server-side) + `NEXT_PUBLIC_COUCHDB_URL` (browser-facing) + `COUCHDB_WEBHOOK_SECRET` (≥32 chars). **Enforced at boot.** Sync isn't an optional toggle in production — shared CouchDB replication is required for multi-user patient data unless you're deliberately single-org/demo.
- [ ] Tenant-database mode — set `NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true` (plus `COUCHDB_ADMIN_USER`/`COUCHDB_ADMIN_PASSWORD`, ≥20 chars) **or** `SINGLE_ORG_MODE=true`. **Enforced at boot.**
- [ ] `AIRTEL_WEBHOOK_SECRET` and `MPESA_WEBHOOK_SECRET` — required unconditionally (not gated on a payments feature flag), ≥32 chars, no placeholder. **Enforced at boot.**
- [ ] `DATABASE_URL` — Postgres for national analytics. **Not enforced at boot** — if unset, `instrumentation.ts` logs and skips analytics migrations rather than refusing to start; that's a valid "not using analytics yet" configuration. Set it once you want the analytics writeback + migrations running.
- [ ] HTTPS terminated in front of the app (required for `Secure` cookies + HSTS/CSP; not a `config-validation.ts` check — it's an infra prerequisite).
- [ ] `SENTRY_DSN` (recommended, not enforced) for 5xx triage — PHI is scrubbed before transport.
- [ ] LiveKit telehealth (only if used) — `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` must be all-set-or-all-unset, and the two `NEXT_PUBLIC_LIVEKIT_*` variants must NOT be set. **Enforced at boot** when partially configured.

Secrets live in your secrets manager (Doppler is wired via `DOPPLER_TOKEN`
and its injection is verified at boot by `assertDopplerEnv()` — a genuine
boot-time check, not just aspirational tooling; AWS Secrets Manager / SSM
also work, but only by injecting env vars externally — there's no
corresponding app-side verification code for those). Never commit
secrets; `.env*` files are gitignored.

---

## 2. Keeping control after launch

### 2.1 Tenant kill-switch (suspend / revoke a deployment)

Each tenant is an **organization** (`OrganizationDoc`). Its access state is
enforced on **every authenticated API request** by `getAuthPayload`
(`src/lib/api-auth.ts`) via `tenant-control-service.ts`. To revoke access after
launch, set any of these on the org — it takes effect on the org's **next
request**, no redeploy:

| Field | Effect |
|---|---|
| `subscriptionStatus = 'suspended'` | Immediate denial (reversible). |
| `subscriptionStatus = 'cancelled'` | Immediate denial (terminal). |
| `isActive = false` | Immediate denial. |
| `accessExpiresAt = <past ISO date>` | Hard expiry — denies after the date. |

Set these from the **Admin → Organizations** screen (super-admin). Platform
operators (`super_admin`) are exempt from the check, so you can always lift a
suspension. The control **fails open** on a transient DB read error (a live
clinic is never bricked by an outage) and **fails closed** only on an explicit
operator action.

### 2.2 Token revocation (per user / per session)

`docs/security/token-revocation.md` — logout and admin deactivation revoke a
user's JWT. Deactivating a user (`isActive=false`) is enforced on every request
in the same gate as the tenant check.

### 2.3 Usage telemetry / monitoring

- **Errors / performance:** Sentry (`SENTRY_DSN`), PHI-scrubbed. Thresholds and
  PagerDuty wiring in `docs/operations/monitoring.md`.
- **Liveness:** `GET /api/health` — unauthenticated, checks actual CouchDB and
  Postgres reachability (not just "the process is up") and returns 503 if
  either configured dependency is down. This is what
  `deploy-app-platform.yml`'s post-deploy step polls before declaring a
  rollout healthy, and is a stronger uptime-probe target than `/api/auth/me`
  — see `docs/operations/monitoring.md`.
- **Per-tenant usage:** Admin → Organizations + `getOrganizationStats(orgId)`
  (user count, hospital count, patient count); national analytics dashboards
  aggregate cross-org once `DATABASE_URL` is set.

### 2.4 Controlled updates / patches

- Ship only signed, tagged releases; pin the container image by digest, not a
  floating tag.
- Postgres migrations are applied at boot under an advisory lock
  (`src/lib/db/migrate.ts`) so rolling replicas can't race; a migration whose
  file was **edited after it was already applied** refuses to start (a
  SHA-256 hash mismatch throws with a "roll forward with a new migration
  instead" error). Files apply in sorted-filename order with duplicate-version
  detection, which prevents most out-of-order scenarios in practice, but
  there isn't an explicit "new file's version must exceed the highest
  applied version" check — don't rely on that guard existing if you're
  hand-editing migration ordering.
- Set `SENTRY_RELEASE=$(git rev-parse --short HEAD)` so errors group by build and
  you can confirm exactly what each tenant is running.
- Roll back by redeploying the previous image digest; migrations are
  forward-only, so test schema changes on staging first.

---

## 3. Protecting the data

### 3.1 Encryption in transit
- HTTPS everywhere. HSTS and CSP headers are set in `next.config.mjs`
  (`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`,
  plus a full CSP with `frame-ancestors 'none'` and `upgrade-insecure-requests`);
  secure/httpOnly session cookies are set separately in the auth routes
  (`src/lib/session.ts`), not in `next.config.mjs`.
- CouchDB replication uses the public HTTPS endpoint (`NEXT_PUBLIC_COUCHDB_URL`);
  the server reaches CouchDB over the internal network only. On the current
  DO App Platform topology, browsers reach CouchDB through the authenticated
  same-origin `/api/couch` gateway rather than talking to the data droplet
  directly — see the top-of-doc topology note.

### 3.2 Encryption at rest
The app itself requires you to **declare** which of these two strategies
you're using — see §1's `PHI_AT_REST_STRATEGY` / `PHI_ENCRYPTION_ENABLED`
checklist item; boot refuses to start in production without one of them
set, so this isn't purely an infra recommendation.

1. **Infrastructure (`PHI_AT_REST_STRATEGY=disk-encryption`):** enable
   disk/volume encryption on every node that stores data — Postgres volume,
   CouchDB volume, and backups (e.g. LUKS, or your cloud's encrypted EBS/PD +
   encrypted snapshots).
2. **Field-level (`PHI_ENCRYPTION_ENABLED=true` + `PHI_ENCRYPTION_KEY`,
   defence-in-depth):** encrypts the most sensitive fields with AES-256-GCM
   (`src/lib/field-encryption.ts`). Ciphertext is self-describing
   (`enc:v1:…`), idempotent, and reads tolerate not-yet-migrated plaintext, so
   you can roll it out gradually. Keep the key in the secrets manager — losing it
   means losing the encrypted data.

### 3.3 Access control & isolation (already enforced)
- **Org scoping:** every record carries `orgId`; reads/writes are scoped
  (`data-scope.ts`) and CouchDB enforces it server-side via a
  `validate_doc_update` design doc (`scripts/setup-couchdb.sh`).
- **Role-based routing & API authz:** `role-routes.ts` + per-route role checks.
- **Audit trail:** `audit-service.ts` logs auth, PHI access, signing, allergy /
  directive / consent / billing changes (`docs/security/audit-logging.md`).
- **CSRF + rate limiting:** `docs/security/csrf.md`, `docs/security/rate-limiting.md`.

### 3.4 Backups & recovery
Both the daily capture and the quarterly restore drill are already
automated — this section used to describe a manual process; it doesn't
need to be built, just verified and kept running.

- **Daily capture:** systemd timers on the data host —
  `tamamhealth-backup-couchdb.timer` (02:30 UTC) and
  `tamamhealth-backup-postgres.timer` (02:45 UTC) — run
  `scripts/backup-couchdb.sh` / `scripts/backup-postgres.sh`, which GPG-encrypt
  versioned snapshots and upload them off-site (S3 in `af-south-1`, or B2).
  Full detail in the root-level `docs/operations/backups.md`.
- **Quarterly restore drill — automated, not manual.** GitHub Actions
  workflow `backups-restore-drill` (`.github/workflows/backups-cron.yml`,
  job `drill`, `environment: production`) runs on a schedule offset from the
  nightly backup window, downloads the latest encrypted CouchDB/Postgres
  snapshots, decrypts them with a GPG key from secrets, and runs
  `scripts/backup-restore-drill.sh` — a structural, read-only drill (it does
  **not** mutate any database). It's also `workflow_dispatch`-able on demand
  for an ad-hoc verification. This already satisfies (and exceeds) "test
  restores quarterly" — the operator's job is to make sure the workflow keeps
  passing and to look at it when it doesn't, not to run `pg_dump` by hand.
- **Retention:** `docs/operations/backups.md` documents 730-day retention via
  S3 lifecycle policy — reconcile with this doc's own retention language if
  you keep one separately, rather than trusting both to agree by default.
- **Data-droplet caveat:** the systemd-timer backup setup in
  `docs/operations/backups.md` was written for the single-VPS/EC2
  "production host" model. Whether the current DO App Platform + data-droplet
  topology's data droplet runs the same timers unchanged (via
  `infra/digitalocean/cloud-init-data-plane.yaml`) wasn't confirmed while
  writing this doc — check that cloud-init file before assuming continuity,
  and update this note once verified either way.
- **Manual restore verification:** independent of the automated drill above,
  periodically stand up the latest backups on a staging stack, boot the app,
  and confirm login + a patient chart loads — the automated drill is
  structural (files decrypt and look right); a full app boot against
  restored data is a different, complementary check. Document the
  wall-clock RTO when you do.

### 3.5 Data residency / deletion
- All clinical data stays within the org's tenant scope; cross-org reads are
  impossible through the API (org scope) and the CouchDB validator.
- For a tenant offboard: suspend (§2.1), export their data (org-scoped), then
  purge their `orgId` records and snapshots per your data-retention agreement.

---

## 4. Incident response (summary)
1. **Contain:** suspend the affected tenant (§2.1) and/or revoke compromised
   user tokens. Rotate `JWT_SECRET` to invalidate all sessions if needed.
2. **Assess:** pull the audit log + Sentry timeline for the window.
3. **Eradicate / recover:** patch, redeploy a signed image, restore from backup
   if data integrity is in doubt.
4. **Postmortem:** blameless write-up; feed fixes back into this runbook.

---

## 5. Quick reference — required production env

This is a shorthand of §1, not a substitute for it — several of these are
required only outside demo mode, and the PHI-at-rest / Redis-backend items
are "one of two options," not both. Read §1 before copying this verbatim.

```bash
NODE_ENV=production
NEXT_PUBLIC_DEMO_MODE=false
JWT_SECRET=$(openssl rand -base64 48)
SUPERADMIN_INITIAL_PASSWORD=…         # ≥16 chars, not the shipped default
# HTTPS terminated upstream; secure cookies + CSP on

# PHI-at-rest — pick ONE:
PHI_AT_REST_STRATEGY=disk-encryption
# — or — PHI_ENCRYPTION_ENABLED=true + PHI_ENCRYPTION_KEY=$(openssl rand -base64 32)

# Shared rate-limit/revocation backend — pick ONE:
UPSTASH_REDIS_REST_URL=…
UPSTASH_REDIS_REST_TOKEN=…
# — or — SINGLE_REPLICA_ACK=true

# Sync (required unless SINGLE_ORG_MODE=true):
NEXT_PUBLIC_SYNC_ENABLED=true
COUCHDB_URL=…
NEXT_PUBLIC_COUCHDB_URL=…
COUCHDB_WEBHOOK_SECRET=…              # ≥32 chars

# Payments (required unconditionally):
AIRTEL_WEBHOOK_SECRET=…               # ≥32 chars
MPESA_WEBHOOK_SECRET=…                # ≥32 chars

# Not enforced at boot, but needed for analytics writeback + migrations:
DATABASE_URL=postgresql://…

# Optional but recommended:
SENTRY_DSN=…
```

Boot will refuse to start until the required values (per §1, accounting
for demo mode) are present and non-placeholder.
