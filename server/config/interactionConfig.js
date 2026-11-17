// server/config/interactionConfig.js
// Step 10 — walk-up interactions: banking and shops.
//
// Each point sits in the world at a fixed spot with a radius. The server
// checks the player's own reported position against that radius, so a
// modified client cannot bank or shop from across the map.
//
// Positions are NOT written here. They are generated from the map
// (config/worldGeometry.js → INTERACTION_ANCHORS), which is the same data the
// client walks to. They used to be hard-coded; when the city was replaced with
// Eko Basin those coordinates ended up in the lagoon, and every bank and shop
// refused with "Too far away" while the marker sat on the pavement.

import { anchorById } from './worldGeometry.js';

/** Anchor for a counter, falling back to a safe spot rather than (0,0). */
function at(anchorId) {
  const a = anchorById(anchorId);
  if (!a) throw new Error(`interactionConfig: no map anchor for '${anchorId}'`);
  return { x: a.x, z: a.z };
}

export const interactionConfig = {
  // How close (in world units) a player must be to use a point.
  defaultRadius: 7,

  points: [
    {
      id: 'atm-centre',
      name: 'ATM',
      icon: '🏧',
      type: 'bank',
      district: 'marina',
      position: at('atm'),
      radius: 6,
    },
    {
      id: 'bank-vi',
      name: 'Bank',
      icon: '🏦',
      type: 'bank',
      district: 'marina',
      position: at('bank'),
      radius: 8,
    },
    {
      id: 'market-mushin',
      name: 'Mushin Market',
      icon: '🛒',
      type: 'shop',
      district: 'oshodi',
      position: at('market'),
      radius: 9,
    },
    {
      id: 'food-court-shop',
      name: 'Food Court',
      icon: '🍲',
      type: 'shop',
      district: 'victoria-island',
      position: at('food-court'),
      radius: 7,
    },
    {
      id: 'pure-water-shop',
      name: 'Pure Water Kiosk',
      icon: '💧',
      type: 'shop',
      district: 'mushin',
      position: at('pure-water'),
      radius: 6,
    },
  ],

  // Items sold at every shop point. `effects` are applied to needs by the
  // server the moment the purchase succeeds — buying food feeds you.
  shopItems: [
    {
      id: 'jollof',
      name: 'Jollof Rice',
      icon: '🍚',
      price: 1500,
      description: 'A plate of party jollof. Restores hunger.',
      effects: { hunger: 35 },
    },
    {
      id: 'suya',
      name: 'Suya',
      icon: '🍢',
      price: 2000,
      description: 'Spicy grilled beef. Fills you up and lifts your mood.',
      effects: { hunger: 25, fun: 8 },
    },
    {
      id: 'bottled-water',
      name: 'Bottled Water',
      icon: '💧',
      price: 300,
      description: 'Cold water. Sorts out your bladder.',
      effects: { bladder: 20 },
    },
    {
      id: 'energy-drink',
      name: 'Energy Drink',
      icon: '🥤',
      price: 1200,
      description: 'Sweet, cold, and full of caffeine.',
      effects: { energy: 25 },
    },
    {
      id: 'soap-kit',
      name: 'Soap & Towel',
      icon: '🧼',
      price: 900,
      description: 'A quick wash kit for when you cannot get home.',
      effects: { hygiene: 20 },
    },
  ],

  // Banking limits
  minBankAmount: 100,
};

export function getInteractionPoint(id) {
  return interactionConfig.points.find((p) => p.id === id) || null;
}

export function getShopItem(id) {
  return interactionConfig.shopItems.find((i) => i.id === id) || null;
}
