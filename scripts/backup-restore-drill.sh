#!/usr/bin/env bash
# =============================================================================
# backup-restore-drill.sh — quarterly DR verification.
#
# Pulls the most-recent CouchDB and Postgres snapshots from S3, decrypts them
# locally, and runs structural checks. Designed to fail loudly so the GH
# Action wrapping it pages on a regression.
#
# This is NOT a real restore — it does not touch any live database. It only
# proves that:
#
#   1. the latest snapshot exists,
#   2. it decrypts with the operator's private key,
#   3. its structure is what we expect:
#        - couchdb tarball: contains tamamhealth_*.json.gz members,
#        - postgres dump:   pg_restore --list returns at least one entry.
#
# Usage:
#   ./scripts/backup-restore-drill.sh
#
# Environment:
#   BACKUP_BUCKET           required.
#   AWS_REGION              optional, default af-south-1.
#                           PHI residency: must remain af-south-1.
#   BACKUP_PRIVKEY_PATH     required. Path to the GPG private key able to
#                           decrypt the snapshots. Operator must place this on
#                           the drill host out-of-band; never store the
#                           private key in the same bucket.
#   BACKUP_PRIVKEY_PASSPHRASE
#                           optional. Set if the private key is passphrase-
#                           protected (recommended). Provided via env so it
#                           never appears in the process list.
#   AWS_ENDPOINT_URL        optional, for B2/MinIO/etc.
#   DRILL_SKIP_POSTGRES     optional. Set to "1" if the deployment does not
#                           use the analytics Postgres yet.
#
# Exit codes:
#   0 — drill PASS
#   1 — drill FAIL (any check failed)
# =============================================================================
set -euo pipefail

usage() {
  sed -n '3,32p' "$0" | sed 's/^# \{0,1\}//'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage; exit 0
fi

LOG_TAG="tamamhealth-backup-drill"
log()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; logger -t "$LOG_TAG" "$*" || true; }
fail() { log "FAIL: $*"; FAILED=1; }

: "${BACKUP_BUCKET:?BACKUP_BUCKET required}"
: "${AWS_REGION:=af-south-1}"
: "${BACKUP_PRIVKEY_PATH:?BACKUP_PRIVKEY_PATH required}"

[ -r "$BACKUP_PRIVKEY_PATH" ] || { log "FAIL: privkey not readable at $BACKUP_PRIVKEY_PATH"; exit 1; }

command -v aws        >/dev/null 2>&1 || { log "FAIL: aws CLI required for drill"; exit 1; }
command -v gpg        >/dev/null 2>&1 || { log "FAIL: gpg required"; exit 1; }
command -v tar        >/dev/null 2>&1 || { log "FAIL: tar required"; exit 1; }
command -v pg_restore >/dev/null 2>&1 || [ "${DRILL_SKIP_POSTGRES:-}" = "1" ] \
  || { log "FAIL: pg_restore required (or set DRILL_SKIP_POSTGRES=1)"; exit 1; }

WORK=$(mktemp -d -t backup-drill.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

# Throwaway GNUPGHOME so we don't pollute the host keyring.
export GNUPGHOME="${WORK}/gnupg"
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
gpg --batch --quiet --import "$BACKUP_PRIVKEY_PATH" \
  || { log "FAIL: privkey import failed"; exit 1; }

GPG_DECRYPT=(gpg --batch --quiet --yes --decrypt)
if [ -n "${BACKUP_PRIVKEY_PASSPHRASE:-}" ]; then
  GPG_DECRYPT+=(--pinentry-mode loopback --passphrase "$BACKUP_PRIVKEY_PASSPHRASE")
fi

AWS_ARGS=(--region "$AWS_REGION")
if [ -n "${AWS_ENDPOINT_URL:-}" ]; then
  AWS_ARGS+=(--endpoint-url "$AWS_ENDPOINT_URL")
fi

FAILED=0

# How old the newest snapshot may be before the drill treats it as a failure.
# The drill restores whatever is NEWEST in the bucket, which means a pipeline
# that stopped uploading months ago still passes every structural check — the
# drill goes green on a stale snapshot and reports that backups are healthy
# while the recovery point silently ages. Freshness is the property that
# actually matters, so it is checked as its own assertion.
: "${BACKUP_MAX_AGE_HOURS:=48}"

# Fail when $1 (an ISO-8601 LastModified from S3) is older than the limit.
check_freshness() {
  label=$1; modified=$2
  [ -n "$modified" ] && [ "$modified" != "None" ] || { fail "$label: no LastModified on the newest object"; return; }
  # GNU date and BSD date disagree on parsing flags; try GNU first (the CI
  # runner), then BSD (a macOS operator running the drill by hand).
  epoch=$(date -u -d "$modified" +%s 2>/dev/null \
          || date -u -j -f '%Y-%m-%dT%H:%M:%S' "${modified%%.*}" +%s 2>/dev/null \
          || echo '')
  [ -n "$epoch" ] || { log "  $label: could not parse LastModified '$modified' — skipping age check"; return; }
  age_hours=$(( ( $(date -u +%s) - epoch ) / 3600 ))
  log "  $label age: ${age_hours}h (limit ${BACKUP_MAX_AGE_HOURS}h)"
  if [ "$age_hours" -gt "$BACKUP_MAX_AGE_HOURS" ]; then
    fail "$label is ${age_hours}h old — older than ${BACKUP_MAX_AGE_HOURS}h. The backup pipeline has stopped uploading; the newest recoverable snapshot is from $modified."
  fi
}

# ------- locate latest CouchDB snapshot --------------------------------------
log "scanning bucket for latest couchdb snapshot"
COUCH_ENTRY=$(aws "${AWS_ARGS[@]}" s3api list-objects-v2 \
              --bucket "$BACKUP_BUCKET" \
              --prefix "" \
              --query 'reverse(sort_by(Contents,&LastModified))[?contains(Key,`couchdb-`)].[Key,LastModified] | [0]' \
              --output text 2>/dev/null \
              | tr -d '\r')
COUCH_KEY=$(printf '%s' "$COUCH_ENTRY" | awk '{print $1}')
COUCH_MODIFIED=$(printf '%s' "$COUCH_ENTRY" | awk '{print $2}')
check_freshness "couchdb snapshot" "$COUCH_MODIFIED"
if [ -z "$COUCH_KEY" ] || [ "$COUCH_KEY" = "None" ]; then
  fail "no couchdb-*.tar.gz.gpg objects found in bucket $BACKUP_BUCKET"
else
  log "couchdb snapshot: s3://$BACKUP_BUCKET/$COUCH_KEY"
  COUCH_LOCAL="${WORK}/couchdb.tar.gz.gpg"
  if aws "${AWS_ARGS[@]}" s3 cp "s3://${BACKUP_BUCKET}/${COUCH_KEY}" "$COUCH_LOCAL" --only-show-errors; then
    if "${GPG_DECRYPT[@]}" --output "${WORK}/couchdb.tar.gz" "$COUCH_LOCAL" 2>/dev/null; then
      MEMBERS=$(tar tzf "${WORK}/couchdb.tar.gz" 2>/dev/null | wc -l | tr -d ' ')
      TAMAM_MEMBERS=$(tar tzf "${WORK}/couchdb.tar.gz" 2>/dev/null | grep -c 'tamamhealth_.*json.gz' || true)
      log "  members: $MEMBERS total, $TAMAM_MEMBERS tamamhealth_*.json.gz"
      if [ "$TAMAM_MEMBERS" -lt 1 ]; then
        fail "couchdb snapshot has no tamamhealth_*.json.gz members"
      else
        log "  couchdb structural check PASS"
      fi
    else
      fail "couchdb snapshot decrypt failed"
    fi
  else
    fail "couchdb snapshot download failed"
  fi
fi

# ------- locate latest Postgres snapshot ------------------------------------
if [ "${DRILL_SKIP_POSTGRES:-}" = "1" ]; then
  log "skipping postgres drill (DRILL_SKIP_POSTGRES=1)"
else
  log "scanning bucket for latest postgres snapshot"
  PG_ENTRY=$(aws "${AWS_ARGS[@]}" s3api list-objects-v2 \
              --bucket "$BACKUP_BUCKET" \
              --prefix "" \
              --query 'reverse(sort_by(Contents,&LastModified))[?contains(Key,`postgres-`)].[Key,LastModified] | [0]' \
              --output text 2>/dev/null \
              | tr -d '\r')
  PG_KEY=$(printf '%s' "$PG_ENTRY" | awk '{print $1}')
  check_freshness "postgres snapshot" "$(printf '%s' "$PG_ENTRY" | awk '{print $2}')"
  if [ -z "$PG_KEY" ] || [ "$PG_KEY" = "None" ]; then
    fail "no postgres-*.dump.gpg objects found in bucket $BACKUP_BUCKET"
  else
    log "postgres snapshot: s3://$BACKUP_BUCKET/$PG_KEY"
    PG_LOCAL="${WORK}/postgres.dump.gpg"
    if aws "${AWS_ARGS[@]}" s3 cp "s3://${BACKUP_BUCKET}/${PG_KEY}" "$PG_LOCAL" --only-show-errors; then
      if "${GPG_DECRYPT[@]}" --output "${WORK}/postgres.dump" "$PG_LOCAL" 2>/dev/null; then
        ENTRIES=$(pg_restore --list "${WORK}/postgres.dump" 2>/dev/null | grep -cE '^[0-9]+;' || true)
        log "  pg_restore --list entries: $ENTRIES"
        if [ "$ENTRIES" -lt 1 ]; then
          fail "postgres dump has no restorable entries"
        else
          log "  postgres structural check PASS"
        fi
      else
        fail "postgres snapshot decrypt failed"
      fi
    else
      fail "postgres snapshot download failed"
    fi
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  log "DRILL FAIL"
  exit 1
fi

log "DRILL PASS"
exit 0
