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
  tamamhealth_adjustments
  tamamhealth_anc
  tamamhealth_announcements
  tamamhealth_appointments
  tamamhealth_assessments
  tamamhealth_assets
  tamamhealth_audit_log
  tamamhealth_availability
  tamamhealth_billing
  tamamhealth_biometric_templates
  tamamhealth_births
  tamamhealth_blood_bank
  tamamhealth_booking_policies
  tamamhealth_charges
  tamamhealth_claims
  tamamhealth_clinical_favorites
  tamamhealth_clinical_notes
  tamamhealth_clinician_tasks
  tamamhealth_conflict_queue
  tamamhealth_consultation_progress
  tamamhealth_consultation_templates
  tamamhealth_controlled_substance_log
  tamamhealth_conversations
  tamamhealth_deaths
  tamamhealth_disease_alerts
  tamamhealth_eligibility_checks
  tamamhealth_emergency_plans
  tamamhealth_encounters
  tamamhealth_facility_assessments
  tamamhealth_facility_census
  tamamhealth_fee_schedule
  tamamhealth_follow_ups
  tamamhealth_handoffs
  tamamhealth_hospitals
  tamamhealth_immunizations
  tamamhealth_insurance_policies
  tamamhealth_invoices
  tamamhealth_lab_results
  tamamhealth_leave_requests
  tamamhealth_ledger
  tamamhealth_medical_records
  tamamhealth_messages
  tamamhealth_meta
  tamamhealth_nutrition_screenings
  tamamhealth_nutrition_supplies
  tamamhealth_order_sets
  tamamhealth_organizations
  tamamhealth_patient_documents
  tamamhealth_patient_feedback
  tamamhealth_patient_notes
  tamamhealth_patient_reminders
  tamamhealth_patient_transfers
  tamamhealth_patients
  tamamhealth_payment_plans
  tamamhealth_payments
  tamamhealth_payroll_entries
  tamamhealth_pharmacy_inventory
  tamamhealth_phone_notes
  tamamhealth_platform_config
  tamamhealth_prescriptions
  tamamhealth_problems
  tamamhealth_procedures
  tamamhealth_program_enrollments
  tamamhealth_provider_profiles
  tamamhealth_provider_reviews
  tamamhealth_referrals
  tamamhealth_refunds
  tamamhealth_saved_payment_methods
  tamamhealth_slot_holds
  tamamhealth_staff_schedules
  tamamhealth_sync_events
  tamamhealth_telehealth
  tamamhealth_text_shortcuts
  tamamhealth_triage
  tamamhealth_usage_events
  tamamhealth_users
  tamamhealth_visit_reasons
  tamamhealth_wards
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

# ---------- 3. Install server-side write validation and DB security ---------
# Server-side tenancy enforcement. The client-side sync filter in
# sync-service.ts can be bypassed by a tampered PouchDB; the validate_doc_update
# function below runs inside CouchDB on every write and rejects docs missing
# or mismatching orgId. See platform/scripts/install-validate-doc-updates.mjs.
echo ""
echo "--- Installing validate_doc_update design docs (org-scoping enforcement)..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TSX_PACKAGE="${SCRIPT_DIR}/../node_modules/tsx"
if command -v node > /dev/null 2>&1 && [ -d "$TSX_PACKAGE" ]; then
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
  COUCHDB_URL="$COUCHDB_URL_NOAUTH" node --import tsx "${SCRIPT_DIR}/install-validate-doc-updates.mjs" || \
    echo "  WARN: validate_doc_update install reported errors (see above)."
else
  echo "  SKIP: node/tsx unavailable. Run 'npm ci && npm run setup:couchdb:validators' from platform/."
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
echo "Server-side validation and _security policies installed."
echo ""
echo "Next steps:"
echo "  1. Set NEXT_PUBLIC_COUCHDB_URL in .env.local"
echo "  2. Set NEXT_PUBLIC_SYNC_ENABLED=true"
echo "  3. Restart the Next.js dev server"
echo ""
