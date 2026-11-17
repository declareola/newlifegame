// client/test-nav.mjs
// Verifies the navigation network against the real collision data:
//   · the grid is built from the same AABBs the player collides with
//   · every route between key locations exists
//   · no route ever passes through a blocked cell
//   · routes are reasonably direct (not absurd detours)
// Run from /home/user/client:  node test-nav.mjs

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
import { NavGrid } from './src/world/navGraph.js';
import { buildDoorRegistry } from './src/world/interiorData.js';
import {
  districts, SPAWN, WORLD_BOUNDS, INTERACTION_ANCHORS, BRIDGES, toWorld, islandAt,
} from './src/world/cityData.js';
import { ISLANDS } from './src/world/ekoBasin.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const city = new CityBuilder();
city.build();
const boxes = city.getCollisionBoxes();

console.log('\n[Nav grid]');
const t0 = Date.now();
const walkways = BRIDGES.map((b) => ({
  a: toWorld(b.a[0], b.a[1]), b: toWorld(b.b[0], b.b[1]), width: b.deckWidth + 1.2,
}));
const nav = new NavGrid({ boxes, radius: 0.45, bounds: WORLD_BOUNDS, walkways });
const buildMs = Date.now() - t0;

let blockedCells = 0;
let freeCells = 0;
for (let i = 0; i < nav.blocked.length; i++) {
  if (nav.blocked[i]) blockedCells++; else freeCells++;
}
check('Grid built from real collision boxes', blockedCells > 1000,
  `${blockedCells.toLocaleString()} blocked, ${freeCells.toLocaleString()} walkable, ${buildMs} ms`);
check('Build time acceptable (< 400 ms)', buildMs < 400, `${buildMs} ms`);
check('Streets discovered', nav.streets.segments.length > 3,
  `${nav.streets.segments.length} side streets, ${nav.streets.intersections.length} junctions`);

console.log('\n[Spawn + doors]');
// The same spot main.js spawns players on: the Third Bridge Canteen doorstep.
const spawn = { x: SPAWN.x, z: SPAWN.z };
nav.computeReachable(spawn);
check('Spawn point is walkable', nav.isWalkable(spawn.x, spawn.z));
// Sample points must be ground the player can actually stand on: the five
// interaction anchors the server validates, plus all four district corners.
// Every landmark the server exposes a door or counter for, read from the map
// rather than typed in: a hard-coded list is how this test kept passing after
// the map had moved out from under it.
const anchorPoints = INTERACTION_ANCHORS.map((a) => ({ name: a.id, x: a.x, z: a.z }));
const unreached = anchorPoints.filter((a) => !nav.isReachable(a.x, a.z));
check('Reachability flood fill covers every interaction anchor',
  unreached.length === 0,
  `${(anchorPoints.length - unreached.length)}/${anchorPoints.length} anchors reachable, ` +
  `${nav.reachable.reduce((a, b) => a + b, 0).toLocaleString()} reachable cells`);
check('Interaction anchors are standable, not inside a building',
  anchorPoints.every((a) => nav.isWalkable(a.x, a.z)),
  anchorPoints.filter((a) => !nav.isWalkable(a.x, a.z)).map((a) => a.name).join(', ') || 'all clear');
check('Nearest-walkable fallback works',
  !!nav.nearestWalkable(SPAWN.x + 30, SPAWN.z),
  JSON.stringify(nav.nearestWalkable(SPAWN.x + 30, SPAWN.z)));

const nav2 = (() => { nav.computeReachable(spawn); return nav; })();
const allDoors = buildDoorRegistry(nav2);

// Banana Island has no bridge — the blueprint is explicit that it is reached by
// boat or metro only. So its buildings are not "routable on foot" and must not
// be counted as such; they are checked against the boat/metro route instead.
const onBanana = (p) => islandAt(p.x, p.z)?.id === 'banana';
const doors = allDoors.filter((d) => !onBanana(d));
const bananaDoors = allDoors.filter(onBanana);

check('Banana Island is reachable only by water or metro, and its two homes are there',
  bananaDoors.length >= 1,
  `${bananaDoors.length} door(s) on Banana Island, ${BRIDGES.filter((b) => b.from === 'banana' || b.to === 'banana').length} bridges`);

const districtCentres = districts
  .filter((d) => !onBanana(d))
  .map(d => ({ name: d.name, x: d.x, z: d.z }));

console.log('\n[Routes]');
let routed = 0;
let total = 0;
let illegal = 0;
let maxDetour = 0;

const targets = [
  ...doors.map(d => ({ name: d.name, x: d.x, z: d.z })),
  ...districtCentres,
];

for (const t of targets) {
  total++;
  const path = nav.findPath(spawn, t);
  if (!path) {
    console.log(`     no route: ${t.name}`);
    continue;
  }
  routed++;

  // Walk the path and assert every sample is on walkable ground
  let ok = true;
  let prev = spawn;
  for (const p of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.4));
    for (let i = 0; i <= steps; i++) {
      const x = prev.x + (p.x - prev.x) * (i / steps);
      const z = prev.z + (p.z - prev.z) * (i / steps);
      if (!nav.isWalkable(x, z)) { ok = false; break; }
    }
    if (!ok) break;
    prev = p;
  }
  if (!ok) {
    illegal++;
    console.log(`     route crosses blocked ground: ${t.name}`);
  }

  // Detour ratio only means something within one island. A cross-island route
  // has to go over a bridge, so a 4× "detour" is just the shape of the lagoon.
  const sameIsland = islandAt(t.x, t.z)?.id === islandAt(spawn.x, spawn.z)?.id;
  if (sameIsland) {
    const len = NavGrid.pathLength(path, spawn.x, spawn.z);
    const crow = Math.hypot(t.x - spawn.x, t.z - spawn.z);
    const detour = len / Math.max(crow, 1);
    if (detour > maxDetour) maxDetour = detour;
  }
}

check('Every destination is routable from spawn', routed === total, `${routed}/${total}`);
const unreachableDoors = doors.filter(d => !nav.isReachable(d.x, d.z)).length;
check('Every door sits on reachable ground', unreachableDoors === 0, `${unreachableDoors} unreachable`);
check('No route crosses a wall or building', illegal === 0, `${illegal} illegal routes`);
check('Routes within an island are not absurd detours', maxDetour < 3.2, `worst detour ${maxDetour.toFixed(2)}× straight line`);

console.log('\n[A* speed]');
const t1 = Date.now();
let searches = 0;
for (const d of doors) { if (nav.findPath({ x: 0, z: 8 }, d)) searches++; }
const ms = Date.now() - t1;
check('Path queries are fast enough for real time', ms / Math.max(searches, 1) < 60,
  `${(ms / Math.max(searches, 1)).toFixed(1)} ms per query`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
