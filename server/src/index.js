// MUST be the first import: it populates process.env from .env before any
// other module (auth.js, db.js) reads configuration.
import 'dotenv/config';

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  runMigrations,
  createUser,
  updateAppearance,
  getUserByUsername,
  getUserById,
  sanitizeUser,
  applyOfflineDecay,
  takeJob,
  quitJob,
  getJobsWithStatus,
  startActivity,
  cancelActivity,
  getActivitiesWithStatus,
  getPropertiesWithStatus,
  getUserPropertyRow,
  getRental,
  buyProperty,
  rentProperty,
  setHome,
  deductBank,
  addBank,
  getLeaderboard,
  bumpTokenVersion,
  updatePassword,
  addInventoryItem,
  createListing,
  removeListing,
  getListingsForProperty,
} from './db.js';
import {
  signToken, authMiddleware, verifyToken, getJwtSecret,
  setAuthCookie, clearAuthCookie,
} from './auth.js';
import { registerWorldRoutes } from './worldRoutes.js';
import {
  getUtilities, topUp, toggleAppliance, buySolar, blockReason, utilityCatalogue,
} from './homeUtilities.js';
import { addTotalEarned } from './db.js';
import {
  getWanted, recordCrime, payBribe, arrest, arrestWarrant, serviceRefused,
  starsFor, mostWanted, clearWanted, CRIMES, FACTIONS,
} from './wanted.js';
import { MAX_STARS } from '../config/factionConfig.js';
import { randomInt } from 'node:crypto';

/** Money, the way the rest of the game writes it. */
function naira(amount) {
  return '₦' + Math.round(amount || 0).toLocaleString('en-NG');
}
import { DISTRICTS } from '../config/worldGeometry.js';
import { districtForPlayer } from '../config/worldGeometry.js';
import { rateLimit, LoginLockout } from './rateLimit.js';
import { logEvent } from './securityLog.js';
import { GameLoop } from './gameLoop.js';
import { Multiplayer } from './multiplayer.js';
import { multiplayerConfig } from '../config/multiplayerConfig.js';
import {
  EconomyError,
  buyPropertyAtomic,
  rentPropertyAtomic,
  depositAtomic,
  withdrawAtomic,
  buyItemAtomic,
  buyListingAtomic,
  rentListingAtomic,
} from './economy.js';
import { jobConfig } from '../config/jobConfig.js';
import { activityConfig } from '../config/activityConfig.js';
import { venueKind, kindLabel } from '../config/venueKinds.js';
import { staffFor } from '../config/staffConfig.js';
import { serviceConfig } from '../config/serviceConfig.js';
import { RENT_PERIOD_MS, getProperty } from '../config/propertyConfig.js';
import { listVenues, getVenueShop, getVenueItem, getVenueStock } from '../config/venueConfig.js';
import {
  interactionConfig,
  getInteractionPoint,
  getShopItem,
} from '../config/interactionConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the JWT secret before anything else. In production this exits
// immediately if the secret is missing/weak, rather than serving traffic
// with a guessable key.
getJwtSecret();

// Run database migrations on startup
runMigrations();

const app = express();
const server = createServer(app);

// Behind a reverse proxy (nginx, Render, Fly, etc.) this makes req.ip the
// real client address, which the rate limiter depends on.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// --- CORS: only the configured client origin may call the API ---
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: clientOrigin, credentials: false }));

// --- Security headers (hand-rolled; avoids an extra dependency) ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0'); // modern browsers: CSP replaces this
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Strict CSP for API responses (JSON only), relaxed for the app itself.
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  } else {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        // The game sets inline style attributes for HUD bars and panels.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        // Socket.IO connects back to this same origin over ws/wss.
        "connect-src 'self' ws: wss:",
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
  }
  next();
});

// --- Body parsing with a hard size cap ---
app.use(express.json({ limit: '10kb' }));

// --- Auth rate limiting -----------------------------------------
// Per-IP request caps. Generous enough for real users, tight enough to make
// brute forcing impractical.
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_RATE_WINDOW_MIN || 15) * 60 * 1000;
const LOGIN_MAX = Number(process.env.LOGIN_RATE_MAX || 20);

const loginRateLimit = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: LOGIN_MAX,
  name: 'login',
});
// Signup is deliberately tight: real users sign up once, and a low ceiling
// makes it impractical to enumerate which usernames exist.
const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.SIGNUP_RATE_MAX || 5),
  name: 'signup',
});

// Blanket protection for every API route, authenticated or not. Without this
// an attacker with one valid token can hammer the database for free.
const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.API_RATE_MAX || 120),
  name: 'api',
});

// Per-account lockout: 5 bad passwords locks that username for 15 minutes,
// regardless of which IP they come from.
const loginLockout = new LoginLockout({
  maxFailures: Number(process.env.LOGIN_MAX_FAILURES || 5),
  windowMs: Number(process.env.LOGIN_LOCKOUT_MIN || 15) * 60 * 1000,
  lockMs: Number(process.env.LOGIN_LOCKOUT_MIN || 15) * 60 * 1000,
});

// A pre-computed bcrypt hash used when the username doesn't exist, so a
// missing account and a wrong password take roughly the same time. Without
// this, response timing reveals which usernames are registered.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

// ─── Health route ──────────────────────────────────────────────
// Deliberately ahead of the API limiter so monitoring never gets throttled,
// and deliberately reveals nothing about the system.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Every other API route counts against the blanket limiter.
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  return apiRateLimit(req, res, next);
});

// ─── Appearance ────────────────────────────────────────────────
// The character creator and the character panel both save through here. Values
// are validated against a whitelist so a client cannot write arbitrary columns
// or nonsense values into the users table.
const HAIR_STYLES = ['short', 'afro', 'braids', 'bald', 'fade'];
const BODY_TYPES = ['slim', 'average', 'broad'];
const OUTFIT_IDS = ['casual', 'trader', 'office', 'student', 'owambe', 'kaftan', 'modest', 'worker'];
const COLOUR_KEYS = ['skin_color', 'outfit_color', 'hair_color', 'bottom_color'];

app.post('/api/appearance', authMiddleware, (req, res) => {
  const body = req.body || {};
  const patch = {};

  for (const key of COLOUR_KEYS) {
    if (body[key] === undefined) continue;
    const v = Number(body[key]);
    if (!Number.isInteger(v) || v < 0 || v > 0xFFFFFF) {
      return res.status(400).json({ error: `${key} must be a colour between 0x000000 and 0xFFFFFF` });
    }
    patch[key] = v;
  }
  if (body.hair_style !== undefined) {
    if (!HAIR_STYLES.includes(body.hair_style)) return res.status(400).json({ error: 'Unknown hair style' });
    patch.hair_style = body.hair_style;
  }
  if (body.body_type !== undefined) {
    if (!BODY_TYPES.includes(body.body_type)) return res.status(400).json({ error: 'Unknown body type' });
    patch.body_type = body.body_type;
  }
  if (body.outfit_id !== undefined) {
    if (!OUTFIT_IDS.includes(body.outfit_id)) return res.status(400).json({ error: 'Unknown outfit' });
    patch.outfit_id = body.outfit_id;
  }
  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  updateAppearance(req.user.id, patch);
  // Keep this player's live session in step, so other players see the change
  // on the next broadcast instead of only after a reconnect.
  multiplayer.updateAppearance(req.user.id, patch);
  const fresh = getUserById(req.user.id);
  logEvent('appearance_updated', { userId: req.user.id, fields: Object.keys(patch) });
  res.json({ ok: true, user: sanitizeUser(fresh) });
});

// ─── Signup ────────────────────────────────────────────────────
app.post('/api/signup', signupRateLimit, async (req, res) => {
  const {
    username, password, tier, skin_color, outfit_color,
    hair_style, hair_color, body_type, outfit_id, bottom_color,
  } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (!/^[a-zA-Z0-9]{3,16}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–16 alphanumeric characters' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!['nepo', 'middle', 'lapo'].includes(tier)) {
    return res.status(400).json({ error: 'Tier must be nepo, middle, or lapo' });
  }

  const existing = getUserByUsername(username);
  if (existing) {
    logEvent('signup_conflict', { username, ip: req.ip });
    return res.status(409).json({ error: 'Username already taken' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = createUser({
    username,
    passwordHash,
    tier,
    skinColor: skin_color ?? 0xF1C27D,
    outfitColor: outfit_color ?? 0x2196F3,
    hairStyle: typeof hair_style === 'string' ? hair_style.slice(0, 16) : undefined,
    hairColor: Number.isFinite(hair_color) ? hair_color : undefined,
    bodyType: typeof body_type === 'string' ? body_type.slice(0, 16) : undefined,
    outfitId: typeof outfit_id === 'string' ? outfit_id.slice(0, 24) : undefined,
    bottomColor: Number.isFinite(bottom_color) ? bottom_color : undefined,
  });

  const user = getUserById(userId);
  const token = signToken(user);
  logEvent('signup_success', { userId, username, tier, ip: req.ip });
  // Also hand the browser a cookie. If a proxy strips the Authorization header
  // in transit, the cookie still authenticates every later call (see
  // tokenFromRequest in auth.js).
  setAuthCookie(req, res, token);
  res.json({ token, user: sanitizeUser(user) });
});

// ─── Login ─────────────────────────────────────────────────────
// Hardened:
//   • per-IP rate limit (10 attempts / 15 min)
//   • per-account lockout after 5 failures / 15 min
//   • constant-time-ish behaviour for unknown usernames
//   • one generic error message, so nothing leaks about which part failed
//   • every outcome is logged as a security event
app.post('/api/login', loginRateLimit, async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string' ||
      !username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Reject absurd input before touching the database.
  if (username.length > 32 || password.length > 200) {
    logEvent('login_invalid_input', { usernameLength: username.length, ip: req.ip });
    return res.status(400).json({ error: 'Invalid credentials' });
  }

  // 1) Is this account currently locked out?
  const lock = loginLockout.status(username);
  if (lock.locked) {
    const retryAfterSec = Math.ceil(lock.retryAfterMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    logEvent('login_locked', { username, ip: req.ip, retryAfterSec });
    return res.status(429).json({
      error: 'Too many failed attempts for this account. Try again later.',
    });
  }

  const user = getUserByUsername(username);

  // 2) Always run a bcrypt comparison, even for unknown usernames, so the
  //    two paths take similar time.
  const hash = user ? user.password_hash : DUMMY_HASH;
  const match = await bcrypt.compare(password, hash);

  if (!user || !match) {
    const status = loginLockout.recordFailure(username);
    logEvent('login_failed', {
      username,
      ip: req.ip,
      userExists: !!user,
      remainingAttempts: status.remaining,
    });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // 3) Success — clear the failure counter for this account.
  loginLockout.recordSuccess(username);

  // Apply offline catch-up decay (capped at 8 hours)
  applyOfflineDecay(user.id);
  const freshUser = getUserById(user.id);
  const token = signToken(freshUser);

  logEvent('login_success', { userId: user.id, username, ip: req.ip });
  setAuthCookie(req, res, token);
  res.json({ token, user: sanitizeUser(freshUser) });
});

// ─── Me (protected) ────────────────────────────────────────────
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

// ─── Logout / session revocation (protected) ──────────────────
// Bumping token_version invalidates every token issued for this account,
// including on other devices. The client also clears its stored token.
app.post('/api/logout', authMiddleware, (req, res) => {
  const version = bumpTokenVersion(req.user.id);
  // The cookie has to go too, or a stripped-header session would survive the
  // logout: the token is revoked server-side, but the browser would keep
  // presenting a dead cookie forever.
  clearAuthCookie(req, res);
  logEvent('logout', { userId: req.user.id, username: req.user.username, ip: req.ip });
  res.json({ ok: true, tokenVersion: version });
});

// ─── Change password (protected) ──────────────────────────────
// Requires the current password. On success every existing session is
// revoked and a fresh token is returned so the caller stays logged in.
app.post('/api/password', authMiddleware, async (req, res, next) => {
  const { current_password, new_password } = req.body || {};

  if (typeof current_password !== 'string' || typeof new_password !== 'string') {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (new_password.length > 200) {
    return res.status(400).json({ error: 'New password is too long' });
  }
  if (new_password === current_password) {
    return res.status(400).json({ error: 'New password must be different' });
  }

  try {
    const match = await bcrypt.compare(current_password, req.user.password_hash);
    if (!match) {
      logEvent('password_change_failed', { userId: req.user.id, ip: req.ip });
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(new_password, 10);
    updatePassword(req.user.id, passwordHash);

    const freshUser = getUserById(req.user.id);
    const token = signToken(freshUser); // carries the new token_version

    logEvent('password_changed', { userId: req.user.id, ip: req.ip });
    res.json({ ok: true, token, user: sanitizeUser(freshUser) });
  } catch (err) {
    next(err);
  }
});

// ─── Jobs list (protected) ─────────────────────────────────────
app.get('/api/jobs', authMiddleware, (req, res) => {
  const { jobs, currentJob } = getJobsWithStatus(req.user.id);
  res.json({ jobs, currentJob });
});

// ─── Take a job (protected) ────────────────────────────────────
app.post('/api/jobs/take', authMiddleware, (req, res) => {
  const { job_type } = req.body;
  if (!job_type) {
    return res.status(400).json({ error: 'Job type is required' });
  }
  const job = jobConfig.jobs.find(j => j.id === job_type);
  if (!job) {
    return res.status(400).json({ error: 'Unknown job type' });
  }
  if (req.user.job_status === 'working' && req.user.job_type === job_type) {
    return res.status(400).json({ error: 'Already working this job' });
  }
  takeJob(req.user.id, job_type);
  const freshUser = getUserById(req.user.id);
  res.json({ job, user: sanitizeUser(freshUser) });
});

// ─── Quit current job (protected) ─────────────────────────────
app.post('/api/jobs/quit', authMiddleware, (req, res) => {
  if (req.user.job_status !== 'working') {
    return res.status(400).json({ error: 'Not currently working a job' });
  }
  quitJob(req.user.id);
  const freshUser = getUserById(req.user.id);
  res.json({ user: sanitizeUser(freshUser) });
});

// ─── Activities list (protected) ──────────────────────────────
app.get('/api/activities', authMiddleware, (req, res) => {
  const { activities, currentActivity } = getActivitiesWithStatus(req.user.id);
  res.json({ activities, currentActivity });
});

// ─── Perform an activity (protected) ──────────────────────────
app.post('/api/activities/perform', authMiddleware, (req, res) => {
  const { activity_id } = req.body;
  if (!activity_id) {
    return res.status(400).json({ error: 'Activity ID is required' });
  }
  const activity = activityConfig.activities[activity_id];
  if (!activity) {
    return res.status(400).json({ error: 'Unknown activity' });
  }
  // Asking for a different activity abandons the one in progress. The game is
  // full of one-tap things you do in sequence — check in, clear security, board
  // — and refusing those for thirty seconds was the difference between an
  // airport that works and one that does not. Nothing is gained by swapping:
  // rewards are paid only when an activity runs to the end, so the abandoned
  // one simply pays nothing.
  let replaced = null;
  if (req.user.current_activity) {
    if (req.user.current_activity === activity_id) {
      return res.status(400).json({ error: `You are already ${activity.name.toLowerCase()}` });
    }
    replaced = req.user.current_activity;
  }
  // Some activities belong to a place: you cannot check in for a flight from
  // your bedroom. The client reports which interior it is in with every
  // position packet; the server refuses if that does not match.
  if (Array.isArray(activity.requiresVenue) && activity.requiresVenue.length) {
    const inside = multiplayer.getVenueByUserId(req.user.id);
    if (!inside || !activity.requiresVenue.includes(inside)) {
      return res.status(400).json({ error: `${activity.name} can only be done at ${activity.requiresVenue[0].replace('in-', '').replace(/-/g, ' ')}` });
    }
  }
  // Places that come in several flavours — anywhere with a bed, anywhere with a
  // desk — say so by kind rather than by listing every interior id. Homes are
  // generated per property, so an id list could never cover them.
  if (Array.isArray(activity.requiresVenueKind) && activity.requiresVenueKind.length) {
    const inside = multiplayer.getVenueByUserId(req.user.id);
    const kind = venueKind(inside);
    if (!kind || !activity.requiresVenueKind.includes(kind)) {
      const where = activity.requiresVenueKind.map(kindLabel).slice(0, 2).join(' or ');
      return res.status(400).json({ error: `${activity.name} can only be done at ${where}` });
    }
  }
  // Some activities need the house to be working: you cannot watch TV with an
  // empty meter, or shower with an empty tank. The refusal names the utility.
  if (activity.requiresUtility) {
    const blocked = blockReason(req.user.id, activity.requiresUtility);
    if (blocked) return res.status(400).json({ error: blocked });
  }
  startActivity(req.user.id, activity_id, activity.duration);
  const freshUser = getUserById(req.user.id);
  res.json({ activity, replaced, user: sanitizeUser(freshUser) });
});

// ─── Cancel current activity (protected) ─────────────────────
app.post('/api/activities/cancel', authMiddleware, (req, res) => {
  if (!req.user.current_activity) {
    return res.status(400).json({ error: 'Not performing an activity' });
  }
  cancelActivity(req.user.id);
  const freshUser = getUserById(req.user.id);
  res.json({ user: sanitizeUser(freshUser) });
});

// ─── Properties list (protected) ──────────────────────────────
app.get('/api/properties', authMiddleware, (req, res) => {
  res.json(getPropertiesWithStatus(req.user.id));
});

// ─── Buy a property (protected) ───────────────────────────────
// Buying is a one-off payment from cash, then topped up from the bank.
// Owning a property means no further rent — but it does not automatically
// make it your home if you already live somewhere you prefer; it does when
// you are homeless, which is the common case.
app.post('/api/properties/buy', authMiddleware, (req, res, next) => {
  const { property_id } = req.body || {};
  if (!property_id) {
    return res.status(400).json({ error: 'Property ID is required' });
  }
  const property = getProperty(property_id);
  if (!property) {
    return res.status(400).json({ error: 'Unknown property' });
  }

  try {
    // Single atomic unit: cash + bank + property row + home all commit
    // together, or none of them do.
    buyPropertyAtomic({ userId: req.user.id, property, gameLoop });
  } catch (err) {
    return next(err);
  }

  res.json({
    property,
    ...getPropertiesWithStatus(req.user.id),
  });
});

// ─── Rent a property (protected) ──────────────────────────────
// Upfront cost = deposit + one rent period. Then the game loop collects
// rent every RENT_PERIOD_MS until the player moves out or is evicted.
app.post('/api/properties/rent', authMiddleware, (req, res, next) => {
  const { property_id } = req.body || {};
  if (!property_id) {
    return res.status(400).json({ error: 'Property ID is required' });
  }
  const property = getProperty(property_id);
  if (!property) {
    return res.status(400).json({ error: 'Unknown property' });
  }

  let result;
  try {
    result = rentPropertyAtomic({ userId: req.user.id, property, gameLoop });
  } catch (err) {
    return next(err);
  }

  res.json({
    property,
    upfront: property.deposit + property.rentPerPeriod,
    rentPaidUntil: result.rentPaidUntil,
    ...getPropertiesWithStatus(req.user.id),
  });
});

// ─── Move into a property you own or rent (protected) ─────────
app.post('/api/properties/move-in', authMiddleware, (req, res) => {
  const { property_id } = req.body;
  if (!property_id) {
    return res.status(400).json({ error: 'Property ID is required' });
  }
  const property = getProperty(property_id);
  if (!property) {
    return res.status(400).json({ error: 'Unknown property' });
  }

  const row = getUserPropertyRow(req.user.id, property_id);
  if (!row) {
    return res.status(400).json({ error: 'You do not own or rent this property' });
  }

  setHome(req.user.id, property_id);
  res.json({
    property,
    ...getPropertiesWithStatus(req.user.id),
  });
});

// ─── List one of your properties for sale or rent ─────────────
// Selling and letting are player-to-player: the title moves, and the money
// moves with it. Prices are the owner's to set, within sane limits, and the
// server checks that the owner still owns what they are listing.
app.post('/api/properties/list', authMiddleware, (req, res) => {
  const propertyId = String(req.body?.property_id || '');
  const mode = String(req.body?.mode || '');
  const price = Math.round(Number(req.body?.price));
  const deposit = Math.round(Number(req.body?.deposit) || 0);

  const property = getProperty(propertyId);
  if (!property) return res.status(400).json({ error: 'Unknown property' });
  if (mode !== 'sale' && mode !== 'rent') {
    return res.status(400).json({ error: 'Choose whether to sell or rent it out' });
  }

  const row = getUserPropertyRow(req.user.id, propertyId);
  if (!row || row.tenure !== 'owned') {
    return res.status(400).json({ error: 'You can only list a property you own outright' });
  }

  // A tenth of the market value is the floor: a listing at ₦1 would just be a
  // gift with extra steps, and it makes the market untrustworthy.
  const floorSale = Math.round(property.price * 0.1);
  const floorRent = Math.round(property.rentPerPeriod * 0.1);
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'Set a price' });
  }
  if (mode === 'sale' && price < floorSale) {
    return res.status(400).json({ error: `The lowest you can list it for is ${naira(floorSale)}` });
  }
  if (mode === 'rent' && price < floorRent) {
    return res.status(400).json({ error: `The lowest rent you can ask is ${naira(floorRent)}` });
  }
  if (price > property.price * 20) {
    return res.status(400).json({ error: 'That price is too high to be taken seriously' });
  }
  if (mode === 'rent' && (deposit < 0 || deposit > price * 6)) {
    return res.status(400).json({ error: 'The deposit must be between nothing and six months of rent' });
  }

  const listing = createListing({
    userId: req.user.id,
    propertyId,
    mode,
    price,
    deposit: mode === 'rent' ? deposit : 0,
    rentPeriodMs: mode === 'rent' ? RENT_PERIOD_MS : 0,
  });

  logEvent('property_listed', {
    userId: req.user.id, propertyId, mode, price, ip: req.ip,
  });
  res.json({ listing, ...getPropertiesWithStatus(req.user.id) });
});

// ─── Take a listing down ─────────────────────────────────────
app.post('/api/properties/unlist', authMiddleware, (req, res) => {
  const propertyId = String(req.body?.property_id || '');
  if (!removeListing(req.user.id, propertyId)) {
    return res.status(400).json({ error: 'You have no listing on that property' });
  }
  res.json({ ok: true, ...getPropertiesWithStatus(req.user.id) });
});

// ─── Buy a property from another player ──────────────────────
app.post('/api/properties/buy-listing', authMiddleware, (req, res, next) => {
  const propertyId = String(req.body?.property_id || '');
  const listingId = Number(req.body?.listing_id);

  const property = getProperty(propertyId);
  if (!property) return res.status(400).json({ error: 'Unknown property' });

  const listings = getListingsForProperty(propertyId).filter((l) => l.mode === 'sale');
  if (!listings.length) return res.status(400).json({ error: 'That property is not for sale' });
  const listing = listingId
    ? listings.find((l) => l.id === listingId)
    : listings[0];
  if (!listing) return res.status(400).json({ error: 'That listing is no longer available' });

  let result;
  try {
    result = buyListingAtomic({
      sellerId: listing.owner_user_id,
      buyerId: req.user.id,
      property,
      listing,
      gameLoop,
    });
  } catch (err) {
    if (err.name === 'EconomyError' || err.status) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    return next(err);
  }

  logEvent('property_sold', {
    buyerId: req.user.id, sellerId: listing.owner_user_id,
    propertyId, price: result.paid, ip: req.ip,
  });
  res.json({
    property,
    paid: result.paid,
    seller: listing.owner_username,
    ...getPropertiesWithStatus(req.user.id),
  });
});

// ─── Rent from another player ────────────────────────────────
app.post('/api/properties/rent-listing', authMiddleware, (req, res, next) => {
  const propertyId = String(req.body?.property_id || '');
  const listingId = Number(req.body?.listing_id);

  const property = getProperty(propertyId);
  if (!property) return res.status(400).json({ error: 'Unknown property' });

  const listings = getListingsForProperty(propertyId).filter((l) => l.mode === 'rent');
  if (!listings.length) return res.status(400).json({ error: 'That property is not being let' });
  const listing = listingId ? listings.find((l) => l.id === listingId) : listings[0];
  if (!listing) return res.status(400).json({ error: 'That listing is no longer available' });

  let result;
  try {
    result = rentListingAtomic({
      landlordId: listing.owner_user_id,
      renterId: req.user.id,
      property,
      listing,
      gameLoop,
    });
  } catch (err) {
    if (err.name === 'EconomyError' || err.status) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    return next(err);
  }

  logEvent('property_let', {
    renterId: req.user.id, landlordId: listing.owner_user_id,
    propertyId, rent: listing.price, ip: req.ip,
  });
  res.json({
    property,
    upfront: listing.deposit + listing.price,
    landlord: listing.owner_username,
    ...getPropertiesWithStatus(req.user.id),
  });
});

// ─── Leaderboard (protected, Step 11) ─────────────────────────
app.get('/api/leaderboard', authMiddleware, (req, res) => {
  const rows = getLeaderboard(10);
  const entries = rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    tier: r.tier,
    netWorth: Math.round(r.net_worth),
    cash: Math.round(r.cash),
    bank: Math.round(r.bank_balance),
    isYou: r.username === req.user.username,
  }));

  // Make sure the requesting player can always find themselves.
  let yourRank = entries.find((e) => e.isYou) || null;
  if (!yourRank) {
    const all = getLeaderboard(100000);
    const idx = all.findIndex((r) => r.username === req.user.username);
    if (idx >= 0) {
      yourRank = {
        rank: idx + 1,
        username: all[idx].username,
        tier: all[idx].tier,
        netWorth: Math.round(all[idx].net_worth),
        cash: Math.round(all[idx].cash),
        bank: Math.round(all[idx].bank_balance),
        isYou: true,
      };
    }
  }

  res.json({ entries, you: yourRank, total: rows.length });
});

// ─── World interactions (protected, Step 10) ──────────────────
//
// Every route below checks that the player is standing near the relevant
// building using the position their client last reported. The check runs
// server-side, so a modified client cannot shop or bank from anywhere.

/** Distance check between a user's live position and an interaction point. */
function nearPoint(userId, point) {
  const pos = multiplayer.getPositionByUserId(userId);
  if (!pos) {
    return { ok: false, reason: 'You must be in the game world to do that' };
  }
  const dx = pos.x - point.position.x;
  const dz = pos.z - point.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const radius = point.radius || interactionConfig.defaultRadius;
  if (dist > radius) {
    return { ok: false, reason: `Too far away — walk to the ${point.name}` };
  }
  return { ok: true, distance: dist };
}

/**
 * The district the player is in, counting the building they are inside.
 *
 * Indoors the reported position is room-local, so it falls in no district at
 * all and a point test would quietly report "neutral ground" — which is how a
 * shoplifting spree in the marina could leave you spotless.
 *
 * @returns {object|null} the district row, or null when genuinely on no turf
 */
function playerDistrict(userId) {
  const pos = multiplayer.getPositionByUserId(userId);
  if (!pos) return null;
  return districtForPlayer(pos, multiplayer.getVenueByUserId(userId));
}

/**
 * Are the owners of this ground refusing to serve the player?
 *
 * This is the 3★ consequence from the wanted matrix, and it is enforced here
 * rather than described in the HUD: if you are hunted by the faction whose turf
 * you are standing in, their shops and fronts will not take your money.
 *
 * @returns {string|null} a reason to refuse, or null to allow the sale
 */
function serviceRefusalFor(userId) {
  const here = playerDistrict(userId);
  if (!here) return null;
  const refusal = serviceRefused(userId, here.id);
  if (!refusal.refused) return null;
  return `The ${refusal.factionName} have you at ${refusal.stars} stars. Nobody here will serve you.`;
}

/**
 * Where is this player banking from?
 *
 * Banking used to be outdoor-only: a `bank` interaction point on the pavement,
 * checked with `nearPoint`. But the city also has a bank *building* with a
 * teller counter, and standing at that counter you could not deposit a naira —
 * the button was scenery. This resolver accepts either: an outdoor point you
 * are standing next to, or the indoor branch, which the client reports as its
 * current venue exactly the way the shops already do.
 *
 * The venue is reported by the client, which is the same trust level as the
 * shop counters: a modified client could claim to be in the bank from anywhere.
 * That is an existing, documented trade-off (see venueConfig.js) and it moves
 * the player's own money between their own two pockets, so it cannot create
 * value — deposit and withdraw are atomic and both sides are the same user.
 */
function bankAccess(userId, pointId) {
  const venue = multiplayer.getVenueByUserId(userId);
  if (venue === 'in-bank') return { ok: true, where: 'in-bank' };

  const point = getInteractionPoint(pointId);
  if (!point || point.type !== 'bank') {
    return { ok: false, status: 400, reason: 'Not at a bank' };
  }
  const near = nearPoint(userId, point);
  if (!near.ok) return { ok: false, status: 400, reason: near.reason };
  return { ok: true, where: point.id };
}

// List interaction points + shop stock (no proximity requirement)
app.get('/api/interactions', authMiddleware, (req, res) => {
  res.json({
    points: interactionConfig.points,
    shopItems: interactionConfig.shopItems,
    minBankAmount: interactionConfig.minBankAmount,
    cash: gameLoop.getCash(req.user.id),
    bankBalance: req.user.bank_balance,
  });
});

// Deposit cash into the bank
app.post('/api/interactions/bank/deposit', authMiddleware, (req, res, next) => {
  const access = bankAccess(req.user.id, req.body?.point_id);
  if (!access.ok) return res.status(access.status).json({ error: access.reason });

  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < interactionConfig.minBankAmount) {
    return res.status(400).json({
      error: `Minimum deposit is ₦${interactionConfig.minBankAmount.toLocaleString('en-NG')}`,
    });
  }

  let result;
  try {
    result = depositAtomic({ userId: req.user.id, amount, gameLoop });
  } catch (err) {
    return next(err);
  }

  res.json({
    cash: result.cash,
    bankBalance: result.bankBalance,
    user: sanitizeUser(getUserById(req.user.id)),
  });
});

// Withdraw cash from the bank
app.post('/api/interactions/bank/withdraw', authMiddleware, (req, res, next) => {
  const access = bankAccess(req.user.id, req.body?.point_id);
  if (!access.ok) return res.status(access.status).json({ error: access.reason });

  const amount = Math.floor(Number(req.body?.amount));
  if (!Number.isFinite(amount) || amount < interactionConfig.minBankAmount) {
    return res.status(400).json({
      error: `Minimum withdrawal is ₦${interactionConfig.minBankAmount.toLocaleString('en-NG')}`,
    });
  }

  let result;
  try {
    result = withdrawAtomic({ userId: req.user.id, amount, gameLoop });
  } catch (err) {
    return next(err);
  }

  res.json({
    cash: result.cash,
    bankBalance: result.bankBalance,
    user: sanitizeUser(getUserById(req.user.id)),
  });
});

// Buy an item from a shop — the effect is applied immediately
app.post('/api/interactions/shop/buy', authMiddleware, (req, res, next) => {
  const point = getInteractionPoint(req.body?.point_id);
  if (!point || point.type !== 'shop') {
    return res.status(400).json({ error: 'Not a shop' });
  }

  const item = getShopItem(req.body?.item_id);
  if (!item) {
    return res.status(400).json({ error: 'Unknown item' });
  }

  const near = nearPoint(req.user.id, point);
  if (!near.ok) return res.status(400).json({ error: near.reason });

  const refused = serviceRefusalFor(req.user.id);
  if (refused) return res.status(403).json({ error: refused, refused: true });

  let result;
  try {
    result = buyItemAtomic({ userId: req.user.id, item, gameLoop });
  } catch (err) {
    return next(err);
  }

  // Money has moved — now apply the need effects.
  gameLoop.applyNeedDelta(req.user.id, item.effects);

  res.json({
    item,
    cash: result.cash,
    user: sanitizeUser(getUserById(req.user.id)),
  });
});

// ─── Venue shops: buying things from inside a shop ───────────
// The outdoor shop points above are kiosks on the pavement. These are the shops
// you walk into: a supermarket, the market hall, an airport duty-free.
//
// The player must report being inside the venue for the purchase to be
// accepted. The catalogue, the prices and the effects all live on the server,
// so a modified client can make itself poorer but cannot make itself richer.
app.get('/api/venues', authMiddleware, (req, res) => {
  const venueId = multiplayer.getVenueByUserId(req.user.id);
  const stock = getVenueStock(venueId);
  res.json({
    venue: venueId,
    venues: listVenues(),
    stock,
    cash: gameLoop.getCash(req.user.id),
    bankBalance: req.user.bank_balance,
  });
});

// ─── Who is behind the counter ───
// The panel asks who is in the room the player reports being in. The server
// answers with the attendant for that kind of room and the services they
// actually perform — so the buttons on the panel are the ones the service
// endpoint will accept, not a list the client made up.
app.get('/api/venue/staff', authMiddleware, (req, res) => {
  const venue = multiplayer.getVenueByUserId(req.user.id);
  const kind = venueKind(venue);
  const staff = staffFor(kind);
  res.json({
    venue,
    kind,
    staff: staff
      ? {
        ...staff,
        services: staff.services
          .map((id) => serviceConfig.get(id))
          .filter(Boolean)
          .map((svc) => ({
            id: svc.id, name: svc.name, cost: svc.cost, cooldownMs: svc.cooldownMs, effects: svc.effects,
          })),
      }
      : null,
  });
});

// ─── Home utilities: the meter, the tank, the gas, the roof ───
// Everything the home runs on. The readings live in the database and drain
// with the game clock; the client only ever asks to buy or to switch something.
app.get('/api/home/utilities', authMiddleware, (req, res) => {
  res.json({
    utilities: getUtilities(req.user.id),
    catalogue: utilityCatalogue(),
    cash: gameLoop.getCash(req.user.id),
  });
});

app.post('/api/home/utilities/topup', authMiddleware, (req, res, next) => {
  try {
    const result = topUp({
      userId: req.user.id,
      kind: String(req.body?.kind || ''),
      bundleId: String(req.body?.bundle || ''),
      gameLoop,
    });
    res.json({ ...result, user: sanitizeUser(getUserById(req.user.id)) });
  } catch (err) { next(err); }
});

app.post('/api/home/utilities/toggle', authMiddleware, (req, res, next) => {
  try {
    const utilities = toggleAppliance(req.user.id, String(req.body?.appliance || ''));
    res.json({ utilities });
  } catch (err) { next(err); }
});

app.post('/api/home/utilities/solar', authMiddleware, (req, res, next) => {
  try {
    const result = buySolar({ userId: req.user.id, gameLoop });
    res.json({ ...result, user: sanitizeUser(getUserById(req.user.id)) });
  } catch (err) { next(err); }
});

// ─── Wanted levels: the 3 × 4 faction matrix (blueprint Part H) ───
// The client never sends a star count. It reports an action, the server decides
// whether that was a crime, who owns the ground it happened on, and how many
// stars it is worth.
app.get('/api/wanted', authMiddleware, (req, res) => {
  const here = playerDistrict(req.user.id);
  const refusal = here ? serviceRefused(req.user.id, here.id) : { refused: false };
  res.json({
    wanted: getWanted(req.user.id),
    here: here ? { id: here.id, name: here.name, faction: here.faction } : null,
    serviceRefused: refusal.refused,
    refusalReason: refusal.refused
      ? `The ${refusal.factionName} have you at ${refusal.stars} stars — their fronts will not serve you.`
      : null,
    // The board carries the player's own cash so the panel can grey out bribes
    // they cannot afford without a second request.
    cash: getUserById(req.user.id)?.cash ?? 0,
    mostWanted: mostWanted(5).map((row) => ({
      ...row,
      short: FACTIONS[row.faction]?.short || row.faction,
      you: row.userId === req.user.id,
    })),
  });
});

app.post('/api/crime', authMiddleware, (req, res, next) => {
  try {
    const crime = String(req.body?.crime || '');
    const def = CRIMES[crime];
    if (!def) return res.status(400).json({ error: 'That is not something you can do' });

    // Where the player actually is, from the server's own record — never from
    // the request body, or the client could pick a neutral district.
    if (!multiplayer.getPositionByUserId(req.user.id)) {
      return res.status(400).json({ error: 'You must be in the world to do that' });
    }
    const district = playerDistrict(req.user.id);

    // Preconditions that make the crime real rather than a button that pays out.
    if (def.needsVenue) {
      const inside = multiplayer.getVenueByUserId(req.user.id);
      if (!inside) return res.status(400).json({ error: 'You are not inside a shop' });
    }
    if (def.needsUnownedProperty) {
      const propertyId = String(req.body?.propertyId || '');
      const user = getUserById(req.user.id);
      if (user?.home_property === propertyId) {
        return res.status(400).json({ error: 'That is your own home' });
      }
    }
    if (def.needsVehicle) {
      const vid = Number(req.body?.vehicleId);
      if (!Number.isFinite(vid) || vid <= 0) {
        return res.status(400).json({ error: 'Which vehicle?' });
      }
    }

    // A crime has to be worth something, or it is just a punishment button.
    // Shoplifting puts a real item from that venue's shelf into the player's
    // inventory — and the attendant may notice, which costs stars instead.
    let loot = null;
    let caught = false;
    if (def.takesStock) {
      const inside = multiplayer.getVenueByUserId(req.user.id);
      const stock = inside ? getVenueStock(inside) : [];
      if (!stock.length) {
        return res.status(400).json({ error: 'There is nothing on these shelves worth taking' });
      }
      const picked = stock[randomInt(stock.length)];
      // The more heat you are already carrying, the more eyes are on you. Base
      // 20%, plus 12 points a star, capped so a lift is never a certainty.
      const heatStars = district?.faction ? starsFor(req.user.id, district.faction) : 0;
      const caughtChance = Math.min(0.7, 0.2 + 0.12 * heatStars);
      caught = Math.random() < caughtChance;
      if (!caught) {
        addInventoryItem(req.user.id, picked.id, 1);
        loot = { id: picked.id, name: picked.name, icon: picked.icon };
      }
    }

    const result = recordCrime({
      userId: req.user.id,
      crime,
      districtId: district?.id,
    });

    // 4★ in the turf you are standing in is an immediate arrest.
    const warrant = arrestWarrant(req.user.id, district?.id);
    if (warrant.warrant) {
      const busted = arrest({ userId: req.user.id, gameLoop });
      logEvent('player_arrested', { userId: req.user.id, faction: warrant.faction, fine: busted.fine });
      return res.json({
        ...result, arrested: true, ...busted, loot, caught,
        wanted: getWanted(req.user.id),
        user: sanitizeUser(getUserById(req.user.id)),
      });
    }

    res.json({ ...result, arrested: false, caught, loot, wanted: getWanted(req.user.id) });
  } catch (err) { next(err); }
});

// ── Test hook: seat real heat on a real account ─────────────
// The wanted UI can only be tested in a browser if the account it is looking at
// is genuinely wanted, and the honest ways to become wanted (shoplifting inside
// a shop, a break-in) need a player standing in an interior. This endpoint runs
// the same recordCrime() the game runs, so what the browser then reads back is
// real heat — but it is a test seam, so it is off unless the server was started
// with NL_TEST_HOOKS=1 and it refuses to exist in production.
if (process.env.NL_TEST_HOOKS === '1' && process.env.NODE_ENV !== 'production') {
  app.post('/api/dev/heat', authMiddleware, (req, res, next) => {
    try {
      const factionId = String(req.body?.factionId || 'kings');
      const stars = Math.max(0, Math.min(MAX_STARS, Number(req.body?.stars) || 0));
      const faction = FACTIONS[factionId];
      if (!faction) return res.status(400).json({ error: 'Unknown faction' });
      clearWanted(req.user.id);
      // recordCrime() caps per-crime weight at 4, so reach the requested level by
      // repeating the heaviest crime in that faction's own turf.
      const district = DISTRICTS.find((d) => d.faction === factionId);
      while (starsFor(req.user.id, factionId) < stars && district) {
        recordCrime({ userId: req.user.id, crime: 'assault', districtId: district.id });
        if (starsFor(req.user.id, factionId) >= MAX_STARS) break;
      }
      res.json({ ok: true, wanted: getWanted(req.user.id) });
    } catch (err) {
      next(err);
    }
  });
}

app.post('/api/wanted/bribe', authMiddleware, (req, res, next) => {
  try {
    const factionId = String(req.body?.factionId || '');
    if (!FACTIONS[factionId]) return res.status(400).json({ error: 'Unknown faction' });
    const result = payBribe({ userId: req.user.id, factionId, gameLoop });
    logEvent('bribe_paid', { userId: req.user.id, faction: factionId, paid: result.paid });
    res.json({ ...result, wanted: getWanted(req.user.id), user: sanitizeUser(getUserById(req.user.id)) });
  } catch (err) {
    if (err.message) return res.status(400).json({ error: err.message });
    return next(err);
  }
});

app.post('/api/interactions/venue/buy', authMiddleware, (req, res, next) => {
  const venueId = String(req.body?.venue_id || '');
  const itemId = String(req.body?.item_id || '');

  const shop = getVenueShop(venueId);
  if (!shop) return res.status(400).json({ error: 'That place does not sell anything' });

  const inside = multiplayer.getVenueByUserId(req.user.id);
  if (inside !== venueId) {
    return res.status(400).json({ error: `You have to be inside ${shop.name} to buy that` });
  }

  const refused = serviceRefusalFor(req.user.id);
  if (refused) return res.status(403).json({ error: refused, refused: true });

  const item = getVenueItem(itemId);
  if (!item || !shop.stock.includes(itemId)) {
    return res.status(400).json({ error: 'They do not sell that here' });
  }

  let result;
  try {
    result = buyItemAtomic({ userId: req.user.id, item, gameLoop });
  } catch (err) {
    return next(err);
  }

  gameLoop.applyNeedDelta(req.user.id, item.effects);

  res.json({
    item,
    venue: shop.name,
    cash: result.cash,
    user: sanitizeUser(getUserById(req.user.id)),
  });
});

// ─── Socket.IO ─────────────────────────────────────────────────
/**
 * Real client IP for a socket.
 * Behind a reverse proxy every connection appears to come from the proxy,
 * which would make the per-IP connection cap throttle the whole world — so
 * honour X-Forwarded-For when running in production behind a trusted proxy.
 */
function socketClientIp(socket) {
  if (process.env.NODE_ENV === 'production') {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      return forwarded.split(',')[0].trim();
    }
  }
  return socket.handshake.address || 'unknown';
}

const io = new Server(server, {
  cors: { origin: clientOrigin },
});

// Game loop and multiplayer are constructed before any socket middleware so
// the middleware can safely reference them.
const gameLoop = new GameLoop(io);
gameLoop.start();

const multiplayer = new Multiplayer(io, gameLoop);
multiplayer.start();

// Socket auth middleware — verifies JWT on connection
io.use((socket, next) => {
  // Cheap connection caps, checked before any expensive work.
  const ip = socketClientIp(socket);
  if (multiplayer.connectionCountForIp(ip) >= multiplayerConfig.maxConnectionsPerIp) {
    logEvent('socket_cap_exceeded', { ip });
    return next(new Error('Too many connections from this address'));
  }

  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('No token provided'));
  }
  try {
    const decoded = verifyToken(token);
    socket.userId = decoded.id;
    socket.username = decoded.username;
    socket.clientIp = ip;
    next();
  } catch (err) {
    // Distinguish a revoked session so the client can prompt a fresh login.
    if (err.code === 'TOKEN_REVOKED') {
      return next(new Error('Session ended'));
    }
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} (${socket.username})`);
  gameLoop.registerPlayer(socket);

  // Join the shared world. The user row gives us name + avatar colours.
  multiplayer.registerPlayer(socket, getUserById(socket.userId));

  // Movement — clients report their own position; the server validates it.
  socket.on('player:move', (data) => {
    multiplayer.updatePosition(socket, data);
  });

  // Text chat
  socket.on('chat:message', (text) => {
    multiplayer.handleChat(socket, text);
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    gameLoop.unregisterPlayer(socket);
    multiplayer.unregisterPlayer(socket);
  });
});

// ─── Open world: inventory, missions, vehicles, save ──────────
registerWorldRoutes(app, {
  authMiddleware,
  gameLoop,
  multiplayer,
  logEvent,
});

// ─── Static client (single-deployment mode) ───────────────────
//
// If client/dist exists the server also serves the built game, so one
// process can run the whole thing in production. In development you can
// keep using the Vite dev server on :5173 instead — this block simply
// does nothing if there is no build.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    // Hashed asset filenames can be cached hard; index.html must not be.
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // SPA fallback — any non-API route returns index.html so a deep link
  // (or a refresh) doesn't 404.
  app.get(/^(?!\/api\/|\/socket\.io\/).*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  console.log('Serving built client from client/dist — open the game at the server URL.');
}

// ─── 404 ──────────────────────────────────────────────────────
// Registered in BOTH modes: unmatched /api routes (and any non-GET that the
// SPA fallback doesn't handle) must return JSON, never Express's HTML page.
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Never leak stack traces or internals to the client.
app.use((err, req, res, next) => {
  logEvent('unhandled_error', {
    path: req.path,
    message: err?.message,
    name: err?.name,
  });
  if (res.headersSent) return next(err);
  // EconomyError carries a deliberate 4xx status with a user-facing message.
  if (err instanceof EconomyError) {
    return res.status(err.status).json({ error: err.message });
  }
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
});

// ─── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`NewLife server running on http://localhost:${PORT}`);
});
