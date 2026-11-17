// client/verify-world.mjs
// Structural checks on the generated world that do not need a GPU:
//  - every door is reachable (not inside a building's collision box)
//  - every door is inside the walkable map
//  - buildings actually have volume and sit on the ground
//  - interiors have a spawn that is not colliding with furniture
// Run from /home/user/client:  node verify-world.mjs

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

import { CityBuilder } from './src/world/CityBuilder.js';
import { buildings, WORLD_BOUNDS } from './src/world/cityData.js';
import { buildDoorRegistry } from './src/world/interiorData.js';
import { buildInterior } from './src/world/InteriorBuilder.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const city = new CityBuilder();
city.build();
const boxes = city.getCollisionBoxes();

console.log('\n[City]');
check('Buildings with volume', buildings.filter(b => b.size.h >= 0.5).length > 50,
  `${buildings.filter(b => b.size.h >= 0.5).length} solids`);
check('Collision boxes generated', boxes.length > 90, `${boxes.length} AABBs`);
check('Merged district meshes exist', city.buildingGroup.children.length > 0,
  `${city.buildingGroup.children.length} merged groups`);

const stats = city.getStats();
check('Draw calls stay in budget', stats.meshes < 400, `${stats.meshes} meshes`);
check('Triangle budget', stats.triangles > 100000 && stats.triangles < 600000,
  `${stats.triangles.toLocaleString()} tris`);

// Nothing may be sunk below the ground plane
let sunk = 0;
let lowest = Infinity;
city.buildingGroup.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  if (g.boundingBox.min.y < -0.6) sunk++;
  lowest = Math.min(lowest, g.boundingBox.min.y);
});
check('Nothing is sunk below the ground plane', sunk === 0,
  `lowest vertex y = ${lowest.toFixed(2)}`);

console.log('\n[Door reachability]');
const doors = buildDoorRegistry();
const radius = 0.4;

function pointBlocked(x, z) {
  for (const b of boxes) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

let blocked = 0;
for (const d of doors) {
  if (pointBlocked(d.x, d.z)) {
    blocked++;
    console.log(`     blocked door: ${d.name} at (${d.x.toFixed(1)}, ${d.z.toFixed(1)})`);
  }
}
check('Every door is reachable by a 0.4-radius player', blocked === 0, `${blocked} blocked of ${doors.length}`);

const outOfMap = doors.filter((d) => d.x < WORLD_BOUNDS.minX + 1 || d.x > WORLD_BOUNDS.maxX - 1
  || d.z < WORLD_BOUNDS.minZ + 1 || d.z > WORLD_BOUNDS.maxZ - 1).length;
check('Every door is inside the map bounds', outOfMap === 0, `${outOfMap} outside`);

console.log('\n[Interiors]');
let spawnBlocked = 0;
let spawnOutside = 0;
for (const d of doors) {
  const built = buildInterior({
    id: d.interiorId, name: d.name,
    type: d.residential ? 'onebed' : 'studio',
    width: 11, depth: 9, height: 3,
  });
  const s = built.spawn;
  const b = built.bounds;
  if (s.x < b.minX || s.x > b.maxX || s.z < b.minZ || s.z > b.maxZ) spawnOutside++;
  for (const c of built.collisions) {
    const cx = Math.max(c.minX, Math.min(s.x, c.maxX));
    const cz = Math.max(c.minZ, Math.min(s.z, c.maxZ));
    if ((s.x - cx) ** 2 + (s.z - cz) ** 2 < radius * radius) {
      spawnBlocked++;
      console.log(`     blocked spawn in ${d.name}: (${s.x}, ${s.z})`);
      break;
    }
  }
}
check('Every interior spawn is inside its room', spawnOutside === 0, `${spawnOutside} outside`);
check('Every interior spawn is clear of furniture', spawnBlocked === 0, `${spawnBlocked} blocked`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
