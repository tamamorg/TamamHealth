#!/usr/bin/env bash
# =============================================================================
# backup-postgres.sh — host-side offsite Postgres backup.
#
# Runs `pg_dump` against the analytics Postgres at $DATABASE_URL, GPG-encrypts
# the resulting custom-format dump, and uploads it to S3 (or any S3-compatible
# store like Backblaze B2 with --endpoint-url).
#
# Usage:
#   ./scripts/backup-postgres.sh
#
# Environment:
#   DATABASE_URL            required. Standard postgres:// connection string.
#                           Managed Postgres must include sslmode=require.
#   BACKUP_BUCKET           required. Bucket name (no s3:// prefix).
#   AWS_REGION              optional, default fra1 (DigitalOcean Spaces region;
#                           the AWS_* names are the S3-compatible client
#                           settings - this is Spaces, not AWS).
#   BACKUP_PUBKEY_PATH      optional, default /etc/tamamhealth/backup-pubkey.gpg
#   AWS_ENDPOINT_URL        optional, default https://$AWS_REGION.digitaloceanspaces.com.
#                           Override for B2 / MinIO / etc.
#   BACKUP_HTTP_PUT_URL     optional. Fallback target if `aws` CLI missing.
#
# Exits non-zero on any failure. Logs to syslog.
# =============================================================================
set -euo pipefail

usage() {
  sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage; exit 0
fi

LOG_TAG="tamamhealth-backup-postgres"
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; logger -t "$LOG_TAG" "$*" || true; }
die() { log "ERROR: $*"; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is required (no s3:// prefix)}"
: "${AWS_REGION:=fra1}"
# DigitalOcean Spaces, not AWS: the AWS_* names are the S3-compatible client settings.
: "${AWS_ENDPOINT_URL:=https://${AWS_REGION}.digitaloceanspaces.com}"
: "${BACKUP_PUBKEY_PATH:=/etc/tamamhealth/backup-pubkey.gpg}"

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not installed (apt install postgresql-client)"
command -v gpg     >/dev/null 2>&1 || die "gpg not installed"
[ -r "$BACKUP_PUBKEY_PATH" ] || die "backup pubkey not readable at $BACKUP_PUBKEY_PATH"

STAMP_DAY=$(date -u +%Y/%m/%d)
STAMP_HM=$(date -u +%H%M)
HOST=$(hostname -s)
OBJECT_KEY="${STAMP_DAY}/postgres-${HOST}-${STAMP_HM}.dump.gpg"

WORK=$(mktemp -d -t backup-postgres.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

DUMP="${WORK}/snapshot.dump"
ENCRYPTED="${WORK}/snapshot.dump.gpg"

log "running pg_dump (custom format) -> $DUMP"
# -Fc = custom format (compressed, restorable with pg_restore).
# Avoid logging $DATABASE_URL: the password is in there.
pg_dump --format=custom --no-owner --no-acl --file "$DUMP" "$DATABASE_URL" \
  || die "pg_dump failed"

DUMP_BYTES=$(wc -c < "$DUMP" | tr -d ' ')
[ "$DUMP_BYTES" -gt 0 ] || die "pg_dump produced empty file"
log "dump OK ($DUMP_BYTES bytes)"

# Throwaway GNUPGHOME so we don't pollute the operator's keyring.
export GNUPGHOME="${WORK}/gnupg"
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
gpg --batch --quiet --import "$BACKUP_PUBKEY_PATH" || die "gpg import failed"

RECIPIENT=$(gpg --list-keys --with-colons | awk -F: '/^uid:/ {print $10; exit}')
[ -n "$RECIPIENT" ] || die "could not extract recipient from pubkey"

log "encrypting -> $ENCRYPTED (recipient: $RECIPIENT)"
gpg --batch --yes --trust-model always \
    --output "$ENCRYPTED" \
    --encrypt --recipient "$RECIPIENT" \
    "$DUMP" \
  || die "gpg encrypt failed"

[ -s "$ENCRYPTED" ] || die "encrypted file is empty"

S3_URI="s3://${BACKUP_BUCKET}/${OBJECT_KEY}"
log "uploading -> $S3_URI"

if command -v aws >/dev/null 2>&1; then
  AWS_ARGS=(--region "$AWS_REGION")
  if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
    AWS_ARGS+=(--endpoint-url "$AWS_ENDPOINT_URL")
  fi
  aws "${AWS_ARGS[@]}" s3 cp \
      --only-show-errors \
      --sse AES256 \
      "$ENCRYPTED" "$S3_URI" \
    || die "aws s3 cp failed"

  aws "${AWS_ARGS[@]}" s3api head-object \
      --bucket "$BACKUP_BUCKET" \
      --key   "$OBJECT_KEY" \
      >/dev/null \
    || die "post-upload HEAD failed; object did NOT land"
else
  log "aws CLI not present; falling back to HTTP PUT"
  : "${BACKUP_HTTP_PUT_URL:?aws CLI missing AND BACKUP_HTTP_PUT_URL not set; cannot upload}"
  command -v curl >/dev/null 2>&1 || die "neither aws nor curl available"
  HTTP_CODE=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --upload-file "$ENCRYPTED" \
      "${BACKUP_HTTP_PUT_URL}/${OBJECT_KEY}" \
    || true)
  case "$HTTP_CODE" in
    200|201|204) log "HTTP PUT OK ($HTTP_CODE)" ;;
    *) die "HTTP PUT returned $HTTP_CODE" ;;
  esac
  HEAD_CODE=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --head "${BACKUP_HTTP_PUT_URL}/${OBJECT_KEY}" \
    || true)
  case "$HEAD_CODE" in
    200) log "HEAD OK" ;;
    *) die "post-upload HEAD returned $HEAD_CODE" ;;
  esac
fi

log "postgres backup complete: $S3_URI"
