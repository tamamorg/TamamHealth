# Running & shipping the app

What to do locally on every change, and how that change travels from your laptop
to `app.tamamhealth.org`. Written against how this repo actually behaves, not how
the docs describe it.

> **Scope.** This is the day-to-day loop. For launch security, secrets, backups
> and incident handling see `production-runbook.md` — but read the correction in
> [§4](#4--production-manual) before trusting its deployment-topology section.

**The pipeline:**

| | Stage | Who runs it |
|---|---|---|
| 01 | Local | You — dev server, then five gates (one of which CI never runs) |
| 02 | Branch & PR | You — `main` requires 4 checks + a review |
| 03 | Staging | **Automatic** once CI passes on `main` |
| 04 | Production | **Manual dispatch + approval.** Nothing reaches users without it |

---

## 1 · Working locally

Everything runs from inside `platform/` — never the repo root. Each package in
the monorepo has its own lockfile, and npm from the root will quietly resolve the
wrong one.

```bash
cd platform
npm run dev
```

**Read the port it prints.** Don't assume 3000. If a Docker container already
holds that port, Next picks another and prints it — and if a dev server is
already running it refuses to start a second one and tells you where the existing
one is. That line is the source of truth, not habit.

### The five gates before you commit

Run all five. CI runs four of them; the fifth is yours alone.

| Command | Catches | Also in CI? |
|---|---|---|
| `npm run lint` | Errors only — the warning backlog is deliberate and not gated | CI runs it |
| `npx tsc --noEmit` | Type errors across the whole project | CI runs it |
| `npm test` | Jest — services, RBAC, components | CI runs it |
| `npm run build` | Server/client boundary breaks and env-bundling regressions that only appear at build time | CI runs it |
| `npm run i18n:check` | A user-facing string added to `en` but not `apd` | **You only** |

> **The one that will bite you.** `npm run i18n:check` is **not in CI**. Add a new
> label or message without its Juba Arabic translation and every check goes green,
> the PR merges, and the gap ships. Make it muscle memory alongside the others.

### Then actually look at it

Open the change in a browser and drive the real flow. A green type-check says the
code compiles, not that the feature works — most of what has gone wrong here
recently (empty dropdowns, dashes where data should be, a Retry button that did
nothing) type-checked perfectly.

---

## 2 · Branch, PR, merge

`main` is protected: four required status checks plus a required review.

```bash
git checkout -b fix/short-description
git add -A && git commit -m "fix(scope): what changed"
git push -u origin HEAD
gh pr create --fill
```

The four required checks:

- `platform · lint + type-check + test + build`
- `website · lint + type-check + build`
- `mobile · lint + type-check`
- `fingerprint-bridge · syntax check + tests`

They run on the PR and again on `main` after merge. Roughly four minutes.

> **Admin bypass is on.** Branch protection has `enforce_admins: false`, so as an
> admin you *can* push straight to `main` and skip the review. It works, but it
> puts unreviewed commits directly in front of the deploy pipeline. Use a PR
> unless there's a reason not to.

---

## 3 · Staging (temporarily paused)

`deploy-staging` is manual-only while the project operates a single VPS. It
must not be dispatched until a real staging host, TLS, and the staging GitHub
Environment secrets have been provisioned. Re-enable its `workflow_run`
trigger when staging returns.

```bash
# confirm staging has not been accidentally enabled
gh run list --workflow=deploy-staging --limit 3
```

---

## 4 · Production (manual)

Production is never automatic. You dispatch it, then a reviewer approves it.

**1. Get the SHA you want to ship**

```bash
git rev-parse HEAD          # must equal origin/main
gh run list --limit 5       # ci must be green for it
```

**2. Dispatch**

```bash
gh workflow run deploy-production.yml \
  -f sha=<full-40-char-sha> \
  -f target=vps
```

**3. Approve**

The run sits in `pending` until a reviewer approves the protected `production`
environment. Open the run on GitHub → **Review deployments** → **Approve and
deploy**.

Before any image tag changes, the workflow resolves the requested commit to
its full SHA, proves that it belongs to `main`, and requires a successful CI
run for that exact commit. It then builds all three images with production
settings and publishes both immutable SHA tags and the `production` tags.

> **Clear the queue first.** Dispatched-but-unapproved runs pile up and stay
> valid. Approving an old one silently ships an *older* build. Before approving,
> check `gh run list --workflow=deploy-production.yml` and
> `gh run cancel <id>` anything stale.

**4. Watch it**

```bash
gh run watch <run-id>
```

It builds and tags the three GHCR images as `production`, SSHes to the droplet,
and runs `docker compose pull && up -d`.

> **Health verification is automatic; workflow verification is still manual.**
> The `vps` path now waits for `/api/health` and verifies that its `release`
> matches the promoted short SHA, so a stale healthy container cannot make the
> deployment look successful. It does not auto-roll back, and the role-based
> browser checks below remain mandatory.

### Use `target=vps`, not App Platform

`production-runbook.md` says the app runs on DigitalOcean App Platform and calls
`vps` a legacy path. That is currently wrong, and it's worth knowing why before
you trust it:

- `app.tamamhealth.org` resolves to **164.90.243.83** — an A record to a droplet,
  the same IP as `couch.tamamhealth.org`. App Platform would be a CNAME to
  `*.ondigitalocean.app`.
- The App Platform Terraform state (`infra/digitalocean/app-platform/terraform.tfstate`)
  has `live_url: null` and no custom domain configured.
- The live host responds `via: 1.1 Caddy` — the droplet's proxy.

Deploying App Platform would ship to something no user is looking at. Verify for
yourself before a cutover changes this:

```bash
dig +short app.tamamhealth.org A
curl -sI https://app.tamamhealth.org/login | grep -i via
```

---

## After every production deploy

### Verify in a browser

Hard-reload once (<kbd>Shift</kbd>+<kbd>Cmd</kbd>+<kbd>R</kbd>) on a browser that
was using the old build. The app registers a service worker that caches hashed
assets per deploy; without a hard reload you are looking at the previous build and
will conclude nothing changed.

Then confirm the app loads and *stays* loaded, the header names the organization,
and the screen you changed does what you changed it to do.

### If you touched CouchDB documents, or stood up a new environment

The `tamamhealth_organizations` database is server-write-only, so organizations
seeded through a browser never replicate up. When they're missing, the server
rejects user creation with *"Assigned organization was not found or is inactive"*
and the organization settings panel shows dashes.

```bash
cd platform
COUCHDB_URL=https://couch.tamamhealth.org \
COUCHDB_ADMIN_USER=<prod user> \
COUCHDB_ADMIN_PASSWORD=<prod password> \
DRY_RUN=true npm run db:seed:organizations
```

`— exists` on every line means there's nothing to do. `— would-create` means
they're missing; drop `DRY_RUN=true` to write them. It never overwrites an
existing organization.

### Rolling back

Same workflow, previous SHA — it re-tags that image as `production` and redeploys:

```bash
gh workflow run deploy-production.yml \
  -f sha=<previous-good-sha> \
  -f target=vps
```

Then approve it the same way. Any SHA that reached staging can be promoted, so
recovery is as fast as a deploy.

---

## Traps worth knowing

Each of these has already cost real debugging time on this project.

**The container on :3000 is not your code.** A Docker container often holds port
3000 with a production build that can be days old. Debugging against it will have
you chasing bugs already fixed in your tree.

```bash
docker image inspect tamamhealth-platform --format '{{.Created}}'
```

**`platform/.seed-credentials.json` must be a file.** Compose bind-mounts this
path. If the host file is missing, Docker creates a *directory* there, and seeded
logins break on the next `up -d`. Check with `ls -ld` — it should start with `-`,
not `d`.

**i18n is a local gate only.** Nothing in CI runs `i18n:check`. A missing `apd`
translation ships green.

**One failed chunk looks like six broken features.** Dashboards load their data
through several dynamic `import()`s of the same chunk. When that chunk fails,
every one of them reports failure at once — one network fault presenting as a wall
of unrelated errors. Check the browser console for `ChunkLoadError` before
believing the list.

**The repo's runbook disagrees with DNS.** When infra docs and `dig` disagree,
believe `dig`.

---

Commands assume you're in `platform/` unless stated. Production host
`164.90.243.83`; CouchDB at `couch.tamamhealth.org`.
