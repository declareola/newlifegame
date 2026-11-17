// server/config/utilityConfig.js
// The utilities behind a home: prepaid electricity, the water tank, cooking gas,
// and the eco-shell (solar) that cuts the grid draw.
//
// Everything here is priced and metered on the server. The client never sends a
// price and never sends a reading — it sends "top up 20 units of power" and the
// server decides what that costs and how many units arrive.
//
// Consumption is tied to the game clock, not to wall time: the day/night cycle
// runs one game hour every ~50 real seconds (see client/render/DayNight), so a
// house's daily load is spent in about twenty real minutes. That is what makes
// a meter something you notice rather than something you forget.

/** One game day passes in this many real seconds. */
export const REAL_SECONDS_PER_GAME_DAY = 20 * 60;

/** Game-time acceleration: game seconds per real second. */
export const GAME_TIME_SCALE = 86400 / REAL_SECONDS_PER_GAME_DAY; // 72

/**
 * Appliances. `watts` is the real draw; `litresPerDay` for water fixtures.
 * `defaultOn` is what the house does when nobody has touched it.
 */
export const appliances = [
  { id: 'lights',    label: 'Lights',            icon: '💡', watts: 120,  defaultOn: true,  hint: 'Every room' },
  { id: 'fridge',    label: 'Fridge / freezer',  icon: '🧊', watts: 150,  defaultOn: true,  hint: 'Runs all day' },
  { id: 'ac',        label: 'Air conditioner',   icon: '❄️', watts: 1200, defaultOn: false, hint: 'The big one' },
  { id: 'tv',        label: 'TV and decoder',    icon: '📺', watts: 180,  defaultOn: false },
  { id: 'pump',      label: 'Water pump',        icon: '🚰', watts: 550,  defaultOn: true,  hint: 'Keeps the tank full' },
  { id: 'security',  label: 'Security lights',   icon: '🔆', watts: 90,   defaultOn: true,  hint: 'Outside, all night' },
];

/**
 * Water: the tank and what draws from it. Bathing, laundry and cooking are the
 * three things you cannot do with an empty tank.
 */
export const water = {
  tankLitres: 1000,
  litresPerDay: {
    shower: 70,
    laundry: 90,
    cook: 20,
    toilet: 25,
  },
};

/** What you can buy, and what it costs. Prices are Lagos-plausible. */
export const powerBundles = [
  { id: 'small',  units: 20,  price: 4_400,  label: '20 units',  hint: 'A few days of lights and fridge' },
  { id: 'medium', units: 60,  price: 12_600, label: '60 units',  hint: 'A week with the AC on sometimes' },
  { id: 'large',  units: 150, price: 30_000, label: '150 units', hint: 'A month of normal use' },
];

export const waterBundles = [
  { id: 'tanker', litres: 1000, price: 3_500, label: '1,000 L tanker', hint: 'Fills the tank' },
];

export const gasBundles = [
  { id: 'refill', kg: 12.5, price: 6_800, label: '12.5 kg refill', hint: 'Cooking gas' },
];

/** Solar: a one-off purchase that cuts the grid draw. */
export const solar = {
  id: 'solar',
  name: 'Rooftop solar + inverter',
  price: 420_000,
  gridFactor: 0.4, // 60% of the load comes off the roof while it is installed
  hint: '60% off your meter reading, day and night',
};

export const utilityConfig = {
  appliances,
  water,
  powerBundles,
  waterBundles,
  gasBundles,
  solar,

  appliance(id) {
    return appliances.find((a) => a.id === id) || null;
  },

  /** Starting readings for a household that has just moved in. */
  defaults: {
    powerKwh: 40,
    waterLitres: 700,
    gasKg: 6,
    solar: false,
    appliances: Object.fromEntries(appliances.map((a) => [a.id, a.defaultOn])),
  },

  /** Electricity per game day, in kWh, for a given appliance state. */
  dailyKwh(applianceState, hasSolar) {
    let watts = 0;
    for (const a of appliances) if (applianceState?.[a.id]) watts += a.watts;
    const kwh = (watts * 24) / 1000;
    return hasSolar ? kwh * solar.gridFactor : kwh;
  },

  /** Litres per game day drawn by the fixtures that are in use. */
  dailyLitres() {
    return Object.values(water.litresPerDay).reduce((a, b) => a + b, 0);
  },
};
