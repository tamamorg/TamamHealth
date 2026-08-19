# Backups & disaster recovery

> **Audience:** TamamHealth platform operators.
> **Status:** Authoritative. Replaces the legacy "backups live in
> `/var/lib/docker/volumes/tamamhealth_couchdb_backups/_data` on the same
> host" pattern.
>
> **PHI residency:** all backups MUST land in an `af-south-1` (Cape Town) S3
> bucket OR a Backblaze B2 region whose data plane is contractually pinned to
> South Africa / EU. Never `aws s3 cp` to `us-east-1`.

---

## What gets backed up

| Source                | Frequency | Tool                              | Destination key                                                |
|-----------------------|-----------|-----------------------------------|----------------------------------------------------------------|
| CouchDB (clinical)    | Daily     | `scripts/backup-couchdb.sh`       | `s3://$BUCKET/YYYY/MM/DD/couchdb-$HOST-HHMM.tar.gz.gpg`        |
| Postgres (analytics)  | Daily     | `scripts/backup-postgres.sh`      | `s3://$BUCKET/YYYY/MM/DD/postgres-$HOST-HHMM.dump.gpg`         |
| Restore drill         | Quarterly | `.github/workflows/backups-cron.yml` (calls `backup-restore-drill.sh`) | n/a (read-only) |

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

We strongly prefer S3 in `af-south-1` over Backblaze B2 because:

- residency is contractually exact (af-south-1 is Cape Town only),
- IAM is more granular,
- the rest of the platform's infra is already in af-south-1.

Choose B2 only if cost is the binding constraint AND you have explicit sign-
off that B2's `eu-central` region is acceptable for South Sudan PHI.

#### S3 (af-south-1) setup

```bash
# In a SEPARATE AWS account from the production deploy. Cross-account
# isolation is the entire point — a compromised prod account must not be
# able to delete its own backups.
aws --region af-south-1 s3api create-bucket \
    --bucket tamamhealth-backups-prod \
    --create-bucket-configuration LocationConstraint=af-south-1

# Block all public access (defense in depth — bucket policy below also
# denies, but the account-level toggle is the belt-and-braces).
aws s3api put-public-access-block \
    --bucket tamamhealth-backups-prod \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Encryption at rest with SSE-S3 (object-level GPG is our primary defense;
# SSE-S3 is the second layer).
aws s3api put-bucket-encryption \
    --bucket tamamhealth-backups-prod \
    --server-side-encryption-configuration '{
      "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]
    }'

# Versioning + 30-day MFA-delete window so accidental / malicious deletes are
# recoverable.
aws s3api put-bucket-versioning \
    --bucket tamamhealth-backups-prod \
    --versioning-configuration Status=Enabled

# Lifecycle: keep 30 days hot, transition to GLACIER, expire at 2 years.
aws s3api put-bucket-lifecycle-configuration \
    --bucket tamamhealth-backups-prod \
    --lifecycle-configuration file://lifecycle.json
# (see lifecycle.json template in this file's "Lifecycle template" section.)

# Object-lock (compliance mode) prevents both root and IAM from deleting
# under-retention objects. Once enabled, this is irreversible — only enable
# after testing that you can still write.
aws s3api put-object-lock-configuration \
    --bucket tamamhealth-backups-prod \
    --object-lock-configuration '{
      "ObjectLockEnabled":"Enabled",
      "Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Days":35}}
    }'
```

##### Lifecycle template

```json
{
  "Rules": [
    {
      "ID": "transition-to-glacier-after-30d",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Transitions": [{"Days": 30, "StorageClass": "GLACIER"}],
      "Expiration": {"Days": 730}
    }
  ]
}
```

##### IAM policy for the prod-host writer

The production host needs **write-only** to the bucket — never delete, never
list cross-account. This minimises blast radius.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PutBackupsOnly",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:PutObjectAcl"],
      "Resource": "arn:aws:s3:::tamamhealth-backups-prod/*"
    },
    {
      "Sid": "HeadOwnUploads",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:GetObjectVersion"],
      "Resource": "arn:aws:s3:::tamamhealth-backups-prod/*"
    }
  ]
}
```

The drill IAM (used by the GitHub Action) gets `s3:GetObject` + `s3:ListBucket`
+ `s3:GetObjectVersion`, no put / delete.

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
AWS_REGION=af-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
# Backblaze B2 / MinIO only:
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

### 4. Wire the quarterly drill

The drill GitHub Action (`.github/workflows/backups-cron.yml`) runs every
quarter and pages on failure. Required secrets on the `production`
environment:

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — drill IAM (read-only).
- `AWS_REGION` (`af-south-1`).
- `BACKUP_BUCKET`.
- `BACKUP_PRIVKEY_GPG` — paste the full `gpg --armor --export-secret-keys`
  block.
- `BACKUP_PRIVKEY_PASSPHRASE` — separate secret.

Wire repo / org notification settings to email + Slack so a failed cron is
noticed within the same business day. (Cron at 03:00 UTC = 06:00 EAT, so the
notification arrives at the start of the operator's day.)

---

## Disaster recovery — full restore

> Practice this every six months on a non-production host. The runbook only
> works if the operator has done it once before.

### Scenario: prod host is gone, restore to a fresh af-south-1 EC2

1. **Stand up an empty replacement** following `infra/aws/scripts/cutover.md`
   step 1–4. CouchDB and Postgres should be running but empty.

2. **Pull the most recent CouchDB snapshot:**

   ```bash
   export AWS_REGION=af-south-1
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

4. **Replay into CouchDB:**

   ```bash
   for f in ./restore/*/tamamhealth_*.json.gz; do
     db=$(basename "$f" .json.gz)
     # create the db
     curl -X PUT "http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@localhost:5984/${db}"
     # bulk_docs upload (un-gzip and reformat the _all_docs payload to bulk_docs)
     gunzip -c "$f" | jq '{docs: [.rows[].doc] }' | \
       curl -sf -X POST -H 'Content-Type: application/json' \
       --data-binary @- \
       "http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@localhost:5984/${db}/_bulk_docs"
   done
   ```

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

7. **Cut DNS over** per `infra/aws/scripts/cutover.md`.

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
