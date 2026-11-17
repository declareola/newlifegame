// client/src/world/streetGrid.js
// The Manhattan-style street plan.
//
// The old city had exactly two 6 m roads crossing at the origin, with buildings
// scattered on grass either side. There was no room for anything else: a
// 16 m corridor fits only in the central cross, because 114 buildings are packed
// with 3–4 m gaps. So the plan is rebuilt properly here:
//
//   · wide avenues run north–south, narrower streets run east–west
//   · every block is a rectangle bounded by four sidewalks
//   · buildings front the sidewalks and leave a courtyard behind
//   · the fillable "Block 42" boxes are regenerated into those blocks
//
// Everything that the rest of the game depends on stays put: every named
// building keeps its id, and any fixed building that would end up standing in
// the roadway is nudged clear rather than deleted.
//
// This module is pure data + maths (no three.js), so it can be unit-tested.

// ── Dimensions ───────────────────────────────────────────────
export const CITY_HALF = 95;

/** North–south avenues: wide, with a parking lane either side. */
export const AVENUE = {
  pitch: 40,
  centres: [-60, -20, 20, 60],
  roadway: 12,      // asphalt width
  sidewalk: 3,      // pavement each side
  get corridor() { return this.roadway + this.sidewalk * 2; },  // 18
  get half() { return this.corridor / 2; },                     // 9
  get roadHalf() { return this.roadway / 2; },                  // 6
};

/** East–west streets: narrower, like a cross street in Midtown. */
export const STREET = {
  pitch: 40,
  centres: [-60, -20, 20, 60],
  roadway: 8,
  sidewalk: 3,
  get corridor() { return this.roadway + this.sidewalk * 2; },  // 14
  get half() { return this.corridor / 2; },                     // 7
  get roadHalf() { return this.roadway / 2; },                  // 4
};

/** Lane geometry, used by markings and by the traffic system. */
export const LANES = {
  kerbOffset: 1.4,   // distance from the roadway edge to a parked car's centre
  laneOffset: 2.8,   // distance from the centre line to a driving lane's centre
  markWidth: 0.16,
  dashLength: 2.4,
  dashGap: 3.2,
};

// ── Corridor tests ───────────────────────────────────────────

/** Is this x inside a north–south avenue corridor (for a given z)? */
export function inAvenue(x, z = 0, pad = 0) {
  if (Math.abs(z) > CITY_HALF) return false;
  return AVENUE.centres.some((c) => Math.abs(x - c) <= AVENUE.half + pad);
}

/** Is this z inside an east–west street corridor? */
export function inStreet(z, x = 0, pad = 0) {
  if (Math.abs(x) > CITY_HALF) return false;
  return STREET.centres.some((c) => Math.abs(z - c) <= STREET.half + pad);
}

/** Any roadway at all (avenue or street). */
export function onRoadway(x, z, pad = 0) {
  return inAvenue(x, z, pad) || inStreet(z, x, pad);
}

/** Inside an intersection box, where crosswalks and stop bars go. */
export function inIntersection(x, z, pad = 0) {
  return inAvenue(x, z, pad) && inStreet(z, x, pad);
}

// ── Blocks ───────────────────────────────────────────────────

/**
 * Every city block as a rectangle of buildable ground, between the corridors.
 * 5 × 5 blocks for the default plan.
 */
export function cityBlocks() {
  const edges = (centres, half) => {
    const out = [];
    let from = -CITY_HALF;
    for (const c of centres) {
      const start = c - half;
      if (start > from) out.push({ min: from, max: start });
      from = c + half;
    }
    if (from < CITY_HALF) out.push({ min: from, max: CITY_HALF });
    return out;
  };

  const xs = edges(AVENUE.centres, AVENUE.half);
  const zs = edges(STREET.centres, STREET.half);

  const blocks = [];
  xs.forEach((bx, ix) => {
    zs.forEach((bz, iz) => {
      blocks.push({
        id: `block-${ix}-${iz}`,
        minX: bx.min, maxX: bx.max,
        minZ: bz.min, maxZ: bz.max,
        width: bx.max - bx.min,
        depth: bz.max - bz.min,
        cx: (bx.min + bx.max) / 2,
        cz: (bz.min + bz.max) / 2,
      });
    });
  });
  return blocks;
}

/** The block containing a point, if any. */
export function blockAt(x, z, blocks = cityBlocks()) {
  return blocks.find((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) || null;
}

/** Which district a point falls in (reuses the 4 quadrant layout). */
export function districtAt(x, z) {
  if (x < 0 && z >= 0) return 'mushin';
  if (x >= 0 && z >= 0) return 'yaba';
  if (x < 0 && z < 0) return 'victoria';
  return 'lekki';
}

// ── Roads as drawable segments ───────────────────────────────

/**
 * Asphalt rectangles for every corridor, split so intersections are not
 * double-drawn (which would z-fight and waste fill rate).
 * @returns {Array<{x:number, z:number, w:number, d:number, kind:'avenue'|'street'}>}
 */
export function roadSurface() {
  const out = [];
  const span = CITY_HALF * 2;

  for (const c of AVENUE.centres) {
    out.push({ x: c, z: 0, w: AVENUE.roadway, d: span, kind: 'avenue', axis: 'z', centre: c });
  }
  for (const c of STREET.centres) {
    out.push({ x: 0, z: c, w: span, d: STREET.roadway, kind: 'street', axis: 'x', centre: c });
  }
  return out;
}

/**
 * Sidewalk strips: the pavement between the kerb and the block edge, for every
 * block face that touches a corridor.
 */
export function sidewalkStrips(blocks = cityBlocks()) {
  const out = [];
  const { sidewalk } = AVENUE;
  for (const b of blocks) {
    // North and south faces
    out.push({ x: b.cx, z: b.minZ - sidewalk / 2, w: b.width, d: sidewalk, side: 'n' });
    out.push({ x: b.cx, z: b.maxZ + sidewalk / 2, w: b.width, d: sidewalk, side: 's' });
    // East and west faces
    out.push({ x: b.minX - sidewalk / 2, z: b.cz, w: sidewalk, d: b.depth, side: 'w' });
    out.push({ x: b.maxX + sidewalk / 2, z: b.cz, w: sidewalk, d: b.depth, side: 'e' });
  }
  return out;
}

/** Crosswalk stripes around every intersection. */
export function crosswalks() {
  const out = [];
  const stripeW = 0.55;
  const stripeGap = 0.55;
  const depth = 2.6;          // how far the crossing extends into the junction

  for (const ax of AVENUE.centres) {
    for (const sz of STREET.centres) {
      // Two crossings per junction (north and south side) across the avenue,
      // plus two across the street. Parallel stripes, like a zebra.
      for (const side of [-1, 1]) {
        const zc = sz + side * (STREET.roadHalf + depth / 2);
        for (let x = ax - AVENUE.roadHalf + 0.6; x < ax + AVENUE.roadHalf - 0.6; x += stripeW + stripeGap) {
          out.push({ x, z: zc, w: stripeW, d: depth, rot: 0 });
        }
        const xc = ax + side * (AVENUE.roadHalf + depth / 2);
        for (let z = sz - STREET.roadHalf + 0.6; z < sz + STREET.roadHalf - 0.6; z += stripeW + stripeGap) {
          out.push({ x: xc, z, w: stripeW, d: depth, rot: Math.PI / 2 });
        }
      }
    }
  }
  return out;
}

/**
 * Dashed centre lines, broken at intersections so the paint does not run
 * through the crossing.
 * @returns {Array<{x:number,z:number,w:number,d:number}>}
 */
export function laneMarkings() {
  const out = [];
  const { markWidth, dashLength, dashGap } = LANES;
  const step = dashLength + dashGap;

  const gapsFor = (centres, half) => {
    const out2 = [];
    let from = -CITY_HALF;
    for (const c of centres) {
      if (c - half > from) out2.push([from, c - half]);
      from = c + half;
    }
    if (from < CITY_HALF) out2.push([from, CITY_HALF]);
    return out2;
  };

  // Avenues: dashes run along z, broken at each street
  for (const ax of AVENUE.centres) {
    for (const [z0, z1] of gapsFor(STREET.centres, STREET.half)) {
      for (let z = z0 + dashLength / 2; z < z1; z += step) {
        out.push({ x: ax, z, w: markWidth, d: dashLength });
      }
    }
  }
  // Streets: dashes run along x, broken at each avenue
  for (const sz of STREET.centres) {
    for (const [x0, x1] of gapsFor(AVENUE.centres, AVENUE.half)) {
      for (let x = x0 + dashLength / 2; x < x1; x += step) {
        out.push({ x, z: sz, w: dashLength, d: markWidth });
      }
    }
  }
  return out;
}

/** Stop bars: a solid line at each junction approach. */
export function stopBars() {
  const out = [];
  const barW = 0.45;
  const inset = 1.2;
  for (const ax of AVENUE.centres) {
    for (const sz of STREET.centres) {
      for (const side of [-1, 1]) {
        // Stop line across the avenue, for the street's traffic…
        out.push({
          x: ax + side * AVENUE.roadHalf * 0.5,
          z: sz + side * (STREET.roadHalf + inset),
          w: AVENUE.roadHalf - 0.4, d: barW,
        });
        // …and one across the street, for the avenue's traffic.
        out.push({
          x: ax + side * (AVENUE.roadHalf + inset),
          z: sz + side * STREET.roadHalf * 0.5,
          w: barW, d: STREET.roadHalf - 0.4,
        });
      }
    }
  }
  return out;
}

/**
 * Is this point on the asphalt itself (as opposed to the pavement beside it)?
 * `onRoadway` deliberately includes the pavements, because that is what a
 * vehicle or a building must stay off. Trees and street furniture need the
 * narrower question.
 */
export function onAsphalt(x, z, pad = 0) {
  const nearAvenue = AVENUE.centres.some((c) => Math.abs(x - c) <= AVENUE.roadHalf + pad);
  const nearStreet = STREET.centres.some((c) => Math.abs(z - c) <= STREET.roadHalf + pad);
  return nearAvenue || nearStreet;
}

/**
 * Traffic-light posts at junction corners. Returned as data so CityBuilder can
 * instance them and the traffic system can ignore them.
 */
export function trafficLights() {
  const out = [];
  for (const ax of AVENUE.centres) {
    for (const sz of STREET.centres) {
      for (const sx of [-1, 1]) {
        for (const sz2 of [-1, 1]) {
          out.push({
            x: ax + sx * (AVENUE.half - 1.2),
            z: sz + sz2 * (STREET.half - 1.2),
            rotY: Math.atan2(-sx, -sz2),
          });
        }
      }
    }
  }
  return out;
}

// ── Building placement ───────────────────────────────────────

const AABB = (b) => ({
  minX: b.position.x - b.size.w / 2,
  maxX: b.position.x + b.size.w / 2,
  minZ: b.position.z - b.size.d / 2,
  maxZ: b.position.z + b.size.d / 2,
});

/** Does this footprint overlap any of the given rectangles (with padding)? */
export function overlapsAny(rect, others, pad = 0) {
  return others.some((o) => (
    rect.maxX + pad > o.minX && rect.minX - pad < o.maxX &&
    rect.maxZ + pad > o.minZ && rect.minZ - pad < o.maxZ
  ));
}

/** Does a footprint sit on a roadway or sidewalk? */
export function footprintOnRoad(rect, pad = 0.6) {
  // Exact rectangle-versus-corridor overlap. The previous version sampled nine
  // points on the footprint, which misses any road that crosses an edge between
  // two samples — a 13 m wide dealership could sit with 4 m of itself in the
  // avenue and still pass. Intervals cannot miss.
  const overlapX = (minX, maxX, c) => maxX >= c - AVENUE.half - pad && minX <= c + AVENUE.half + pad;
  const overlapZ = (minZ, maxZ, c) => maxZ >= c - STREET.half - pad && minZ <= c + STREET.half + pad;

  for (const c of AVENUE.centres) {
    if (overlapX(rect.minX, rect.maxX, c) && rect.minZ <= CITY_HALF && rect.maxZ >= -CITY_HALF) return true;
  }
  for (const c of STREET.centres) {
    if (overlapZ(rect.minZ, rect.maxZ, c) && rect.minX <= CITY_HALF && rect.maxX >= -CITY_HALF) return true;
  }
  return false;
}

const fromBuilding = (b) => ({ ...AABB(b), id: b.id });

/** Public: building → footprint rectangle. */
export function toRect(building) {
  return { ...AABB(building), id: building.id };
}

/**
 * Nudge a fixed building off the roadway along whichever axis needs least
 * movement. Named buildings must not be deleted — their ids are referenced by
 * interiors, properties and server-side shop/ATM proximity checks — so they are
 * slid into the nearest free block instead.
 *
 * @param {object} building
 * @param {Array} avoid  other footprints to keep clear of
 * @returns {object} the (possibly moved) building
 */
/**
 * @param {object} building
 * @param {Array} [avoid] additional rectangles to stay clear of
 * @param {object} [opts]
 * @param {boolean} [opts.force] search even if the building is not on a road
 *   (used when a building covers an interaction anchor, which is just as bad)
 */
export function snapOffRoad(building, avoid = [], { force = false } = {}) {
  if (!force && !footprintOnRoad(AABB(building))) return building;

  // Spiral outwards through a square ring so diagonal moves are considered too.
  // A building tucked into the corner of two roads has to move along both axes
  // at once, so an axis-only search (the obvious first attempt) never resolves it.
  const accept = (rect) => {
    if (footprintOnRoad(rect)) return false;
    if (overlapsAny(rect, avoid, 1.2)) return false;
    return Math.abs(rect.minX) <= CITY_HALF && Math.abs(rect.maxX) <= CITY_HALF &&
           Math.abs(rect.minZ) <= CITY_HALF && Math.abs(rect.maxZ) <= CITY_HALF;
  };

  for (let radius = 1; radius <= 60; radius++) {
    const ring = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        ring.push([dx, dz]);
      }
    }
    // Prefer the shortest hop, then the most head-on axis move.
    ring.sort((a, b) => {
      const la = Math.hypot(...a), lb = Math.hypot(...b);
      if (la !== lb) return la - lb;
      return Math.abs(b[0]) - Math.abs(a[0]);
    });
    for (const [dx, dz] of ring) {
      const moved = {
        ...building,
        position: { x: building.position.x + dx, z: building.position.z + dz },
      };
      if (accept(AABB(moved))) return moved;
    }
  }
  return building;
}

/** Fill one ring of a block: four faces, one row deep each. */
function fillRing(faces, block, style, depth, rnd, taken, out, nextIndex) {
  for (const face of faces) {
    let cursor = face.from;
    while (cursor < face.to - 5) {
      const w = Math.min(face.to - cursor, 4.5 + rnd() * 3.5);
      if (w < 4.0) break;

      const centre = cursor + w / 2;
      const x = face.along === 'x' ? centre : face.fixed;
      const z = face.along === 'x' ? face.fixed : centre;
      const size = face.along === 'x'
        ? { w, d: depth, h: style.hMin + rnd() * (style.hMax - style.hMin) }
        : { w: depth, d: w, h: style.hMin + rnd() * (style.hMax - style.hMin) };

      const rect = {
        minX: x - size.w / 2, maxX: x + size.w / 2,
        minZ: z - size.d / 2, maxZ: z + size.d / 2,
      };

      const idx = nextIndex();
      if (!footprintOnRoad(rect) && !overlapsAny(rect, taken, 0.8)) {
        out.push({
          id: `${block.id}-b${idx}`,
          name: `${style.district} ${block.id.replace('block-', '')}-${idx + 1}`,
          district: style.district,
          position: { x, z },
          size,
          colour: style.colour,
          enterable: false,
          filler: true,
        });
        taken.push(rect);
      }
      cursor += w + style.gap;
    }
  }
}

/**
 * Fill the blocks with buildings, fronting the sidewalks.
 *
 * Each block is filled in concentric rings: the outer ring faces the street,
 * inner rings form the courtyard mass behind it. Everything is deterministic
 * (seeded PRNG) so the city looks identical on every load and tests can rely
 * on it.
 *
 * @param {object} o
 * @param {Array} o.blocks    rectangles from cityBlocks()
 * @param {Array} o.occupied  buildings/rects that must stay clear
 * @param {function} o.styleFor (x, z) => { hMin, hMax, depth, colour, district, sidewalkInset, gap }
 * @param {number} [o.seed]
 * @returns {Array} buildings
 */
export function fillBlocks({ blocks, occupied, styleFor, seed = 1 }) {
  const out = [];
  const taken = occupied.map((b) => (b.position ? fromBuilding(b) : b));

  // Small deterministic PRNG so placement is stable across reloads.
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };

  for (const block of blocks) {
    const style = styleFor(block.cx, block.cz);
    const depth = style.depth;

    const innerW = block.width - style.sidewalkInset * 2;
    const innerD = block.depth - style.sidewalkInset * 2;
    if (innerW < 6 || innerD < 6) continue;

    let index = 0;
    const nextIndex = () => index++;

    for (let inset = style.sidewalkInset; inset < Math.min(innerW, innerD) / 2 - 4; inset += depth + 2.5) {
      const faces = [
        // north face: buildings run along x, footprint depth along z
        { axis: 'x', fixed: block.minZ + inset + depth / 2, from: block.minX + inset, to: block.maxX - inset, along: 'x' },
        { axis: 'x', fixed: block.maxZ - inset - depth / 2, from: block.minX + inset, to: block.maxX - inset, along: 'x' },
        { axis: 'z', fixed: block.minX + inset + depth / 2, from: block.minZ + inset, to: block.maxZ - inset, along: 'z' },
        { axis: 'z', fixed: block.maxX - inset - depth / 2, from: block.minZ + inset, to: block.maxZ - inset, along: 'z' },
      ];
      fillRing(faces, block, style, depth, rnd, taken, out, nextIndex);
    }
  }

  return out;
}
