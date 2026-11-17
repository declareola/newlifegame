#!/usr/bin/env bash
# backup.sh — one command, everything that cannot be regenerated.
#
# What goes in:
#   · every source file (client/src, server/src, server/config, scripts, docs)
#   · server/.env  — the JWT secret and DB path
#   · a transactionally-consistent snapshot of the SQLite database, taken with
#     SQLite's own backup API so the WAL is included (see server/tools/db-snapshot.mjs)
#   · the downloaded CC0 assets (11 MB — these are content, not build output)
#   · the screenshots
#   · MANIFEST.txt with a sha256 of every file, so a restore can prove it
#
# What is deliberately left out, because it is rebuildable from package.json:
#   node_modules/, client/dist/, .cache/, any existing backups/
#
# Usage:
#   ./backup.sh              # writes backups/newlife-<timestamp>.tar.gz
#   ./backup.sh --keep 20    # how many archives to retain (default 2)
#   ./backup.sh --slim       # leave screenshots out (they are re-shootable)
#   ./backup.sh --quiet      # only print the archive path

set -euo pipefail
cd "$(dirname "$0")"

# Retention is deliberately small. Each archive is ~36 MB and the workspace
# snapshot that persists this sandbox is capped around 128 MB — ten archives of
# 36 MB would push the workspace over that cap and put EVERYTHING at risk,
# including the source. Two generations plus a copy you download offsite is the
# safer shape. Override with --keep if you are backing up to a real disk.
KEEP=2
QUIET=0
SLIM=0
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) KEEP="${2:?--keep needs a number}"; shift 2 ;;
    --slim) SLIM=1; shift ;;
    --quiet) QUIET=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { [ "$QUIET" = 1 ] || echo "$@"; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="backups"
NAME="newlife-$STAMP"
ARCHIVE="$OUT_DIR/$NAME.tar.gz"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
PAYLOAD="$STAGE/$NAME"
mkdir -p "$PAYLOAD" "$OUT_DIR"

say "▸ Backing up NewLife — $STAMP"

# ── 1. Everything that is not rebuildable ───────────────────────
# This is an EXCLUSION list, not a whitelist, and that is deliberate. The first
# version of this script listed what to include, and it silently missed
# client/index.html, client/vite.config.js and server/scripts/ — the restore
# then would not build. A whitelist fails by omission and nobody notices until
# the day it matters. Excluding only the rebuildable things means a file added
# next week is backed up without anyone remembering to add it here.
# Caches and package stores, including the ones this sandbox keeps in $HOME.
# .npm alone was 30 MB of tarballs that npm can fetch again for free.
SKIP_PATTERNS=(
  ./backups
  ./node_modules
  ./client/node_modules
  ./server/node_modules
  ./client/dist
  ./.cache
  ./client/.cache
  ./.npm
  ./.local
  ./.arena
  ./.playwright-cli
  ./.git
  ./uploads/tmp
  # Backup metadata belongs inside the archive, never in the workspace. A
  # restore once scattered it here and the next backup then rewrote it after
  # computing checksums, which made every later archive fail verification.
  ./BACKUP-INFO.txt
  ./MANIFEST.txt
)
say "  copying everything except rebuildables…"
TAR_EXCLUDES=()
for pat in "${SKIP_PATTERNS[@]}"; do
  TAR_EXCLUDES+=(--exclude="$pat")
done
# The WAL and SHM are copied in step 2 as part of a verified snapshot instead;
# copying them raw here would give us a half-committed database next to it.
TAR_EXCLUDES+=(--exclude='*.db-wal' --exclude='*.db-shm' --exclude='*.db.pre-restore.*')
if [ "$SLIM" = 1 ]; then
  # Screenshots are regenerable from the harnesses, which are in the archive.
  TAR_EXCLUDES+=(--exclude='./client/screenshots')
  say "  (slim: screenshots excluded)"
fi

tar -cf - "${TAR_EXCLUDES[@]}" -C /home/user . | tar -xf - -C "$PAYLOAD"

# Sanity: the two files whose absence broke the first restore.
for must in client/index.html client/vite.config.js server/package.json; do
  [ -f "$PAYLOAD/$must" ] || { echo "BACKUP FAILED: $must missing from payload" >&2; exit 1; }
done

PAYLOAD_SIZE="$(du -sm "$PAYLOAD" | cut -f1)"
if [ "$PAYLOAD_SIZE" -gt 120 ]; then
  echo "  warning: payload is ${PAYLOAD_SIZE} MB — check for something that should be excluded" >&2
fi

# ── 2. A consistent database snapshot ───────────────────────────
mkdir -p "$PAYLOAD/server/data"
if [ -f server/data/newlife.db ]; then
  say "  snapshotting database (WAL-aware)…"
  if ! node server/tools/db-snapshot.mjs server/data/newlife.db "$PAYLOAD/server/data/newlife.db" > "$STAGE/dbcheck.json"; then
    echo "BACKUP FAILED: the database snapshot did not verify" >&2
    cat "$STAGE/dbcheck.json" >&2
    exit 1
  fi
  cp "$STAGE/dbcheck.json" "$PAYLOAD/server/data/db-snapshot-report.json"
  say "    $(node -e "const r=require('$STAGE/dbcheck.json');console.log('tables: '+Object.entries(r.tables).map(([t,n])=>t+'='+n).join(', '))")"
else
  echo "  note: no database yet, skipping" >&2
fi

# ── 3. A manifest we can verify against ─────────────────────────
# Order matters here. The manifest is built first, then BACKUP-INFO.txt is
# written (it needs the count), then the info file's own checksum is APPENDED to
# the manifest. That way every file in the archive is covered by exactly the
# manifest we verify against — including the metadata files themselves.
say "  writing manifest…"
FILE_COUNT="$(cd "$PAYLOAD" && find . -type f -not -name MANIFEST.txt -not -name BACKUP-INFO.txt | wc -l | tr -d ' ')"

(
  cd "$PAYLOAD"
  find . -type f -not -name MANIFEST.txt -not -name BACKUP-INFO.txt -print0 \
    | sort -z \
    | xargs -0 sha256sum
) > "$PAYLOAD/MANIFEST.txt"

cat > "$PAYLOAD/BACKUP-INFO.txt" <<INFO
NewLife backup
  taken:      $STAMP (UTC)
  host:       $(uname -srm)
  payload:    $FILE_COUNT files (plus this file and MANIFEST.txt)
  contents:   source, config, .env, database snapshot, assets, screenshots
  excluded:   node_modules/, client/dist/, .cache/, .npm/ (rebuildable)
  restore:    ./restore.sh $ARCHIVE
  verify:     ./restore.sh $ARCHIVE --verify-only
INFO

(cd "$PAYLOAD" && sha256sum ./BACKUP-INFO.txt >> MANIFEST.txt)

TOTAL_FILES="$(wc -l < "$PAYLOAD/MANIFEST.txt" | tr -d ' ')"

# ── 4. Pack it ──────────────────────────────────────────────────
say "  packing…"
tar -czf "$ARCHIVE" -C "$STAGE" "$NAME"

# Verify the archive itself reads back, before we trust it.
if ! tar -tzf "$ARCHIVE" > /dev/null 2>&1; then
  echo "BACKUP FAILED: archive is not readable" >&2
  exit 1
fi

# ── 5. Rotation ─────────────────────────────────────────────────
mapfile -t OLD < <(ls -1t "$OUT_DIR"/newlife-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) || true)
for f in "${OLD[@]:-}"; do
  [ -n "${f:-}" ] && [ -f "$f" ] && rm -f "$f" && say "  rotated out $(basename "$f")"
done

TOTAL_MB="$(du -sm "$OUT_DIR" 2>/dev/null | cut -f1)"
if [ "${TOTAL_MB:-0}" -gt 90 ]; then
  echo "  warning: $OUT_DIR is ${TOTAL_MB} MB. The workspace snapshot is capped" >&2
  echo "  near 128 MB — download an archive and lower --keep before it bites." >&2
fi

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
SUM="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"

if [ "$QUIET" = 1 ]; then
  echo "$ARCHIVE"
else
  echo
  echo "✓ Backup complete"
  echo "  archive: $ARCHIVE"
  echo "  size:    $SIZE   files: $TOTAL_FILES   ($OUT_DIR holds ${TOTAL_MB:-?} MB total)"
  echo "  sha256:  $SUM"
  echo
  echo "  Restoring is ./restore.sh $ARCHIVE"
  echo "  A copy of this file is only safe once it is OFF this machine — download it."
fi
