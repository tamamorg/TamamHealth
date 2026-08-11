#!/usr/bin/env bash
# =============================================================================
# SafeguardJunub — CouchDB Setup Script
# =============================================================================
# Creates all databases, design documents, and CORS configuration.
#
# Usage:
#   COUCHDB_URL=http://admin:password@localhost:5984 ./scripts/setup-couchdb.sh
#
# Requirements: curl, bash
# =============================================================================

set -euo pipefail

COUCHDB_URL="${COUCHDB_URL:-http://admin:password@localhost:5984}"

# Strip trailing slash
COUCHDB_URL="${COUCHDB_URL%/}"

echo "=== SafeguardJunub CouchDB Setup ==="
echo "Server: ${COUCHDB_URL//:*@/://***@}"
echo ""

# ---------- 1. Verify connectivity ----------
echo "--- Checking CouchDB connectivity..."
if ! curl -sf "${COUCHDB_URL}/" > /dev/null 2>&1; then
  echo "ERROR: Cannot connect to CouchDB at ${COUCHDB_URL//:*@/://***@}"
  echo "Make sure CouchDB is running and credentials are correct."
  exit 1
fi
echo "OK: CouchDB is reachable."

# ---------- 1b. Create CouchDB system databases ----------
# CouchDB does not auto-create _users / _replicator / _global_changes on first
# install. _users is required for per-user authentication (POST /_session
# checks credentials against this DB), so we create it before anything else.
echo ""
echo "--- Creating CouchDB system databases..."
for sys_db in _users _replicator _global_changes; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${COUCHDB_URL}/${sys_db}" 2>/dev/null)
  case "$status" in
    201) echo "  Created: ${sys_db}" ;;
    412) echo "  Exists:  ${sys_db}" ;;
    *)   echo "  WARN:    ${sys_db} (HTTP ${status})" ;;
  esac
done

# ---------- 2. Create databases ----------
DATABASES=(
  tamamhealth_users
  tamamhealth_account_requests
  tamamhealth_patients
  tamamhealth_hospitals
  tamamhealth_medical_records
  tamamhealth_referrals
  tamamhealth_lab_results
  tamamhealth_disease_alerts
  tamamhealth_prescriptions
  tamamhealth_audit_log
  tamamhealth_messages
  tamamhealth_births
  tamamhealth_deaths
  tamamhealth_facility_assessments
  tamamhealth_immunizations
  tamamhealth_anc
  tamamhealth_boma_visits
  tamamhealth_follow_ups
  tamamhealth_organizations
  tamamhealth_platform_config
  tamamhealth_meta
)

echo ""
echo "--- Creating databases..."
for db in "${DATABASES[@]}"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${COUCHDB_URL}/${db}" 2>/dev/null)
  case "$status" in
    201) echo "  Created: ${db}" ;;
    412) echo "  Exists:  ${db}" ;;
    *)   echo "  WARN:    ${db} (HTTP ${status})" ;;
  esac
done

# ---------- 3. Create design documents for filtered replication ----------
echo ""
echo "--- Installing design documents..."

# Org-scoped filter: only replicate documents matching the user's orgId
ORG_FILTER_DOC='{
  "_id": "_design/sync",
  "filters": {
    "by_org": "function(doc, req) { if (doc._id.indexOf(\"_design/\") === 0) return true; if (!doc.orgId) return true; return doc.orgId === req.query.orgId; }"
  }
}'

# Databases that use org-scoped filtering
ORG_SCOPED_DBS=(
  tamamhealth_patients
  tamamhealth_medical_records
  tamamhealth_referrals
  tamamhealth_lab_results
  tamamhealth_prescriptions
  tamamhealth_messages
  tamamhealth_births
  tamamhealth_deaths
  tamamhealth_facility_assessments
  tamamhealth_immunizations
  tamamhealth_anc
  tamamhealth_boma_visits
  tamamhealth_follow_ups
  tamamhealth_hospitals
  tamamhealth_users
  tamamhealth_audit_log
)

for db in "${ORG_SCOPED_DBS[@]}"; do
  # Delete old design doc if it exists (ignore errors)
  curl -sf -X DELETE "${COUCHDB_URL}/${db}/_design/sync?rev=$(curl -sf "${COUCHDB_URL}/${db}/_design/sync" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("_rev",""))' 2>/dev/null)" > /dev/null 2>&1 || true

  status=$(curl -sf -o /dev/null -w "%{http_code}" -X PUT \
    -H "Content-Type: application/json" \
    -d "${ORG_FILTER_DOC}" \
    "${COUCHDB_URL}/${db}/_design/sync" 2>/dev/null || echo "000")
  case "$status" in
    201) echo "  Design doc installed: ${db}/_design/sync" ;;
    409) echo "  Design doc exists:    ${db}/_design/sync" ;;
    *)   echo "  WARN: ${db}/_design/sync (HTTP ${status})" ;;
  esac
done

# ---------- 3b. Install org-scoping validate_doc_update design docs ----------
# Server-side tenancy enforcement. The client-side sync filter in
# sync-service.ts can be bypassed by a tampered PouchDB; the validate_doc_update
# function below runs inside CouchDB on every write and rejects docs missing
# or mismatching orgId. See platform/scripts/install-validate-doc-updates.mjs.
echo ""
echo "--- Installing validate_doc_update design docs (org-scoping enforcement)..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if command -v node > /dev/null 2>&1; then
  # Derive admin user/pass from the COUCHDB_URL (user:pass@host) for the
  # node script, which reads COUCHDB_ADMIN_USER / COUCHDB_ADMIN_PASSWORD.
  _userinfo="${COUCHDB_URL#*://}"
  _userinfo="${_userinfo%%@*}"
  if [[ "$_userinfo" == *:* ]]; then
    COUCHDB_ADMIN_USER="${COUCHDB_ADMIN_USER:-${_userinfo%%:*}}"
    COUCHDB_ADMIN_PASSWORD="${COUCHDB_ADMIN_PASSWORD:-${_userinfo#*:}}"
    export COUCHDB_ADMIN_USER COUCHDB_ADMIN_PASSWORD
  fi
  # Strip embedded creds so the node script's basic-auth header is the one used.
  _host_only="${COUCHDB_URL#*://}"
  _host_only="${_host_only#*@}"
  _scheme="${COUCHDB_URL%%://*}"
  COUCHDB_URL_NOAUTH="${_scheme}://${_host_only}"
  COUCHDB_URL="$COUCHDB_URL_NOAUTH" node "${SCRIPT_DIR}/install-validate-doc-updates.mjs" || \
    echo "  WARN: validate_doc_update install reported errors (see above)."
else
  echo "  SKIP: node not found on PATH. Run 'node platform/scripts/install-validate-doc-updates.mjs' manually."
fi

# ---------- 4. Configure CORS ----------
echo ""
echo "--- Configuring CORS..."

# Enable CORS globally
curl -sf -X PUT "${COUCHDB_URL}/_node/_local/_config/httpd/enable_cors" \
  -H "Content-Type: application/json" \
  -d '"true"' > /dev/null 2>&1

# Credentialed CouchDB sessions must never use a wildcard origin. Supply a
# comma-separated allowlist, for example:
#   COUCHDB_CORS_ORIGINS=https://app.example.org
# Local development may explicitly opt into a wildcard with
# ALLOW_INSECURE_CORS=true, but production setup refuses it.
CORS_ORIGINS="${COUCHDB_CORS_ORIGINS:-${NEXT_PUBLIC_APP_URL:-}}"
if [[ -z "$CORS_ORIGINS" ]]; then
  echo "ERROR: Set COUCHDB_CORS_ORIGINS (comma-separated HTTPS app origins) before configuring CouchDB CORS."
  exit 1
fi
if [[ "$CORS_ORIGINS" == "*" && "${ALLOW_INSECURE_CORS:-false}" != "true" ]]; then
  echo "ERROR: Refusing wildcard CouchDB CORS with credentialed sessions. Set explicit COUCHDB_CORS_ORIGINS."
  exit 1
fi
curl -sf -X PUT "${COUCHDB_URL}/_node/_local/_config/cors/origins" \
  -H "Content-Type: application/json" \
  -d "\"${CORS_ORIGINS}\"" > /dev/null 2>&1

# Allow credentials
curl -sf -X PUT "${COUCHDB_URL}/_node/_local/_config/cors/credentials" \
  -H "Content-Type: application/json" \
  -d '"true"' > /dev/null 2>&1

# Allow necessary headers
curl -sf -X PUT "${COUCHDB_URL}/_node/_local/_config/cors/headers" \
  -H "Content-Type: application/json" \
  -d '"accept, authorization, content-type, origin, referer"' > /dev/null 2>&1

# Allow necessary methods
curl -sf -X PUT "${COUCHDB_URL}/_node/_local/_config/cors/methods" \
  -H "Content-Type: application/json" \
  -d '"GET, PUT, POST, HEAD, DELETE"' > /dev/null 2>&1

echo "OK: CORS configured."

# ---------- 4b. Session lifetime ----------
# Align the CouchDB AuthSession cookie lifetime with the platform's 8h JWT.
# The default (600s) makes browser replication die with 401s ten minutes into
# every session; couch-client-auth.ts renews sessions in-memory, but the
# baseline timeout must still cover a page reload mid-shift.
echo ""
echo "--- Configuring session timeout (8h)..."
curl -sf -X PUT "${COUCHDB_URL}/_node/_local/_config/chttpd_auth/timeout" \
  -H "Content-Type: application/json" \
  -d '"28800"' > /dev/null 2>&1 || \
curl -sf -X PUT "${COUCHDB_URL}/_node/_local/_config/couch_httpd_auth/timeout" \
  -H "Content-Type: application/json" \
  -d '"28800"' > /dev/null 2>&1
echo "OK: session timeout configured."

# ---------- 5. Summary ----------
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Databases created: ${#DATABASES[@]}"
echo "Design docs installed: ${#ORG_SCOPED_DBS[@]}"
echo ""
echo "Next steps:"
echo "  1. Set NEXT_PUBLIC_COUCHDB_URL in .env.local"
echo "  2. Set NEXT_PUBLIC_SYNC_ENABLED=true"
echo "  3. Restart the Next.js dev server"
echo ""
