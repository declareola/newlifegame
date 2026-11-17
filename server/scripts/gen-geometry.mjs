// server/scripts/gen-geometry.mjs
// Generate the server's copy of the world geography from the client's map data.
//
// Why this exists: the server needs to know where districts are (district
// visits, faction turf, the wanted matrix, mission placement) but it must not
// import client code with a `three` dependency. The old hand-written table in
// worldRoutes.js was the pre-Eko-Basin 200 m grid — Mushin at (-55, 55) — so
// every district check on the new map silently matched nothing.
//
// This script reads client/src/world/ekoWorld.js (pure data, no three.js) and
// emits server/config/worldGeometry.js. `server/test-geometry.mjs` re-runs it
// and fails if the committed copy has drifted, so the two can never disagree
// silently.
//
//   node scripts/gen-geometry.mjs           write the file
//   node scripts/gen-geometry.mjs --check   exit 1 if it would change

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'config', 'worldGeometry.js');
const CLIENT_WORLD = join(HERE, '..', '..', 'client', 'src', 'world', 'ekoWorld.js');
const CLIENT_BASIN = join(HERE, '..', '..', 'client', 'src', 'world', 'ekoBasin.js');
const CLIENT_INTERIORS = join(HERE, '..', '..', 'client', 'src', 'world', 'interiorData.js');

const { districts, buildings, WORLD_BOUNDS, SPAWN, INTERACTION_ANCHORS } = await import(CLIENT_WORLD);
const basin = await import(CLIENT_BASIN);
const interiorData = await import(CLIENT_INTERIORS);

// One bit per district for the visited-bitmap. The four districts that already
// had bits (mushin/yaba/victoria/lekki) keep them, so existing save rows still
// mean what they meant.
const FIXED_BITS = { mushin: 1, yaba: 2, 'victoria-island': 4, lekki: 8 };
let nextBit = 16;

const rows = districts.map((d) => {
  const bit = FIXED_BITS[d.id] || (nextBit <<= 0, nextBit *= 2);
  return {
    id: d.id,
    name: d.name,
    x: round(d.x),
    z: round(d.z),
    w: round(d.w),
    d: round(d.d),
    island: d.island,
    faction: basin.factionForIsland(d.island),
    bit,
  };
});

function round(n) {
  return Math.round(n * 100) / 100;
}

const keyBuildings = buildings
  .filter((b) => b.key)
  .map((b) => ({
    id: b.id,
    district: b.district,
    x: round(b.position.x),
    z: round(b.position.z),
    w: round(b.size.w),
    d: round(b.size.d),
    h: round(b.size.h),
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

// The standable spot outside each counter the server validates. These are the
// coordinates the proximity checks use, and the client walks to the same ones —
// they are generated together precisely so they cannot drift apart.
const anchors = INTERACTION_ANCHORS.map((a) => ({
  id: a.id, x: round(a.x), z: round(a.z),
}));

// Interior id → the building it is inside. Indoors the player's coordinates are
// room-local (the dealership sits at 0, 2.4), so the district has to come from
// the building the room belongs to. Without this, every crime committed indoors
// read as "neutral ground" and could never raise a single star.
const interiorBuildings = Object.fromEntries(
  interiorData.namedInteriors
    .filter((i) => i.buildingId)
    .map((i) => [i.id, i.buildingId])
);

// Where the purchasable homes actually stand. The client builds a house for
// each property as `prop-<id>`; the server's property catalogue used to carry
// its own coordinates from the old 200 m city, so every home on the market had
// its front door in the lagoon. Taking the placement from the map makes that
// impossible.
const propertyPlacement = Object.fromEntries(
  buildings
    .filter((b) => b.id.startsWith('prop-'))
    .map((b) => [b.id.slice('prop-'.length), {
      buildingId: b.id,
      x: round(b.position.x),
      z: round(b.position.z),
      district: b.district || null,
    }])
);

const islands = basin.ISLANDS.map((i) => ({
  id: i.id,
  name: i.name,
  faction: basin.factionForIsland(i.id),
}));

const file = `// server/config/worldGeometry.js
// GENERATED FILE — do not edit by hand.
// Source: client/src/world/ekoWorld.js + client/src/world/ekoBasin.js
// Regenerate: node server/scripts/gen-geometry.mjs
//
// The server needs district and landmark positions for district visits, faction
// turf, the wanted matrix and mission placement. It cannot import the client's
// map modules directly (they pull in three.js), so this file is generated from
// them and checked for drift by server/test-geometry.mjs.

/** Regional districts, with the bitmap bit each one sets when visited. */
export const DISTRICTS = ${JSON.stringify(rows, null, 2)};

/** Landmarks the server validates proximity against. */
export const KEY_BUILDINGS = ${JSON.stringify(keyBuildings, null, 2)};

/** Standable points at each interactive counter (ATM, bank, market, ...). */
export const INTERACTION_ANCHORS = ${JSON.stringify(anchors, null, 2)};

/** Where each purchasable home stands, keyed by property id. */
export const PROPERTY_PLACEMENT = ${JSON.stringify(propertyPlacement, null, 2)};

/** Interior id → the id of the building it is inside ('in-market' → 'market'). */
export const INTERIOR_BUILDINGS = ${JSON.stringify(interiorBuildings, null, 2)};

/** The four landmasses and which faction holds each. */
export const ISLANDS = ${JSON.stringify(islands, null, 2)};

/** The map's walkable extent, in world metres. */
export const WORLD_BOUNDS = ${JSON.stringify(WORLD_BOUNDS, null, 2)};

/** Where a new character wakes up. */
export const SPAWN = ${JSON.stringify({ x: round(SPAWN.x), z: round(SPAWN.z) }, null, 2)};

/** The district a world point falls in, or null for open ground and water. */
export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.x - d.w / 2 && x <= d.x + d.w / 2 && z >= d.z - d.d / 2 && z <= d.z + d.d / 2) return d;
  }
  return null;
}

/** The standable interaction point with this id ('bank', 'market', ...), or null. */
export function anchorById(id) {
  return INTERACTION_ANCHORS.find((a) => a.id === id) || null;
}

/** The landmark with this id, or null. */
export function buildingById(id) {
  return KEY_BUILDINGS.find((b) => b.id === id) || null;
}

/**
 * The district a player is standing in, honouring interiors.
 *
 * Inside a building the coordinates are room-local, so the district is the
 * district of the building; outdoors it is a simple point test.
 *
 * @param {{x:number,z:number}} worldPos the player's reported position
 * @param {string|null} interiorId the interior the player claims to be inside
 */
export function districtForPlayer(worldPos, interiorId) {
  if (interiorId) {
    const buildingId = INTERIOR_BUILDINGS[interiorId];
    const building = buildingId ? buildingById(buildingId) : null;
    if (building?.district) {
      return DISTRICTS.find((d) => d.id === building.district) || null;
    }
    // An interior whose building has no landmark row cannot be placed.
    return null;
  }
  return districtAt(worldPos.x, worldPos.z);
}

/** The faction that owns the district containing this point, or null. */
export function factionAt(x, z) {
  return districtAt(x, z)?.faction || null;
}
`;

const check = process.argv.includes('--check');
if (check) {
  const existing = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (existing !== file) {
    console.error('worldGeometry.js is stale — run: node server/scripts/gen-geometry.mjs');
    process.exit(1);
  }
  console.log('worldGeometry.js is up to date.');
  process.exit(0);
}

writeFileSync(OUT, file);
console.log(`wrote ${OUT} — ${rows.length} districts, ${keyBuildings.length} landmarks, ${anchors.length} anchors, ${islands.length} islands, ${Object.keys(interiorBuildings).length} interiors, ${Object.keys(propertyPlacement).length} properties`);
