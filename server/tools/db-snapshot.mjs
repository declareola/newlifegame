#!/usr/bin/env node
// server/tools/db-snapshot.mjs
//
// Take a consistent copy of the live SQLite database.
//
// Why this file exists: the game runs SQLite in WAL mode, so `newlife.db` on
// its own is NOT the whole database. Recent commits live in `newlife.db-wal`
// until a checkpoint happens — at the time this was written the main file was
// 143 KB and the WAL beside it was 4.1 MB, i.e. roughly 97% of the data was in
// the WAL. Copying just `newlife.db` (the obvious thing to do) would have
// silently rolled the game back in time. That is precisely the "lost data"
// failure a backup is supposed to prevent.
//
// So we use SQLite's own online backup API, which takes a read lock and copies
// a transactionally-consistent snapshot including everything in the WAL,
// without stopping the server. It also runs `PRAGMA integrity_check` on the
// copy before we call it good.
//
// Usage:
//   node tools/db-snapshot.mjs <source.db> <destination.db>

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: node tools/db-snapshot.mjs <source.db> <destination.db>');
  process.exit(2);
}
if (!fs.existsSync(src)) {
  console.error(`no database at ${src}`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
for (const suffix of ['', '-wal', '-shm']) {
  if (fs.existsSync(dest + suffix)) fs.unlinkSync(dest + suffix);
}

const db = new Database(src, { readonly: true, fileMustExist: true });

// Count what is in the live database, so the caller can prove the snapshot has
// the same rows afterwards rather than just assuming it does.
function census(handle) {
  const tables = handle
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((t) => t.name);
  const counts = {};
  for (const t of tables) counts[t] = handle.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c;
  return counts;
}

const before = census(db);

await db.backup(dest);
db.close();

// Verify the copy on its own terms: it must open, pass an integrity check, and
// hold the same rows we counted a moment ago.
const copy = new Database(dest, { readonly: true, fileMustExist: true });
const integrity = copy.pragma('integrity_check', { simple: true });
const after = census(copy);
copy.close();

const mismatched = Object.keys(before).filter((t) => before[t] !== after[t]);
const result = {
  ok: integrity === 'ok' && mismatched.length === 0,
  integrity,
  tables: before,
  mismatched,
  bytes: fs.statSync(dest).size,
};

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
