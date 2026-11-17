// server/config/venueConfig.js
// What you can actually buy, and where.
//
// Until now the only shops in the game were three outdoor interaction points
// with a fixed basket of five items. Walking into a shop — or a market, or an
// airport — gave you a room full of furniture and nothing to do in it. This
// config is the other half of the fix: every venue that sells something says so
// here, with its own stock, prices and need effects.
//
// The server owns all of it. The client renders what it is given and posts a
// venue id + item id; it never sends a price.
//
// Keys are interior ids from client/src/world/interiorData.js. The player must
// be *inside* that interior (the client reports it with its position, and the
// server stores it per socket) for a purchase to be accepted — the same trust
// model the outdoor shop points already use for position.

/** Shared catalogue. Venues pick from it, so prices cannot drift between shops. */
const CATALOGUE = {
  // ── Groceries ──────────────────────────────────────────────
  'rice-5kg': {
    id: 'rice-5kg', name: 'Rice (5 kg)', icon: '🍚', price: 6500,
    description: 'A bag of long-grain rice. Feeds you for days.',
    effects: { hunger: 30 },
  },
  'beans-2kg': {
    id: 'beans-2kg', name: 'Beans (2 kg)', icon: '🫘', price: 3200,
    description: 'Brown beans, the backbone of a Nigerian kitchen.',
    effects: { hunger: 25 },
  },
  'tomatoes-basket': {
    id: 'tomatoes-basket', name: 'Tomatoes & Peppers', icon: '🍅', price: 1800,
    description: 'A basket of tatashe, rodo and fresh tomatoes.',
    effects: { hunger: 12, hygiene: 2 },
  },
  'plantain-bunch': {
    id: 'plantain-bunch', name: 'Plantain Bunch', icon: '🍌', price: 1500,
    description: 'Ripe plantain. Fry it or roast it.',
    effects: { hunger: 20 },
  },
  'bread-loaf': {
    id: 'bread-loaf', name: 'Agege Bread', icon: '🍞', price: 1200,
    description: 'Soft, warm, still in the paper.',
    effects: { hunger: 22 },
  },
  'milk-carton': {
    id: 'milk-carton', name: 'Milk (1 L)', icon: '🥛', price: 2400,
    description: 'Cold evaporated milk.',
    effects: { hunger: 10, energy: 8 },
  },
  'bottled-water': {
    id: 'bottled-water', name: 'Bottled Water', icon: '💧', price: 300,
    description: 'Cold water. Sorts out your bladder.',
    effects: { bladder: 20 },
  },
  'soft-drink': {
    id: 'soft-drink', name: 'Chilled Soft Drink', icon: '🥤', price: 500,
    description: 'Straight out of the chiller case.',
    effects: { bladder: 10, energy: 10, fun: 4 },
  },
  'energy-drink': {
    id: 'energy-drink', name: 'Energy Drink', icon: '⚡', price: 1200,
    description: 'Sweet, cold and full of caffeine.',
    effects: { energy: 25 },
  },

  // ── Household ──────────────────────────────────────────────
  'soap-kit': {
    id: 'soap-kit', name: 'Soap & Towel', icon: '🧼', price: 900,
    description: 'A wash kit for when you cannot get home.',
    effects: { hygiene: 20 },
  },
  'detergent': {
    id: 'detergent', name: 'Detergent', icon: '🧴', price: 1400,
    description: 'Keeps the flat, and you, presentable.',
    effects: { hygiene: 12 },
  },
  'toothpaste': {
    id: 'toothpaste', name: 'Toothpaste', icon: '🪥', price: 700,
    description: 'Mint. Non-negotiable.',
    effects: { hygiene: 6, social: 4 },
  },
  'cooking-gas': {
    id: 'cooking-gas', name: 'Cooking Gas Refill', icon: '🔥', price: 8500,
    description: 'So the kitchen actually works.',
    effects: { hunger: 15 },
  },
  'phone-credit': {
    id: 'phone-credit', name: 'Phone Credit', icon: '📱', price: 1000,
    description: 'Airtime. Call your people.',
    effects: { social: 18, fun: 6 },
  },
  'power-unit': {
    id: 'power-unit', name: 'Prepaid Power Unit', icon: '🔌', price: 3000,
    description: 'NEPA credit for the meter.',
    effects: { energy: 6, fun: 6 },
  },

  // ── Prepared food ──────────────────────────────────────────
  'jollof': {
    id: 'jollof', name: 'Jollof Rice', icon: '🍚', price: 1500,
    description: 'A plate of party jollof with chicken.',
    effects: { hunger: 35 },
  },
  'suya': {
    id: 'suya', name: 'Suya', icon: '🍢', price: 2000,
    description: 'Spicy grilled beef. Fills you up and lifts your mood.',
    effects: { hunger: 25, fun: 8 },
  },
  'puff-puff': {
    id: 'puff-puff', name: 'Puff-Puff (6)', icon: '🍩', price: 600,
    description: 'Hot, sweet, straight from the fryer.',
    effects: { hunger: 12, fun: 6 },
  },
  'meat-pie': {
    id: 'meat-pie', name: 'Meat Pie', icon: '🥟', price: 800,
    description: 'Flaky pastry, minced beef, potato.',
    effects: { hunger: 18 },
  },
  'espresso': {
    id: 'espresso', name: 'Espresso', icon: '☕', price: 1500,
    description: 'Airport price. Airport quality, to be fair.',
    effects: { energy: 20, fun: 4 },
  },

  // ── Airport ────────────────────────────────────────────────
  'duty-perfume': {
    id: 'duty-perfume', name: 'Duty-Free Perfume', icon: '🧴', price: 24000,
    description: 'Cheaper past security. That is the point of the place.',
    effects: { hygiene: 15, social: 20, fun: 12 },
  },
  'duty-chocolate': {
    id: 'duty-chocolate', name: 'Duty-Free Chocolate', icon: '🍫', price: 4500,
    description: 'Imported. Sweet.',
    effects: { hunger: 15, fun: 10 },
  },
  'travel-pillow': {
    id: 'travel-pillow', name: 'Travel Pillow', icon: '🛏️', price: 6000,
    description: 'For the flight, and for sleeping badly.',
    effects: { energy: 8, fun: 4 },
  },
  'flight-snack': {
    id: 'flight-snack', name: 'Cabin Snack Box', icon: '🥪', price: 2500,
    description: 'The little box they hand out at cruise.',
    effects: { hunger: 20 },
  },

  // ── Market ─────────────────────────────────────────────────
  // ── The pharmacy counter ───────────────────────────────────
  'painkillers': {
    id: 'painkillers', name: 'Paracetamol', icon: '\u{1F48A}', price: 800,
    description: 'A blister pack. Takes the edge off.',
    effects: { energy: 10 },
  },
  'malaria-tabs': {
    id: 'malaria-tabs', name: 'Malaria tablets', icon: '\u{1F9EA}', price: 4500,
    description: 'The full dose. Bitter, but it works.',
    effects: { energy: 25, hunger: -4 },
  },
  'ors-sachet': {
    id: 'ors-sachet', name: 'ORS sachet', icon: '\u{1F4E6}', price: 500,
    description: 'Oral rehydration salts. Drink it slowly.',
    effects: { hunger: 8, energy: 8 },
  },
  'first-aid-kit': {
    id: 'first-aid-kit', name: 'First aid kit', icon: '\u{1FA79}', price: 3500,
    description: 'Plasters, gauze, antiseptic. Keep it at home.',
    effects: { hygiene: 10, energy: 6 },
  },
  // ── The garage parts counter ───────────────────────────────
  'engine-oil': {
    id: 'engine-oil', name: 'Engine oil (4 L)', icon: '\u{1F6E2}\u{FE0F}', price: 12000,
    description: 'For the next service. Or a friend who needs it.',
    effects: {},
  },
  'spare-tyre': {
    id: 'spare-tyre', name: 'Spare tyre', icon: '\u{1F6DE}', price: 28000,
    description: 'A used but sound tyre. Lagos roads eat them.',
    effects: {},
  },
  'jump-leads': {
    id: 'jump-leads', name: 'Jump leads', icon: '\u{1F50C}', price: 6500,
    description: 'Because a flat battery always happens at night.',
    effects: {},
  },

  'yam-tuber': {
    id: 'yam-tuber', name: 'Yam Tubers (3)', icon: '🍠', price: 2200,
    description: 'Pounded yam starts here.',
    effects: { hunger: 26 },
  },
  'garri-bag': {
    id: 'garri-bag', name: 'Garri (2 kg)', icon: '🥣', price: 1600,
    description: 'Cassava flakes. Add water, groundnut, sugar.',
    effects: { hunger: 20, energy: 8 },
  },
  'palm-oil': {
    id: 'palm-oil', name: 'Palm Oil (1 L)', icon: '🫗', price: 2800,
    description: 'Red, thick, and in every stew.',
    effects: { hunger: 10 },
  },
  'fish-smoked': {
    id: 'fish-smoked', name: 'Smoked Catfish', icon: '🐟', price: 3500,
    description: 'Wrapped in newspaper.',
    effects: { hunger: 24 },
  },
};

/**
 * Which venue (interior id) sells what.
 *
 * `type` drives the client's shop panel wording. `stock` is the full catalogue
 * shown in the panel; an item not listed cannot be bought here at any price.
 */
export const venueConfig = {
  venues: {
    // ── Supermarkets and provision shops ──
    'in-supermarket': {
      name: 'Surulere Supermarket',
      type: 'supermarket',
      stock: [
        'rice-5kg', 'beans-2kg', 'tomatoes-basket', 'plantain-bunch', 'bread-loaf',
        'milk-carton', 'bottled-water', 'soft-drink', 'energy-drink', 'soap-kit',
        'detergent', 'toothpaste', 'cooking-gas', 'phone-credit', 'power-unit',
        'meat-pie', 'puff-puff',
      ],
    },
    'in-market': {
      name: 'Oshodi Market Hall',
      type: 'market',
      stock: [
        'yam-tuber', 'garri-bag', 'palm-oil', 'fish-smoked', 'tomatoes-basket',
        'plantain-bunch', 'beans-2kg', 'rice-5kg', 'bottled-water', 'jollof',
      ],
    },
    'in-kiosk': {
      name: 'Provision Kiosk',
      type: 'kiosk',
      stock: ['bottled-water', 'soft-drink', 'bread-loaf', 'phone-credit', 'soap-kit', 'puff-puff'],
    },
    'in-fuel-shop': {
      name: 'Fuel Station Shop',
      type: 'convenience',
      stock: ['bottled-water', 'soft-drink', 'energy-drink', 'meat-pie', 'phone-credit', 'soap-kit'],
    },
    'in-food-court': {
      name: 'Food Court',
      type: 'restaurant',
      stock: ['jollof', 'suya', 'puff-puff', 'meat-pie', 'soft-drink', 'bottled-water'],
    },
    'in-suya': {
      name: 'Suya Spot',
      type: 'restaurant',
      stock: ['suya', 'bottled-water', 'soft-drink', 'energy-drink'],
    },

    // ── Shops that had a counter but nothing behind it ──
    // Every one of these interiors already had a "shop" station in the client;
    // the server simply had no entry for it, so pressing the button answered
    // "That place does not sell anything". A station that cannot complete is
    // worse than no station, so they now have stock of their own.
    'in-pure-water': {
      name: 'Pure Water Depot',
      type: 'kiosk',
      stock: ['bottled-water', 'bottled-water', 'soft-drink', 'energy-drink'],
    },
    'in-restaurant': {
      name: 'Suya Spot Kitchen',
      type: 'restaurant',
      stock: ['jollof', 'suya', 'puff-puff', 'meat-pie', 'bottled-water', 'soft-drink'],
    },
    'in-dealership': {
      name: 'Car Dealer — Parts Counter',
      type: 'convenience',
      stock: ['phone-credit', 'bottled-water', 'energy-drink', 'soap-kit'],
    },
    // The forecourt shop. The interior is `in-fuel`; the shop id keeps the
    // older `in-fuel-shop` name so existing saves and links still resolve.
    'in-fuel': {
      name: 'Fuel Station Shop',
      type: 'convenience',
      stock: ['bottled-water', 'soft-drink', 'energy-drink', 'meat-pie', 'phone-credit', 'soap-kit'],
    },

    // ── Where the medicine and the parts are ──
    'in-hospital': {
      name: 'LUTH Pharmacy',
      type: 'pharmacy',
      stock: ['painkillers', 'malaria-tabs', 'ors-sachet', 'first-aid-kit', 'bottled-water'],
    },
    'in-clinic': {
      name: 'Clinic Dispensary',
      type: 'pharmacy',
      stock: ['painkillers', 'ors-sachet', 'malaria-tabs'],
    },
    'in-garage': {
      name: 'Workshop Parts Counter',
      type: 'convenience',
      stock: ['engine-oil', 'spare-tyre', 'jump-leads', 'phone-credit'],
    },

    // ── The airport ──
    'in-airport': {
      name: 'MMIA — Landside',
      type: 'airport',
      stock: ['espresso', 'meat-pie', 'bottled-water', 'phone-credit', 'travel-pillow'],
    },
    // Reachable from the terminal's departures hall, where the concourse shop
    // sits in a real airport.
    'in-airport-concourse': {
      name: 'MMIA — Duty Free',
      type: 'duty-free',
      stock: [
        'duty-perfume', 'duty-chocolate', 'travel-pillow', 'flight-snack',
        'espresso', 'bottled-water', 'phone-credit',
      ],
    },
  },
};

/** Look up a venue's shop, or null if it does not sell anything. */
export function getVenueShop(venueId) {
  return venueConfig.venues[venueId] || null;
}

/** Resolve one catalogue item. */
export function getVenueItem(itemId) {
  return CATALOGUE[itemId] || null;
}

/** The full stock list for a venue, as objects (client-facing). */
export function getVenueStock(venueId) {
  const shop = getVenueShop(venueId);
  if (!shop) return [];
  return shop.stock.map((id) => CATALOGUE[id]).filter(Boolean);
}

/** Every venue that sells something, for the client's directory. */
export function listVenues() {
  return Object.entries(venueConfig.venues).map(([id, v]) => ({
    id,
    name: v.name,
    type: v.type,
    items: v.stock.length,
  }));
}

/**
 * Every item in the shop catalogue, as an array.
 *
 * Used by the inventory catalogue so that goods bought or lifted in a shop have
 * an inventory entry to live in (see config/itemConfig.js).
 */
export function allVenueItems() {
  return Object.values(CATALOGUE);
}
