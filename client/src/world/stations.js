// client/src/world/stations.js
// Stations: the places inside a building where something can actually happen.
//
// The complaint that started this module: "i visited a shop and it was empty, no
// cart, no isle, no attendant, nothing to purchase". The shop had shelves; what
// it did not have was a single point in the room where pressing E did anything.
// A room you can only look at is set dressing.
//
// A station is small and declarative:
//
//   { id, label, icon, x, z, radius, actions: [...] }
//
// and an action is one of four honest kinds:
//
//   activity    start a server-authoritative activity ('sleep', 'cook', …)
//   shop        open the venue's shop panel (stock and prices come from the server)
//   appearance  change clothes (the same appearance endpoint onboarding uses)
//   enter       walk through to another interior (the airport gate → the airfield)
//
// Nothing here decides what an action costs or what it gives you — that is the
// server's job. This module only answers "what is within arm's reach".

import * as THREE from 'three';

/** Default interaction radius, in metres. */
export const STATION_RADIUS = 1.9;

/**
 * Normalise a station definition and give it an id.
 * @returns {object} a frozen station
 */
export function makeStation(spec) {
  if (!spec || !Array.isArray(spec.actions) || spec.actions.length === 0) return null;
  const x = Number(spec.x);
  const z = Number(spec.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return {
    id: spec.id || `st-${x.toFixed(1)}-${z.toFixed(1)}`,
    label: spec.label || 'Interact',
    icon: spec.icon || '✋',
    x,
    z,
    radius: Number(spec.radius) || STATION_RADIUS,
    actions: spec.actions,
  };
}

/**
 * The nearest station within reach of a point.
 * @param {Array} stations
 * @param {{x:number,z:number}} pos
 * @returns {object|null}
 */
export function nearestStation(stations, pos) {
  if (!stations || !stations.length || !pos) return null;
  let best = null;
  let bestD2 = Infinity;
  for (const st of stations) {
    const dx = pos.x - st.x;
    const dz = pos.z - st.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > st.radius * st.radius) continue;
    if (d2 < bestD2) { bestD2 = d2; best = st; }
  }
  return best;
}

/**
 * A subtle floor ring so the player can see where to stand.
 *
 * Deliberately quiet: a glowing pad on every surface would turn a home into a
 * level in a platform game. It is one unlit ring per station, added to the
 * interior group, and it is merged away with everything else.
 */
export function createStationMarker(station) {
  const geo = new THREE.RingGeometry(station.radius * 0.55, station.radius * 0.72, 24);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x6fe3ff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(station.x, 0.035, station.z);
  ring.name = `station-ring-${station.id}`;
  return ring;
}

/** Is this action an activity the server will accept? */
export function isActivityAction(action) {
  return !!action && action.kind === 'activity' && typeof action.id === 'string';
}
