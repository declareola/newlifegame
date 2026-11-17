// client/src/world/interactionPoints.js
// Client mirror of the server's walk-up interaction points.
//
// The server owns the real list (server/config/interactionConfig.js) and
// re-checks distance on every transaction. This mirror exists only so the map
// can draw bank and shop markers without waiting for a network round trip.
// It is refreshed from the API on login — see setInteractionPoints().

export let interactionPoints = [
  { id: 'atm-centre', name: 'ATM', type: 'bank', x: 12, z: 17.5, radius: 6 },
  { id: 'bank-vi', name: 'Bank', type: 'bank', x: -50, z: -43, radius: 8 },
  { id: 'market-mushin', name: 'Mushin Market', type: 'shop', x: -75, z: 84, radius: 9 },
  { id: 'food-court-shop', name: 'Food Court', type: 'shop', x: -50, z: 86, radius: 7 },
  { id: 'pure-water-shop', name: 'Pure Water Kiosk', type: 'shop', x: -42, z: 74.5, radius: 6 },
];

/** Replace the mirror with the server's authoritative list. */
export function setInteractionPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return;
  interactionPoints = points.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    x: p.position?.x ?? p.x,
    z: p.position?.z ?? p.z,
    radius: p.radius ?? 7,
  }));
  listeners.forEach((fn) => fn(interactionPoints));
}

const listeners = new Set();

/** Notify when the point list changes (the map re-renders its markers). */
export function onInteractionPointsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
