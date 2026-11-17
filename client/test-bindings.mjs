// client/test-bindings.mjs
// Static audit of every keyboard binding in the client.
//
// The brief requires that no two features claim the same key, so this reads the
// source files, extracts each `e.code === 'KeyX'` / `e.key === 'x'` test, and
// checks the result against one declared ownership table. If a binding is added
// without being registered here, the test fails — which is the point.
//
//   cd client && node test-bindings.mjs

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('./src/', import.meta.url).pathname;

// ── Declared ownership ───────────────────────────────────────
// key -> { owner, why }
const OWNERS = {
  KeyW: 'PlayerController (walk) / VehicleSystem (throttle)',
  KeyA: 'PlayerController (strafe) / VehicleSystem (steer)',
  KeyS: 'PlayerController (walk) / VehicleSystem (reverse)',
  KeyD: 'PlayerController (strafe) / VehicleSystem (steer)',
  ArrowUp: 'PlayerController (walk, alternative)',
  ArrowDown: 'PlayerController (walk, alternative)',
  ArrowLeft: 'PlayerController (walk, alternative)',
  ArrowRight: 'PlayerController (walk, alternative)',
  ShiftLeft: 'PlayerController (sprint)',
  ShiftRight: 'PlayerController (sprint)',
  Space: 'PlayerController (jump) / VehicleSystem (brake)',
  KeyC: 'PlayerController (crouch)',
  KeyV: 'main.js (camera mode)',
  KeyQ: 'main.js (graphics quality)',
  KeyE: 'InteriorSystem / InteractionSystem / NPCSystem (single dispatch in main.js)',
  KeyF: 'VehicleSystem (enter/leave vehicle)',
  Tab: 'InventoryPanel (inventory)',
  KeyM: 'MapSystem (world map)',
  KeyJ: 'MissionJournal (mission journal)',
  KeyK: 'main.js (job board)',
  KeyG: 'main.js (activities)',
  KeyH: 'main.js (property / housing)',
  KeyL: 'main.js (leaderboard)',
  KeyI: 'CharacterPanel (character sheet)',
  Escape: 'PauseMenu (guarded: closes open panels first)',
  F1: 'ControlsGuide (reopen the guide)',
  F2: 'main.js (visual tuning panel)',
  Enter: 'Chat (open / send)',
  KeyT: 'Chat (open)',
  // Round 7 look-and-feel: modifier-qualified, so they cannot collide with the
  // unmodified M (map) or R (nothing else claims R).
  'Shift+KeyM': 'main.js (mute all sound)',
  'Shift+KeyR': 'main.js (force rain on/off)',
  KeyR: 'main.js (reserved: rain toggle requires Shift)',
};

// Files that are not part of the live game and are allowed to mention keys
const IGNORED = new Set(['ui/Controls.js']);

/**
 * A keydown handler can be qualified by a modifier test in the same block.
 * `Shift+M` (mute) is a different binding from `M` (world map) — treating them
 * as the same key made this audit report a conflict that does not exist.
 * The modifier is detected from the `e.shiftKey` / `e.ctrlKey` / `e.altKey`
 * guard on the lines around the key test.
 */
function modifierFor(lines, index) {
  const from = Math.max(0, index - 4);
  const to = Math.min(lines.length, index + 3);
  const window = lines.slice(from, to).join('\n');
  if (/e\.shiftKey\s*&&|&&\s*e\.shiftKey|!e\.shiftKey\s*\)\s*return/.test(window)) return 'Shift+';
  if (/e\.ctrlKey\s*&&|&&\s*e\.ctrlKey/.test(window)) return 'Ctrl+';
  if (/e\.altKey\s*&&|&&\s*e\.altKey/.test(window)) return 'Alt+';
  return '';
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = await walk(ROOT);
const found = new Map(); // key -> [{file, line, snippet}]

const PATTERNS = [
  /e\.code\s*[!=]==\s*'(Key[A-Z]|Arrow[A-Za-z]+|Shift[A-Za-z]+|Space|Tab|Escape|F\d{1,2}|Enter|Backspace)'/g,
  /keys\[\s*'(Key[A-Z]|Arrow[A-Za-z]+)'\s*\]/g,
  /e\.key\s*[!=]==\s*'([a-zA-Z]|Escape|Enter)'/g,
  /e\.key\.toLowerCase\(\)\s*===\s*'([a-zA-Z])'/g,
  /\[\s*'([a-zA-Z])'\s*,\s*'([A-Z])'\s*\]\.includes\(e\.key\)/g,
];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (IGNORED.has(rel)) continue;
  const src = await readFile(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(line)) !== null) {
        let key = m[1];
        if (/^[a-z]$/.test(key)) key = `Key${key.toUpperCase()}`;
        else if (/^[A-Z]$/.test(key)) key = `Key${key}`;
        key = `${modifierFor(lines, i)}${key}`;
        if (!found.has(key)) found.set(key, []);
        found.get(key).push({ file: rel, line: i + 1, snippet: line.trim().slice(0, 70) });
      }
    }
  });
}

// ── Report ───────────────────────────────────────────────────
let problems = 0;

console.log('Binding map\n------------');
const sorted = [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]));
for (const [key, places] of sorted) {
  const owner = OWNERS[key];
  const files = [...new Set(places.map((p) => p.file))].join(', ');
  if (!owner) {
    problems++;
    console.log(`  ❌ ${key.padEnd(10)} undocumented — used in ${files}`);
  } else {
    console.log(`  ✅ ${key.padEnd(10)} ${owner}`);
    console.log(`     ${places.length} handler(s) in ${files}`);
  }
}

// Every declared key that no longer exists is a stale entry, not a failure —
// but it should be visible.
const stale = Object.keys(OWNERS).filter((k) => !found.has(k));
if (stale.length) {
  console.log(`\nNo longer bound: ${stale.join(', ')}`);
}

// ── Conflict check ───────────────────────────────────────────
// A conflict is two *different features* claiming the same key in different
// systems without a guard. The known, intentional sharing is listed here.
const SHARED_BY_DESIGN = {
  Escape: [
    'PauseMenu', 'SessionMenu', 'Chat', 'InventoryPanel', 'DialogueUI',
    'ActionBar', 'ControlsGuide', 'InteractionSystem',
  ], // every handler is guarded by "am I the thing that is open?"
  KeyE: ['InteriorSystem', 'InteractionSystem', 'NPCSystem'], // main.js dispatches one of them
  KeyW: ['PlayerController', 'VehicleSystem'],                // only one is active at a time
  KeyA: ['PlayerController', 'VehicleSystem'],
  KeyS: ['PlayerController', 'VehicleSystem'],
  KeyD: ['PlayerController', 'VehicleSystem'],
  Space: ['PlayerController', 'VehicleSystem'],
  ArrowUp: ['PlayerController', 'VehicleSystem'],
  ArrowDown: ['PlayerController', 'VehicleSystem'],
  ArrowLeft: ['PlayerController', 'VehicleSystem'],
  ArrowRight: ['PlayerController', 'VehicleSystem'],
  Enter: ['Chat', 'SessionMenu'], // SessionMenu only while its password field has focus
};

console.log('\nConflict check\n--------------');
for (const [key, places] of sorted) {
  const files = [...new Set(places.map((p) => p.file))];
  if (files.length <= 1) continue;
  if (!SHARED_BY_DESIGN[key]) {
    problems++;
    console.log(`  ❌ ${key} is handled in ${files.length} files: ${files.join(', ')}`);
  } else {
    console.log(`  ✅ ${key} shared by design (${SHARED_BY_DESIGN[key].join(' / ')})`);
  }
}

// ── Required keys from the brief ─────────────────────────────
const REQUIRED = {
  KeyW: 'move', KeyA: 'move', KeyS: 'move', KeyD: 'move',
  ShiftLeft: 'sprint', Space: 'jump', KeyC: 'crouch', KeyE: 'interact',
  KeyF: 'vehicle', Tab: 'inventory', KeyM: 'map', KeyJ: 'missions',
  Escape: 'pause', KeyI: 'character',
};

console.log('\nRequired bindings from the brief\n--------------------------------');
for (const [key, what] of Object.entries(REQUIRED)) {
  if (found.has(key)) {
    console.log(`  ✅ ${key.padEnd(10)} ${what}`);
  } else {
    problems++;
    console.log(`  ❌ ${key.padEnd(10)} ${what} — NOT BOUND`);
  }
}

console.log('\n=========================');
console.log(problems === 0
  ? `OK: ${sorted.length} keys, no undocumented or conflicting bindings`
  : `FAILED: ${problems} problem(s)`);
console.log('=========================\n');

process.exit(problems ? 1 : 0);
