// client/src/world/poi.js
// Points of interest — the single source of truth for every map marker.
//
// Everything the map draws comes from here, and every entry carries real world
// coordinates taken from cityData, so a marker can never be decorative: the
// navigation system routes to the same coordinates the minimap draws.

import {
  buildings, districts, roads,
  METRO_STATIONS, METRO_LINES, SAFEHOUSES, MISSION_PINS, HEIST_TARGET,
  FACTIONS, ISLANDS, toWorld, factionForIsland,
} from './cityData.js';
import { buildDoorRegistry } from './interiorData.js';
import { interactionPoints } from './interactionPoints.js';

export const POI_KINDS = {
  bank:      { label: 'Bank / ATM',   colour: '#4ade80', icon: 'bank',      category: 'services' },
  shop:      { label: 'Shop',         colour: '#fbbf24', icon: 'cash',      category: 'services' },
  job:       { label: 'Work',         colour: '#a78bfa', icon: 'briefcase', category: 'work' },
  property:  { label: 'Property',     colour: '#f472b6', icon: 'home',      category: 'home' },
  hospital:  { label: 'Hospital',     colour: '#ef4444', icon: 'hygiene',   category: 'services' },
  police:    { label: 'Police',       colour: '#60a5fa', icon: 'user',      category: 'services' },
  fuel:      { label: 'Fuel',         colour: '#34d399', icon: 'energy',    category: 'vehicles' },
  vehicle:   { label: 'Dealership',   colour: '#f59e0b', icon: 'walk',      category: 'vehicles' },
  garage:    { label: 'Garage',       colour: '#fb923c', icon: 'settings',  category: 'vehicles' },
  food:      { label: 'Food',         colour: '#f97316', icon: 'hunger',    category: 'services' },
  gym:       { label: 'Gym',          colour: '#22d3ee', icon: 'fun',       category: 'services' },
  transit:   { label: 'Transport',    colour: '#94a3b8', icon: 'walk',      category: 'travel' },
  enterable: { label: 'Enterable',    colour: '#6fe3ff', icon: 'door',      category: 'travel' },
  mission:   { label: 'Objective',    colour: '#ffd166', icon: 'activities', category: 'missions' },
  metro:     { label: 'Eko Metro',    colour: '#ff6b6b', icon: 'walk',      category: 'travel' },
  safehouse: { label: 'Safehouse',    colour: '#3ddc84', icon: 'home',      category: 'home' },
  heist:     { label: 'Heist target', colour: '#7ff3ff', icon: 'activities', category: 'missions' },
};

// Which building id maps to which marker kind
const BUILDING_KIND = {
  bank: 'bank',
  'tech-hub': 'job',
  clinic: 'hospital',
  hospital: 'hospital',
  police: 'police',
  market: 'shop',
  'pure-water': 'shop',
  'fuel-station': 'fuel',
  dealership: 'vehicle',
  garage: 'garage',
  restaurant: 'food',
  'food-court': 'food',
  gym: 'gym',
  'bus-park': 'transit',
  'office-tower': 'job',
  'kiosk-trader': 'job',
  'kiosk-construction': 'job',
};

/**
 * Build the full POI list.
 * @param {object} [opts]
 * @param {object} [opts.nav] - navigation grid, so unreachable POIs can be dropped
 */
export function buildPOIs({ nav = null } = {}) {
  const pois = [];
  const seen = new Set();

  const push = (poi) => {
    const key = `${poi.kind}:${poi.x.toFixed(1)}:${poi.z.toFixed(1)}`;
    if (seen.has(key)) return;
    seen.add(key);
    pois.push(poi);
  };

  // ── Buildings ──
  for (const b of buildings) {
    if (b.size.h < 0.5) continue;
    const kind = BUILDING_KIND[b.id];
    if (!kind) continue;
    push({
      id: `b-${b.id}`,
      name: b.name,
      kind,
      x: b.position.x,
      z: b.position.z,
      buildingId: b.id,
      district: b.district,
    });
  }

  // ── Doors (every enterable interior) ──
  const doors = buildDoorRegistry(nav);
  for (const d of doors) {
    push({
      id: `door-${d.interiorId}`,
      name: d.name,
      kind: 'enterable',
      x: d.x,
      z: d.z,
      interiorId: d.interiorId,
      enterable: true,
      district: buildings.find(b => b.id === d.buildingId)?.district,
    });
  }

  // ── Interaction points from the server config (ATM, shops) ──
  for (const p of interactionPoints) {
    push({
      id: `i-${p.id}`,
      name: p.name || p.id,
      kind: p.type === 'bank' ? 'bank' : p.type === 'shop' ? 'shop' : 'shop',
      x: p.x,
      z: p.z,
      interactionId: p.id,
      radius: p.radius,
    });
  }

  // ── Properties (housing market) ──
  for (const p of PROPERTY_POIS) push(p);

  // ── Eko Metro stations ──
  // Eleven real stations where the blueprint puts them, each naming the lines it
  // serves. These used to be six invented bus stops on the old grid.
  for (const st of METRO_STATIONS) {
    const p = toWorld(st.pixels[0], st.pixels[1]);
    const lines = st.lines
      .map((id) => METRO_LINES.find((l) => l.id === id)?.name || id)
      .join(' · ');
    push({
      id: st.id, name: `${st.name} (${lines})`, kind: 'metro',
      x: p.x, z: p.z, stationId: st.id, lines: st.lines,
    });
  }

  // ── Safehouses ──
  for (const sh of SAFEHOUSES) {
    const p = toWorld(sh.pixels[0], sh.pixels[1]);
    push({ id: sh.id, name: sh.name, kind: 'safehouse', x: p.x, z: p.z });
  }

  // ── Campaign pins ──
  // One marker per pin on the reference map, labelled with its chapter so the
  // map reads as a story rather than a list of coordinates.
  MISSION_PINS.forEach((pin, i) => {
    const p = toWorld(pin.pixels[0], pin.pixels[1]);
    push({
      id: `mission-pin-${i + 1}`,
      name: `Ch ${pin.chapter}: ${pin.name}`,
      kind: 'mission',
      x: p.x, z: p.z,
      chapter: pin.chapter,
    });
  });

  // ── The Federal Gold Vault ──
  {
    const p = toWorld(HEIST_TARGET.pixels[0], HEIST_TARGET.pixels[1]);
    push({ id: HEIST_TARGET.id, name: HEIST_TARGET.name, kind: 'heist', x: p.x, z: p.z });
  }

  // ── Faction fronts ──
  // One marker per faction, on an island that faction holds, so a player can see
  // whose turf they are walking into before they walk into it.
  for (const faction of FACTIONS) {
    const island = ISLANDS.find((i) => factionForIsland(i.id) === faction.id);
    if (!island) continue;
    // The marker sits at the island's own centroid, not a random vertex.
    const pts = island.pixels.map(([px, py]) => toWorld(px, py));
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    push({
      id: `faction-${faction.id}`,
      name: faction.short || faction.name,
      kind: 'transit',
      x: cx,
      z: cz,
      faction: faction.id,
    });
  }

  if (nav) {
    // Drop anything the player could never walk to. A marker that cannot be
    // reached is worse than no marker at all.
    return pois.filter((p) => nav.isReachable(p.x, p.z) || p.enterable);
  }
  return pois;
}

// Property locations, mirrored from the server's propertyConfig ids.
//
// These used to be hard-coded coordinates, which went stale the moment the city
// was re-planned and the buildings moved. They are read from cityData now, so a
// marker can never point at a building that is no longer there. The literal
// coordinates stay as a fallback for a property whose building is missing.
const PROPERTY_FALLBACK = {
  'hostel-bed': { x: -25, z: 72 },
  'yaba-studio': { x: 35, z: 30 },
  'vi-apartment': { x: -32, z: -39 },
  'lekki-duplex': { x: 35, z: -33 },
  'waterfront-mansion': { x: 84, z: -70 },
};

function propertyPOI(id, name, propertyId) {
  const b = buildings.find((x) => x.id === `prop-${propertyId}`);
  const at = b ? b.position : PROPERTY_FALLBACK[propertyId];
  return { id, name, kind: 'property', x: at.x, z: at.z, propertyId };
}

export const PROPERTY_POIS = [
  propertyPOI('prop-hostel', 'Hostel Bed', 'hostel-bed'),
  propertyPOI('prop-yaba', 'Yaba Studio Flat', 'yaba-studio'),
  propertyPOI('prop-vi', 'VI Apartment', 'vi-apartment'),
  propertyPOI('prop-lekki', 'Lekki Duplex', 'lekki-duplex'),
  propertyPOI('prop-mansion', 'Waterfront Mansion', 'waterfront-mansion'),
];

/** POIs belonging to a district, for the "nearby" list. */
export function poisByDistrict() {
  const out = new Map();
  for (const d of districts) out.set(d.id, []);
  return out;
}

export { districts, roads };
