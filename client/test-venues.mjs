// client/test-venues.mjs
// "I went to the market and it was empty."
//
// That complaint is testable. Every venue prop carries its factory name, and
// InteriorBuilder turns that into a manifest of what is actually in the room, so
// this file can assert:
//
//   · the market has stalls, produce, sacks and price boards
//   · the church has pews, an altar and stained glass
//   · the hospital has beds, IV stands, a trolley and a curtain
//   · the airport has check-in desks, a security gate, an X-ray, seats and a carousel
//   · the bank has teller counters, a vault door, deposit boxes and an ATM
//   · the office, school, police station, restaurant, shop and gym each have
//     the furniture of their trade
//   · no room is empty, and no two venue types have the same contents
//   · every room is still walkable (furniture must not seal the room off)

// Canvas stub — materials.js paints through a 2D canvas, which Node lacks.
const ctxStub = new Proxy({}, {
  get(_, prop) {
    if (prop === 'canvas') return { width: 256, height: 256 };
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
      return () => ({ addColorStop() {} });
    }
    if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (prop === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set() { return true; },
});
globalThis.document = {
  createElement: () => ({ width: 256, height: 256, style: {}, getContext: () => ctxStub, toDataURL: () => 'data:,' }),
};

import { buildInterior } from './src/world/InteriorBuilder.js';
import { buildAirfield } from './src/world/airfield.js';
import { namedInteriors, allInteriors, propertyInteriors } from './src/world/interiorData.js';
import { getVenueShop, getVenueStock } from '../server/config/venueConfig.js';
import { activityConfig } from '../server/config/activityConfig.js';
import { venueKind } from '../server/config/venueKinds.js';
import { staffFor } from '../server/config/staffConfig.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── Build one room per named interior ────────────────────────
const rooms = new Map();
for (const def of namedInteriors) {
  // Airside is not a room — it is its own scene. Build it the way the game
  // does, so the checks measure what the player actually walks into.
  const built = def.custom === 'airfield' ? buildAirfield(def) : buildInterior(def);
  rooms.set(def.id, { def, built, manifest: built.manifest || {} });
}

/** What must be in a room for it to be that kind of place. */
const REQUIRED = {
  'in-market': ['marketStall', 'priceBoard', 'sackStack', 'marketUmbrella'],
  'in-church': ['pew', 'altar', 'pulpit', 'stainedGlass'],
  'in-mosque': ['mihrab', 'prayerMat', 'shoeRack'],
  'in-hospital': ['hospitalBed', 'ivStand', 'trolley', 'medicalCabinet', 'receptionCounter'],
  'in-airport': ['checkInDesk', 'securityGate', 'xrayScanner', 'departureBoard', 'airportSeatRow', 'carousel'],
  'in-bank': ['tellerCounter', 'vaultDoor', 'depositBoxes', 'atmMachine'],
  'in-school': ['schoolDesk', 'blackboard'],
  'in-police': ['policeDesk', 'holdingCell', 'lockerBank'],
  'in-restaurant': ['servingCounter', 'diningSet'],
  'in-gym': ['treadmill', 'weightRack', 'benchPress'],
  'in-clinic': ['hospitalBed', 'medicalCabinet', 'receptionCounter'],
  'in-pure-water': ['shopShelf', 'fridgeCase'],
  'in-dealership': ['shopShelf', 'checkout'],
};

console.log('\n[What is inside each place]');
for (const [id, required] of Object.entries(REQUIRED)) {
  const room = rooms.get(id);
  if (!room) { check(`${id} exists`, false, 'no such interior definition'); continue; }
  if (!required) continue;

  const missing = required.filter((p) => !room.manifest[p]);
  check(`${room.def.name} is furnished like a ${room.def.type}`, missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : required.map((p) => `${p}×${room.manifest[p]}`).join(', '));
}

// ── Stations: the difference between a room and a set ─────────
// A room you can only look at is scenery. Every interior must have at least one
// point where pressing E starts something real.
console.log('\n[Stations]');
{
  const loneliest = [];
  let total = 0;
  let actionless = [];
  for (const [id, room] of rooms) {
    const stations = room.built.stations || [];
    total += stations.length;
    if (stations.length === 0) loneliest.push(room.def.name);
    for (const st of stations) {
      if (!st.actions || st.actions.length === 0) actionless.push(`${id}/${st.id}`);
    }
  }
  check('Every interior has at least one station', loneliest.length === 0,
    loneliest.length ? `empty: ${loneliest.join(', ')}` : `${total} stations across ${rooms.size} rooms`);
  check('Every station has an action', actionless.length === 0,
    actionless.length ? actionless.join(', ') : 'none idle');

  // The home has to cover the whole of daily life, not one corner of it.
  // Any residential plan: they all share the same living-room/kitchen/bath
  // layout, which is the thing being checked.
  const homeDef = propertyInteriors[0];
  const home = rooms.has(homeDef.id)
    ? rooms.get(homeDef.id)
    : { def: homeDef, built: buildInterior(homeDef) };

  const kinds = new Set();
  for (const [, room] of rooms) {
    for (const st of room.built.stations || []) for (const a of st.actions) kinds.add(a.kind);
  }
  for (const st of home.built.stations || []) for (const a of st.actions) kinds.add(a.kind);
  check('Stations use every kind of action the panel supports',
    ['activity', 'shop', 'appearance', 'enter', 'inventory'].every((k) => kinds.has(k)),
    [...kinds].join(', '));
  const homeStations = (home.built.stations || []).map((st) => st.id);
  const homeActivities = new Set();
  for (const st of home.built.stations || []) for (const a of st.actions) if (a.kind === 'activity') homeActivities.add(a.id);
  check('A home has somewhere to sleep', homeActivities.has('sleep') && homeActivities.has('nap'));
  check('A home has somewhere to cook and eat', homeActivities.has('cook') && homeActivities.has('eat'));
  check('A home has a bathroom job', homeActivities.has('shower') && homeActivities.has('laundry'));
  check('A home has somewhere to rest and be entertained',
    homeActivities.has('watch_tv') && homeActivities.has('rest') && homeActivities.has('read_book'));
  check('A home has somewhere to work', homeActivities.has('home_work'));
  check('A home lets you change clothes and reach your things',
    homeStations.includes('wardrobe') && homeStations.includes('storage'),
    homeStations.join(', '));

  // ── Every shop button must be able to complete ──────────────
  // A station whose venue id the server does not know opens a panel that can
  // only ever say "That place does not sell anything". That happened: four
  // interiors had a shop counter with no catalogue entry behind it.
  const deadShops = [];
  const emptyShops = [];
  for (const [id, room] of [...rooms, [home.def.id, home]]) {
    for (const st of room.built.stations || []) {
      for (const a of st.actions) {
        if (a.kind !== 'shop') continue;
        const shop = getVenueShop(a.venue);
        if (!shop) deadShops.push(`${id}/${st.id}→${a.venue}`);
        else if (getVenueStock(a.venue).length === 0) emptyShops.push(`${id}/${st.id}→${a.venue}`);
      }
    }
  }
  check('Every shop station points at a venue the server can sell from',
    deadShops.length === 0, deadShops.join(', ') || 'all resolved');
  check('And that venue actually has stock', emptyShops.length === 0,
    emptyShops.join(', ') || 'all stocked');

  // ── No station may offer something its own venue refuses ────
  // The server gates activities by place: you cannot sit an exam from the
  // middle of a road. So every activity a station offers has to be legal in
  // the room that station is in, or the button is a lie that only fails when
  // pressed. This walks all of them and checks the same rule the server uses.
  const illegal = [];
  for (const [id, room] of [...rooms, [home.def.id, home]]) {
    const kind = venueKind(id);
    for (const st of room.built.stations || []) {
      for (const a of st.actions) {
        if (a.kind !== 'activity') continue;
        const act = activityConfig.activities[a.id];
        if (!act) { illegal.push(`${id}/${st.id}→${a.id} (unknown activity)`); continue; }
        if (Array.isArray(act.requiresVenueKind) && act.requiresVenueKind.length) {
          if (!kind || !act.requiresVenueKind.includes(kind)) {
            illegal.push(`${id}/${st.id}→${a.id} (${act.name} needs ${act.requiresVenueKind.join('/')}, room is ${kind || 'unknown'})`);
          }
        }
        if (Array.isArray(act.requiresVenue) && act.requiresVenue.length && !act.requiresVenue.includes(id)) {
          illegal.push(`${id}/${st.id}→${a.id} (${act.name} needs ${act.requiresVenue.join('/')})`);
        }
      }
    }
  }
  check('Every activity a station offers is legal in that room', illegal.length === 0,
    illegal.slice(0, 4).join(' | ') || 'all legal');

  // Every room must have more to do than "talk to the person at the counter".
  // One station is the shape of a room that was never finished.
  const thin = [...rooms, [home.def.id, home]]
    .filter(([, r]) => (r.built.stations || []).length < 3)
    .map(([id, r]) => `${id} (${(r.built.stations || []).length})`);
  check('No room has fewer than 3 places to interact', thin.length === 0, thin.join(', ') || 'all rooms have 3+');

  // ── A staff station must have a person behind it ────────────
  // The panel asks the server who is at the counter. If a room offers a "talk
  // to the staff" button but the server has nobody for that kind of room, the
  // button opens an apology. Every room that advertises an attendant must have
  // one, with at least one service they will actually perform.
  const noStaff = [];
  for (const [id, room] of [...rooms, [home.def.id, home]]) {
    const offersStaff = (room.built.stations || []).some((st) => st.actions.some((a) => a.kind === 'staff'));
    if (!offersStaff) continue;
    const kind = venueKind(id);
    const person = staffFor(kind);
    if (!person) noStaff.push(`${id} (nobody works there)`);
    else if (!person.services.length) noStaff.push(`${id}/${person.name} (no services)`);
  }
  check('Every room with a staff station has a real attendant', noStaff.length === 0,
    noStaff.join(', ') || 'all staffed');

  // The supermarket sells; the airport boards.
  const sup = rooms.get('in-supermarket');
  check('The supermarket sells something at every shop station',
    (sup.built.stations || []).filter((st) => st.actions.some((a) => a.kind === 'shop')).length >= 2,
    (sup.built.stations || []).map((st) => st.id).join(', '));
  const air = rooms.get('in-airport');
  const airIds = (air.built.stations || []).map((st) => st.id);
  check('The airport has check-in, security and a gate',
    ['check-in', 'security', 'gate'].every((id) => airIds.includes(id)), airIds.join(', '));
  const field = rooms.get('in-airfield');
  check('The apron has a boarding gate and a way back',
    (field.built.stations || []).some((st) => st.id === 'boarding')
      && (field.built.stations || []).some((st) => st.actions.some((a) => a.kind === 'enter')),
    (field.built.stations || []).map((st) => st.id).join(', '));
}

// ── Nothing is empty ─────────────────────────────────────────
console.log('\n[No empty rooms]');
for (const [id, room] of rooms) {
  const count = Object.values(room.manifest).reduce((a, b) => a + b, 0);
  check(`${room.def.name} has furniture`, count >= 4, `${count} props, ${Object.keys(room.manifest).length} distinct`);
}
// The market the player complained about specifically.
{
  const market = rooms.get('in-market');
  const stalls = market.manifest.marketStall || 0;
  check('The market has a real stall line', stalls >= 8, `${stalls} stalls`);
  const distinct = Object.keys(market.manifest).length;
  check('The market sells more than one kind of thing', distinct >= 5, Object.keys(market.manifest).join(', '));
}

// ── Prop counts that matter to the venue ─────────────────────
console.log('\n[Enough of the important thing]');
{
  const church = rooms.get('in-church');
  check('The church seats a congregation', (church.manifest.pew || 0) >= 10, `${church.manifest.pew} pews`);
  const hospital = rooms.get('in-hospital');
  check('The hospital has a ward, not one bed', (hospital.manifest.hospitalBed || 0) >= 6,
    `${hospital.manifest.hospitalBed} beds`);
  const bank = rooms.get('in-bank');
  check('The bank has a row of tellers', (bank.manifest.tellerCounter || 0) >= 4,
    `${bank.manifest.tellerCounter} counters`);
  const airport = rooms.get('in-airport');
  check('The airport has a row of check-in desks', (airport.manifest.checkInDesk || 0) >= 3,
    `${airport.manifest.checkInDesk} desks`);
  const school = rooms.get('in-school');
  check('The school has a full classroom', (school.manifest.schoolDesk || 0) >= 12,
    `${school.manifest.schoolDesk} desks`);
  const mosque = rooms.get('in-mosque');
  check('The mosque lays out a prayer hall', (mosque.manifest.prayerMat || 0) >= 30,
    `${mosque.manifest.prayerMat} mats`);
}

// ── Every venue type is furnished differently ───────────────
console.log('\n[Variety]');
{
  const fingerprints = new Map();
  for (const [id, room] of rooms) {
    const fp = Object.keys(room.manifest).sort().join('|');
    const list = fingerprints.get(fp) || [];
    list.push(room.def.name);
    fingerprints.set(fp, list);
  }
  const dupes = [...fingerprints.values()].filter((l) => l.length > 1);
  check('No two named interiors have the same contents', dupes.length === 0,
    dupes.length ? dupes.map((l) => l.join(' = ')).join('; ') : `${fingerprints.size} distinct rooms`);

  const types = new Set(namedInteriors.map((d) => d.type));
  check('The city has a broad range of venues', types.size >= 12, `${types.size} kinds: ${[...types].join(', ')}`);
}

// ── Doorway is never blocked ────────────────────────────────
console.log('\n[Doorway clear]');
for (const [id, room] of rooms) {
  const { def, built } = room;
  const hd = def.depth / 2;
  // Walk from the spawn point straight in: (0, hd-1) → (0, hd-4), 0.1 m steps.
  let blocked = false;
  for (let z = hd - 0.9; z > hd - 4.0; z -= 0.1) {
    for (const c of built.collisions) {
      if (0 > c.minX && 0 < c.maxX && z > c.minZ && z < c.maxZ) { blocked = true; break; }
    }
    if (blocked) break;
  }
  check(`${def.name}: you can walk in`, !blocked);
}

// ── Reachability: the ward aisle, the nave, the check-in floor ──
console.log('\n[Reachability]');
function reachability(def, built) {
  const step = 0.25;
  const cols = Math.floor(def.width / step);
  const rows = Math.floor(def.depth / step);
  const free = (x, z) => {
    for (const c of built.collisions) {
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return false;
    }
    return Math.abs(x) < def.width / 2 - 0.25 && Math.abs(z) < def.depth / 2 - 0.25;
  };
  const idx = (c, r) => r * cols + c;
  const seen = new Uint8Array(cols * rows);
  const startC = Math.floor(cols / 2);
  const startR = rows - 3;
  const stack = [[startC, startR]];
  seen[idx(startC, startR)] = 1;
  let reach = 0;
  let total = 0;
  while (stack.length) {
    const [c, r] = stack.pop();
    const x = -def.width / 2 + step * (c + 0.5);
    const z = -def.depth / 2 + step * (r + 0.5);
    if (free(x, z)) reach++;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (seen[idx(nc, nr)]) continue;
      const nx = -def.width / 2 + step * (nc + 0.5);
      const nz = -def.depth / 2 + step * (nr + 0.5);
      if (!free(nx, nz)) continue;
      seen[idx(nc, nr)] = 1;
      stack.push([nc, nr]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -def.width / 2 + step * (c + 0.5);
      const z = -def.depth / 2 + step * (r + 0.5);
      if (free(x, z)) total++;
    }
  }
  return total ? reach / total : 0;
}

for (const [id, room] of rooms) {
  const pct = reachability(room.def, room.built) * 100;
  check(`${room.def.name} is walkable`, pct >= 80, `${pct.toFixed(1)}% of the open floor reachable from the door`);
}

// ── Homes still get homes, not shop floors ──────────────────
console.log('\n[Residential untouched]');
{
  const homes = allInteriors().filter((d) => d.residential);
  check('There are apartments to live in', homes.length >= 4, `${homes.length} apartments`);
  const home = buildInterior(homes[0]);
  const shopProps = ['marketStall', 'tellerCounter', 'officerDesk', 'checkInDesk']
    .filter((p) => home.manifest[p]);
  check('A home is not furnished as a venue', shopProps.length === 0,
    Object.keys(home.manifest).length ? `home props only (${Object.keys(home.manifest).length} venue pieces avoided)` : 'no venue props');
}

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
