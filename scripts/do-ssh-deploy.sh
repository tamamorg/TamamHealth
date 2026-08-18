#!/usr/bin/env bash
# =============================================================================
# TamamHealth — bootstrap a DigitalOcean droplet over SSH (staging or production)
# =============================================================================
# Run from your laptop after Terraform (or manual DO console) has created the
# droplet and DNS A records point at its reserved IP.
#
# Usage:
#   ./scripts/do-ssh-deploy.sh --host <ip> --env staging --domain tamamhealth.org
#   ./scripts/do-ssh-deploy.sh --host <ip> --env production --domain tamamhealth.org
#
# Options:
#   --host      Reserved IP or droplet address (required)
#   --env       staging | production (required)
#   --domain    Root domain, e.g. tamamhealth.org (default: tamamhealth.org)
#   --user      SSH user (default: root)
#   --app-dir   Remote install path (default: /opt/tamamhealth)
#   --dry-run   Print remote commands without executing
# =============================================================================
set -euo pipefail

HOST=""
ENV=""
DOMAIN="tamamhealth.org"
SSH_USER="root"
APP_DIR="/opt/tamamhealth"
DRY=0

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --env) ENV="$2"; shift 2 ;;
    --domain) DOMAIN="$2"; shift 2 ;;
    --user) SSH_USER="$2"; shift 2 ;;
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done

[ -n "$HOST" ] || { echo "missing --host" >&2; usage; }
[ -n "$ENV" ] || { echo "missing --env" >&2; usage; }

case "$ENV" in
  staging)
    DOMAIN_ROOT="staging.${DOMAIN}"
    DOMAIN_APP="app.staging.${DOMAIN}"
    DOMAIN_COUCH="couch.staging.${DOMAIN}"
    DEMO_MODE="true"
    ENV_APPEND="infra/digitalocean/staging.env.append"
    ;;
  production)
    DOMAIN_ROOT="${DOMAIN}"
    DOMAIN_APP="app.${DOMAIN}"
    DOMAIN_COUCH="couch.${DOMAIN}"
    DEMO_MODE="false"
    ENV_APPEND="infra/digitalocean/production.env.append"
    ;;
  *)
    echo "env must be staging or production, got: $ENV" >&2
    exit 2
    ;;
esac

REPO_URL="https://github.com/tamamorg/TamamHealth.git"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cyan() { printf '\033[1;36m%s\033[0m\n' "$*"; }
green() { printf '\033[1;32m%s\033[0m\n' "$*"; }

REMOTE_SCRIPT=$(cat <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git ca-certificates curl rsync

if [ ! -f "${APP_DIR}/deploy.sh" ]; then
  mkdir -p "${APP_DIR}"
fi

cd "${APP_DIR}"
./scripts/gen-secrets.sh

# Point env files at this environment's public URLs.
for f in platform/.env.production website/.env.production; do
  [ -f "\$f" ] || continue
  sed -i "s#https://app\\.tamamhealth\\.org#https://${DOMAIN_APP}#g" "\$f"
  sed -i "s#https://couch\\.tamamhealth\\.org#https://${DOMAIN_COUCH}#g" "\$f"
  sed -i "s#https://tamamhealth\\.org#https://${DOMAIN_ROOT}#g" "\$f"
  sed -i "s#^NEXT_PUBLIC_COUCHDB_URL=.*#NEXT_PUBLIC_COUCHDB_URL=https://${DOMAIN_COUCH}#" "\$f" 2>/dev/null || true
  sed -i "s#^NEXT_PUBLIC_APP_URL=.*#NEXT_PUBLIC_APP_URL=https://${DOMAIN_APP}#" "\$f" 2>/dev/null || true
  sed -i "s#^NEXT_PUBLIC_DEMO_MODE=.*#NEXT_PUBLIC_DEMO_MODE=${DEMO_MODE}#" "\$f" 2>/dev/null || true
done

if ! grep -q '^GH_OWNER=' .env 2>/dev/null; then
  cat "${ENV_APPEND}" >> .env
fi

./scripts/preflight.sh || true

export REPO_URL="${REPO_URL}"
export APP_DIR="${APP_DIR}"
export DOMAIN_ROOT="${DOMAIN_ROOT}"
export DOMAIN_APP="${DOMAIN_APP}"
export DOMAIN_COUCH="${DOMAIN_COUCH}"
export SKIP_GIT_SYNC=1
bash deploy.sh
EOF
)

cyan "Target: ${SSH_USER}@${HOST} (${ENV})"
cyan "  app:   https://${DOMAIN_APP}"
cyan "  couch: https://${DOMAIN_COUCH}"
echo

if [ "$DRY" -eq 1 ]; then
  echo "$REMOTE_SCRIPT"
  exit 0
fi

ssh-keyscan -H "$HOST" >> ~/.ssh/known_hosts 2>/dev/null || true

cyan "Syncing repo to ${SSH_USER}@${HOST}:${APP_DIR} (private repo — rsync from laptop)"
ssh "${SSH_USER}@${HOST}" "mkdir -p '${APP_DIR}'"
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude platform/docs-api \
  --exclude infra/digitalocean/terraform/.terraform \
  --exclude infra/digitalocean/terraform/terraform.tfstate \
  --exclude '.env' \
  --exclude 'platform/.env.production' \
  --exclude 'website/.env.production' \
  --exclude 'platform/.env.local' \
  "${ROOT}/" "${SSH_USER}@${HOST}:${APP_DIR}/"

ssh -o StrictHostKeyChecking=accept-new "${SSH_USER}@${HOST}" "bash -s" <<< "$REMOTE_SCRIPT"
green "Bootstrap finished. Verify: https://${DOMAIN_APP}/login"
