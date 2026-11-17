#!/usr/bin/env bash
# preview.sh — bring the whole game back up on port 3000 in one command.
#
# Why this exists: workspace snapshots exclude node_modules and dist, so after a
# sandbox restart the server cannot boot (no deps) and the game page has nothing
# to serve (no build). This script repairs whatever is missing and then runs the
# server in the foreground, which is what a preview process needs.
#
#   ./preview.sh            # repair as needed, then serve on :3000
#   ./preview.sh --rebuild  # force a fresh client build
#   ./preview.sh --check    # report state and exit (no build, no serve)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$ROOT/server"
CLIENT="$ROOT/client"
PORT="${PORT:-3000}"

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

FORCE_REBUILD=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) FORCE_REBUILD=1 ;;
    --check)   CHECK_ONLY=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ── 1. Dependencies ──────────────────────────────────────────────
step "Dependencies"
if [ -d "$SERVER/node_modules" ]; then
  ok "server deps present"
else
  warn "server/node_modules missing — installing"
  ( cd "$SERVER" && npm install --no-audit --no-fund )
fi

if [ -d "$CLIENT/node_modules" ]; then
  ok "client deps present"
else
  warn "client/node_modules missing — installing"
  ( cd "$CLIENT" && npm install --no-audit --no-fund )
fi

# better-sqlite3 ships a native binding that can be present-but-unusable after a
# restore; a real query is the only honest check.
if ( cd "$SERVER" && node -e "
  const D = require('better-sqlite3');
  const d = new D(':memory:');
  d.exec('create table t(a)'); d.prepare('insert into t values(1)').run();
  if (d.prepare('select count(*) c from t').get().c !== 1) process.exit(1);
" >/dev/null 2>&1 ); then
  ok "sqlite native binding works"
else
  warn "better-sqlite3 unusable — rebuilding it"
  ( cd "$SERVER" && npm rebuild better-sqlite3 --build-from-source )
fi

# ── 2. Client build ──────────────────────────────────────────────
# The server serves client/dist. Rebuild if it is missing, or if any source file
# is newer than the newest asset.
step "Client build"
NEWEST_ASSET=""
if [ -d "$CLIENT/dist/assets" ]; then
  NEWEST_ASSET="$(find "$CLIENT/dist/assets" -type f -printf '%T@\n' 2>/dev/null | sort -n | tail -1)"
fi
NEWER_SRC="$(find "$CLIENT/src" "$CLIENT/index.html" -type f -newermt "@${NEWEST_ASSET:-0}" 2>/dev/null | head -1)"

if [ -z "$NEWEST_ASSET" ]; then
  warn "client/dist missing — building"
  ( cd "$CLIENT" && npx vite build )
elif [ -n "$NEWER_SRC" ] || [ "$FORCE_REBUILD" = "1" ]; then
  warn "client sources changed (or --rebuild) — rebuilding"
  ( cd "$CLIENT" && npx vite build )
else
  ok "client/dist is up to date"
fi

# ── 3. Runtime prerequisites ─────────────────────────────────────
step "Runtime"
[ -f "$SERVER/.env" ] && ok "server/.env present" || warn "server/.env missing (secret.js will generate one)"
mkdir -p "$SERVER/data"
ok "data directory ready"

if [ "$CHECK_ONLY" = "1" ]; then
  step "Check only — not starting the server"
  exit 0
fi

# ── 4. Serve ─────────────────────────────────────────────────────
# Refuse to start on a port that already has a listener, rather than crashing
# with EADDRINUSE halfway through boot.
if ( exec 3<>"/dev/tcp/127.0.0.1/$PORT" ) 2>/dev/null; then
  exec 3>&- 2>/dev/null || true
  echo
  echo "Port $PORT is already in use — something is already serving there." >&2
  echo "Stop it first, or run with a different port:  PORT=3001 ./preview.sh" >&2
  exit 1
fi

step "Serving on http://0.0.0.0:$PORT"
cd "$SERVER"
exec node src/index.js
