// server/config/itemConfig.js
// Consumable and durable items.
//
// Prices are what shops charge; `sellFor` is what a shop pays. Effects are
// applied server-side only — the client can ask to use an item, never to be
// granted its effect directly.

import { allVenueItems } from './venueConfig.js';

/**
 * Every item sold by any venue, deduplicated by id.
 * @returns {Array<object>}
 */
function venueCatalogueItems() {
  return typeof allVenueItems === 'function' ? allVenueItems() : [];
}

export const itemConfig = {
  items: [
    {
      id: 'jollof',
      name: 'Jollof Rice',
      description: 'A plate of party jollof. Restores a lot of hunger.',
      price: 1500,
      sellFor: 600,
      category: 'food',
      effects: { hunger: 35, fun: 3 },
      useText: 'You eat the jollof. Tastes like a wedding.',
    },
    {
      id: 'suya',
      name: 'Suya',
      description: 'Spicy grilled beef wrapped in newspaper.',
      price: 1200,
      sellFor: 500,
      category: 'food',
      effects: { hunger: 28, fun: 5 },
      useText: 'The suya is peppery. You feel alive.',
    },
    {
      id: 'water',
      name: 'Pure Water',
      description: 'Sachet water. Cheap, cold, effective.',
      price: 200,
      sellFor: 60,
      category: 'drink',
      effects: { hunger: 4, hygiene: 2 },
      useText: 'You drink the water.',
    },
    {
      id: 'energy-drink',
      name: 'Energy Drink',
      description: 'Tastes like battery acid. Wakes you right up.',
      price: 800,
      sellFor: 300,
      category: 'drink',
      effects: { energy: 25 },
      useText: 'You down the energy drink. Your hands are shaking.',
    },
    {
      id: 'soap',
      name: 'Bar Soap',
      description: 'Use it anywhere to freshen up.',
      price: 500,
      sellFor: 180,
      category: 'hygiene',
      effects: { hygiene: 30 },
      useText: 'You wash up properly.',
    },
    {
      id: 'phone',
      name: 'Tokunbo Phone',
      description: 'A second-hand phone. Calling people lifts your mood.',
      price: 18000,
      sellFor: 7000,
      category: 'durable',
      effects: { social: 15, fun: 8 },
      consumable: false,
      useText: 'You call a friend and gist for a while.',
    },
    {
      id: 'fuel-can',
      name: 'Jerrycan of Fuel',
      description: 'Petrol for when the tank runs dry.',
      price: 4000,
      sellFor: 1500,
      category: 'vehicle',
      effects: {},
      useText: 'You pour the fuel into the tank.',
    },
  ],

  get(id) {
    return this.items.find((i) => i.id === id) || null;
  },
};

// ── Shop goods are inventory goods too ───────────────────────
// The shops sell from a separate catalogue (config/venueConfig.js: phone credit,
// bottled water, rice, soap...). Buying one there consumes it on the spot, so
// the two catalogues never had to meet. Shoplifting broke that assumption: the
// goods went into the player's bag under an id the inventory had never heard of,
// so they arrived and were then filtered straight back out — a theft that paid
// in nothing.
//
// Rather than keep a second list in sync by hand, every venue item that has no
// inventory entry is registered here at load. Nothing is invented: name, icon,
// price, description and effects all come from the venue catalogue; only the
// resale value and the use text are derived (40% resale, like the rest).
{
  const known = new Set(itemConfig.items.map((i) => i.id));
  const venueCatalogue = venueCatalogueItems();
  for (const item of venueCatalogue) {
    if (known.has(item.id)) continue;
    itemConfig.items.push({
      id: item.id,
      name: item.name,
      icon: item.icon,
      description: item.description || '',
      price: item.price,
      sellFor: Math.max(50, Math.round((item.price || 0) * 0.4)),
      category: 'goods',
      effects: item.effects || {},
      useText: `You use the ${item.name.toLowerCase()}.`,
    });
    known.add(item.id);
  }
}
