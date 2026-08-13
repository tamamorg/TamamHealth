# Go-live: exactly what to do, in order

Status 2026-08-13: **not production-ready yet.** Follow these steps in order.
Steps marked **[YOU]** need your access/decision; **[DONE]** is already committed;
**[CODE]** is a remaining code task. Do not migrate real patient data until every
CRITICAL item is closed.

---

## Step 0 — [YOU] Decide the PHI-at-rest approach (CRITICAL, blocks real patients)

Field-level encryption is currently a no-op for the data that matters: the key
(`PHI_ENCRYPTION_KEY`) is server-only, but patient writes happen offline-first in
the browser, and `patient-service.ts` encrypts nothing — so names, national ID,
DOB, phone rest as **plaintext** in the browser's IndexedDB and in CouchDB, even
though boot asserts `PHI_ENCRYPTION_ENABLED=true`.

Pick one:
- **(A) Rely on full-disk / volume encryption** (recommended, keeps offline-first):
  encrypt the CouchDB data volume on the droplet and require device encryption on
  clinician laptops; then correct the app so it stops *claiming* field-level
  at-rest encryption it doesn't provide for browser-written PHI. Cheapest path to a
  defensible posture.
- **(B) Route all PHI writes through the server** so the field-encryption key is
  available at write time. Strongest, but breaks the offline-first model — large
  change.

Tell me which, and I'll implement the code side of your choice.

---

## Step 1 — [YOU] Regain access to the data droplet (CRITICAL)

CouchDB is down because its admin password is stale and you can't SSH in.
Droplet: `tamamhealth-data`, id **591879204**, public 164.92.196.189,
private 10.114.0.3, `doctl` context `tamamhealth-final-deploy`.

Do ONE of:
- DO web console → Droplets → tamamhealth-data → **Access → Launch Console**, then
  append your admin public key to `/root/.ssh/authorized_keys`; or
- `doctl compute droplet-action password-reset 591879204`
  (emails the root password; **reboots the droplet → CouchDB briefly down** — do it
  in a maintenance window).

Then, on the droplet:
```bash
grep COUCHDB_PASSWORD /opt/tamamhealth/.env.data      # the real admin password
# make CouchDB reachable from the VPC (compose default binds 127.0.0.1):
sed -i 's/^COUCHDB_BIND_ADDRESS=.*/COUCHDB_BIND_ADDRESS=10.114.0.3/' /opt/tamamhealth/.env.data \
  || echo 'COUCHDB_BIND_ADDRESS=10.114.0.3' >> /opt/tamamhealth/.env.data
docker compose -f docker-compose.data.yml up -d
curl -s localhost:5984/_up          # expect {"status":"ok"}
```

---

## Step 2 — [YOU] Enforce off-site backups BEFORE any real data (HIGH)

The committed stack backs up CouchDB only to a volume on the **same droplet** as
the database — one droplet loss destroys the data and every backup together.

On the droplet:
```bash
# create /etc/tamamhealth/backup.env (S3/Spaces creds + GPG public key), then:
bash /opt/tamamhealth/scripts/install-offsite-backup.sh
bash /opt/tamamhealth/scripts/backup-restore-drill.sh   # must pass before go-live
```
Do not proceed to real patient data until a restore drill passes.

---

## Step 3 — [YOU] Set production secrets (fail-closed at boot)

The app refuses to boot if any of these are missing/placeholder. Put them in
`infra/digitalocean/app-platform/terraform.tfvars` (gitignored — never commit it),
under `runtime_secrets`:

- `JWT_SECRET` (≥32), `PHI_ENCRYPTION_KEY` (32-byte base64)
- `COUCHDB_ADMIN_USER`, `COUCHDB_ADMIN_PASSWORD` (the real value from Step 1, ≥20)
- `COUCHDB_GATEWAY_SECRET` (≥32), `COUCHDB_WEBHOOK_SECRET` (≥32)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (shared rate-limit + token revocation)
- `AIRTEL_WEBHOOK_SECRET`, `MPESA_WEBHOOK_SECRET`, `DATABASE_CA_CERT_BASE64`
- **`SUPERADMIN_INITIAL_PASSWORD`** — a strong secret, **not** `Superadmin!`. The
  `superadmin` account is provisioned on first login and forced to change it.

Non-secret env (set in `main.tf` / App Platform, mostly already wired):
`PHI_ENCRYPTION_ENABLED=true`, `NEXT_PUBLIC_SYNC_ENABLED=true`,
`NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED=true`,
`NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED=true`,
`NEXT_PUBLIC_COUCHDB_URL=<app-origin>/api/couch`, `NEXT_PUBLIC_APP_URL=<app-origin>`.

---

## Step 4 — [YOU] Deploy the App Platform stack

```bash
cd infra/digitalocean/app-platform
terraform plan     # REVIEW: firewall keeps 5984-from-VPC only (public 80/443 stay
                   # closed via enable_public_data_plane=false — intended)
terraform apply    # also locks the analytics Postgres trusted-sources
```
First apply on the default `*.ondigitalocean.app` ingress (DNS is on GoDaddy, not
DO); cut the domain over afterward. After boot, confirm the served browser bundle
actually shipped the `NEXT_PUBLIC_*` sync flags (they're build-time ARGs).

---

## Step 5 — [YOU] Verify tenant isolation is machine-checked (LOW but do it)

The real cross-tenant barrier is the CouchDB `_security` membership, set by a
manual script keyed on the server var `COUCHDB_TENANT_DATABASES_ENABLED` (note:
different name from the `NEXT_PUBLIC_` build flag). Run the verifier after setup:
```bash
npm run db:verify:couchdb-tenants   # every tenant DB grants exactly one org: role
```

---

## Step 6 — Pre-cutover verification gates

1. `curl https://<origin>/api/health` → all checks `ok` (server, database, couchdb).
2. Boot logs show no `PRODUCTION STARTUP REFUSED`.
3. Log in as `superadmin` → forced password change succeeds → total access works.
4. Cross-tenant smoke test: a non-admin in org A cannot read or write org B data.
5. Restore drill (Step 2) passed.

---

## What is already fixed (committed, awaiting your review/merge)

- **[DONE] CRITICAL cross-tenant write injection** — 12 PHI POST routes forced to
  stamp tenancy from the verified JWT. Branch `fix/cross-tenant-write-injection`
  (`a162445b`).
- **[DONE] Client-IP spoofing + firewall IaC** — `getClientIp` no longer trusts the
  leftmost XFF; terraform gates public CouchDB behind a default-off variable and
  adds `SUPERADMIN_INITIAL_PASSWORD`. Same branch (`f69ba039`).
- **[DONE] Super-admin hardening** — required strong `SUPERADMIN_INITIAL_PASSWORD`,
  forced first-login change, impersonation audit marker, fail-closed demo creds.
  Branch `harden/superadmin-production` (`4de63dd3`).

Open PRs for both branches (I can do this on request), review, and merge to `main`.

---

## Remaining code follow-ups (I can do these)

- **[CODE] Revoke sessions on password change (MEDIUM).** Add a `tokenEpoch` to the
  user doc, stamp it into the JWT at mint, bump it on password change/reset, and
  reject older-epoch tokens in `getAuthPayload` + `/api/auth/me`. Today a stolen
  JWT survives a password change for up to 8h.
- **[CODE/INFRA] Make off-site backup a hard prerequisite** in
  `cloud-init-data-plane.yaml` so a fresh droplet is never single-copy (Step 2 is
  currently manual).
