// client/test-interiors.mjs
// Interior walkability and variety.
//
// Two complaints drove this file:
//   "the inside of the houses are all the same"
//   "movement in the house is limited as the furniture are blocking the character"
//
// Both are measurable without a browser:
//   · walkability — rasterise the floor, mark every collision AABB, flood-fill
//     from the spawn point, and see how much of the free floor the player can
//     actually reach. Furniture that seals off a corner shows up immediately.
//   · variety — fingerprint each interior by what is in it, and count how many
//     distinct interiors the city actually has.

// Canvas stub: materials.js paints textures through a 2D canvas, which Node
// does not have. Same stub verify-world.mjs uses.
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

import * as THREE from 'three';
import { buildInterior } from './src/world/InteriorBuilder.js';
import { allInteriors } from './src/world/interiorData.js';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const CELL = 0.2;          // metres per raster cell
const PLAYER_R = 0.35;     // same radius the controller uses

/** Flood-fill the floor of one built interior. */
function analyse(built, def) {
  const { bounds } = built;
  const cols = Math.ceil((bounds.maxX - bounds.minX) / CELL);
  const rows = Math.ceil((bounds.maxZ - bounds.minZ) / CELL);

  const blocked = new Uint8Array(cols * rows);
  const cellOf = (x, z) => {
    const c = Math.floor((x - bounds.minX) / CELL);
    const r = Math.floor((z - bounds.minZ) / CELL);
    return { c, r };
  };

  // Mark walls and furniture. The player is a circle, so a cell is blocked if
  // its centre is within PLAYER_R of any AABB.
  for (const b of built.collisions) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (blocked[r * cols + c]) continue;
        const x = bounds.minX + (c + 0.5) * CELL;
        const z = bounds.minZ + (r + 0.5) * CELL;
        const cx = Math.max(b.minX, Math.min(x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        if (Math.hypot(x - cx, z - cz) < PLAYER_R) blocked[r * cols + c] = 1;
      }
    }
  }

  const spawn = cellOf(built.spawn.x, built.spawn.z);
  const seen = new Uint8Array(cols * rows);
  const queue = [[spawn.c, spawn.r]];
  if (blocked[spawn.r * cols + spawn.c]) {
    return { blockedAtSpawn: true, reachable: 0, free: 0, fraction: 0, spawn };
  }
  seen[spawn.r * cols + spawn.c] = 1;

  while (queue.length) {
    const [c, r] = queue.pop();
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const i = nr * cols + nc;
      if (seen[i] || blocked[i]) continue;
      seen[i] = 1;
      queue.push([nc, nr]);
    }
  }

  let free = 0;
  let reachable = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (blocked[i]) continue;
    free++;
    if (seen[i]) reachable++;
  }

  return {
    blockedAtSpawn: false,
    free,
    reachable,
    fraction: free ? reachable / free : 0,
    area: free * CELL * CELL,
    cols,
    rows,
    seen,
    blocked,
    cellOf,
    name: def.name,
  };
}

/** Fingerprint: what is actually in the room. */
function fingerprint(built, def) {
  return [
    def.type,
    Math.round(def.width),
    Math.round(def.depth),
    built.collisions.length,
    Math.round(built.bounds.maxX * 10),
    Math.round(built.bounds.maxZ * 10),
    built.lights.length,
  ].join('|');
}

console.log('\n[Interiors: walkability]');
const defs = allInteriors();
const results = [];

for (const def of defs) {
  let built;
  try {
    built = buildInterior(def);
  } catch (err) {
    check(`${def.name} builds`, false, err.message);
    continue;
  }
  const a = analyse(built, def);
  results.push({ def, built, a, fp: fingerprint(built, def) });

  if (a.blockedAtSpawn) {
    check(`${def.name} — spawn is clear`, false, 'player spawns inside furniture');
    continue;
  }
  // A room is usable if the player can walk to almost all of its free floor.
  check(`${def.name} — floor reachable`, a.fraction >= 0.9,
    `${(a.fraction * 100).toFixed(1)}% of ${a.area.toFixed(0)} m² floor reachable`);
}

console.log('\n[Interiors: variety]');
const fingerprints = new Set(results.map((r) => r.fp));
check('Every interior is distinct', fingerprints.size === results.length,
  `${fingerprints.size} distinct layouts across ${results.length} interior doors`);

const types = new Set(results.map((r) => r.def.type));
check('More than one kind of interior', types.size >= 4, `${types.size} types: ${[...types].join(', ')}`);

// Homes and workplaces must not share a furniture budget.
const homeFurniture = results.filter((r) => /studio|onebed|twobed/.test(r.def.type));
const shopFurniture = results.filter((r) => r.def.type === 'shop');
if (homeFurniture.length && shopFurniture.length) {
  const avg = (list) => list.reduce((n, r) => n + r.built.collisions.length, 0) / list.length;
  check('Shops are fitted differently from homes',
    Math.abs(avg(homeFurniture) - avg(shopFurniture)) > 2,
    `homes avg ${avg(homeFurniture).toFixed(0)} colliders, shops avg ${avg(shopFurniture).toFixed(0)}`);
}

// The old bug: a solid ring of furniture around the player's own spawn point.
const worst = results.reduce((w, r) => (r.a.fraction < (w?.a.fraction ?? 1) ? r : w), null);
if (worst) {
  check('Worst interior still mostly walkable', worst.a.fraction >= 0.9,
    `${worst.def.name}: ${(worst.a.fraction * 100).toFixed(1)}%`);
}

console.log('\n[Interiors: geometry]');
const anyEmpty = results.filter((r) => r.built.collisions.length === 0);
check('Every interior has walls', anyEmpty.length === 0, `${anyEmpty.length} with no colliders`);
const anyNoLights = results.filter((r) => r.built.lights.length === 0);
check('Every interior is lit', anyNoLights.length === 0, `${anyNoLights.length} unlit`);
const anyNoMesh = results.filter((r) => !r.built.group || r.built.group.children.length === 0);
check('Every interior produced geometry', anyNoMesh.length === 0);

console.log(`\n=========================`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log(`=========================\n`);
process.exit(failed ? 1 : 0);
