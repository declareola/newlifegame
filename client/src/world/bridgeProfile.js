// client/src/world/bridgeProfile.js
// The three Eko Basin bridges are ramps, not planks.
//
// Before this module the deck was one flat box floating 0.7 m over the water:
// the player walked *through* it (the controller assumed ground y = 0), and
// traffic never went near the lagoon at all, so "cross the bridge" was scenery
// with nothing to cross on.
//
// Everything here is one analytic arch per bridge. The height is a single
// function of the position along the span, so the deck mesh, the player's feet,
// the remote players' feet and the cars' wheels all read the *same* number and
// cannot disagree:
//
//   u = 0 at the first abutment, u = 1 at the second, u = 0.5 at the crown.
//   height(u) = rise * sin(pi * u)          → 0.00 m at both abutments,
//                                             rise at the crown, and a
//                                             horizontal tangent at the top.
//
// The rise per span is the number the city is drawn and driven at (5.50 m for
// the Third Mainland-style Long Bridge, 3.20 m for the two short spans), and the
// deck is 9.2 m wide with a 0.70 m structural depth, which is what a two-lane
// Lagos bridge actually is.

import { BRIDGES, toWorld } from './cityData.js';

/** Structural depth of the deck slab: the driving surface is the *top* of it. */
export const DECK_THICKNESS = 0.7;

/** Carriageway width. Two lanes, kerb-less, like the real spans. */
export const DECK_WIDTH = 9.2;

/** Crown height above the abutments, per bridge. */
const RISE = {
  'long-bridge': 5.5,
  'cantilever-bridge': 3.2,
  'link-bridge': 3.2,
};

const DEFAULT_RISE = 3.2;

/**
 * The bridges in world metres, in the order the map lists them.
 *
 * @typedef {object} BridgePath
 * @property {string} id
 * @property {string} name
 * @property {string} style      'suspension' | 'cantilever' | 'truss'
 * @property {number} ax  first abutment x
 * @property {number} az  first abutment z
 * @property {number} ux  unit direction x (abutment A → B)
 * @property {number} uz  unit direction z
 * @property {number} rx  unit right-hand-of-travel x
 * @property {number} rz  unit right-hand-of-travel z
 * @property {number} length metres along the span
 * @property {number} rise   metres above the abutments at the crown
 * @property {number} width  carriageway width in metres
 * @property {number[]} towers fractions along the span of the suspension towers
 */
export const BRIDGE_PATHS = BRIDGES.map((bridge) => {
  const a = toWorld(bridge.a[0], bridge.a[1]);
  const b = toWorld(bridge.b[0], bridge.b[1]);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const ux = length > 0 ? dx / length : 0;
  const uz = length > 0 ? dz / length : 1;
  return {
    id: bridge.id,
    name: bridge.name,
    style: bridge.style,
    ax: a.x,
    az: a.z,
    bx: b.x,
    bz: b.z,
    ux,
    uz,
    // Right of travel (+u): with x to the east and z to the south, that is
    // (-uz, ux), which is the side Lagos traffic keeps to.
    rx: -uz,
    rz: ux,
    length,
    rise: RISE[bridge.id] ?? DEFAULT_RISE,
    width: DECK_WIDTH,
    towers: bridge.towers || [],
  };
});

/** Look a bridge up by id. */
export function bridgeAt(id) {
  return BRIDGE_PATHS.find((p) => p.id === id) || null;
}

/** Carriageway width of a bridge (or of any bridge, when handed nothing). */
export function deckWidth(path = null) {
  return path && Number.isFinite(path.width) ? path.width : DECK_WIDTH;
}

/** Deck height above the abutments at fraction `u` of the span. */
export function deckHeightAt(path, u) {
  if (!path) return 0;
  const t = Math.min(1, Math.max(0, u));
  return path.rise * Math.sin(Math.PI * t);
}

/**
 * Slope of the deck at `u`, in metres of rise per metre of span.
 * Positive on the climb, negative on the descent — traffic pitches with it.
 */
export function deckSlopeAt(path, u) {
  if (!path) return 0;
  const t = Math.min(1, Math.max(0, u));
  return (path.rise * Math.PI * Math.cos(Math.PI * t)) / Math.max(path.length, 0.001);
}

/**
 * A point on the deck.
 *
 * @param {BridgePath} path
 * @param {number} u       0 at abutment A, 1 at abutment B
 * @param {number} lateral metres right of the centreline (negative = left)
 * @returns {{x:number,y:number,z:number}} y is the *driving surface*
 */
export function deckPoint(path, u, lateral = 0) {
  const t = Math.min(1, Math.max(0, u));
  return {
    x: path.ax + path.ux * path.length * t + path.rx * lateral,
    y: deckHeightAt(path, t),
    z: path.az + path.uz * path.length * t + path.rz * lateral,
  };
}

/**
 * The height of the bridge deck under a world position, or `null` when there is
 * no bridge there.
 *
 * This is the one function the player controller, the remote players and the
 * terrain check all call, so "is the player over a bridge?" and "how high is the
 * player standing?" can never answer differently.
 *
 * @param {number} x
 * @param {number} z
 * @returns {number|null} deck surface height above the abutments
 */
export function bridgeSurfaceAt(x, z) {
  for (const path of BRIDGE_PATHS) {
    const ox = x - path.ax;
    const oz = z - path.az;
    const along = ox * path.ux + oz * path.uz;
    if (along < -0.5 || along > path.length + 0.5) continue;

    const lateral = ox * path.rx + oz * path.rz;
    const half = path.width / 2;
    if (Math.abs(lateral) > half) continue;

    return deckHeightAt(path, along / path.length);
  }
  return null;
}

/**
 * The bridge a world position stands on, with how far along it the position is.
 * Used by the debug window and the screenshot harness.
 *
 * @returns {{path:BridgePath,u:number,lateral:number,y:number}|null}
 */
export function bridgeUnder(x, z) {
  for (const path of BRIDGE_PATHS) {
    const ox = x - path.ax;
    const oz = z - path.az;
    const along = ox * path.ux + oz * path.uz;
    if (along < 0 || along > path.length) continue;
    const lateral = ox * path.rx + oz * path.rz;
    if (Math.abs(lateral) > path.width / 2) continue;
    const u = along / path.length;
    return { path, u, lateral, y: deckHeightAt(path, u) };
  }
  return null;
}
