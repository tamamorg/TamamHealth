# Go-Live Runbook

> **Status:** not production-ready. Do the steps in order. Do not load real
> patient data until Steps 1–6 are green.

**Legend:** ☐ action for you · 🔴 blocks go-live · 🟡 do before real data · ✅ already done

---

## 1. Decide PHI-at-rest 🔴

Patient names, national ID, DOB, and phone are stored **unencrypted** today
(the encryption key is server-only, but writes happen in the browser). Choose:

- ☐ **Option A — disk/volume encryption** (recommended): encrypt the CouchDB
  volume + require device encryption on clinician laptops. I then correct the
  app so it stops claiming field-level encryption it doesn't do.
- ☐ **Option B — route all PHI through the server**: strongest, but ends
  offline-first. Large change.

**→ Reply "A" or "B" and I implement the code side.**

---

## 2. Get into the data droplet 🔴

Droplet `tamamhealth-data` · id `591879204` · private `10.114.0.3` · `doctl` context `tamamhealth-final-deploy`.

☐ Restore access (pick one):
```bash
# Option 1: DO Console → Droplets → tamamhealth-data → Access → Launch Console,
#           then paste your admin public key into /root/.ssh/authorized_keys
# Option 2 (reboots the droplet — CouchDB briefly down):
doctl compute droplet-action password-reset 591879204
```

☐ On the droplet, bring CouchDB up on the VPC IP:
```bash
grep COUCHDB_PASSWORD /opt/tamamhealth/.env.data                 # save this value → Step 4
echo 'COUCHDB_BIND_ADDRESS=10.114.0.3' >> /opt/tamamhealth/.env.data
docker compose -f docker-compose.data.yml up -d
```

**Verify:** `curl -s localhost:5984/_up` → `{"status":"ok"}`

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

Put these in `infra/digitalocean/app-platform/terraform.tfvars` under
`runtime_secrets` (gitignored — never commit). Boot fails if any is missing/weak.

```hcl
runtime_secrets = {
  JWT_SECRET                  = "<≥32 random chars>"
  PHI_ENCRYPTION_KEY          = "<32-byte base64>"
  COUCHDB_ADMIN_USER          = "couchadmin"
  COUCHDB_ADMIN_PASSWORD      = "<value from Step 2>"
  COUCHDB_GATEWAY_SECRET      = "<≥32 random chars>"
  COUCHDB_WEBHOOK_SECRET      = "<≥32 random chars>"
  UPSTASH_REDIS_REST_URL      = "<upstash url>"
  UPSTASH_REDIS_REST_TOKEN    = "<upstash token>"
  AIRTEL_WEBHOOK_SECRET       = "<≥32 random chars>"
  MPESA_WEBHOOK_SECRET        = "<≥32 random chars>"
  DATABASE_CA_CERT_BASE64     = "<doctl databases get-ca output>"
  SUPERADMIN_INITIAL_PASSWORD = "<strong secret — NOT 'Superadmin!'>"
}
```

**Verify:** `terraform validate` → `Success`.

---

## 5. Deploy the App Platform stack 🔴

```bash
cd infra/digitalocean/app-platform
terraform plan     # confirm: data-plane firewall shows ONLY 22 + 5984-from-VPC
terraform apply    # also locks the analytics Postgres trusted sources
```

First apply lands on `*.ondigitalocean.app` (domain DNS is on GoDaddy). Cut the
custom domain over after boot is healthy.

**Verify:** `curl -s https://<app-origin>/api/health` → `server`, `database`,
`couchdb` all `ok`; deploy logs show no `PRODUCTION STARTUP REFUSED`.

---

## 6. Set up + verify tenant isolation 🔴

From the deployed app's environment (or with the same env vars set):
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

- ☐ Implement your Step 1 choice (A or B).
- ☐ Revoke stolen sessions on password change (token-epoch; today a stolen JWT survives a password change ~8h).
- ☐ Make off-site backup a hard prerequisite in `cloud-init-data-plane.yaml`.
