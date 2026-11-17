// client/src/world/cityData.js
// The city's data surface. This file no longer generates anything: it is the
// stable import path every other module already uses (the renderer, the
// minimap, the full map screen, POIs, NPCs, interiors, the server's world
// module), and it forwards to the Eko Basin generator in ekoWorld.js.
//
// Kept as a separate module on purpose: sixty-odd files import from
// './cityData.js', and the map has now changed twice. One indirection means
// the next map change touches two files, not sixty.

export {
  // Geometry + layout
  districts,
  roads,
  roadSurface,
  roadLines,
  onRoadway,
  buildings,
  keyBuildings,
  propertyBuildings,
  jobKiosks,
  activityBuildings,
  interactionBuildings,
  landmarkBuildings,
  amenityBuildings,
  INTERACTION_ANCHORS,
  // Scatter
  treePositions,
  palmTreePositions,
  lightPositions,
  // Rules
  getCollisionBoxes,
  SPAWN,
  WORLD_STATS,
  WORLD_BOUNDS,
  PLACEMENT_WARNINGS,
} from './ekoWorld.js';

export {
  ISLANDS,
  BRIDGES,
  METRO_LINES,
  METRO_STATIONS,
  METRO_AMBUSHES,
  FACTIONS,
  HEIST_TARGET,
  SAFEHOUSES,
  MISSION_PINS,
  MAP_STATS,
  SCALE,
  toWorld,
  islandAt,
  islandPolygon,
  islandBounds,
  districtAt,
  factionForIsland,
} from './ekoBasin.js';

// ── Retired procedural surfaces ──────────────────────────────
// The old city painted pavements, lane dashes, zebra crossings and stop bars
// as separate strip lists. Eko Basin draws roads, kerbs and markings inside
// EkoBuilder instead, so these now describe nothing. They are exported as
// empty lists rather than deleted: any module still asking for them gets an
// honest "there are none" instead of an import error, and the city cannot
// silently acquire invisible pavements.
export const sidewalkStrips = () => [];
export const laneMarkings = () => [];
export const crosswalks = () => [];
export const stopBars = () => [];

/** The lagoon. EkoBuilder draws water across the whole basin at y = -1.1. */
export const waterPlane = { y: -1.1, size: { w: 2600, d: 1600 }, colour: 0x0b2038 };

/** There is no single beach on Eko Basin: every island has its own shoreline. */
export const beachStrip = null;
