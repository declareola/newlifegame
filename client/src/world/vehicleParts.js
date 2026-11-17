// client/src/world/vehicleParts.js
// The vehicles the Kenney car kit does not have.
//
// The street fleet used to be sedans, SUVs, taxis, "danfo" boxes, "keke" boxes
// and "okada" boxes — the last three were literally a painted box with a second
// box on top, which is why the road read as traffic made of furniture.
//
// What Lagos actually has, and what this file builds:
//   · an 18-seater Hiace bus — the white-and-yellow long-wheelbase minibus that
//     replaced the danfo on most routes (the van GLB from the CC0 kit is used for
//     it where the assets are installed; this is the fallback and the proportions
//     everything is scaled against)
//   · a tricycle (keke NAPEP) — one wheel forward, a cabin, a bench in the back
//   · a motorcycle (okada) — frame, tank, seat, two wheels, rider-height bars
//
// Each builder returns an array of parts in *vehicle-local space*: origin on the
// ground between the wheels, nose pointing +Z, in metres. That is the same
// convention the traffic instancer uses for the CC0 models, so the two can be
// mixed in one fleet.

import * as THREE from 'three';

function part(geometry, material) {
  return { geometry, material };
}

/** Paint material, cached per colour so a fleet of 20 buses is 1 material. */
const paints = new Map();
export function paint(colour, { roughness = 0.45, metalness = 0.35 } = {}) {
  const key = `${colour}-${roughness}-${metalness}`;
  if (!paints.has(key)) {
    paints.set(key, new THREE.MeshStandardMaterial({ color: colour, roughness, metalness }));
  }
  return paints.get(key);
}

const glass = new THREE.MeshStandardMaterial({
  color: 0x9fd7ea, roughness: 0.12, metalness: 0.6, transparent: true, opacity: 0.62,
});
const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ced4, roughness: 0.25, metalness: 0.85 });
const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xfff3c4, emissiveIntensity: 0.8 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, emissive: 0x992d22, emissiveIntensity: 0.5 });
export const materials = { glass, dark, chrome, lightMat, tailMat };

/** A wheel lying on its axle, centred at (x, y, z). */
export function wheelGeometry(radius = 0.33, width = 0.22, segments = 14) {
  const geo = new THREE.CylinderGeometry(radius, radius, width, segments);
  geo.rotateZ(Math.PI / 2);
  return geo;
}

/**
 * A wheel: geometry centred on its own axle with the axle along X, plus where
 * it sits on the vehicle. Traffic bakes the offset into an instanced copy; a
 * drivable vehicle keeps it as a mesh position so it can spin.
 */
function wheelPart(radius, width, x, y, z, segments = 14) {
  return {
    geometry: wheelGeometry(radius, width, segments),
    material: dark,
    wheel: radius,
    offset: [x, y, z],
  };
}

function boxGeo(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * 18-seater Hiace-style minibus.
 *
 * 5.3 m long, 1.9 m wide, 2.2 m tall — the long-wheelbase body that seats the
 * driver, one passenger in front and sixteen in four rows behind. Long side
 * glazing, a sliding door on the near side, a roof rack for luggage.
 *
 * @param {number} colour body paint
 * @param {number} accent the second colour of the two-tone livery
 */
export function hiaceParts(colour = 0xf5d020, accent = 0xf7f9fa) {
  // A pure-white van in Lagos sun blows out to a silhouette, so the body is a
  // warm off-white and the upper band carries the operator's colour.
  const paintMat = paint(colour, { roughness: 0.62, metalness: 0.12 });
  const accentMat = paint(accent, { roughness: 0.5, metalness: 0.2 });
  const L = 5.3;
  const W = 1.9;
  const wheelR = 0.36;

  const parts = [];
  // Main body, from the sills up to the window line
  parts.push(part(boxGeo(W, 0.95, L, 0, wheelR + 0.48, 0), paintMat));
  // Upper body / roof band
  parts.push(part(boxGeo(W - 0.06, 0.78, L - 0.5, 0, wheelR + 1.34, -0.1), accentMat));
  // Roof (slightly domed, approximated by a thinner box)
  parts.push(part(boxGeo(W - 0.16, 0.12, L - 0.9, 0, wheelR + 1.78, -0.15), accentMat));
  // Bonnet, sloping forward
  const bonnet = boxGeo(W - 0.12, 0.42, 0.9, 0, wheelR + 0.72, L / 2 - 0.35);
  parts.push(part(bonnet, paintMat));
  // Windscreen
  parts.push(part(boxGeo(W - 0.22, 0.7, 0.06, 0, wheelR + 1.34, L / 2 - 0.78), glass));
  // Side glazing: one long window per side, split by pillars
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      parts.push(part(
        boxGeo(0.04, 0.56, 0.92, side * (W / 2 - 0.01), wheelR + 1.36, 0.2 - i * 1.05),
        glass,
      ));
    }
    // Mirror arms
    parts.push(part(boxGeo(0.22, 0.1, 0.06, side * (W / 2 + 0.1), wheelR + 1.5, L / 2 - 0.62), dark));
  }
  // Waist stripe: every Lagos minibus carries one, and it is what stops a
  // light body from reading as a blank white box in midday sun.
  for (const side of [-1, 1]) {
    parts.push(part(boxGeo(0.05, 0.16, L - 0.6, side * (W / 2 + 0.01), wheelR + 0.86, -0.1), paint(accent, { roughness: 0.55 })));
  }
  // Rear window + doors
  parts.push(part(boxGeo(W - 0.24, 0.6, 0.05, 0, wheelR + 1.36, -L / 2 + 0.02), glass));
  parts.push(part(boxGeo(0.05, 1.5, 0.04, 0, wheelR + 0.9, -L / 2 - 0.01), dark));
  // Bumpers, lights
  parts.push(part(boxGeo(W - 0.04, 0.22, 0.18, 0, wheelR - 0.02, L / 2 + 0.02), dark));
  parts.push(part(boxGeo(W - 0.04, 0.22, 0.18, 0, wheelR - 0.02, -L / 2 - 0.02), dark));
  for (const side of [-1, 1]) {
    parts.push(part(boxGeo(0.34, 0.2, 0.08, side * (W / 2 - 0.32), wheelR + 0.62, L / 2 + 0.04), lightMat));
    parts.push(part(boxGeo(0.26, 0.28, 0.06, side * (W / 2 - 0.3), wheelR + 0.72, -L / 2 - 0.03), tailMat));
  }
  // Roof rack
  parts.push(part(boxGeo(W - 0.3, 0.06, L - 1.4, 0, wheelR + 1.88, -0.3), chrome));

  // Wheels (four, at the corners; front axle 1.6 m ahead of centre). They are
  // returned centred with an offset so the drivable version can spin them.
  for (const side of [-1, 1]) {
    for (const z of [L / 2 - 1.05, -L / 2 + 1.15]) {
      parts.push(wheelPart(wheelR, 0.24, side * (W / 2 - 0.04), wheelR, z));
    }
  }
  return markTint(parts, [paintMat]);
}

/**
 * Tricycle (keke NAPEP): one wheel in front, two at the back, a plastic cabin
 * over the driver, an open bench under a canopy behind.
 */
export function tricycleParts(colour = 0xf2c200, canopy = 0x2e8b57) {
  const paintMat = paint(colour);
  const canopyMat = paint(canopy, { roughness: 0.7, metalness: 0.05 });
  const wheelR = 0.28;
  const L = 2.7;
  const W = 1.35;

  const parts = [];
  // Floor pan and chassis
  parts.push(part(boxGeo(W - 0.1, 0.16, L, 0, wheelR + 0.12, 0), dark));
  // Driver cabin: front cowl, doors, front fascia
  parts.push(part(boxGeo(W - 0.12, 0.7, 1.25, 0, wheelR + 0.52, L / 2 - 0.72), paintMat));
  parts.push(part(boxGeo(W - 0.18, 0.55, 0.06, 0, wheelR + 1.02, L / 2 - 0.16), glass));
  for (const side of [-1, 1]) {
    parts.push(part(boxGeo(0.05, 0.55, 1.0, side * (W / 2 - 0.04), wheelR + 1.0, L / 2 - 0.7), glass));
    // Door line
    parts.push(part(boxGeo(0.03, 0.9, 0.04, side * (W / 2 - 0.02), wheelR + 0.6, L / 2 - 0.2), dark));
  }
  // Roof over the driver
  parts.push(part(boxGeo(W - 0.08, 0.1, 1.5, 0, wheelR + 1.32, L / 2 - 0.75), canopyMat));
  // Passenger canopy and bench
  parts.push(part(boxGeo(W, 0.1, 1.5, 0, wheelR + 1.32, -0.75), canopyMat));
  for (const side of [-1, 1]) {
    parts.push(part(boxGeo(0.06, 1.24, 0.06, side * (W / 2 - 0.05), wheelR + 0.68, L / 2 - 1.45), chrome));
    parts.push(part(boxGeo(0.06, 1.24, 0.06, side * (W / 2 - 0.05), wheelR + 0.68, -L / 2 + 0.1), chrome));
    // Low side panel behind the bench — kenkes are open-sided
    parts.push(part(boxGeo(0.06, 0.4, 1.4, side * (W / 2 - 0.05), wheelR + 0.35, -0.75), paintMat));
  }
  parts.push(part(boxGeo(W - 0.2, 0.16, 0.5, 0, wheelR + 0.42, -0.9), paintMat));   // bench
  parts.push(part(boxGeo(W - 0.2, 0.5, 0.12, 0, wheelR + 0.72, -1.2), paintMat));   // back rest
  // Rear panel and lights
  parts.push(part(boxGeo(W - 0.1, 0.6, 0.08, 0, wheelR + 0.4, -L / 2 + 0.02), paintMat));
  for (const side of [-1, 1]) {
    parts.push(part(boxGeo(0.2, 0.14, 0.06, side * (W / 2 - 0.25), wheelR + 0.55, -L / 2), tailMat));
    parts.push(part(boxGeo(0.18, 0.14, 0.06, side * (W / 2 - 0.3), wheelR + 0.6, L / 2 - 0.1), lightMat));
  }
  // Handlebar
  parts.push(part(boxGeo(0.66, 0.06, 0.06, 0, wheelR + 1.05, L / 2 - 0.42), chrome));

  // Front wheel (single, centred), rear axle pair
  parts.push(wheelPart(wheelR, 0.16, 0, wheelR, L / 2 - 0.45, 12));
  for (const side of [-1, 1]) {
    parts.push(wheelPart(wheelR, 0.18, side * (W / 2 - 0.08), wheelR, -L / 2 + 0.55, 12));
  }
  return markTint(parts, [paintMat]);
}

/**
 * Motorcycle (okada): frame, tank, seat, forks, two wheels, footpegs.
 * Rider-sized, so it is 2.0 m long and 0.8 m tall — a lane-splitting silhouette.
 */
export function motorcycleParts(colour = 0x8b0000) {
  const paintMat = paint(colour, { roughness: 0.35, metalness: 0.5 });
  const wheelR = 0.31;
  const L = 2.0;

  const parts = [];
  // Engine block and frame spine
  parts.push(part(boxGeo(0.34, 0.34, 0.5, 0, wheelR + 0.16, 0.0), dark));
  parts.push(part(boxGeo(0.14, 0.14, 1.15, 0, wheelR + 0.42, 0.05), chrome));
  // Fuel tank
  parts.push(part(boxGeo(0.32, 0.26, 0.56, 0, wheelR + 0.52, 0.32), paintMat));
  // Seat and tail
  parts.push(part(boxGeo(0.3, 0.12, 0.66, 0, wheelR + 0.52, -0.4), dark));
  parts.push(part(boxGeo(0.26, 0.14, 0.34, 0, wheelR + 0.5, -0.78), paintMat));
  // Front forks + headlamp + handlebars
  for (const side of [-1, 1]) {
    parts.push(part(boxGeo(0.06, 0.62, 0.06, side * (0.1), wheelR + 0.34, L / 2 - 0.18), chrome));
  }
  parts.push(part(boxGeo(0.22, 0.2, 0.12, 0, wheelR + 0.72, L / 2 - 0.14), paintMat));
  parts.push(part(boxGeo(0.14, 0.12, 0.06, 0, wheelR + 0.72, L / 2 - 0.06), lightMat));
  parts.push(part(boxGeo(0.62, 0.05, 0.05, 0, wheelR + 0.86, L / 2 - 0.24), chrome));
  // Exhaust
  parts.push(part(boxGeo(0.09, 0.09, 0.8, 0.19, wheelR - 0.02, -0.35), chrome));
  // Footpegs
  for (const side of [-1, 1]) {
    parts.push(part(boxGeo(0.18, 0.04, 0.04, side * 0.2, wheelR - 0.04, -0.1), dark));
  }
  // Wheels
  for (const z of [L / 2 - 0.12, -L / 2 + 0.12]) {
    parts.push(wheelPart(wheelR, 0.11, 0, wheelR, z, 14));
  }
  return markTint(parts, [paintMat]);
}

/**
 * Tag the paintable parts. The traffic fleet draws a whole street of one kind as
 * instanced meshes and gives each car its colour through `instanceColor`, which
 * multiplies the material colour — so those materials are built white and the
 * instance colour supplies the paint.
 */
function markTint(parts, paintMaterials) {
  const set = new Set(paintMaterials);
  for (const p of parts) if (set.has(p.material)) p.tint = true;
  return parts;
}

/**
 * Old ids → the vehicles that replaced them. Saves, server rows and any code
 * that still says "danfo" keep working; nothing is drawn as one any more.
 */
export const FLEET_ALIASES = {
  danfo: 'hiace', bus: 'hiace',
  keke: 'tricycle', trishaw: 'tricycle',
  okada: 'motorcycle', motorbike: 'motorcycle', bike: 'motorcycle',
};

/** Resolve a possibly-legacy kind name to a current one. */
export function currentKind(kind) {
  return FLEET_ALIASES[kind] || kind;
}

/** Which kinds have procedural parts, and how big they are. */
export const PART_KINDS = {
  hiace: { build: hiaceParts, box: { w: 1.9, h: 2.2, l: 5.3, wheelR: 0.36 } },
  tricycle: { build: tricycleParts, box: { w: 1.35, h: 1.6, l: 2.7, wheelR: 0.28 } },
  motorcycle: { build: motorcycleParts, box: { w: 0.62, h: 1.1, l: 2.0, wheelR: 0.31 } },
};
