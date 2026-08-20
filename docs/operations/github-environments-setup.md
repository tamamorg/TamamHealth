# GitHub Environments — staging + production secrets

Configure repo **Settings → Environments** so [deploy-staging.yml](../../.github/workflows/deploy-staging.yml)
and [deploy-production.yml](../../.github/workflows/deploy-production.yml) can SSH to
DigitalOcean droplets.

> **The `production` environment is no longer just deploy-production's SSH
> secrets.** GitHub environments are matched by name, so every workflow that
> declares `environment: production` shares this same reviewer gate and
> secret store: `deploy-production.yml`, `deploy-app-platform.yml`,
> `deploy-website.yml`, `backups-cron.yml`, `reminders-cron.yml`,
> and `transfers-sweep-cron.yml`. See
> [Everything else gated on `production`](#everything-else-gated-on-production)
> below for the full secret list. `mobile-beta.yml` uses its own separate
> `mobile-beta` environment, not `production`.

Parent doc: [jira-github-do-tracking.md](./jira-github-do-tracking.md).

---

## Create environments

**GitHub → tamamorg/TamamHealth → Settings → Environments**

1. **New environment** → name: `staging`
2. **New environment** → name: `production`
   - Enable **Required reviewers** (at least one ops lead)
   - Optional: **Wait timer** (e.g. 5 minutes) for production

---

## Staging secrets

Environment: **`staging`**

| Secret | Description |
|--------|-------------|
| `STAGING_SSH_HOST` | Staging droplet reserved IP or hostname |
| `STAGING_SSH_USER` | SSH user (usually `root`) |
| `STAGING_SSH_KEY` | Private key (PEM), full contents including `BEGIN/END` lines |
| `STAGING_APP_DIR` | Optional; default `/opt/tamamhealth` |

Generate a deploy key pair:

```bash
ssh-keygen -t ed25519 -C "tamamhealth-staging-deploy" -f ~/.ssh/tamamhealth_staging -N ""
cat ~/.ssh/tamamhealth_staging.pub   # add to staging droplet authorized_keys
cat ~/.ssh/tamamhealth_staging       # paste into STAGING_SSH_KEY secret
```

---

## Production secrets

Environment: **`production`**

| Secret | Description |
|--------|-------------|
| `PROD_SSH_HOST` | Production droplet reserved IP |
| `PROD_SSH_USER` | SSH user (usually `root`) |
| `PROD_SSH_KEY` | **Separate** private key from staging |
| `PROD_APP_DIR` | Optional; default `/opt/tamamhealth` |

Use a different key than staging (`tamamhealth_prod`).

---

## Everything else gated on `production`

Each row below is a **separate** workflow that also declares
`environment: production` — set only the secrets for the workflows you
actually intend to run. All of these gate behind the same required-reviewer
approval as `deploy-production.yml`.

| Workflow | Secrets (all on the `production` environment) |
|---|---|
| [`deploy-app-platform.yml`](../../.github/workflows/deploy-app-platform.yml) | `DIGITALOCEAN_ACCESS_TOKEN`, `DO_APP_ID`, `DO_BASE_URL` |
| [`deploy-production.yml`](../../.github/workflows/deploy-production.yml) (`target: aws`) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `PROD_ACM_CERT_ARN`, `PROD_DOMAIN`, `PROD_EC2_KEYPAIR`, `PROD_DB_MASTER_PASSWORD`; optional `AWS_REGION` (default `af-south-1`), repo/env var `PROD_INSTANCE_TYPE` (default `t3.large`) |
| [`deploy-website.yml`](../../.github/workflows/deploy-website.yml) | `WEBSITE_SSH_HOST`, `WEBSITE_SSH_USER`, `WEBSITE_SSH_KEY` (only checked when `restart: ssh`, the default); `DIGITALOCEAN_ACCESS_TOKEN` (only for `restart: reboot`) |
| [`backups-cron.yml`](../../.github/workflows/backups-cron.yml) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BACKUP_BUCKET`, `BACKUP_PRIVKEY_GPG`, `BACKUP_PRIVKEY_PASSPHRASE`; optional `AWS_REGION` (default `af-south-1`), `AWS_ENDPOINT_URL`, repo/env var `DRILL_SKIP_POSTGRES` — see [`backups.md`](backups.md) |
| [`reminders-cron.yml`](../../.github/workflows/reminders-cron.yml) | `PLATFORM_BASE_URL`, `REMINDER_DISPATCH_SECRET` |
| [`transfers-sweep-cron.yml`](../../.github/workflows/transfers-sweep-cron.yml) | `PLATFORM_BASE_URL`, `TRANSFER_SWEEP_SECRET` |

`PLATFORM_BASE_URL` and `DIGITALOCEAN_ACCESS_TOKEN` are each shared across
several of the rows above — set them once and every workflow that needs them
picks up the same value. Every one of these workflows fails open (skips with
a `::notice`, not an error) when its secrets are unset, so the pipeline stays
green before you wire each piece up — see each workflow file's own header
comment for the up-to-date rationale and requirements.

A separate, non-`production` environment:

| Workflow | Environment | Secrets |
|---|---|---|
| [`mobile-beta.yml`](../../.github/workflows/mobile-beta.yml) | `mobile-beta` | `EXPO_TOKEN` |

---

## Droplet prerequisites

On **each** droplet before first CI deploy:

```bash
cd /opt/tamamhealth
git pull
cat infra/digitalocean/staging.env.append >> .env    # or production.env.append
docker login ghcr.io -u YOUR_GITHUB_USER
# PAT needs read:packages if GHCR images are private
```

Ensure [`docker-compose.ghcr.yml`](../../docker-compose.ghcr.yml) exists in the clone.

---

## Verify

1. Merge any commit to `main` → wait for **ci** then **deploy-staging**
2. **deploy-staging** → job **ssh deploy to staging host** should not skip
3. Log should show: `Deployed sha=… tag=staging`
4. On staging droplet: `docker compose -f docker-compose.yml -f docker-compose.ghcr.yml ps`

Production:

1. **Actions → deploy-production → Run workflow**
2. `target`: **vps**
3. Approve in **production** environment
4. Log: `Deployed sha=… tag=production`

---

## Using GitHub CLI (optional)

```bash
gh auth login
gh secret set STAGING_SSH_HOST --env staging --body "203.0.113.10"
gh secret set STAGING_SSH_USER --env staging --body "root"
gh secret set STAGING_SSH_KEY --env staging < ~/.ssh/tamamhealth_staging
```

Repeat for `PROD_*` on environment `production`.

Run [`scripts/verify-deploy-pipeline.sh`](../../scripts/verify-deploy-pipeline.sh) locally to validate workflow + compose files.
