// client/src/world/streets.js
// Secondary street generation.
//
// The original city only had two main roads, which left every district as a
// field of buildings on grass. This module finds the corridors that already
// exist *between* building blocks (by testing candidate lines against the real
// building footprints) and turns them into proper streets with pavements.
//
// Nothing is invented: a street is only created where a corridor of the
// required width is genuinely free of buildings, so the roads can never clip
// through a facade or block a doorway.

import { buildings } from './cityData.js';

/** Footprint test with padding. Returns true if (x, z) is inside a building. */
export function insideAnyBuilding(x, z, pad = 0) {
  for (const b of buildings) {
    if (b.size.h < 0.5) continue;
    if (
      Math.abs(x - b.position.x) <= b.size.w / 2 + pad &&
      Math.abs(z - b.position.z) <= b.size.d / 2 + pad
    ) return true;
  }
  return false;
}

/** Is a horizontal corridor (constant z) clear between x1 and x2? */
function corridorClearH(z, x1, x2, halfWidth) {
  for (const b of buildings) {
    if (b.size.h < 0.5) continue;
    const bz1 = b.position.z - b.size.d / 2;
    const bz2 = b.position.z + b.size.d / 2;
    if (z + halfWidth < bz1 || z - halfWidth > bz2) continue;
    const bx1 = b.position.x - b.size.w / 2;
    const bx2 = b.position.x + b.size.w / 2;
    if (bx2 < x1 || bx1 > x2) continue;
    return false;
  }
  return true;
}

function corridorClearV(x, z1, z2, halfWidth) {
  for (const b of buildings) {
    if (b.size.h < 0.5) continue;
    const bx1 = b.position.x - b.size.w / 2;
    const bx2 = b.position.x + b.size.w / 2;
    if (x + halfWidth < bx1 || x - halfWidth > bx2) continue;
    const bz1 = b.position.z - b.size.d / 2;
    const bz2 = b.position.z + b.size.d / 2;
    if (bz2 < z1 || bz1 > z2) continue;
    return false;
  }
  return true;
}

/**
 * Discover streets.
 * @returns {{ segments: Array, intersections: Array<{x,z}> }}
 */
export function discoverStreets() {
  const BOUND = 88;
  const ROAD_W = 4.2;
  const half = ROAD_W / 2;
  const segments = [];

  // Candidate lines every 4 units; keep the ones with a long clear run.
  for (let z = -84; z <= 84; z += 4) {
    if (Math.abs(z) < 5) continue; // main road already there
    if (corridorClearH(z, -BOUND, BOUND, half)) {
      segments.push({ id: `h${z}`, axis: 'x', at: z, from: -BOUND, to: BOUND, width: ROAD_W });
    }
  }
  for (let x = -84; x <= 84; x += 4) {
    if (Math.abs(x) < 5) continue;
    if (corridorClearV(x, -BOUND, BOUND, half)) {
      segments.push({ id: `v${x}`, axis: 'z', at: x, from: -BOUND, to: BOUND, width: ROAD_W });
    }
  }

  // Intersections between generated streets (and the two main roads at 0)
  const xs = [...segments.filter(s => s.axis === 'z').map(s => s.at), 0];
  const zs = [...segments.filter(s => s.axis === 'x').map(s => s.at), 0];
  const intersections = [];
  for (const x of xs) for (const z of zs) intersections.push({ x, z });

  return { segments, intersections };
}

/**
 * Distance from (x, z) to the nearest street centre line.
 * Used to bias pathfinding toward roads without forbidding off-road travel.
 */
export function distanceToStreet(x, z, segments) {
  let best = Infinity;
  for (const s of segments) {
    const d = s.axis === 'x'
      ? Math.abs(z - s.at)
      : Math.abs(x - s.at);
    if (d < best) best = d;
  }
  // The two main roads
  best = Math.min(best, Math.abs(x), Math.abs(z));
  return best;
}
