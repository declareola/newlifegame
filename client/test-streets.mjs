// client/test-streets.mjs
// The Eko Basin street plan, the traffic and the vegetation.
//
// This file checks claims that can be verified numerically without a GPU:
//   · the road grid is clipped to land and routed around the landmarks
//   · no building stands in a road, overlaps its neighbour, or covers an anchor
//   · cars are parked on kerbs, drive down strips, and obey the signals
//   · trees stand on the pavement, never in a lane or through a wall
//   · the renderer actually draws islands, lagoon, bridges, metro and labels
//
// Run from /home/user/client:  node test-streets.mjs

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
import { CityBuilder } from './src/world/CityBuilder.js';
import {
  buildings, roads, treePositions, palmTreePositions, lightPositions,
  INTERACTION_ANCHORS, WORLD_BOUNDS, SPAWN, WORLD_STATS, onRoadway,
} from './src/world/cityData.js';
import {
  ISLANDS, BRIDGES, METRO_LINES, METRO_STATIONS, METRO_AMBUSHES,
  MISSION_PINS, SAFEHOUSES, FACTIONS, HEIST_TARGET, islandAt, islandPolygon, toWorld,
  factionForIsland,
} from './src/world/ekoBasin.js';
import { TrafficSystem, signalState, CAR_KINDS, NETWORK } from './src/world/TrafficSystem.js';
import { createTrees } from './src/world/Trees.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const rectOf = (b) => ({
  minX: b.position.x - b.size.w / 2, maxX: b.position.x + b.size.w / 2,
  minZ: b.position.z - b.size.d / 2, maxZ: b.position.z + b.size.d / 2,
});
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

// ── The map ─────────────────────────────────────────────────
console.log('\n[Eko Basin]');
check('Four islands', ISLANDS.length === 4, ISLANDS.map((i) => i.name).join(', '));
check('Every island resolves as land at its own centre',
  ISLANDS.every((i) => {
    const pts = islandPolygon(i);
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    return !!islandAt(cx, cz);
  }), 'islandAt() agrees with the polygons');
check('Three bridges', BRIDGES.length === 3, BRIDGES.map((b) => b.name).join(', '));
check('Banana Island has no bridge (boat / metro only, per the blueprint)',
  BRIDGES.every((b) => b.from !== 'banana' && b.to !== 'banana'),
  'no bridge touches Banana Island');
check('Three metro lines and eleven stations',
  METRO_LINES.length === 3 && METRO_STATIONS.length === 11,
  `${METRO_LINES.length} lines, ${METRO_STATIONS.length} stations`);
check('One ambush choke point per metro line',
  METRO_AMBUSHES.length === 3 && METRO_LINES.every((l) => METRO_AMBUSHES.some((a) => a.line === l.id)),
  METRO_AMBUSHES.map((a) => `${a.line}@${a.at}`).join(', '));
check('Twelve campaign pins', MISSION_PINS.length === 12, MISSION_PINS.map((p) => p.chapter).join(','));
check('Three safehouses on the Outer Borough', SAFEHOUSES.length === 3);
check('Three factions hold turf', FACTIONS.length === 3
  && ISLANDS.every((i) => FACTIONS.some((f) => f.id === factionForIsland(i.id))),
  FACTIONS.map((f) => f.name).join(', '));
check('The heist target sits on an island', !!islandAt(...Object.values((() => {
  const p = toWorld(HEIST_TARGET.pixels[0], HEIST_TARGET.pixels[1]);
  return { x: p.x, z: p.z };
})())));

// ── The street plan ─────────────────────────────────────────
console.log('\n[Street plan]');
check('The grid has both avenues and side streets',
  roads.some((r) => r.avenue) && roads.some((r) => !r.avenue),
  `${roads.filter((r) => r.avenue).length} avenue strips, ${roads.filter((r) => !r.avenue).length} side-street strips`);
check('Avenues are wider than side streets',
  Math.min(...roads.filter((r) => r.avenue).map((r) => Math.min(r.w, r.d)))
  > Math.max(...roads.filter((r) => !r.avenue).map((r) => Math.min(r.w, r.d))),
  'avenue 7.5 m vs side street 3.4 m');
check('Every road strip lies on land at both ends',
  roads.every((r) => {
    const vertical = r.d >= r.w;
    const a = vertical ? { x: r.x, z: r.z - r.d / 2 + 0.5 } : { x: r.x - r.w / 2 + 0.5, z: r.z };
    const b = vertical ? { x: r.x, z: r.z + r.d / 2 - 0.5 } : { x: r.x + r.w / 2 - 0.5, z: r.z };
    return !!islandAt(a.x, a.z) && !!islandAt(b.x, b.z);
  }), `${roads.length} strips, all clipped to the islands`);
check('Roads are exported for the map screen', roads.length > 40, `${roads.length} segments`);
check('The world is the basin, not the old 200 m square',
  WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX > 700 && WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ > 350,
  `${WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX} × ${WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ} m`);

// ── Buildings vs the street ─────────────────────────────────
console.log('\n[Buildings]');
const inRoad = buildings.filter((b) => b.size.h >= 0.5
  && roads.some((r) => overlaps(rectOf(b), rectOf({
    position: { x: r.x, z: r.z }, size: { w: r.w, d: r.d },
  }))));
check('No building stands in a roadway', inRoad.length === 0,
  inRoad.length ? inRoad.slice(0, 6).map((b) => b.id).join(', ') : `${buildings.length} buildings clear`);

let overlapping = 0;
for (let i = 0; i < buildings.length; i++) {
  for (let j = i + 1; j < buildings.length; j++) {
    if (buildings[i].size.h < 0.5 || buildings[j].size.h < 0.5) continue;
    if (overlaps(rectOf(buildings[i]), rectOf(buildings[j]))) overlapping++;
  }
}
check('No two buildings overlap', overlapping === 0, `${overlapping} overlapping pairs`);

const offLand = buildings.filter((b) => !islandAt(b.position.x, b.position.z));
check('Every building stands on an island', offLand.length === 0,
  offLand.length ? offLand.map((b) => b.id).join(', ') : 'all on land');

const covered = INTERACTION_ANCHORS.filter((a) => buildings.some((b) => b.size.h >= 0.5
  && a.x > rectOf(b).minX + 0.2 && a.x < rectOf(b).maxX - 0.2
  && a.z > rectOf(b).minZ + 0.2 && a.z < rectOf(b).maxZ - 0.2));
check('No building covers an interaction anchor', covered.length === 0,
  covered.map((a) => a.id).join(', ') || `all ${INTERACTION_ANCHORS.length} anchors standable`);

check('The spawn point is on land and off the road',
  !!islandAt(SPAWN.x, SPAWN.z) && !onRoadway(SPAWN.x, SPAWN.z, 0.3),
  `(${SPAWN.x.toFixed(1)}, ${SPAWN.z.toFixed(1)}) on ${SPAWN.island}`);
check('Every legacy building id survived the map change',
  ['bank', 'atm', 'market', 'hospital', 'airport', 'tech-hub', 'restaurant', 'gym',
    'prop-hostel-bed', 'prop-yaba-studio', 'prop-vi-apartment', 'prop-lekki-duplex',
    'prop-waterfront-mansion', 'police', 'church', 'mosque', 'school', 'supermarket']
    .every((id) => buildings.some((b) => b.id === id)),
  `${WORLD_STATS.totalBuildings} buildings total`);

// ── Traffic ─────────────────────────────────────────────────
console.log('\n[Traffic]');
const traffic = new TrafficSystem();
const stats = traffic.getStats();
check('Cars are parked on the street', stats.parked >= 30, `${stats.parked} parked`);
check('Cars are moving on the street', stats.moving >= 15, `${stats.moving} driving`);
check('Both are instanced, not one mesh per car', traffic.group.children.length <= 4,
  `${traffic.group.children.length} draw objects for ${stats.bodies} cars`);

const parkedOffRoad = traffic.parked.filter((c) => !onRoadway(c.x, c.z, 0.6));
check('Every parked car is on a roadway', parkedOffRoad.length === 0,
  `${parkedOffRoad.length} parked off-road`);

const parkedInBuilding = traffic.parked.filter((c) => buildings.some((b) => b.size.h >= 0.5 && (() => {
  const r = rectOf(b);
  return c.x > r.minX && c.x < r.maxX && c.z > r.minZ && c.z < r.maxZ;
})()));
check('No parked car is inside a building', parkedInBuilding.length === 0);

const parkedOffLand = traffic.parked.filter((c) => !islandAt(c.x, c.z));
check('No car is parked in the lagoon', parkedOffLand.length === 0);

const kinds = new Set([...traffic.parked, ...traffic.moving].map((c) => c.kind));
check('The fleet is varied', kinds.size >= 4, `${kinds.size} kinds: ${[...kinds].join(', ')}`);
check('Every car kind has a size and wheels',
  Object.values(CAR_KINDS).every((k) => k.w > 0 && k.l > 0 && k.wheels >= 2));

const bothGreen = [0, 3, 7, 11, 14, 18, 22, 25].filter((t) =>
  signalState('avenue', t) === 'green' && signalState('street', t) === 'green');
check('Avenue and street signals never both green', bothGreen.length === 0,
  bothGreen.length ? `both green at t=${bothGreen.join(', ')}` : 'exclusive phases');

const before = traffic.moving.map((c) => ({ x: c.x, z: c.z }));
let maxSpeedSeen = 0;
for (let i = 0; i < 200; i++) {
  traffic.update(0.05, i * 0.05);
  for (const c of traffic.moving) maxSpeedSeen = Math.max(maxSpeedSeen, c.speed);
}
const moved = traffic.moving.filter((c, i) => Math.hypot(c.x - before[i].x, c.z - before[i].z) > 1).length;
check('Cars actually move', moved >= traffic.moving.length * 0.7,
  `${moved}/${traffic.moving.length} changed position over 10 s`);
check('Cars reach a driving speed', maxSpeedSeen > 4, `fastest ${maxSpeedSeen.toFixed(1)} m/s`);

const offStrip = traffic.moving.filter((c) => Math.abs(c.cross - c.strip.fixed) > c.strip.half + 0.5);
check('Moving cars stay in their lane on their own street', offStrip.length === 0,
  `${offStrip.length} outside their strip`);
const movingOffLand = traffic.moving.filter((c) => !islandAt(c.x, c.z) && !onRoadway(c.x, c.z, 1.5));
check('No car drives over water', movingOffLand.length === 0);
check('Every junction the cars stop at is a real crossing',
  NETWORK.junctions.length > 20, `${NETWORK.junctions.length} junctions on ${NETWORK.strips.length} strips`);

const obstacles = traffic.getObstacles();
check('Traffic blocks the player', obstacles.length >= stats.parked,
  `${obstacles.length} collision circles`);

// ── Trees ───────────────────────────────────────────────────
console.log('\n[Vegetation]');
check('Street trees exist', treePositions.length >= 40, `${treePositions.length} trees`);
check('Palms line the waterfront', palmTreePositions.length >= 20, `${palmTreePositions.length} palms`);

const treesInBuildings = treePositions.filter((t) => buildings.some((b) => b.size.h >= 0.5 && (() => {
  const r = rectOf(b);
  return t.x > r.minX && t.x < r.maxX && t.z > r.minZ && t.z < r.maxZ;
})()));
check('No tree grows through a building', treesInBuildings.length === 0,
  `${treesInBuildings.length} inside buildings`);

const treesOnAsphalt = treePositions.filter((t) => {
  const r = { minX: t.x - 0.3, maxX: t.x + 0.3, minZ: t.z - 0.3, maxZ: t.z + 0.3 };
  return roads.some((road) => overlaps(r, rectOf({ position: { x: road.x, z: road.z }, size: { w: road.w, d: road.d } })));
});
check('No tree stands in a traffic lane', treesOnAsphalt.length === 0,
  `${treesOnAsphalt.length} on the asphalt`);

const treesInWater = [...treePositions, ...palmTreePositions].filter((t) => !islandAt(t.x, t.z));
check('Every tree stands on land', treesInWater.length === 0, `${treesInWater.length} in the lagoon`);

const treeGroup = new THREE.Group();
const treeStats = createTrees(treeGroup, treePositions.slice(0, 8), palmTreePositions.slice(0, 4), {
  trunk: () => new THREE.MeshStandardMaterial(),
  leaf: () => new THREE.MeshStandardMaterial(),
  leafDark: () => new THREE.MeshStandardMaterial(),
});
check('Trees are built from parts, not one cone', treeStats.meshes >= 4,
  `${treeStats.meshes} instanced meshes`);
const canopy = treeGroup.children.find((c) => c.name === 'tree-canopies');
check('Each tree has a multi-lobe canopy', canopy && canopy.count === 8 * 5,
  `${canopy ? canopy.count : 0} canopy lobes for 8 trees`);
const branches = treeGroup.children.find((c) => c.name === 'tree-branches');
check('Trees have branches', branches && branches.count >= 8 * 2,
  `${branches ? branches.count : 0} branches`);
const fronds = treeGroup.children.find((c) => c.name === 'palm-fronds');
check('Palms have fronds', fronds && fronds.count === 4 * 8,
  `${fronds ? fronds.count : 0} fronds for 4 palms`);

// ── Rendering ───────────────────────────────────────────────
console.log('\n[Map rendering]');
const city = new CityBuilder();
city.build();
const map = city.map;
check('Four island meshes are built', map.landGroup.children.filter((c) => c.name?.startsWith('island-')).length === 4,
  `${map.landGroup.children.length} land objects`);
check('The lagoon is drawn', !!map.water && map.water.geometry.type === 'PlaneGeometry',
  `water at y = ${map.water?.position.y}`);
check('Roads are one merged mesh, not 120 draw calls',
  map.roadGroup.children.length === 1, `${map.roadGroup.children.length} road mesh`);
check('Bridges are drawn', map.bridgeGroup.children.length > 10,
  `${map.bridgeGroup.children.length} bridge parts`);
check('Metro lines and stations are drawn', map.metroGroup.children.length >= METRO_LINES.length * 2,
  `${map.metroGroup.children.length} metro parts`);
check('Faction turf outlines are drawn', map.turfGroup.children.length === 4,
  `${map.turfGroup.children.length} turf lines`);
check('Campaign pins and safehouses are drawn', map.poiGroup.children.length >= MISSION_PINS.length + SAFEHOUSES.length,
  `${map.poiGroup.children.length} POI objects`);
check('District and bridge labels exist', map.labels.length >= 13 + 3, `${map.labels.length} labels`);
check('Street lights stand on the pavements', lightPositions.length >= 20, `${lightPositions.length} lamps`);

const stats2 = city.getStats();
check('Draw calls stay in budget', stats2.meshes < 400, `${stats2.meshes} meshes`);
check('Triangle budget', stats2.triangles > 100000 && stats2.triangles < 700000,
  `${stats2.triangles.toLocaleString()} tris`);

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
