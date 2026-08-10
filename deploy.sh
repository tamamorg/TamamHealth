#!/bin/bash
# =============================================================================
# TamamHealth — one-shot VPS deployment script
# =============================================================================
# Run this on a FRESH Ubuntu 22.04 VPS (root or sudo user). It will:
#   1. install Docker + Caddy
#   2. clone the repo and copy env files you've uploaded
#   3. build + start the stack
#   4. configure Caddy so TLS is auto-provisioned by Let's Encrypt
#
# Before running, you need:
#   - A VPS with a public IP
#   - 3 DNS A records pointing at it:
#       tamamhealth.org           → <VPS IP>
#       app.tamamhealth.org       → <VPS IP>
#       couch.tamamhealth.org     → <VPS IP>
#   - Your filled-in env files copied to the VPS (see "ENV FILES" below)
# =============================================================================
set -euo pipefail

# ----- EDIT THESE -----------------------------------------------------------
REPO_URL="${REPO_URL:-https://github.com/makuachteny/TamamHealth.git}"
APP_DIR="${APP_DIR:-/opt/tamamhealth}"
DOMAIN_ROOT="${DOMAIN_ROOT:-tamamhealth.org}"
DOMAIN_APP="${DOMAIN_APP:-app.tamamhealth.org}"
DOMAIN_COUCH="${DOMAIN_COUCH:-couch.tamamhealth.org}"
# Browser origin allowed to use credentialed CouchDB replication. Override this
# when the app is hosted on Vercel, e.g.:
#   COUCH_CORS_ORIGIN=https://tamamhealth-v6.vercel.app ./deploy.sh
COUCH_CORS_ORIGIN="${COUCH_CORS_ORIGIN:-https://${DOMAIN_APP}}"
# ----------------------------------------------------------------------------

say() { echo -e "\033[1;36m[deploy]\033[0m $*"; }
die() { echo -e "\033[1;31m[error]\033[0m $*" >&2; exit 1; }

# ===== 1. SYSTEM PREREQUISITES =============================================
say "Updating apt and installing Docker + Caddy"
apt-get update -y
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https

# Docker
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# Caddy (official repo)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | \
    gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | \
    tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ===== 2. REPO + ENV FILES =================================================
# REPO_URL has a YOUR-ORG placeholder. If the operator didn't override it,
# `git clone` will fail with an unhelpful 404. Refuse before the network call.
if echo "$REPO_URL" | grep -q 'YOUR-ORG'; then
  die "REPO_URL still points at the YOUR-ORG placeholder. Re-run with REPO_URL=https://github.com/makuachteny/TamamHealth.git ./deploy.sh"
fi

if [ "${SKIP_GIT_SYNC:-}" = "1" ]; then
  say "Skipping git sync (code already on host)"
elif [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning repo to $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
else
  say "Repo exists; pulling latest"
  (cd "$APP_DIR" && git pull)
fi

cd "$APP_DIR"

# Verify env files exist (you must upload these via scp BEFORE running the script)
for f in ".env" "platform/.env.production" "website/.env.production"; do
  [ -f "$f" ] || die "Missing $APP_DIR/$f — upload it first: scp $f root@<VPS>:$APP_DIR/$f"
done

# Sanity-check: no placeholders should have survived in any of the env files.
# Previously we only scanned platform/.env.production, but a fresh deploy can
# also break on a placeholder COUCHDB_PASSWORD or POSTGRES_PASSWORD in the
# root .env. Scan all three.
for f in ".env" "platform/.env.production" "website/.env.production"; do
  if grep -q "REPLACE\|PLACEHOLDER\|ChangeMe" "$f"; then
    die "$f still has placeholders. Fill in real values and re-run."
  fi
done

# docker-compose.yml requires these keys in the root .env when the analytics
# profile is enabled (sync-worker references ${COUCHDB_WEBHOOK_SECRET:?...},
# which makes compose abort on `up` if the variable is missing). Catch it
# here with a clearer message before the docker-compose error.
if grep -qE '^[[:space:]]*profiles:[[:space:]]*\["analytics"\]' docker-compose.yml; then
  for required in COUCHDB_USER COUCHDB_PASSWORD; do
    if ! grep -qE "^${required}=" .env; then
      die ".env is missing $required (required by docker-compose.yml). See README."
    fi
  done
  if ! grep -qE '^COUCHDB_WEBHOOK_SECRET=' .env; then
    warn_missing="COUCHDB_WEBHOOK_SECRET not set in .env — sync-worker will refuse to start under --profile analytics."
    echo -e "\033[1;33m[warn]\033[0m $warn_missing"
  fi
fi

# ===== 3. CADDY CONFIG =====================================================
say "Writing /etc/caddy/Caddyfile"
# Staging: apex (staging.example.com) serves the app so /login works without
# the app. prefix. Production keeps marketing on apex and the EHR on app.*.
if [[ "${DOMAIN_ROOT}" == staging.* ]]; then
  cat > /etc/caddy/Caddyfile <<EOF
# Staging — platform on apex + app.* (marketing site still on :3001 locally)
${DOMAIN_ROOT}, www.${DOMAIN_ROOT}, ${DOMAIN_APP} {
    reverse_proxy localhost:3000
    encode gzip
}

# CouchDB (browser-facing for live sync)
${DOMAIN_COUCH} {
    reverse_proxy localhost:5984
    header {
        Access-Control-Allow-Origin "${COUCH_CORS_ORIGIN}"
        Access-Control-Allow-Credentials true
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, HEAD"
        Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With, X-CouchDB-Www-Authenticate"
    }
}
EOF
else
  cat > /etc/caddy/Caddyfile <<EOF
# Marketing site
${DOMAIN_ROOT}, www.${DOMAIN_ROOT} {
    reverse_proxy localhost:3001
    encode gzip
}

# Clinician + patient platform
${DOMAIN_APP} {
    reverse_proxy localhost:3000
    encode gzip
}

# CouchDB (browser-facing for live sync)
${DOMAIN_COUCH} {
    reverse_proxy localhost:5984
    # CouchDB needs CORS for browser PouchDB replication
    header {
        Access-Control-Allow-Origin "${COUCH_CORS_ORIGIN}"
        Access-Control-Allow-Credentials true
        Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS, HEAD"
        Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With, X-CouchDB-Www-Authenticate"
    }
}
EOF
fi

systemctl reload caddy || systemctl restart caddy

# ===== 4. BUILD + START ====================================================
say "Building images (tags with current git SHA)"
export NEXT_PUBLIC_BUILD_ID="$(git rev-parse --short HEAD)"
docker compose build

say "Bringing the stack up"
docker compose up -d

# Wait for health
say "Waiting for services to become healthy (timeout 120s)"
for i in $(seq 1 60); do
  if docker compose ps --format json | grep -q '"Health":"healthy"'; then
    say "Services reporting healthy"
    break
  fi
  sleep 2
done

# ===== 4b. SHRED BOOTSTRAP CREDENTIALS =====================================
# When ADMIN_INITIAL_PASSWORD is unset the platform generates an admin password
# and writes it to platform/.seed-credentials.json. On a real deployment the
# first-boot operator may be a local MoH IT technician, and that file otherwise
# sits on disk in plaintext indefinitely — a standing privilege-escalation path
# for anyone who later gets shell or a stale backup.
#
# The app also deletes it once the admin clears mustChangePassword (see
# lib/seed-credentials.ts), but that only fires if someone actually logs in.
# This is the belt to that braces: by the time the stack is healthy the
# operator has had their chance to read it.
SEED_FILE="${APP_DIR}/platform/.seed-credentials.json"
if [ -f "$SEED_FILE" ]; then
  say "Removing bootstrap credentials file (${SEED_FILE})"
  echo "  ⚠ If you have not yet noted the admin password, press Ctrl-C NOW —"
  echo "    it is about to be destroyed and cannot be recovered."
  echo "    Contents:"
  sed 's/^/      /' "$SEED_FILE" || true
  sleep "${SEED_SHRED_DELAY:-15}"
  # Overwrite before unlinking: on a journalling filesystem a plain rm leaves
  # the plaintext recoverable.
  shred -u "$SEED_FILE" 2>/dev/null || rm -f "$SEED_FILE"
  say "Bootstrap credentials removed"
fi

# ===== 5. INIT COUCHDB SYSTEM DBS ==========================================
say "Initializing CouchDB system databases (idempotent)"
COUCH_USER="$(grep '^COUCHDB_USER=' .env | cut -d= -f2)"
COUCH_PASS="$(grep '^COUCHDB_PASSWORD=' .env | cut -d= -f2)"
for db in _users _replicator _global_changes; do
  curl -sf -X PUT "http://${COUCH_USER}:${COUCH_PASS}@localhost:5984/${db}" \
    >/dev/null 2>&1 && echo "  created $db" || echo "  $db already exists"
done

# ===== 6. SUMMARY ==========================================================
cat <<EOF

\033[1;32m[deploy] done.\033[0m

• Marketing:       https://${DOMAIN_ROOT}
• Clinician app:   https://${DOMAIN_APP}/login
• Patient portal:  https://${DOMAIN_APP}/patient-portal
• CouchDB admin:   https://${DOMAIN_COUCH}/_utils (log in with COUCHDB_USER)

First login:
  Username: admin (or \$NEXT_PUBLIC_ADMIN_NAME from platform/.env.production)
  Password: read from \$ADMIN_INITIAL_PASSWORD in platform/.env.production
           — or from /opt/tamamhealth/platform/.seed-credentials.json if you
             left ADMIN_INITIAL_PASSWORD unset (the platform auto-generated
             one on first boot).
Change the password immediately after first login.

Ops:
  docker compose logs -f platform     # tail platform logs
  docker compose ps                   # service health
  docker compose restart platform     # restart one service
  docker compose down && docker compose up -d   # full restart

Backups are running nightly to the couchdb_backups Docker volume
(/var/lib/docker/volumes/tamamhealth_couchdb_backups/_data on the host).
Rsync that directory offsite for full DR.
EOF
