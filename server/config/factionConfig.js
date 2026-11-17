// server/config/factionConfig.js
// The wanted matrix: three factions, four tiers each.
//
// Blueprint Part D (factions) and Part H (wanted). The rules here are the
// server's, not the client's: the client never sends a star count, it sends what
// the player did, and this module decides how angry anyone gets about it.
//
// Two things make the matrix mean something rather than decorate the HUD:
//   · each faction polices its own turf, so a crime on the Outer Borough makes
//     the Street Kings hostile while the Cartel has not heard of you;
//   · the tier has consequences — refused service, then a police response, then
//     arrest with a real fine — all enforced in server routes.

/**
 * The three factions. `islands` is derived from ekoBasin's factionForIsland, but
 * repeated here because the server must not depend on a client module.
 */
export const FACTIONS = {
  kings: {
    id: 'kings',
    name: 'Mushin Street Kings',
    short: 'Street Kings',
    islands: ['mainland'],
    colour: 0xff7a1a,
    hex: '#ff7a1a',
    police: 'Community enforcers on okada — fast, informal, everywhere',
  },
  syndicate: {
    id: 'syndicate',
    name: 'Apapa Dockside Syndicate',
    short: 'Syndicate',
    islands: ['docks'],
    colour: 0xffc83a,
    hex: '#ffc83a',
    police: 'Dock security and hardened hitmen in armoured SUVs',
  },
  cartel: {
    id: 'cartel',
    name: 'Banana Island Cartel',
    short: 'Cartel',
    islands: ['core', 'banana'],
    colour: 0x22e0ff,
    hex: '#22e0ff',
    police: 'Private security, helicopter overwatch, quiet legal pressure',
  },
};

/**
 * The four tiers, per the blueprint.
 *
 * `response` is what actually happens in the world. It is enforced, not
 * narrated: the server refuses purchases and services from the tier onward.
 */
export const TIERS = [
  {
    stars: 0,
    id: 'clean',
    label: 'Clean',
    response: 'Nobody is looking for you.',
    refuseService: false,
    arrestOnSite: false,
  },
  {
    stars: 1,
    id: 'noticed',
    label: 'Noticed',
    response: 'A face remembered. Shops still serve you, but the price of a bribe is low.',
    refuseService: false,
    arrestOnSite: false,
  },
  {
    stars: 2,
    id: 'flagged',
    label: 'Flagged',
    response: 'Their people watch you on sight. Police patrols begin.',
    refuseService: false,
    arrestOnSite: false,
  },
  {
    stars: 3,
    id: 'hunted',
    label: 'Hunted',
    response: 'Their fronts refuse you service and their police hunt on sight.',
    refuseService: true,
    arrestOnSite: false,
  },
  {
    stars: 4,
    id: 'marked',
    label: 'Marked',
    response: 'Arrest on sight in their turf. You are taken in and fined.',
    refuseService: true,
    arrestOnSite: true,
  },
];

/** Highest star count possible with one faction. */
export const MAX_STARS = 4;

/**
 * Crimes the server knows how to validate. Each one carries the stars it is
 * worth and the preconditions a route must confirm before it counts.
 *
 * `weight` scales with how badly it hurts: a shoplift is not a heist.
 */
export const CRIMES = {
  'break-in': {
    weight: 2,
    label: 'Broke into a home',
    // The route must confirm the player does not live there.
    needsUnownedProperty: true,
  },
  'shoplift': {
    weight: 1,
    label: 'Stole from a shop',
    needsVenue: true,
    // The route hands over a real item from that venue's shelf, and the
    // attendant may see you do it.
    takesStock: true,
  },
  'car-theft': {
    weight: 2,
    label: 'Stole a vehicle',
    needsVehicle: true,
  },
  'assault': {
    weight: 3,
    label: 'Assault in public',
    needsTarget: true,
  },
};

/**
 * Police response strength by tier. Used to decide whether a patrol intercepts
 * the player when they enter a district (the client asks; the server decides).
 */
export function responseFor(stars) {
  if (stars >= 4) return { units: 3, speed: 1.6, arrestOnSight: true, refuseService: true };
  if (stars >= 3) return { units: 2, speed: 1.3, arrestOnSight: false, refuseService: true };
  if (stars >= 2) return { units: 1, speed: 1.0, arrestOnSight: false, refuseService: false };
  return { units: 0, speed: 0, arrestOnSight: false, refuseService: false };
}

/** The tier record for a star count. */
export function tierFor(stars) {
  const s = Math.max(0, Math.min(MAX_STARS, Math.round(stars)));
  return TIERS.find((t) => t.stars === s) || TIERS[0];
}

/**
 * Which faction owns a district. Districts are matched by id prefix from the
 * map; anything unmapped falls to whoever holds the island.
 */
export const DISTRICT_FACTION = {
  marina: 'cartel',
  'victoria-island': 'cartel',
  'eko-atlantic': 'cartel',
  mushin: 'kings',
  surulere: 'kings',
  oshodi: 'kings',
  'computer-village': 'kings',
  'mile-12': 'kings',
  yaba: 'kings',
  lekki: 'kings',
  'apapa-wharf': 'syndicate',
  'tin-can': 'syndicate',
  ijora: 'syndicate',
};

/** Faction for a district id, or null when the district is neutral. */
export function factionForDistrict(districtId) {
  return DISTRICT_FACTION[districtId] || null;
}

/**
 * Bribe price for clearing a faction's interest in you.
 *
 * Escalates steeply: ₦25k for being noticed, ₦900k for being marked. The
 * Cartel charges more than the Street Kings for the same tier — they can.
 */
export const BRIBE_BASE = 25_000;
const FACTION_MULTIPLIER = { kings: 1, syndicate: 1.6, cartel: 2.4 };

export function bribePrice(factionId, stars) {
  if (stars <= 0) return 0;
  const mult = FACTION_MULTIPLIER[factionId] ?? 1;
  // 1★ 25k · 2★ 100k · 3★ 375k · 4★ 900k (× faction multiplier)
  return Math.round(BRIBE_BASE * Math.pow(stars, 2.4) * mult);
}

/** Fine taken when arrested, as a fraction of the player's cash, capped. */
export const ARREST_FINE = {
  fraction: 0.15,
  min: 5_000,
  max: 250_000,
};

/** Where an arrested player wakes up (the police station on the Outer Borough). */
export const POLICE_STATION = { district: 'mushin', buildingId: 'police' };

/**
 * Decay: stars fall by one every this many real minutes of clean behaviour,
 * measured from the last crime. Crime is cheap; staying clean is slower.
 */
export const DECAY_MINUTES_PER_STAR = 6;
