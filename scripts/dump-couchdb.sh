#!/bin/sh
# CouchDB backup script — runs nightly from the couchdb-backup service.
#
# Dumps every tamamhealth_* database to gzipped JSON on the shared volume,
# VERIFIES each dump against the live database, records the replication
# checkpoint, then prunes anything older than BACKUP_RETAIN_DAYS.
#
# Two things this does that a plain `_all_docs` dump did not:
#
#   1. Captures the `update_seq` checkpoint per database. `_all_docs` alone
#      discards the CouchDB _changes sequence, so a restored server has no
#      resume point — every PouchDB client reconnecting after a restore
#      re-replicates its entire database from scratch. Over a 10-50 Kbps
#      satellite link that is hours per facility, during which the clinic is
#      effectively offline. The checkpoint is what makes incremental resume
#      possible.
#
#   2. Verifies the dump. Previously a truncated or empty dump was written,
#      logged as success, and eventually rotated away — the failure surfaced
#      only at restore time, which is the worst possible moment to find it.
#
# NOTE on `couchbackup`: the ticket suggested the official CLI. It is a Node
# package, and this container is alpine + curl + jq by design (small, no npm at
# runtime). Adding a Node toolchain to the backup sidecar is a bigger change
# than the problem warrants, so we capture the checkpoint and verify the dump
# directly against the same HTTP API couchbackup drives. Swap the dump step for
# `couchbackup` if a Node base image is ever adopted here.
set -eu

: "${COUCHDB_USER:?COUCHDB_USER required}"
: "${COUCHDB_PASSWORD:?COUCHDB_PASSWORD required}"
: "${COUCHDB_HOST:=couchdb}"
: "${COUCHDB_PORT:=5984}"
: "${BACKUP_RETAIN_DAYS:=14}"
# Tolerated shortfall between live doc_count and dumped rows, as a percentage.
# Non-zero because a write landing mid-dump is normal, not a failure.
: "${BACKUP_VERIFY_TOLERANCE_PCT:=1}"

BASE="http://${COUCHDB_HOST}:${COUCHDB_PORT}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/backups/${STAMP}"
mkdir -p "$OUT"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Keep credentials out of URLs so special characters are handled correctly and
# curl errors can never echo an authenticated URL into the backup log.
couch_get() {
  curl --silent --show-error --fail --user "${COUCHDB_USER}:${COUCHDB_PASSWORD}" "${BASE}$1"
}

log "starting CouchDB backup → $OUT"

FAILURES=0
MANIFEST="${OUT}/manifest.json"
echo '{"startedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","databases":[' > "$MANIFEST"
FIRST=1

# Every tamamhealth_* db (clinical + meta + outbox + conflicts), including the
# per-organization tenant databases, which carry the same prefix.
#
# Plus two system databases that the prefix filter misses and a restore cannot
# work without:
#
#   _users       every provisioned CouchDB identity. Without it, no browser can
#                authenticate to replicate after a restore, and each user has to
#                be re-provisioned by signing in again.
#   _replicator  the continuous tenant <-> aggregate replication jobs. Without
#                them the shared aggregates stop receiving tenant writes and the
#                analytics pipeline goes quietly stale — the sync-worker keeps
#                polling an aggregate that no longer updates and reports no
#                error at all.
#
# Both are recoverable by re-running `provisionOrganizationDatabases` per org,
# but only if somebody knows to. Backing them up makes the restore complete
# instead of merely plausible.
#
# Iterating a `for` over command substitution rather than piping into `while`:
# a piped subshell cannot mutate FAILURES in the parent, so failures were
# invisible to the exit status.
SYSTEM_DBS="_users _replicator"
for db in $(couch_get '/_all_dbs' | jq -r '.[]' | grep '^tamamhealth_') $SYSTEM_DBS; do
  log "  dumping $db"

  # Read live state BEFORE dumping, so the recorded checkpoint is never ahead
  # of the data it describes. A checkpoint newer than the dump would silently
  # skip documents on an incremental restore.
  if ! INFO=$(couch_get "/${db}"); then
    log "  ERROR: could not read ${db} info"
    FAILURES=$((FAILURES + 1))
    continue
  fi
  LIVE_COUNT=$(echo "$INFO" | jq -r '.doc_count')
  UPDATE_SEQ=$(echo "$INFO" | jq -r '.update_seq')

  if ! couch_get "/${db}/_all_docs?include_docs=true" | gzip -c > "${OUT}/${db}.json.gz"; then
    log "  ERROR: dump failed for ${db}"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  # --- Verification -------------------------------------------------------
  # Count rows actually present in the gzipped file, not what we intended to
  # write. This also proves the gzip stream and JSON are both intact.
  DUMPED=$(gzip -dc "${OUT}/${db}.json.gz" | jq -r '.rows | length' 2>/dev/null || echo "invalid")
  if [ "$DUMPED" = "invalid" ] || [ -z "$DUMPED" ]; then
    log "  ERROR: ${db} dump is not valid JSON — treating as failed"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  # _all_docs includes design documents, which doc_count excludes, so the dump
  # is normally >= doc_count. Only a SHORTFALL indicates data loss.
  if [ "$LIVE_COUNT" -gt 0 ]; then
    ALLOWED_MISSING=$(( LIVE_COUNT * BACKUP_VERIFY_TOLERANCE_PCT / 100 ))
    MIN_ACCEPTABLE=$(( LIVE_COUNT - ALLOWED_MISSING ))
    if [ "$DUMPED" -lt "$MIN_ACCEPTABLE" ]; then
      log "  ERROR: ${db} verification FAILED — dumped ${DUMPED} rows, live doc_count ${LIVE_COUNT} (min acceptable ${MIN_ACCEPTABLE})"
      FAILURES=$((FAILURES + 1))
      continue
    fi
  fi
  log "  ok ${db}: ${DUMPED} rows (live ${LIVE_COUNT}), checkpoint ${UPDATE_SEQ}"

  [ $FIRST -eq 0 ] && echo ',' >> "$MANIFEST"
  FIRST=0
  printf '{"db":"%s","docCount":%s,"dumpedRows":%s,"updateSeq":%s}' \
    "$db" "$LIVE_COUNT" "$DUMPED" "$(echo "$UPDATE_SEQ" | jq -R .)" >> "$MANIFEST"
done

echo '],"failures":'"$FAILURES"'}' >> "$MANIFEST"

if [ "$FAILURES" -gt 0 ]; then
  log "BACKUP FAILED — ${FAILURES} database(s) did not verify. Snapshot ${STAMP} is NOT trustworthy."
  # Mark the directory so a restore never silently picks it up, and so
  # retention below refuses to delete the evidence.
  touch "${OUT}/.INCOMPLETE"
  exit 1
fi

log "backup complete and verified — manifest at ${MANIFEST}"

# Prune older snapshots, but never an incomplete one: leaving it on disk keeps
# the failure visible to an operator instead of quietly aging out.
find /backups -maxdepth 1 -type d -name '20*' -mtime +${BACKUP_RETAIN_DAYS} \
  '!' -exec test -e '{}/.INCOMPLETE' ';' -exec rm -rf {} + 2>/dev/null || true

log "retention cleanup done (kept ${BACKUP_RETAIN_DAYS}d)"
