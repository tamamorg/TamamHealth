# Manual Setup Checklist — what only you can do

Everything that can be scripted is scripted. This page is the short list of
things that need **your** decisions, accounts, or credentials. Do these and the
platform is deployable.

---

## Already handled for you (no action needed)

- ✅ Env **templates** for the platform and compose files (`.env.example`,
  `platform/.env.production.example`) — every required key, documented.
  `website/.env.production.example` does **not** exist yet — see the note in
  step 1 below.
- ✅ **Secret generation** — `scripts/gen-secrets.sh` fills every random secret
  (JWT, CouchDB/Postgres passwords, admin bootstrap, HMAC webhook) so you never
  invent a key.
- ✅ **Preflight gate** — `scripts/preflight.sh` refuses to deploy if anything
  required is missing.
- ✅ **One-shot deploy** — `deploy.sh` installs Docker + Caddy + TLS and brings up
  the stack; `docker-compose.yml` defines platform + website + CouchDB + nightly
  backup (+ Postgres analytics profile).
- ✅ **Backups / DR scripts**, secrets-manager (Doppler) bootstrap, CouchDB setup.
- ✅ Production safety: `NEXT_PUBLIC_DEMO_MODE=false` path seeds a clean slate
  (admin + org only, no demo patients).

---

## You must do these (with the tool that helps each)

### 1. Generate your secrets — 1 command
```bash
./scripts/gen-secrets.sh        # writes .env and platform/.env.production, secrets filled
touch website/.env.production   # no .example template exists for this one (see below)
```
`gen-secrets.sh` only writes 2 of the 3 gitignored env files: there's no
`website/.env.production.example` template in the repo, so it silently skips
`website/.env.production` — but `deploy.sh` still refuses to run without that
file present. The website container reads no secrets from it today, so an
empty file is enough.

Then store a copy of those secrets in a password manager and **escrow the LUKS
disk key** somewhere safe off the server. (Only you should hold these.)

### 2. Procure infrastructure (accounts/money — not scriptable)
- [ ] An **in-country Ubuntu 22.04 server** (MoH data centre or in-country host), public IP, UPS.
- [ ] A **domain** and **3 DNS A records** → server IP: `tamamhealth.org`,
      `app.tamamhealth.org`, `couch.tamamhealth.org`.

### 3. Fill the few manual values the generator can't (your identifiers)
In `platform/.env.production`:
- [ ] `NEXT_PUBLIC_COUCHDB_URL=https://couch.<your-domain>`
- [ ] `NEXT_PUBLIC_APP_URL=https://app.<your-domain>`
- [ ] `NEXT_PUBLIC_SYNC_ENABLED=true`
- [ ] `NEXT_PUBLIC_ORG_NAME` / `NEXT_PUBLIC_ORG_EMAIL` / `NEXT_PUBLIC_ORG_COUNTRY`
- [ ] `SUPERADMIN_INITIAL_PASSWORD` — the real bootstrap-login credential
      (16+ chars, not the demo default `Superadmin!`). Not in
      `platform/.env.production.example`; `gen-secrets.sh` doesn't generate
      it either. The platform refuses to boot without it whenever sync is
      enabled, demo mode or not.

### 4. Third-party provider keys — only the ones you actually use
Sign up and paste the key; leave the rest blank (they're optional):
- [ ] **Email** (`EMAIL_PROVIDER` + `RESEND_API_KEY` / `SENDGRID_API_KEY` / `SMTP_URL`) — for notifications.
- [ ] **SMS** (`AFRICAS_TALKING_*`) — for appointment reminders, if used.
- [ ] **Payments** (`FLUTTERWAVE_SECRET_HASH`) — only if taking online payments.
- [ ] **Sentry** (`NEXT_PUBLIC_SENTRY_DSN`) — error monitoring (self-host to keep data local).

### 5. Deploy
```bash
./scripts/preflight.sh                 # confirm nothing's missing
sudo bash deploy.sh                    # or: docker compose build && docker compose up -d
```
Build first (`NEXT_PUBLIC_*` are baked at build time), confirm TLS on all 3 domains.

### 6. First login & facility setup (in the app, by you)
- [ ] Log in as `superadmin` with the `SUPERADMIN_INITIAL_PASSWORD` you set in
      step 3, **rotate the password immediately**. (There are no more demo
      role chips on the login page and no `/api/demo-credentials` — this is
      the actual bootstrap path.)
- [ ] Create the first hospital + a facility administrator.
- [ ] That admin creates real users by role (see `docs/RBAC-MATRIX.md`).

### 7. Operations you own
- [ ] Configure **offsite encrypted backup rotation** (the nightly dump lands in a
      volume; ship it offsite). Test a restore with `scripts/backup-restore-drill.sh`.
- [ ] Decide who holds the LUKS key and admin secrets.

---

## Hard rules (don't skip)

- **Never commit** `.env`, `platform/.env.production`, `website/.env.production`
  (already gitignored).
- **Never** set `NEXT_PUBLIC_DEMO_MODE=true` in production.
- **Never** bump `SEED_VERSION` against a live production database — it triggers a
  destructive demo re-seed. (Production uses the clean seed path; demo only.)
- Keep CouchDB/Postgres bound to `127.0.0.1` (already configured) — reached only
  via the TLS proxy.

---

See `docs/DEPLOYMENT-AND-ROLLOUT.md` for the full runbook and `docs/KEYS.md` for
what each credential is.
