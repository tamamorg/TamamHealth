# Secrets management — Doppler

> **Audience:** TamamHealth platform operators (deploy + on-call).
> **Status:** Authoritative. Replaces the legacy "edit `.env.production` on the
> host" flow.
>
> **PHI residency:** TamamHealth processes Protected Health Information (PHI)
> for South Sudan. The data plane (CouchDB / Postgres / S3 backups) **must**
> stay in `af-south-1` (Cape Town). Doppler is a US/EU-hosted control plane —
> only **secret material** transits Doppler. No PHI ever passes through it. If
> your compliance posture forbids non-residency control planes, see
> "Self-hosted alternative" at the bottom of this page.

---

## Why Doppler

The previous flow stored the JWT secret, CouchDB admin password, Flutterwave
secret hash, etc. as plaintext in `platform/.env.production` on the host. That
file:

- is `chmod 0600` but root-readable on the box,
- gets backed up alongside the app dir,
- is rotated by hand-editing on the live VPS,
- has no audit log,
- has no rotation reminder,
- gets accidentally `scp`-ed during DR drills.

Doppler replaces it with a managed secrets store the platform reads at boot.
Secrets stay encrypted at rest, every read is logged, and rotation becomes a
dashboard click + a service restart.

We chose Doppler over Vault because the operator footprint we have (one ops
engineer, two on-call clinicians) cannot run Vault. Doppler service tokens
give us per-environment scope without managing a quorum.

---

## One-time setup

### 1. Create the Doppler project + configs

```bash
doppler login                              # opens a browser
doppler projects create tamamhealth
doppler configs create dev --project tamamhealth
doppler configs create stg --project tamamhealth
doppler configs create prd --project tamamhealth
```

Three configs, one per environment. **Do not** create a single `prd` config and
share it across staging and prod — service tokens are scoped per config and
sharing one means a leaked staging token can read prod secrets.

### 2. Upload the existing `.env.production`

Run from the repo root:

```bash
./platform/scripts/doppler-bootstrap.sh \
    --project tamamhealth \
    --config prd \
    --file platform/.env.production
```

The script:

- refuses to run if you're not logged in (`doppler me`),
- skips lines that look like comments / blanks,
- ignores keys that match `*_EXAMPLE`, `*_PLACEHOLDER`, `REPLACE-*` values,
- uploads the rest with `doppler secrets upload` to the chosen config.

Verify:

```bash
doppler secrets --project tamamhealth --config prd
```

### 3. Mint a service token per environment

```bash
doppler configs tokens create deploy-prd \
    --project tamamhealth --config prd \
    --max-age 90d \
    --plain
# copy the dp.st.prd.xxxxxxxx... value
```

Repeat for `stg` and `dev` (use 30d for `dev` since dev tokens leak more
easily).

Store the resulting token:

- **Production host:** in the host's environment as `DOPPLER_TOKEN` (e.g.
  `/etc/tamamhealth/doppler.env` mode 0600, sourced by the systemd unit).
- **GitHub Actions:** `DOPPLER_TOKEN_PRD` and `DOPPLER_TOKEN_STG` repository
  secrets, scoped to the matching `production` / `staging` GitHub environment.

### 4. Switch the runtime over

```bash
# On the host:
sudo install -d -m 0700 -o root -g root /etc/tamamhealth
echo "DOPPLER_TOKEN=dp.st.prd.xxxxxxxx" | sudo tee /etc/tamamhealth/doppler.env
sudo chmod 0600 /etc/tamamhealth/doppler.env

# Then in /etc/systemd/system/tamamhealth.service:
#   EnvironmentFile=/etc/tamamhealth/doppler.env
```

Restart the stack. The platform's `instrumentation.ts` calls
`assertDopplerEnv()` (see `platform/src/lib/secrets.ts`); if `DOPPLER_TOKEN` is
set but the critical secrets (`JWT_SECRET`, `DATABASE_URL` if Postgres is
enabled) didn't make it through, boot fails loudly. **This is the desired
behavior** — silent fallback to a half-loaded config is how PHI breaches start.

### 5. Delete `platform/.env.production` from the host

After verifying the platform boots cleanly under Doppler:

```bash
shred -u /opt/tamamhealth/platform/.env.production
shred -u /opt/tamamhealth/platform/.env.production.real.bak  # if present
```

Never run `git rm`. The committed `.env.production.example` is a template — the
real file should never have been committed in the first place; check it isn't.

---

## Runtime — how secrets reach the process

There are two supported modes; the platform supports both so existing VPS
deploys keep working through the cutover.

### Mode A: Legacy `.env_file` (default)

`docker-compose.yml` loads `platform/.env.production` via `env_file:`. The
platform reads `process.env` like always. **Keep this path until you've
verified Mode B end-to-end.**

### Mode B: Doppler-injected (target state)

Set `DOPPLER_TOKEN` in the host shell (or via the systemd `EnvironmentFile`).
`docker-compose.yml` detects it and wraps the platform `command` in
`doppler run --`, which fetches secrets and exports them into the container's
env at start.

The `.env_file` line is still present, so if `DOPPLER_TOKEN` is unset, the
legacy path runs unchanged.

> **Gotcha:** `NEXT_PUBLIC_*` vars are baked into the browser bundle at **build
> time**. Doppler at *runtime* cannot change them. If you rotate a public env,
> you must rebuild the platform image. The example: rotating
> `NEXT_PUBLIC_SENTRY_DSN` requires a redeploy, not just `docker compose
> restart platform`.

---

## Rotation policy

| Secret class                                      | Rotation cadence | Owner    | Method                                    |
|---------------------------------------------------|------------------|----------|-------------------------------------------|
| `JWT_SECRET`                                      | 30 days          | Platform | Doppler dashboard + restart platform      |
| `COUCHDB_PASSWORD`                                | 30 days          | Platform | Doppler + CouchDB user update + restart   |
| `DATABASE_URL` password component                 | 30 days          | Platform | RDS rotate + Doppler update + restart     |
| `COUCHDB_WEBHOOK_SECRET`                          | 30 days          | Platform | Doppler + restart                         |
| `FLUTTERWAVE_SECRET_HASH`                         | 30 days          | Platform | Vendor dashboard rotate, then Doppler     |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` / `SMTP_URL`| 90 days          | Platform | Vendor dashboard rotate, then Doppler     |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`           | 90 days          | Platform | Sentry dashboard + image rebuild          |
| `DOPPLER_TOKEN` (service token)                   | 90 days          | Ops      | `doppler configs tokens create` + redeploy|

**PHI-adjacent secrets** (`JWT_SECRET`, `COUCHDB_PASSWORD`,
`COUCHDB_WEBHOOK_SECRET`, `DATABASE_URL`) rotate on a 30-day cadence because a
leak gives direct read access to clinical data.

**Non-PHI integration keys** (email, error reporting) rotate on 90 days.

Set a Doppler reminder for each — the dashboard supports `Secret > Rotation
schedule`. Do not rely on humans to remember.

---

## Adding a new secret

1. Add it to `platform/.env.production.example` with a `# REPLACE-*` placeholder
   so future operators know it exists.
2. Add it to **all three** Doppler configs (`dev`, `stg`, `prd`):

   ```bash
   doppler secrets set NEW_KEY=value --project tamamhealth --config prd
   ```

3. If it's required at boot under Doppler, add it to the `ALWAYS_REQUIRED` (or
   `CONDITIONALLY_REQUIRED`, if it only matters when another feature is
   enabled) list in `platform/src/lib/secrets.ts` so `assertDopplerEnv()`
   enforces it.

---

## Removing a secret

1. Remove it from the three Doppler configs:

   ```bash
   doppler secrets delete OLD_KEY --project tamamhealth --config prd
   ```

2. Remove the line from `.env.production.example`.
3. Remove any reference in `platform/src/lib/secrets.ts`.
4. Redeploy.

---

## Recovery — Doppler is down

Doppler outage = platform cannot boot if the host has been switched to Mode B
and the secret cache is empty.

Recovery:

1. SSH to the host. Confirm Doppler is the cause:

   ```bash
   doppler secrets --project tamamhealth --config prd
   # if this hangs / errors, Doppler control plane is the issue
   ```

2. Activate the **break-glass file**:

   ```bash
   sudo cp /etc/tamamhealth/break-glass.env.gpg /tmp/.env.production.gpg
   sudo gpg --decrypt /tmp/.env.production.gpg > /opt/tamamhealth/platform/.env.production
   sudo chmod 0600 /opt/tamamhealth/platform/.env.production
   ```

3. Unset `DOPPLER_TOKEN` in the systemd `EnvironmentFile` and restart:

   ```bash
   sudo systemctl restart tamamhealth
   ```

   The platform will boot from the file and `secrets.ts` will no-op because
   `DOPPLER_TOKEN` is unset.

4. After Doppler recovers, re-set `DOPPLER_TOKEN`, restart, **then**
   `shred -u` the recovered `.env.production`.

The break-glass file is a GPG-encrypted snapshot of the prod config, generated
quarterly by the operator and stored on the host plus in `1Password >
TamamHealth > Break-Glass > prod-env-YYYYMM.gpg`. Decrypt key is held by the
on-call lead.

---

## Self-hosted alternative

If your compliance posture cannot accept a US-hosted control plane:

- run `infisical` self-hosted in `af-south-1` on a separate EC2 in the same
  VPC, OR
- run AWS Secrets Manager (also `af-south-1`) and replace the `doppler run`
  wrapper with `aws secretsmanager get-secret-value | export-and-exec`.

The `secrets.ts` helper is provider-agnostic — it only checks for env
presence, so swapping the front-end script does not require code changes.

---

## Operator gotcha (read this twice)

**Doppler service tokens are scoped per-config.** A token minted against `stg`
cannot read `prd` and vice versa. If you copy the staging GitHub Actions
secret into the production environment, the platform will boot, fail to find
`JWT_SECRET`, and refuse to start — the error message will (correctly) blame
"Doppler env not loaded", which sends operators down a rabbit hole when the
real problem is "wrong token in the wrong environment". When you mint a token,
**name it after the config** (`deploy-prd`, `deploy-stg`) and set
`max-age=90d` so it self-expires.
