#!/usr/bin/env bash
# pmPloy self-updater. Invoked detached by the API at the user's request.
#
# Usage:
#   scripts/update.sh                 # fast-forward to origin/<current-branch>
#   scripts/update.sh <git-ref>       # checkout to a specific sha/tag/branch
#
# Honours env (passed through by the API):
#   PMPLOY_DATA_DIR  — where api.pid + update.pid + update.log live
#   PMPLOY_REPO_PATH — repo to update (defaults to script's parent dir)
set -uo pipefail

REPO="${PMPLOY_REPO_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA="${PMPLOY_DATA_DIR:-$REPO/.pmploy-data}"
mkdir -p "$DATA"
LOG="$DATA/update.log"
LOCK="$DATA/update.pid"
PID_FILE="$DATA/api.pid"

TARGET="${1:-}"

log() {
  printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"
}

# --- Truncate the log for this run so the UI shows fresh output.
: > "$LOG"

# --- Lockfile guard.
if [ -e "$LOCK" ]; then
  prev=$(cat "$LOCK" 2>/dev/null || echo "?")
  if kill -0 "$prev" 2>/dev/null; then
    log "✗ another update is already running (pid $prev)"
    exit 2
  fi
  # stale lock
  rm -f "$LOCK"
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

cd "$REPO" || { log "✗ cannot cd to $REPO"; exit 1; }

# systemd spawns the API with a minimal PATH, which the API in turn passes to
# this script. Re-add the common bun install locations so `bun install` works.
export PATH="$HOME/.bun/bin:/usr/local/bin:$PATH"

log "▶ pmploy self-update starting in $REPO"
log "▶ HEAD before: $(git rev-parse --short HEAD 2>/dev/null || echo '?')"

# --- Safety checks.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  log "✗ working tree is dirty, refusing to update"
  log "  resolve local changes or rollback via the operator's shell:"
  log "    git -C $REPO status"
  exit 3
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
  log "✗ detached HEAD; cannot fast-forward without an explicit target"
  if [ -z "$TARGET" ]; then exit 4; fi
fi

log "▶ fetching origin"
if ! git fetch --prune origin >>"$LOG" 2>&1; then
  log "✗ git fetch failed"
  exit 5
fi

if [ -n "$TARGET" ]; then
  log "▶ checking out $TARGET"
  if ! git checkout --quiet "$TARGET" >>"$LOG" 2>&1; then
    log "✗ git checkout $TARGET failed"
    exit 6
  fi
else
  log "▶ fast-forwarding $branch to origin/$branch"
  if ! git merge --ff-only "origin/$branch" >>"$LOG" 2>&1; then
    log "✗ fast-forward failed (history diverged?)"
    exit 7
  fi
fi

log "▶ HEAD after:  $(git rev-parse --short HEAD)"

# --- bun install.
if ! command -v bun >/dev/null 2>&1; then
  log "✗ bun not on PATH and not at \$HOME/.bun/bin — install bun for the user running pmploy-api"
  exit 8
fi
log "▶ bun install ($(command -v bun))"
if ! bun install >>"$LOG" 2>&1; then
  log "✗ bun install failed"
  exit 8
fi

# --- Build the frontend.
log "▶ building web bundle"
if ! bun --filter @pmploy/web build >>"$LOG" 2>&1; then
  log "✗ web build failed"
  exit 9
fi

# --- Restart the API. The API process owns its own PID file. Sending TERM
#     causes systemd's Restart=on-failure to bring the new code up.
if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    log "▶ signalling pmploy-api (pid $pid) to restart"
    kill -TERM "$pid" 2>>"$LOG" || true
  else
    log "! api.pid points at a dead process — relying on systemd to start it"
  fi
else
  log "! no api.pid file found at $PID_FILE; the new code will run on next manual restart"
fi

log "✓ update complete"
exit 0
