#!/usr/bin/env bash
# Deploy the current platform/ working tree to the tamamhealth-v6 Vercel
# project, then restore the repository's normal tamamhealth-v7 project link.
# macOS ships Bash 3.2, whose `set -u` mishandles empty array expansion.
set -eo pipefail

PLATFORM_DIR="$(cd "$(dirname "$0")/../platform" && pwd)"
VERCEL_BIN="$PLATFORM_DIR/node_modules/.bin/vercel"
PROJECT_LINK="$PLATFORM_DIR/.vercel/project.json"
ORIGIN="https://tamamhealth-v6.vercel.app"

die() {
  printf '[deploy-v6:error] %s\n' "$*" >&2
  exit 1
}

[[ -x "$VERCEL_BIN" ]] || die "Vercel CLI is missing. Run 'cd platform && npm install' first."
[[ -f "$PROJECT_LINK" ]] || die "platform/.vercel/project.json is missing. Run 'cd platform && npx vercel link' first."

LINK_BACKUP="$(mktemp -t tamamhealth-vercel-link.XXXXXX)"
cp "$PROJECT_LINK" "$LINK_BACKUP"

restore_link() {
  if [[ -s "$LINK_BACKUP" ]]; then
    cp "$LINK_BACKUP" "$PROJECT_LINK"
    rm -f "$LINK_BACKUP"
    printf '[deploy-v6] Restored the previous Vercel project link.\n'
  fi
}
trap restore_link EXIT

VERCEL_FLAGS=()
[[ -n "${VERCEL_TOKEN:-}" ]] && VERCEL_FLAGS+=(--token "$VERCEL_TOKEN")
[[ -n "${VERCEL_SCOPE:-}" ]] && VERCEL_FLAGS+=(--scope "$VERCEL_SCOPE")

cd "$PLATFORM_DIR"
"$VERCEL_BIN" whoami "${VERCEL_FLAGS[@]}" >/dev/null 2>&1 \
  || die "Vercel is not authenticated. Run 'cd platform && npx vercel login' first."

if [[ -n "$(git status --porcelain -- .)" ]]; then
  printf '[deploy-v6] Note: this deployment includes uncommitted platform changes.\n'
fi

printf '[deploy-v6] Linking tamamhealth-v6…\n'
"$VERCEL_BIN" link --yes --project tamamhealth-v6 "${VERCEL_FLAGS[@]}" >/dev/null

printf '[deploy-v6] Deploying the current platform working tree to production…\n'
"$VERCEL_BIN" deploy --prod --yes "${VERCEL_FLAGS[@]}"

printf '\n[deploy-v6] Verifying %s…\n' "$ORIGIN"
curl -sS -o /dev/null --max-time 30 -w '  /login:      %{http_code}\n' "$ORIGIN/login" || true
curl -sS -o /dev/null --max-time 30 -w '  /api/health: %{http_code}\n' "$ORIGIN/api/health" || true
