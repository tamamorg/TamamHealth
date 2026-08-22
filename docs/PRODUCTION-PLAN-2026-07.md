# TamamHealth — Production Plan

_Written 2026-07-27, from a direct pass over the repo, the live GitHub Actions
state, and the KAN Jira backlog (92 issues). Every claim below is marked
**[verified]** with the evidence that supports it, or **[assumed]** where it
rests on judgement rather than observation._

---

## 1. Where the product actually stands

### Green — and genuinely so

| Signal | Evidence |
|---|---|
| Test suite passes | 96 suites / **1913 tests**, 9.6s, exit 0 (`npm run test:ci`, run locally 2026-07-27) **[verified]** |
| Type-checks clean | `npx tsc --noEmit` exit 0 **[verified]** |
| CI green on `main` | run `30274553549`, all four jobs (platform / website / mobile / fingerprint-bridge) **[verified]** |
| Images publish | `deploy-staging` run `30274827886` pushed platform, website and sync-worker to GHCR **[verified]** |
| No debt markers | `grep -c "TODO\|FIXME\|HACK"` over `platform/src` (excluding tests) = **0** **[verified]** |
| Boot refuses bad config | `instrumentation.ts` → `validateProductionConfig()` fails closed on weak `JWT_SECRET`, placeholder admin password, unsigned payment webhooks **[verified]** |
| Route gating is server-side | `platform/src/proxy.ts` (Next 16's renamed middleware) verifies the JWT and enforces `role-routes` allow-lists before the dashboard renders **[verified]** |
| Migrations are safe under rolling deploys | boot-time runner takes a Postgres advisory lock **[verified]** |
| DNS + droplets live | `tamamhealth.org`/`app.` → 138.68.124.30, `app.staging.` → 146.190.179.153 **[verified, per docs/JIRA-DEPLOY-BACKLOG.md audit]** |

This is a healthy codebase. The blockers below are almost entirely
**configuration and operational**, not code quality.

### The Jira backlog as it stands

92 issues in **KAN**, four epics:

| Epic | Theme | Open |
|---|---|---|
| KAN-1 | DX / engineering workflow hardening | 5 of 7 |
| KAN-22 | Codebase audit remediation (CRIT/HIGH/MED/LOW) | ~30 |
| KAN-85 | Design system | 0 (done) |
| KAN-90 | DigitalOcean deployment & CI/CD | 2 |

Status split across all 92: **26 Done · 28 In Progress · 6 To Do** (plus the
older KAN-8…KAN-21 audit tasks). **[verified]**

> ⚠️ **28 "In Progress" is not a real signal.** Spot-checking three of them
> against the code found one already shipped (`/api/health` exists and is
> complete — KAN-69), one half-shipped (KAN-34: rate-limiting moved to Upstash
> Redis, token blacklist still on `node:fs`), and one untouched (KAN-36: PHI
> encryption still absent from `.env.example`). The board needs a status
> reconciliation pass before it can be used to plan a launch. **[verified]**

---

## 2. Launch blockers (P0 — nothing ships until these are closed)

### P0-1 · Published images ship with DEMO MODE ON — fictional patients in production

**Status: code fix landed 2026-07-27. Two operator actions remain (below).**

- `platform/src/lib/db-seed.ts:1142` — `const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'`.
  Demo mode is **opt-out**, and the opt-out must be present at build time.
- `platform/Dockerfile` declares only `ARG JWT_SECRET`. It sets **no**
  `NEXT_PUBLIC_DEMO_MODE`.
- `.github/workflows/deploy-staging.yml` calls `docker/build-push-action@v6`
  with **no `build-args:` block at all**.
- `NEXT_PUBLIC_*` is inlined into the client bundle at build time —
  `docker-compose.yml` says so in its own header comment. Setting
  `NEXT_PUBLIC_DEMO_MODE=false` in the droplet's `.env` **cannot** fix an image
  that was already built without it.

**Consequence:** every image in GHCR tagged `staging` / `production` boots into
demo mode — it seeds ~20 fictional patients with names, phone numbers,
diagnoses and telehealth notes into each clinician's browser, and serves the
demo-accounts dropdown from `/api/demo-credentials`. A real facility's first
day would begin with fake patients mixed into the worklist. **[verified]**

**Fix applied:**

- `platform/Dockerfile` — `ARG NEXT_PUBLIC_DEMO_MODE=false` passed into
  `npm run build`. The default is `false`, so a build that forgets the arg now
  produces a *real-mode* image. That is the fail-safe direction: a real-mode
  image refuses to boot without PHI encryption, whereas a demo-mode image boots
  happily and seeds fake patients.
- The runner stage records `LABEL org.tamamhealth.demo-mode`, so the mode baked
  into a built image is inspectable after the fact.
- `deploy-staging.yml` passes the build-arg from `vars.NEXT_PUBLIC_DEMO_MODE`,
  defaulting to `false`.
- `deploy-production.yml` gained a **"Refuse to promote a demo-mode image"**
  step that reads the label and fails the promotion if it is `true` — or if the
  label is absent, which means the image predates this change.
- `ci.yml` now builds with `NEXT_PUBLIC_DEMO_MODE: 'false'`. CI previously only
  ever compiled the demo variant and never exercised the real-mode paths.
- `scripts/verify-deploy-pipeline.sh` gained 5 static checks so none of the
  above can silently regress (**22/22 passing**).

**Two operator actions remain:**

1. **Decide what the droplets are.** `docs/DEMO-LAUNCH-tamamhealth-org.md` says
   `app.tamamhealth.org` is deliberately a *public demo*. With the default now
   `false`, the next CI build flips it to real mode — where it will refuse to
   boot until PHI encryption is configured. To keep it a demo, set the repo (or
   staging-environment) variable `NEXT_PUBLIC_DEMO_MODE=true`. **[assumed: that
   the demo should stay a demo — confirm before the next deploy]**
2. **Rebuild and re-tag.** Every image currently in GHCR predates the label and
   will be refused by the new promotion gate until rebuilt.

**Architectural constraint this exposed:** `deploy-production.yml` does not
build — it *promotes the staging image*. Demo mode is fixed at build time.
Therefore **staging and production cannot differ in demo mode** under the
current promote model. A demo staging and a real production requires either a
second build or a separate demo tag. **[verified]**

### P0-2 · CI has never deployed to a droplet

- `staging` and `production` GitHub Environments **exist with zero secrets**
  (`gh api repos/:owner/:repo/environments/{staging,production}/secrets` →
  empty). **[verified]**
- Both deploy workflows gate the SSH job on `*_SSH_HOST/USER/KEY` and skip
  cleanly when unset, so runs report **success** while deploying nothing —
  which is why this went unnoticed. **[verified]**
- Every droplet deploy to date has been manual.

Tracked as **KAN-91**. Needs a deploy keypair whose public half is in the
droplets' `authorized_keys`; the existing `tamamhealth-deploy` private key is
not on this machine.

### P0-3 · Backups are unverified — the last restore drill failed

- `.github/workflows/backups-cron.yml` runs a quarterly structural restore
  drill and requires `AWS_ACCESS_KEY_ID`, `BACKUP_BUCKET`,
  `BACKUP_PRIVKEY_GPG`, … in the **production** environment — which, per P0-2,
  holds no secrets. The drill therefore cannot pass. **[verified]**
- The 2026-07-01 drill failed on `apt-get install awscli` (package dropped from
  Ubuntu 24.04); the workflow now carries a fix, but it has not been re-run
  green. **[verified, from the workflow's own comment]**
- Off-site upload is still unwired (**KAN-48**, HIGH-16). The compose stack's
  `couchdb-backup` sidecar writes to a **local Docker volume only** — a droplet
  loss loses the backups with it. **[verified]**

Tracked as **KAN-92** + **KAN-48**.

**No patient data goes into this system until a restore has been demonstrated
end-to-end.** For a clinical record system this is not negotiable.

### P0-4 · PHI encryption at rest exists but is switched off

**Status: code fix landed 2026-07-27. Key generation/escrow remains.**

`validateProductionConfig()` is now fail-closed on encryption: production
refuses to boot unless `PHI_ENCRYPTION_ENABLED=true`, with the single exemption
of an explicit demo deployment (`NEXT_PUBLIC_DEMO_MODE=true`), and it also
rejects a placeholder key. The old rule only fired when encryption was *already*
on — so the dangerous case, an operator who never set the flag and was silently
writing plaintext PHI, passed validation cleanly. `.env.example` and
`.env.production.example` now carry the keys with a loss-of-key warning, and
`docs/DEPLOY-DIGITALOCEAN.md` §5 generates and escrows the key inline.
**18 new tests; 1931 passing.** **[verified]**

**Remaining:** generate the real key per deployment, escrow it alongside the
CouchDB credentials, and document rotation. Losing it makes every encrypted
field permanently unreadable — there is no recovery path.

<details><summary>Original finding</summary>

- `platform/src/lib/field-encryption.ts` is implemented, tested, and wired into
  `medical-record-service`, `lab-service` and `message-service`. **[verified]**
- It is inert unless `PHI_ENCRYPTION_ENABLED=true`, and **`PHI_ENCRYPTION` does
  not appear anywhere in `platform/.env.example` or
  `infra/digitalocean/production.env.append`** — so no deploy has ever turned it
  on. **[verified]**

Tracked as **KAN-36** (HIGH-01). Turn it on, generate and escrow the key, and
document key rotation before any real record is written, because retrofitting
encryption over existing plaintext documents is a migration, not a config
change.

</details>

### P0-5 · Mobile sync engine is dead code

**Status: wired 2026-07-27.** `configureSyncEngine()` is now called from
`mobile/src/lib/auth.tsx` on both session hydration (:173) and login (:232).
It previously had zero call sites, so the mobile app could not sync at all.
**[verified]**

Tracked as **KAN-24** (CRIT-04) — re-status it and close. Remaining: confirm on
a real device that a record created offline reaches CouchDB after reconnect.
Wiring the call proves the code path exists, not that replication round-trips.

---

## 3. Pre-launch (P1 — before the first real facility, not before staging)

**P1-1 · Reconcile the Jira board.** Walk all 28 "In Progress" issues against
the code and re-status them. Without this, no burndown is trustworthy.

**P1-8 · Base image carries 2 critical + 23 high CVEs.** `node:20-alpine`, per
the IDE's container scanner on `platform/Dockerfile`. **[verified — scanner
output, CVEs not individually triaged]** Pin to a current digest and add a
scheduled rebuild; a base image is only as fresh as its last build, and these
images are rebuilt only on pushes to `main`.

**P1-9 · Demo seed data is still served in production builds.** With
`NEXT_PUBLIC_DEMO_MODE=false`, the runtime no longer seeds — but the seed
arrays are top-level consts in `db-seed.ts` and survive tree-shaking into a
**47 KB code-split chunk** (`.next/static/chunks/`) containing fictional patient
names, phone numbers and telehealth notes. Verified by grepping a real
demo-off build: `Deng Mabior Garang` and `Gatluak Ruot Nyuon` are present.
**[verified]**

Severity is limited — the chunk is code-split, so the app never loads it when
demo mode is off, and the records are fictional, so this is not a PHI leak. But
it is dead weight served to every client and it defeats any "the production
bundle contains no demo data" assertion. Fix by moving the seed arrays behind
the same `await import()` boundary `@/data/mock` already uses, then add the
bundle-grep assertion to CI.

**P1-2 · Single-replica constraint is undocumented.**
`platform/src/modules/identity/core/token-blacklist.ts` persists revoked JWTs to a local file via
`node:fs` (`.token-blacklist.json`). Rate limiting moved to Upstash Redis and
warns loudly on the in-process fallback; the blacklist did not. **[verified]**
With more than one platform container, a logged-out token stays valid on the
other replicas. Either finish **KAN-34** onto Redis, or write "single replica
only" into the runbook and enforce it in compose.

**Partially addressed 2026-07-27:** `token-blacklist.ts` now warns once, in
production only, that revocation state is per-instance and names the file path
— mirroring the warning `rate-limit.ts` already emits when it falls back off
shared Redis. A silent per-instance security store was the failure mode worth
removing first. The underlying constraint is unchanged: **run one replica.**

**P1-3 · Commit the DX work sitting in the working tree.** `.nvmrc`,
`.husky/`, `.github/CODEOWNERS`, `scripts/setup.sh`, `.lintstagedrc.mjs` and a
root `package.json` are all **untracked**, alongside 13 modified files.
**[verified]** That is KAN-4/5/6/7 already built and at risk of being lost.
Commit it, close those tickets.

**P1-4 · Branch protection on `main` (KAN-2).** Everything currently lands
straight on `main`. With CI green and CODEOWNERS ready, this is cheap.

**P1-5 · Test the untested layers.** Coverage is collected from
`src/lib/services/**` only (`jest.config.ts` `collectCoverageFrom`). The **74
API route handlers and every component are outside the coverage denominator**,
and 14 services sit at **0%** — including `payroll-service`, `receipt-service`,
`patient-queue-service`, `mpi-service`, `problem-service`, `procedure-service`.
`payment-service` is at **12.97%** and `ledger-service` at **37.97%** — the two
money-handling services are the two least-tested. **[verified]** Add route-level
tests for the auth-bearing and money-moving endpoints before go-live.

**P1-6 · Close out the remaining HIGH audit items** — KAN-37 (atomic
consultation save), KAN-39 (pharmacy stock gate), KAN-42 (`geocodeId`), KAN-43
(referral SLA), KAN-44 (`couchbackup` + verification), KAN-49 (ICD-11 level
validation), KAN-50 (auto-delete `.seed-credentials.json`).

**P1-7 · Operational readiness.** Sentry DSN set in production (the SDK is
wired but no-ops without one), `/api/health` pointed at an uptime monitor
(**KAN-69** — the route is already built), and log/audit offload configured
(**KAN-70**).

---

## 4. Explicitly out of scope for v1

- **country-node** — `country-node/src/` is **empty**. **[verified]**
- **regional-exchange** — README only, no source. **[verified]**

The national/DHIS2 tier is Phase 3 by design (per `docs/ARCHITECTURE.md`) and
nothing in the facility runtime depends on it. Say so out loud in the launch
comms so it isn't discovered as a surprise gap. **[assumed — worth confirming
with whoever owns the MoH relationship]**

---

## 5. Sequenced plan

Durations are **[assumed]** — they're sizing guesses, not commitments, and
assume roughly one engineer plus operator access to the droplets.

### Gate 0 — Truthful baseline (~2 days)
P1-1 board reconciliation · P1-3 commit the DX tree · P1-4 branch protection.
**Exit:** the board matches the code; `main` is protected.

### Gate 1 — Make the pipeline real (~3 days)
P0-2 deploy secrets (KAN-91) · P0-1 demo-mode build args + bundle assertion.
**Exit:** a push to `main` deploys to staging automatically, and the staging
bundle contains **no** demo data.

### Gate 2 — Make the data survivable (~1 week)
P0-3 off-site backups + a green restore drill (KAN-48, KAN-92, KAN-44) ·
P0-4 PHI encryption on, key escrowed, rotation documented (KAN-36).
**Exit:** a full restore has been demonstrated from off-site storage into a
scratch environment, and encryption is on before the first real record.

### Gate 3 — Clinical-safety close-out (~2 weeks)
P1-6 remaining HIGH items · P1-5 tests on payment/ledger/API routes ·
P0-5 mobile sync decision (KAN-24).
**Exit:** no open CRIT or HIGH; money and clinical paths have route-level tests.

### Gate 4 — Pilot (1 facility, ~2 weeks live)
P1-2 single-replica documented or fixed · P1-7 Sentry + uptime + log offload.
Run one facility with real users and a daily backup-verification check.
**Exit:** two weeks with no P1 incident, and a restore drill run *during* the
pilot, not before it.

### Gate 5 — General availability
Roll out facility by facility. Keep the production deploy manual-dispatch with
required reviewers (already how `deploy-production.yml` is written).

**Critical path: Gate 1 → Gate 2.** Everything else can run in parallel;
nothing real ships until backups restore and demo data is gone.

---

## 6. Jira: what to create

Once the project exists, this maps to **one epic + six stories** that are *not*
already tracked, plus links to the existing tickets:

| # | Type | Summary | Priority | Existing? |
|---|---|---|---|---|
| — | Epic | **TamamHealth — Production Readiness (v1 launch)** | — | new |
| 1 | Story | ~~Bake `NEXT_PUBLIC_DEMO_MODE=false` into published images~~ → **decide demo-vs-real for the droplets, then rebuild/re-tag** | Highest | **new (P0-1, code done)** |
| 1b | Story | Move demo seed arrays behind a dynamic import; add the bundle-grep assertion | Medium | **new (P1-9)** |
| 1c | Story | Pin and patch the `node:20-alpine` base image (2 critical / 23 high CVEs) | High | **new (P1-8)** |
| 2 | Story | Configure `STAGING_SSH_*` / `PROD_SSH_*` secrets so CI can deploy | Highest | KAN-91 |
| 3 | Story | Wire off-site backup upload + get the restore drill green | Highest | KAN-48 + KAN-92 |
| 4 | Story | ~~Enable PHI encryption at rest~~ → **generate + escrow the key; document rotation** | Highest | KAN-36 (guard done) |
| 5 | Story | Wire or descope the mobile sync engine (`configureSyncEngine` has no callers) | Highest | KAN-24 |
| 6 | Story | Reconcile the 28 "In Progress" KAN issues against the code | High | **new (P1-1)** |
| 7 | Story | Commit the untracked DX tooling (`.nvmrc`, husky, CODEOWNERS, setup.sh) | High | closes KAN-4/5/6/7 |
| 8 | Story | Document or remove the single-replica constraint (`token-blacklist` on `node:fs`) | High | KAN-34 (partial) |
| 9 | Story | Route-level tests for payment, ledger and auth-bearing API endpoints | High | **new (P1-5)** |
| 10 | Story | Production observability: Sentry DSN, uptime monitor on `/api/health`, log offload | Medium | KAN-69 + KAN-70 |

---

## 7. How to verify any of this yourself

```bash
./scripts/verify-deploy-pipeline.sh            # 22/22 static checks
cd platform && npm run test:ci && npx tsc --noEmit   # 1931 tests, clean
gh api repos/:owner/:repo/environments/production/secrets --jq '.secrets[].name'   # still empty
grep -rn "configureSyncEngine" mobile --exclude-dir=node_modules                   # definition only
```

Reproduce P1-9 (demo data still in the bundle) on a real production-mode build:

```bash
cd platform
NEXT_PUBLIC_JWT_SECRET= JWT_SECRET=ci-build-non-secret-do-not-use-anywhere-real \
  NEXT_PUBLIC_DEMO_MODE=false npm run build
grep -rl "Deng Mabior Garang" .next/static      # 1 chunk, ~47 KB
```

> The empty `NEXT_PUBLIC_JWT_SECRET=` is needed only locally: `next build` loads
> `platform/.env.local`, which sets it, and `auth-token.ts` refuses to build in
> production with it set. CI has no `.env.local`, so it is unaffected.
