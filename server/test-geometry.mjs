// server/test-geometry.mjs
// Guard against the server's copy of the world drifting from the client's map.
//
// The server holds a generated copy of districts and landmarks
// (config/worldGeometry.js) because it cannot import the client's map modules
// (they pull in three.js). That copy is only safe if it is regenerated whenever
// the map changes — and it was exactly this kind of silent drift that left the
// server checking the old 200 m city while the game rendered Eko Basin, so every
// bank and shop interaction refused with "Too far away".
//
// Run:  node test-geometry.mjs

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n[Generated geometry]');

let drift = false;
let message = '';
try {
  message = execFileSync(process.execPath, [join(HERE, 'scripts', 'gen-geometry.mjs'), '--check'], {
    encoding: 'utf8',
  }).trim();
} catch (err) {
  drift = true;
  message = (err.stdout || err.stderr || err.message).trim();
}
check('The server-side world map matches the client map', !drift, message);

const geo = await import('./config/worldGeometry.js');
const client = await import('../client/src/world/ekoWorld.js');

check('Every client district is in the server map',
  client.districts.every((d) => geo.DISTRICTS.some((s) => s.id === d.id)),
  `${geo.DISTRICTS.length} districts`);

check('District positions agree with the client',
  client.districts.every((d) => {
    const s = geo.DISTRICTS.find((x) => x.id === d.id);
    return s && Math.abs(s.x - d.x) < 0.02 && Math.abs(s.z - d.z) < 0.02;
  }), 'coordinates match to the centimetre');

check('Every district sets a unique visit bit',
  new Set(geo.DISTRICTS.map((d) => d.bit)).size === geo.DISTRICTS.length,
  `${geo.DISTRICTS.length} unique bits`);

check('The four legacy district bits are unchanged',
  geo.DISTRICTS.find((d) => d.id === 'mushin')?.bit === 1
  && geo.DISTRICTS.find((d) => d.id === 'yaba')?.bit === 2
  && geo.DISTRICTS.find((d) => d.id === 'victoria-island')?.bit === 4
  && geo.DISTRICTS.find((d) => d.id === 'lekki')?.bit === 8,
  'existing saves still mean what they meant');

check('Every interaction anchor the server validates exists on the map',
  geo.INTERACTION_ANCHORS.length >= 5,
  geo.INTERACTION_ANCHORS.map((a) => a.id).join(', '));

check('The anchors match the client\'s standable spots',
  client.INTERACTION_ANCHORS.every((a) => {
    const s = geo.INTERACTION_ANCHORS.find((x) => x.id === a.id);
    return s && Math.abs(s.x - a.x) < 0.02 && Math.abs(s.z - a.z) < 0.02;
  }));

check('Landmarks are on their districts',
  geo.KEY_BUILDINGS.every((b) => !b.district || geo.DISTRICTS.some((d) => d.id === b.district)),
  `${geo.KEY_BUILDINGS.length} landmarks`);

check('The interaction points sit on the generated anchors',
  (await import('./config/interactionConfig.js')).interactionConfig.points.every((p) => {
    const a = geo.districtAt(p.position.x, p.position.z);
    return a || geo.INTERACTION_ANCHORS.some((x) => Math.abs(x.x - p.position.x) < 0.05);
  }), 'no counter is in the lagoon');

// Interiors are the case that silently broke: indoors the coordinates are
// room-local, so a point test reports "no district" and crimes committed inside
// a shop raise nothing.
console.log('\n[Interiors belong to the district they stand in]');
const indoor = [
  ['in-dealership', 'victoria-island'],
  ['in-market', 'oshodi'],
  ['in-bank', 'marina'],
];
for (const [interiorId, expected] of indoor) {
  const d = geo.districtForPlayer({ x: 0, z: 2.4 }, interiorId);
  check(`${interiorId} is in ${expected}`, d?.id === expected, d?.id || 'none');
}
check('Outdoors the position decides, as before',
  geo.districtForPlayer({ x: 258, z: -66 }, null)?.id === 'mushin');
check('A room with no building row reports no district rather than guessing',
  geo.districtForPlayer({ x: 0, z: 0 }, 'in-nowhere') === null);

// Homes are geography too: a listing whose front door is in the lagoon is a
// house nobody can move into.
console.log('\n[Purchasable homes are on the map]');
const props = (await import('./config/propertyConfig.js')).propertyConfig.properties;
const basin = await import('../client/src/world/ekoBasin.js');
for (const p of props) {
  const place = geo.PROPERTY_PLACEMENT[p.id];
  check(`${p.id} has a house on the map`, !!place, place?.buildingId || 'missing');
  if (place) {
    check(`${p.id} stands on land`, !!basin.islandAt(p.position.x, p.position.z),
      basin.islandAt(p.position.x, p.position.z)?.shortName || 'WATER');
    check(`${p.id} is in a district the server knows`,
      geo.DISTRICTS.some((d) => d.id === p.district), p.district);
    check(`${p.id} uses the map's own coordinates`,
      Math.abs(p.position.x - place.x) < 0.01 && Math.abs(p.position.z - place.z) < 0.01,
      `${p.position.x}, ${p.position.z}`);
  }
}

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
