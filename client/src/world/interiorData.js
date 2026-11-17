// client/src/world/interiorData.js
// Which buildings you can walk into, and what is inside them.
//
// Named buildings get a hand-picked interior type. Each district also gets a
// residential block chosen at runtime from the generated city, so every
// neighbourhood has somewhere to go inside. Nothing here touches gameplay
// state — interiors are presentation only.

import { buildings, propertyBuildings, WORLD_BOUNDS } from './cityData.js';

/**
 * Hand-authored interiors for the named buildings.
 * door: offset from the building's front face centre, in metres.
 */
export const namedInteriors = [
  // ── The places the player asked to be furnished ──
  {
    id: 'in-market', name: 'Oshodi Market Hall', buildingId: 'market',
    type: 'market', width: 20, depth: 16, height: 4.2, floor: 'concrete',
  },
  {
    id: 'in-church', name: 'St. Dominic\u2019s Church', buildingId: 'church',
    type: 'church', width: 14, depth: 22, height: 6.4, floor: 'tile',
  },
  {
    id: 'in-mosque', name: 'Central Mosque', buildingId: 'mosque',
    type: 'mosque', width: 12, depth: 16, height: 5.0, floor: 'carpet',
  },
  {
    id: 'in-hospital', name: 'General Hospital', buildingId: 'hospital',
    type: 'hospital', width: 18, depth: 14, height: 3.6, floor: 'tile',
  },
  // The terminal: check-in, security, café, toilets and the departure gate.
  // Bigger than it was, because it now holds a whole landside→airside flow.
  {
    id: 'in-airport', name: 'Murtala Muhammed Airport', buildingId: 'airport',
    type: 'airport', width: 30, depth: 22, height: 5.4, floor: 'tile',
  },
  // Airside is its own scene (world/airfield.js). It has no street door: you
  // reach it through the terminal gate, which is why `doorless` is set.
  {
    id: 'in-airfield', name: 'MMIA Airside', buildingId: 'airport',
    type: 'airfield', custom: 'airfield', width: 150, depth: 300, height: 22,
    doorless: true, floor: 'concrete',
  },
  // A real supermarket, with aisles, tills and a cashier.
  {
    id: 'in-supermarket', name: 'Surulere Supermarket', buildingId: 'supermarket',
    type: 'supermarket', width: 20, depth: 15, height: 4.2, floor: 'tile',
  },
  {
    id: 'in-bank', name: 'First Commerce Bank', buildingId: 'bank',
    type: 'bank', width: 16, depth: 12.5, height: 3.8, floor: 'tile',
  },
  {
    id: 'in-school', name: 'Rivers Community School', buildingId: 'school',
    type: 'school', width: 16, depth: 12, height: 3.4, floor: 'wood',
  },

  // ── The rest of the city ──
  {
    id: 'in-tech-hub', name: 'Tech Hub', buildingId: 'tech-hub',
    type: 'office', width: 15, depth: 12, height: 3.4, floor: 'wood',
    palette: 'cool',
  },
  {
    id: 'in-police', name: 'Police Station', buildingId: 'police',
    type: 'police', width: 14, depth: 11, height: 3.2, floor: 'tile',
  },
  {
    id: 'in-clinic', name: 'Clinic', buildingId: 'clinic',
    type: 'clinic', width: 11, depth: 9, height: 3.1, floor: 'tile',
  },
  {
    id: 'in-pure-water', name: 'Pure Water Kiosk', buildingId: 'pure-water',
    type: 'kiosk', width: 6, depth: 5.5, height: 2.9, floor: 'tile',
  },
  {
    id: 'in-fuel', name: 'Fuel Station Shop', buildingId: 'fuel-station',
    type: 'kiosk', width: 9, depth: 7, height: 3.0, floor: 'concrete',
  },
  {
    id: 'in-dealership', name: 'Auto Dealership', buildingId: 'dealership',
    type: 'shop', width: 16, depth: 12, height: 4.4, floor: 'tile',
  },
  {
    id: 'in-garage', name: 'Mekanik Garage', buildingId: 'garage',
    type: 'garage', width: 11, depth: 9, height: 3.6, floor: 'concrete',
  },
  {
    id: 'in-restaurant', name: 'Suya Spot', buildingId: 'restaurant',
    type: 'restaurant', width: 10, depth: 9, height: 3.1, floor: 'tile',
  },
  {
    id: 'in-office-tower', name: 'Aso Office Plaza', buildingId: 'office-tower',
    type: 'office', width: 14, depth: 11, height: 3.4, floor: 'wood',
  },
  {
    id: 'in-gym', name: 'Fitness Centre', buildingId: 'gym',
    type: 'gym', width: 12, depth: 10, height: 4.2, floor: 'concrete',
  },
  {
    id: 'in-food-court', name: 'Food Court', buildingId: 'food-court',
    type: 'restaurant', width: 12, depth: 9, height: 3.2, floor: 'tile',
  },
  {
    id: 'in-community', name: 'Community Centre', buildingId: 'community-center',
    type: 'office', width: 13, depth: 10, height: 3.6, floor: 'wood',
  },
];

// ── Residential blocks, chosen from the generated city ──────────

// Six floor plans, cycled: two studios of different size, two one-beds, a
// two-bed and a bedsit. Two districts were landing on the same plan with the
// same rounded dimensions, which is how "every interior is distinct" failed.
const APARTMENT_TYPES = ['studio', 'onebed', 'twobed', 'studio', 'onebed', 'bedsit'];

/**
 * True for buildings that can host a home interior.
 * The generated blocks are small (5x5 up to 10x8), so the interior is sized
 * to a comfortable minimum rather than to the exact footprint — nobody
 * measures the outside against the inside, and a 5x5 room is unlivable.
 */
function isHomeCandidate(b) {
  return (
    b.size.h >= 5 && b.size.h <= 45 &&
    b.size.w >= 5 && b.size.d >= 5 &&
    !b.signColour
  );
}

/**
 * Pick one home per district: the building closest to the district centre.
 * Deterministic given cityData, so the door never moves between reloads.
 */
export function findHomeBuildings() {
  const byDistrict = new Map();

  for (const b of buildings) {
    if (!isHomeCandidate(b)) continue;
    const list = byDistrict.get(b.district) || [];
    list.push(b);
    byDistrict.set(b.district, list);
  }

  const homes = [];
  let n = 0;
  for (const [district, list] of byDistrict) {
    // Sort by distance from the city centre, then take the first that is not
    // right on top of a road.
    list.sort((a, b) => {
      const da = Math.hypot(a.position.x, a.position.z);
      const db = Math.hypot(b.position.x, b.position.z);
      return da - db;
    });
    const chosen = list[0];
    if (!chosen) continue;

    const type = APARTMENT_TYPES[n % APARTMENT_TYPES.length];
    // Size is nudged per district so no two apartments are the same room with
    // the same furniture pushed into the same corners.
    // Room sizes are on a 0.45 m quantum starting below the smallest listed
    // property (10 × 8): a district flat must never round to the same footprint
    // as one of the five homes on the housing market.
    const jitter = 0.4 + ((n * 7) % 5) * 0.45;
    homes.push({
      id: `in-home-${district}`,
      name: `${district[0].toUpperCase()}${district.slice(1)} Apartment`,
      buildingId: chosen.id,
      type,
      width: Math.max(9, Math.min(13, chosen.size.w)) + jitter,
      depth: Math.max(8, Math.min(11, chosen.size.d)) + ((n * 3) % 3) * 0.45,
      height: 3.0,
      floor: type === 'studio' ? 'wood' : 'wood',
      residential: true,
      district,
    });
    n++;
  }
  return homes;
}

/**
 * The five properties on the housing market, seen from the inside.
 *
 * Until now buying a home was a number in a panel: the building existed in the
 * city, but its door was decorative and there was nowhere to go. Each listing
 * now has a real interior, laid out as a home — and the door only opens for the
 * player who lives there (see InteriorSystem's property check), which is what
 * makes the Go Home button an actual journey rather than a teleport to a
 * coordinate.
 */
// Each listing gets its own floor plan: a bunk-sized studio in Mushin, a two-bed
// in Lekki, a wide waterfront living room. The dimensions differ on purpose —
// walking into your own flat should not feel like every other room in the city.
const PROPERTY_PLANS = {
  'hostel-bed':         { type: 'studio', width: 9,  depth: 8,  floor: 'tile' },
  'yaba-studio':        { type: 'studio', width: 10, depth: 8,  floor: 'wood' },
  'vi-apartment':       { type: 'onebed', width: 10, depth: 9,  floor: 'wood' },
  'lekki-duplex':       { type: 'twobed', width: 12, depth: 9,  floor: 'wood' },
  'waterfront-mansion': { type: 'home',   width: 13, depth: 10, floor: 'tile' },
};

export const propertyInteriors = propertyBuildings.map((b) => {
  const plan = PROPERTY_PLANS[b.propertyId] || { type: 'studio', width: 9, depth: 8, floor: 'wood' };
  return {
    id: `in-prop-${b.propertyId}`,
    name: b.name,
    buildingId: b.id,
    type: plan.type,
    width: plan.width,
    depth: plan.depth,
    height: 3.0,
    floor: plan.floor,
    residential: true,
    propertyId: b.propertyId,
  };
});
/** All interiors: named + the housing market + one residential block per district. */
export function allInteriors() {
  return [...namedInteriors, ...propertyInteriors, ...findHomeBuildings()];
}

/** Is (x, z) inside any building footprint, with a little clearance? */
function occupied(x, z, ignoreId, pad = 0.7) {
  for (const b of buildings) {
    if (b.id === ignoreId) continue;
    if (b.size.h < 0.5) continue;
    const hw = b.size.w / 2 + pad;
    const hd = b.size.d / 2 + pad;
    if (Math.abs(x - b.position.x) <= hw && Math.abs(z - b.position.z) <= hd) return true;
  }
  return false;
}

/**
 * Candidate door positions for a building, best first.
 *
 * Doors favour the face pointing at the nearest main road (the x = 0 or z = 0
 * corridor). In a dense block that spot can be occupied by a neighbouring
 * building or sealed inside a courtyard, so the search slides along the face
 * and then tries the other three faces.
 */
export function doorCandidates(building) {
  if (!building) return [];
  const { w, d } = building.size;
  const { x, z } = building.position;
  const clear = 1.4;

  const towardZ = z > 0 ? -1 : 1;
  const towardX = x > 0 ? -1 : 1;

  const faceZ = { axis: 'z', sign: towardZ, half: d / 2, span: w };
  const faceX = { axis: 'x', sign: towardX, half: w / 2, span: d };
  const backZ = { axis: 'z', sign: -towardZ, half: d / 2, span: w, rot: true };
  const backX = { axis: 'x', sign: -towardX, half: w / 2, span: d, rot: true };

  const faces = Math.abs(z) >= Math.abs(x)
    ? [faceZ, faceX, backZ, backX]
    : [faceX, faceZ, backX, backZ];

  const slides = [0, 1.5, -1.5, 3.0, -3.0, 4.5, -4.5, 6.0, -6.0];
  const out = [];

  for (const face of faces) {
    const maxSlide = Math.max(0, face.span / 2 - 0.6);
    for (const slide of slides) {
      if (Math.abs(slide) > maxSlide) continue;

      let cx;
      let cz;
      let rotY;
      if (face.axis === 'z') {
        cx = x + slide;
        cz = z + face.sign * (face.half + clear);
        rotY = face.sign > 0 ? Math.PI : 0;
      } else {
        cx = x + face.sign * (face.half + clear);
        cz = z + slide;
        rotY = face.sign > 0 ? -Math.PI / 2 : Math.PI / 2;
      }
      // Stay inside the walkable map. This used to be a hard-coded ±93 for the
      // old 200 m city; Eko Basin is 840 m across, so the bounds come from the
      // map itself now instead of a number that silently emptied every door list.
      if (cx < WORLD_BOUNDS.minX + 1 || cx > WORLD_BOUNDS.maxX - 1) continue;
      if (cz < WORLD_BOUNDS.minZ + 1 || cz > WORLD_BOUNDS.maxZ - 1) continue;
      if (occupied(cx, cz, building.id)) continue;
      out.push({ x: cx, z: cz, rotY });
    }
  }
  return out;
}

/**
 * Choose the door position for a building.
 *
 * When a navigation grid is supplied, the chosen spot must also be *reachable*
 * — part of the same walkable component the player spawns in. This is what
 * stops a door from being placed in a courtyard sealed off by neighbouring
 * buildings: the player would see a glowing ring and never be able to stand on
 * it, which is worse than a door on an inconvenient side.
 */
export function doorWorldPosition(building, nav = null) {
  const candidates = doorCandidates(building);
  if (candidates.length === 0) return { x: building.position.x, z: building.position.z, rotY: 0 };
  if (!nav) return candidates[0];

  for (const c of candidates) {
    if (nav.isReachable(c.x, c.z)) return c;
  }

  // Nothing on the building's own faces connects to the street network.
  // Snap to the closest reachable pavement and face the building.
  const nearest = nav.nearestReachable(candidates[0].x, candidates[0].z, 20);
  if (nearest) {
    const rotY = Math.atan2(building.position.x - nearest.x, building.position.z - nearest.z);
    return { x: nearest.x, z: nearest.z, rotY };
  }
  return candidates[0];
}

/** Look up a building by id. */
export function buildingById(id) {
  return buildings.find((b) => b.id === id) || null;
}

/**
 * Build the door registry: one entry per enterable building.
 * @returns {Array<{interiorId, name, buildingId, x, z, rotY}>}
 */
export function buildDoorRegistry(nav = null) {
  const doors = [];
  for (const def of allInteriors()) {
    // Interiors reached from inside another interior (the airfield is behind
    // the departure gate) must not also get a door on the street.
    if (def.doorless) continue;
    const building = buildingById(def.buildingId);
    if (!building) continue;
    const p = doorWorldPosition(building, nav);
    doors.push({
      interiorId: def.id,
      name: def.name,
      buildingId: def.buildingId,
      x: p.x,
      z: p.z,
      rotY: p.rotY,
      residential: !!def.residential,
      // Doors that belong to a housing listing only open for its occupant.
      propertyId: def.propertyId || null,
      interiorName: def.name,
    });
  }
  return doors;
}
