# Backups & disaster recovery

> **Audience:** TamamHealth platform operators.
> **Status:** Authoritative. Replaces the legacy "backups live in
> `/var/lib/docker/volumes/tamamhealth_couchdb_backups/_data` on the same
> host" pattern.
>
> **PHI residency:** backups MUST land in an EU DigitalOcean Spaces region
> (`fra1` is the default; `ams3` is acceptable), or a Backblaze B2 region
> contractually pinned the same way. Never `nyc3`, `sfo3` or any other US
> region. DigitalOcean has no African region, so storing backups outside Africa
> is a decision taken knowingly and must be covered by the hosting agreement.

---

## What gets backed up

| Source                | Frequency | Tool                              | Destination key                                                |
|-----------------------|-----------|-----------------------------------|----------------------------------------------------------------|
| CouchDB (clinical)    | Daily     | `scripts/backup-couchdb.sh`       | `s3://$BUCKET/YYYY/MM/DD/couchdb-$HOST-HHMM.tar.gz.gpg`        |
| Postgres (analytics)  | Daily     | `scripts/backup-postgres.sh`      | `s3://$BUCKET/YYYY/MM/DD/postgres-$HOST-HHMM.dump.gpg`         |
| Restore drill         | Weekly    | `.github/workflows/backups-cron.yml` (calls `backup-restore-drill.sh`) | n/a (read-only) |

**What is NOT backed up here, and why:**

- `platform/.env.production` — secrets live in Doppler now (see
  `docs/operations/secrets.md`). The file should not exist on the host.
- `couchdb_data` raw volume — we back up the dumped JSON instead because (a)
  it's portable across CouchDB versions, (b) it's smaller, and (c) it does
  not require a CouchDB cold-stop to be consistent.
- Container images — already on GHCR, immutable, retagged not rebuilt.

---

## One-time setup

### 1. Generate the backup GPG keypair

The backup pipeline encrypts every snapshot with an asymmetric GPG key. The
**public** key sits on every backup-producing host; the **private** key sits
in 1Password and on the (offline) DR laptop. The private key never goes near
the production host — that way, even if the prod host is fully compromised,
the attacker cannot read the offsite snapshots.

```bash
# On a clean, offline laptop (e.g. live-USB Tails recommended for long-term
# key custody, but any audited workstation is acceptable for bootstrap):
gpg --batch --gen-key <<EOF
%echo Generating TamamHealth backup key
Key-Type: RSA
Key-Length: 4096
Subkey-Type: RSA
Subkey-Length: 4096
Name-Real: TamamHealth Backup
Name-Email: support.tamam@gmail.com
Expire-Date: 2y
Passphrase: <strong, generated, stored in 1Password>
%commit
EOF

# Export public key (for the production host)
gpg --armor --export support.tamam@gmail.com > backup-pubkey.gpg

# Export private key (for 1Password vault + offline backup)
gpg --armor --export-secret-keys support.tamam@gmail.com > backup-privkey.asc
```

Store:

- `backup-pubkey.gpg` -> production host at `/etc/tamamhealth/backup-pubkey.gpg`
  (mode 0644, root-owned; it's a PUBLIC key — readable is fine).
- `backup-privkey.asc` -> 1Password "TamamHealth > DR > backup-privkey" AND a
  printed/encrypted USB stored in a physical safe.
- `BACKUP_PRIVKEY_PASSPHRASE` -> 1Password adjacent to the private key, AND
  separately in the GitHub Actions `production` environment secrets so the
  quarterly drill can run.

Rotate the keypair every 24 months. Set a calendar reminder; GPG also encodes
an expiry date so the operator gets a forced reminder.

### 2. Create the offsite bucket

Production is a DigitalOcean droplet, so the offsite destination is a
DigitalOcean Space. Backblaze B2 is a fallback if cost is the binding
constraint and you have explicit sign-off for its region. The `AWS_*` variable
names and the `aws` CLI used by the scripts are only the S3-compatible client
for Spaces; this is Spaces, not AWS, and no AWS account is involved.

#### DigitalOcean Spaces setup (this deployment)

The platform runs on a DigitalOcean droplet, so its object storage is Spaces.
Spaces speaks the S3 API. `AWS_REGION` defaults to `fra1` and `AWS_ENDPOINT_URL`
defaults to `https://<AWS_REGION>.digitaloceanspaces.com` in `backup-couchdb.sh`,
`backup-postgres.sh` and `backup-restore-drill.sh`. No AWS account is needed.

1. **Create the Space.** Control panel → Spaces Object Storage → Create.
   Region `fra1` (see the residency note at the top), name
   `tamamhealth-backups-prod`, file listing **restricted**.

2. **Create a Spaces access key.** API → Spaces Keys → Generate New Key. The
   secret is shown once. Save both to 1Password.

3. **Point the tooling at it.** These are the values (the first two are the
   defaults, shown so they are explicit):

   ```bash
   AWS_ENDPOINT_URL=https://fra1.digitaloceanspaces.com
   AWS_REGION=fra1
   BACKUP_BUCKET=tamamhealth-backups-prod
   ```

**Two protections you do NOT get on Spaces, and what to do instead.** Both are
real losses relative to AWS S3, not paperwork:

- **No object-lock.** The S3-style compliance-mode retention cannot be
  reproduced, so a stolen or mistakenly-scoped key CAN delete the backups it
  can write. Mitigate by keeping the drill's key separate from the host's
  writer key, and ideally in a separate DO team, so one compromise does not
  reach both.
- **No bucket versioning.** An overwrite is final. The daily key layout
  (`YYYY/MM/DD/…-HHMM…`) already makes same-key overwrites unlikely, which is
  why this is survivable — but it is the only thing standing in for versioning,
  so do not "tidy" that scheme into a fixed filename.

Spaces lifecycle rules handle expiry; set them in the control panel to match
a two-year retention.

#### Backblaze B2 setup (if chosen)

1. Create an "Application Key" scoped to a single bucket, capabilities
   `writeFiles` only. Save the keyId/applicationKey into the host
   `/etc/tamamhealth/b2.env` (mode 0600).
2. Set `AWS_ENDPOINT_URL=https://s3.eu-central-003.backblazeb2.com` and
   `AWS_REGION=eu-central-003`. The scripts will use the aws CLI with the
   custom endpoint — B2's S3-compatible API supports `s3 cp` and HEAD.
3. Note: B2 object-lock support is regional and was rolling out at time of
   writing; verify before going live.

### 3. Schedule the host-side cron jobs

Don't hand-write systemd units for this — the repo already ships hardened
ones (`infra/systemd/tamamhealth-offsite-backup.{service,timer}` and
`tamamhealth-offsite-postgres-backup.{service,timer}`, sandboxed with
`ProtectSystem=strict` and friends) and an installer that checks every
prerequisite before touching `/etc/systemd/system`:

```bash
# As root, from the repo root on the host:
sudo ./scripts/install-offsite-backup.sh
```

It checks for `gpg`, the AWS CLI (or `BACKUP_HTTP_PUT_URL` as a fallback),
`/etc/tamamhealth/backup-pubkey.gpg`, and `/etc/tamamhealth/backup.env` before
installing anything, and tells you exactly what's missing rather than failing
partway through. Create `/etc/tamamhealth/backup.env` first (mode 0600,
root-owned):

```sh
BACKUP_BUCKET=tamamhealth-backups-prod
DATABASE_URL=postgresql://backup-user:password@private-host:25060/tamamhealth?sslmode=require
# DigitalOcean Spaces, not AWS: the AWS_* names are the S3-compatible client settings.
AWS_REGION=fra1
AWS_ENDPOINT_URL=https://fra1.digitaloceanspaces.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# Backblaze B2 / MinIO instead of Spaces:
# AWS_ENDPOINT_URL=https://s3.eu-central-003.backblazeb2.com
BACKUP_PUBKEY_PATH=/etc/tamamhealth/backup-pubkey.gpg
```

Timing is deliberately staggered so nothing races the in-container dump: the
`couchdb-backup` service inside `docker-compose.yml` writes its local dump at
02:15 UTC; `tamamhealth-offsite-backup.timer` ships it off-site at **03:30
UTC**; `tamamhealth-offsite-postgres-backup.timer` runs at **04:15 UTC**. Both
carry `RandomizedDelaySec=15min` (so a fleet of facility nodes doesn't hit the
bucket in lockstep) and `Persistent=true` (a droplet that was powered off at
fire-time runs the missed backup on next boot instead of skipping the night).

`install-offsite-backup.sh` enables both timers for you; verify immediately
rather than trusting it silently:

```bash
sudo systemctl list-timers tamamhealth-offsite-backup.timer tamamhealth-offsite-postgres-backup.timer
sudo systemctl start tamamhealth-offsite-backup.service
journalctl -u tamamhealth-offsite-backup.service -n 50 --no-pager
sudo systemctl start tamamhealth-offsite-postgres-backup.service
journalctl -u tamamhealth-offsite-postgres-backup.service -n 50 --no-pager
```

### 4. Wire the weekly drill

The drill GitHub Action (`.github/workflows/backups-cron.yml`) runs every
Monday at 03:00 UTC and opens/updates a `[automation]` issue on failure.

**The secrets go on the `production-cron` environment, NOT `production`.** This
document said `production` for months and the drill has never read a secret set
there: `production` carries required reviewers, so a scheduled job pointed at it
sits waiting for approval until the next run supersedes and cancels it. The job
uses a separate, ungated environment for exactly that reason — see the note on
the job in the workflow.

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — the drill's credentials.
  Spaces keys cannot be scoped read-only, so keep the drill's key separate from the host's writer key.
- `AWS_REGION` — optional, defaults to `fra1` (DO Spaces).
- `AWS_ENDPOINT_URL` — optional, defaults to `https://<AWS_REGION>.digitaloceanspaces.com`; set it only for B2 / MinIO.
- `BACKUP_BUCKET`.
- `BACKUP_PRIVKEY_GPG` — paste the full `gpg --armor --export-secret-keys`
  block.
- `BACKUP_PRIVKEY_PASSPHRASE` — separate secret.

```bash
gh secret set BACKUP_PRIVKEY_GPG        --env production-cron < backup-privkey.asc
gh secret set BACKUP_PRIVKEY_PASSPHRASE --env production-cron
gh secret set BACKUP_BUCKET             --env production-cron
gh secret set AWS_ACCESS_KEY_ID         --env production-cron
gh secret set AWS_SECRET_ACCESS_KEY     --env production-cron
gh secret set AWS_REGION                --env production-cron
gh secret set AWS_ENDPOINT_URL          --env production-cron   # optional: B2 / MinIO only
```

**The drill restores; it does not produce.** Until the host-side timers in step
3 are installed and have uploaded at least one snapshot, a fully-provisioned
drill still fails — correctly, because there is nothing to restore. Confirm an
object exists under `YYYY/MM/DD/` before reading a red drill as a secrets
problem.

**Never commit the private key.** `backup-privkey.asc` in the repository root
is git-ignored, and the public key beside it is not; that asymmetry is the
whole design. A private key in the history would be readable by everyone with
clone access and by every CI runner — the exact exposure the offsite encryption
exists to prevent.

Wire repo / org notification settings to email + Slack so a failed cron is
noticed within the same business day. (Cron at 03:00 UTC = 06:00 EAT, so the
notification arrives at the start of the operator's day.)

---

## Disaster recovery — full restore

> Practice this every six months on a non-production host. The runbook only
> works if the operator has done it once before.

### Scenario: prod host is gone, restore to a fresh DigitalOcean droplet

1. **Stand up an empty replacement droplet** following
   `docs/DEPLOY-DIGITALOCEAN.md` and `infra/digitalocean/README.md`. CouchDB and
   Postgres should be running but empty.

2. **Pull the most recent CouchDB snapshot:**

   ```bash
   export AWS_REGION=fra1
   export AWS_ENDPOINT_URL=https://fra1.digitaloceanspaces.com
   LATEST=$(aws s3api list-objects-v2 \
     --bucket tamamhealth-backups-prod \
     --prefix "$(date -u +%Y/%m)" \
     --query 'reverse(sort_by(Contents,&LastModified))[?contains(Key,`couchdb-`)].Key | [0]' \
     --output text)
   aws s3 cp "s3://tamamhealth-backups-prod/${LATEST}" ./snapshot.tar.gz.gpg
   ```

3. **Decrypt** (private key + passphrase from 1Password):

   ```bash
   gpg --import backup-privkey.asc
   gpg --output snapshot.tar.gz --decrypt snapshot.tar.gz.gpg
   tar xzf snapshot.tar.gz -C ./restore/
   ```

4. **Replay into CouchDB** with the restore script — the same one the weekly
   drill runs, so this step is rehearsed every week:

   ```bash
   RESTORE_COUCHDB_URL=http://localhost:5984 \
   RESTORE_COUCHDB_USER="$COUCHDB_USER" RESTORE_COUCHDB_PASSWORD="$COUCHDB_PASSWORD" \
     ./scripts/restore-couchdb-dump.sh ./restore/
   ```

   It creates each database, replays the documents at their original
   revisions, then counts what the target holds against what the dump
   contains and exits non-zero on any gap. It refuses to write into a database
   that already has documents.

   Do not replay the dump by hand with a bare `_bulk_docs` post. Every dumped
   document carries its `_rev`, and without `new_edits: false` CouchDB answers
   `conflict` for each one — under HTTP 201, so `curl -f` does not notice. The
   restore "succeeds" with zero documents. This runbook carried exactly that
   command until 2026-10-08 (verified against CouchDB 3.5).

   The dump is taken with `_all_docs`, which records only the winning revision
   of each document. Unresolved conflict revisions are not in it and are not
   restored.

5. **Replay Postgres:**

   ```bash
   LATEST_PG=$(aws s3api list-objects-v2 \
     --bucket tamamhealth-backups-prod \
     --query 'reverse(sort_by(Contents,&LastModified))[?contains(Key,`postgres-`)].Key | [0]' \
     --output text)
   aws s3 cp "s3://tamamhealth-backups-prod/${LATEST_PG}" ./postgres.dump.gpg
   gpg --output postgres.dump --decrypt postgres.dump.gpg
   pg_restore --no-owner --no-acl --clean --if-exists \
              --dbname "$DATABASE_URL" postgres.dump
   ```

6. **Verify** — log into the platform UI, run a few end-to-end smoke checks
   (patient list loads, encounter creation, billing report). Compare row
   counts of `tamamhealth_patients` and `tamamhealth_encounters` to the
   pre-disaster monitoring graphs.

7. **Cut DNS over** to the new droplet's (reserved) IP.

Expected RTO: ~3 hours from key restore to DNS cutover for a clinic with
<10k patient records. Expected RPO: 24h - last successful nightly backup.

---

## Operator gotcha (read this twice)

**The GPG public key on the production host has no passphrase requirement —
that's the design.** The host encrypts to it without human interaction. The
**private** key, with passphrase, is the only thing that can decrypt
backups, and it lives off the production host. Two failure modes:

1. **You stored the private key on the production host so the script could
   "verify" backups.** This kills the entire threat model: a compromised
   prod host now decrypts its own backups. Don't. Verification belongs in
   the GitHub Actions drill, where the privkey lives in encrypted-at-rest
   GitHub secrets and the runner is ephemeral.

2. **You forgot the passphrase.** Without it, the snapshots are crypto-
   shredded. The passphrase MUST live in 1Password AND in
   `BACKUP_PRIVKEY_PASSPHRASE` GitHub secret AND in a printed envelope in a
   physical safe. Three independent copies. If any one of them is your only
   copy, you have a single point of failure for clinical data recovery.

The single most likely incident: an operator generates the keypair, stores
the private key in 1Password, then forgets to also save the passphrase as a
separate item — 1Password's UI suggests using its own auto-generated
passphrase for the "GPG key" item type but doesn't enforce that the operator
remembers to record it. **Verify the passphrase works against an exported
copy of the privkey on a fresh laptop within 24h of generation.**
