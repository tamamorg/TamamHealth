#!/usr/bin/env sh
set -eu

APP_DIR=${1:-/opt/tamamhealth}
cd "$APP_DIR"

compose() {
  GH_OWNER=${GH_OWNER:-tamamorg} IMAGE_TAG=${IMAGE_TAG:-production} \
    docker compose -f docker-compose.yml -f docker-compose.ghcr.yml "$@"
}

PASSWORD_READY=$(compose exec -T platform node -e 'process.stdout.write(String((process.env.SUPERADMIN_INITIAL_PASSWORD || "").length >= 16))')
if [ "$PASSWORD_READY" != true ]; then
  echo "SUPERADMIN_INITIAL_PASSWORD is missing or shorter than 16 characters" >&2
  exit 1
fi

COUCHDB_USER=$(awk -F= '/^COUCHDB_USER=/{print substr($0,index($0,"=")+1); exit}' .env)
COUCHDB_PASSWORD=$(awk -F= '/^COUCHDB_PASSWORD=/{print substr($0,index($0,"=")+1); exit}' .env)
if [ -z "$COUCHDB_USER" ] || [ -z "$COUCHDB_PASSWORD" ]; then
  echo "CouchDB administrator credentials are missing" >&2
  exit 1
fi

DOC_URL=http://127.0.0.1:5984/tamamhealth_users/user-superadmin
TMP_DOC=$(mktemp)
TMP_UPDATED=$(mktemp)
trap 'rm -f "$TMP_DOC" "$TMP_UPDATED"' EXIT

STATUS=$(curl -sS -u "$COUCHDB_USER:$COUCHDB_PASSWORD" -o "$TMP_DOC" -w '%{http_code}' "$DOC_URL")
PASSWORD_HASH=$(compose exec -T platform node -e '
  require("bcryptjs").hash(process.env.SUPERADMIN_INITIAL_PASSWORD, 12)
    .then(hash => process.stdout.write(hash))
    .catch(error => { console.error(error.message); process.exit(1); });
')
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
if [ "$STATUS" = 404 ]; then
  compose exec -T -e RECOVERY_HASH="$PASSWORD_HASH" -e RECOVERY_NOW="$NOW" platform node -e '
    const doc = {
      _id: "user-superadmin",
      type: "user",
      username: "superadmin",
      passwordHash: process.env.RECOVERY_HASH,
      name: "TamamHealth Platform Admin",
      role: "super_admin",
      isActive: true,
      mustChangePassword: true,
      passwordUpdatedAt: process.env.RECOVERY_NOW,
      createdAt: process.env.RECOVERY_NOW,
      updatedAt: process.env.RECOVERY_NOW
    };
    process.stdout.write(JSON.stringify(doc));
  ' > "$TMP_UPDATED"
  curl -fsS -u "$COUCHDB_USER:$COUCHDB_PASSWORD" \
    -H 'Content-Type: application/json' -X PUT --data-binary @"$TMP_UPDATED" "$DOC_URL" >/dev/null
  echo 'missing superadmin record created'
elif [ "$STATUS" = 200 ]; then
  compose exec -T -e RECOVERY_HASH="$PASSWORD_HASH" -e RECOVERY_NOW="$NOW" platform node -e '
    const fs = require("fs");
    const doc = JSON.parse(fs.readFileSync(0, "utf8"));
    doc.passwordHash = process.env.RECOVERY_HASH;
    doc.isActive = true;
    doc.mustChangePassword = true;
    doc.passwordUpdatedAt = process.env.RECOVERY_NOW;
    doc.updatedAt = process.env.RECOVERY_NOW;
    process.stdout.write(JSON.stringify(doc));
  ' < "$TMP_DOC" > "$TMP_UPDATED"
  curl -fsS -u "$COUCHDB_USER:$COUCHDB_PASSWORD" \
    -H 'Content-Type: application/json' -X PUT --data-binary @"$TMP_UPDATED" "$DOC_URL" >/dev/null
  echo 'existing superadmin record reset'
else
  echo "Could not read superadmin record (HTTP $STATUS)" >&2
  exit 1
fi

VERIFY=$(compose exec -T platform node -e '
  const bcrypt = require("bcryptjs");
  const base = process.env.COUCHDB_URL.replace(/\/$/, "");
  const user = process.env.COUCHDB_ADMIN_USER;
  const pass = process.env.COUCHDB_ADMIN_PASSWORD;
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  fetch(`${base}/tamamhealth_users/user-superadmin`, { headers: { authorization: `Basic ${auth}` } })
    .then(response => response.json())
    .then(async doc => {
      const matches = await bcrypt.compare(process.env.SUPERADMIN_INITIAL_PASSWORD, doc.passwordHash || "");
      console.log(JSON.stringify({ username: doc.username, role: doc.role, active: doc.isActive, mustChangePassword: doc.mustChangePassword, passwordMatches: matches }));
      if (doc.username !== "superadmin" || doc.role !== "super_admin" || !doc.isActive || !matches) process.exitCode = 1;
    }).catch(error => { console.error(error.message); process.exit(1); });
')
echo "verification=$VERIFY"
