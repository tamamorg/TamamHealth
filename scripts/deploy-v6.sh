#!/usr/bin/env bash
# Deploy the current platform/ source to the tamamhealth-v6 Vercel project.
# Assumes project env vars are already correct (set once by
# scripts/fix-v6-sync-gateway.sh). Restores the tamamhealth-v7 link after.
set -euo pipefail

PLATFORM_DIR="$(cd "$(dirname "$0")/../platform" && pwd)"
ORIGIN="https://tamamhealth-v6.vercel.app"

cd "$PLATFORM_DIR"

LINK_BACKUP="$(mktemp)"
cp .vercel/project.json "$LINK_BACKUP" 2>/dev/null || true

vercel link --yes --project tamamhealth-v6 >/dev/null
vercel deploy --prod --yes

echo
echo "Verifying $ORIGIN ..."
curl -s -o /dev/null -w "  /login:           %{http_code}  (expect 200)\n" "$ORIGIN/login"
curl -s -o /dev/null -w "  /signup:          %{http_code}  (expect 307 — the request-account flow was removed)\n" "$ORIGIN/signup"
curl -s -o /dev/null -w "  /api/health:      %{http_code}  (503 'degraded' expected until CouchDB admin creds are fixed)\n" "$ORIGIN/api/health"

if [ -s "$LINK_BACKUP" ]; then
  cp "$LINK_BACKUP" .vercel/project.json
  echo "Restored platform/.vercel link to tamamhealth-v7."
fi
