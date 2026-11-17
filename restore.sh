#!/usr/bin/env bash
# restore.sh — put a backup back, and prove it went back correctly.
#
# This refuses to restore anything it cannot verify. Every file in the archive
# is checked against the sha256 recorded in MANIFEST.txt at backup time; if one
# byte is wrong, it stops before touching your workspace.
#
# Usage:
#   ./restore.sh backups/newlife-<stamp>.tar.gz --verify-only   # check only
#   ./restore.sh backups/newlife-<stamp>.tar.gz --into /tmp/x   # restore elsewhere
#   ./restore.sh backups/newlife-<stamp>.tar.gz                 # restore in place
#
# Restoring in place does NOT delete files that are absent from the backup; it
# overwrites what the backup contains. The database is replaced as a set
# (db + -wal + -shm removed first), because leaving a stale WAL next to a
# restored database is how a restore silently corrupts data.

set -euo pipefail
cd "$(dirname "$0")"

ARCHIVE="${1:-}"
MODE="in-place"
TARGET=""
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --verify-only) MODE="verify"; shift ;;
    --into) TARGET="${2:?--into needs a directory}"; MODE="elsewhere"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$ARCHIVE" ]; then
  echo "usage: ./restore.sh <archive.tar.gz> [--verify-only | --into DIR]" >&2
  echo
  echo "available archives:"
  ls -1t backups/newlife-*.tar.gz 2>/dev/null | sed 's/^/  /' || echo "  (none — run ./backup.sh)"
  exit 2
fi
[ -f "$ARCHIVE" ] || { echo "no such archive: $ARCHIVE" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "▸ Unpacking $(basename "$ARCHIVE")"
tar -xzf "$ARCHIVE" -C "$STAGE"
ROOT="$(find "$STAGE" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$ROOT" ] || { echo "archive has unexpected layout" >&2; exit 1; }

# ── Verify every checksum before doing anything else ────────────
echo "▸ Verifying checksums"
if [ ! -f "$ROOT/MANIFEST.txt" ]; then
  echo "REFUSING: no MANIFEST.txt — cannot verify this archive" >&2
  exit 1
fi
if ! ( cd "$ROOT" && sha256sum -c --quiet MANIFEST.txt ); then
  echo "REFUSING: checksum mismatch — this archive is damaged" >&2
  exit 1
fi
COUNT="$(wc -l < "$ROOT/MANIFEST.txt" | tr -d ' ')"
echo "  $COUNT files, all checksums match"

# ── Verify the database inside it, not just its bytes ───────────
DB="$ROOT/server/data/newlife.db"
if [ -f "$DB" ]; then
  echo "▸ Verifying database snapshot"
  if command -v node >/dev/null && [ -d server/node_modules ]; then
    node --input-type=module -e "
      import Database from '/home/user/server/node_modules/better-sqlite3/lib/index.js';
      const db = new Database('$DB', { readonly: true, fileMustExist: true });
      const ok = db.pragma('integrity_check', { simple: true });
      const tables = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").all();
      const counts = tables.map((t) => t.name + '=' + db.prepare('SELECT COUNT(*) c FROM \"' + t.name + '\"').get().c);
      db.close();
      if (ok !== 'ok') { console.error('integrity_check: ' + ok); process.exit(1); }
      console.log('  ' + counts.join(', '));
    " || { echo "REFUSING: database inside the archive failed its integrity check" >&2; exit 1; }
  else
    echo "  (node_modules not installed, skipping a live open — checksums still verified)"
  fi
fi

if [ "$MODE" = "verify" ]; then
  echo
  echo "✓ Archive is intact and restorable. Nothing was changed."
  exit 0
fi

# ── Where to put it ─────────────────────────────────────────────
if [ "$MODE" = "elsewhere" ]; then
  mkdir -p "$TARGET"
  cp -a "$ROOT/." "$TARGET/"
  rm -f "$TARGET/MANIFEST.txt" "$TARGET/BACKUP-INFO.txt"
  echo "✓ Restored into $TARGET"
  echo "  Start it with: cd $TARGET && PORT=3000 bash preview.sh"
  exit 0
fi

# ── In place ────────────────────────────────────────────────────
echo "▸ Restoring into $(pwd)"

# Stop anything holding the database, so a running server cannot overwrite the
# restored file the moment we finish.
if pgrep -f "node src/index.js" > /dev/null 2>&1; then
  echo "  stopping the running server"
  pkill -f "node src/index.js" || true
  sleep 1
fi

# Database as a set, with a safety copy of what is being replaced.
if [ -f "$ROOT/server/data/newlife.db" ]; then
  mkdir -p server/data
  if [ -f server/data/newlife.db ]; then
    SAFE="server/data/newlife.db.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -a server/data/newlife.db "$SAFE"
    echo "  current database saved as $(basename "$SAFE")"
  fi
  rm -f server/data/newlife.db server/data/newlife.db-wal server/data/newlife.db-shm
fi

# .env is a secret; keep the one on disk if the archive somehow lacks it.
(cd "$ROOT" && find . -type f -not -name MANIFEST.txt -not -name BACKUP-INFO.txt -not -path './server/data/*' -print0) \
  | (cd "$ROOT" && xargs -0 -I{} cp -a --parents {} "$OLDPWD/" 2>/dev/null || true)

# The loop above runs in the archive root, so restore relative to the workspace.
cd "$ROOT"
find . -type f -not -name MANIFEST.txt -not -name BACKUP-INFO.txt -not -path './server/data/*' -print0 \
  | while IFS= read -r -d '' f; do
      dest="/home/user/${f#./}"
      mkdir -p "$(dirname "$dest")"
      cp -a "$f" "$dest"
    done

# Database last, from the verified snapshot.
if [ -f "$DB" ]; then
  cp -a "$DB" /home/user/server/data/newlife.db
  echo "  database restored ($(du -h /home/user/server/data/newlife.db | cut -f1))"
fi

echo
echo "✓ Restored $COUNT files from $(basename "$ARCHIVE")"
echo "  Rebuild and start with: PORT=3000 bash preview.sh"
