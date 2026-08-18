# Deploy on DigitalOcean

DigitalOcean-specific notes layered on top of the generic runbook
(`docs/STEP-BY-STEP-PLAYBOOK.md` / `docs/DEPLOYMENT-AND-ROLLOUT.md`). Use a
**Droplet** (a normal Ubuntu VM) — NOT App Platform, because this page's stack
is a single docker-compose bundle with stateful CouchDB + a Caddy reverse
proxy on one box, which App Platform doesn't host well.

> **This is the self-hosted, single-box path.** The application layer has a
> second, current production path — DigitalOcean **App Platform** with CouchDB
> split onto its own data Droplet behind a private-VPC gateway — cut over
> 2026-08-12. See [`DEPLOY-PRODUCTION.md`](DEPLOY-PRODUCTION.md) before
> standing up a new production host; use this page for the data Droplet piece
> either way, or for a fully self-hosted deployment (e.g. `docs/DEPLOY-SOUTH-SUDAN.md`).

---

## Audit status (today)
Build-ready: 0 TypeScript errors, 0 lint errors, no dead routes/links, no
conflict markers, key data-flow + sync-coverage + clinical-state-machine tests
pass (30/30). The final `next build` runs inside `deploy.sh` on the droplet.

---

## 1. Create the Droplet
DigitalOcean → **Create → Droplets**:
- **Image:** Ubuntu **22.04 (LTS) x64**.
- **Size (demo):** Basic → Regular, **4 GB / 2 vCPU** ($24/mo). Don't use 1–2 GB:
  the Next.js build can run out of memory (or add swap — see §6).
- **Size (production country node):** **8 GB / 4 vCPU+** ($48/mo) or larger.
- **Region:** DO has **no Africa region**. Nearest are **Frankfurt (FRA1)** or
  **Bangalore (BLR1)**.
  - **Demo (no real patient data):** any region is fine — pick FRA1.
  - **Real PHI / production:** DigitalOcean cannot host inside South Sudan, so it
    does **not** satisfy in-country data-residency. Use DO only for the demo;
    host the real country node in-country / on an MoH-approved host. (See
    `docs/AFRICA-HOSTING-STRATEGY.md`.)
- **Authentication:** add your **SSH key** (paste `~/.ssh/id_ed25519.pub`).
- Create, then copy the droplet's public IP.

## 2. Reserve a stable IP (recommended)
DO → **Networking → Reserved IPs** → assign one to the droplet. Point DNS at the
**Reserved IP** so you can rebuild/resize the droplet without changing GoDaddy
records.

## 3. DigitalOcean Cloud Firewall
DO → **Networking → Firewalls → Create**:
- **Inbound:** SSH `22` (ideally limited to your IP), HTTP `80`, HTTPS `443`.
- Everything else denied. Assign the firewall to the droplet.
- CouchDB (5984) / Postgres (5432) are already bound to `127.0.0.1` in
  `docker-compose.yml`, so they're never exposed — keep it that way (don't open
  those ports in the firewall).

## 4. GoDaddy DNS → the Reserved IP
Add three **A** records (delete GoDaddy's parked `@` record first):

| Type | Name | Value |
|---|---|---|
| A | `@` | your Reserved IP |
| A | `app` | your Reserved IP |
| A | `couch` | your Reserved IP |

Verify: `dig +short app.tamamhealth.org` returns the IP.

## What ships where

Three droplets, three delivery paths. They are NOT one pipeline — knowing which
is which is the difference between a deploy that lands and one that silently
changes nothing:

| Droplet | Serves | Ships via | Registry |
|---|---|---|---|
| `tamamhealth-production` | `app.tamamhealth.org` — the platform | `deploy-production` (promotes a staging-tested image) | GHCR |
| `tamamhealth-data` | `couch.tamamhealth.org` | `docker-compose.data.yml` on the box | — |
| `tamamhealth-website` | `tamamhealth.org` — the marketing site | **`deploy-website`** | GHCR for the record; the droplet gets the image over SSH |

The website is the odd one out, and was the one that silently changed nothing:
its droplet pulled from DigitalOcean's container registry while every workflow
published to GHCR, so until Aug 2026 nothing CI built ever reached the public
site and it drifted a generation behind `main`.

Publishing to DigitalOcean's registry instead ran into what its free tier
actually is — 500 MB and exactly one repository. Collecting garbage to stay
under the size cap emptied the repository, and the tier then refused to let it
be recreated, with the registry's own catalog reporting zero repositories while
its auth endpoint counted one and denied every push. So that registry is out of
the path entirely: `deploy-website` builds the image, publishes it to GHCR as
the record of what shipped, and streams it to the droplet with `docker save`
piped into `docker load` over the deploy key. The droplet holds no registry
credentials, and no storage tier can block a release.

Because the droplet no longer pulls, a **reboot cannot deliver a new build** —
it only restarts whatever image is already loaded. See
`infra/digitalocean-website/README.md`, which also carries a standing warning
about that droplet's Terraform state.

Merging to `main` does **not** release anything: staging deploys automatically,
production and the website are both manual, gated on the `production`
environment.

## 5. Deploy (same as the playbook)
SSH in and run the standard flow:
```bash
ssh root@<reserved-ip>
apt-get update -y && apt-get install -y git
git clone https://github.com/<you>/tamamhealth.git /opt/tamamhealth
cd /opt/tamamhealth
./scripts/gen-secrets.sh
touch website/.env.production   # no .example template ships for this one — see note below
sed -i 's/REPLACE-DOMAIN/tamamhealth.org/g' platform/.env.production website/.env.production
sed -i 's#^NEXT_PUBLIC_COUCHDB_URL=.*#NEXT_PUBLIC_COUCHDB_URL=https://couch.tamamhealth.org#' platform/.env.production

# PHI encryption at rest — REQUIRED. The platform refuses to boot in
# production without it (lib/config-validation.ts); the only exemption is an
# explicit demo deployment. Generate the key ONCE and escrow it with the
# CouchDB credentials — losing it makes every encrypted field permanently
# unreadable, and there is no recovery path.
sed -i 's#^PHI_ENCRYPTION_ENABLED=.*#PHI_ENCRYPTION_ENABLED=true#' platform/.env.production
sed -i "s#^PHI_ENCRYPTION_KEY=.*#PHI_ENCRYPTION_KEY=$(openssl rand -base64 32)#" platform/.env.production

# Public demo only — seeds fictional patients, and exempts the boot guard
# above. Skip both lines for any deployment that will hold real patient data.
sed -i 's#^NEXT_PUBLIC_DEMO_MODE=.*#NEXT_PUBLIC_DEMO_MODE=true#' platform/.env.production   # demo

# Bootstrap login for the seeded `superadmin` account. Not in the .example
# template, and required — demo or not — because the template ships with
# NEXT_PUBLIC_SYNC_ENABLED=true; lib/config-validation.ts refuses to boot
# without a real value here (16+ chars, not the demo default "Superadmin!").
grep -q '^SUPERADMIN_INITIAL_PASSWORD=' platform/.env.production \
  || echo "SUPERADMIN_INITIAL_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')" >> platform/.env.production

./scripts/preflight.sh
sudo bash deploy.sh
```
Caddy auto-issues TLS for the three domains. Verify at https://app.tamamhealth.org.

> **`website/.env.production` has no `.example` template.** `gen-secrets.sh`
> only fills `.env` and `platform/.env.production` — it silently skips
> `website/.env.production` because `website/.env.production.example` doesn't
> exist in the repo. `deploy.sh` still hard-requires the file to be present
> before it will run (it dies with "Missing .../website/.env.production"
> otherwise). The website container reads no secrets from it today (its
> `docker-compose.yml` service has no `env_file:` entry), so an **empty**
> file is enough — `touch website/.env.production` before `deploy.sh`, as
> shown above.

> **`NEXT_PUBLIC_DEMO_MODE` is only half a runtime setting.** It is inlined
> into the client bundle at *build* time, so on the `deploy.sh` path above
> (which builds on the droplet) the `.env.production` value does take effect —
> but on the CI/CD path in 5b, which pulls a prebuilt GHCR image, it does
> **not**. There the mode is fixed by the `NEXT_PUBLIC_DEMO_MODE` build-arg in
> `deploy-staging.yml` and recorded on the image as the
> `org.tamamhealth.demo-mode` label. `deploy-production.yml` refuses to promote
> an image labelled `true`.

## 5b. CI/CD deploy (after first manual boot)

GitHub Actions builds images to GHCR and SSH-deploys to staging on every green
`main` build. Use [`docker-compose.ghcr.yml`](../docker-compose.ghcr.yml) on the
droplet (see [`infra/digitalocean/`](../infra/digitalocean/) and
[`docs/operations/jira-github-do-tracking.md`](operations/jira-github-do-tracking.md)).

```bash
# On droplet — append staging or production env snippet
cat infra/digitalocean/staging.env.append >> .env
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d
```

## 6. Build memory (if you chose a small droplet)
If `next build` is killed (OOM) on a 2 GB droplet, add swap once:
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
Then re-run `sudo bash deploy.sh`. (Or just use a 4 GB droplet.)

## 7. Production country node on DO — extra steps (real PHI)
Only if you accept DO as the host (residency caveat above):
- Attach a **Block Storage Volume**, LUKS-encrypt it, mount at
  `/opt/tamamhealth-data`, and point Docker's data-root there (so PHI lands on
  the encrypted volume) — see `docs/STEP-BY-STEP-PLAYBOOK.md` Steps B3/B5.
- Enable **DO weekly Droplet backups** AND ship the nightly CouchDB dump offsite
  (encrypted) — DO Spaces in the same region works as the offsite target.
- Set `NEXT_PUBLIC_DEMO_MODE=false` (clean slate).

---

### DO product cheat-sheet
- **Droplet** = the server (use this).
- **Reserved IP** = stable address for DNS.
- **Cloud Firewall** = network allowlist (22/80/443).
- **Block Storage Volume** = the encrypted data disk for production PHI.
- **Spaces** = S3-compatible object storage for offsite encrypted backups.
- **App Platform** = not used *on this page's path* (the single-box docker-compose
  + CouchDB stack doesn't fit it) — but it IS the current production host for
  the platform app alone, split from CouchDB; see `DEPLOY-PRODUCTION.md`.
