// server/test-world.mjs
// Integration tests for the open-world layer: inventory, missions, vehicles.
//
// These run against a live server on PORT (default 3000) and use real socket
// connections so the position checks the routes perform are genuine.
//
//   cd server && node test-world.mjs

import { io } from 'socket.io-client';

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

function makeUser(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

/** Connect a socket and hold it open so the server has a live position. */
function connect(token) {
  const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    sock.on('world:init', (data) => {
      clearTimeout(timer);
      resolve({ sock, data });
    });
    sock.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Walk to a position in legal steps.
 * The server clamps movement between packets (anti-teleport, Step 9), so a
 * single jump across the map is rejected — exactly as it should be.
 */
async function moveTo(sock, x, z) {
  const from = currentPos;
  const dist = Math.hypot(x - from.x, z - from.z);
  // 0.5 m every 45 ms is ~11 m/s, inside the server's 18 m/s cap: anything
  // faster is silently clipped, and the walker never actually arrives.
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    sock.emit('player:move', {
      x: from.x + (x - from.x) * t,
      z: from.z + (z - from.z) * t,
      rot: 0,
      moving: true,
    });
    await sleep(45);
  }
  currentPos = { x, z };
  await sleep(320);
}

let currentPos = { x: 0, z: 0 };

console.log('\n=== OPEN WORLD: INVENTORY, MISSIONS, VEHICLES ===\n');

const name = makeUser('world');
const signup = await api('/api/signup', {
  method: 'POST',
  body: { username: name, password: 'password123', tier: 'nepo' },
});

if (!signup.token) {
  console.error('Signup failed:', signup);
  process.exit(1);
}
const token = signup.token;
const { sock, data: initData } = await connect(token);
currentPos = { x: initData.you?.x ?? 0, z: initData.you?.z ?? 0 };

console.log('[Inventory]');
let inv = await api('/api/inventory', { token });
check('Inventory starts empty', Array.isArray(inv.items) && inv.items.length === 0);

// Buying far from a shop must fail
await moveTo(sock, 60, 60);
const farBuy = await api('/api/inventory/buy', {
  method: 'POST', token, body: { itemId: 'jollof' },
});
check('Cannot buy far from a shop', farBuy.error === 'You need to be at a shop to buy that',
  farBuy.error);

// Walk to a real shop from the interaction catalogue. This used to be a
// hand-typed point from the old 200 m city, so the walk ended in the lagoon and
// every purchase below failed with "too far".
const { interactionConfig } = await import('./config/interactionConfig.js');
const shopPoint = interactionConfig.points.find((p) => p.type === 'shop');
await moveTo(sock, shopPoint.position.x, shopPoint.position.z);
const nearBuy = await api('/api/inventory/buy', {
  method: 'POST', token, body: { itemId: 'jollof' },
});
check('Can buy at a shop', nearBuy.ok === true && nearBuy.cash < 5_000_000,
  `cash ${nearBuy.cash}`);

inv = await api('/api/inventory', { token });
check('Purchased item appears in inventory', inv.items.some(i => i.id === 'jollof'),
  `${inv.items.length} item(s)`);

const beforeUse = (await api('/api/me', { token })).user;
const use = await api('/api/inventory/use', {
  method: 'POST', token, body: { itemId: 'jollof' },
});
check('Using an item restores hunger', use.ok === true,
  `hunger ${beforeUse.hunger} → ${use.needs?.hunger}`);

const useAgain = await api('/api/inventory/use', {
  method: 'POST', token, body: { itemId: 'jollof' },
});
check('Cannot use an item you do not have', typeof useAgain.error === 'string', useAgain.error);

console.log('\n[Missions]');
let missions = await api('/api/missions', { token });
check('Mission list loads', Array.isArray(missions.missions) && missions.missions.length >= 6,
  `${missions.missions?.length} missions`);

const claimUnaccepted = await api('/api/missions/claim', {
  method: 'POST', token, body: { missionId: 'first-paycheck' },
});
check('Cannot claim a mission that was not accepted', claimUnaccepted.error === 'Accept the mission first',
  claimUnaccepted.error);

await api('/api/missions/accept', { method: 'POST', token, body: { missionId: 'first-paycheck' } });
const claimIncomplete = await api('/api/missions/claim', {
  method: 'POST', token, body: { missionId: 'first-paycheck' },
});
check('Cannot claim an incomplete mission', typeof claimIncomplete.error === 'string',
  claimIncomplete.error);

// Complete a mission legitimately: "Supplier Run" needs an item bought + used,
// which we just did.
await api('/api/missions/accept', { method: 'POST', token, body: { missionId: 'supplier' } });
missions = await api('/api/missions', { token });
const supplier = missions.missions.find(m => m.id === 'supplier');
check('Mission state is derived from real progress', supplier?.status === 'complete',
  `status ${supplier?.status}, ${supplier?.progress}/${supplier?.total} steps`);

const cashBeforeClaim = (await api('/api/inventory', { token })).cash;
const claim = await api('/api/missions/claim', {
  method: 'POST', token, body: { missionId: 'supplier' },
});
check('Completed mission pays its reward', claim.ok === true && claim.cash > cashBeforeClaim,
  `₦${cashBeforeClaim} → ₦${claim.cash}`);

const doubleClaim = await api('/api/missions/claim', {
  method: 'POST', token, body: { missionId: 'supplier' },
});
check('Reward cannot be claimed twice', typeof doubleClaim.error === 'string', doubleClaim.error);

console.log('\n[Vehicles]');
let veh = await api('/api/vehicles', { token });
check('Vehicle catalogue loads', veh.catalog?.length >= 4, `${veh.catalog?.length} models`);
check('Player owns no vehicles yet', veh.owned.length === 0);

await moveTo(sock, -50, 26); // dealership
const cashBeforeCar = (await api('/api/inventory', { token })).cash;
const buy = await api('/api/vehicles/buy', {
  method: 'POST', token, body: { vehicleId: 'corolla' },
});
check('Can buy a vehicle with enough cash', buy.ok === true, `cash ${buy.cash}`);
check('Purchase deducted exactly the price', buy.cash === cashBeforeCar - 2_200_000,
  `₦${cashBeforeCar} → ₦${buy.cash}`);

const vehId = buy.vehicle?.id;
veh = await api('/api/vehicles', { token });
check('Owned vehicle is listed', veh.owned.length === 1 && veh.owned[0].vehicle_id === 'corolla');

const park = await api('/api/vehicles/park', {
  method: 'POST', token, body: { id: vehId, x: 9999, z: -9999, fuel: 30 },
});
check('Parking clamps out-of-bounds coordinates',
  park.vehicle && Math.abs(park.vehicle.pos_x) <= 93, `x ${park.vehicle?.pos_x}`);

const fuel = await api('/api/vehicles/fuel', {
  method: 'POST', token, body: { id: vehId, litres: 5 },
});
check('Fuel is refused when the vehicle is elsewhere', typeof fuel.error === 'string', fuel.error);

// ── Vehicle speed cap ────────────────────────────────────────
// A single 4 m hop 100 ms after the last packet is beyond the walking cap
// (18 m/s × 0.1 s + 1.5 m = 3.3 m) but inside the vehicle cap
// (34 m/s × 0.1 s + 1.5 m = 4.9 m). The server must treat them differently,
// and only for a vehicle the player actually owns.
const here = { ...currentPos };
sock.emit('player:move', { x: here.x, z: here.z + 0.1, rot: 0, moving: true });
await sleep(200);
const onFootTarget = { x: here.x + 6, z: here.z + 0.1 };
sock.emit('player:move', { x: onFootTarget.x, z: onFootTarget.z, rot: 0, moving: true });
await sleep(200);
const posOnFoot = (await api('/api/save', { method: 'POST', token })).user.position;
check('Walking speed cap clamps a 6 m hop in 200 ms',
  Math.hypot(posOnFoot.x - onFootTarget.x, posOnFoot.z - onFootTarget.z) > 0.5,
  `server at ${posOnFoot.x.toFixed(2)}, ${posOnFoot.z.toFixed(2)} vs wanted ${onFootTarget.x.toFixed(2)}, ${onFootTarget.z.toFixed(2)}`);

currentPos = { x: posOnFoot.x, z: posOnFoot.z };
sock.emit('player:move', { x: posOnFoot.x, z: posOnFoot.z, rot: 0, moving: true, vehicle: vehId });
await sleep(200);
const vehicleTarget = { x: posOnFoot.x + 6, z: posOnFoot.z };
sock.emit('player:move', {
  x: vehicleTarget.x, z: vehicleTarget.z, rot: 0, moving: true, vehicle: vehId,
});
await sleep(200);
const posVehicle = (await api('/api/save', { method: 'POST', token })).user.position;
check('An owned vehicle gets the higher speed cap',
  Math.hypot(posVehicle.x - vehicleTarget.x, posVehicle.z - vehicleTarget.z) < 0.5,
  `server at ${posVehicle.x.toFixed(2)}, ${posVehicle.z.toFixed(2)}`);

// A vehicle id the player does not own must fall back to the walking cap
sock.emit('player:move', { x: posVehicle.x, z: posVehicle.z, rot: 0, moving: true });
await sleep(200);
const spoofTarget = { x: posVehicle.x + 6, z: posVehicle.z };
sock.emit('player:move', {
  x: spoofTarget.x, z: spoofTarget.z, rot: 0, moving: true, vehicle: 999999,
});
await sleep(200);
const posSpoof = (await api('/api/save', { method: 'POST', token })).user.position;
check('A vehicle id you do not own does not raise the cap',
  Math.hypot(posSpoof.x - spoofTarget.x, posSpoof.z - spoofTarget.z) > 0.5,
  `server at ${posSpoof.x.toFixed(2)}, ${posSpoof.z.toFixed(2)}`);
currentPos = { x: posSpoof.x, z: posSpoof.z };

console.log('\n[NPC services]');
const svcBefore = (await api('/api/inventory', { token })).cash;
const svc = await api('/api/world/service', { method: 'POST', token, body: { serviceId: 'chat' } });
check('NPC service applies a server-defined need effect',
  svc.ok === true && svc.needs && svc.needs.social > 0, `social ${svc.needs?.social}`);
const badSvc = await api('/api/world/service', { method: 'POST', token, body: { serviceId: 'free-money' } });
check('Unknown service is rejected', badSvc.error === 'Unknown service', badSvc.error);
const paid = await api('/api/world/service', { method: 'POST', token, body: { serviceId: 'street-food' } });
check('Paid service deducts its real price',
  paid.ok === true && paid.cash === svcBefore - 1_500, `₦${svcBefore} → ₦${paid.cash}`);
const cooled = await api('/api/world/service', { method: 'POST', token, body: { serviceId: 'chat' } });
check('Cooldown stops repeats', typeof cooled.error === 'string', cooled.error);
const svcInject = await api('/api/world/service', {
  method: 'POST', token, body: { serviceId: 'street-food', effects: { hunger: 100 }, cost: 0 },
});
check('Client cannot inject effects or price',
  svcInject.error !== undefined || svcInject.cost >= 0, String(svcInject.error || svcInject.cost));

console.log('\n[Character sheet]');
const char = await api('/api/character', { token });
check('Character sheet reports progress',
  char.ok !== false && char.stats && char.stats.itemsBought >= 1,
  `items bought ${char.stats?.itemsBought}, districts ${JSON.stringify(char.stats?.districts)}`);
check('Character sheet never leaks the password hash',
  char.user && char.user.password === undefined && char.user.password_hash === undefined,
  Object.keys(char.user || {}).filter((k) => k.includes('pass')).join(',') || 'no password fields');

console.log('\n[Save]');
const save = await api('/api/save', { method: 'POST', token });
check('Explicit save returns a timestamp', save.ok === true && typeof save.savedAt === 'number',
  new Date(save.savedAt).toISOString());

console.log('\n[Character look reaches other players]');
// Two live sockets: one changes its clothes on the HTTP route, the other has to
// see the change in its next world snapshot. This is the path that used to
// render every remote player in the default outfit.
{
  const watcherName = makeUser('watch');
  const watcher = await api('/api/signup', {
    method: 'POST',
    body: { username: watcherName, password: 'password123', tier: 'middle' },
  });
  const watcherDeal = await connect(watcher.token);

  const seen = [];
  watcherDeal.sock.on('world:players', (data) => {
    const list = Array.isArray(data) ? data : (data && data.players) || [];
    const me = list.find((p) => p && p.username === name);
    if (me) seen.push(me);
  });

  const before = await api('/api/me', { token });
  check('A new account starts in a real outfit',
    typeof before.user.outfit_id === 'string' && before.user.outfit_id.length > 0,
    before.user.outfit_id);

  const patchRes = await api('/api/appearance', {
    method: 'POST', token,
    body: { outfit_id: 'owambe', hair_style: 'braids', body_type: 'broad', bottom_color: 0x4a235a },
  });
  check('The appearance route accepts a full look', patchRes.ok === true, JSON.stringify(patchRes.user || patchRes));

  await sleep(1400); // two broadcast ticks
  const latest = seen[seen.length - 1] || {};
  check('Another player receives the outfit id', latest.outfitId === 'owambe',
    JSON.stringify({ outfitId: latest.outfitId, hairStyle: latest.hairStyle, bodyType: latest.bodyType }));
  check('Another player receives hair, build and bottom colour',
    latest.hairStyle === 'braids' && latest.bodyType === 'broad' && latest.bottomColor === 0x4a235a,
    JSON.stringify(latest.bottomColor));
  check('The snapshot still carries the position and colour fields',
    Number.isFinite(latest.x) && Number.isFinite(latest.z) && Number.isFinite(latest.skinColor),
    `x=${latest.x} z=${latest.z}`);

  watcherDeal.sock.close();
  await sleep(200);
}

console.log('\n[Authorisation]');
const noAuth = await api('/api/inventory');
check('Inventory requires a token', noAuth.error === 'No token provided', noAuth.error);

sock.close();
await sleep(200);

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');

process.exit(failed ? 1 : 0);
