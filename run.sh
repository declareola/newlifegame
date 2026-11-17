#!/usr/bin/env bash
# /home/user/run.sh
# Start NewLife, repairing anything the workspace snapshot does not keep.
#
# Three things this project needs are excluded from snapshots by design:
#   · client/node_modules and server/node_modules  (dependency directories)
#   · client/dist                                  (build output — what the server serves)
#   · ~/.cache/ms-playwright                       (only used by the test/screenshot scripts)
#
# So every session can start from a workspace where `node src/index.js` fails
# with ERR_MODULE_NOT_FOUND. This script checks for each, restores only what is
# missing, then starts the server in the foreground so the preview proxy sees it.
#
#   ./run.sh              start (installs/builds only what is missing)
#   ./run.sh --rebuild    force a fresh client build
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$ROOT/server"
CLIENT="$ROOT/client"
FORCE_BUILD="${1:-}"

say() { printf '\033[36m[newlife]\033[0m %s\n' "$*"; }

# ── Server dependencies ─────────────────────────────────────
if [ ! -d "$SERVER/node_modules" ]; then
  say "server dependencies missing — installing"
  (cd "$SERVER" && npm install --no-audit --no-fund --silent)
else
  say "server dependencies present"
fi

# ── Client dependencies ─────────────────────────────────────
if [ ! -d "$CLIENT/node_modules" ]; then
  say "client dependencies missing — installing"
  (cd "$CLIENT" && npm install --no-audit --no-fund --silent)
else
  say "client dependencies present"
fi

# ── Client build ────────────────────────────────────────────
# The server serves client/dist. Without it every route 404s with JSON, which
# looks exactly like a broken server.
if [ "$FORCE_BUILD" = "--rebuild" ] || [ ! -f "$CLIENT/dist/index.html" ]; then
  say "building the client"
  (cd "$CLIENT" && npx vite build >/dev/null)
  say "client built"
else
  say "client build present"
fi

# ── Run ─────────────────────────────────────────────────────
say "starting the server on :3000"
cd "$SERVER"
# NL_TEST_HOOKS=1 turns on the local test seams (POST /api/dev/heat) so the
# browser suites can put a real account in a real state. Off by default; the
# server refuses those routes entirely when NODE_ENV=production.
if [ "${NL_TEST_HOOKS:-0}" = "1" ]; then
  say "test hooks ON (NL_TEST_HOOKS=1)"
  export NL_TEST_HOOKS=1
fi

exec node src/index.js
