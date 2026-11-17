// server/src/wanted.js
// Per-faction wanted levels: the state behind the stars.
//
// The blueprint's Part H asks for a 3 × 4 matrix — three factions, four tiers —
// where what you do in one faction's turf does not follow you into another's.
// This module is the whole of that state: it is written by the crime routes,
// decayed by the game loop, read by the HUD, and it is what the service refusal
// and the arrest are actually keyed on.
//
// Nothing here trusts the client. A route hands in "the player broke into this
// property"; this module decides whether that was really a crime, who owns the
// district, and how many stars it is worth.

import { db, withTransaction, getUserById, updateCash } from './db.js';
import {
  FACTIONS, CRIMES, MAX_STARS, tierFor, responseFor,
  factionForDistrict, bribePrice, ARREST_FINE, DECAY_MINUTES_PER_STAR, POLICE_STATION,
} from '../config/factionConfig.js';

// Re-exported so a route can validate a crime or a faction without importing the
// config module separately.
export { CRIMES, FACTIONS };

/** One row per (user, faction) that has ever been anything but clean. */
function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wanted (
      user_id       INTEGER NOT NULL,
      faction_id    TEXT NOT NULL,
      stars         INTEGER NOT NULL DEFAULT 0,
      last_crime_at TEXT,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, faction_id)
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_wanted_user ON wanted(user_id);');
}
ensureTable();

function rowsFor(userId) {
  return db.prepare('SELECT * FROM wanted WHERE user_id = ?').all(userId);
}

function rowFor(userId, factionId) {
  return db.prepare('SELECT * FROM wanted WHERE user_id = ? AND faction_id = ?').get(userId, factionId);
}

/**
 * Minutes of clean behaviour still owed before the next star comes off.
 * Shown in the HUD so decay is visible rather than magic.
 */
function minutesToDecay(row) {
  if (!row || row.stars <= 0 || !row.last_crime_at) return null;
  const last = Date.parse(`${row.last_crime_at.replace(' ', 'T')}Z`);
  if (!Number.isFinite(last)) return null;
  const dueAt = last + DECAY_MINUTES_PER_STAR * 60_000;
  const left = Math.max(0, Math.round((dueAt - Date.now()) / 60_000));
  return { minutesLeft: left, dueAt: new Date(dueAt).toISOString() };
}

/**
 * Apply time-based decay for one faction row.
 *
 * Stars come off one at a time, {@link DECAY_MINUTES_PER_STAR} minutes apart,
 * counted from the last crime. Decay is computed on read rather than on a timer
 * so it is correct whether or not the game loop was running.
 */
function decayedStars(row) {
  if (!row || row.stars <= 0 || !row.last_crime_at) return { stars: 0, lastCrimeAt: row?.last_crime_at };
  const last = Date.parse(`${row.last_crime_at.replace(' ', 'T')}Z`);
  if (!Number.isFinite(last)) return { stars: row.stars, lastCrimeAt: row.last_crime_at };
  const elapsedMin = (Date.now() - last) / 60_000;
  const steps = Math.floor(elapsedMin / DECAY_MINUTES_PER_STAR);
  return { stars: Math.max(0, row.stars - steps), lastCrimeAt: row.last_crime_at };
}

/**
 * The full matrix for a player, in the shape the HUD and the map want.
 * All three factions are always present, even at zero, so the UI never has to
 * guess whether a missing faction means "clean" or "no data".
 */
export function getWanted(userId) {
  const rows = new Map(rowsFor(userId).map((r) => [r.faction_id, r]));
  const factions = Object.values(FACTIONS).map((f) => {
    const row = rows.get(f.id);
    const { stars } = decayedStars(row);
    const tier = tierFor(stars);
    return {
      id: f.id,
      name: f.name,
      short: f.short,
      hex: f.hex,
      islands: f.islands,
      stars,
      tier: tier.id,
      label: tier.label,
      response: tier.response,
      police: f.police,
      // What the tier does to you, in the server's terms.
      refuseService: responseFor(stars).refuseService,
      arrestOnSight: responseFor(stars).arrestOnSight,
      bribePrice: bribePrice(f.id, stars),
      decay: minutesToDecay({ ...row, stars }),
    };
  });

  const hottest = factions.reduce((a, b) => (b.stars > a.stars ? b : a), factions[0]);
  return {
    factions,
    // The single number the HUD badge shows: the worst heat you are carrying.
    maxStars: hottest ? hottest.stars : 0,
    maxFaction: hottest ? hottest.id : null,
    max: MAX_STARS,
  };
}

/** Stars with one faction. */
export function starsFor(userId, factionId) {
  return decayedStars(rowFor(userId, factionId)).stars;
}

/** The faction that owns a district, or null. */
export function factionOfDistrict(districtId) {
  return factionForDistrict(districtId);
}

/**
 * Is this player hunted enough that the district's owners refuse them service?
 * Used by the venue and shop routes, so the consequence is real.
 */
export function serviceRefused(userId, districtId) {
  const faction = factionForDistrict(districtId);
  if (!faction) return { refused: false, faction: null, stars: 0 };
  const stars = starsFor(userId, faction);
  const response = responseFor(stars);
  return {
    refused: response.refuseService,
    faction,
    factionName: FACTIONS[faction]?.short || faction,
    stars,
    response: tierFor(stars).response,
  };
}

/**
 * Record a crime.
 *
 * @param {object} o
 * @param {number} o.userId
 * @param {string} o.crime        key of CRIMES
 * @param {string} [o.districtId] where it happened — decides who cares
 * @param {string} [o.factionId]  explicit faction (overrides the district)
 * @returns {{stars:number, faction:string, tier:string, raised:number}}
 */
export function recordCrime({ userId, crime, districtId, factionId }) {
  const def = CRIMES[crime];
  if (!def) throw new Error(`Unknown crime: ${crime}`);

  const faction = factionId || factionForDistrict(districtId);
  if (!faction || !FACTIONS[faction]) {
    // Neutral ground: no faction is watching, so nothing escalates. This is
    // deliberate — not every crime should summon a response.
    return { stars: 0, faction: null, tier: 'clean', raised: 0, ignored: true };
  }

  const before = starsFor(userId, faction);
  const after = Math.min(MAX_STARS, before + def.weight);
  const raised = after - before;

  db.prepare(`
    INSERT INTO wanted (user_id, faction_id, stars, last_crime_at, updated_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, faction_id) DO UPDATE SET
      stars = excluded.stars,
      last_crime_at = excluded.last_crime_at,
      updated_at = excluded.updated_at
  `).run(userId, faction, after);

  return {
    stars: after,
    faction,
    factionName: FACTIONS[faction].short,
    tier: tierFor(after).id,
    tierLabel: tierFor(after).label,
    response: tierFor(after).response,
    raised,
    crime: def.label,
  };
}

/**
 * Pay a faction to forget you. The money is taken first, then the stars drop.
 * @returns {{paid:number, cash:number, faction:string, stars:number}}
 */
export function payBribe({ userId, factionId, gameLoop }) {
  if (!FACTIONS[factionId]) throw new Error('That is not a faction');
  const stars = starsFor(userId, factionId);
  if (stars <= 0) throw new Error(`The ${FACTIONS[factionId].short} have no interest in you`);

  const price = bribePrice(factionId, stars);
  const user = getUserById(userId);
  const cash = Number(user?.cash) || 0;
  if (cash < price) throw new Error(`That costs ₦${price.toLocaleString('en-NG')} and you cannot cover it`);

  const newCash = cash - price;
  withTransaction(() => {
    updateCash(userId, newCash);
    db.prepare(`
      UPDATE wanted SET stars = 0, last_crime_at = NULL, updated_at = datetime('now')
      WHERE user_id = ? AND faction_id = ?
    `).run(userId, factionId);
  });
  if (gameLoop) gameLoop.setCash(userId, newCash);

  return { paid: price, cash: newCash, faction: factionId, stars: 0 };
}

/**
 * Arrest: the 4★ consequence.
 *
 * Takes a fine, clears every faction's interest in the player, and returns the
 * spot they wake up at. The route that calls this is responsible for moving
 * them, because position lives with the multiplayer/game-loop state, not here.
 */
export function arrest({ userId, gameLoop }) {
  const user = getUserById(userId);
  const cash = Number(user?.cash) || 0;
  const fine = Math.min(ARREST_FINE.max, Math.max(ARREST_FINE.min, Math.round(cash * ARREST_FINE.fraction)));
  const newCash = Math.max(0, cash - fine);

  withTransaction(() => {
    updateCash(userId, newCash);
    db.prepare('DELETE FROM wanted WHERE user_id = ?').run(userId);
  });
  if (gameLoop) gameLoop.setCash(userId, newCash);

  return {
    fine,
    cash: newCash,
    station: POLICE_STATION,
    message: `Taken in. ₦${fine.toLocaleString('en-NG')} fine, and every faction has forgotten you.`,
  };
}

/**
 * Should entering this district get the player arrested?
 * Called when a player moves; cheap (one indexed read per faction).
 */
export function arrestWarrant(userId, districtId) {
  const faction = factionForDistrict(districtId);
  if (!faction) return { warrant: false };
  const stars = starsFor(userId, faction);
  const response = responseFor(stars);
  if (!response.arrestOnSight) return { warrant: false, faction, stars };
  return {
    warrant: true,
    faction,
    factionName: FACTIONS[faction].short,
    stars,
    response: tierFor(stars).response,
  };
}

/** Wipe a player's heat — used by tests and by the admin/clean-db tooling. */
export function clearWanted(userId) {
  db.prepare('DELETE FROM wanted WHERE user_id = ?').run(userId);
}

/** Leaderboard of heat, for the world feed. */
export function mostWanted(limit = 5) {
  return db.prepare(`
    SELECT w.user_id AS userId, u.username, w.faction_id AS faction, w.stars
    FROM wanted w JOIN users u ON u.id = w.user_id
    WHERE w.stars > 0
    ORDER BY w.stars DESC, w.updated_at DESC
    LIMIT ?
  `).all(limit);
}
