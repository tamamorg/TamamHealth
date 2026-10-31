# Jira backlog — DigitalOcean deployment (manual entry)

Use this page to create issues in Jira **by hand** (Option 1). Each section is one
issue with fields ready to copy.

**Epic → 7 Stories → Tasks/Sub-tasks**

Docs: [`DEPLOY-DIGITALOCEAN.md`](./DEPLOY-DIGITALOCEAN.md),
[`MANUAL-SETUP-CHECKLIST.md`](./MANUAL-SETUP-CHECKLIST.md),
[`STEP-BY-STEP-PLAYBOOK.md`](./STEP-BY-STEP-PLAYBOOK.md),
[`operations/jira-github-do-tracking.md`](./operations/jira-github-do-tracking.md) (Jira ↔ GitHub ↔ DO tracking).

**Live backlog:** [KAN-90 epic](https://tamamorg.atlassian.net/browse/KAN-90) on tamamorg.atlassian.net.

**Labels (all issues):** `deployment`, `digitalocean`  
**Component:** `Infrastructure` (or `DevOps` if your project uses that)

---

## Verified status — 2026-07-27

Audited against the live repo, GitHub Actions, and public DNS, and mirrored into
Jira on the same date. The two genuinely-open items are tracked as
[KAN-91](https://tamamorg.atlassian.net/browse/KAN-91) (CI deploy secrets) and
[KAN-92](https://tamamorg.atlassian.net/browse/KAN-92) (backup restore drill).

| Phase | State | Evidence |
|-------|-------|----------|
| 1 — Accounts & prerequisites | **Done** | Droplets exist; CI green on `main` |
| 2 — DO infrastructure | **Done** (2.5 skipped) | 3 droplets w/ reserved IPs; DNS resolves (below) |
| 3 — Secrets & environment | **Done on droplets** | `.env` appends applied; 3.5 Doppler optional, not done |
| 4 — First deploy on droplet | **Done** | Stack serving on both app hostnames |
| 5 — CI/CD automation | **Blocked at 5.2** | Images publish to GHCR; SSH deploy skips every run |
| 6 — Post-deploy operations | **Partial** | Off-site upload unwired; restore drill ran 2026-07-01 and **failed** |
| 7 — Optional enhancements | **7.1 done**, 7.2/7.3 open | `infra/digitalocean/terraform/` exists |

**Live DNS (verified 2026-07-27)**

| Hostname | Resolves to | Droplet |
|----------|-------------|---------|
| `tamamhealth.org`, `www` | 138.68.124.30 | production |
| `app.tamamhealth.org`, `couch.tamamhealth.org` | 138.68.124.30 | production |
| `app.staging.tamamhealth.org`, `couch.staging.tamamhealth.org` | 146.190.179.153 | staging |

**The one blocker:** the `staging` and `production` GitHub Environments exist but
contain **no secrets**. `deploy-staging` builds and pushes images to GHCR
successfully, then its `ssh deploy to staging host` job skips the SSH steps every
run — so CI has never deployed to a droplet. `deploy-production` has never run at
all. Unblocking needs a deploy keypair whose public half is in the droplets'
`authorized_keys`; the existing `tamamhealth-deploy` private key is not on this
machine. See [Task 5.2](#task-52--add-staging_ssh_-secrets).

Re-run the static half of this audit any time:

```bash
./scripts/verify-deploy-pipeline.sh   # 17/17 passing as of 2026-07-27
```

---

## How to enter in Jira (5 min setup)

1. **Board** → **Create** → Issue type **Epic**
2. Paste **Epic** section below → Create
3. For each **Story** (Phase 1–7): Create → Story → set **Epic Link** / **Parent** to the epic
4. For each **Task**: Create → Task (or Sub-task) → set **Parent** to the story
5. Optional: add **Depends on** links (e.g. Phase 5 blocked by Phase 4)

**Suggested assignees**

| Role | Phases |
|------|--------|
| Org admin | 1 (accounts, billing) |
| DevOps / lead dev | 2, 4, 5 |
| Domain admin | 2 (DNS) |
| Security / ops | 3, 6 |
| Clinical ops | 6 (first login) |

---

## Epic

| Field | Value |
|-------|-------|
| **Issue type** | Epic |
| **Summary** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | High |
| **Labels** | `deployment`, `digitalocean`, `staging` |

**Description**

```
Deploy TamamHealth to a DigitalOcean Droplet (docker-compose + CouchDB + Caddy).

Scope:
- Staging/demo on DO (manual deploy.sh, then GitHub auto-deploy)
- Residency: see docs/AFRICA-HOSTING-STRATEGY.md

References:
- docs/DEPLOY-DIGITALOCEAN.md
- docs/MANUAL-SETUP-CHECKLIST.md
- deploy.sh, docker-compose.yml
- .github/workflows/deploy-staging.yml
```

**Acceptance criteria**

- [x] `https://app.staging.<domain>` loads with valid TLS
- [x] Admin can log in and create a facility
- [ ] Push to `main` auto-deploys to staging via GHCR + SSH — **blocked, see Task 5.2**

Note: this epic is the *staging* pipeline. `app.<domain>` (no `staging.`) is the
production droplet and is promoted manually via the `deploy-production` workflow.

---

## Story 1 — Phase 1: Accounts & prerequisites

| Field | Value |
|-------|-------|
| **Issue type** | Story |
| **Summary** | Phase 1 — Accounts & prerequisites |
| **Epic Link** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | High |

**Description:** Manual account setup before any infrastructure work.

### Task 1.1 — Create DigitalOcean account and billing

| Field | Value |
|-------|-------|
| **Summary** | Create DigitalOcean account, project, and billing |
| **Parent** | Phase 1 — Accounts & prerequisites |

**Description:** Sign up at digitalocean.com. Create a project (e.g. `tamamhealth-staging`). Attach a payment method.

**Acceptance criteria:** Can create a Droplet in the DO console.

---

### Task 1.2 — Confirm domain DNS access

| Field | Value |
|-------|-------|
| **Summary** | Confirm domain registrar / DNS access |
| **Parent** | Phase 1 — Accounts & prerequisites |

**Description:** Ensure you can add A records for `@`, `app`, and `couch` (e.g. GoDaddy → DNS for `tamamhealth.org`).

**Acceptance criteria:** Can add/edit A records for the production domain.

---

### Task 1.3 — Verify GitHub main branch is green

| Field | Value |
|-------|-------|
| **Summary** | Verify CI passes on main |
| **Parent** | Phase 1 — Accounts & prerequisites |

**Description:** Confirm `.github/workflows/ci.yml` succeeds on `main` before wiring staging deploy.

**Acceptance criteria:** Latest `main` commit shows green CI on GitHub.

---

### Task 1.4 — Generate SSH key pair

| Field | Value |
|-------|-------|
| **Summary** | Generate SSH key and save public key for DO |
| **Parent** | Phase 1 — Accounts & prerequisites |

**Description:**
```bash
ssh-keygen -t ed25519 -C "tamamhealth-deploy"
cat ~/.ssh/id_ed25519.pub   # add to DO droplet + GitHub if needed
```

**Acceptance criteria:** Public key ready to paste into DigitalOcean droplet creation.

---

## Story 2 — Phase 2: DO infrastructure

| Field | Value |
|-------|-------|
| **Issue type** | Story |
| **Summary** | Phase 2 — DigitalOcean infrastructure |
| **Epic Link** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | High |

**Description:** Provision droplet, firewall, reserved IP, and DNS.

### Task 2.1 — Create Ubuntu 22.04 droplet

| Field | Value |
|-------|-------|
| **Summary** | Create DO droplet (Ubuntu 22.04, 4GB+ RAM) |
| **Parent** | Phase 2 — DigitalOcean infrastructure |

**Description:** DO → Create → Droplets. Image: Ubuntu 22.04 LTS. Size: 4 GB / 2 vCPU (demo) or 8 GB+ (production/analytics). Region: FRA1 or BLR1 (no Africa region). Attach SSH key.

**Acceptance criteria:** Droplet running; public IP noted.

---

### Task 2.2 — Reserve stable IP

| Field | Value |
|-------|-------|
| **Summary** | Assign Reserved IP to droplet |
| **Parent** | Phase 2 — DigitalOcean infrastructure |

**Description:** DO → Networking → Reserved IPs → assign to droplet. Use this IP for all DNS records.

**Acceptance criteria:** Reserved IP assigned; survives droplet rebuild.

---

### Task 2.3 — Configure Cloud Firewall

| Field | Value |
|-------|-------|
| **Summary** | Create DO Cloud Firewall (22, 80, 443) |
| **Parent** | Phase 2 — DigitalOcean infrastructure |

**Description:** Inbound: SSH 22 (restrict to office IP if possible), HTTP 80, HTTPS 443. Deny all else. Do **not** open 5984 or 5432 (CouchDB/Postgres stay on 127.0.0.1). Assign firewall to droplet.

**Acceptance criteria:** Firewall attached; only 22/80/443 open.

---

### Task 2.4 — Create DNS A records

| Field | Value |
|-------|-------|
| **Summary** | Point @, app, couch DNS to reserved IP |
| **Parent** | Phase 2 — DigitalOcean infrastructure |

**Description:** Staging and production use *separate* hostnames on separate droplets.

| Type | Name | Value | Droplet |
|------|------|-------|---------|
| A | `app.staging` | 146.190.179.153 | staging |
| A | `couch.staging` | 146.190.179.153 | staging |
| A | `@` | 138.68.124.30 | production |
| A | `www` | 138.68.124.30 | production |
| A | `app` | 138.68.124.30 | production |
| A | `couch` | 138.68.124.30 | production |

Verify: `dig +short app.staging.<domain>` returns the staging reserved IP.

**Acceptance criteria:** All hostnames resolve to their droplet's reserved IP.

**Status: Done** — all six verified resolving 2026-07-27. Note the apex now points
at the *production* droplet, not the `tamamhealth-website` droplet
(129.212.252.214); website changes deployed to .214 no longer reach the public
site.

---

### Task 2.5 — (Production PHI only) Block storage volume

| Field | Value |
|-------|-------|
| **Summary** | Attach and LUKS-encrypt block volume for PHI |
| **Parent** | Phase 2 — DigitalOcean infrastructure |
| **Priority** | Low (skip for demo) |

**Description:** Attach DO Block Storage. LUKS-encrypt, mount at `/opt/tamamhealth-data`. See `docs/DEPLOYMENT-AND-ROLLOUT.md` §B3/B5. **Note:** DO does not satisfy in-country data residency.

**Acceptance criteria:** Docker data root on encrypted volume (production only).

---

## Story 3 — Phase 3: Secrets & environment

| Field | Value |
|-------|-------|
| **Issue type** | Story |
| **Summary** | Phase 3 — Secrets & environment configuration |
| **Epic Link** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | High |

**Description:** Generate secrets and set env files **before** `docker compose build` (`NEXT_PUBLIC_*` are baked at build time).

### Task 3.1 — Run gen-secrets.sh

| Field | Value |
|-------|-------|
| **Summary** | Generate secrets with scripts/gen-secrets.sh |
| **Parent** | Phase 3 — Secrets & environment configuration |

**Description:** On laptop or server: `./scripts/gen-secrets.sh` → writes `.env`, `platform/.env.production`, `website/.env.production`.

**Acceptance criteria:** Three gitignored env files exist with random secrets filled.

---

### Task 3.2 — Set domain and public URLs

| Field | Value |
|-------|-------|
| **Summary** | Set NEXT_PUBLIC_* URLs and org metadata |
| **Parent** | Phase 3 — Secrets & environment configuration |

**Description:** In `platform/.env.production`:
- `NEXT_PUBLIC_COUCHDB_URL=https://couch.<domain>`
- `NEXT_PUBLIC_APP_URL=https://app.<domain>`
- `NEXT_PUBLIC_SYNC_ENABLED=true`
- `NEXT_PUBLIC_ORG_NAME`, `NEXT_PUBLIC_ORG_EMAIL`, `NEXT_PUBLIC_ORG_COUNTRY`
- Demo: `NEXT_PUBLIC_DEMO_MODE=true` (never `true` in real production)

**Acceptance criteria:** All URLs match DNS; sync enabled for staging.

---

### Task 3.3 — Set license key

| Field | Value |
|-------|-------|
| **Summary** | Set TAMAMHEALTH_LICENSE_KEY |
| **Parent** | Phase 3 — Secrets & environment configuration |

**Description:** Add `TAMAMHEALTH_LICENSE_KEY` to `platform/.env.production`.

**Acceptance criteria:** License key present; not committed to git.

---

### Task 3.4 — Store secrets off-server

| Field | Value |
|-------|-------|
| **Summary** | Escrow secrets in password manager + break-glass |
| **Parent** | Phase 3 — Secrets & environment configuration |

**Description:** Copy env files to 1Password / Bitwarden. Document break-glass GPG escrow per `docs/operations/secrets.md`.

**Acceptance criteria:** At least two operators know where secrets live; LUKS key escrowed if used.

---

### Task 3.5 — (Optional) Configure Doppler

| Field | Value |
|-------|-------|
| **Summary** | Populate Doppler dev/stg/prd configs |
| **Parent** | Phase 3 — Secrets & environment configuration |
| **Priority** | Low |

**Description:** Run `platform/scripts/doppler-bootstrap.sh`. Set `DOPPLER_TOKEN` on host for runtime secret injection.

**Acceptance criteria:** Doppler project has staging secrets; token on server (optional).

---

## Story 4 — Phase 4: First deploy on droplet

| Field | Value |
|-------|-------|
| **Issue type** | Story |
| **Summary** | Phase 4 — First deploy on droplet |
| **Epic Link** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | High |

**Depends on:** Phase 2, Phase 3

### Task 4.1 — SSH and clone repository

| Field | Value |
|-------|-------|
| **Summary** | Clone repo to /opt/tamamhealth on droplet |
| **Parent** | Phase 4 — First deploy on droplet |

**Description:**
```bash
ssh root@<reserved-ip>
apt-get update -y && apt-get install -y git
git clone https://github.com/<org>/TamamHealth.git /opt/tamamhealth
cd /opt/tamamhealth
```

**Acceptance criteria:** Repo cloned at `/opt/tamamhealth`.

---

### Task 4.2 — Copy env files to server

| Field | Value |
|-------|-------|
| **Summary** | Install .env and production env files on server |
| **Parent** | Phase 4 — First deploy on droplet |

**Description:** Securely copy `.env`, `platform/.env.production`, `website/.env.production` to server (scp, Doppler, or regenerate on server).

**Acceptance criteria:** All three files on server; `chmod 600` where appropriate.

---

### Task 4.3 — Run preflight and deploy

| Field | Value |
|-------|-------|
| **Summary** | Run preflight.sh and deploy.sh |
| **Parent** | Phase 4 — First deploy on droplet |

**Description:**
```bash
./scripts/preflight.sh
sudo bash deploy.sh
```
`deploy.sh` installs Docker, Caddy, TLS, builds images, starts stack.

**Acceptance criteria:** `docker compose ps` shows healthy services.

---

### Task 4.4 — Verify HTTPS endpoints

| Field | Value |
|-------|-------|
| **Summary** | Verify TLS on app and couch subdomains |
| **Parent** | Phase 4 — First deploy on droplet |

**Description:** Open `https://app.<domain>` and `https://couch.<domain>`. Confirm valid certificates (Caddy auto-issue).

**Acceptance criteria:** Both URLs load over HTTPS without certificate errors.

---

### Task 4.5 — Login smoke test

| Field | Value |
|-------|-------|
| **Summary** | Admin login and basic app smoke test |
| **Parent** | Phase 4 — First deploy on droplet |

**Description:** Log in with bootstrap admin credentials. Navigate patients list, sync status page.

**Acceptance criteria:** Login works; core UI loads.

---

### Task 4.6 — (Optional) Enable analytics profile

| Field | Value |
|-------|-------|
| **Summary** | Start stack with analytics profile (Postgres + sync-worker) |
| **Parent** | Phase 4 — First deploy on droplet |
| **Priority** | Low |

**Description:** `docker compose --profile analytics up -d --build` (requires 8GB+ RAM).

**Acceptance criteria:** Postgres and sync-worker containers healthy.

---

## Story 5 — Phase 5: CI/CD automation

| Field | Value |
|-------|-------|
| **Issue type** | Story |
| **Summary** | Phase 5 — CI/CD automation (GitHub → staging) |
| **Epic Link** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | Medium |

**Depends on:** Phase 4

### Task 5.1 — Create GitHub Environment staging

| Field | Value |
|-------|-------|
| **Summary** | Create GitHub Environment "staging" |
| **Parent** | Phase 5 — CI/CD automation (GitHub → staging) |

**Description:** Repo → Settings → Environments → New environment → `staging`.

**Acceptance criteria:** Environment `staging` exists.

---

### Task 5.2 — Add STAGING_SSH_* secrets

| Field | Value |
|-------|-------|
| **Summary** | Configure STAGING_SSH_HOST, USER, KEY secrets |
| **Parent** | Phase 5 — CI/CD automation (GitHub → staging) |

**Description:** In `staging` environment secrets:
- `STAGING_SSH_HOST` — reserved IP or hostname
- `STAGING_SSH_USER` — e.g. `root`
- `STAGING_SSH_KEY` — private key (PEM)
- `STAGING_APP_DIR` — optional, default `/opt/tamamhealth`

See `.github/workflows/deploy-staging.yml`.

**Acceptance criteria:** All three required secrets set; deploy job no longer skips SSH step.

**Status: BLOCKED — this is the critical path for the whole epic.** Verified
2026-07-27: the `staging` environment exists but holds zero secrets, so the gate
step writes `ready=false` and both SSH steps skip on every run. Same for
`production` (`PROD_SSH_*`), which is why `deploy-production` has never run.

To unblock, someone with droplet console/SSH access must:

```bash
ssh-keygen -t ed25519 -C "tamamhealth-staging-deploy" -f ~/.ssh/tamamhealth_staging -N ""
# add the .pub to /root/.ssh/authorized_keys on the staging droplet (146.190.179.153)
gh secret set STAGING_SSH_HOST --env staging --body "146.190.179.153"
gh secret set STAGING_SSH_USER --env staging --body "root"
gh secret set STAGING_SSH_KEY  --env staging < ~/.ssh/tamamhealth_staging
```

Blocker detail: the droplets' firewall restricts port 22 to specific source IPs,
and the private half of the existing `tamamhealth-deploy` key is not on the
developer machine — so the keypair has to be re-issued from the DO console
(Droplet → Access → Recovery Console) rather than over SSH. Full procedure:
[`operations/github-environments-setup.md`](./operations/github-environments-setup.md).

---

### Task 5.3 — Add docker-compose.ghcr.yml override

| Field | Value |
|-------|-------|
| **Summary** | Add GHCR image override for docker compose pull |
| **Parent** | Phase 5 — CI/CD automation (GitHub → staging) |

**Description:** Root `docker-compose.yml` builds locally; CI runs `docker compose pull`. Add `docker-compose.ghcr.yml` with `image: ghcr.io/<owner>/tamamhealth-platform:staging` (and website, sync-worker). Document `COMPOSE_FILE` or `-f` usage on server.

**Acceptance criteria:** `docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull` succeeds on server.

**Status: Done.** [`docker-compose.ghcr.yml`](../docker-compose.ghcr.yml) exists at
the repo root covering all three services, and both deploy workflows layer it with
`-f`. `COMPOSE_FILE` is persisted via
[`infra/digitalocean/staging.env.append`](../infra/digitalocean/staging.env.append).
The server-side `pull` half is still unproven because no CI deploy has reached a
droplet (Task 5.2).

---

### Task 5.4 — docker login ghcr.io on server

| Field | Value |
|-------|-------|
| **Summary** | Authenticate server to GHCR (if packages private) |
| **Parent** | Phase 5 — CI/CD automation (GitHub → staging) |

**Description:** On droplet: `echo $GITHUB_PAT | docker login ghcr.io -u <user> --password-stdin`

**Acceptance criteria:** Server can pull private GHCR images.

---

### Task 5.5 — Set GH_OWNER on server

| Field | Value |
|-------|-------|
| **Summary** | Set GH_OWNER in server .env for image tags |
| **Parent** | Phase 5 — CI/CD automation (GitHub → staging) |

**Description:** Add `GH_OWNER=<github-org>` to root `.env` on server.

**Acceptance criteria:** Image tags resolve correctly on pull.

---

### Task 5.6 — Verify auto-deploy on push to main

| Field | Value |
|-------|-------|
| **Summary** | Verify deploy-staging workflow deploys after CI |
| **Parent** | Phase 5 — CI/CD automation (GitHub → staging) |

**Description:** Merge a trivial change to `main`. Confirm `deploy-staging` workflow runs after green `ci`, pulls images, restarts stack.

**Acceptance criteria:** Staging URL serves new build without manual SSH deploy.

---

## Story 6 — Phase 6: Post-deploy operations

| Field | Value |
|-------|-------|
| **Issue type** | Story |
| **Summary** | Phase 6 — Post-deploy operations |
| **Epic Link** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | Medium |

**Depends on:** Phase 4

### Task 6.1 — Rotate admin password

| Field | Value |
|-------|-------|
| **Summary** | Rotate bootstrap admin password |
| **Parent** | Phase 6 — Post-deploy operations |

**Acceptance criteria:** Default bootstrap password changed on first login.

---

### Task 6.2 — Create hospital and facility admin

| Field | Value |
|-------|-------|
| **Summary** | Create first hospital and facility administrator |
| **Parent** | Phase 6 — Post-deploy operations |

**Description:** In-app setup per `docs/RBAC-MATRIX.md`.

**Acceptance criteria:** Facility admin can log in and create users by role.

---

### Task 6.3 — Configure offsite encrypted backups

| Field | Value |
|-------|-------|
| **Summary** | Ship nightly CouchDB backups offsite (encrypted) |
| **Parent** | Phase 6 — Post-deploy operations |

**Description:** Nightly dump in `couchdb_backups` volume → sync to DO Spaces or other S3-compatible store. See `docs/operations/backups.md`.

**Acceptance criteria:** Backup job runs; encrypted copy off droplet.

---

### Task 6.4 — Run backup restore drill

| Field | Value |
|-------|-------|
| **Summary** | Run scripts/backup-restore-drill.sh |
| **Parent** | Phase 6 — Post-deploy operations |

**Acceptance criteria:** Successful restore drill documented.

**Status: Automated but failing.** The quarterly drill
(`.github/workflows/backups-cron.yml`) fired on 2026-07-01 and **failed after 22s**
— `apt-get install awscli` returned *"Package 'awscli' has no installation
candidate"*, because `awscli` was dropped from the Ubuntu 24.04 (noble) archive
that `ubuntu-latest` now resolves to. Fixed 2026-07-27: the workflow now relies on
the runner's preinstalled AWS CLI v2 and falls back to the official installer.

**Still required to actually pass:** the `production` environment has no secrets,
so the drill will now fail one step later on `BACKUP_PRIVKEY_GPG is not set`. Set
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `BACKUP_BUCKET`,
`BACKUP_PRIVKEY_GPG`, `BACKUP_PRIVKEY_PASSPHRASE` per
[`operations/backups.md`](./operations/backups.md), then re-run via
**Actions → backups-restore-drill → Run workflow** rather than waiting for
2026-10-01. No drill has ever passed, so the backups are **unverified**.

---

### Task 6.5 — Enable DO weekly droplet backups

| Field | Value |
|-------|-------|
| **Summary** | Enable DigitalOcean weekly droplet backups |
| **Parent** | Phase 6 — Post-deploy operations |
| **Priority** | Low (demo) / High (production) |

**Acceptance criteria:** DO backups enabled in console.

---

### Task 6.6 — (Optional) Third-party integrations

| Field | Value |
|-------|-------|
| **Summary** | Configure email, SMS, Sentry, payments (if used) |
| **Parent** | Phase 6 — Post-deploy operations |
| **Priority** | Low |

**Description:** `RESEND_API_KEY`, `AFRICAS_TALKING_*`, `NEXT_PUBLIC_SENTRY_DSN`, `FLUTTERWAVE_SECRET_HASH` as needed.

**Acceptance criteria:** Only enabled integrations configured.

---

## Story 7 — Phase 7: Optional enhancements

| Field | Value |
|-------|-------|
| **Issue type** | Story |
| **Summary** | Phase 7 — Optional enhancements |
| **Epic Link** | DigitalOcean deployment — staging & CI/CD |
| **Priority** | Low |

### Task 7.1 — Add infra/digitalocean/ Terraform

| Field | Value |
|-------|-------|
| **Summary** | Terraform module for DO droplet, volume, firewall, DNS |
| **Parent** | Phase 7 — Optional enhancements |

**Acceptance criteria:** `terraform apply` provisions staging infra reproducibly.

**Status: Done.** [`infra/digitalocean/terraform/`](../infra/digitalocean/terraform/)
provisions both droplets, reserved IPs, and 22/80/443 firewalls
(`main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `terraform.tfvars.example`).
The website droplet has its own module at `infra/digitalocean-website/`.

---

### Task 7.2 — Document fingerprint-bridge desk setup

| Field | Value |
|-------|-------|
| **Summary** | Document fingerprint bridge on registration desk PC |
| **Parent** | Phase 7 — Optional enhancements |

**Description:** `fingerprint-bridge` (`platform/tools/fingerprint-bridge/`) runs on local desk PC, not cloud. Set `NEXT_PUBLIC_FINGERPRINT_ENABLED=true` at build time if enabled.

**Acceptance criteria:** Operator runbook updated; desk PC tested.

---

### Task 7.3 — Add swap for small droplets (OOM)

| Field | Value |
|-------|-------|
| **Summary** | Add 2GB swap if next build OOMs on small droplet |
| **Parent** | Phase 7 — Optional enhancements |

**Description:** See `docs/DEPLOY-DIGITALOCEAN.md` §6.

**Acceptance criteria:** Build completes without OOM kill.

---

## Board setup (optional)

**Columns:** Backlog → Ready → In Progress → Blocked → Done

**Week 1 focus (minimum slice):** Stories 1–4 + Task 5.1–5.2. Defer Story 7.
*(Stories 1–4 and Tasks 5.1/5.3/7.1 are now Done — see Verified status above.)*

**Currently blocked (2026-07-27):**

| Item | Blocked on | Who can unblock |
|------|-----------|-----------------|
| **Task 5.2** — `STAGING_SSH_*` secrets | Deploy keypair must be re-issued from the DO recovery console; port 22 is IP-firewalled and the existing private key is lost | Someone with DO console access |
| Task 5.4/5.5/5.6 | Cascade from 5.2 — no CI deploy can land until SSH works | — |
| Production promote path | `PROD_SSH_*` secrets also unset; `deploy-production` has never run | Same as 5.2 |
| **Task 6.4** — restore drill | `production` environment backup secrets unset | Whoever holds the backup GPG key + S3 creds |

*Resolved since first draft:* Phase 4 DNS propagation (Task 2.4) and the
`docker-compose.ghcr.yml` dependency (Task 5.3) are both done.
