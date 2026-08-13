#!/usr/bin/env bash
#
# Assemble infra/digitalocean/app-platform/terraform.tfvars.
#
# The eight production secrets were stored in Vercel as `sensitive`, which is
# write-only — no CLI, API, or dashboard can read them back. This script
# reconstructs the file from the places each value actually still exists, and
# refuses to invent the one value that cannot be regenerated.
#
# It prints only names, lengths, and provenance. Never values.
#
#   ./assemble-tfvars.sh            # plan only, writes nothing
#   ./assemble-tfvars.sh --write    # write terraform.tfvars (mode 600)
#
# Required in the environment (not recoverable from the droplet):
#   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
#       Vercel → Storage → your KV store. Rotate there if you cannot read them.
# Optional overrides, otherwise freshly generated:
#   JWT_SECRET, AIRTEL_WEBHOOK_SECRET, MPESA_WEBHOOK_SECRET
# Required ONLY if the live CouchDB already holds encrypted PHI:
#   PHI_ENCRYPTION_KEY   (the escrowed key — a new one orphans existing records)

set -euo pipefail

DROPLET="${DROPLET:-root@164.92.196.189}"
PG_CLUSTER="${PG_CLUSTER:-91243895-3e91-48c3-9c9d-9bd2ca2be34a}"
OUT="$(cd "$(dirname "$0")" && pwd)/terraform.tfvars"
WRITE=false
[[ "${1:-}" == "--write" ]] && WRITE=true

die() { printf '\nFAILED: %s\n' "$*" >&2; exit 1; }
note() { printf '  %-26s %s\n' "$1" "$2"; }
gen()  { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48; }

# --- 1. Reach the droplet -----------------------------------------------------
echo "==> Droplet"
ssh -o ConnectTimeout=8 -o BatchMode=yes "$DROPLET" true 2>/dev/null \
  || die "cannot SSH to $DROPLET. Add your key via the DigitalOcean droplet console first."
note "ssh" "ok"

# The compose stack is started with --env-file .env.data; older notes say .env.
ENV_REMOTE=""
for candidate in /opt/tamamhealth/.env.data /opt/tamamhealth/.env; do
  if ssh -o BatchMode=yes "$DROPLET" "test -r $candidate" 2>/dev/null; then ENV_REMOTE="$candidate"; break; fi
done
[[ -n "$ENV_REMOTE" ]] || die "no readable /opt/tamamhealth/.env.data or .env on the droplet."
note "env file" "$ENV_REMOTE"

# Extraction runs remotely from a quoted heredoc: building a nested
# grep|cut|tr pipeline inside a double-quoted ssh argument mangles the quotes
# needed to strip surrounding "' characters from a value.
remote_var() {
  ssh -o BatchMode=yes "$DROPLET" bash -s -- "$1" "$ENV_REMOTE" <<'REMOTE' 2>/dev/null || true
set -eu
name="$1"; file="$2"
line="$(grep -m1 "^${name}=" "$file" 2>/dev/null || true)"
[ -n "$line" ] || exit 0
value="${line#*=}"
value="${value%\"}"; value="${value#\"}"
value="${value%\'}"; value="${value#\'}"
printf '%s' "$value" | tr -d '\r'
REMOTE
}

COUCHDB_ADMIN_USER="$(remote_var COUCHDB_USER)"
COUCHDB_ADMIN_PASSWORD="$(remote_var COUCHDB_PASSWORD)"
COUCHDB_WEBHOOK_SECRET="${COUCHDB_WEBHOOK_SECRET:-$(remote_var COUCHDB_WEBHOOK_SECRET)}"

[[ -n "$COUCHDB_ADMIN_USER" ]]     || die "COUCHDB_USER not found in $ENV_REMOTE"
[[ -n "$COUCHDB_ADMIN_PASSWORD" ]] || die "COUCHDB_PASSWORD not found in $ENV_REMOTE"
[[ -n "$COUCHDB_WEBHOOK_SECRET" ]] || die "COUCHDB_WEBHOOK_SECRET not found; set it in the environment to rotate both sides."

# --- 2. Does the live CouchDB already hold encrypted PHI? ---------------------
# Ciphertext is self-describing: `enc:v1:<iv>:<tag>:<ct>` (src/lib/field-encryption.ts).
# Sampling documents is evidence, not proof — it cannot see a field that happens
# to be absent from every sampled document, so the summary says so plainly.
echo "==> Encrypted PHI probe"
ENCRYPTED_HITS="$(ssh -o BatchMode=yes "$DROPLET" bash -s -- \
  "$COUCHDB_ADMIN_USER" "$COUCHDB_ADMIN_PASSWORD" <<'REMOTE' 2>/dev/null || echo "probe-failed"
set -euo pipefail
U="$1"; P="$2"; BASE="http://127.0.0.1:5984"
hits=0
for db in $(curl -sS -u "$U:$P" "$BASE/_all_dbs" | tr -d '[]"' | tr ',' '\n' | grep '^tamamhealth_' || true); do
  n=$(curl -sS -u "$U:$P" "$BASE/$db/_all_docs?include_docs=true&limit=200" | grep -c 'enc:v1:' || true)
  hits=$((hits + n))
done
echo "$hits"
REMOTE
)"

ENCRYPTED_HITS="$(printf '%s' "$ENCRYPTED_HITS" | tr -dc '0-9a-z-')"
if [[ "$ENCRYPTED_HITS" == "probe-failed" || -z "$ENCRYPTED_HITS" ]]; then
  die "could not query CouchDB on the droplet — resolve before deciding the PHI key."
fi
note "documents with enc:v1:" "$ENCRYPTED_HITS (sampled, 200 docs/database)"

if [[ "$ENCRYPTED_HITS" -gt 0 ]]; then
  [[ -n "${PHI_ENCRYPTION_KEY:-}" ]] || die \
"the live CouchDB already holds encrypted PHI ($ENCRYPTED_HITS documents).
A new key would leave those records permanently unreadable, so this script will
not generate one. Supply the escrowed key:  PHI_ENCRYPTION_KEY=... $0 --write"
  PHI_SOURCE="escrowed (supplied)"
else
  PHI_ENCRYPTION_KEY="${PHI_ENCRYPTION_KEY:-$(openssl rand -base64 32)}"
  PHI_SOURCE="generated — no encrypted PHI found; escrow this key now"
fi

# --- 3. Everything else -------------------------------------------------------
echo "==> Remaining values"
: "${UPSTASH_REDIS_REST_URL:?set it from Vercel -> Storage -> KV store}"
: "${UPSTASH_REDIS_REST_TOKEN:?set it from Vercel -> Storage -> KV store}"

if [[ -n "${JWT_SECRET:-}" ]]; then JWT_SOURCE="supplied"; else JWT_SOURCE="generated"; JWT_SECRET="$(gen)"; fi
AIRTEL_WEBHOOK_SECRET="${AIRTEL_WEBHOOK_SECRET:-$(gen)}"
MPESA_WEBHOOK_SECRET="${MPESA_WEBHOOK_SECRET:-$(gen)}"
COUCHDB_GATEWAY_SECRET="${COUCHDB_GATEWAY_SECRET:-$(gen)}"
DATABASE_CA_CERT_BASE64="$(doctl databases get-ca "$PG_CLUSTER" --format Certificate --no-header | tr -d '\n')"
[[ -n "$DATABASE_CA_CERT_BASE64" ]] || die "doctl could not fetch the Postgres CA certificate."

# --- 4. Validate against the app's own fail-closed rules ----------------------
# Same thresholds as src/lib/config-validation.ts, so a bad value is caught here
# rather than by an instance that refuses to boot after apply.
echo "==> Validation"
fail=0
check() { # name value min
  local n=$1 v=$2 min=$3
  if [[ ${#v} -lt $min ]]; then printf '  BAD  %-26s %d chars, need >= %d\n' "$n" "${#v}" "$min"; fail=1
  elif [[ "$v" =~ (REPLACE|CHANGE|PLACEHOLDER|ChangeMe|PASTE_) ]]; then printf '  BAD  %-26s looks like a placeholder\n' "$n"; fail=1
  else printf '  ok   %-26s %d chars\n' "$n" "${#v}"; fi
}
check JWT_SECRET               "$JWT_SECRET"               32
check COUCHDB_ADMIN_PASSWORD   "$COUCHDB_ADMIN_PASSWORD"   20
check COUCHDB_GATEWAY_SECRET   "$COUCHDB_GATEWAY_SECRET"   32
check COUCHDB_WEBHOOK_SECRET   "$COUCHDB_WEBHOOK_SECRET"   32
check AIRTEL_WEBHOOK_SECRET    "$AIRTEL_WEBHOOK_SECRET"    32
check MPESA_WEBHOOK_SECRET     "$MPESA_WEBHOOK_SECRET"     32
check UPSTASH_REDIS_REST_TOKEN "$UPSTASH_REDIS_REST_TOKEN" 8

# PHI key must decode to exactly 32 bytes (AES-256).
# BSD base64 (macOS) spells the decode flag -D on older releases, GNU uses -d.
b64d() { base64 -d 2>/dev/null || base64 -D 2>/dev/null; }
phi_bytes=$(printf '%s' "$PHI_ENCRYPTION_KEY" | b64d | wc -c | tr -d ' ')
if [[ "$phi_bytes" != "32" ]]; then
  printf '  BAD  %-26s decodes to %s bytes, need exactly 32\n' PHI_ENCRYPTION_KEY "$phi_bytes"; fail=1
else
  printf '  ok   %-26s decodes to 32 bytes — %s\n' PHI_ENCRYPTION_KEY "$PHI_SOURCE"
fi
printf '  ok   %-26s %d chars\n' DATABASE_CA_CERT_BASE64 "${#DATABASE_CA_CERT_BASE64}"
printf '  --   %-26s %s\n' COUCHDB_ADMIN_USER "$COUCHDB_ADMIN_USER (from droplet)"
printf '  --   %-26s %s\n' JWT_SECRET "$JWT_SOURCE"

[[ $fail -eq 0 ]] || die "one or more values would be rejected at boot."

# --- 5. Write ------------------------------------------------------------------
if [[ "$WRITE" != true ]]; then
  printf '\nPlan only. Nothing written. Re-run with --write to create:\n  %s\n' "$OUT"
  exit 0
fi

umask 077
cat > "$OUT" <<EOF
# Generated by assemble-tfvars.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Gitignored.
# CouchDB credentials came from $ENV_REMOTE on the data droplet.
# PHI_ENCRYPTION_KEY: $PHI_SOURCE
runtime_secrets = {
  JWT_SECRET               = "$JWT_SECRET"
  PHI_ENCRYPTION_KEY       = "$PHI_ENCRYPTION_KEY"
  COUCHDB_ADMIN_USER       = "$COUCHDB_ADMIN_USER"
  COUCHDB_ADMIN_PASSWORD   = "$COUCHDB_ADMIN_PASSWORD"
  COUCHDB_GATEWAY_SECRET   = "$COUCHDB_GATEWAY_SECRET"
  COUCHDB_WEBHOOK_SECRET   = "$COUCHDB_WEBHOOK_SECRET"
  DATABASE_CA_CERT_BASE64  = "$DATABASE_CA_CERT_BASE64"
  UPSTASH_REDIS_REST_URL   = "$UPSTASH_REDIS_REST_URL"
  UPSTASH_REDIS_REST_TOKEN = "$UPSTASH_REDIS_REST_TOKEN"
  AIRTEL_WEBHOOK_SECRET    = "$AIRTEL_WEBHOOK_SECRET"
  MPESA_WEBHOOK_SECRET     = "$MPESA_WEBHOOK_SECRET"
}
EOF
chmod 600 "$OUT"
printf '\nWrote %s (mode 600).\n' "$OUT"
# Deliberately an if, not `[[ ... ]] && ...`: under `set -e` a false test as a
# bare statement exits non-zero, which would report failure after a good write.
if [[ "$PHI_SOURCE" == generated* ]]; then
  printf 'ESCROW THE PHI KEY NOW — it is not stored anywhere else.\n'
fi
exit 0
