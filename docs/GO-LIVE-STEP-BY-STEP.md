# Go-Live Runbook

> **Status:** not production-ready. Do the steps in order. Do not load real
> patient data until Steps 1–6 are green.

> **Topology:** production is the single `tamamhealth-production` droplet
> (docker-compose stack, deployed by `deploy-production`). DigitalOcean App
> Platform is not used and its Terraform stack has been removed. Steps below
> that mention a separate data droplet (`tamamhealth-data`, private VPC
> `10.114.0.3`, `docker-compose.data.yml`) apply only if you deliberately run
> CouchDB on its own host; on the single production droplet CouchDB is the
> `couchdb` service in `docker-compose.yml`, bound to `127.0.0.1:5984`. See
> [DEPLOY-PRODUCTION.md](DEPLOY-PRODUCTION.md).

**Legend:** ☐ action for you · 🔴 blocks go-live · 🟡 do before real data · ✅ already done

---

## 1. PHI-at-rest = disk encryption 🔴

Strategy chosen: **disk/volume encryption** (keeps offline-first). Field-level
app encryption is a no-op on the browser write path, so it stays off. The app
now boots on `PHI_AT_REST_STRATEGY=disk-encryption` (set it in
`platform/.env.production`; boot refuses if no strategy is declared). ✅ *code side done — your actions:*

- ☐ **CouchDB data on an encrypted volume.** Put `/opt/tamamhealth` CouchDB data
  on a DigitalOcean Block Storage **Volume** (encrypted at rest by DO), or
  LUKS-encrypt the disk. Do not leave patient data on the droplet's unencrypted
  local disk.
- ☐ **Encrypt clinician devices.** Require full-disk encryption (FileVault /
  BitLocker / LUKS) on every machine that opens the app — that is where the
  offline PouchDB copy of PHI lives.
- ☐ Do **not** set `PHI_ENCRYPTION_ENABLED=true` (it breaks offline reads).

---

## 2. Get into the CouchDB host + bring CouchDB up 🔴

*Single-droplet production: CouchDB already runs as part of the main stack
(`docker compose up`, see DEPLOY-PRODUCTION.md); the steps below are for a
separate data droplet.*

Droplet `tamamhealth-data` · id `591879204` · private `10.114.0.3` · `doctl` context `tamamhealth-final-deploy`.

☐ **Restore access** (pick one):
```bash
# Option 1: DO Console → Droplets → tamamhealth-data → Access → Launch Console,
#           then paste your admin public key into /root/.ssh/authorized_keys
# Option 2 (reboots the droplet — CouchDB briefly down):
doctl compute droplet-action password-reset 591879204
```

☐ **Get the repo + env in place** (cloud-init makes `/opt/tamamhealth` but does
not clone the repo or start the stack):
```bash
cd /opt/tamamhealth && git clone <repo> . 2>/dev/null || git pull
cp infra/digitalocean/data-plane.env.example /opt/tamamhealth/.env   # NOTE: .env, not .env.data —
                                                                     # `docker compose` auto-loads .env
```

☐ **Fill `/opt/tamamhealth/.env`** — every `REPLACE` (compose fails fast on any
missing one): `COUCHDB_USER`, `COUCHDB_PASSWORD` (save it → Step 4), `COUCHDB_SECRET`,
`COUCHDB_WEBHOOK_SECRET`, `RELEASE_ID` (the git SHA), `CADDY_EMAIL`, `PLATFORM_SYNC_URL`.
Set the one value that opens the VPC route:
```bash
COUCHDB_BIND_ADDRESS=10.114.0.3        # data-plane.env.example ships 127.0.0.1
```

☐ **Start the stack** (put the `couchdb_data` volume on the encrypted disk from Step 1):
```bash
docker compose -f docker-compose.data.yml up -d
```

**Verify:** `curl -s -u "$COUCHDB_USER:$COUCHDB_PASSWORD" localhost:5984/_up` → `{"status":"ok"}`

---

## 3. Prove backups work 🟡

Backups currently sit on the same droplet as the database. On the droplet:

☐ Create `/etc/tamamhealth/backup.env` (S3/Spaces creds + GPG public key), then:
```bash
bash /opt/tamamhealth/scripts/install-offsite-backup.sh
bash /opt/tamamhealth/scripts/backup-restore-drill.sh
```

**Verify:** the restore drill exits `0`. Do not continue until it does.

---

## 4. Set production secrets 🔴

Put these in `platform/.env.production` on the `tamamhealth-production` droplet
(or in the Doppler `prd` config if `DOPPLER_TOKEN` is set on the host; never
commit them). Boot fails if any is missing/weak.

```bash
JWT_SECRET=<>=32 random chars>
PHI_ENCRYPTION_KEY=<32-byte base64>
COUCHDB_GATEWAY_SECRET=<>=32 random chars>
COUCHDB_WEBHOOK_SECRET=<>=32 random chars>
UPSTASH_REDIS_REST_URL=<upstash url>
UPSTASH_REDIS_REST_TOKEN=<upstash token>
SUPERADMIN_INITIAL_PASSWORD=<strong secret, NOT 'Superadmin!'>
# Optional: add each webhook secret and set its matching
# *_WEBHOOK_GATEWAY_VERIFIED=true only after the verified gateway is live.
```

`COUCHDB_USER` / `COUCHDB_PASSWORD` (the value from Step 2) go in the host's
`/opt/tamamhealth/.env`; compose passes them to the platform as
`COUCHDB_ADMIN_USER` / `COUCHDB_ADMIN_PASSWORD`. `./scripts/gen-secrets.sh`
generates the random values.

**Verify:** `./scripts/preflight.sh` on the droplet passes.

---

## 5. Deploy the production stack 🔴

Run **Actions, deploy-production, Run workflow** from `main` (optionally with a
`sha`). It builds the images, pulls them onto the droplet, restarts the stack,
installs the CouchDB validators, verifies health and rolls back on failure. Full
description: [DEPLOY-PRODUCTION.md](DEPLOY-PRODUCTION.md).

**Verify:** `curl -s https://app.tamamhealth.org/api/health` returns `server`,
`database`, `couchdb` all `ok` and `release` equal to the deployed SHA; the
platform container logs show no `PRODUCTION STARTUP REFUSED`.

---

## 6. Set up + verify tenant isolation 🔴

Run `setup:couchdb:validators` inside the platform container (the deploy
workflow already does this on each release). The two `db:*` scripts are not in
the production image: run them from a repository checkout on the droplet with
`COUCHDB_URL=http://127.0.0.1:5984` and the CouchDB admin credentials set
(see DEPLOY-PRODUCTION.md section 3):
```bash
npm run db:migrate:couchdb-tenants     # create per-org databases + replicators
npm run setup:couchdb:validators       # install _security + validate_doc_update
npm run db:verify:couchdb-tenants      # assert each DB grants exactly one org: role
```

**Verify:** the verify command exits `0` (no shared aggregate is browser-readable).

---

## 7. Final cutover checks 🔴

- ☐ Log in as `superadmin` → forced password change succeeds → total access works.
- ☐ Cross-tenant test: a non-admin in org A cannot read or write org B data.
- ☐ Domain cut over; `/api/health` green on the real hostname.

---

## Already fixed — on branches, review & merge ✅

| Branch | What |
|---|---|
| `fix/cross-tenant-write-injection` | Force tenancy from JWT on 12 PHI routes; IP-spoof + firewall IaC hardening |
| `harden/superadmin-production` | `superadmin`/`Superadmin!` + strong-password requirement, forced first-login change, audit marker |

**→ Say the word and I open clean PRs for both.**

## I can do next on your word

- ☐ Revoke stolen sessions on password change (token-epoch; today a stolen JWT survives a password change ~8h).
- ☐ Make off-site backup a hard prerequisite in `cloud-init-data-plane.yaml`.
- ☐ Re-run the security audit's verify pass (died on the session limit) to close the remaining medium findings.
