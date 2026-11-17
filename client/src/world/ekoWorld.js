// client/src/world/ekoWorld.js
// Generates the Eko Basin city as DATA: districts, streets, buildings and
// collision boxes. No three.js in here — this module is what cityData.js
// re-exports, and it is consumed by the renderer, the minimap, the interiors,
// the NPC system and the server's proximity checks alike.
//
// Every building id the rest of the game already references (bank, market,
// hospital, airport, the five rentable properties, ...) is preserved and
// hand-placed inside the appropriate Eko Basin district. The procedural filler
// around them is new.

import {
  ISLANDS, DISTRICTS, BRIDGES, SCALE, toWorld, islandPolygon, islandAt, districtAt,
} from './ekoBasin.js';

// ── Deterministic RNG ────────────────────────────────────────
// The city must be identical on every load: interiors are keyed to building
// ids, and the server stores positions. Math.random() here would move the city
// out from under a saved game.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── Districts ────────────────────────────────────────────────
// The blueprint's districts, plus the four ids the game already ships with
// (mushin, yaba, victoria, lekki) so property listings, job spawns and the
// district labels keep resolving.
const EXTRA_DISTRICTS = [
  { id: 'yaba', name: 'Yaba', island: 'mainland', pixels: [1210, 470], radius: 10, kind: 'residential' },
  { id: 'lekki', name: 'Lekki', island: 'mainland', pixels: [1240, 500], radius: 9, kind: 'residential' },
];

/** Hex colour per district kind, used for the ground wash on the minimap. */
const KIND_COLOUR = {
  financial: 0x4a5d86,
  skyscraper: 0x3d4f73,
  residential: 0x8a7258,
  transit: 0x6b7280,
  market: 0xc9a06a,
  port: 0x59606b,
  industrial: 0x4a4f58,
};

export const districts = [...DISTRICTS, ...EXTRA_DISTRICTS].map((d) => {
  const p = toWorld(d.pixels[0], d.pixels[1]);
  const r = d.radius;
  // Some district labels on the reference map sit just off the shoreline (Mile
  // 12 is the worst offender). A district centre in open water puts its map
  // label and its route target in the lagoon, so it is pulled onto the island
  // it belongs to.
  let cx = p.x;
  let cz = p.z;
  if (!islandAt(cx, cz)) {
    const island = ISLANDS.find((i) => i.id === d.island);
    if (island) {
      const poly = islandPolygon(island);
      let best = { d: Infinity, x: cx, z: cz };
      for (const pt of poly) {
        const dsq = (pt.x - p.x) ** 2 + (pt.z - p.z) ** 2;
        if (dsq < best.d) best = { d: dsq, x: pt.x, z: pt.z };
      }
      // Step a little inland from that vertex so the point is not on the edge.
      const inX = (best.x + poly.reduce((a, q) => a + q.x, 0) / poly.length) / 2;
      const inZ = (best.z + poly.reduce((a, q) => a + q.z, 0) / poly.length) / 2;
      cx = inX;
      cz = inZ;
    }
  }

  return {
    id: d.id,
    name: d.name,
    x: cx,
    z: cz,
    w: r * 2,
    d: r * 2,
    island: d.island,
    kind: d.kind,
    colour: KIND_COLOUR[d.kind] || 0x8a7258,
  };
});

function district(id) {
  return districts.find((d) => d.id === id);
}

// ── Key buildings ────────────────────────────────────────────
// Hand-placed, with the ids the rest of the game depends on. [px, py] is a
// reference-map pixel coordinate so each one sits in a district that makes
// sense for it (a bank in Marina, a container yard in Tin Can, and so on).
const KEY_PLACEMENTS = [
  // ── Vertical Core: finance, services, homes ──
  { id: 'bank', name: 'First Marina Bank', district: 'marina', px: [462, 556], size: [16, 10, 22], colour: 0xecf0f1, signColour: 0xf1c40f, enterable: true },
  { id: 'atm', name: 'Marina ATM', district: 'marina', px: [478, 548], size: [2.4, 2.4, 3], colour: 0xbdc3c7, signColour: 0x2ecc71, enterable: true },
  { id: 'atm-kiosk', name: 'ATM Kiosk', district: 'victoria-island', px: [392, 512], size: [3.4, 3.4, 3.2], colour: 0x95a5a6, signColour: 0x2ecc71, enterable: true },
  { id: 'office-tower', name: 'Customs Street Tower', district: 'marina', px: [450, 570], size: [18, 18, 54], colour: 0x3d4f73, signColour: 0x3498db, enterable: true },
  { id: 'tech-hub', name: 'Yaba Tech Hub', district: 'victoria-island', px: [372, 534], size: [14, 10, 28], colour: 0x3498db, signColour: 0x00ff00, enterable: true },
  { id: 'restaurant', name: 'The Third Bridge Canteen', district: 'surulere', px: [952, 540], size: [10, 8, 6], colour: 0xd9a021, signColour: 0xe67e22, enterable: true },
  { id: 'food-court', name: 'Marina Food Court', district: 'victoria-island', px: [400, 528], size: [12, 9, 7], colour: 0xe8b06a, signColour: 0xf39c12, enterable: true },
  { id: 'gym', name: 'Ikoyi Fitness', district: 'victoria-island', px: [418, 546], size: [13, 11, 9], colour: 0x7f8c8d, signColour: 0xe74c3c, enterable: true },
  { id: 'hospital', name: 'Marina General Hospital', district: 'marina', px: [440, 586], size: [20, 16, 20], colour: 0xecf0f1, signColour: 0xe74c3c, enterable: true },
  { id: 'clinic', name: 'Ikoyi Clinic', district: 'victoria-island', px: [356, 552], size: [10, 8, 7], colour: 0xf5f5f5, signColour: 0x1abc9c, enterable: true },
  { id: 'school', name: 'Marina Grammar School', district: 'marina', px: [426, 604], size: [16, 12, 10], colour: 0xd6b48a, signColour: 0x2980b9, enterable: true },
  { id: 'church', name: "St. Dominic's, Marina", district: 'marina', px: [498, 590], size: [12, 16, 14], colour: 0xe8dcc8, signColour: 0x8e44ad, enterable: true },
  { id: 'mosque', name: 'Lagos Central Mosque', district: 'victoria-island', px: [344, 528], size: [14, 12, 16], colour: 0xeae0d0, signColour: 0x16a085, enterable: true },
  { id: 'supermarket', name: 'Surulere Supermarket', district: 'surulere', px: [1006, 512], size: [18, 14, 8], colour: 0x2ecc71, signColour: 0x27ae60, enterable: true },
  { id: 'dealership', name: 'VI Motors', district: 'victoria-island', px: [408, 500], size: [20, 14, 8], colour: 0x34495e, signColour: 0xe67e22, enterable: true },

  // ── Outer Borough: the Mainland ──
  { id: 'market', name: 'Oshodi Market Hall', district: 'oshodi', px: [1244, 396], size: [22, 18, 8], colour: 0xc9a06a, signColour: 0xe67e22, enterable: true },
  { id: 'pure-water', name: 'Pure Water Depot', district: 'mushin', px: [1128, 292], size: [8, 8, 6], colour: 0x3498db, signColour: 0x2980b9, enterable: true },
  { id: 'pure-water-stand', name: 'Pure Water Stand', district: 'surulere', px: [1014, 536], size: [4, 4, 3], colour: 0x5dade2, signColour: 0x2980b9, enterable: true },
  { id: 'fuel-station', name: 'Mushin Filling Station', district: 'mushin', px: [1146, 272], size: [16, 12, 6], colour: 0xf1c40f, signColour: 0xf39c12, enterable: true },
  { id: 'garage', name: 'Mushin Motor Works', district: 'mushin', px: [1110, 264], size: [14, 11, 7], colour: 0x7f8c8d, signColour: 0x95a5a6, enterable: true },
  { id: 'police', name: 'Mushin Police Division', district: 'mushin', px: [1158, 300], size: [15, 12, 12], colour: 0x2c3e50, signColour: 0x3498db, enterable: true },
  { id: 'community-center', name: 'Mushin Community Hall', district: 'mushin', px: [1096, 300], size: [14, 11, 7], colour: 0xc0a080, signColour: 0x8e44ad, enterable: true },
  { id: 'bus-park', name: 'Oshodi Motor Park', district: 'oshodi', px: [1262, 414], size: [18, 18, 0.1], colour: 0x7f8c8d, signColour: 0xf39c12, enterable: true },
  { id: 'public-bathroom', name: 'Public Bathroom', district: 'mushin', px: [1170, 286], size: [5, 4, 3], colour: 0x95a5a6, signColour: 0x1abc9c, enterable: true },
  { id: 'kiosk-trader', name: 'Provision Kiosk', district: 'computer-village', px: [1168, 566], size: [3.5, 3, 3], colour: 0xf39c12, signColour: 0xe67e22, enterable: true },
  { id: 'kiosk-construction', name: 'Building Site Kiosk', district: 'surulere', px: [988, 530], size: [3.5, 3, 3], colour: 0xe67e22, signColour: 0xd35400, enterable: true },
  { id: 'airport', name: 'Murtala Muhammed Airport', district: 'mile-12', px: [1120, 654], size: [46, 30, 12], colour: 0xe8eef2, signColour: 0x2ecc71, enterable: true },

  // ── Industrial North: the Docks ──
  { id: 'sport', name: 'Docks Yard', district: 'tin-can', px: [890, 130], size: [30, 24, 8], colour: 0x59606b, signColour: 0x7f8c8d, enterable: false },
];

// Rentable homes. The ids here are the ones the server's propertyConfig sells.
const HOME_PLACEMENTS = [
  { id: 'prop-hostel-bed', name: 'Mushin Hostel Block', district: 'mushin', px: [1150, 520], size: [16, 14, 12], colour: 0x8a7258 },
  { id: 'prop-yaba-studio', name: 'Yaba Studio', district: 'yaba', px: [1208, 466], size: [12, 10, 9], colour: 0x9c8466 },
  { id: 'prop-vi-apartment', name: 'Victoria Island Apartment', district: 'victoria-island', px: [370, 512], size: [16, 14, 32], colour: 0x3d4f73 },
  { id: 'prop-lekki-duplex', name: 'Lekki Duplex', district: 'lekki', px: [1238, 502], size: [16, 13, 11], colour: 0xa88f72 },
  { id: 'prop-waterfront-mansion', name: 'Banana Island Waterfront Mansion', island: 'banana', px: [232, 366], size: [22, 16, 10], colour: 0xdfe6ee },
];

function placeKeyBuilding(spec) {
  const p = toWorld(spec.px[0], spec.px[1]);
  return {
    id: spec.id,
    name: spec.name,
    district: spec.district || 'marina',
    position: { x: p.x, z: p.z },
    size: { w: spec.size[0], d: spec.size[1], h: spec.size[2] },
    colour: spec.colour,
    signColour: spec.signColour || 0xffffff,
    enterable: !!spec.enterable,
    key: true,
  };
}

/**
 * Hand-placed landmarks, de-overlapped.
 *
 * The reference map puts some of these a few metres apart, which is fine on a
 * poster and not fine when the bank's wall is inside the office tower next door.
 * Each landmark keeps the map's position unless it clashes; a clash is resolved
 * by the shortest nudge that clears what was placed before it. Roads are laid
 * out *after* this (see the roads section) and route around these footprints, so
 * a landmark never has to move off its own district to get out of the traffic.
 */
function pushOffBuildings(b, placed) {
  for (let i = 0; i < 40; i++) {
    const clash = placed.find((p) => overlapAmount(p, b, 1.2));
    if (!clash) return true;
    const move = overlapAmount(clash, b, 1.4);
    if (move.dx < move.dz) {
      b.position.x += (b.position.x >= clash.position.x ? 1 : -1) * (move.dx + 0.3);
    } else {
      b.position.z += (b.position.z >= clash.position.z ? 1 : -1) * (move.dz + 0.3);
    }
  }
  return !placed.some((p) => overlapAmount(p, b, 1.2));
}

function placeWithoutOverlap(placements) {
  const placed = [];
  const log = [];
  for (const spec of placements) {
    const building = placeKeyBuilding(spec);
    if (!pushOffBuildings(building, placed)) {
      log.push(`${spec.id}: could not be cleared of its neighbours`);
    }
    if (!islandAt(building.position.x, building.position.z)) {
      log.push(`${spec.id}: nudge left its island`);
    }
    placed.push(building);
  }
  return { placed, log };
}

const keyLayout = (() => {
  const homes = HOME_PLACEMENTS.map((h) => ({ ...h, signColour: 0x2ecc71, enterable: true }));
  return placeWithoutOverlap([...KEY_PLACEMENTS, ...homes]);
})();

export const PLACEMENT_WARNINGS = keyLayout.log;
export const keyBuildings = keyLayout.placed.slice(0, KEY_PLACEMENTS.length);
export const propertyBuildings = keyLayout.placed.slice(KEY_PLACEMENTS.length).map((b) => ({
  ...b,
  propertyId: b.id.replace(/^prop-/, ''),
  residential: true,
}));

/** Axis-aligned footprint box. */
function footprintBox(x, z, w, d) {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

// ── Roads ────────────────────────────────────────────────────
// A grid of strips clipped to each island: an avenue every 46 m, a side street
// every 23 m. The strips are then cut around the landmark footprints placed
// below, so a street never runs through the bank.
//
// Order matters: the landmarks are defined as data first (KEY_PLACEMENTS), laid
// out, and only then do the roads get generated around them. That is why the
// placement code appears above this comment.

function islandRoadSegments(island) {
  const poly = islandPolygon(island);
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }

  const strips = [];
  const AVENUE_EVERY = 46;
  const STREET_EVERY = 23;

  /** How much of this island a horizontal line at z covers. */
  const spanAt = (z) => {
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if ((a.z <= z && b.z >= z) || (b.z <= z && a.z >= z)) {
        if (Math.abs(b.z - a.z) < 1e-6) { lo = Math.min(lo, a.x, b.x); hi = Math.max(hi, a.x, b.x); continue; }
        const t = (z - a.z) / (b.z - a.z);
        const x = a.x + (b.x - a.x) * t;
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
    }
    return lo < hi ? [lo, hi] : null;
  };

  /** The same for a vertical line at x. */
  const spanAtX = (x) => {
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if ((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x)) {
        if (Math.abs(b.x - a.x) < 1e-6) { lo = Math.min(lo, a.z, b.z); hi = Math.max(hi, a.z, b.z); continue; }
        const t = (x - a.x) / (b.x - a.x);
        const z = a.z + (b.z - a.z) * t;
        lo = Math.min(lo, z); hi = Math.max(hi, z);
      }
    }
    return lo < hi ? [lo, hi] : null;
  };

  /**
   * Pull a strip's ends in until both land, one metre at a time.
   * The polygon crossing that produced the spans is accurate to the vertex
   * spacing; this is what guarantees the "a road never ends in the lagoon" rule
   * instead of hoping a fixed 7 m trim is enough on every shoreline.
   */
  const clipToLand = (start, end, axis, fixed) => {
    let a = start;
    let b = end;
    const onLand = (v) => !!islandAt(axis === 'z' ? fixed : v, axis === 'z' ? v : fixed);
    while (b - a > 12 && !onLand(a)) a += 1;
    while (b - a > 12 && !onLand(b)) b -= 1;
    return [a, b];
  };

  // Vertical strips (traffic runs north–south).
  for (let x = minX; x <= maxX; x += STREET_EVERY) {
    const run = spanAtX(x);
    if (!run) continue;
    const isAvenue = Math.round((x - minX) / STREET_EVERY) % 2 === 0;
    const laneW = isAvenue ? 7.5 : 3.4;
    // Trim 7 m off each end so the strip ends on the shore rather than in the
    // sea. The polygon crossing is only accurate to the vertex spacing, and a
    // road that ends 2 m out over the lagoon looks like a pier.
    const [z0, z1] = clipToLand(run[0] + 7, run[1] - 7, 'z', x);
    if (z1 - z0 < 12) continue;
    strips.push({ x, z: (z0 + z1) / 2, w: laneW, d: z1 - z0, rotY: 0, avenue: isAvenue, vertical: true });
  }

  // Horizontal strips.
  for (let z = minZ; z <= maxZ; z += STREET_EVERY) {
    const run = spanAt(z);
    if (!run) continue;
    const isAvenue = Math.round((z - minZ) / STREET_EVERY) % 2 === 0;
    const laneW = isAvenue ? 7.5 : 3.4;
    const [x0, x1] = clipToLand(run[0] + 7, run[1] - 7, 'x', z);
    if (x1 - x0 < 12) continue;
    strips.push({ x: (x0 + x1) / 2, z, w: x1 - x0, d: laneW, rotY: 0, avenue: isAvenue, vertical: false });
  }

  return strips;
}

/**
 * Cut a road strip into the pieces that are not covered by a landmark.
 * A 7.5 m avenue through the hospital becomes two streets, one either side.
 */
function cutAround(strips, landmarks) {
  const out = [];
  const PAD = 2.0;
  for (const strip of strips) {
    let pieces = [{ from: strip.vertical ? strip.z - strip.d / 2 : strip.x - strip.w / 2,
      to: strip.vertical ? strip.z + strip.d / 2 : strip.x + strip.w / 2 }];

    for (const lm of landmarks) {
      if (lm.size.h < 0.5) continue;
      const box = {
        minX: lm.position.x - lm.size.w / 2 - PAD, maxX: lm.position.x + lm.size.w / 2 + PAD,
        minZ: lm.position.z - lm.size.d / 2 - PAD, maxZ: lm.position.z + lm.size.d / 2 + PAD,
      };
      const stripBox = strip.vertical
        ? { minX: strip.x - strip.w / 2, maxX: strip.x + strip.w / 2, minZ: -1e9, maxZ: 1e9 }
        : { minX: -1e9, maxX: 1e9, minZ: strip.z - strip.d / 2, maxZ: strip.z + strip.d / 2 };
      const overlaps = stripBox.minX < box.maxX && stripBox.maxX > box.minX
        && stripBox.minZ < box.maxZ && stripBox.maxZ > box.minZ;
      if (!overlaps) continue;

      const cutFrom = strip.vertical ? box.minZ : box.minX;
      const cutTo = strip.vertical ? box.maxZ : box.maxX;
      const next = [];
      for (const p of pieces) {
        if (cutTo <= p.from || cutFrom >= p.to) { next.push(p); continue; }
        if (cutFrom > p.from) next.push({ from: p.from, to: cutFrom });
        if (cutTo < p.to) next.push({ from: cutTo, to: p.to });
      }
      pieces = next;
      if (!pieces.length) break;
    }

    for (const p of pieces) {
      if (p.to - p.from < 6) continue;
      out.push(strip.vertical
        ? { ...strip, z: (p.from + p.to) / 2, d: p.to - p.from }
        : { ...strip, x: (p.from + p.to) / 2, w: p.to - p.from });
    }
  }
  return out;
}

export const roads = cutAround(
  ISLANDS.flatMap((island) => islandRoadSegments(island).map((r) => ({ ...r, island: island.id }))),
  [...keyBuildings, ...propertyBuildings],
);

/**
 * Road centre lines, for the 2D maps.
 *
 * The 3D renderer and the traffic want rectangles (width matters); the minimap
 * and the full map screen want a line to stroke. Deriving one from the other
 * here means the map cannot draw a street the cars do not drive down.
 */
export const roadLines = roads.map((r) => {
  const vertical = r.d >= r.w;
  return vertical
    ? { from: { x: r.x, z: r.z - r.d / 2 }, to: { x: r.x, z: r.z + r.d / 2 }, width: r.w, avenue: r.avenue }
    : { from: { x: r.x - r.w / 2, z: r.z }, to: { x: r.x + r.w / 2, z: r.z }, width: r.d, avenue: r.avenue };
});

/** Road rectangles for the renderer. */
export function roadSurface() {
  return roads.map((r) => ({ x: r.x, z: r.z, w: r.w, d: r.d, rotY: r.rotY, avenue: r.avenue }));
}

/** Is a world point on a road? Used for door placement and spawn safety. */
export function onRoadway(x, z, pad = 0) {
  for (const r of roads) {
    if (Math.abs(x - r.x) <= r.w / 2 + pad && Math.abs(z - r.z) <= r.d / 2 + pad) return true;
  }
  return false;
}

/**
 * Is a whole footprint clear of the roadway?
 * The point test above is not enough for a building — a 12 m block whose centre
 * is 2 m off a kerb is still standing in the traffic.
 */
export function footprintOnRoad(x, z, w, d, pad = 0) {
  const a = footprintBox(x, z, w, d);
  for (const r of roads) {
    const b = footprintBox(r.x, r.z, r.w + pad * 2, r.d + pad * 2);
    if (a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ) return true;
  }
  return false;
}

// ── Filler buildings ─────────────────────────────────────────
// The blocks between the landmarks. Placed on a jittered grid, skipping
// anything that lands on a road, a landmark, or the water.
const BUILDING_FOOTPRINTS = [...keyBuildings, ...propertyBuildings];

function overlapsExisting(x, z, w, d, pad = 2) {
  for (const b of BUILDING_FOOTPRINTS) {
    if (Math.abs(x - b.position.x) <= (b.size.w + w) / 2 + pad
      && Math.abs(z - b.position.z) <= (b.size.d + d) / 2 + pad) return true;
  }
  return false;
}

// ── Road clearance ───────────────────────────────────────────
// A building may not straddle a road. Testing only the centre point is not
// enough — a 12 m block centred 2 m off a kerb still stands in the traffic —
// so the footprint is measured against every strip and shrunk to fit the slab
// of land between them.

function roadClearance(x, z) {
  let halfX = Infinity;
  let halfZ = Infinity;
  let pushX = 1;
  let pushZ = 1;
  for (const r of roads) {
    const vertical = r.d >= r.w;
    if (vertical) {
      if (Math.abs(z - r.z) <= r.d / 2 + 8) {
        const gap = Math.abs(x - r.x) - r.w / 2;
        if (gap < halfX) { halfX = gap; pushX = x >= r.x ? 1 : -1; }
      }
    } else if (Math.abs(x - r.x) <= r.w / 2 + 8) {
      const gap = Math.abs(z - r.z) - r.d / 2;
      if (gap < halfZ) { halfZ = gap; pushZ = z >= r.z ? 1 : -1; }
    }
  }
  return { halfX: Math.max(0, halfX), halfZ: Math.max(0, halfZ), pushX, pushZ };
}

/** Is the whole footprint on this island? Four corners and the centre. */
function footprintOnIsland(island, x, z, w, d) {
  const pts = [[0, 0], [-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]];
  for (const [ox, oz] of pts) {
    const a = islandAt(x + ox, z + oz);
    if (!a || a.id !== island.id) return false;
  }
  return true;
}

/** Overlap of two axis-aligned footprints, in metres. */
function overlapAmount(a, b, pad = 0) {
  const dx = (a.size.w + b.size.w) / 2 + pad - Math.abs(a.position.x - b.position.x);
  const dz = (a.size.d + b.size.d) / 2 + pad - Math.abs(a.position.z - b.position.z);
  return dx > 0 && dz > 0 ? { dx, dz } : null;
}

/** Palette + height profile per island, from the blueprint's district notes. */
const ISLAND_PROFILE = {
  core: {
    // Skyscrapers get taller toward the middle (blueprint C1).
    palette: [0x3d4f73, 0x4a5d86, 0x34445f, 0x56688f, 0x2f3e5c],
    step: 11,
    height: (t, rng) => 14 + t * 62 * (0.45 + rng() * 0.9),
    wide: [12, 12],
  },
  mainland: {
    palette: [0x6b5b4b, 0x7a6552, 0x5d4f43, 0x836c58, 0x8a7258],
    step: 9.5,
    height: (_t, rng) => 4 + rng() * rng() * 12,
    wide: [10, 9],
  },
  docks: {
    palette: [0x59606b, 0x6a7078, 0x4a4f58, 0x7f8c8d],
    step: 11,
    height: (_t, rng) => 3 + rng() * 7,
    wide: [12, 9],
  },
  banana: {
    palette: [0x59606b, 0x6a7078, 0x4a4f58],
    step: 13,
    height: (_t, rng) => 3 + rng() * 5,
    wide: [11, 9],
  },
};

function fillIsland(island, rng) {
  const profile = ISLAND_PROFILE[island.id];
  const poly = islandPolygon(island);
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const cx = (minX + maxX) / 2; const cz = (minZ + maxZ) / 2;
  const maxR = Math.max(maxX - minX, maxZ - minZ) / 2 || 1;

  const out = [];
  const step = profile.step;
  for (let x = minX; x < maxX; x += step) {
    for (let z = minZ; z < maxZ; z += step) {
      const jx = x + (rng() - 0.5) * step * 0.25;
      const jz = z + (rng() - 0.5) * step * 0.25;
      if (!islandAt(jx, jz)) continue;
      if (islandAt(jx, jz).id !== island.id) continue;

      // Shrink the block to the land between the roads. 1.4 m of that gap is
      // pavement, which is what makes the street read as a street.
      const room = roadClearance(jx, jz);
      const w = Math.min(profile.wide[0], room.halfX * 2 - 2.8) * (0.8 + rng() * 0.18);
      const d = Math.min(profile.wide[1], room.halfZ * 2 - 2.8) * (0.8 + rng() * 0.18);
      if (w < 4.5 || d < 4.5) continue;
      if (!footprintOnIsland(island, jx, jz, w, d)) continue;
      if (overlapsExisting(jx, jz, w, d)) continue;

      // Distance from the island centre drives the Core's skyline taper.
      const t = 1 - Math.min(1, Math.hypot(jx - cx, jz - cz) / maxR);
      const h = Math.max(3, profile.height(t, rng));
      const colour = profile.palette[Math.floor(rng() * profile.palette.length)];

      const b = {
        id: `${island.id}-block-${out.length}`,
        name: `${island.shortName} Block ${out.length + 1}`,
        district: districtAt(jx, jz)?.id || island.id,
        position: { x: jx, z: jz },
        size: { w, d, h },
        colour,
        enterable: false,
        island: island.id,
      };
      out.push(b);
      BUILDING_FOOTPRINTS.push(b);
    }
  }
  return out;
}

const filler = ISLANDS.flatMap((island) => fillIsland(island, makeRng(0xE40 + island.id.length * 977)));

export const buildings = [...keyBuildings, ...propertyBuildings, ...filler];

// ── Street furniture: trees, palms, lights ───────────────────
// Generated from the road strips so they line the kerbs instead of standing in
// the middle of a junction. Every position is checked against the island
// outline and the building footprints before it is kept.

/** How far from a building centre we insist on being, on top of its footprint. */
const KERB_CLEARANCE = 2.2;

function clearOfBuildings(x, z, pad = KERB_CLEARANCE) {
  for (const b of BUILDING_FOOTPRINTS) {
    if (b.size.h < 0.5) continue;
    if (Math.abs(x - b.position.x) < b.size.w / 2 + pad
      && Math.abs(z - b.position.z) < b.size.d / 2 + pad) return false;
  }
  return true;
}

/** Split a road strip into a run of positions down one kerb. */
function alongKerb(road, side, spacing) {
  const out = [];
  const x = road.x + side * (road.w / 2 + 0.9);
  const n = Math.max(1, Math.floor(road.d / spacing));
  for (let i = 1; i < n; i++) {
    const z = road.z - road.d / 2 + (road.d / n) * i;
    out.push({ x, z });
  }
  return out;
}

export const treePositions = (() => {
  const out = [];
  const rng = makeRng(0x7EE5);
  for (const road of roads) {
    if (road.d < 14) continue; // only long strips get a run of trees
    for (const side of [-1, 1]) {
      for (const p of alongKerb(road, side, 11)) {
        if (!islandAt(p.x, p.z)) continue;
        if (!clearOfBuildings(p.x, p.z)) continue;
        if (onRoadway(p.x, p.z, 0.6)) continue;
        out.push({ x: p.x, z: p.z, scale: 0.85 + rng() * 0.4 });
      }
    }
  }
  return out;
})();

/** Palms hug the coastline, which is where Lagos actually has them. */
export const palmTreePositions = (() => {
  const out = [];
  const rng = makeRng(0x9A1E);
  for (const island of ISLANDS) {
    const pts = islandPolygon(island);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const every = Math.max(1, Math.round(9 / Math.max(len, 0.001)));
      for (let k = 0; k < len; k += lengthStep(len, 9)) {
        const f = k / len;
        // Step inward from the coastline so the trunk stands on land.
        const cx = islandPolygon(island).reduce((s, p) => s + p.x, 0) / pts.length;
        const cz = islandPolygon(island).reduce((s, p) => s + p.z, 0) / pts.length;
        const px = a.x + (b.x - a.x) * f;
        const pz = a.z + (b.z - a.z) * f;
        const dl = Math.hypot(cx - px, cz - pz) || 1;
        const x = px + ((cx - px) / dl) * 3.4;
        const z = pz + ((cz - pz) / dl) * 3.4;
        if (!islandAt(x, z)) continue;
        if (!clearOfBuildings(x, z, 1.4)) continue;
        if (onRoadway(x, z, 0.4)) continue;
        out.push({ x, z, scale: 0.8 + rng() * 0.5 });
      }
      void every;
    }
  }
  return out;
})();

/** One lamp per avenue junction, on alternating kerbs. */
export const lightPositions = (() => {
  const out = [];
  let flip = 1;
  for (const road of roads) {
    if (!road.avenue) continue;
    for (const p of alongKerb(road, flip, 26)) {
      flip = -flip;
      if (!islandAt(p.x, p.z)) continue;
      if (!clearOfBuildings(p.x, p.z, 1.2)) continue;
      out.push({ x: p.x, z: p.z });
    }
  }
  return out;
})();

function lengthStep(len, target) {
  return Math.max(1, Math.round(len / Math.max(1, Math.floor(len / target))));
}

// ── Legacy building categories ───────────────────────────────
// The rest of the game reaches for these by name (job boards, activity menus,
// interior doors). They are views over `buildings`, not separate placements,
// so a building can never be in one list here and somewhere else on screen.
const byIds = (ids) => ids.map((id) => buildings.find((b) => b.id === id)).filter(Boolean);

export const jobKiosks = byIds(['kiosk-trader', 'kiosk-construction']);
export const activityBuildings = byIds(['gym', 'food-court', 'community-center', 'public-bathroom']);
export const interactionBuildings = byIds(['atm-kiosk', 'pure-water-stand']);
export const landmarkBuildings = byIds(['church', 'mosque', 'school', 'airport', 'supermarket']);
export const amenityBuildings = byIds(['public-bathroom', 'bus-park', 'fuel-station', 'garage']);

/**
 * Points the city must keep walkable: a standable spot at the door of each
 * counter the server validates (ATM, bank, market, food court, water stand).
 *
 * Each building's four faces are tried in turn and the first one that is on
 * land, off the road and clear of every other building is used — the same rule
 * the door registry applies, so a test, a map marker and the actual door can
 * never disagree about where the entrance is.
 */
function standableSpot(b) {
  const { w, d } = b.size;
  const { x, z } = b.position;
  const CL = 1.6;
  const faces = [
    { x, z: z + d / 2 + CL },
    { x, z: z - d / 2 - CL },
    { x: x + w / 2 + CL, z },
    { x: x - w / 2 - CL, z },
  ];
  const clear = (px, pz) => {
    if (!islandAt(px, pz)) return false;
    for (const other of buildings) {
      if (other === b || other.size.h < 0.5) continue;
      if (Math.abs(px - other.position.x) < other.size.w / 2 + 0.5
        && Math.abs(pz - other.position.z) < other.size.d / 2 + 0.5) return false;
    }
    return true;
  };
  for (const f of faces) if (clear(f.x, f.z)) return f;
  return faces[0];
}

export const INTERACTION_ANCHORS = byIds(['atm', 'bank', 'market', 'food-court', 'pure-water'])
  .map((b) => ({ id: b.id, ...standableSpot(b) }));

// ── Collision ────────────────────────────────────────────────
// The same AABB list the old city produced. Flat pads (a motor park, a plaza)
// carry no collision, exactly as before.
export function getCollisionBoxes() {
  const boxes = [];
  for (const b of buildings) {
    if (b.size.h < 0.5) continue;
    boxes.push({
      minX: b.position.x - b.size.w / 2,
      maxX: b.position.x + b.size.w / 2,
      minZ: b.position.z - b.size.d / 2,
      maxZ: b.position.z + b.size.d / 2,
      id: b.id,
    });
  }
  return boxes;
}

// ── Spawn ────────────────────────────────────────────────────
// The Canteen, on the Outer Borough, is where the story starts (chapter 1) and
// where Mama Eko works. Spawning on its doorstep means a new player begins the
// game where the blueprint says the game begins.
//
// The exact point is searched, not guessed: a spot within 12 m of the Canteen's
// door that is on its island, clear of every building and off the roadway. The
// old hand-picked offset put the player inside the neighbouring block once the
// buildings were re-laid-out, which is exactly the sort of thing that only shows
// up as "the game starts inside a wall".
const canteen = buildings.find((b) => b.id === 'restaurant');

function findSpawnNear(seedBuilding) {
  const island = islandAt(seedBuilding.position.x, seedBuilding.position.z);
  const baseX = seedBuilding.position.x;
  const baseZ = seedBuilding.position.z + seedBuilding.size.d / 2 + 2.5;
  const clear = (x, z) => {
    if (!islandAt(x, z)) return false;
    if (onRoadway(x, z, 0.4)) return false;
    for (const b of buildings) {
      if (b.size.h < 0.5) continue;
      if (Math.abs(x - b.position.x) < b.size.w / 2 + 0.8
        && Math.abs(z - b.position.z) < b.size.d / 2 + 0.8) return false;
    }
    return true;
  };
  for (let r = 0; r <= 12; r += 1) {
    const steps = Math.max(1, Math.round((2 * Math.PI * r) / 1.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = baseX + Math.cos(a) * r;
      const z = baseZ + Math.sin(a) * r;
      if (clear(x, z)) return { x, z, rotY: -Math.PI / 2, island: island?.id || null };
    }
  }
  return { x: baseX, z: baseZ, rotY: -Math.PI / 2, island: island?.id || null };
}

export const SPAWN = findSpawnNear(canteen);

/** The map's walkable extent, used by the nav grid and the map screen. */
export const WORLD_BOUNDS = (() => {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const island of ISLANDS) {
    for (const p of islandPolygon(island)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  }
  const MARGIN = 6;
  return {
    minX: Math.floor(minX - MARGIN), maxX: Math.ceil(maxX + MARGIN),
    minZ: Math.floor(minZ - MARGIN), maxZ: Math.ceil(maxZ + MARGIN),
  };
})();

// ── Summary ──────────────────────────────────────────────────
export const WORLD_STATS = {
  islands: ISLANDS.length,
  bridges: BRIDGES.length,
  districts: districts.length,
  roads: roads.length,
  keyBuildings: keyBuildings.length,
  homes: propertyBuildings.length,
  fillerBuildings: filler.length,
  totalBuildings: buildings.length,
  metres: { w: 1400 * SCALE, d: 700 * SCALE },
};
