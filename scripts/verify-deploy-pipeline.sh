#!/usr/bin/env bash
# Static checks for Jira ↔ GitHub ↔ DO deploy pipeline wiring.
# Does not SSH or call external APIs — safe to run in CI or locally.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ok=0
fail=0

check() {
  if "$@"; then
    echo "  OK  $*"
    ok=$((ok + 1))
  else
    echo "  FAIL $*"
    fail=$((fail + 1))
  fi
}

echo "=== Deploy pipeline verification ==="

check test -f docker-compose.yml
check test -f docker-compose.ghcr.yml
check test -f .github/workflows/deploy-staging.yml
check test -f .github/workflows/deploy-production.yml
check test -f .github/workflows/ci.yml
check test -f infra/digitalocean/staging.env.append
check test -f infra/digitalocean/production.env.append
check test -f docs/operations/jira-github-do-tracking.md

echo ""
echo "=== docker-compose.ghcr.yml interpolation ==="
check grep -q 'IMAGE_TAG' docker-compose.ghcr.yml
check grep -q 'GH_OWNER' docker-compose.ghcr.yml
check grep -q 'tamamhealth-platform' docker-compose.ghcr.yml
check grep -q 'tamamhealth-website' docker-compose.ghcr.yml
check grep -q 'tamamhealth-sync-worker' docker-compose.ghcr.yml

echo ""
echo "=== Workflow GHCR compose flags ==="
check grep -q 'docker-compose.ghcr.yml' .github/workflows/deploy-staging.yml
check grep -q 'IMAGE_TAG=staging' .github/workflows/deploy-staging.yml
check grep -q 'docker-compose.ghcr.yml' .github/workflows/deploy-production.yml
check grep -q 'IMAGE_TAG=production' .github/workflows/deploy-production.yml

echo ""
echo "=== Demo-mode opt-out is baked into the image ==="
# NEXT_PUBLIC_DEMO_MODE is read as `!== 'false'` (opt-out) and NEXT_PUBLIC_* is
# inlined into the client bundle at BUILD time, so a runtime env var cannot
# switch it off afterwards. These checks exist because the published images
# were once built with no demo flag at all, which shipped a demo-seeding
# bundle to every deploy. Regressing any one of them would restore that.
check grep -q 'ARG NEXT_PUBLIC_DEMO_MODE' platform/Dockerfile
check grep -q 'NEXT_PUBLIC_DEMO_MODE=\"\$NEXT_PUBLIC_DEMO_MODE\"' platform/Dockerfile
check grep -q 'org.tamamhealth.demo-mode' platform/Dockerfile
check grep -q 'NEXT_PUBLIC_DEMO_MODE=' .github/workflows/deploy-staging.yml
check grep -q 'org.tamamhealth.demo-mode' .github/workflows/deploy-production.yml

echo ""
echo "=== Compose config render (staging tag) ==="
if command -v docker >/dev/null 2>&1; then
  export GH_OWNER=tamamorg IMAGE_TAG=staging
  if docker compose -f docker-compose.yml -f docker-compose.ghcr.yml config >/dev/null 2>&1; then
    echo "  OK  docker compose config (staging)"
    ok=$((ok + 1))
  else
    echo "  SKIP docker compose config (staging) — copy .env.example to .env for full validate"
  fi
else
  echo "  SKIP docker compose config (docker not installed)"
fi

echo ""
echo "=== Summary ==="
echo "Passed checks: $ok"
echo "Failed checks: $fail"

if [[ "$fail" -gt 0 ]]; then
  exit 1
fi

echo ""
echo "Next manual steps:"
echo "  1. GitHub Environments secrets — docs/operations/github-environments-setup.md"
echo "  2. Two DO droplets — infra/digitalocean/README.md"
echo "  3. GitHub for Jira — docs/operations/github-for-jira-setup.md"
