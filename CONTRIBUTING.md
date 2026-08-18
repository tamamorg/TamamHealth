# Contributing to TamamHealth

## Getting set up

One command from a fresh clone:

```bash
./scripts/setup.sh
```

It pins your Node version, installs every package, activates the git hooks,
seeds `platform/.env.local`, and finishes with a type-check so you know the
toolchain actually works. Useful flags:

| Flag | Effect |
|------|--------|
| `--fast` | Skip `mobile/` (much the largest install) |
| `--check` | Verify an existing setup; install nothing |

Then:

```bash
cd platform && npm run dev     # http://localhost:3000
cd website  && npm run dev     # http://localhost:3001
```

For generated secrets and a guided config walkthrough, run
`node platform/scripts/setup.mjs`.

### This is not an npm workspace

There is no hoisting and no root-level application install. Five packages each
carry their own `package.json` **and their own lockfile**:

```text
platform/  website/  mobile/  sync-worker/  fingerprint-bridge/
```

The repo-root `package.json` is tooling only (husky + lint-staged) — nothing
there is published or deployed. So:

- Install and run commands from **inside** the package: `cd platform && npm ci`,
  or `npm --prefix platform ci` from the root.
- Adding a dependency changes **one** lockfile. Commit it with the change.
- CI builds on Node 20 / npm 10. If your local npm is newer, regenerate a
  lockfile with the matching major so CI's `npm ci` doesn't diverge:

  ```bash
  cd platform && npx npm@10 install
  ```

`country-node/` and `regional-exchange/` have no package.json yet and are not
part of the install or CI matrix.

### Three gotchas that bite everyone

- **Leave `DATABASE_URL` unset for normal dev.** The platform is offline-first
  and runs on PouchDB in the browser. Setting `DATABASE_URL` switches on the
  Postgres analytics path, and you will chase phantom connection errors.
- **`rm -rf platform/.next` after switching branches.** Next caches hard enough
  that you will be served the other branch's pages.
- **Run `nvm use` in every new shell.** Node is pinned in `.nvmrc`; drifting off
  it is what produced the macOS-vs-Linux lockfile break and the Node-ESM outage.

### Node version

`.nvmrc` (Node 20) is the single source of truth — every CI job reads the same
file via `node-version-file`, so local and CI cannot drift apart. The root,
`website/` and `mobile/` `engines` fields pin that exact major; `platform/`,
`sync-worker/` and `fingerprint-bridge/` declare looser floors, but everything
that ships is built on 20.

---

## Signing in during development

Accounts come from the users database — there is no demo-credential roster on
the login page and no demo branch in the authenticator. A fresh environment is
reachable through the bootstrap account `superadmin` (initial password
`Superadmin!`, or `SUPERADMIN_INITIAL_PASSWORD` when set), which is forced to
change its password on first login. From there, create accounts at
`/admin/users`, or use the login form's role picker — only a super-admin may
sign in as a different role — to enter any role's workspace directly.

---

## Pre-commit hooks

`husky` + `lint-staged` run automatically on `git commit`, scoped to the
packages your commit actually touches (`platform`, `website`, `mobile`):

- **eslint `--fix`** on the staged files — auto-fixable problems are repaired
  in place.
- **`tsc --noEmit`** on the whole affected package. TypeScript can't check
  these files in isolation (path aliases, JSX, ambient types all come from the
  tsconfig), so it's one project-wide check per touched package.
- **`bash -n`** on any changed shell script, and a YAML parse on changed
  workflow/compose files.

A commit with a lint or type error is blocked locally, in seconds, instead of
failing CI six minutes later.

```bash
git commit --no-verify      # emergency bypass
```

Config lives in [`.lintstagedrc.mjs`](.lintstagedrc.mjs) and
[`scripts/lint-staged-runner.mjs`](scripts/lint-staged-runner.mjs).

If hooks aren't firing, run `npm install` at the repo root — that's what
registers them.

---

## Checks you can run yourself

| Package | Command | What it covers |
|---------|---------|----------------|
| `platform` | `npm run lint` · `npx tsc --noEmit` · `npm test` · `npm run build` | The full CI job |
| `platform` | `npm run i18n:check` | Missing/extra keys between `en` and `apd` (Juba Arabic) |
| `website` | `npm run lint` · `npx tsc --noEmit` · `npm run build` | The full CI job |
| `website` | `npm run i18n:check` | Same check for the marketing site |
| `mobile` | `npm run lint` · `npx tsc --noEmit` | The full CI job |
| `fingerprint-bridge` | `npm run check` · `npm test` | Syntax check + tests |

`i18n:check` is **not** a CI gate — run it yourself when you add user-facing
copy, or the Arabic build silently falls back to English.

Other platform scripts worth knowing: `npm run db:migrate` (Postgres analytics
schema), `npm run setup:couchdb:validators`, `npm run db:migrate:couchdb-tenants`
and `npm run db:verify:couchdb-tenants` (per-organization CouchDB databases),
and `npm run docs:api` (typedoc).

---

## Branching, PRs and review

`main` is **protected**. Nothing is pushed to it directly:

- Work on a branch, open a pull request against `main`.
- **One approving review** is required; stale approvals are dismissed on a new
  push, and all review conversations must be resolved before merge.
- Force pushes and branch deletion are blocked.

[`.github/CODEOWNERS`](.github/CODEOWNERS) auto-requests reviewers by path.
Repo collaborators are `@makuachteny`, `@senyomd` and `@ikyalo01`, but every
path currently routes to `@makuachteny` because subsystem ownership was never
recorded. If you own a subsystem, put your handle on it. ("Require review from
Code Owners" is not yet enabled, so these are suggestions, not gates.)

Fill in [the PR template](.github/PULL_REQUEST_TEMPLATE.md) — it checks the
change against [docs/PRINCIPLES.md](docs/PRINCIPLES.md) (offline-first, data
layer, tenant isolation, PHI safety, permissions).

---

## CI gates

[`ci.yml`](.github/workflows/ci.yml) runs five independent jobs on every push
to `main` and every PR:

| Job | What it runs | Required to merge |
|-----|--------------|-------------------|
| `platform` | lint + type-check + test + build | yes |
| `website` | lint + type-check + build | yes |
| `mobile` | lint + type-check | yes |
| `fingerprint-bridge` | syntax check + tests | yes |
| `infrastructure` | terraform fmt/validate + deployment-manifest checks | not yet |

The pre-commit hook covers the lint and type-check halves locally, so CI
failures should mostly be test or build failures.

Green `ci` on `main` then triggers `deploy-staging` automatically.

---

## Jira integration (smart commits)

We track deployment and platform work in Jira (**tamamorg.atlassian.net**, project **KAN**).

### Branch names

```text
feat/KAN-91-ghcr-compose
fix/KAN-92-admin-password-rotation
```

### Commit messages

Include the issue key at the start:

```text
KAN-91 Add docker-compose.ghcr.yml for GHCR staging deploys
```

### Pull requests

- **Title:** include the Jira key — `KAN-91 Add GHCR compose override`
- **Description:** link and auto-close when merged:

```markdown
## Summary
Adds docker-compose.ghcr.yml so deploy-staging can pull pre-built images.

Closes KAN-91
```

Supported verbs (with GitHub for Jira installed): `Closes`, `Fixes`, `Resolves`.

Full operator guide: [docs/operations/jira-github-do-tracking.md](docs/operations/jira-github-do-tracking.md).

---

## What happens after merge

| Workflow | Trigger | Effect |
|----------|---------|--------|
| `deploy-staging` | automatic, after green `ci` on `main` | Builds platform + website + sync-worker images, publishes them to GHCR as `:staging`, and (when the `STAGING_SSH_*` secrets exist) pulls and restarts the staging stack |
| `deploy-production` | manual (`workflow_dispatch`), `target: vps` or `aws` | Re-tags the staging images as `production` — refusing any demo-mode image — then SSH-deploys, or runs the CloudFormation path in `af-south-1` |
| `deploy-app-platform` | manual | Deploys to DigitalOcean App Platform against an exact reviewed commit, smoke-tests it, and rolls back on failure |
| `deploy-website` | manual | Builds `tamamhealth.org` in CI, publishes to GHCR, and copies the image to the droplet over SSH — the DigitalOcean container registry is no longer in the path |
| `docs`, `mobile-beta` | see the workflow files | API docs and Expo beta builds |

Scheduled workflows (`backups-cron`, `reminders-cron`,
`telehealth-maintenance-cron`, `transfers-sweep-cron`) run on their own timers
and are not part of the merge path.

Always smoke-test staging before promoting to production.

---

## Local development

See [docs/DEVELOPER-ONBOARDING.md](docs/DEVELOPER-ONBOARDING.md) and
[platform/README.md](platform/README.md) for the environment-variable reference.
