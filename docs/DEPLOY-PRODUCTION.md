# Production runbook: the `tamamhealth-production` droplet

How TamamHealth production is deployed and operated. Production is a single
DigitalOcean droplet (`tamamhealth-production`, 138.68.124.30) running the
[`docker-compose.yml`](../docker-compose.yml) stack with
[`docker-compose.ghcr.yml`](../docker-compose.ghcr.yml) (images pulled from
GHCR), fronted by Caddy. There is no DigitalOcean App Platform app and no
second stack.

Everything below is derived from
[`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml),
`docker-compose.yml`, the backup scripts and
[`infra/digitalocean/README.md`](../infra/digitalocean/README.md). Where a step
lives in another document, this one links to it rather than copying it.

---

## What runs on the droplet

| Service | Container | Image / source | Notes |
|---|---|---|---|
| `platform` | `tamamhealth-platform` | `ghcr.io/<owner>/tamamhealth-platform:<sha>` | Next.js app; health probe `/api/health`; bound to `127.0.0.1:3000` |
| `website` | `tamamhealth-website` | `ghcr.io/<owner>/tamamhealth-website:<sha>` | Marketing site container; bound to `127.0.0.1:3001` |
| `sync-worker` | `tamamhealth-sync-worker` | `ghcr.io/<owner>/tamamhealth-sync-worker:<sha>` | CouchDB to Postgres bridge; `analytics` profile |
| `couchdb` | `tamamhealth-couchdb` | `couchdb:3` | Bound to `127.0.0.1:5984`; `nofile` ulimit 65536 |
| `couchdb-backup` | `tamamhealth-couchdb-backup` | `alpine:3.19` + `scripts/dump-couchdb.sh` | Nightly dump at 02:15 UTC to the `couchdb_backups` volume, 14-day retention |

Browsers never talk to CouchDB directly with credentials: the platform serves
the authenticated same-origin `/api/couch` gateway
(`NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED` defaults to `true` for production and the
platform refuses to boot with the gateway off).

Host layout: the repo is cloned at `/opt/tamamhealth` (override with the
`PROD_APP_DIR` secret). Compose-level settings live in `/opt/tamamhealth/.env`
(including the lines from
[`infra/digitalocean/production.env.append`](../infra/digitalocean/production.env.append):
`GH_OWNER`, `IMAGE_TAG`, `COMPOSE_FILE`). Platform runtime settings live in
`platform/.env.production`. `DOPPLER_TOKEN` on the host, if set, makes the
platform fetch its secrets through Doppler at boot (see
[operations/secrets.md](operations/secrets.md)).

---

## 0. Prerequisites

- GitHub environment `production` with required reviewers, holding the secrets
  `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`. Optional overrides:
  `PROD_APP_DIR` (default `/opt/tamamhealth`), `PROD_HEALTH_URL` (default
  `https://app.tamamhealth.org/api/health`), `PROD_WEBSITE_HEALTH_URL` (default
  `https://tamamhealth.org/`). See
  [operations/github-environments-setup.md](operations/github-environments-setup.md).
- Optional repository variables `NEXT_PUBLIC_*` (sync, CouchDB URL, app URL,
  offline settings). They are compiled into the browser bundle at **build**
  time; the workflow has defaults, and changing one needs a new deploy, not a
  restart.
- The PHI encryption key escrowed. Losing it makes every encrypted field
  permanently unreadable.
- Go-live items (demo mode off, every secret rotated, a reachable shared
  CouchDB, backups): [operations/production-hardening.md](operations/production-hardening.md)
  and [GO-LIVE-STEP-BY-STEP.md](GO-LIVE-STEP-BY-STEP.md).

---

## 1. First-time droplet setup

Done once per droplet. Full detail, including Terraform provisioning and DNS, is
in [`infra/digitalocean/README.md`](../infra/digitalocean/README.md) and
[DEPLOY-DIGITALOCEAN.md](DEPLOY-DIGITALOCEAN.md). In short:

```bash
ssh root@<production-ip>
git clone https://github.com/tamamorg/TamamHealth.git /opt/tamamhealth
cd /opt/tamamhealth
./scripts/gen-secrets.sh
# Edit platform/.env.production for the production URLs
cat infra/digitalocean/production.env.append >> .env
./scripts/preflight.sh
sudo bash deploy.sh        # first boot; later releases come from GHCR
docker login ghcr.io       # PAT with read:packages if packages are private
```

Set `NEXT_PUBLIC_DEMO_MODE=false` for production. Cloud firewall: inbound 22
(operator IP), 80, 443 only.

---

## 2. Deploy a release

Releases are deployed only by the **deploy-production** workflow
(Actions, Run workflow, `workflow_dispatch`). Run it from `main`; the
optional `sha` input selects a main commit (blank means the current main HEAD).

What the workflow does, in order:

1. Refuses to run from any ref but `main`, and refuses if the three `PROD_SSH_*`
   secrets are missing.
2. Resolves the target SHA and requires it to be an ancestor of `origin/main`.
3. Requires a successful `ci.yml` push run for that exact commit, waiting up
   to 45 minutes for one that is still running. A commit whose CI is red or
   absent is refused.
4. Builds and pushes three images tagged with the 7-character SHA:
   `tamamhealth-platform` (built with `NEXT_PUBLIC_DEMO_MODE=false`),
   `tamamhealth-website`, `tamamhealth-sync-worker`.
5. Over SSH, records the currently running image of each service in
   `.tamamhealth-rollback-stack-<sha>`, then runs
   `docker compose --profile analytics -f docker-compose.yml -f docker-compose.ghcr.yml pull` and `up -d`
   with `IMAGE_TAG=<sha>`.
6. Waits (up to 30 x 10 s) until `platform`, `website` and `sync-worker` run the
   expected image tag and report healthy.
7. Installs the role-aware CouchDB validators from the running immutable image:
   `docker exec <platform container> npm run setup:couchdb:validators`.
8. Checks the website URL, then polls the platform health URL until it returns
   200 with `release` equal to the deployed SHA.
9. On failure after the deploy step, rolls the three services back to the images
   recorded in step 5 and waits for them to recover. On success it removes the
   rollback record and runs `docker image prune -f`.
10. Raises or clears a failure-alarm issue (`.github/actions/alert-failure`).

If the host stack was already down, step 5 warns and treats the deploy as a
fresh start; there is then no previous release to roll back to and the
rollback step fails with the container state and logs printed for manual
recovery.

### Post-deploy check

```bash
curl -fsS https://app.tamamhealth.org/api/health   # 200, "release" = deployed SHA
curl -fsSI https://tamamhealth.org/                # 200
```

On the host:

```bash
cd /opt/tamamhealth
docker compose --profile analytics -f docker-compose.yml -f docker-compose.ghcr.yml ps
docker compose --profile analytics -f docker-compose.yml -f docker-compose.ghcr.yml images
```

---

## 3. CouchDB tenant databases and validators

The platform uses one CouchDB database per organization (`<database>--<orgId>`),
reachable by browsers only through the `/api/couch` gateway.

- **Validators** are installed by the deploy workflow on every release (step 7
  above). To reinstall by hand, run the same command the workflow runs:

  ```bash
  cd /opt/tamamhealth
  docker exec "$(docker compose --profile analytics -f docker-compose.yml -f docker-compose.ghcr.yml ps -q platform)" \
    npm run setup:couchdb:validators
  ```

  Once tenant databases are the live path, set
  `COUCHDB_TENANT_DATABASES_ENABLED=true` for that run, otherwise the script
  re-grants browser membership on the shared aggregate databases and undoes the
  isolation. `COUCHDB_MEMBER_ORG_IDS` lists the organizations for the
  pre-cutover run. The policy for each database name is in
  `platform/src/lib/sync/couch-database-policy.ts`.

- **Tenant migration** (`db:migrate:couchdb-tenants`,
  `db:verify:couchdb-tenants` in `platform/package.json`) is only needed when
  moving existing shared-aggregate data into tenant databases. These scripts are
  not copied into the production image (only `install-validate-doc-updates.mjs`
  is), so run them from a repository checkout with `cd platform && npm ci`,
  pointing `COUCHDB_URL` at the host-local CouchDB (`http://127.0.0.1:5984`) with
  `COUCHDB_ADMIN_USER`, `COUCHDB_ADMIN_PASSWORD` and
  `COUCHDB_TENANT_ORG_IDS` (ids must match `org-[a-z0-9-]`):

  ```bash
  DRY_RUN=true npm run db:migrate:couchdb-tenants   # writes nothing
  npm run db:migrate:couchdb-tenants                # non-destructive copy
  npm run db:verify:couchdb-tenants                 # must exit 0
  ```

  Order: verify the copy before relying on tenant databases, and only then run
  `FINALIZE_SHARED_ACCESS=true npm run db:migrate:couchdb-tenants`, which makes
  the shared aggregates admin-only. That last step is the point of no easy
  return; any client still replicating directly against an aggregate stops
  working. No step deletes a source database.

---

## 4. Backups and restore

- Nightly in-stack dump: the `couchdb-backup` service (`scripts/dump-couchdb.sh`)
  writes verified dumps to the `couchdb_backups` volume on the same droplet.
- Off-site encrypted copies exist only after
  `sudo ./scripts/install-offsite-backup.sh` has been run on the droplet (GPG
  public key, `/etc/tamamhealth/backup.env`, S3-compatible bucket on
  DigitalOcean Spaces). Until then a destroyed droplet loses the database and
  every backup together.
- The weekly `backups-restore-drill` workflow (`backups-cron.yml`) proves the
  latest snapshots decrypt and are structurally sound; it needs the secrets on
  the `production-cron` environment listed in that file.
- Restore procedure, drill setup, and full-droplet recovery:
  [operations/backups.md](operations/backups.md). A dump is replayed with
  `scripts/restore-couchdb-dump.sh`.

---

## 5. Audit trail integrity

The analytics `audit_log` refuses edits and deletes, and every row is chained by
hash (`0016_audit_hash_chain.sql`). A database superuser can still switch that
off, so keep the proof outside the database.

Monthly, on the droplet, run these against the analytics Postgres:

```sql
SELECT * FROM verify_audit_chain();  -- ok must be true; otherwise it names the first bad row
SELECT * FROM audit_chain_head();    -- copy this hash somewhere outside the server
```

`verify_audit_chain()` reads the whole trail, so run it off-peak. A rewritten
chain shows when the recorded hash no longer appears in `audit_chain`.
`prune_audit_log(days)` is the only way to remove rows, keeps the 90-day floor,
and records a checkpoint.

## Rollback

| Situation | What happens / what to do |
|---|---|
| Release goes unhealthy during deploy | The workflow rolls platform, website and sync-worker back to the images recorded before the deploy. |
| Bad release that passed the health gate | Dispatch deploy-production again with the `sha` of the last good main commit (its images are rebuilt from that commit). |
| Stack was already down before the deploy | No previous release exists; the workflow prints container state and logs. Restore by hand on the host with the compose commands above. |
| Data loss | Restore from backup; see [operations/backups.md](operations/backups.md). |

Rollback is always a redeploy or a configuration change; no deploy step deletes
a database.

---

## Related

- [OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md): day-to-day operation
- [DEPLOY-DIGITALOCEAN.md](DEPLOY-DIGITALOCEAN.md): droplet bootstrap detail
- [infra/digitalocean/README.md](../infra/digitalocean/README.md): Terraform for the droplets, DNS, GitHub secrets
- [operations/production-hardening.md](operations/production-hardening.md): go-live checklist
