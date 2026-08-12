# Production cutover: App Platform + database-per-organization

How to bring TamamHealth up on DigitalOcean App Platform with per-organization
CouchDB databases, where browsers replicate only through the authenticated
same-origin gateway.

**There is no earlier version still serving.** `app.tamamhealth.org` resolves to
a Droplet that no longer exists in this team and presents a certificate for the
wrong hostname; the only TamamHealth service actually running is CouchDB on the
data Droplet. Treat this as a cold start, not a hand-off between two live
stacks. That means no clinician is disrupted while it runs — and equally that
there is no previous stack to fall back to.

Nothing here deletes a database, and every step is idempotent, so a failed step
is retried rather than unwound.

**Order matters.** Section 4 must not run before section 3 has been verified,
and section 6 is the point of no easy return. Read [ordering rules](#ordering-rules)
before improvising.

---

## What changes

| | Previous design | This design |
|---|---|---|
| Hosting | Droplet + docker-compose | App Platform, ≥2 instances |
| Browser → CouchDB | direct, public HTTPS | `/api/couch` gateway, same origin |
| CouchDB exposure | public 443 | private VPC only (`10.114.0.0/20`, port 5984) |
| Tenant isolation | `orgId` filters on shared databases | one database per organization |
| CouchDB credentials in the browser | yes | never |

The data plane Droplet stays. It keeps CouchDB and the encrypted off-site
backup jobs; the application layer is new.

---

## 0. Prerequisites

- `doctl` authenticated against the **Tamam Health** team.
- `terraform` ≥ 1.8 and a dedicated private Spaces bucket for remote state.
- CouchDB admin credentials and the canonical organization IDs to migrate.
  IDs must match `org-[a-z0-9-]`; the scripts reject anything else rather than
  guessing.
- The PHI encryption key already escrowed. Losing it makes every encrypted
  field permanently unreadable — there is no recovery path.

Confirm the inventory has not drifted since the IDs in `variables.tf` were
recorded (2026-08-12):

```bash
doctl vpcs list; doctl compute droplet list; doctl databases list
```

---

## 1. Bind CouchDB to the VPC

On the data Droplet, set the private address so App Platform can reach it while
the public interface stays closed:

```bash
# /opt/tamamhealth/.env on the data droplet
COUCHDB_BIND_ADDRESS=10.114.0.3
```

Keep the example default (`127.0.0.1`) everywhere else. Restart the data stack:

```bash
docker compose -f docker-compose.data.yml up -d
```

The public HTTPS endpoint stays reachable until section 7, so the migration
and verification scripts can run against it before the VPC route is proven.

---

## 2. Provision the application stack

```bash
cd infra/digitalocean/app-platform
cp backend.hcl.example backend.hcl
export AWS_ACCESS_KEY_ID='your-dedicated-spaces-key'
export AWS_SECRET_ACCESS_KEY='your-dedicated-spaces-secret'
terraform init -backend-config=backend.hcl
terraform import digitalocean_firewall.data_plane 265e3909-f1e4-43e9-94d1-92e701fa122b
terraform plan -out=tamamhealth.tfplan
terraform show tamamhealth.tfplan
```

`terraform apply` creates paid capacity and rewrites PostgreSQL trusted
sources. It needs separate explicit production approval. Spaces provides no
state locking, so exactly one operator or job may plan/apply at a time.

Two probes, deliberately different:

- **readiness** `/api/health` — deep. Returns 503 when CouchDB or the analytics
  database is unreachable, so a broken instance takes no traffic and a bad
  deployment is not promoted.
- **liveness** `/api/health/live` — process only. Never let this point at the
  deep check: a CouchDB blip would restart every instance at once, and the
  restarts cannot succeed until the dependency recovers.

---

## 3. Migrate the data (non-destructive)

Dry run first — it writes nothing and prints every source → target pair:

```bash
cd platform
export COUCHDB_URL=http://10.114.0.3:5984
export COUCHDB_ADMIN_USER=... COUCHDB_ADMIN_PASSWORD=...
export COUCHDB_TENANT_ORG_IDS=org-one,org-two

DRY_RUN=true npm run db:migrate:couchdb-tenants
```

Then the real copy. Shared access is retained, so nothing that reads the
aggregates breaks partway through:

```bash
npm run db:migrate:couchdb-tenants
```

For each organization and each org-scoped database this creates
`<database>--<orgId>`, installs the validator and `_security` for that single
organization, copies the matching documents, and persists continuous
`_replicator` jobs in both directions.

### Verify before going further

```bash
npm run db:verify:couchdb-tenants
```

It compares per-organization document counts between aggregate and tenant
databases, asserts each tenant database grants exactly one `org:` role, and
fails if any `tamamhealth-*` replication job is not `running`/`pending`.
It exits non-zero on any problem. Do not continue until it passes.

Also complete an encrypted off-site restore drill (`scripts/install-offsite-backup.sh`,
verified by restoring into a scratch database) before any real PHI moves.

---

## 4. Install validators and membership

While the shared aggregates are still authoritative, run **without** the tenant
flag:

```bash
COUCHDB_MEMBER_ORG_IDS=org-one,org-two npm run setup:couchdb:validators
```

The script enumerates the live `_all_dbs` and applies
`src/lib/sync/couch-database-policy.ts` to each name:

- **tenant** database → org-scoping validator, members `["org:<orgId>"]`, taken
  from the database name itself. Unaffected by the flag.
- **shared aggregate** → org-scoping validator; members are
  `COUCHDB_MEMBER_ORG_IDS` while `COUCHDB_TENANT_DATABASES_ENABLED` is unset,
  and **empty** once it is `true`.
- **anything else** (users, account requests, slot holds) → deny-all-but-admin
  validator, no members.

After the section 6 cutover, every later run of this script must set
`COUCHDB_TENANT_DATABASES_ENABLED=true`:

```bash
COUCHDB_TENANT_DATABASES_ENABLED=true npm run setup:couchdb:validators
```

Without it the script re-grants browser membership on the shared aggregates and
silently undoes the isolation that section 6 established.

---

## 5. Deploy the application

Merge to `main`, then run the `deploy-app-platform` workflow with the exact
reviewed commit SHA. The workflow refuses to deploy a SHA that is not the
current tip of `main`, waits for the deployment to go `ACTIVE`, smoke-tests
`/api/health` and `/login`, and rolls back to the previous deployment if the
smoke test fails.

Required repository secrets: `DIGITALOCEAN_ACCESS_TOKEN`, `DO_APP_ID`,
`DO_BASE_URL`. The `production` environment should require reviewers.

`NEXT_PUBLIC_*` values are compiled into the browser bundle at **build** time.
They are set `RUN_AND_BUILD_TIME` in `main.tf` and mirrored as `ARG`s in
`platform/Dockerfile`; changing one requires a rebuild, not a restart.

---

## 6. Finalize isolation (point of no easy return)

Only after the application serves real traffic correctly:

```bash
FINALIZE_SHARED_ACCESS=true npm run db:migrate:couchdb-tenants
```

Shared aggregate databases become admin-only. Browsers can then reach their own
organization's database and nothing else. Any client still replicating directly
against an aggregate stops working at this point — that is the intent.

Re-run the verification, and confirm a login and a chart write in each
organization.

---

## 7. Close the public data plane

Once the application is confirmed:

1. Remove the public HTTPS rules from the data-plane firewall, leaving SSH from
   the operator CIDR and 5984 from `10.114.0.0/20`.
2. Remove the public CouchDB DNS record.
3. Confirm `/api/couch` still replicates — it goes over the private VPC.

---

## Ordering rules

- **Verify (3) before validators (4).** The installer writes `_security` from
  what it finds live; run it against a half-copied migration and you pin
  membership onto an incomplete set.
- **Never point liveness at `/api/health`.** See section 2.
- **`COUCHDB_TENANT_DATABASES_ENABLED=true` only after cutover — and always
  after it.** Setting it early revokes the aggregates'
  browser membership and cuts clients off before the tenant path is proven; omitting it on a later re-run
  silently re-grants that membership.
- **Tenant databases are browser-facing.** They are absent from the sync map by
  name, and treating "absent from the map" as "server-only" would install a
  deny-all validator over live tenant data and clear its member role. That
  judgment now lives in `couch-database-policy.ts` with tests; keep it there
  rather than re-deriving it in a script.

---

## Rollback

| Stage | How to undo |
|---|---|
| Before §6 | Aggregates still hold every document — the continuous `_replicator` jobs kept them current — so the data is intact. There is no earlier application stack to point DNS back at; recovery means fixing forward. |
| After §6 | Re-grant membership: run `setup:couchdb:validators` **without** `COUCHDB_TENANT_DATABASES_ENABLED`, with `COUCHDB_MEMBER_ORG_IDS` set. |
| Bad app deploy | The deploy workflow rolls back automatically on smoke-test failure; otherwise `doctl apps create-deployment` from the previous SHA. |

No step deletes a source database, so rollback is always a configuration
change, never a restore.

---

## Related

- [infra/digitalocean/app-platform/README.md](../infra/digitalocean/app-platform/README.md) — stack contents and safety gates
- [OPERATOR-RUNBOOK.md](OPERATOR-RUNBOOK.md) — day-to-day operation
- [DEPLOY-DIGITALOCEAN.md](DEPLOY-DIGITALOCEAN.md) — the earlier Droplet deployment
