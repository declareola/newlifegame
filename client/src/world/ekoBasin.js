// client/src/world/ekoBasin.js
// THE EKO BASIN MAP — single source of truth.
//
// Every polygon, bridge, metro line, point of interest, mission pin and faction
// boundary in this file was extracted from the supplied reference map
// ("Eko Basin 3D Map (1).html") and the blueprint PDF, not invented. The map's
// own coordinate system puts pixel (700, 390) at the origin and treats 10 px as
// one map unit; we scale that to metres so the city is walkable at the same
// physical scale as the rest of the game (a pavement is ~3 m, a road lane
// ~3.5 m, a car ~4.5 m).
//
//   world.x = (px - 700) * SCALE
//   world.z = (py - 390) * SCALE
//
// At SCALE = 0.6 the basin is 840 m across and 420 m deep: big enough that the
// bridges matter and a car is worth having, small enough that a browser can
// draw it.

/** Metres per reference-map pixel. 10 px = 6 m. */
export const SCALE = 0.6;

/** Convert a reference-map pixel coordinate to world metres. */
export function toWorld(px, py) {
  return { x: (px - 700) * SCALE, z: (py - 390) * SCALE };
}

// ─────────────────────────────────────────────────────────────
// The four landmasses. Outlines traced from the reference map.
// ─────────────────────────────────────────────────────────────

/** @typedef {{id:string,name:string,shortName:string,role:string,colour:number,faction:string,pixels:number[][]}} Island */

/** @type {Island[]} */
export const ISLANDS = [
  {
    id: 'docks',
    name: 'The Industrial North',
    shortName: 'Docks',
    role: 'Apapa and Tin Can: shipyards, container yards, rail sidings, gantry cranes and jetties.',
    colour: 0xffc83a,
    faction: 'syndicate',
    pixels: [
      [330, 238], [400, 175], [500, 135], [600, 90], [615, 60], [740, 72], [800, 86],
      [930, 62], [1005, 92], [980, 135], [925, 165], [840, 195], [770, 195], [722, 232],
      [650, 252], [560, 240], [490, 262], [440, 292], [395, 282], [345, 252],
    ],
  },
  {
    id: 'banana',
    name: 'Banana Island',
    shortName: 'Banana Island',
    role: 'Cartel annex: low warehouses, villas and green patches. No bridge — boat or Eko Metro only.',
    colour: 0x22e0ff,
    faction: 'cartel',
    pixels: [
      [48, 498], [100, 420], [190, 330], [235, 322], [335, 348], [380, 358], [372, 392],
      [320, 440], [262, 480], [200, 512], [105, 516],
    ],
  },
  {
    id: 'core',
    name: 'The Vertical Core',
    shortName: 'Core',
    role: 'Lagos Island, Victoria Island and Ikoyi: the financial district. Skyline climbs toward the middle.',
    colour: 0x22e0ff,
    faction: 'cartel',
    pixels: [
      [300, 610], [300, 560], [325, 520], [360, 495], [410, 450], [480, 400], [560, 355],
      [650, 315], [745, 290], [800, 300], [838, 340], [825, 385], [780, 430], [720, 480],
      [650, 545], [590, 600], [530, 635], [430, 640], [340, 640],
    ],
  },
  {
    id: 'mainland',
    name: 'The Outer Borough',
    shortName: 'Mainland',
    role: 'Mushin, Surulere and Oshodi: dense residential blocks, markets and winding seaside roads.',
    colour: 0xff7a1a,
    faction: 'kings',
    pixels: [
      [990, 350], [1020, 280], [1050, 235], [1090, 205], [1140, 190], [1190, 185], [1240, 200],
      [1300, 205], [1345, 230], [1355, 330], [1330, 420], [1305, 470], [1270, 520], [1230, 570],
      [1200, 600], [1150, 640], [1100, 680], [1040, 700], [960, 690], [900, 700], [850, 685],
      [830, 650], [850, 600], [890, 520], [930, 450], [970, 390],
    ],
  },
];

// ─────────────────────────────────────────────────────────────
// Bridges. Banana Island deliberately has none (blueprint C2).
// ─────────────────────────────────────────────────────────────

export const BRIDGES = [
  {
    id: 'long-bridge',
    name: 'Long Bridge',
    style: 'suspension',
    from: 'docks',
    to: 'mainland',
    // Third Mainland style: Industrial North → east shore of the Outer Borough.
    a: [610, 95],
    b: [1245, 535],
    towers: [0.34, 0.57],
    height: 11,
    deckWidth: 3.6,
    role: 'Main highway. Police roadblocks and big vehicle chases.',
  },
  {
    id: 'cantilever-bridge',
    name: 'Cantilever Bridge',
    style: 'cantilever',
    from: 'docks',
    to: 'core',
    // Carter / Eko style: Industrial North → the Vertical Core.
    a: [518, 238],
    b: [592, 350],
    height: 5,
    deckWidth: 3.2,
    role: 'Syndicate supply route onto the island.',
  },
  {
    id: 'link-bridge',
    name: 'Link Bridge',
    style: 'truss',
    from: 'core',
    to: 'mainland',
    // Lekki-Ikoyi style: the Core → the Outer Borough.
    a: [745, 470],
    b: [925, 565],
    height: 4,
    deckWidth: 3.2,
    role: 'Mainland access. Street Kings reinforcements come this way.',
  },
];

// ─────────────────────────────────────────────────────────────
// Eko Metro: three underground loops. Lagos has no deep-bore subway in reality,
// which is exactly why the blueprint makes this line fictional.
// ─────────────────────────────────────────────────────────────

export const METRO_LINES = [
  {
    id: 'line-a',
    name: 'Line A',
    colour: 0xff3b3b,
    role: 'Main loop; connects every faction.',
    pixels: [
      [232, 398], [350, 460], [475, 525], [560, 580], [700, 592], [800, 572],
      [905, 480], [920, 300], [1017, 181], [1220, 90],
    ],
  },
  {
    id: 'line-b',
    name: 'Line B',
    colour: 0xff6b6b,
    role: 'Route of the Third Rail Run.',
    pixels: [[350, 460], [430, 380], [580, 310], [750, 262], [920, 255]],
  },
  {
    id: 'line-c',
    name: 'Line C',
    colour: 0xff9a9a,
    role: 'Street Kings territory; the starting safehouses sit along it.',
    pixels: [
      [475, 525], [718, 454], [805, 502], [925, 565], [1010, 470], [1122, 353], [1224, 260],
    ],
  },
];

/** Ten circular station nodes, exactly where the reference map puts them. */
export const METRO_STATIONS = [
  { id: 'st-1', name: 'Marina', pixels: [232, 398], lines: ['line-a'] },
  { id: 'st-2', name: 'Iddo Junction', pixels: [350, 460], lines: ['line-a', 'line-b'] },
  { id: 'st-3', name: 'Ikoyi', pixels: [475, 525], lines: ['line-a', 'line-c'] },
  { id: 'st-4', name: 'Victoria Island', pixels: [718, 454], lines: ['line-c'] },
  { id: 'st-5', name: 'Link Bridge South', pixels: [805, 502], lines: ['line-c'] },
  { id: 'st-6', name: 'Surulere', pixels: [925, 565], lines: ['line-c'] },
  { id: 'st-7', name: 'Mushin', pixels: [1122, 353], lines: ['line-c'] },
  { id: 'st-8', name: 'Oshodi', pixels: [1224, 260], lines: ['line-c'] },
  { id: 'st-9', name: 'Tin Can', pixels: [1017, 181], lines: ['line-a'] },
  { id: 'st-10', name: 'Apapa', pixels: [920, 255], lines: ['line-b'] },
  { id: 'st-11', name: 'Yaba', pixels: [1220, 90], lines: ['line-a'] },
];

/** Ambush choke points: one per line, per the blueprint. */
export const METRO_AMBUSHES = [
  { id: 'ambush-a', line: 'line-a', at: 0.45, name: 'Line A choke' },
  { id: 'ambush-b', line: 'line-b', at: 0.50, name: 'Line B choke' },
  { id: 'ambush-c', line: 'line-c', at: 0.80, name: 'Line C choke' },
];

// ─────────────────────────────────────────────────────────────
// Districts (blueprint Part C + the map's own district labels).
// ─────────────────────────────────────────────────────────────

export const DISTRICTS = [
  { id: 'marina', name: 'Marina banking strip', island: 'core', pixels: [470, 560], radius: 9, kind: 'financial' },
  { id: 'victoria-island', name: 'Victoria Island', island: 'core', pixels: [380, 520], radius: 8, kind: 'financial' },
  { id: 'eko-atlantic', name: 'Eko Atlantic', island: 'core', pixels: [800, 330], radius: 12, kind: 'skyscraper' },
  { id: 'mushin', name: 'Mushin', island: 'mainland', pixels: [1130, 280], radius: 8, kind: 'residential' },
  { id: 'surulere', name: 'Surulere', island: 'mainland', pixels: [1000, 520], radius: 8, kind: 'residential' },
  { id: 'oshodi', name: 'Oshodi motor park', island: 'mainland', pixels: [1250, 400], radius: 7, kind: 'transit' },
  { id: 'computer-village', name: 'Computer Village', island: 'mainland', pixels: [1170, 570], radius: 6, kind: 'market' },
  { id: 'mile-12', name: 'Mile 12 market', island: 'mainland', pixels: [1120, 650], radius: 6, kind: 'market' },
  { id: 'apapa-wharf', name: 'Apapa wharf', island: 'docks', pixels: [500, 170], radius: 7, kind: 'port' },
  { id: 'tin-can', name: 'Tin Can port', island: 'docks', pixels: [880, 120], radius: 8, kind: 'port' },
  { id: 'ijora', name: 'Ijora substation', island: 'docks', pixels: [400, 230], radius: 6, kind: 'industrial' },
];

// ─────────────────────────────────────────────────────────────
// Points of interest and story pins (map + blueprint Part C4).
// ─────────────────────────────────────────────────────────────

export const HEIST_TARGET = {
  id: 'federal-gold-vault',
  name: 'Federal Gold Vault',
  pixels: [700, 430],
  depth: -2.6,
  label: 'HEIST TARGET: FEDERAL GOLD VAULT',
};

/** The three starting safehouses, all on the Outer Borough along Line C. */
export const SAFEHOUSES = [
  { id: 'safehouse-1', name: 'Room behind the canteen', pixels: [1060, 420] },
  { id: 'safehouse-2', name: 'Mushin block room', pixels: [1150, 520] },
  { id: 'safehouse-3', name: 'Surulere compound', pixels: [1270, 330] },
];

/** Campaign mission pins. `chapter` matches the blueprint's chapter table. */
export const MISSION_PINS = [
  { chapter: 1, name: 'The Canteen', pixels: [955, 500], island: 'mainland' },
  { chapter: 2, name: 'Scaffolding Sprint', pixels: [1200, 300], island: 'mainland' },
  { chapter: 5, name: 'Cold Room', pixels: [620, 170], island: 'docks' },
  { chapter: 7, name: 'Contraband Co-Op', pixels: [580, 218], island: 'docks' },
  { chapter: 13, name: 'Switchyard', pixels: [360, 238], island: 'docks' },
  { chapter: 18, name: 'The Bedrock Job', pixels: [700, 430], island: 'core' },
  { chapter: 19, name: 'Third Rail Run', pixels: [580, 310], island: 'metro' },
  { chapter: 21, name: 'Gala at Eko Atlantic', pixels: [790, 320], island: 'core' },
  { chapter: 22, name: 'The Great Wall', pixels: [480, 625], island: 'core' },
  { chapter: 23, name: 'Switch Night: power station', pixels: [1200, 215], island: 'mainland' },
  { chapter: 23, name: 'Switch Night: control tower', pixels: [600, 470], island: 'core' },
  { chapter: 23, name: 'Switch Night: harbor', pixels: [850, 110], island: 'docks' },
];

// ─────────────────────────────────────────────────────────────
// Factions (blueprint Part D). Colours match the Wanted Level matrix.
// ─────────────────────────────────────────────────────────────

export const FACTIONS = [
  {
    id: 'kings',
    name: 'Mushin Street Kings',
    short: 'Street Kings',
    colour: 0xff7a1a,
    hex: '#ff7a1a',
    island: 'mainland',
    turf: 'The Outer Borough (housing blocks)',
    front: 'Provision shops, mini-marts, basement laundromats, motor parks',
    combat: 'Aggressive swarm tactics. Micro-SMGs, cutlasses and bats, fast tuned sedans.',
    boss: { name: 'Kunle "Kingsize" Balogun', wants: 'Respect, and to stop the demolition of his neighbourhood' },
  },
  {
    id: 'syndicate',
    name: 'Apapa Dockside Syndicate',
    short: 'Syndicate',
    colour: 0xffc83a,
    hex: '#ffc83a',
    island: 'docks',
    turf: 'The Industrial North (Docks)',
    front: 'Cold-room and meat processing plants, scrap yards, clearing-agent offices',
    combat: 'Organised, heavy hitmen. Pump shotguns, suppressed pistols, armoured SUVs.',
    boss: { name: 'Alhaji Musa "The Harbourmaster" Danjuma', wants: 'Keep the port steady and die in his own bed' },
  },
  {
    id: 'cartel',
    name: 'Banana Island Cartel',
    short: 'Cartel',
    colour: 0x22e0ff,
    hex: '#22e0ff',
    islands: ['core', 'banana'],
    turf: 'The Vertical Core (penthouses) and the Banana Island annex',
    front: 'Luxury car dealerships, art galleries, private jet charters',
    combat: 'High-tech security operatives. SMGs, smoke grenades, private choppers.',
    boss: { name: 'Madam Adaora "The Duchess" Okonkwo-Bello', wants: 'Power, quietly. She is already talking to Atlantic.' },
  },
];

/** Faction that holds a given island, or null for open water / metro. */
export function factionForIsland(islandId) {
  if (islandId === 'banana' || islandId === 'core') return 'cartel';
  if (islandId === 'docks') return 'syndicate';
  if (islandId === 'mainland') return 'kings';
  return null;
}

// ─────────────────────────────────────────────────────────────
// Helpers used by the world builder and the server.
// ─────────────────────────────────────────────────────────────

/** World-space polygon for an island. */
export function islandPolygon(island) {
  return island.pixels.map(([px, py]) => toWorld(px, py));
}

/** Axis-aligned bounds of an island in world metres. */
export function islandBounds(island) {
  const pts = islandPolygon(island);
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

/** The island whose outline contains a world point, or null over water. */
export function islandAt(x, z) {
  for (const island of ISLANDS) {
    const pts = islandPolygon(island);
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]; const b = pts[j];
      if (((a.z > z) !== (b.z > z)) && (x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x)) inside = !inside;
    }
    if (inside) return island;
  }
  return null;
}

/** District whose centre is nearest a world point, within its radius. */
export function districtAt(x, z) {
  let best = null; let bestDist = Infinity;
  for (const d of DISTRICTS) {
    const p = toWorld(d.pixels[0], d.pixels[1]);
    const dist = Math.hypot(x - p.x, z - p.z);
    if (dist <= d.radius && dist < bestDist) { best = d; bestDist = dist; }
  }
  return best;
}

export const MAP_STATS = {
  islands: ISLANDS.length,
  bridges: BRIDGES.length,
  metroLines: METRO_LINES.length,
  metroStations: METRO_STATIONS.length,
  districts: DISTRICTS.length,
  factions: FACTIONS.length,
  missionPins: MISSION_PINS.length,
  sizeMetres: { w: 1400 * SCALE, d: 700 * SCALE },
};
