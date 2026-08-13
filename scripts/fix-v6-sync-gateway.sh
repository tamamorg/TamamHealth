#!/usr/bin/env bash
# One-off correction for the tamamhealth-v6 Vercel deployment.
#
# Problem: the deployed client bundle was built without the sync-gateway flags,
# so PouchDB replicates straight against https://couch.tamamhealth.org. The
# production CouchDB answers unauthenticated requests with
# 401 + `WWW-Authenticate: Basic` (require_valid_user = true in
# infra/digitalocean/couchdb-local.ini), which makes the browser throw its
# native Sign-in dialog. CORS also only allows staging.tamamhealth.org, so
# direct browser sync can never work from the Vercel origin.
#
# Fix: rebuild with the same-origin /api/couch gateway enabled so the browser
# only ever talks to its own origin. Sync stays degraded (502 from the
# gateway) until COUCHDB_ADMIN_PASSWORD is replaced with the real value from
# the data droplet (/opt/tamamhealth/.env.data, COUCHDB_PASSWORD) — after
# that, update the env var and `vercel redeploy`; no code change needed.
set -euo pipefail

PLATFORM_DIR="$(cd "$(dirname "$0")/../platform" && pwd)"
ORIGIN="https://tamamhealth-v6.vercel.app"

cd "$PLATFORM_DIR"

# platform/ is normally linked to tamamhealth-v7 — remember it, restore at the end.
LINK_BACKUP="$(mktemp)"
cp .vercel/project.json "$LINK_BACKUP" 2>/dev/null || true

vercel link --yes --project tamamhealth-v6 >/dev/null

printf 'true' | vercel env add NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED production --force
printf 'true' | vercel env add NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED production --force
printf '%s' "$ORIGIN/api/couch" | vercel env add NEXT_PUBLIC_COUCHDB_URL production --force
printf '%s' "$ORIGIN" | vercel env add NEXT_PUBLIC_APP_URL production --force
openssl rand -hex 24 | tr -d '\n' | vercel env add COUCHDB_GATEWAY_SECRET production --force

vercel deploy --prod --yes

echo
echo "Verifying $ORIGIN ..."
curl -s -o /dev/null -w "  home:             %{http_code}  (expect 200)\n" "$ORIGIN/"
curl -s -o /dev/null -w "  /api/health:      %{http_code}  (503 'degraded' is expected until CouchDB admin creds are fixed; 500 means boot validation refused — see below)\n" "$ORIGIN/api/health"
curl -s -o /dev/null -w "  /api/couch probe: %{http_code}  (expect 401 = gateway on, auth required; 404 = flag missing)\n" "$ORIGIN/api/couch/tamamhealth_patients"
echo
echo "If /api/health returns 500: run 'vercel logs $ORIGIN' to see the"
echo "'PRODUCTION STARTUP REFUSED' validation errors, and 'vercel rollback'"
echo "(while still linked to tamamhealth-v6) to restore the previous deployment."

# Restore the tamamhealth-v7 link
if [ -s "$LINK_BACKUP" ]; then
  cp "$LINK_BACKUP" .vercel/project.json
  echo "Restored platform/.vercel link to tamamhealth-v7."
fi
