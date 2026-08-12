#!/usr/bin/env bash
# =============================================================================
# install-offsite-backup.sh — install nightly CouchDB and PostgreSQL backups.
#
# Until this is run, nightly CouchDB dumps stay on the SAME droplet as the
# database. A disk failure or a destroyed droplet loses the database and every
# "backup" at once. This installs the systemd units that actually ship an
# encrypted copy off the machine.
#
# Run once per droplet, as root:
#   sudo ./scripts/install-offsite-backup.sh
#
# Prerequisites checked below: gpg, the AWS CLI (or BACKUP_HTTP_PUT_URL), a
# backup public key, and /etc/tamamhealth/backup.env with the destination.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/tamamhealth}"
ENV_FILE="/etc/tamamhealth/backup.env"
UNIT_DIR="/etc/systemd/system"
SRC="${APP_DIR}/infra/systemd"

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
say()   { printf '\033[1m[offsite-backup]\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { red "Must run as root (systemd units + /etc)."; exit 1; }

say "Checking prerequisites"
missing=0
command -v gpg >/dev/null 2>&1 || { red "  ✗ gpg not installed — apt-get install -y gnupg"; missing=1; }
if ! command -v aws >/dev/null 2>&1; then
  say "  ! AWS CLI not found — the script can still upload via BACKUP_HTTP_PUT_URL"
  say "    Install with: apt-get install -y awscli   (or use the v2 installer)"
fi

if [ ! -f "$ENV_FILE" ]; then
  red "  ✗ $ENV_FILE missing."
  cat <<EOF

Create it with the backup destination, then re-run. Root-only (0600) because
it holds credentials:

  install -d -m 0700 /etc/tamamhealth
  cat > $ENV_FILE <<'ENV'
  BACKUP_BUCKET=your-bucket-name
  DATABASE_URL=postgresql://backup-user:password@private-host:25060/tamamhealth?sslmode=require
  AWS_REGION=af-south-1
  AWS_ACCESS_KEY_ID=...
  AWS_SECRET_ACCESS_KEY=...
  # Backblaze B2 / MinIO only:
  # AWS_ENDPOINT_URL=https://s3.eu-central-003.backblazeb2.com
  BACKUP_PUBKEY_PATH=/etc/tamamhealth/backup-pubkey.gpg
  ENV
  chmod 600 $ENV_FILE

AWS_REGION must stay af-south-1 unless you have explicit authorisation to move
clinical data outside the region — see docs/AFRICA-HOSTING-STRATEGY.md.
EOF
  missing=1
else
  chmod 600 "$ENV_FILE"
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  [ -n "${BACKUP_BUCKET:-}" ] || { red "  ✗ BACKUP_BUCKET unset in $ENV_FILE"; missing=1; }
  [ -n "${DATABASE_URL:-}" ] || { red "  ✗ DATABASE_URL unset in $ENV_FILE (required for PostgreSQL backup)"; missing=1; }
  PUBKEY="${BACKUP_PUBKEY_PATH:-/etc/tamamhealth/backup-pubkey.gpg}"
  if [ ! -f "$PUBKEY" ]; then
    red "  ✗ Backup public key missing at $PUBKEY"
    say "    Generate the pair OFF this machine, keep the private half in escrow,"
    say "    and copy only the public half here. See docs/operations/backups.md."
    missing=1
  fi
fi

[ "$missing" -eq 0 ] || { red "Prerequisites incomplete — nothing installed."; exit 1; }
green "  ✓ prerequisites present"

say "Installing systemd units"
install -m 0644 "${SRC}/tamamhealth-offsite-backup.service" "${UNIT_DIR}/"
install -m 0644 "${SRC}/tamamhealth-offsite-backup.timer"   "${UNIT_DIR}/"
install -m 0644 "${SRC}/tamamhealth-offsite-postgres-backup.service" "${UNIT_DIR}/"
install -m 0644 "${SRC}/tamamhealth-offsite-postgres-backup.timer"   "${UNIT_DIR}/"
systemctl daemon-reload
systemctl enable --now tamamhealth-offsite-backup.timer tamamhealth-offsite-postgres-backup.timer

green "Installed."
echo
say "Next run:"
systemctl list-timers tamamhealth-offsite-backup.timer tamamhealth-offsite-postgres-backup.timer --no-pager || true
echo
say "Verify NOW rather than trusting it — an untested backup is not a backup:"
echo "    sudo systemctl start tamamhealth-offsite-backup.service"
echo "    journalctl -u tamamhealth-offsite-backup.service -n 50 --no-pager"
echo "    sudo systemctl start tamamhealth-offsite-postgres-backup.service"
echo "    journalctl -u tamamhealth-offsite-postgres-backup.service -n 50 --no-pager"
echo
say "Then prove a restore works: scripts/backup-restore-drill.sh"
