#!/usr/bin/env bash
# =============================================================================
# TamamHealth — pre-deploy preflight gate.
# =============================================================================
# Runs every check that has bitten us before a production deploy. Any failure
# refuses to continue — the operator must resolve before the deploy script is
# allowed to touch shared infrastructure.
#
# Usage:
#   ./scripts/preflight.sh                 # full local + repo checks
#                                          # production target: DigitalOcean droplet
#
# This script is intentionally written in pure bash — no Node, no Python — so
# it can run on a fresh Ubuntu host before any of our own tooling is set up.
# =============================================================================
set -euo pipefail

# ── colour helpers ───────────────────────────────────────────────────────────
red()    { printf '\033[1;31m%s\033[0m\n' "$*"; }
green()  { printf '\033[1;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[1;33m%s\033[0m\n' "$*"; }
cyan()   { printf '\033[1;36m%s\033[0m\n' "$*"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

failed=0
warned=0
fail() { red   "  ✗ $*"; failed=$((failed+1)); }
warn() { yellow "  ⚠ $*"; warned=$((warned+1)); }
ok()   { green "  ✓ $*"; }

cyan "TamamHealth preflight — $(date -u +%FT%TZ)"
echo "  repo: $ROOT"
echo

# ── 1. tooling ────────────────────────────────────────────────────────────────
cyan "1/6 · host tooling"
for tool in node npm git; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool $($tool --version | head -1)"
  else
    fail "$tool is not installed"
  fi
done
NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 20 ] && ok "Node $NODE_MAJOR ≥ 20" || fail "Node $NODE_MAJOR < 20"
echo

# ── 2. clean working tree ────────────────────────────────────────────────────
cyan "2/6 · git working tree"
if [ -n "$(git status --porcelain)" ]; then
  warn "uncommitted changes (review with 'git status' before tagging a release):"
  git status --short | sed 's/^/      /'
else
  ok "working tree clean"
fi
echo

# ── 3. secrets that must NEVER ship ──────────────────────────────────────────
cyan "3/6 · secret leak scan"
# Strings that must never appear *as live values* in source. The JWT fallback
# constant is intentionally still in the codebase (the boot guard in
# instrumentation.ts and auth-token.ts itself refuses to USE it in production)
# — flag it only if it shows up outside its documented declaration sites.
declare -a leaks=(
  "Dr.Wani@JTH2026"            # ticket #1 hardcoded demo password
  "TamamHealth4Lyf"            # default CouchDB password
  "Admin@TamamHealth2026!"     # old default admin password
)
for needle in "${leaks[@]}"; do
  if grep -RIln --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' \
                --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=coverage \
                "$needle" platform/ website/ 2>/dev/null | grep -v '/__tests__/' >/dev/null; then
    fail "found '$needle' in source — must be rotated/removed"
  fi
done

# JWT fallback: only allowed in the two files that *declare* it as a fallback
# constant (and the boot-guard that refuses to use it in production). Any
# other appearance is a leak.
jwt_default='tamamhealth-south-sudan-health-2026-secret-key'
allowed_jwt_paths='^platform/(src/lib/(auth-token|csrf|patient-portal-auth)\.ts|src/instrumentation\.ts|src/app/api/patient-portal/login/route\.ts|src/__tests__/)'
if grep -RIln --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' \
              --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=coverage \
              "$jwt_default" platform/ website/ 2>/dev/null \
              | grep -vE "$allowed_jwt_paths" >/dev/null; then
  fail "JWT fallback string appears outside its allowed declaration sites:"
  grep -RIln --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' \
              --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=coverage \
              "$jwt_default" platform/ website/ 2>/dev/null \
              | grep -vE "$allowed_jwt_paths" | sed 's/^/      /'
fi
[ "$failed" -eq 0 ] && ok "no known-leaked credentials in src (JWT fallback only at documented sites)"

# Disallow NEXT_PUBLIC_ADMIN_PASSWORD anywhere
if grep -RIln --include='*.example' --include='*.ts' --include='*.tsx' \
              --exclude-dir=node_modules --exclude-dir=.next \
              "NEXT_PUBLIC_ADMIN_PASSWORD" platform/ website/ 2>/dev/null \
              | grep -v 'instrumentation.ts' >/dev/null; then
  fail "NEXT_PUBLIC_ADMIN_PASSWORD appears outside the boot-guard — it must never be public"
else
  ok "NEXT_PUBLIC_ADMIN_PASSWORD is only referenced by the boot guard"
fi

# Generic credential pattern scan — catches AWS keys, GitHub PATs, Doppler
# service tokens, OpenAI keys, and PEM private-key blocks that escaped into
# tracked files. Scope is the whole repo MINUS node_modules / build outputs.
# These patterns are high-precision: each is anchored to a unique provider
# prefix (AKIA*, ghp_*, dp.st.*, sk-*, -----BEGIN ... PRIVATE KEY-----) so
# false positives are vanishingly rare.
generic_patterns=(
  'AKIA[0-9A-Z]{16}'                # AWS access key id
  'ASIA[0-9A-Z]{16}'                # AWS STS temporary key id
  'ghp_[A-Za-z0-9]{36,}'            # GitHub personal access token
  'gho_[A-Za-z0-9]{36,}'            # GitHub OAuth token
  'github_pat_[A-Za-z0-9_]{30,}'    # GitHub fine-grained PAT
  'dp\.st\.[a-z0-9_-]+\.[A-Za-z0-9_-]+'  # Doppler service token
  'sk-[A-Za-z0-9]{32,}'             # OpenAI / Anthropic-style key
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'   # PEM private key block
  'xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+'      # Slack bot token
)
generic_hits=0
for pat in "${generic_patterns[@]}"; do
  # Exclude this script itself (the patterns appear here as strings),
  # the .git directory, and *.md files (operator docs reference these
  # token formats in example/instructional contexts — e.g. secrets.md
  # shows what a Doppler service token looks like). Real leaks land in
  # code/config files, not documentation, so the FP cost outweighs the
  # signal of scanning .md.
  hits=$(grep -RIlnE \
           --exclude-dir=node_modules --exclude-dir=.next \
           --exclude-dir=coverage --exclude-dir=.git \
           --exclude='preflight.sh' \
           --exclude='*.md' \
           "$pat" . 2>/dev/null || true)
  if [ -n "$hits" ]; then
    fail "credential pattern '$pat' detected in:"
    echo "$hits" | sed 's/^/      /'
    generic_hits=$((generic_hits+1))
  fi
done
[ "$generic_hits" -eq 0 ] && ok "no AWS / GitHub / Doppler / PEM credential patterns in tracked files"

# Production env hygiene — the three mistakes that turn a clinic deploy unsafe.
if [ -f platform/.env.production ]; then
  if grep -qE '^NEXT_PUBLIC_DEMO_MODE=true' platform/.env.production; then
    fail "platform/.env.production has NEXT_PUBLIC_DEMO_MODE=true — this seeds the full demo staff roster and exposes /api/demo-credentials. Set it to false for production."
  else
    ok "demo mode is off in platform/.env.production"
  fi
  # The JWT signing key must stay server-only. A NEXT_PUBLIC_ copy is baked into
  # the browser bundle, letting anyone with the client JS forge tokens for any role.
  if grep -qE '^NEXT_PUBLIC_JWT_SECRET=' platform/.env.production; then
    fail "platform/.env.production sets NEXT_PUBLIC_JWT_SECRET — the signing key must stay server-only (JWT_SECRET). Remove the public copy."
  else
    ok "JWT signing key is server-only in platform/.env.production"
  fi
fi
# Plaintext secret backups must never sit in the deploy tree (e.g. *.real.bak).
if ls platform/.env*.bak platform/.env*.real* >/dev/null 2>&1; then
  fail "plaintext secret backup file(s) present — delete before deploy:"
  ls platform/.env*.bak platform/.env*.real* 2>/dev/null | sed 's/^/      /'
else
  ok "no plaintext env backups in the deploy tree"
fi
echo

# ── 4. platform pipeline ─────────────────────────────────────────────────────
cyan "4/6 · platform: tsc + lint + jest"
(
  cd platform
  if npx --no-install tsc --noEmit >/tmp/preflight-tsc.log 2>&1; then
    ok "tsc --noEmit clean"
  else
    fail "tsc errors:"; sed 's/^/      /' /tmp/preflight-tsc.log | head -20
  fi
  if npm run --silent lint >/tmp/preflight-lint.log 2>&1; then
    ok "next lint clean"
  else
    fail "lint errors:"; tail -20 /tmp/preflight-lint.log | sed 's/^/      /'
  fi
  if npx --no-install jest --silent >/tmp/preflight-jest.log 2>&1; then
    pass=$(grep -E "Tests:" /tmp/preflight-jest.log | tail -1 | sed 's/^/      /' || true)
    ok "jest passed: $pass"
  else
    fail "jest failures:"; tail -30 /tmp/preflight-jest.log | sed 's/^/      /'
  fi
)
echo

# ── 5. workflow + compose YAML parse ─────────────────────────────────────────────
cyan "5/6 · workflow + compose YAML"
node -e "
const fs = require('fs');
const path = require('path');
const yaml = require(path.resolve('platform/node_modules/js-yaml'));
const targets = [
  '.github/workflows/ci.yml',
  '.github/workflows/deploy-staging.yml',
  '.github/workflows/deploy-production.yml',
  '.github/workflows/backups-cron.yml',
  'docker-compose.yml',
];
let bad = 0;
for (const f of targets) {
  if (!fs.existsSync(f)) { console.log('  ⚠ skip (missing):', f); continue; }
  try { yaml.load(fs.readFileSync(f,'utf8')); console.log('  ✓ '+f); }
  catch (e) { console.log('  ✗ '+f+': '+e.message); bad++; }
}
process.exit(bad ? 2 : 0);
" || failed=$((failed+1))
echo

# ── 6. sync-worker readiness ─────────────────────────────────────────────────
cyan "6/6 · sync-worker (CouchDB → /api/sync bridge)"
if [ -f platform/tools/sync-worker/index.mjs ]; then
  if node --check platform/tools/sync-worker/index.mjs >/dev/null 2>&1; then
    ok "platform/tools/sync-worker/index.mjs parses"
  else
    fail "platform/tools/sync-worker/index.mjs has a syntax error"
  fi
  if node --test platform/tools/sync-worker/index.test.mjs >/tmp/preflight-worker.log 2>&1; then
    pass=$(grep -Eo 'tests [0-9]+' /tmp/preflight-worker.log | tail -1 || true)
    ok "sync-worker tests pass${pass:+ ($pass)}"
  else
    fail "sync-worker tests failing:"
    tail -20 /tmp/preflight-worker.log | sed 's/^/      /'
  fi
else
  fail "platform/tools/sync-worker/ directory is missing — analytics will be empty after deploy"
fi
echo

# ── bootstrap credentials must not be lying around ───────────────────────────
# platform/.seed-credentials.json holds the auto-generated admin password in
# plaintext. It is written on first boot when ADMIN_INITIAL_PASSWORD is unset,
# and is supposed to be gone once the admin has logged in and changed it. If it
# still exists, either nobody has completed first login or the cleanup failed —
# both mean a usable admin credential is sitting on disk.
echo "Bootstrap credentials"
SEED_CRED_FILE="platform/.seed-credentials.json"
if [ -f "$SEED_CRED_FILE" ]; then
  fail "$SEED_CRED_FILE exists — plaintext admin password on disk. Complete first login and change the password, then: shred -u $SEED_CRED_FILE"
else
  ok "no plaintext bootstrap credentials on disk"
fi

# The off-site backup destination is not optional for anything holding PHI: a
# droplet failure with only local snapshots is unrecoverable data loss.
if [ -f .env ] && grep -q '^BACKUP_BUCKET=.\+' .env 2>/dev/null; then
  ok "BACKUP_BUCKET configured (off-site backups can run)"
elif [ -f .env ]; then
  fail "BACKUP_BUCKET is unset in .env — nightly dumps stay on the droplet only. A disk failure loses every record. See docs/operations/backups.md"
else
  warn "no .env found — cannot check BACKUP_BUCKET"
fi
echo

# ── summary ──────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────────────────────"
if [ "$failed" -eq 0 ]; then
  green "PREFLIGHT PASSED — $warned warning(s)"
  exit 0
else
  red   "PREFLIGHT FAILED — $failed error(s), $warned warning(s)"
  exit 1
fi
