# DigitalOcean — staging + production droplets

Two parallel Ubuntu 22.04 droplets run the same [`docker-compose.yml`](../../docker-compose.yml)
stack with [`docker-compose.ghcr.yml`](../../docker-compose.ghcr.yml) for GHCR pulls.

Tracking doc: [`docs/operations/jira-github-do-tracking.md`](../../docs/operations/jira-github-do-tracking.md).

> **This is not the only production path.** These droplets are the `vps` target of
> the **deploy-production** workflow (its default). The App Platform stack in
> [`app-platform/`](app-platform/README.md) runs the platform app as a managed
> service against the existing `tamamhealth-analytics` PostgreSQL cluster and the
> data droplet, and `deploy-production` also offers an `aws` target
> ([`infra/aws`](../aws/README.md), CloudFormation in `af-south-1`). Know which
> target you are deploying before you run anything here.

---

## Quick start (Terraform + SSH bootstrap)

### 1. Prerequisites (your laptop)

```bash
# DigitalOcean API token (read + write) — create at cloud.digitalocean.com → API
export DIGITALOCEAN_TOKEN="dop_v1_..."

# SSH key for droplet login (create if missing)
ssh-keygen -t ed25519 -C "tamamhealth-deploy" -f ~/.ssh/id_ed25519 -N ""

# Your public IP for SSH firewall rule
curl -4 ifconfig.me   # append /32 → admin_ssh_cidr
```

### 2. Provision infrastructure

```bash
cd infra/digitalocean/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: ssh_public_key, admin_ssh_cidr, domain

terraform init
terraform plan
terraform apply
```

Terraform creates **two droplets**, **reserved IPs**, and **firewalls** (22/80/443).

### 3. DNS (GoDaddy or your registrar)

Point A records at the IPs from `terraform output`:

| Environment | Records |
|-------------|---------|
| Staging | `app.staging.<domain>`, `couch.staging.<domain>` |
| Production | `@`, `app`, `couch`, `www` |

### 4. Bootstrap each droplet

```bash
# From repo root — first boot builds images on the droplet (~15–30 min)
./scripts/do-ssh-deploy.sh --host <staging-ip> --env staging --domain tamamhealth.org
./scripts/do-ssh-deploy.sh --host <production-ip> --env production --domain tamamhealth.org
```

### 5. Wire GitHub Actions (repo Admin required)

Create **staging** and **production** environments with secrets:

| Secret | Value |
|--------|-------|
| `STAGING_SSH_HOST` | staging reserved IP |
| `STAGING_SSH_USER` | `root` |
| `STAGING_SSH_KEY` | private key matching droplet SSH key |
| `PROD_SSH_HOST` | production reserved IP |
| `PROD_SSH_USER` | `root` |
| `PROD_SSH_KEY` | same or separate deploy key |

After secrets are set, every green `main` build auto-deploys staging. Production
promotes via **Actions → deploy-production → Run workflow**.

See [`docs/operations/github-environments-setup.md`](../../docs/operations/github-environments-setup.md).

---

## Staging droplet

| Setting | Value |
|---------|-------|
| Size | 4 GB / 2 vCPU (Basic, FRA1 or BLR1) |
| DNS | `app.staging.<domain>`, `couch.staging.<domain>` |
| `IMAGE_TAG` | `staging` |
| Doppler config | `stg` |
| `NEXT_PUBLIC_DEMO_MODE` | `true` |
| GitHub Environment | `staging` → `STAGING_SSH_*` secrets |

## Production droplet

| Setting | Value |
|---------|-------|
| Size | 8 GB / 4 vCPU+ |
| DNS | `app.<domain>`, `couch.<domain>` |
| `IMAGE_TAG` | `production` |
| Doppler config | `prd` |
| `NEXT_PUBLIC_DEMO_MODE` | `false` |
| GitHub Environment | `production` → `PROD_SSH_*` secrets (required reviewers) |

**Residency:** DO is suitable for demo/staging and pre-pilot. Real PHI production
should move in-country or to `af-south-1` — see [`docs/AFRICA-HOSTING-STRATEGY.md`](../../docs/AFRICA-HOSTING-STRATEGY.md).

---

## Per-droplet checklist

1. Create droplet + attach SSH key + assign **Reserved IP**
2. Cloud Firewall: inbound **22** (your IP), **80**, **443** only
3. DNS A records → reserved IP
4. Run bootstrap:

```bash
ssh root@<reserved-ip>
git clone https://github.com/tamamorg/TamamHealth.git /opt/tamamhealth
cd /opt/tamamhealth
./scripts/gen-secrets.sh
# Edit platform/.env.production URLs for this environment (staging vs prod subdomains)
cp infra/digitalocean/staging.env.append .env.ghcr   # or production.env.append
cat .env.ghcr >> .env
./scripts/preflight.sh
sudo bash deploy.sh   # first boot: builds locally; after CI wired, use GHCR pull only
```

5. `docker login ghcr.io` (PAT with `read:packages` if GHCR packages are private)
6. Set `DOPPLER_TOKEN` on host (separate token per droplet — never share stg/prd)

---

## After GitHub CI is wired

Staging auto-deploys on every green `main` build. Production promotes manually via
**Actions → deploy-production → Run workflow** (`target: vps`).

Verify on host:

```bash
cd /opt/tamamhealth
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml ps
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml images
```
