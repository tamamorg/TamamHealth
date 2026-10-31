#!/usr/bin/env bash
# =============================================================================
# TamamHealth — one-command onboarding
# =============================================================================
# Takes a fresh clone to a runnable dev environment.
#
#   ./scripts/setup.sh              full setup
#   ./scripts/setup.sh --check      verify an existing setup, install nothing
#
# Deliberately NOT set -e: we want to run every check and report all problems
# at once, rather than dying on the first one and making the developer re-run
# five times. Failures are collected and summarised at the end.
# =============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BOLD='\033[1m'; GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; RESET='\033[0m'

FAILURES=()
WARNINGS=()

ok()   { printf "  ${GREEN}✓${RESET} %s\n" "$1"; }
warn() { printf "  ${YELLOW}!${RESET} %s\n" "$1"; WARNINGS+=("$1"); }
fail() { printf "  ${RED}✗${RESET} %s\n" "$1"; FAILURES+=("$1"); }
head_() { printf "\n${BOLD}%s${RESET}\n" "$1"; }

CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)"; exit 2 ;;
  esac
done

# -----------------------------------------------------------------------------
head_ "1. Node version"
# -----------------------------------------------------------------------------
PINNED="$(tr -d '[:space:]' < .nvmrc 2>/dev/null || echo '')"
if [ -z "$PINNED" ]; then
  fail ".nvmrc missing or empty — the repo's Node version is unpinned"
else
  CURRENT="$(node -v 2>/dev/null | sed 's/^v//')"
  CURRENT_MAJOR="${CURRENT%%.*}"
  if [ -z "$CURRENT" ]; then
    fail "node not found on PATH — install Node ${PINNED} (nvm: 'nvm install')"
  elif [ "$CURRENT_MAJOR" = "$PINNED" ]; then
    ok "Node v${CURRENT} matches .nvmrc (${PINNED})"
  else
    warn "Node v${CURRENT} but .nvmrc pins ${PINNED} — run 'nvm use' (CI builds on ${PINNED})"
  fi
fi

# -----------------------------------------------------------------------------
head_ "2. Dependencies"
# -----------------------------------------------------------------------------
# Each package carries its own lockfile; there is no workspace hoisting.
# The fingerprint bridge lives in platform/tools/ and has no dependencies.
PKGS=(platform website platform/tools/sync-worker)

install_pkg() {
  local dir="$1"
  [ -f "$dir/package.json" ] || { warn "$dir has no package.json — skipped"; return; }

  if [ "$CHECK_ONLY" -eq 1 ]; then
    if [ -d "$dir/node_modules" ]; then ok "$dir deps present"; else fail "$dir deps missing"; fi
    return
  fi

  printf "  ${DIM}installing %s…${RESET}\n" "$dir"
  # `npm ci` is reproducible but hard-fails when the lockfile drifts; fall back
  # to `npm install` so a first-time contributor isn't blocked by lockfile drift
  # they didn't cause.
  if [ -f "$dir/package-lock.json" ] && npm --prefix "$dir" ci --no-audit --no-fund >/dev/null 2>&1; then
    ok "$dir (npm ci)"
  elif npm --prefix "$dir" install --no-audit --no-fund >/dev/null 2>&1; then
    ok "$dir (npm install — lockfile drifted, consider committing the update)"
  else
    fail "$dir dependency install failed — run 'npm --prefix $dir install' to see why"
  fi
}

# Root tooling first: this is what installs husky and activates the git hooks.
if [ "$CHECK_ONLY" -eq 0 ]; then
  printf "  ${DIM}installing repo-root tooling…${RESET}\n"
  if npm install --no-audit --no-fund >/dev/null 2>&1; then
    ok "repo-root tooling (husky + lint-staged)"
  else
    fail "repo-root 'npm install' failed — git hooks will not be active"
  fi
fi

for p in "${PKGS[@]}"; do install_pkg "$p"; done

# -----------------------------------------------------------------------------
head_ "3. Git hooks"
# -----------------------------------------------------------------------------
HOOKS_PATH="$(git config core.hooksPath 2>/dev/null || echo '')"
if [ "$HOOKS_PATH" = ".husky/_" ] && [ -x .husky/pre-commit ]; then
  ok "pre-commit hook active (bypass with 'git commit --no-verify')"
elif [ -f .husky/pre-commit ]; then
  warn "pre-commit hook exists but is not registered — run 'npm install' at the repo root"
else
  fail ".husky/pre-commit missing"
fi

# -----------------------------------------------------------------------------
head_ "4. Environment files"
# -----------------------------------------------------------------------------
seed_env() {
  local target="$1" example="$2"
  if [ -f "$target" ]; then
    ok "$target present"
  elif [ -f "$example" ]; then
    if [ "$CHECK_ONLY" -eq 1 ]; then
      warn "$target missing (copy from $example)"
    else
      cp "$example" "$target"
      ok "$target created from $example"
    fi
  else
    warn "$example not found — cannot seed $target"
  fi
}

seed_env platform/.env.local platform/.env.example
# website/ has no .env.example and needs no env vars for local dev — it reads
# everything at build time. Nothing to seed.

# PHI field encryption ships ON by default (see platform/.env.example). The key
# is intentionally blank there — it must be unique per deployment and must never
# be committed. Without a key the app throws at the first encrypt, so generate a
# local-only one here; otherwise a fresh clone can't register a patient.
if [ -f platform/.env.local ] && [ "$CHECK_ONLY" -eq 0 ]; then
  if grep -q '^PHI_ENCRYPTION_KEY=$' platform/.env.local 2>/dev/null; then
    if command -v openssl >/dev/null 2>&1; then
      GENERATED_KEY="$(openssl rand -base64 32)"
      # Portable in-place edit (BSD sed on macOS needs the empty -i argument).
      if sed --version >/dev/null 2>&1; then
        sed -i "s|^PHI_ENCRYPTION_KEY=$|PHI_ENCRYPTION_KEY=${GENERATED_KEY}|" platform/.env.local
      else
        sed -i '' "s|^PHI_ENCRYPTION_KEY=$|PHI_ENCRYPTION_KEY=${GENERATED_KEY}|" platform/.env.local
      fi
      ok "generated a local PHI_ENCRYPTION_KEY (dev only — never reuse in production)"
    else
      warn "openssl not found — set PHI_ENCRYPTION_KEY in platform/.env.local by hand, or set PHI_ENCRYPTION_ENABLED=false for local dev"
    fi
  fi
fi

# platform/scripts/setup.mjs generates real secrets (JWT_SECRET etc.) and is
# interactive, so it is offered rather than run automatically.
if [ -f platform/scripts/setup.mjs ]; then
  printf "  ${DIM}for generated secrets + guided config: node platform/scripts/setup.mjs${RESET}\n"
fi

# -----------------------------------------------------------------------------
head_ "5. Smoke check"
# -----------------------------------------------------------------------------
# Type-check platform only. It is the largest surface and the one that breaks
# most often; a green tsc here means the toolchain genuinely works.
if [ -d platform/node_modules ]; then
  # Must run with CWD inside platform/ — tsc resolves tsconfig.json from the
  # working directory, and `npm --prefix` changes the package, not the CWD.
  if (cd platform && npx --no-install tsc --noEmit) >/dev/null 2>&1; then
    ok "platform type-checks clean"
  else
    fail "platform 'tsc --noEmit' failed — run it directly to see the errors"
  fi
else
  warn "platform deps not installed — skipped type-check"
fi

# -----------------------------------------------------------------------------
head_ "Summary"
# -----------------------------------------------------------------------------
if [ ${#FAILURES[@]} -eq 0 ]; then
  printf "${GREEN}Setup complete.${RESET}\n\n"
  cat <<'EOF'
Next:
  cd platform && npm run dev      → http://localhost:3000

Gotchas that bite everyone at least once:
  • Leave DATABASE_URL UNSET for normal dev. The platform is offline-first and
    runs on PouchDB in the browser; setting DATABASE_URL switches on the
    Postgres analytics path and you will chase phantom connection errors.
  • After switching branches, 'rm -rf platform/.next'. Next caches aggressively
    and a stale build shows you the other branch's pages.
  • Run 'nvm use' in each new shell, or the lockfiles resolve differently than
    they do in CI.
EOF
  [ ${#WARNINGS[@]} -gt 0 ] && printf "\n${YELLOW}%d warning(s) above — non-blocking.${RESET}\n" "${#WARNINGS[@]}"
  exit 0
else
  printf "${RED}%d problem(s):${RESET}\n" "${#FAILURES[@]}"
  for f in "${FAILURES[@]}"; do printf "  • %s\n" "$f"; done
  exit 1
fi
