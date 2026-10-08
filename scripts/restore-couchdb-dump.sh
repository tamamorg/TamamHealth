#!/usr/bin/env bash
# =============================================================================
# restore-couchdb-dump.sh — replay a CouchDB dump into a CouchDB server, and
# prove that it arrived.
#
# Restores every `<database>.json.gz` under a dump directory (the format
# `dump-couchdb.sh` writes: one `_all_docs?include_docs=true` response per
# database). Used by the restore runbook (docs/operations/backups.md) and by
# the weekly drill, so the procedure that is rehearsed is the procedure that
# would be run.
#
# Two things the previous, hand-typed procedure got wrong, both silently:
#
#   1. It posted the documents without `new_edits: false`. Every dumped
#      document carries its `_rev`; without the flag CouchDB reads that as
#      "update the revision I already hold", finds none in an empty database,
#      and answers `conflict` for each one — under HTTP 201. The restore
#      "succeeded" with zero documents.
#   2. It never counted. This script compares what the target holds against
#      what the dump contains, per database, and exits non-zero on any gap.
#
# It refuses to write into a database that already contains documents, so it
# cannot be pointed at a live server by mistake (RESTORE_ALLOW_NONEMPTY=1 to
# override, e.g. to resume an interrupted restore).
#
# Not restored: unresolved conflict revisions. `_all_docs` records only the
# winning revision of each document.
#
# Usage:
#   RESTORE_COUCHDB_URL=http://localhost:5984 \
#   RESTORE_COUCHDB_USER=admin RESTORE_COUCHDB_PASSWORD=... \
#     ./scripts/restore-couchdb-dump.sh <dump-dir>
#
# Environment:
#   RESTORE_COUCHDB_URL        required. The TARGET server.
#   RESTORE_COUCHDB_USER       required. An admin on the target.
#   RESTORE_COUCHDB_PASSWORD   required.
#   RESTORE_ALLOW_NONEMPTY     optional. "1" to write into non-empty databases.
#   RESTORE_BATCH_SIZE         optional, default 500 documents per request.
#
# Exit codes: 0 — every database restored and counted; 1 — anything else.
# =============================================================================
set -euo pipefail

DUMP_DIR=${1:-}
[ -n "$DUMP_DIR" ] && [ -d "$DUMP_DIR" ] || { echo "usage: $0 <dump-dir>" >&2; exit 1; }
: "${RESTORE_COUCHDB_URL:?RESTORE_COUCHDB_URL required (the TARGET server)}"
: "${RESTORE_COUCHDB_USER:?RESTORE_COUCHDB_USER required}"
: "${RESTORE_COUCHDB_PASSWORD:?RESTORE_COUCHDB_PASSWORD required}"
: "${RESTORE_BATCH_SIZE:=500}"
command -v jq   >/dev/null 2>&1 || { echo "jq required" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl required" >&2; exit 1; }

BASE=${RESTORE_COUCHDB_URL%/}
log() { echo "[restore] $*"; }

# Credentials go through a curl config on a private fd, never the process list.
couch() { # couch <method> <path> [--data-binary @file]
  method=$1; path=$2; shift 2
  curl -sS --config <(printf 'user = "%s:%s"\n' "$RESTORE_COUCHDB_USER" "$RESTORE_COUCHDB_PASSWORD") \
       -X "$method" -H 'Content-Type: application/json' "$@" "${BASE}${path}"
}

FAILURES=0
RESTORED=0
WORK=$(mktemp -d -t couch-restore.XXXXXX)
trap 'rm -rf "$WORK"' EXIT

FILES=$(find "$DUMP_DIR" -type f -name '*.json.gz' | sort)
[ -n "$FILES" ] || { log "no *.json.gz dumps under $DUMP_DIR"; exit 1; }

for f in $FILES; do
  db=$(basename "$f" .json.gz)
  enc=$(jq -rn --arg v "$db" '$v|@uri')

  want=$(gzip -dc "$f" | jq '.rows | length' 2>/dev/null || echo invalid)
  if [ "$want" = "invalid" ] || [ -z "$want" ]; then
    log "FAIL ${db}: dump is not valid JSON"; FAILURES=$((FAILURES + 1)); continue
  fi

  couch PUT "/${enc}" >/dev/null   # 412 when it already exists; checked next
  before=$(couch GET "/${enc}/_all_docs?limit=0" | jq -r '.total_rows // "missing"')
  if [ "$before" = "missing" ]; then
    log "FAIL ${db}: could not create or open the database on the target"; FAILURES=$((FAILURES + 1)); continue
  fi
  # System databases ship with their own design documents; anything else must be empty.
  case "$db" in _*) system=1 ;; *) system=0 ;; esac
  if [ "$system" = 0 ] && [ "$before" != "0" ] && [ "${RESTORE_ALLOW_NONEMPTY:-}" != "1" ]; then
    log "FAIL ${db}: target already holds ${before} document(s) — refusing to restore over it"
    FAILURES=$((FAILURES + 1)); continue
  fi

  refused=0
  gzip -dc "$f" | jq -c --argjson n "$RESTORE_BATCH_SIZE" \
      '[.rows[].doc | select(. != null)] | range(0; length; $n) as $i | {new_edits: false, docs: .[$i:$i+$n]}' \
      > "${WORK}/batches.ndjson"
  while IFS= read -r batch; do
    printf '%s' "$batch" > "${WORK}/batch.json"
    result=$(couch POST "/${enc}/_bulk_docs" --data-binary "@${WORK}/batch.json")
    # With new_edits:false an accepted batch answers with an empty array;
    # anything else names the documents that were refused.
    if [ "$(printf '%s' "$result" | jq -r 'if type == "array" then length else "error" end' 2>/dev/null)" != "0" ]; then
      refused=1
      log "FAIL ${db}: $(printf '%s' "$result" | head -c 400)"
    fi
  done < "${WORK}/batches.ndjson"

  got=$(couch GET "/${enc}/_all_docs?limit=0" | jq -r '.total_rows // "missing"')
  if [ "$refused" = 1 ]; then
    FAILURES=$((FAILURES + 1))
  elif [ "$got" = "missing" ] || [ "$got" -lt "$want" ] || { [ "$system" = 0 ] && [ "${RESTORE_ALLOW_NONEMPTY:-}" != "1" ] && [ "$got" != "$want" ]; }; then
    log "FAIL ${db}: dump holds ${want} document(s), target holds ${got}"
    FAILURES=$((FAILURES + 1))
  else
    log "ok   ${db}: ${got} document(s)"
    RESTORED=$((RESTORED + 1))
  fi
done

if [ "$FAILURES" -gt 0 ]; then
  log "RESTORE INCOMPLETE — ${FAILURES} database(s) failed, ${RESTORED} restored."
  exit 1
fi
log "restore complete and counted — ${RESTORED} database(s)."
