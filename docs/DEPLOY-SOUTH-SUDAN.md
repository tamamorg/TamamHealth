# TamamHealth — South Sudan MVP Deployment (in-country, privacy-hardened)

This is the runbook for the **MVP**: a single in-country server (the "country
node") that hosts the platform, CouchDB (sync hub), Postgres (national
analytics) and the sync-worker. Facilities run the app **offline-first** in the
browser and replicate to this server when they have connectivity.

**Data residency:** every byte of PHI stays on this in-country server. Nothing
leaves South Sudan. No third-party cloud holds patient data.

---

## 1. Server

- **OS:** Ubuntu 22.04 LTS, located in South Sudan (MoH data centre / in-country host).
- **Size:** 4 vCPU, 16 GB RAM, 100 GB SSD is comfortable for the MVP (load is
  batched sync + reporting, not heavy realtime traffic). 2 vCPU / 8 GB works for a pilot.
- **Power/network:** put it on a **UPS** (intermittent grid) and, ideally, two
  internet uplinks. The offline-first design means facilities keep working
  during outages; the server just needs to be reachable when they sync.
- **Public reachability:** a public IP + domain so facility browsers can reach
  `https://app.<domain>` and `https://couch.<domain>`. If only a dynamic IP is
  available, use a DDNS provider.

## 2. Encryption at rest (do this first — privacy)

CouchDB/Postgres don't encrypt their own files, so encrypt the disk/volume:

```bash
# On a fresh server, provision an encrypted data volume with LUKS BEFORE Docker:
cryptsetup luksFormat /dev/sdb
cryptsetup open /dev/sdb cryptdata
mkfs.ext4 /dev/mapper/cryptdata
mkdir -p /opt/tamamhealth-data && mount /dev/mapper/cryptdata /opt/tamamhealth-data
# Point Docker's data-root (or the named volumes) at /opt/tamamhealth-data.
```

This protects PHI if the physical disk is stolen or decommissioned.

## 3. Firewall

```bash
ufw default deny incoming
ufw allow 22/tcp      # SSH (restrict to admin IPs if possible)
ufw allow 80/tcp      # HTTP (Caddy redirects to HTTPS)
ufw allow 443/tcp     # HTTPS
ufw enable
```

CouchDB (5984) and Postgres (5432) are **already bound to 127.0.0.1 only** in
`docker-compose.yml` — they are never exposed to the network; CouchDB is reached
only through the TLS reverse proxy. Do **not** add public port mappings for them.

## 4. Secrets / environment (already generated)

Three env files have been created and are **gitignored** (never commit them):

- `.env` — compose secrets (CouchDB/Postgres passwords, webhook secret).
- `platform/.env.production` — JWT secret, admin bootstrap password, DB URL, sync.
- `website/.env.production` — ops notify email.

**Strong random secrets are already filled in.** You only need to edit the
**domain placeholders** before building:

- In `platform/.env.production`: replace `REPLACE-DOMAIN` in
  `NEXT_PUBLIC_COUCHDB_URL=https://couch.<your-domain>` and
  `NEXT_PUBLIC_ORG_EMAIL`. (These are baked into the browser bundle at build
  time, so set them before `docker compose build`.)
- In `website/.env.production`: set the notify email.

`NEXT_PUBLIC_DEMO_MODE=false` is set — so **no demo users/credentials are
seeded**; production seeds only the bootstrap admin.

> **Gotcha:** there is no `website/.env.production.example` template in the
> repo, so `scripts/gen-secrets.sh` cannot generate `website/.env.production`
> for you — it silently skips it. `deploy.sh` still requires the file to
> exist before it will run. The website container needs no secrets today
> (nothing in `docker-compose.yml` loads an env file for it), so
> `touch website/.env.production` is sufficient before running `deploy.sh`.

## 5. DNS + TLS

Create A records pointing at the server:

```
app.<domain>    → <server IP>
couch.<domain>  → <server IP>
<domain>        → <server IP>   (marketing site, optional)
```

TLS is auto-provisioned by Caddy + Let's Encrypt (handled by `deploy.sh`), so all
traffic — including CouchDB replication — is **encrypted in transit**.

## 6. Deploy

```bash
# On the server, after env files + DNS are in place:
export REPO_URL=https://github.com/<your-org>/tamamhealth.git
export DOMAIN_ROOT=<domain> DOMAIN_APP=app.<domain> DOMAIN_COUCH=couch.<domain>
sudo -E bash deploy.sh           # installs Docker + Caddy, builds, starts, TLS

# Analytics (national Postgres dashboards) — enable the analytics profile:
docker compose --profile analytics up -d --build
```

## 7. First login (rotate the admin password immediately)

- The platform's login-page demo role chips and `/api/demo-credentials` are
  gone; the seeded `superadmin` account is the actual bootstrap path. Sign in
  at `https://app.<domain>` as `superadmin` using `SUPERADMIN_INITIAL_PASSWORD`
  from `platform/.env.production`. **Set this yourself before first boot** —
  it isn't in `platform/.env.production.example`, and the platform refuses to
  boot without it (or with the well-known demo default `Superadmin!`) whenever
  `NEXT_PUBLIC_SYNC_ENABLED=true`.
- `ADMIN_INITIAL_PASSWORD` is a separate, optional credential for the legacy
  `admin` account. **Immediately change whichever password you used** in the
  UI. If you leave `ADMIN_INITIAL_PASSWORD` unset, the platform writes a
  generated one to `.seed-credentials.json` in the platform working dir — read
  it once and rotate.

## 8. Backups (encrypted)

- The `couchdb-backup` container takes scheduled CouchDB snapshots into the
  `couchdb_backups` volume (on the encrypted disk).
- Add an **encrypted off-site copy** (e.g. `restic`/`borg` to a second in-country
  location or encrypted media) and test a restore. Never ship unencrypted PHI off-box.

## 9. PHI / privacy safeguards already built into the app

These are enforced in code — verified by the test suite:

- **In transit:** TLS everywhere (Caddy). **At rest:** LUKS (step 2).
- **AuthN:** JWT in httpOnly cookies + a token revocation list; auto screen-lock
  after inactivity; forced password change on admin-issued credentials.
- **AuthZ:** RBAC enforced at four layers; tenant scoping is **default-deny**
  (a facility user can't see other facilities' data, and national accounts don't
  leak into facility lists).
- **Audit trail:** every create/update/delete (incl. messages) is written to an
  append-only audit log.
- **Messaging:** staff chat is internal-only, copy/paste/forward disabled for
  PHI; patient messaging is separated and internal notes are isolated in their
  own store the patient can never see.
- **No PHI to the national tier it shouldn't reach:** sync coverage is guarded by
  an integration test; internal chat/notes are facility-only.

## 10. Post-deploy verification checklist

- [ ] `https://app.<domain>` loads over HTTPS (valid cert).
- [ ] CouchDB only reachable via `https://couch.<domain>` (not on `:5984` publicly).
- [ ] `ufw status` shows only 22/80/443 open.
- [ ] Logged in, rotated the admin password.
- [ ] Created a test facility + user; confirmed they see only their facility's data.
- [ ] Took a patient offline (disable network) → app still works → reconnect → syncs.
- [ ] Backup ran and a restore was tested.
- [ ] `NEXT_PUBLIC_DEMO_MODE=false` confirmed (no demo accounts on the login screen).
- [ ] Removed any stray secrets file (`platform/.env.production.real.bak`) from the box.

---

### Scaling later (out of scope for the MVP)
Each new country = stand up this same Docker stack on that country's chosen host
(in-country or nearest reliable region) + a country profile. The standalone
`country-node` and `regional-exchange` services (cross-border FHIR exchange) are
Phase-3 scaffolds to implement once a second country is live.
