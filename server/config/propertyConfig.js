// server/config/propertyConfig.js
// Housing market for NewLife. Players can BUY a property outright with cash,
// or RENT one by paying a deposit and then rent every rentPeriodMs of real time.
//
// Effects of having a home
// ------------------------
//  sleepBonus   — multiplies the POSITIVE effects of activities flagged
//                 `homeBonus: true` (sleep, shower). A 0.25 bonus means
//                 +60 energy from sleeping becomes +75.
//  comfortBonus — fraction by which the energy decay rate is reduced while
//                 a player lives somewhere. 0.20 = energy drains 20% slower.
//
// The server is authoritative: the client never decides prices, rent,
// or when a player is evicted.

// One "rent period" of real time. Renting a place costs rentPerPeriod every
// 30 real minutes. Chosen so that a hostel bed is affordable on a mid-tier
// wage (Tech Dev earns ₦5,000/hr ⇒ ₦2,500 per 30 min) while the high-end
// properties require a serious income.
export const RENT_PERIOD_MS = 30 * 60 * 1000;

import { PROPERTY_PLACEMENT, DISTRICTS } from './worldGeometry.js';

/**
 * Put every listing where its house actually stands.
 *
 * The catalogue below carries prices, rent and bonuses — the things that are a
 * design decision. It used to also carry `position` and `district`, typed in
 * for the old 200 m city, and they were never updated when the map became Eko
 * Basin: every purchasable home ended up with its front door in the lagoon and
 * with a district name that no longer exists ('victoria', not
 * 'victoria-island'). Placement is geography, so it is read from the generated
 * map instead, and `server/test-geometry.mjs` fails if the two disagree.
 */
function placeProperties(config) {
  for (const property of config.properties) {
    const place = PROPERTY_PLACEMENT[property.id];
    if (!place) continue;
    property.buildingId = place.buildingId;
    property.position = { x: place.x, z: place.z };
    property.district = place.district || property.district;
    const district = DISTRICTS.find((d) => d.id === property.district);
    property.districtName = district ? district.name : property.districtName;
  }
  return config;
}

export const propertyConfig = placeProperties({
  properties: [
    {
      id: 'hostel-bed',
      name: 'Hostel Bed',
      icon: '🛏️',
      district: 'mushin',
      districtName: 'Mushin',
      description:
        'A bunk in a shared room. Cheap, cramped, but it beats sleeping on the street.',
      position: { x: -22, z: 30 },
      size: { w: 6, d: 6, h: 6 },
      colour: 0xbdc3c7,
      signColour: 0x95a5a6,
      price: 150_000,
      deposit: 4_000,
      rentPerPeriod: 2_000,
      sleepBonus: 0.10,
      comfortBonus: 0.05,
    },
    {
      id: 'yaba-studio',
      name: 'Yaba Studio Flat',
      icon: '🏢',
      district: 'yaba',
      districtName: 'Yaba',
      description:
        'A self-contained studio near the tech hub. Small, but it has a proper bed and a shower that runs.',
      position: { x: 22, z: 28 },
      size: { w: 8, d: 8, h: 10 },
      colour: 0x5dade2,
      signColour: 0x3498db,
      price: 900_000,
      deposit: 12_000,
      rentPerPeriod: 6_000,
      sleepBonus: 0.25,
      comfortBonus: 0.12,
    },
    {
      id: 'vi-apartment',
      name: 'VI Apartment',
      icon: '🏙️',
      district: 'victoria',
      districtName: 'Victoria Island',
      description:
        'A serviced two-bedroom in the business district. Generator power, running water, the works.',
      position: { x: -24, z: -32 },
      size: { w: 10, d: 9, h: 16 },
      colour: 0xaf7ac5,
      signColour: 0x8e44ad,
      price: 3_500_000,
      deposit: 30_000,
      rentPerPeriod: 15_000,
      sleepBonus: 0.40,
      comfortBonus: 0.20,
    },
    {
      id: 'lekki-duplex',
      name: 'Lekki Duplex',
      icon: '🏘️',
      district: 'lekki',
      districtName: 'Lekki',
      description:
        'A four-bedroom duplex behind a gate with a security post. Quiet street, steady light.',
      position: { x: 24, z: -26 },
      size: { w: 10, d: 9, h: 12 },
      colour: 0x58d68d,
      signColour: 0x27ae60,
      price: 12_000_000,
      deposit: 80_000,
      rentPerPeriod: 40_000,
      sleepBonus: 0.60,
      comfortBonus: 0.30,
    },
    {
      id: 'waterfront-mansion',
      name: 'Waterfront Mansion',
      icon: '🏰',
      district: 'lekki',
      districtName: 'Lekki Waterfront',
      description:
        'Six bedrooms on the water. Staff quarters, a pool, and a view that ends conversations.',
      position: { x: 85, z: -70 },
      size: { w: 12, d: 10, h: 14 },
      colour: 0xf5cba7,
      signColour: 0xe67e22,
      price: 45_000_000,
      deposit: 240_000,
      rentPerPeriod: 120_000,
      sleepBonus: 0.90,
      comfortBonus: 0.45,
    },
  ],
});

// Quick lookup by id.
export const propertiesById = Object.fromEntries(
  propertyConfig.properties.map((p) => [p.id, p])
);

export function getProperty(id) {
  return propertiesById[id] || null;
}
