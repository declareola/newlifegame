// server/test-step10.mjs
// Integration test for Step 10 — world interactions (bank + shops).
// Verifies the server's proximity check actually blocks remote use.

import { io } from 'socket.io-client';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Positions come from the generated geometry, not from numbers typed in by hand.
// The old city had the ATM at (12, 17.5); on Eko Basin that point is in the
// lagoon, so every proximity check here failed with "Too far away" while the
// game itself was fine. Anchors are the same rows the server validates against.
const { anchorById } = await import('./config/worldGeometry.js');
const ATM = anchorById('atm');
const FOOD_COURT = anchorById('food-court');
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

/**
 * Walk to a position in short hops.
 * The server validates movement distance per packet, so teleporting is
 * (correctly) clamped. This simulates a real client stepping along.
 */
async function moveTo(sock, watcher, targetX, targetZ) {
  let x = 0;
  let z = 0;

  // Find where the server currently thinks we are.
  const start = await waitFor(watcher, 'world:players',
    (d) => (d.players || []).some((p) => p.id === sock.id), 5000);
  const me = start?.players.find((p) => p.id === sock.id);
  if (me) { x = me.x; z = me.z; }

  // 0.6 m every 50 ms is 12 m/s: inside the server's 18 m/s cap, so no packet
  // is clamped. The old 1.6 m / 60 ms was 26 m/s — silently clipped on every
  // step, which is why a 300 m walk on the new map never arrived.
  const MAX_STEP = 0.6;
  for (let guard = 0; guard < 2000; guard++) {
    const dx = targetX - x;
    const dz = targetZ - z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.05) break;

    const step = Math.min(MAX_STEP, dist);
    x += (dx / dist) * step;
    z += (dz / dist) * step;
    sock.emit('player:move', { x, z, rot: 0, moving: true });
    await sleep(50);
  }

  sock.emit('player:move', { x: targetX, z: targetZ, rot: 0, moving: false });
  await sleep(200);
  return { x: targetX, z: targetZ };
}

console.log('\n=== STEP 10: WORLD INTERACTIONS ===\n');

// ── Setup: two accounts so we can observe positions ─────────
const nameA = 'inter' + Math.random().toString(36).slice(2, 8);
const nameB = 'watch' + Math.random().toString(36).slice(2, 8);

const a = await api('/api/signup', {
  method: 'POST',
  body: { username: nameA, password: 'password123', tier: 'middle' },
});
const b = await api('/api/signup', {
  method: 'POST',
  body: { username: nameB, password: 'password123', tier: 'middle' },
});

const clientA = await connect(a.token);
const clientB = await connect(b.token);
check('Two clients connected', !!clientA.init && !!clientB.init);

// ── 1. Interaction config ──────────────────────────────────
console.log('\n[Config]');
const config = await api('/api/interactions', { token: a.token });
check('GET /api/interactions lists points',
  (config.points || []).length === 5, `${config.points?.length} points`);
check('Both banks and shops exist',
  config.points.some((p) => p.type === 'bank') && config.points.some((p) => p.type === 'shop'));
check('Shop items are listed', (config.shopItems || []).length === 5,
  `${config.shopItems?.length} items`);
check('Wallet is returned', typeof config.cash === 'number' && typeof config.bankBalance === 'number',
  `cash ₦${config.cash}, bank ₦${config.bankBalance}`);

// ── 2. Proximity enforcement ───────────────────────────────
console.log('\n[Proximity check]');

// Player starts at 0,0 — far from every point
const farDeposit = await api('/api/interactions/bank/deposit', {
  method: 'POST', token: a.token, body: { point_id: 'bank-vi', amount: 5000 },
});
check('Cannot deposit from across the map', !!farDeposit.error, farDeposit.error);

const farBuy = await api('/api/interactions/shop/buy', {
  method: 'POST', token: a.token, body: { point_id: 'market-mushin', item_id: 'jollof' },
});
check('Cannot shop from across the map', !!farBuy.error, farBuy.error);

// Walk to the centre ATM (its real position on this map)
await moveTo(clientA.sock, clientB.sock, ATM.x, ATM.z);
await sleep(300);

// ── 3. Banking ─────────────────────────────────────────────
console.log('\n[Banking]');
const before = await api('/api/interactions', { token: a.token });
const cashBefore = before.cash;
const bankBefore = before.bankBalance;

const deposit = await api('/api/interactions/bank/deposit', {
  method: 'POST', token: a.token, body: { point_id: 'atm-centre', amount: 50000 },
});
check('Deposit succeeds while standing at the ATM', !deposit.error, deposit.error || 'ok');
check('Cash decreased by the deposit',
  Math.round(cashBefore - deposit.cash) === 50000, `₦${cashBefore} → ₦${deposit.cash}`);
check('Bank increased by the deposit',
  Math.round(deposit.bankBalance - bankBefore) === 50000, `₦${bankBefore} → ₦${deposit.bankBalance}`);

const withdraw = await api('/api/interactions/bank/withdraw', {
  method: 'POST', token: a.token, body: { point_id: 'atm-centre', amount: 20000 },
});
check('Withdraw succeeds at the ATM', !withdraw.error, withdraw.error || 'ok');
check('Cash increased by the withdrawal',
  Math.round(withdraw.cash - deposit.cash) === 20000, `₦${withdraw.cash}`);
check('Bank decreased by the withdrawal',
  Math.round(deposit.bankBalance - withdraw.bankBalance) === 20000, `₦${withdraw.bankBalance}`);

const tooMuch = await api('/api/interactions/bank/withdraw', {
  method: 'POST', token: a.token, body: { point_id: 'atm-centre', amount: 999999999 },
});
check('Cannot withdraw more than the bank holds', !!tooMuch.error, tooMuch.error);

const belowMin = await api('/api/interactions/bank/deposit', {
  method: 'POST', token: a.token, body: { point_id: 'atm-centre', amount: 50 },
});
check('Amounts below the minimum are rejected', !!belowMin.error, belowMin.error);

const negative = await api('/api/interactions/bank/deposit', {
  method: 'POST', token: a.token, body: { point_id: 'atm-centre', amount: -5000 },
});
check('Negative amounts are rejected', !!negative.error, negative.error);

const notABank = await api('/api/interactions/bank/deposit', {
  method: 'POST', token: a.token, body: { point_id: 'market-mushin', amount: 5000 },
});
check('Depositing at a shop point is rejected', !!notABank.error, notABank.error);

// ── 4. Shopping ────────────────────────────────────────────
console.log('\n[Shopping]');

// Walk to the food court shop (-50, 86)
await moveTo(clientA.sock, clientB.sock, FOOD_COURT.x, FOOD_COURT.z);
await sleep(300);

const bakeryPos = await api('/api/interactions', { token: a.token });

// Drop hunger first by writing the DB and reconnecting is messy — instead
// buy water, which tops up bladder, and just verify the money movement.
const buyWater = await api('/api/interactions/shop/buy', {
  method: 'POST', token: a.token, body: { point_id: 'food-court-shop', item_id: 'bottled-water' },
});
check('Buying at the shop succeeds when nearby', !buyWater.error, buyWater.error || 'ok');
check('Item price was deducted',
  Math.round(bakeryPos.cash - buyWater.cash) === 300, `₦${bakeryPos.cash - buyWater.cash}`);
check('Purchase returns the item details', buyWater.item?.id === 'bottled-water', buyWater.item?.name);

const unknownItem = await api('/api/interactions/shop/buy', {
  method: 'POST', token: a.token, body: { point_id: 'food-court-shop', item_id: 'gold-bar' },
});
check('Unknown items are rejected', !!unknownItem.error, unknownItem.error);

const shopAtBank = await api('/api/interactions/shop/buy', {
  method: 'POST', token: a.token, body: { point_id: 'atm-centre', item_id: 'jollof' },
});
check('Buying at a bank point is rejected', !!shopAtBank.error, shopAtBank.error);

// ── 5. Need effects applied server-side ────────────────────
console.log('\n[Need effects]');

// Needs live in the game loop's memory and are flushed to the DB on
// disconnect, so: disconnect → set a low bladder → reconnect.
clientA.sock.close();
await sleep(800);

const meA = (await api('/api/me', { token: a.token })).user;
const db = new Database(dbPath);
db.prepare('UPDATE users SET bladder = 20 WHERE id = ?').run(meA.id);
db.close();

const clientA2 = await connect(a.token);
const startState = await waitFor(clientA2.sock, 'player:update', () => true, 8000);
check('Reconnected with bladder at 20',
  startState && Math.abs(startState.bladder - 20) < 4,   // allow for tick decay
  `bladder ${startState?.bladder?.toFixed(1)}`);

// Stand at the food court again (position resets on reconnect)
await moveTo(clientA2.sock, clientB.sock, FOOD_COURT.x, FOOD_COURT.z);
await sleep(300);

const buyWater2 = await api('/api/interactions/shop/buy', {
  method: 'POST', token: a.token, body: { point_id: 'food-court-shop', item_id: 'bottled-water' },
});
check('Water purchase succeeds', !buyWater2.error, buyWater2.error || 'ok');

// The water gives +20; allow for decay between the buy and the next tick.
const bladderStart = startState.bladder;
const bladderAfter = await waitFor(clientA2.sock, 'player:update',
  (st) => st.bladder >= bladderStart + 15, 8000);

check('Buying water refilled bladder on the server',
  !!bladderAfter,
  bladderAfter
    ? `${bladderStart.toFixed(1)} → ${bladderAfter.bladder.toFixed(1)} (+${(bladderAfter.bladder - bladderStart).toFixed(1)})`
    : `no increase from ${bladderStart.toFixed(1)}`);

// ── 6. Cannot afford ───────────────────────────────────────
console.log('\n[Affordability]');
// Spend it all on withdrawals into... instead just test with a broke account.
const nameC = 'broke' + Math.random().toString(36).slice(2, 8);
const c = await api('/api/signup', {
  method: 'POST',
  body: { username: nameC, password: 'password123', tier: 'lapo' },
});
const clientC = await connect(c.token);
await moveTo(clientC.sock, clientB.sock, FOOD_COURT.x, FOOD_COURT.z);
await sleep(300);

// Lapo starts with ₦50,000, so buy repeatedly until it fails.
let purchases = 0;
let lastError = null;
for (let i = 0; i < 40; i++) {
  const r = await api('/api/interactions/shop/buy', {
    method: 'POST', token: c.token, body: { point_id: 'food-court-shop', item_id: 'suya' },
  });
  if (r.error) { lastError = r.error; break; }
  purchases++;
}
check('Purchases stop when cash runs out',
  purchases > 0 && lastError === 'Not enough cash',
  `${purchases} purchases then "${lastError}"`);
check('Cash never went negative',
  (await api('/api/interactions', { token: c.token })).cash >= 0,
  `₦${(await api('/api/interactions', { token: c.token })).cash}`);

// ── 7. Server health ───────────────────────────────────────
console.log('\n[Health]');
const health = await api('/api/health');
check('Server healthy after the run', health.ok === true);

clientA2.sock.close();
clientB.sock.close();
clientC.sock.close();

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed === 0 ? 0 : 1);
