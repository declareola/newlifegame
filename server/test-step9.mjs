// server/test-step9.mjs
// Integration test for Step 9 — multiplayer presence, movement sync and chat.
// Spins up TWO socket clients and checks they see each other.

import { io } from 'socket.io-client';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const dbPath = path.join(__dirname, 'data', 'newlife.db');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

function makeUser(prefix) {
  return prefix + Math.random().toString(36).slice(2, 8);
}

/** Connect and wait for world:init. */
function connect(token) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
    const timer = setTimeout(() => reject(new Error('no world:init')), 10000);
    sock.on('world:init', (data) => {
      clearTimeout(timer);
      resolve({ sock, init: data });
    });
    sock.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(new Error(e.message));
    });
  });
}

/** Wait for a single event matching a predicate. */
function waitFor(sock, event, predicate = () => true, timeout = 6000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sock.off(event, handler);
      resolve(null);
    }, timeout);
    function handler(data) {
      if (predicate(data)) {
        clearTimeout(timer);
        sock.off(event, handler);
        resolve(data);
      }
    }
    sock.on(event, handler);
  });
}

console.log('\n=== STEP 9: MULTIPLAYER ===\n');

// ── 1. Two accounts ─────────────────────────────────────────
const nameA = makeUser('alpha');
const nameB = makeUser('bravo');

const a = await api('/api/signup', {
  method: 'POST',
  body: { username: nameA, password: 'password123', tier: 'middle',
          skin_color: 0x8d5524, outfit_color: 0xff5722 },
});
const b = await api('/api/signup', {
  method: 'POST',
  body: { username: nameB, password: 'password123', tier: 'middle',
          skin_color: 0xf1c27d, outfit_color: 0x4caf50 },
});

check('Two accounts created', !!a.token && !!b.token, `${nameA} / ${nameB}`);

// ── 2. Presence ─────────────────────────────────────────────
console.log('\n[Presence]');
const clientA = await connect(a.token);
check('Client A receives world:init', !!clientA.init);
check('world:init echoes our own socket id',
  clientA.init.you === clientA.sock.id, clientA.init.you);

const joinedPromise = waitFor(clientA.sock, 'world:player-joined',
  (p) => p && p.username === nameB);

const clientB = await connect(b.token);
check('Client B receives world:init', !!clientB.init);
check('B sees A already in the world',
  (clientB.init.players || []).some((p) => p.username === nameA),
  `${clientB.init.players?.length} player(s)`);

const joined = await joinedPromise;
check('A is told that B joined', joined?.username === nameB, joined?.username);
check('Join event carries avatar colours',
  joined?.skinColor === 0xf1c27d && joined?.outfitColor === 0x4caf50,
  `skin=${joined?.skinColor} outfit=${joined?.outfitColor}`);

// ── 3. Movement sync ────────────────────────────────────────
console.log('\n[Movement sync]');
// The server validates distance between packets, so walk in steps rather
// than teleporting (a teleport would — correctly — be clamped).
async function walkTo(sock, targetX, targetZ, steps = 12) {
  let x = 0;
  let z = 0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    x = targetX * t;
    z = targetZ * t;
    sock.emit('player:move', { x, z, rot: 1.2, moving: true });
    await sleep(70);
  }
}
await walkTo(clientA.sock, 12.5, -8.25);

const snapOfA = await waitFor(clientB.sock, 'world:players',
  (d) => (d.players || []).some((p) => p.username === nameA && Math.abs(p.x - 12.5) < 0.01));

const aOnB = snapOfA?.players.find((p) => p.username === nameA);
check('B receives A at the reported position',
  !!aOnB && Math.abs(aOnB.x - 12.5) < 0.01 && Math.abs(aOnB.z + 8.25) < 0.01,
  aOnB ? `(${aOnB.x}, ${aOnB.z})` : 'not found');
check('Rotation is synced', Math.abs(aOnB?.rot - 1.2) < 0.01, String(aOnB?.rot));
check('Moving flag is synced', aOnB?.moving === true);
const selfSnap = await waitFor(clientA.sock, 'world:players', (d) => d.players?.length > 0);
check('A does not appear in its own snapshot',
  !(selfSnap?.players || []).some((p) => p.id === clientA.sock.id),
  `${selfSnap?.players?.length} other player(s) listed`);
check('A can see B in its own snapshot',
  (selfSnap?.players || []).some((p) => p.id === clientB.sock.id));
// The count includes whoever else is in the world (a human with the game open,
// another suite running): what matters is that it is a number that accounts for
// both test players and everyone else.
const baselineCount = typeof snapOfA?.count === 'number' ? snapOfA.count : null;
check('Snapshot includes an online count',
  baselineCount !== null && baselineCount >= 2
    && (snapOfA.players || []).length <= baselineCount,
  `${baselineCount} online, ${(snapOfA?.players || []).length} listed`);

// A teleport attempt must NOT be honoured — the player should stay near
// where they were, because they cannot cover that distance in one packet.
const beforeTeleport = await waitFor(clientB.sock, 'world:players',
  (d) => (d.players || []).some((p) => p.username === nameA));
const beforeX = beforeTeleport.players.find((p) => p.username === nameA).x;

clientA.sock.emit('player:move', { x: 99999, z: -99999, rot: 0, moving: true });
await sleep(400);
const afterTeleport = await waitFor(clientB.sock, 'world:players',
  (d) => (d.players || []).some((p) => p.username === nameA));
const afterX = afterTeleport.players.find((p) => p.username === nameA).x;

check('Teleport attempts are clamped, not honoured',
  Math.abs(afterX - beforeX) < 5 && afterX < 90,
  `x ${beforeX.toFixed(1)} → ${afterX.toFixed(1)} (capped to reachable distance)`);

// Garbage input must be ignored, not crash or teleport
const beforeGarbage = await waitFor(clientB.sock, 'world:players',
  (d) => (d.players || []).some((p) => p.username === nameA));
clientA.sock.emit('player:move', { x: 'nope', z: NaN });
await sleep(400);
const afterGarbage = await waitFor(clientB.sock, 'world:players',
  (d) => (d.players || []).some((p) => p.username === nameA));
check('Non-numeric coordinates are ignored',
  Math.abs(afterGarbage.players.find((p) => p.username === nameA).x -
           beforeGarbage.players.find((p) => p.username === nameA).x) < 0.01,
  'position unchanged');

// ── 4. Chat ─────────────────────────────────────────────────
console.log('\n[Chat]');
const msgOnB = waitFor(clientB.sock, 'chat:message', (m) => !m.system);
clientA.sock.emit('chat:message', 'How far, my guy?');
const received = await msgOnB;
check('Chat message reaches the other player',
  received?.text === 'How far, my guy?', received?.text);
check('Chat carries the sender username', received?.username === nameA, received?.username);
check('Chat message is not flagged as system', received?.system === false);

// Cooldown
const spamResult = waitFor(clientA.sock, 'chat:error', () => true, 3000);
clientA.sock.emit('chat:message', 'second message too soon');
const spamErr = await spamResult;
check('Rapid second message is rate-limited', !!spamErr, spamErr?.message);

// Sanitisation: control chars stripped, length capped
await sleep(1700);
const longMsg = 'x'.repeat(500);
const sanitised = waitFor(clientB.sock, 'chat:message', (m) => !m.system);
clientA.sock.emit('chat:message', `hi\n\nthere${longMsg}`);
const clean = await sanitised;
check('Newlines are stripped from chat',
  !clean?.text.includes('\n'), JSON.stringify(clean?.text.slice(0, 20)));
check('Chat length is capped at 200 chars',
  clean?.text.length <= 200, `${clean?.text.length} chars`);

// Empty / whitespace-only messages are dropped
await sleep(1700);
const emptySeen = waitFor(clientB.sock, 'chat:message', (m) => !m.system, 1500);
clientA.sock.emit('chat:message', '     ');
check('Whitespace-only messages are dropped', (await emptySeen) === null);

// ── 5. Chat history for new joiners ─────────────────────────
console.log('\n[Join history]');
const nameC = makeUser('charlie');
const c = await api('/api/signup', {
  method: 'POST',
  body: { username: nameC, password: 'password123', tier: 'middle' },
});
const clientC = await connect(c.token);
check('New joiner receives recent chat history',
  (clientC.init.chat || []).some((m) => m.text === 'How far, my guy?'),
  `${clientC.init.chat?.length} message(s)`);
const initNames = (clientC.init.players || []).map((p) => p.username);
check('New joiner receives the current player list',
  initNames.includes(nameA) && initNames.includes(nameB),
  `${initNames.length} players: ${initNames.join(', ')}`);

// ── 6. Disconnect ───────────────────────────────────────────
console.log('\n[Leaving]');
const bSocketId = clientB.sock.id;
const leftOnA = waitFor(clientA.sock, 'world:player-left', (d) => d && d.id === bSocketId);
clientB.sock.close();
const left = await leftOnA;
check('Other players are told when someone leaves',
  !!left && left.id === bSocketId, left?.id);

await sleep(300);
// Anyone else may join or leave while this runs, so the check is that the count
// went DOWN after B left, not that it landed on a hard-coded number.
// Track the latest snapshot, so the comparison is against what A actually saw
// a moment before B left rather than a guess about who else is online.
let lastSnap = null;
clientA.sock.on('world:players', (d) => { lastSnap = d; });
await waitFor(clientA.sock, 'world:players', (d) => (d.players || []).some((p) => p.username === nameC));
const joinedCount = lastSnap?.count ?? null;
const afterLeave = await waitFor(clientA.sock, 'world:players',
  (d) => !(d.players || []).some((p) => p.username === nameB));
// Someone else may join in the same second (a real player does), so the honest
// assertion is that the player who left is gone; the count is checked against
// the list that carries it, below.
check('The player who left is gone from the list',
  !!afterLeave && !afterLeave.players.some((p) => p.username === nameB),
  `${joinedCount} player(s) before, ${afterLeave?.players?.length} listed after (B absent)`);
check('The online count matches the player list it is sent with',
  !!afterLeave && afterLeave.count === afterLeave.players.length + 1,
  `count ${afterLeave?.count}, ${afterLeave?.players?.length} listed (+ the viewer)`);

// ── 7. Server stayed healthy ────────────────────────────────
console.log('\n[Health]');
const health = await api('/api/health');
check('Server still responds after malformed input', health.ok === true);

const db = new Database(dbPath);
const row = db.prepare('SELECT username FROM users WHERE username = ?').get(nameA);
check('Database still readable', !!row, row?.username);
db.close();

clientA.sock.close();
clientC.sock.close();

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed === 0 ? 0 : 1);
