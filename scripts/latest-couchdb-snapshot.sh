#!/usr/bin/env bash
# =============================================================================
# Print the newest complete snapshot in an extracted CouchDB backup volume.
#
# An offsite tarball holds the whole volume: one directory per dump, up to 14
# days of them, named by UTC time so they sort by age. A dump that failed to
# verify is kept with a .INCOMPLETE marker, but a killed dump leaves no marker,
# so only a manifest that closed with no failures counts as complete.
#
# Usage: ./scripts/latest-couchdb-snapshot.sh <extracted-volume-dir>
# Exit codes: 0, the path is on stdout; 1, no complete snapshot exists.
# =============================================================================
set -euo pipefail

ROOT=${1:-}
[ -n "$ROOT" ] && [ -d "$ROOT" ] || { echo "usage: $0 <extracted-volume-dir>" >&2; exit 1; }

while IFS= read -r dir; do
  if [ -e "${dir}/.INCOMPLETE" ] || ! grep -q '"failures":0}' "${dir}/manifest.json" 2>/dev/null; then
    echo "skipping incomplete snapshot $(basename "$dir")" >&2
    continue
  fi
  # A dump that could not list the databases still closes cleanly, with only
  # the system ones in it.
  if [ -n "$(find "$dir" -type f -name 'tamamhealth_*.json.gz' -print -quit)" ]; then
    printf '%s\n' "$dir"
    exit 0
  fi
done < <(find "$ROOT" -mindepth 1 -maxdepth 1 -type d \
  -name '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z' | sort -r)

echo "no complete snapshot under $ROOT" >&2
exit 1
