#!/usr/bin/env bash
# pmPloy setup: pre-flight checks + .env bootstrap with generated secrets.
set -euo pipefail

cd "$(dirname "$0")/.."

GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
DIM="\033[2m"
RESET="\033[0m"

ok()    { printf "${GREEN}✓${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}!${RESET} %s\n" "$1"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$1"; }
note()  { printf "${DIM}  %s${RESET}\n" "$1"; }

echo "pmPloy setup"
echo "------------"

# --- pre-flight ---
missing=0

check() {
  local name="$1" cmd="$2" hint="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    ok "$name found: $($cmd --version 2>/dev/null | head -n1 || echo present)"
  else
    fail "$name not found"
    note "$hint"
    missing=1
  fi
}

check "Bun"     "bun"   "Install: curl -fsSL https://bun.sh/install | bash"
check "git"     "git"   "Install via your package manager"
check "MongoDB" "mongod" "Install: https://www.mongodb.com/docs/manual/installation/"
check "PM2"     "pm2"   "Install: npm install -g pm2"
check "Caddy"   "caddy" "Install: https://caddyserver.com/docs/install"

if [ "$missing" -ne 0 ]; then
  echo
  warn "Some tools are missing. pmPloy can still install, but the runtime will need them."
fi

# --- .env bootstrap ---
echo
if [ -f .env ]; then
  ok ".env already exists — leaving it untouched"
else
  cp .env.example .env
  jwt_secret="$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | xxd -p -c 64)"
  enc_key="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)"

  # macOS sed needs an empty -i argument; use a portable temp-file approach.
  awk -v jwt="$jwt_secret" -v enc="$enc_key" '
    BEGIN { jset=0; eset=0 }
    /^JWT_SECRET=/        { print "JWT_SECRET=" jwt;            jset=1; next }
    /^ENV_ENCRYPTION_KEY=/{ print "ENV_ENCRYPTION_KEY=" enc;   eset=1; next }
    { print }
    END {
      if (!jset) print "JWT_SECRET=" jwt
      if (!eset) print "ENV_ENCRYPTION_KEY=" enc
    }
  ' .env > .env.tmp && mv .env.tmp .env

  ok "Wrote .env with generated JWT_SECRET + ENV_ENCRYPTION_KEY"
fi

# --- install ---
echo
ok "Running bun install"
bun install

echo
ok "Done. Next steps:"
note "1. Start MongoDB (e.g. \`mongod\`) and Caddy (e.g. \`caddy run\`)"
note "2. Optional: register a GitHub App and fill GITHUB_* keys in .env"
note "3. \`bun run dev\` — API on http://localhost:4000, web on http://localhost:5173"
