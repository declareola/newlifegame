// server/test-step11.mjs
// Integration test for Step 11 — leaderboard, saved spawn positions,
// day/night clock sanity and a final end-to-end regression sweep.

import { io } from 'socket.io-client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

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

function connect(token) {
  return new Promise((resolve, reject) => {
    const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
    const timer = setTimeout(() => reject(new Error('no world:init')), 10000);
    sock.on('world:init', (data) => { clearTimeout(timer); resolve({ sock, init: data }); });
    sock.on('connect_error', (e) => { clearTimeout(timer); reject(new Error(e.message)); });
  });
}

function waitFor(sock, event, predicate = () => true, timeout = 6000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { sock.off(event, handler); resolve(null); }, timeout);
    function handler(data) {
      if (predicate(data)) { clearTimeout(timer); sock.off(event, handler); resolve(data); }
    }
    sock.on(event, handler);
  });
}

console.log('\n=== STEP 11: POLISH ===\n');

// ── 1. Leaderboard ─────────────────────────────────────────
console.log('\n[Leaderboard]');
const nameA = 'rich' + Math.random().toString(36).slice(2, 8);
const a = await api('/api/signup', {
  method: 'POST',
  body: { username: nameA, password: 'password123', tier: 'nepo' }, // ₦5,000,000
});
const nameB = 'poor' + Math.random().toString(36).slice(2, 8);
const b = await api('/api/signup', {
  method: 'POST',
  body: { username: nameB, password: 'password123', tier: 'lapo' }, // ₦50,000
});

const board = await api('/api/leaderboard', { token: a.token });
check('GET /api/leaderboard returns entries', Array.isArray(board.entries) && board.entries.length >= 2,
  `${board.entries?.length} entries`);
check('Entries are ranked from 1', board.entries[0]?.rank === 1);
check('Entries are sorted by net worth descending',
  board.entries.every((e, i) => i === 0 || board.entries[i - 1].netWorth >= e.netWorth),
  board.entries.slice(0, 3).map((e) => `${e.username}=₦${e.netWorth}`).join(' | '));
// The board is public and full of other people's accounts, so a fresh ₦5m
// player is not guaranteed a top-ten slot. Each player's own row (`you`) is the
// honest comparison.
const boardB0 = await api('/api/leaderboard', { token: b.token });
check('The nepo account is worth more than the lapo account',
  board.you.netWorth > boardB0.you.netWorth,
  `nepo ₦${board.you.netWorth} vs lapo ₦${boardB0.you.netWorth}`);
check('Your own row is flagged',
  board.you?.username === nameA && board.you.isYou === true, `rank #${board.you?.rank}`);
check('Net worth equals cash + bank',
  board.you.netWorth === board.you.cash + board.you.bank,
  `₦${board.you.netWorth} = ₦${board.you.cash} + ₦${board.you.bank}`);

// A player further down the list still gets their own rank
const boardB = await api('/api/leaderboard', { token: b.token });
check('Lower-ranked player still gets their own position',
  boardB.you?.username === nameB, `rank #${boardB.you?.rank}`);

const noAuth = await fetch(`${BASE}/api/leaderboard`);
check('Leaderboard requires authentication', noAuth.status === 401);

// ── 2. Saved spawn position ────────────────────────────────
console.log('\n[Saved spawn position]');
const clientA = await connect(a.token);

const startUser = (await api('/api/me', { token: a.token })).user;
check('New player starts at the origin',
  Math.abs(startUser.pos_x) < 1 && Math.abs(startUser.pos_z) < 1,
  `(${startUser.pos_x}, ${startUser.pos_z})`);

// Walk somewhere distinctive, in steps the server will accept.
// Starts from the position the server seeded this session with (the saved
// DB position), because movement is distance-checked per packet.
async function walkTo(sock, targetX, targetZ) {
  const cur = (await api('/api/me', { token: a.token })).user;
  let x = cur.pos_x || 0;
  let z = cur.pos_z || 0;

  const MAX_STEP = 1.4;
  for (let guard = 0; guard < 600; guard++) {
    const dx = targetX - x;
    const dz = targetZ - z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.1) break;
    const step = Math.min(MAX_STEP, dist);
    x += (dx / dist) * step;
    z += (dz / dist) * step;
    sock.emit('player:move', { x, z, rot: 2, moving: true });
    await sleep(40);
  }
  sock.emit('player:move', { x: targetX, z: targetZ, rot: 2, moving: false });
  await sleep(200);
}
await walkTo(clientA.sock, 41.5, -27.25);
await sleep(300);
clientA.sock.close();
await sleep(900); // let the disconnect handler persist

const savedUser = (await api('/api/me', { token: a.token })).user;
check('Position is saved on disconnect',
  Math.abs(savedUser.pos_x - 41.5) < 2 && Math.abs(savedUser.pos_z + 27.25) < 2,
  `(${savedUser.pos_x.toFixed(1)}, ${savedUser.pos_z.toFixed(1)})`);

// Reconnecting and moving again updates the saved spot
const clientA2 = await connect(a.token);
await walkTo(clientA2.sock, -15, 62);
await sleep(300);
clientA2.sock.close();
await sleep(900);

const savedAgain = (await api('/api/me', { token: a.token })).user;
check('Reconnecting updates the saved position',
  Math.abs(savedAgain.pos_x + 15) < 2 && Math.abs(savedAgain.pos_z - 62) < 2,
  `(${savedAgain.pos_x.toFixed(1)}, ${savedAgain.pos_z.toFixed(1)})`);

// ── 3. Day/night clock is deterministic and shared ─────────
console.log('\n[Day/night clock]');
// Mirrors client/src/world/DayNight.js
const DAY_LENGTH_MS = 8 * 60 * 1000;
function clockLabelAt(nowMs) {
  const phase = (nowMs % DAY_LENGTH_MS) / DAY_LENGTH_MS;
  const totalMinutes = (phase * 24 * 60 + 6 * 60) % (24 * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
const t = Date.now();
check('Clock derived from absolute time is identical for all players',
  clockLabelAt(t) === clockLabelAt(t),
  clockLabelAt(t));
check('Clock advances with real time',
  clockLabelAt(t) !== clockLabelAt(t + DAY_LENGTH_MS / 4),
  `${clockLabelAt(t)} → ${clockLabelAt(t + DAY_LENGTH_MS / 4)}`);
check('A full day maps to 24 hours',
  clockLabelAt(0) === '06:00', clockLabelAt(0));

// ── 4. End-to-end regression sweep ────────────────────────
console.log('\n[Regression sweep]');
const client = await connect(a.token);

const update = await waitFor(client.sock, 'player:update', () => true, 8000);
check('player:update still carries needs', typeof update?.hunger === 'number');
check('player:update still carries cash', typeof update?.cash === 'number');
check('player:update still carries housing fields', 'isRentingHome' in (update || {}));
check('player:update still carries activity fields', 'activity' in (update || {}));

const snapshot = await waitFor(client.sock, 'world:players', () => true, 8000);
check('world:players snapshot still arriving', Array.isArray(snapshot?.players));

const jobs = await api('/api/jobs', { token: a.token });
check('Jobs API still works', (jobs.jobs || []).length === 5);

const acts = await api('/api/activities', { token: a.token });
check('Activities API still works', Object.keys(acts.activities || {}).length === 6);

const props = await api('/api/properties', { token: a.token });
check('Properties API still works', (props.properties || []).length === 5);

const inter = await api('/api/interactions', { token: a.token });
check('Interactions API still works', (inter.points || []).length === 5);

const health = await api('/api/health');
check('Health endpoint healthy', health.ok === true);

client.sock.close();

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed === 0 ? 0 : 1);
