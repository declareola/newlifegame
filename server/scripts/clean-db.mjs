// server/scripts/clean-db.mjs
// Remove accounts created by the test suites.
//
// The integration tests register real accounts against the live server (they
// have to — every route is JWT-gated). Those accounts are real rows, and after
// a few sweeps they fill the leaderboard with ₦5,000,000 test users, which then
// makes leaderboard assertions fail for reasons that have nothing to do with
// the code.
//
//   node scripts/clean-db.mjs            # dry run, shows what would go
//   node scripts/clean-db.mjs --apply    # actually delete them
//
// Only usernames that match a test prefix are touched. Any name you registered
// by hand is left alone.

import { db } from '../src/db.js';

const TEST_PREFIXES = [
  'rich', 'poor', 'broke', 'alpha', 'bravo', 'charlie', 'delta',
  'world', 'dbg', 'uitest', 'smoke', 'watch', 'interv', 'finalcheck',
  'rot', 'shift', 'test', 'evil', 'hack', 'spam', 'race', 'dup',
];

const apply = process.argv.includes('--apply');

const users = db.prepare('SELECT id, username, tier, cash FROM users').all();
const victims = users.filter((u) =>
  TEST_PREFIXES.some((p) => u.username.toLowerCase().startsWith(p))
);

console.log(`${users.length} accounts, ${victims.length} look like test accounts.`);
if (victims.length === 0) process.exit(0);

if (!apply) {
  console.log(victims.slice(0, 20).map((v) => `  ${v.id} ${v.username} (${v.tier})`).join('\n'));
  if (victims.length > 20) console.log(`  … and ${victims.length - 20} more`);
  console.log('\nDry run. Re-run with --apply to delete.');
  process.exit(0);
}

// Tables that reference a user id. Everything else is either global or keyed
// by property id.
const USER_TABLES = [
  'inventory',
  'missions',
  'vehicles',
  'user_properties',
  'transactions',
  'sessions',
];

const wipe = db.transaction((ids) => {
  for (const id of ids) {
    for (const table of USER_TABLES) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id);
      } catch {
        // Table may not exist in an older database — nothing to clean there.
      }
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
});

wipe(victims.map((v) => v.id));
console.log(`Deleted ${victims.length} test accounts and their rows.`);
