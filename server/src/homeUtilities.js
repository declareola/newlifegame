// server/src/homeUtilities.js
// The meter, the tank, the gas bottle and the solar array.
//
// The rules this module keeps:
//   · the server owns every reading — the client never sends units
//   · readings drain with the game clock, in the game loop, so they are the same
//     for a player who is standing in the room and one who is not
//   · an empty meter really stops things: the activities that need power or
//     water refuse to start, with a message that says which utility ran out
//   · nothing here invents money: top-ups go through the same cash path as
//     every other purchase

import {
  getUtilitiesRow,
  createUtilitiesRow,
  updateUtilities,
  getUserById,
  updateCash,
} from './db.js';
import { withTransaction } from './db.js';
import { utilityConfig, GAME_TIME_SCALE } from '../config/utilityConfig.js';
import { EconomyError } from './economy.js';

/** How much of a utility an activity needs before it will start. */
const THRESHOLD = 0.05;

/** Normalise a row into the shape the client and the routes use. */
function present(row) {
  const appliances = { ...utilityConfig.defaults.appliances, ...safeJson(row.appliances) };
  const solar = !!row.solar;
  return {
    // Two places: a meter that only moves in whole tenths hides the real
    // draw over a short session, and then nobody can see it working.
    powerKwh: round(row.power_kwh, 2),
    waterLitres: Math.round(row.water_litres),
    gasKg: round(row.gas_kg, 2),
    solar,
    appliances,
    // What the house would use over a full game day at the current settings.
    dailyKwh: round(utilityConfig.dailyKwh(appliances, solar), 1),
    dailyLitres: utilityConfig.dailyLitres(),
    // Roughly how long the current readings last, in real minutes.
    powerDaysLeft: utilityConfig.dailyKwh(appliances, solar) > 0
      ? round(row.power_kwh / utilityConfig.dailyKwh(appliances, solar), 1) : null,
    waterDaysLeft: round(row.water_litres / utilityConfig.dailyLitres(), 1),
    gasDaysLeft: round(row.gas_kg / 0.4, 1),
  };
}

function safeJson(text) {
  try { return JSON.parse(text || '{}'); } catch { return {}; }
}

function round(n, dp) {
  const f = 10 ** dp;
  return Math.round(Number(n || 0) * f) / f;
}

/** sqlite's datetime('now') is UTC without a zone marker. */
function parseSqliteTime(text) {
  if (!text) return Date.now();
  const t = Date.parse(String(text).replace(' ', 'T') + 'Z');
  return Number.isFinite(t) ? t : Date.now();
}

/**
 * Bring the readings up to date.
 *
 * The meter has to drain the same way whether the player is standing in the
 * kitchen or has been logged out for an hour, so the drain is derived from the
 * time since the row was last written rather than from a live socket. Reading
 * is therefore what advances the meter, and no reading can ever be stale.
 *
 * @param {number} userId
 * @param {number} [now] for tests
 */
export function drainElapsed(userId, now = Date.now()) {
  const row = getUtilitiesRow(userId);
  if (!row) return null;
  const elapsedMs = Math.max(0, now - parseSqliteTime(row.updated_at));
  if (elapsedMs < 250) return row;
  // Nothing accrues beyond two real hours of absence; a fridge does not empty
  // itself while you are asleep, and a player should not return to a dead house.
  const capped = Math.min(elapsedMs, 2 * 60 * 60 * 1000);
  const gameSeconds = (capped / 1000) * GAME_TIME_SCALE;
  const u = present(row);
  const kwh = (u.dailyKwh * gameSeconds) / 86400;
  const litres = (u.dailyLitres * gameSeconds) / 86400;
  const gas = (0.4 * gameSeconds) / 86400;
  if (kwh < 0.001 && litres < 0.5 && gas < 0.001) return row;
  return updateUtilities(userId, {
    powerKwh: Math.max(0, row.power_kwh - kwh),
    waterLitres: Math.max(0, row.water_litres - litres),
    gasKg: Math.max(0, row.gas_kg - gas),
  });
}

/** The household row, created on first look for anyone who lives somewhere. */
export function getUtilities(userId) {
  const user = getUserById(userId);
  const hasHome = !!user?.home_property;
  let row = drainElapsed(userId) || getUtilitiesRow(userId);
  if (!row && hasHome) {
    const d = utilityConfig.defaults;
    row = createUtilitiesRow(userId, {
      powerKwh: d.powerKwh, waterLitres: d.waterLitres, gasKg: d.gasKg, appliances: d.appliances,
    });
  }
  if (!row) {
    // No home: readings are zero, and the UI says why.
    return { hasHome: false, ...present({ power_kwh: 0, water_litres: 0, gas_kg: 0, solar: 0, appliances: '{}' }) };
  }
  return { hasHome, ...present(row) };
}

/**
 * Buy a bundle of power, water or gas. The price is the server's, not the
 * client's, and the money moves before the reading does.
 */
export function topUp({ userId, kind, bundleId, gameLoop }) {
  const table = kind === 'power' ? utilityConfig.powerBundles
    : kind === 'water' ? utilityConfig.waterBundles
      : kind === 'gas' ? utilityConfig.gasBundles
        : null;
  if (!table) throw new EconomyError('You cannot top that up');
  const bundle = table.find((b) => b.id === bundleId);
  if (!bundle) throw new EconomyError('That is not one of the bundles on offer');

  const user = getUserById(userId);
  if (!user?.home_property) throw new EconomyError('You do not have a home to top up');
  getUtilities(userId); // make sure the row exists

  const cash = Number(user.cash) || 0;
  if (cash < bundle.price) throw new EconomyError('Not enough cash');

  const newCash = cash - bundle.price;
  withTransaction(() => {
    updateCash(userId, newCash);
    const row = getUtilitiesRow(userId);
    if (kind === 'power') updateUtilities(userId, { powerKwh: row.power_kwh + bundle.units });
    if (kind === 'water') updateUtilities(userId, { waterLitres: Math.min(utilityConfig.water.tankLitres, row.water_litres + bundle.litres) });
    if (kind === 'gas') updateUtilities(userId, { gasKg: row.gas_kg + bundle.kg });
  });
  if (gameLoop) gameLoop.setCash(userId, newCash);

  return { cash: newCash, utilities: getUtilities(userId), bundle };
}

/** Switch an appliance on or off. */
export function toggleAppliance(userId, applianceId) {
  const appliance = utilityConfig.appliance(applianceId);
  if (!appliance) throw new EconomyError('That is not an appliance in this house');
  if (!getUserById(userId)?.home_property) throw new EconomyError('You do not have a home');
  const current = getUtilities(userId);
  const appliances = { ...current.appliances, [applianceId]: !current.appliances[applianceId] };
  updateUtilities(userId, { appliances });
  return getUtilities(userId);
}

/** Buy the rooftop array. One purchase, permanent, cuts the grid draw. */
export function buySolar({ userId, gameLoop }) {
  const user = getUserById(userId);
  if (!user?.home_property) throw new EconomyError('You do not have a home to put panels on');
  const current = getUtilities(userId);
  if (current.solar) throw new EconomyError('You already have solar on that roof');
  const price = utilityConfig.solar.price;
  const cash = Number(user.cash) || 0;
  if (cash < price) throw new EconomyError('Not enough cash');

  const newCash = cash - price;
  withTransaction(() => {
    updateCash(userId, newCash);
    updateUtilities(userId, { solar: true });
  });
  if (gameLoop) gameLoop.setCash(userId, newCash);
  return { cash: newCash, utilities: getUtilities(userId) };
}

/**
 * Can this activity start here?
 * @returns {string|null} an error message, or null when it is fine
 */
export function blockReason(userId, utility) {
  if (!utility) return null;
  const u = getUtilities(userId);
  if (utility === 'power') {
    if (!u.hasHome) return 'That needs a home';
    if (u.powerKwh <= THRESHOLD) {
      return u.appliances?.fridge
        ? 'The meter is empty — top up the prepaid meter'
        : 'The meter is empty — top up the prepaid meter';
    }
    if (u.appliances?.fridge === false && u.appliances?.lights === false && u.appliances?.tv === false) {
      // Everything is off: the power is there, but nothing is switched on.
      return 'Nothing is switched on — turn on what you need first';
    }
    return null;
  }
  if (utility === 'water') {
    if (!u.hasHome) return 'That needs a home';
    if (u.waterLitres <= THRESHOLD) return 'The water tank is empty — order a tanker';
    return null;
  }
  if (utility === 'gas') {
    if (!u.hasHome) return 'That needs a home';
    if (u.gasKg <= THRESHOLD) return 'The gas bottle is empty — get a refill';
    return null;
  }
  return null;
}

/** What the client needs to render the utilities card. */
export function utilityCatalogue() {
  return {
    powerBundles: utilityConfig.powerBundles,
    waterBundles: utilityConfig.waterBundles,
    gasBundles: utilityConfig.gasBundles,
    solar: utilityConfig.solar,
    appliances: utilityConfig.appliances,
    tankLitres: utilityConfig.water.tankLitres,
  };
}
