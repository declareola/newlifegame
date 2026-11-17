import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { needsConfig } from '../config/needsConfig.js';
import { jobConfig } from '../config/jobConfig.js';
import { activityConfig } from '../config/activityConfig.js';
import {
  propertyConfig,
  getProperty,
  RENT_PERIOD_MS,
} from '../config/propertyConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB_PATH lets you point the server at a different file — handy for tests
// and for mounting a persistent volume in production.
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'newlife.db');

const dataDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
export const db = new Database(dbPath);

// WAL mode for better read/write concurrency
db.pragma('journal_mode = WAL');

// ── Migrations ──────────────────────────────────────────────────
export function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      tier          TEXT NOT NULL DEFAULT 'middle',
      cash          REAL NOT NULL DEFAULT 0,
      bank_balance  REAL NOT NULL DEFAULT 0,
      debt          REAL NOT NULL DEFAULT 0,
      job_status    TEXT NOT NULL DEFAULT 'idle',
      hunger        REAL NOT NULL DEFAULT 100,
      energy        REAL NOT NULL DEFAULT 100,
      hygiene       REAL NOT NULL DEFAULT 100,
      bladder       REAL NOT NULL DEFAULT 100,
      fun           REAL NOT NULL DEFAULT 100,
      social        REAL NOT NULL DEFAULT 100,
      smarts        REAL NOT NULL DEFAULT 10,
      charisma      REAL NOT NULL DEFAULT 10,
      fitness       REAL NOT NULL DEFAULT 10,
      skin_color    INTEGER NOT NULL DEFAULT 0xF1C27D,
      outfit_color  INTEGER NOT NULL DEFAULT 0x2196F3,
      hair_style    TEXT NOT NULL DEFAULT 'short',
      hair_color    INTEGER NOT NULL DEFAULT 0x181310,
      body_type     TEXT NOT NULL DEFAULT 'average',
      outfit_id     TEXT NOT NULL DEFAULT 'casual',
      bottom_color  INTEGER NOT NULL DEFAULT 0x2C3E50,
      pos_x         REAL NOT NULL DEFAULT 12.5,
      pos_y         REAL NOT NULL DEFAULT 0,
      pos_z         REAL NOT NULL DEFAULT 12.5,
      last_seen     TEXT NOT NULL DEFAULT (datetime('now')),
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Step 6: Add job columns to existing users table ──────────
  const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!columns.includes('job_type')) {
    db.exec('ALTER TABLE users ADD COLUMN job_type TEXT DEFAULT NULL');
  }
  if (!columns.includes('job_started_at')) {
    db.exec('ALTER TABLE users ADD COLUMN job_started_at TEXT DEFAULT NULL');
  }

  // ── Step 7: Add activity columns to existing users table ──────
  if (!columns.includes('current_activity')) {
    db.exec('ALTER TABLE users ADD COLUMN current_activity TEXT DEFAULT NULL');
  }
  if (!columns.includes('activity_ends_at')) {
    db.exec('ALTER TABLE users ADD COLUMN activity_ends_at INTEGER DEFAULT 0');
  }

  // ── Round 7: the whole character look, not just two colours ──
  // Login already stored skin and outfit colour; the character creator now
  // also picks hair, build and a named outfit, and the character panel can
  // change any of it later, so it has to survive a re-login.
  const appearanceColumns = [
    ['hair_style', "TEXT NOT NULL DEFAULT 'short'"],
    ['hair_color', 'INTEGER NOT NULL DEFAULT 0x181310'],
    ['body_type', "TEXT NOT NULL DEFAULT 'average'"],
    ['outfit_id', "TEXT NOT NULL DEFAULT 'casual'"],
    ['bottom_color', 'INTEGER NOT NULL DEFAULT 0x2C3E50'],
  ];
  for (const [name, def] of appearanceColumns) {
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
    }
  }

  // ── Step 8: Add home column + user_properties table ───────────
  // home_property points at the property id the player currently lives in
  // (NULL = homeless). user_properties records what the player owns/rents.
  if (!columns.includes('home_property')) {
    db.exec('ALTER TABLE users ADD COLUMN home_property TEXT DEFAULT NULL');
  }

  // ── Hardening: token revocation ───────────────────────────────
  // Every JWT carries the token_version it was issued with. Bumping this
  // column invalidates every outstanding token for that user instantly.
  if (!columns.includes('token_version')) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_properties (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      property_id     TEXT NOT NULL,
      tenure          TEXT NOT NULL DEFAULT 'owned',
      acquired_at     TEXT NOT NULL DEFAULT (datetime('now')),
      rent_paid_until INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, property_id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_properties_user
    ON user_properties(user_id);
  `);

  // ── Player property market ───────────────────────────────────
  // A player who owns a property can put it up for sale or for rent, and another
  // player can take it. Titles are transferable: buying a listed property moves
  // the ownership row from seller to buyer and pays the seller.
  //
  // The catalogue properties stay open to everyone as "new units" (a hostel has
  // many beds), which is why there is no global unique index on property_id —
  // exclusivity belongs to the listing, not to the building.
  db.exec(`
    CREATE TABLE IF NOT EXISTS property_listings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id     TEXT NOT NULL,
      owner_user_id   INTEGER NOT NULL,
      mode            TEXT NOT NULL CHECK (mode IN ('sale','rent')),
      price           INTEGER NOT NULL,
      deposit         INTEGER NOT NULL DEFAULT 0,
      rent_period_ms  INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      active          INTEGER NOT NULL DEFAULT 1,
      UNIQUE(owner_user_id, property_id)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_listings_active ON property_listings(active, mode);`);

  // Who the rent goes to, and how much. NULL landlord = the city letting agency.
  {
    const cols = db.prepare('PRAGMA table_info(user_properties)').all().map((c) => c.name);
    if (!cols.includes('landlord_user_id')) {
      db.exec('ALTER TABLE user_properties ADD COLUMN landlord_user_id INTEGER DEFAULT NULL');
    }
    if (!cols.includes('rent_amount')) {
      db.exec('ALTER TABLE user_properties ADD COLUMN rent_amount INTEGER DEFAULT NULL');
    }
  }

  // ── Open-world pass: inventory, missions, vehicles, progress counters ──
  if (!columns.includes('total_earned')) {
    db.exec('ALTER TABLE users ADD COLUMN total_earned REAL NOT NULL DEFAULT 0');
  }
  if (!columns.includes('items_used')) {
    db.exec('ALTER TABLE users ADD COLUMN items_used INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns.includes('items_bought')) {
    db.exec('ALTER TABLE users ADD COLUMN items_bought INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns.includes('districts_bitmap')) {
    db.exec('ALTER TABLE users ADD COLUMN districts_bitmap INTEGER NOT NULL DEFAULT 0');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL,
      item_id   TEXT NOT NULL,
      quantity  INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, item_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      mission_id    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      step_state    TEXT NOT NULL DEFAULT '{}',
      accepted_at   TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT DEFAULT NULL,
      claimed       INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, mission_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      vehicle_id    TEXT NOT NULL,
      colour        INTEGER NOT NULL DEFAULT 0,
      pos_x         REAL NOT NULL DEFAULT 12.5,
      pos_z         REAL NOT NULL DEFAULT 12.5,
      fuel          REAL NOT NULL DEFAULT 40,
      purchased_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // ── Home utilities (round 10) ────────────────────────────────
  // The meter, the water tank and the gas bottle. One row per household;
  // readings drain with the game clock in the game loop, not on the client.
  db.exec(`
    CREATE TABLE IF NOT EXISTS home_utilities (
      user_id      INTEGER PRIMARY KEY,
      power_kwh    REAL NOT NULL DEFAULT 40,
      water_litres REAL NOT NULL DEFAULT 700,
      gas_kg       REAL NOT NULL DEFAULT 6,
      solar        INTEGER NOT NULL DEFAULT 0,
      appliances   TEXT NOT NULL DEFAULT '{}',
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_missions_user ON missions(user_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);`);

  console.log('Database migrations complete.');
}

// ── Tier starting values ────────────────────────────────────────
const TIER_START = {
  nepo:   { cash: 5_000_000, debt: 0 },
  middle: { cash: 500_000,   debt: 0 },
  lapo:   { cash: 50_000,    debt: 300_000 },
};

// ── Transactions ────────────────────────────────────────────────
//
// better-sqlite3 is synchronous, so a transaction here is a real atomic
// unit: if `fn` throws, every write inside it is rolled back. Use this for
// any operation that touches money plus another table (buying a property,
// depositing to the bank, buying an item) so a crash or error can never
// leave the database half-updated.
export function withTransaction(fn) {
  const wrapped = db.transaction(fn);
  return wrapped();
}

// ── User queries ────────────────────────────────────────────────
export function createUser({
  username, passwordHash, tier, skinColor, outfitColor,
  hairStyle, hairColor, bodyType, outfitId, bottomColor,
}) {
  const t = TIER_START[tier] || TIER_START.middle;
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, tier, cash, debt, skin_color, outfit_color)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    username, passwordHash, tier, t.cash, t.debt, skinColor, outfitColor
  );
  return info.lastInsertRowid;
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getTokenVersion(userId) {
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId);
  return row ? row.token_version : 0;
}

/** Invalidate every outstanding token for this user. */
export function bumpTokenVersion(userId) {
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
    .run(userId);
  return getTokenVersion(userId);
}

/** Replace a user's password hash and invalidate existing sessions. */
export function updatePassword(userId, passwordHash) {
  return withTransaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(passwordHash, userId);
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?')
      .run(userId);
    return getTokenVersion(userId);
  });
}

export function updateLastSeen(id) {
  db.prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?").run(id);
}

// ── Safe user projection ────────────────────────────────────────
//
// ALLOWLIST, not a blocklist. Adding a column to the users table must never
// silently expose it to clients — if a field isn't listed here, it does not
// leave the server. Notably excluded: password_hash, token_version,
// last_seen, job_started_at, created_at.
const PUBLIC_USER_FIELDS = [
  'id', 'username', 'tier',
  'cash', 'bank_balance', 'debt',
  'job_status', 'job_type',
  'current_activity', 'activity_ends_at',
  'hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social',
  'smarts', 'charisma', 'fitness',
  'skin_color', 'outfit_color',
  'hair_style', 'hair_color', 'body_type', 'outfit_id', 'bottom_color',
  'pos_x', 'pos_y', 'pos_z',
  'home_property',
];

export function sanitizeUser(user) {
  if (!user) return null;
  const out = {};
  for (const key of PUBLIC_USER_FIELDS) {
    if (key in user) out[key] = user[key];
  }
  return out;
}

/** Save a character look. Only the fields supplied are written. */
export function updateAppearance(userId, fields) {
  const allowed = {
    skin_color: 'skin_color',
    outfit_color: 'outfit_color',
    hair_style: 'hair_style',
    hair_color: 'hair_color',
    body_type: 'body_type',
    outfit_id: 'outfit_id',
    bottom_color: 'bottom_color',
  };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (fields[key] === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(fields[key]);
  }
  if (!sets.length) return false;
  values.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return true;
}

// ── Needs persistence ──────────────────────────────────────────
export function updateNeeds(userId, needs) {
  db.prepare(`
    UPDATE users SET
      hunger = ?, energy = ?, hygiene = ?, bladder = ?, fun = ?, social = ?,
      last_seen = datetime('now')
    WHERE id = ?
  `).run(
    needs.hunger, needs.energy, needs.hygiene,
    needs.bladder, needs.fun, needs.social, userId
  );
}

// ── Offline catch-up decay ─────────────────────────────────────
// Applied on login. Decays needs for time away from the game,
// capped at offlineCapHours (8 hours). Uses the same per-tick
// decay rates as the live game loop.
export function applyOfflineDecay(userId) {
  const user = getUserById(userId);
  if (!user) return;

  // SQLite stores timestamps in UTC as 'YYYY-MM-DD HH:MM:SS'
  const lastSeen = new Date(user.last_seen.replace(' ', 'T') + 'Z');
  const now = new Date();
  const hoursAway = Math.min(
    Math.max(0, (now - lastSeen) / (1000 * 60 * 60)),
    needsConfig.offlineCapHours
  );

  // Skip if less than ~4 seconds away (prevents false positives)
  if (hoursAway < 0.001) return;

  const ticks = (hoursAway * 3600 * 1000) / needsConfig.tickInterval;
  const newNeeds = {};
  for (const [key, rate] of Object.entries(needsConfig.decay)) {
    newNeeds[key] = Math.max(0, user[key] - rate * ticks);
  }

  updateNeeds(userId, newNeeds);
}

// ── Job management ────────────────────────────────────────────
export function takeJob(userId, jobType) {
  db.prepare(`
    UPDATE users SET
      job_status = 'working',
      job_type = ?,
      job_started_at = datetime('now')
    WHERE id = ?
  `).run(jobType, userId);
}

export function quitJob(userId) {
  db.prepare(`
    UPDATE users SET
      job_status = 'idle',
      job_type = NULL,
      job_started_at = NULL
    WHERE id = ?
  `).run(userId);
}

export function updateCash(userId, cash) {
  db.prepare(`
    UPDATE users SET
      cash = ?,
      last_seen = datetime('now')
    WHERE id = ?
  `).run(cash, userId);
}

// Return the full job list with the user's current job attached.
export function getJobsWithStatus(userId) {
  const user = getUserById(userId);
  const currentJob = user && user.job_type
    ? jobConfig.jobs.find(j => j.id === user.job_type) || null
    : null;
  return { jobs: jobConfig.jobs, currentJob };
}

// ── Activity management ───────────────────────────────────────
export function startActivity(userId, activityId, duration) {
  const endsAt = Date.now() + duration;
  db.prepare(`
    UPDATE users SET
      current_activity = ?,
      activity_ends_at = ?
    WHERE id = ?
  `).run(activityId, endsAt, userId);
}

export function cancelActivity(userId) {
  db.prepare(`
    UPDATE users SET
      current_activity = NULL,
      activity_ends_at = 0
    WHERE id = ?
  `).run(userId);
}

// Update character stats (smarts, charisma, fitness) — these don't
// decay over time but can be increased by activities.
export function updateStats(userId, stats) {
  const setClauses = Object.keys(stats).map(k => `${k} = ?`).join(', ');
  const values = Object.values(stats);
  db.prepare(`UPDATE users SET ${setClauses} WHERE id = ?`).run(...values, userId);
}

// Return the full activity list with the user's current activity attached.
export function getActivitiesWithStatus(userId) {
  const user = getUserById(userId);
  const currentActivity = user && user.current_activity
    ? activityConfig.activities[user.current_activity] || null
    : null;
  return {
    // Activities that belong to a place (cooking at a hob, checking in for a
    // flight) are started from a station in the world, not from this list —
    // otherwise the panel would offer "take the flight" from a bedroom.
    activities: Object.values(activityConfig.activities).filter((a) => !a.venueOnly),
    currentActivity,
  };
}

// ── Position persistence (Step 11) ───────────────────────────
// The server saves a player's spot so they spawn back where they left off.
export function updatePosition(userId, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  db.prepare('UPDATE users SET pos_x = ?, pos_z = ? WHERE id = ?')
    .run(x, z, userId);
}

// ── Leaderboard (Step 11) ────────────────────────────────────
// Ranked by net worth: cash on hand plus bank balance.
export function getLeaderboard(limit = 10) {
  return db.prepare(`
    SELECT username, tier, cash, bank_balance,
           (cash + bank_balance) AS net_worth
    FROM users
    ORDER BY net_worth DESC
    LIMIT ?
  `).all(limit);
}

// ── Property / housing (Step 8) ───────────────────────────────

/** All property rows the user owns or rents. */
export function getUserPropertyRows(userId) {
  return db.prepare(
    'SELECT * FROM user_properties WHERE user_id = ? ORDER BY acquired_at ASC'
  ).all(userId);
}

/** The property object the user currently lives in, or null. */
export function getHomeProperty(userId) {
  const user = getUserById(userId);
  if (!user || !user.home_property) return null;
  return getProperty(user.home_property);
}

/** The user's active rental row (there is at most one), or null. */
// ── Home utilities ──────────────────────────────────────────────
/** The household's meter row, or null if they have never had a home. */
export function getUtilitiesRow(userId) {
  return db.prepare('SELECT * FROM home_utilities WHERE user_id = ?').get(userId) || null;
}

export function createUtilitiesRow(userId, { powerKwh, waterLitres, gasKg, appliances }) {
  db.prepare(`
    INSERT INTO home_utilities (user_id, power_kwh, water_litres, gas_kg, appliances, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, powerKwh, waterLitres, gasKg, JSON.stringify(appliances || {}));
  return getUtilitiesRow(userId);
}

export function updateUtilities(userId, patch) {
  const row = getUtilitiesRow(userId);
  if (!row) return null;
  const next = {
    power_kwh: patch.powerKwh ?? row.power_kwh,
    water_litres: patch.waterLitres ?? row.water_litres,
    gas_kg: patch.gasKg ?? row.gas_kg,
    // better-sqlite3 binds numbers and strings only: store the flag as 0/1.
    solar: patch.solar === undefined || patch.solar === null
      ? row.solar
      : (patch.solar ? 1 : 0),
    appliances: patch.appliances ? JSON.stringify(patch.appliances) : row.appliances,
  };
  db.prepare(`
    UPDATE home_utilities
    SET power_kwh = ?, water_litres = ?, gas_kg = ?, solar = ?, appliances = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(next.power_kwh, next.water_litres, next.gas_kg, next.solar, next.appliances, userId);
  return getUtilitiesRow(userId);
}

export function getRental(userId) {
  return db.prepare(
    "SELECT * FROM user_properties WHERE user_id = ? AND tenure = 'rented' LIMIT 1"
  ).get(userId) || null;
}

/** The ownership/rental row for one specific property, or null. */
export function getUserPropertyRow(userId, propertyId) {
  return db.prepare(
    'SELECT * FROM user_properties WHERE user_id = ? AND property_id = ?'
  ).get(userId, propertyId) || null;
}

/** Buy a property outright. Does not change the home (see moveIn). */
export function buyProperty(userId, propertyId) {
  db.prepare(`
    INSERT INTO user_properties (user_id, property_id, tenure, rent_paid_until)
    VALUES (?, ?, 'owned', 0)
  `).run(userId, propertyId);
}

/**
 * Start renting a property. Keeps the row marked as rented and stamps the
 * first rent period, so the game loop knows when the next payment is due.
 */
export function rentProperty(userId, propertyId, rentPaidUntil) {
  db.prepare(`
    INSERT INTO user_properties (user_id, property_id, tenure, rent_paid_until)
    VALUES (?, ?, 'rented', ?)
  `).run(userId, propertyId, rentPaidUntil);
}

/** Push the paid-until timestamp forward after a successful rent payment. */
export function extendRent(userId, propertyId, rentPaidUntil) {
  db.prepare(`
    UPDATE user_properties SET rent_paid_until = ?
    WHERE user_id = ? AND property_id = ?
  `).run(rentPaidUntil, userId, propertyId);
}

/** End a tenancy. Clears the home if the player was living there. */
export function endRental(userId, propertyId) {
  db.prepare(`
    DELETE FROM user_properties WHERE user_id = ? AND property_id = ? AND tenure = 'rented'
  `).run(userId, propertyId);

  db.prepare(`
    UPDATE users SET home_property = NULL
    WHERE id = ? AND home_property = ?
  `).run(userId, propertyId);
}

/** Set which property the player lives in. Pass null to become homeless. */
export function setHome(userId, propertyId) {
  db.prepare('UPDATE users SET home_property = ? WHERE id = ?')
    .run(propertyId, userId);
}

// ── Player property market ────────────────────────────────────

/**
 * Put one of your properties up for sale or for rent.
 * Replaces any earlier listing you had on the same property.
 *
 * @param {{userId:number, propertyId:string, mode:'sale'|'rent', price:number,
 *          deposit?:number, rentPeriodMs?:number}} o
 */
export function createListing({ userId, propertyId, mode, price, deposit = 0, rentPeriodMs = 0 }) {
  db.prepare(`
    INSERT INTO property_listings
      (property_id, owner_user_id, mode, price, deposit, rent_period_ms, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(owner_user_id, property_id) DO UPDATE SET
      mode = excluded.mode,
      price = excluded.price,
      deposit = excluded.deposit,
      rent_period_ms = excluded.rent_period_ms,
      active = 1,
      created_at = datetime('now')
  `).run(propertyId, userId, mode, price, deposit, rentPeriodMs);
  return getListingByOwner(userId, propertyId);
}

/** Withdraw your listing. */
export function removeListing(userId, propertyId) {
  // `AND active = 1` matters: without it a second withdrawal "succeeds" against
  // a listing that is already down, and the player is told something happened.
  const info = db.prepare(
    'UPDATE property_listings SET active = 0 WHERE owner_user_id = ? AND property_id = ? AND active = 1'
  ).run(userId, propertyId);
  return info.changes > 0;
}

/** One owner's active listing for a property, or null. */
export function getListingByOwner(userId, propertyId) {
  return db.prepare(
    'SELECT * FROM property_listings WHERE owner_user_id = ? AND property_id = ? AND active = 1'
  ).get(userId, propertyId) || null;
}

/**
 * Every live listing, with the seller's name and whether the listing's owner
 * still actually holds the property (a guard against stale rows).
 */
export function getActiveListings() {
  return db.prepare(`
    SELECT l.*, u.username AS owner_username
    FROM property_listings l
    JOIN users u ON u.id = l.owner_user_id
    JOIN user_properties p ON p.user_id = l.owner_user_id AND p.property_id = l.property_id
    WHERE l.active = 1 AND p.tenure = 'owned'
    ORDER BY l.created_at ASC
  `).all();
}

/** The listing a buyer/renter is trying to take, if any (any owner's). */
export function getListingsForProperty(propertyId) {
  return db.prepare(`
    SELECT l.*, u.username AS owner_username
    FROM property_listings l
    JOIN users u ON u.id = l.owner_user_id
    JOIN user_properties p ON p.user_id = l.owner_user_id AND p.property_id = l.property_id
    WHERE l.active = 1 AND p.tenure = 'owned' AND l.property_id = ?
    ORDER BY l.price ASC
  `).all(propertyId);
}

/**
 * Move a title from one player to another: the seller's row becomes the buyer's.
 * The listing is cleared by the caller.
 */
export function transferProperty(fromUserId, toUserId, propertyId) {
  db.prepare(`
    UPDATE user_properties
    SET user_id = ?, acquired_at = datetime('now'), rent_paid_until = 0,
        landlord_user_id = NULL, rent_amount = NULL
    WHERE user_id = ? AND property_id = ? AND tenure = 'owned'
  `).run(toUserId, fromUserId, propertyId);

  // If the seller lived there, they are no longer living there. The buyer does
  // not automatically move in — the panel offers Move In.
  db.prepare('UPDATE users SET home_property = NULL WHERE id = ? AND home_property = ?')
    .run(fromUserId, propertyId);
}

/**
 * Record who a rental pays.
 * `landlordUserId` null means the city letting agency.
 */
export function setRentalTerms(userId, propertyId, { landlordUserId, rentAmount }) {
  db.prepare(`
    UPDATE user_properties
    SET landlord_user_id = ?, rent_amount = ?
    WHERE user_id = ? AND property_id = ? AND tenure = 'rented'
  `).run(landlordUserId ?? null, rentAmount ?? null, userId, propertyId);
}

/** Put money into the bank balance. Returns the new balance. */
export function addBank(userId, amount) {
  const user = getUserById(userId);
  if (!user) return 0;
  const next = user.bank_balance + amount;
  db.prepare('UPDATE users SET bank_balance = ? WHERE id = ?').run(next, userId);
  return next;
}

/** Take money out of the bank balance. Returns the new balance. */
export function deductBank(userId, amount) {
  const user = getUserById(userId);
  if (!user) return 0;
  const next = Math.max(0, user.bank_balance - amount);
  db.prepare('UPDATE users SET bank_balance = ? WHERE id = ?').run(next, userId);
  return next;
}

/**
 * Full housing market for one player, with their status attached to each
 * listing. Used by GET /api/properties.
 */
export function getPropertiesWithStatus(userId) {
  const user = getUserById(userId);
  const rows = getUserPropertyRows(userId);
  const rowByPropertyId = Object.fromEntries(rows.map(r => [r.property_id, r]));
  const now = Date.now();

  // Live player listings, grouped by the property they are for. A property can
  // carry several owner listings (different players own different units of the
  // same building), so the panel shows them as a list, cheapest first.
  const listings = getActiveListings();
  const byProperty = new Map();
  for (const l of listings) {
    if (!byProperty.has(l.property_id)) byProperty.set(l.property_id, []);
    byProperty.get(l.property_id).push({
      id: l.id,
      mode: l.mode,
      price: l.price,
      deposit: l.deposit,
      rentPeriodMs: l.rent_period_ms,
      ownerId: l.owner_user_id,
      ownerUsername: l.owner_username,
      mine: l.owner_user_id === userId,
    });
  }

  const properties = propertyConfig.properties.map((p) => {
    const row = rowByPropertyId[p.id] || null;
    const forProperty = byProperty.get(p.id) || [];
    return {
      ...p,
      owned: !!row && row.tenure === 'owned',
      rented: !!row && row.tenure === 'rented',
      isHome: !!user && user.home_property === p.id,
      rentPaidUntil: row ? row.rent_paid_until : 0,
      rentDueIn: row && row.tenure === 'rented'
        ? Math.max(0, row.rent_paid_until - now)
        : 0,
      // Where the rent goes: null = the letting agency, a name = a player.
      landlord: row && row.landlord_user_id
        ? (getUserById(row.landlord_user_id)?.username || 'another player')
        : null,
      rentAmount: row && row.rent_amount ? row.rent_amount : p.rentPerPeriod,
      // The market: other players' titles for sale or rent, and my own listing.
      listings: forProperty.filter((l) => !l.mine),
      myListing: forProperty.find((l) => l.mine) || null,
    };
  });

  const homeRow = user && user.home_property ? rowByPropertyId[user.home_property] : null;

  return {
    properties,
    // Everything the player owns, for the "my properties" section — owning more
    // than one flat is allowed and has to be visible.
    ownedProperties: properties.filter((p) => p.owned || p.rented),
    marketListings: listings.length,
    home: user ? getHomeProperty(userId) : null,
    tenure: homeRow ? homeRow.tenure : null,
    rentDueIn: homeRow && homeRow.tenure === 'rented'
      ? Math.max(0, homeRow.rent_paid_until - now)
      : 0,
    rentPeriodMs: RENT_PERIOD_MS,
    cash: user ? user.cash : 0,
    bankBalance: user ? user.bank_balance : 0,
  };
}



// ══════════════════════════════════════════════════════════════
// Inventory
// ══════════════════════════════════════════════════════════════

export function getInventory(userId) {
  return db.prepare(
    'SELECT item_id, quantity FROM inventory WHERE user_id = ? ORDER BY item_id'
  ).all(userId);
}

export function getInventoryItem(userId, itemId) {
  return db.prepare(
    'SELECT item_id, quantity FROM inventory WHERE user_id = ? AND item_id = ?'
  ).get(userId, itemId) || null;
}

export function addInventoryItem(userId, itemId, quantity = 1) {
  db.prepare(`
    INSERT INTO inventory (user_id, item_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, item_id)
    DO UPDATE SET quantity = quantity + excluded.quantity
  `).run(userId, itemId, quantity);
}

/** Remove `quantity` of an item. Returns false if the player does not have it. */
export function removeInventoryItem(userId, itemId, quantity = 1) {
  const row = getInventoryItem(userId, itemId);
  if (!row || row.quantity < quantity) return false;
  if (row.quantity === quantity) {
    db.prepare('DELETE FROM inventory WHERE user_id = ? AND item_id = ?').run(userId, itemId);
  } else {
    db.prepare('UPDATE inventory SET quantity = quantity - ? WHERE user_id = ? AND item_id = ?')
      .run(quantity, userId, itemId);
  }
  return true;
}

export function countInventoryItems(userId) {
  const row = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS n FROM inventory WHERE user_id = ?'
  ).get(userId);
  return row?.n || 0;
}

export function incrementItemsBought(userId, n = 1) {
  db.prepare('UPDATE users SET items_bought = items_bought + ? WHERE id = ?').run(n, userId);
}

export function incrementItemsUsed(userId) {
  db.prepare('UPDATE users SET items_used = items_used + 1 WHERE id = ?').run(userId);
}

export function addTotalEarned(userId, amount) {
  if (amount <= 0) return;
  db.prepare('UPDATE users SET total_earned = total_earned + ? WHERE id = ?').run(amount, userId);
}

/** Bitmap of districts visited: 1=Mushin 2=Yaba 4=Victoria 8=Lekki. */
export function markDistrictVisited(userId, bit) {
  db.prepare('UPDATE users SET districts_bitmap = districts_bitmap | ? WHERE id = ?')
    .run(bit, userId);
}

// ══════════════════════════════════════════════════════════════
// Missions
// ══════════════════════════════════════════════════════════════

export function getMissionRows(userId) {
  return db.prepare('SELECT * FROM missions WHERE user_id = ?').all(userId);
}

export function getMissionRow(userId, missionId) {
  return db.prepare(
    'SELECT * FROM missions WHERE user_id = ? AND mission_id = ?'
  ).get(userId, missionId) || null;
}

export function insertMission(userId, missionId) {
  db.prepare(`
    INSERT INTO missions (user_id, mission_id, status)
    VALUES (?, ?, 'active')
    ON CONFLICT(user_id, mission_id) DO NOTHING
  `).run(userId, missionId);
}

export function updateMissionStepState(userId, missionId, stepState) {
  db.prepare('UPDATE missions SET step_state = ? WHERE user_id = ? AND mission_id = ?')
    .run(JSON.stringify(stepState), userId, missionId);
}

export function completeMissionRow(userId, missionId) {
  db.prepare(`
    UPDATE missions
    SET status = 'completed', completed_at = datetime('now')
    WHERE user_id = ? AND mission_id = ?
  `).run(userId, missionId);
}

export function markMissionClaimed(userId, missionId) {
  db.prepare('UPDATE missions SET claimed = 1 WHERE user_id = ? AND mission_id = ?')
    .run(userId, missionId);
}

// ══════════════════════════════════════════════════════════════
// Vehicles
// ══════════════════════════════════════════════════════════════

export function getVehicles(userId) {
  return db.prepare(
    'SELECT * FROM vehicles WHERE user_id = ? ORDER BY id'
  ).all(userId);
}

export function getVehicle(userId, id) {
  return db.prepare(
    'SELECT * FROM vehicles WHERE user_id = ? AND id = ?'
  ).get(userId, id) || null;
}

export function insertVehicle(userId, { vehicleId, colour, posX, posZ, fuel }) {
  const info = db.prepare(`
    INSERT INTO vehicles (user_id, vehicle_id, colour, pos_x, pos_z, fuel)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, vehicleId, colour, posX, posZ, fuel);
  return info.lastInsertRowid;
}

export function parkVehicle(userId, id, posX, posZ, fuel) {
  db.prepare(`
    UPDATE vehicles SET pos_x = ?, pos_z = ?, fuel = ?
    WHERE user_id = ? AND id = ?
  `).run(posX, posZ, fuel, userId, id);
}

export function countVehicles(userId) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM vehicles WHERE user_id = ?').get(userId);
  return row?.n || 0;
}

export function setVehicleFuel(userId, id, fuel) {
  db.prepare('UPDATE vehicles SET fuel = ? WHERE user_id = ? AND id = ?')
    .run(fuel, userId, id);
}
