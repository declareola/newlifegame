// server/config/worldGeometry.js
// GENERATED FILE — do not edit by hand.
// Source: client/src/world/ekoWorld.js + client/src/world/ekoBasin.js
// Regenerate: node server/scripts/gen-geometry.mjs
//
// The server needs district and landmark positions for district visits, faction
// turf, the wanted matrix and mission placement. It cannot import the client's
// map modules directly (they pull in three.js), so this file is generated from
// them and checked for drift by server/test-geometry.mjs.

/** Regional districts, with the bitmap bit each one sets when visited. */
export const DISTRICTS = [
  {
    "id": "marina",
    "name": "Marina banking strip",
    "x": -138,
    "z": 102,
    "w": 18,
    "d": 18,
    "island": "core",
    "faction": "cartel",
    "bit": 32
  },
  {
    "id": "victoria-island",
    "name": "Victoria Island",
    "x": -192,
    "z": 78,
    "w": 16,
    "d": 16,
    "island": "core",
    "faction": "cartel",
    "bit": 4
  },
  {
    "id": "eko-atlantic",
    "name": "Eko Atlantic",
    "x": 60,
    "z": -36,
    "w": 24,
    "d": 24,
    "island": "core",
    "faction": "cartel",
    "bit": 64
  },
  {
    "id": "mushin",
    "name": "Mushin",
    "x": 258,
    "z": -66,
    "w": 16,
    "d": 16,
    "island": "mainland",
    "faction": "kings",
    "bit": 1
  },
  {
    "id": "surulere",
    "name": "Surulere",
    "x": 180,
    "z": 78,
    "w": 16,
    "d": 16,
    "island": "mainland",
    "faction": "kings",
    "bit": 128
  },
  {
    "id": "oshodi",
    "name": "Oshodi motor park",
    "x": 330,
    "z": 6,
    "w": 14,
    "d": 14,
    "island": "mainland",
    "faction": "kings",
    "bit": 256
  },
  {
    "id": "computer-village",
    "name": "Computer Village",
    "x": 282,
    "z": 108,
    "w": 12,
    "d": 12,
    "island": "mainland",
    "faction": "kings",
    "bit": 512
  },
  {
    "id": "mile-12",
    "name": "Mile 12 market",
    "x": 252,
    "z": 156,
    "w": 12,
    "d": 12,
    "island": "mainland",
    "faction": "kings",
    "bit": 1024
  },
  {
    "id": "apapa-wharf",
    "name": "Apapa wharf",
    "x": -120,
    "z": -132,
    "w": 14,
    "d": 14,
    "island": "docks",
    "faction": "syndicate",
    "bit": 2048
  },
  {
    "id": "tin-can",
    "name": "Tin Can port",
    "x": 108,
    "z": -162,
    "w": 16,
    "d": 16,
    "island": "docks",
    "faction": "syndicate",
    "bit": 4096
  },
  {
    "id": "ijora",
    "name": "Ijora substation",
    "x": -180,
    "z": -96,
    "w": 12,
    "d": 12,
    "island": "docks",
    "faction": "syndicate",
    "bit": 8192
  },
  {
    "id": "yaba",
    "name": "Yaba",
    "x": 306,
    "z": 48,
    "w": 20,
    "d": 20,
    "island": "mainland",
    "faction": "kings",
    "bit": 2
  },
  {
    "id": "lekki",
    "name": "Lekki",
    "x": 324,
    "z": 66,
    "w": 18,
    "d": 18,
    "island": "mainland",
    "faction": "kings",
    "bit": 8
  }
];

/** Landmarks the server validates proximity against. */
export const KEY_BUILDINGS = [
  {
    "id": "airport",
    "district": "mile-12",
    "x": 252,
    "z": 158.4,
    "w": 46,
    "d": 30,
    "h": 12
  },
  {
    "id": "atm",
    "district": "marina",
    "x": -131.9,
    "z": 94.8,
    "w": 2.4,
    "d": 2.4,
    "h": 3
  },
  {
    "id": "atm-kiosk",
    "district": "victoria-island",
    "x": -184.8,
    "z": 73.2,
    "w": 3.4,
    "d": 3.4,
    "h": 3.2
  },
  {
    "id": "bank",
    "district": "marina",
    "x": -142.8,
    "z": 99.6,
    "w": 16,
    "d": 10,
    "h": 22
  },
  {
    "id": "bus-park",
    "district": "oshodi",
    "x": 337.2,
    "z": 23.3,
    "w": 18,
    "d": 18,
    "h": 0.1
  },
  {
    "id": "church",
    "district": "marina",
    "x": -121.2,
    "z": 120,
    "w": 12,
    "d": 16,
    "h": 14
  },
  {
    "id": "clinic",
    "district": "victoria-island",
    "x": -206.4,
    "z": 97.2,
    "w": 10,
    "d": 8,
    "h": 7
  },
  {
    "id": "community-center",
    "district": "mushin",
    "x": 237.6,
    "z": -54,
    "w": 14,
    "d": 11,
    "h": 7
  },
  {
    "id": "dealership",
    "district": "victoria-island",
    "x": -175.2,
    "z": 62.8,
    "w": 20,
    "d": 14,
    "h": 8
  },
  {
    "id": "food-court",
    "district": "victoria-island",
    "x": -180,
    "z": 82.8,
    "w": 12,
    "d": 9,
    "h": 7
  },
  {
    "id": "fuel-station",
    "district": "mushin",
    "x": 267.6,
    "z": -70.8,
    "w": 16,
    "d": 12,
    "h": 6
  },
  {
    "id": "garage",
    "district": "mushin",
    "x": 246,
    "z": -75.6,
    "w": 14,
    "d": 11,
    "h": 7
  },
  {
    "id": "gym",
    "district": "victoria-island",
    "x": -169.2,
    "z": 94.5,
    "w": 13,
    "d": 11,
    "h": 9
  },
  {
    "id": "hospital",
    "district": "marina",
    "x": -170.7,
    "z": 117.6,
    "w": 20,
    "d": 16,
    "h": 20
  },
  {
    "id": "kiosk-construction",
    "district": "surulere",
    "x": 172.8,
    "z": 84,
    "w": 3.5,
    "d": 3,
    "h": 3
  },
  {
    "id": "kiosk-trader",
    "district": "computer-village",
    "x": 280.8,
    "z": 105.6,
    "w": 3.5,
    "d": 3,
    "h": 3
  },
  {
    "id": "market",
    "district": "oshodi",
    "x": 326.4,
    "z": 3.6,
    "w": 22,
    "d": 18,
    "h": 8
  },
  {
    "id": "mosque",
    "district": "victoria-island",
    "x": -213.6,
    "z": 82.8,
    "w": 14,
    "d": 12,
    "h": 16
  },
  {
    "id": "office-tower",
    "district": "marina",
    "x": -150,
    "z": 115.3,
    "w": 18,
    "d": 18,
    "h": 54
  },
  {
    "id": "police",
    "district": "mushin",
    "x": 274.8,
    "z": -54,
    "w": 15,
    "d": 12,
    "h": 12
  },
  {
    "id": "prop-hostel-bed",
    "district": "mushin",
    "x": 270,
    "z": 78,
    "w": 16,
    "d": 14,
    "h": 12
  },
  {
    "id": "prop-lekki-duplex",
    "district": "lekki",
    "x": 322.8,
    "z": 67.2,
    "w": 16,
    "d": 13,
    "h": 11
  },
  {
    "id": "prop-vi-apartment",
    "district": "victoria-island",
    "x": -196.9,
    "z": 72.7,
    "w": 16,
    "d": 14,
    "h": 32
  },
  {
    "id": "prop-waterfront-mansion",
    "district": "marina",
    "x": -280.8,
    "z": -14.4,
    "w": 22,
    "d": 16,
    "h": 10
  },
  {
    "id": "prop-yaba-studio",
    "district": "yaba",
    "x": 304.8,
    "z": 45.6,
    "w": 12,
    "d": 10,
    "h": 9
  },
  {
    "id": "public-bathroom",
    "district": "mushin",
    "x": 282,
    "z": -63.7,
    "w": 5,
    "d": 4,
    "h": 3
  },
  {
    "id": "pure-water",
    "district": "mushin",
    "x": 256.8,
    "z": -58.8,
    "w": 8,
    "d": 8,
    "h": 6
  },
  {
    "id": "pure-water-stand",
    "district": "surulere",
    "x": 188.4,
    "z": 87.6,
    "w": 4,
    "d": 4,
    "h": 3
  },
  {
    "id": "restaurant",
    "district": "surulere",
    "x": 151.2,
    "z": 90,
    "w": 10,
    "d": 8,
    "h": 6
  },
  {
    "id": "school",
    "district": "marina",
    "x": -164.4,
    "z": 133.3,
    "w": 16,
    "d": 12,
    "h": 10
  },
  {
    "id": "sport",
    "district": "tin-can",
    "x": 114,
    "z": -156,
    "w": 30,
    "d": 24,
    "h": 8
  },
  {
    "id": "supermarket",
    "district": "surulere",
    "x": 183.6,
    "z": 73.2,
    "w": 18,
    "d": 14,
    "h": 8
  },
  {
    "id": "tech-hub",
    "district": "victoria-island",
    "x": -196.8,
    "z": 86.4,
    "w": 14,
    "d": 10,
    "h": 28
  }
];

/** Standable points at each interactive counter (ATM, bank, market, ...). */
export const INTERACTION_ANCHORS = [
  {
    "id": "atm",
    "x": -131.9,
    "z": 97.6
  },
  {
    "id": "bank",
    "x": -142.8,
    "z": 93
  },
  {
    "id": "market",
    "x": 326.4,
    "z": 14.2
  },
  {
    "id": "food-court",
    "x": -180,
    "z": 88.9
  },
  {
    "id": "pure-water",
    "x": 256.8,
    "z": -53.2
  }
];

/** Where each purchasable home stands, keyed by property id. */
export const PROPERTY_PLACEMENT = {
  "hostel-bed": {
    "buildingId": "prop-hostel-bed",
    "x": 270,
    "z": 78,
    "district": "mushin"
  },
  "yaba-studio": {
    "buildingId": "prop-yaba-studio",
    "x": 304.8,
    "z": 45.6,
    "district": "yaba"
  },
  "vi-apartment": {
    "buildingId": "prop-vi-apartment",
    "x": -196.9,
    "z": 72.7,
    "district": "victoria-island"
  },
  "lekki-duplex": {
    "buildingId": "prop-lekki-duplex",
    "x": 322.8,
    "z": 67.2,
    "district": "lekki"
  },
  "waterfront-mansion": {
    "buildingId": "prop-waterfront-mansion",
    "x": -280.8,
    "z": -14.4,
    "district": "marina"
  }
};

/** Interior id → the id of the building it is inside ('in-market' → 'market'). */
export const INTERIOR_BUILDINGS = {
  "in-market": "market",
  "in-church": "church",
  "in-mosque": "mosque",
  "in-hospital": "hospital",
  "in-airport": "airport",
  "in-airfield": "airport",
  "in-supermarket": "supermarket",
  "in-bank": "bank",
  "in-school": "school",
  "in-tech-hub": "tech-hub",
  "in-police": "police",
  "in-clinic": "clinic",
  "in-pure-water": "pure-water",
  "in-fuel": "fuel-station",
  "in-dealership": "dealership",
  "in-garage": "garage",
  "in-restaurant": "restaurant",
  "in-office-tower": "office-tower",
  "in-gym": "gym",
  "in-food-court": "food-court",
  "in-community": "community-center"
};

/** The four landmasses and which faction holds each. */
export const ISLANDS = [
  {
    "id": "docks",
    "name": "The Industrial North",
    "faction": "syndicate"
  },
  {
    "id": "banana",
    "name": "Banana Island",
    "faction": "cartel"
  },
  {
    "id": "core",
    "name": "The Vertical Core",
    "faction": "cartel"
  },
  {
    "id": "mainland",
    "name": "The Outer Borough",
    "faction": "kings"
  }
];

/** The map's walkable extent, in world metres. */
export const WORLD_BOUNDS = {
  "minX": -398,
  "maxX": 399,
  "minZ": -204,
  "maxZ": 192
};

/** Where a new character wakes up. */
export const SPAWN = {
  "x": 151.2,
  "z": 96.5
};

/** The district a world point falls in, or null for open ground and water. */
export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (x >= d.x - d.w / 2 && x <= d.x + d.w / 2 && z >= d.z - d.d / 2 && z <= d.z + d.d / 2) return d;
  }
  return null;
}

/** The standable interaction point with this id ('bank', 'market', ...), or null. */
export function anchorById(id) {
  return INTERACTION_ANCHORS.find((a) => a.id === id) || null;
}

/** The landmark with this id, or null. */
export function buildingById(id) {
  return KEY_BUILDINGS.find((b) => b.id === id) || null;
}

/**
 * The district a player is standing in, honouring interiors.
 *
 * Inside a building the coordinates are room-local, so the district is the
 * district of the building; outdoors it is a simple point test.
 *
 * @param {{x:number,z:number}} worldPos the player's reported position
 * @param {string|null} interiorId the interior the player claims to be inside
 */
export function districtForPlayer(worldPos, interiorId) {
  if (interiorId) {
    const buildingId = INTERIOR_BUILDINGS[interiorId];
    const building = buildingId ? buildingById(buildingId) : null;
    if (building?.district) {
      return DISTRICTS.find((d) => d.id === building.district) || null;
    }
    // An interior whose building has no landmark row cannot be placed.
    return null;
  }
  return districtAt(worldPos.x, worldPos.z);
}

/** The faction that owns the district containing this point, or null. */
export function factionAt(x, z) {
  return districtAt(x, z)?.faction || null;
}
