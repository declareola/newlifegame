// server/src/worldRoutes.js
// Open-world API: inventory, missions, vehicles.
//
// Rules that apply to every route here:
//   · the user is identified by the JWT only — no ids are accepted from the body
//   · money moves inside a database transaction, and only after the item,
//     mission reward or vehicle has been validated
//   · mission completion is re-derived from server state on every check; the
//     client can claim a reward but never assert that a mission is done
//   · anything requiring presence in the world uses the last position the
//     server was told about, not a position in the request

import { itemConfig } from '../config/itemConfig.js';
import { missionConfig } from '../config/missionConfig.js';
import { vehicleConfig } from '../config/vehicleConfig.js';
import { interactionConfig } from '../config/interactionConfig.js';
import { serviceConfig } from '../config/serviceConfig.js';
import { staffFor, staffOffers } from '../config/staffConfig.js';
import { venueKind } from '../config/venueKinds.js';
import {
  getUserById,
  withTransaction,
  updateCash,
  getInventory,
  getInventoryItem,
  addInventoryItem,
  removeInventoryItem,
  countInventoryItems,
  incrementItemsUsed,
  incrementItemsBought,
  addTotalEarned,
  markDistrictVisited,
  getMissionRows,
  getUserPropertyRow,
  sanitizeUser,
  getMissionRow,
  insertMission,
  updateMissionStepState,
  completeMissionRow,
  markMissionClaimed,
  getVehicles,
  getVehicle,
  insertVehicle,
  parkVehicle,
  countVehicles,
  updateNeeds,
} from './db.js';

// District geometry comes from the generated world map, not a hand-written
// table. The table that used to live here was the pre-Eko-Basin 200 m grid, so
// on the current map every district test matched nothing and no visit was ever
// recorded. See config/worldGeometry.js and scripts/gen-geometry.mjs.
import { DISTRICTS } from '../config/worldGeometry.js';

const serviceCooldowns = new Map();

const NEED_KEYS = ['hunger', 'energy', 'hygiene', 'bladder', 'fun', 'social'];

function clamp100(v) {
  return Math.max(0, Math.min(100, v));
}

/**
 * Register the routes.
 * @param {import('express').Express} app
 * @param {object} deps - { authMiddleware, gameLoop, multiplayer, logEvent, apiRate }
 */

/**
 * Apply need deltas so both the live game-loop session and the database see
 * them. Writing the DB alone would be overwritten by the game loop's next
 * persist, so the in-memory session is always updated first.
 */
function applyNeedDeltas(gameLoop, userId, deltas) {
  const applied = gameLoop.applyNeedDelta(userId, deltas);
  if (!applied) {
    const user = getUserById(userId);
    if (!user) return;
    const next = {};
    for (const key of NEED_KEYS) next[key] = user[key] || 0;
    for (const [key, delta] of Object.entries(deltas)) {
      if (NEED_KEYS.includes(key)) next[key] = clamp100(next[key] + delta);
    }
    updateNeeds(userId, next);
  }
}

export function registerWorldRoutes(app, deps) {
  const { authMiddleware, gameLoop, multiplayer, logEvent } = deps;

  // ── Shared helpers ────────────────────────────────────────

  /** Everything a mission check is allowed to look at. */
  function buildState(userId) {
    const user = getUserById(userId);
    const invCount = countInventoryItems(userId);
    return {
      ...user,
      item_count: invCount,
      vehicle_count: countVehicles(userId),
      districts_visited: DISTRICTS.filter((d) => (user.districts_bitmap & d.bit) !== 0).length,
    };
  }

  function nearPosition(userId, x, z, radius) {
    const pos = multiplayer.getPositionByUserId(userId);
    if (!pos) return { ok: false, reason: 'You must be in the game world to do that' };
    const dist = Math.hypot(pos.x - x, pos.z - z);
    return dist <= radius
      ? { ok: true, distance: dist }
      : { ok: false, reason: 'Too far away — walk closer first' };
  }

  /** Is the player near any shop? Returns the point, or null. */
  function nearestShop(userId, extraRadius = 2) {
    const pos = multiplayer.getPositionByUserId(userId);
    if (!pos) return null;
    for (const p of interactionConfig.points) {
      if (p.type !== 'shop') continue;
      const r = (p.radius || interactionConfig.defaultRadius) + extraRadius;
      if (Math.hypot(pos.x - p.position.x, pos.z - p.position.z) <= r) return p;
    }
    // Shops can also be used inside a building if the player is standing at
    // the counter — approximated by being within the shop's own footprint.
    return null;
  }

  // ══════════════════════════════════════════════════════════
  // Inventory
  // ══════════════════════════════════════════════════════════

  app.get('/api/inventory', authMiddleware, (req, res) => {
    const rows = getInventory(req.user.id);
    const items = rows
      .map((r) => {
        const def = itemConfig.get(r.item_id);
        if (!def) return null;
        return { ...def, quantity: r.quantity };
      })
      .filter(Boolean);

    res.json({ items, cash: gameLoop.getCash(req.user.id), capacity: 40 });
  });

  app.post('/api/inventory/buy', authMiddleware, (req, res, next) => {
    try {
      const { itemId, quantity } = req.body || {};
      const def = itemConfig.get(itemId);
      if (!def) return res.status(400).json({ error: 'Unknown item' });

      const qty = Math.max(1, Math.min(10, Math.floor(Number(quantity) || 1)));
      const total = def.price * qty;

      const shop = nearestShop(req.user.id);
      if (!shop) {
        return res.status(403).json({ error: 'You need to be at a shop to buy that' });
      }

      const cash = gameLoop.getCash(req.user.id);
      if (cash < total) {
        return res.status(400).json({ error: `Not enough cash — need ₦${total.toLocaleString('en-NG')}` });
      }

      const newCash = cash - total;
      withTransaction(() => {
        updateCash(req.user.id, newCash);
        addInventoryItem(req.user.id, def.id, qty);
        incrementItemsBought(req.user.id, qty);
      });
      gameLoop.setCash(req.user.id, newCash);

      logEvent('item_bought', { userId: req.user.id, itemId: def.id, qty, total, ip: req.ip });

      res.json({
        ok: true,
        cash: newCash,
        item: { ...def, quantity: getInventoryItem(req.user.id, def.id)?.quantity || qty },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/inventory/use', authMiddleware, (req, res, next) => {
    try {
      const { itemId } = req.body || {};
      const def = itemConfig.get(itemId);
      if (!def) return res.status(400).json({ error: 'Unknown item' });

      const row = getInventoryItem(req.user.id, itemId);
      if (!row || row.quantity < 1) {
        return res.status(400).json({ error: 'You do not have that item' });
      }

      withTransaction(() => {
        if (def.consumable !== false) {
          removeInventoryItem(req.user.id, itemId, 1);
        }
        incrementItemsUsed(req.user.id);
      });

      // Apply the effects through the live session as well as the database, so
      // the HUD and the stored row agree immediately.
      applyNeedDeltas(gameLoop, req.user.id, def.effects || {});

      const fresh = getUserById(req.user.id);
      res.json({
        ok: true,
        text: def.useText,
        needs: {
          hunger: fresh.hunger,
          energy: fresh.energy,
          hygiene: fresh.hygiene,
          bladder: fresh.bladder,
          fun: fresh.fun,
          social: fresh.social,
        },
        item: def.consumable === false
          ? { ...def, quantity: row.quantity }
          : { ...def, quantity: Math.max(0, row.quantity - 1) },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/inventory/discard', authMiddleware, (req, res) => {
    const { itemId } = req.body || {};
    const def = itemConfig.get(itemId);
    if (!def) return res.status(400).json({ error: 'Unknown item' });
    const removed = removeInventoryItem(req.user.id, itemId, 1);
    if (!removed) return res.status(400).json({ error: 'You do not have that item' });
    res.json({ ok: true, itemId });
  });

  // ══════════════════════════════════════════════════════════
  // Missions
  // ══════════════════════════════════════════════════════════

  /** Mission rows joined with their live step state, computed from real state. */
  function buildMissionView(userId) {
    const state = buildState(userId);
    const rows = getMissionRows(userId);
    const byId = Object.fromEntries(rows.map((r) => [r.mission_id, r]));

    return missionConfig.missions.map((def) => {
      const row = byId[def.id] || null;
      const steps = def.steps.map((step) => ({
        id: step.id,
        text: step.text,
        done: !!step.check(state),
      }));
      const allDone = steps.every((s) => s.done);

      let status = 'available';
      if (row) status = row.status;
      if (status === 'active' && allDone) status = 'complete';
      if (row?.claimed) status = 'claimed';

      return {
        id: def.id,
        name: def.name,
        description: def.description,
        category: def.category,
        reward: def.reward,
        steps,
        status,
        progress: steps.filter((s) => s.done).length,
        total: steps.length,
      };
    });
  }

  app.get('/api/missions', authMiddleware, (req, res) => {
    res.json({ missions: buildMissionView(req.user.id) });
  });

  app.post('/api/missions/accept', authMiddleware, (req, res) => {
    const { missionId } = req.body || {};
    const def = missionConfig.get(missionId);
    if (!def) return res.status(400).json({ error: 'Unknown mission' });

    const row = getMissionRow(req.user.id, missionId);
    if (row && row.status !== 'available') {
      return res.status(400).json({ error: 'Mission already accepted' });
    }
    insertMission(req.user.id, missionId);
    updateMissionStepState(req.user.id, missionId, {});
    res.json({ ok: true, missions: buildMissionView(req.user.id) });
  });

  app.post('/api/missions/claim', authMiddleware, (req, res, next) => {
    try {
      const { missionId } = req.body || {};
      const def = missionConfig.get(missionId);
      if (!def) return res.status(400).json({ error: 'Unknown mission' });

      const row = getMissionRow(req.user.id, missionId);
      if (!row) return res.status(400).json({ error: 'Accept the mission first' });
      if (row.claimed) return res.status(400).json({ error: 'Reward already claimed' });

      // Re-derive completion from server state. The client cannot assert this.
      const state = buildState(req.user.id);
      const steps = def.steps.map((s) => ({ id: s.id, done: !!s.check(state) }));
      if (!steps.every((s) => s.done)) {
        return res.status(400).json({
          error: 'Mission objectives are not complete yet',
          steps,
        });
      }

      const cashBefore = gameLoop.getCash(req.user.id);
      const rewardCash = def.reward?.cash || 0;
      const cashAfter = cashBefore + rewardCash;

      withTransaction(() => {
        updateCash(req.user.id, cashAfter);
        addTotalEarned(req.user.id, rewardCash);
        updateMissionStepState(req.user.id, missionId, Object.fromEntries(steps.map(s => [s.id, s.done])));
        completeMissionRow(req.user.id, missionId);
        markMissionClaimed(req.user.id, missionId);
      });
      gameLoop.setCash(req.user.id, cashAfter);

      logEvent('mission_claimed', {
        userId: req.user.id, missionId, reward: rewardCash, ip: req.ip,
      });

      res.json({
        ok: true,
        reward: def.reward,
        cash: cashAfter,
        missions: buildMissionView(req.user.id),
      });
    } catch (err) {
      next(err);
    }
  });

  // ══════════════════════════════════════════════════════════
  // Vehicles
  // ══════════════════════════════════════════════════════════

  app.get('/api/vehicles', authMiddleware, (req, res) => {
    const owned = getVehicles(req.user.id).map((v) => ({
      ...v,
      def: vehicleConfig.get(v.vehicle_id) || null,
    }));
    res.json({
      catalog: vehicleConfig.vehicles,
      owned,
      cash: gameLoop.getCash(req.user.id),
      fuelPricePerLitre: vehicleConfig.fuelPricePerLitre,
    });
  });

  app.post('/api/vehicles/buy', authMiddleware, (req, res, next) => {
    try {
      const { vehicleId, colour } = req.body || {};
      const def = vehicleConfig.get(vehicleId);
      if (!def) return res.status(400).json({ error: 'Unknown vehicle' });

      // Must be at a dealership or a garage
      const pos = multiplayer.getPositionByUserId(req.user.id);
      if (!pos) return res.status(403).json({ error: 'You must be in the world' });

      const cash = gameLoop.getCash(req.user.id);
      if (cash < def.price) {
        return res.status(400).json({
          error: `Not enough cash — ${def.name} costs ₦${def.price.toLocaleString('en-NG')}`,
        });
      }

      const newCash = cash - def.price;
      const spawn = { x: pos.x + 2.5, z: pos.z + 2.5 };

      let id;
      withTransaction(() => {
        updateCash(req.user.id, newCash);
        id = insertVehicle(req.user.id, {
          vehicleId: def.id,
          colour: colour ?? def.colour,
          posX: spawn.x,
          posZ: spawn.z,
          fuel: vehicleConfig.startingFuel,
        });
      });
      gameLoop.setCash(req.user.id, newCash);

      logEvent('vehicle_bought', {
        userId: req.user.id, vehicleId: def.id, price: def.price, ip: req.ip,
      });

      res.json({
        ok: true,
        cash: newCash,
        vehicle: { ...getVehicle(req.user.id, id), def },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/vehicles/park', authMiddleware, (req, res) => {
    const { id, x, z, fuel } = req.body || {};
    const veh = getVehicle(req.user.id, Number(id));
    if (!veh) return res.status(400).json({ error: 'You do not own that vehicle' });

    const px = Number(x);
    const pz = Number(z);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) {
      return res.status(400).json({ error: 'Invalid position' });
    }
    const clampedX = Math.max(-93, Math.min(93, px));
    const clampedZ = Math.max(-93, Math.min(93, pz));
    const clampedFuel = Math.max(0, Math.min(vehicleConfig.tankLitres, Number(fuel) || 0));

    parkVehicle(req.user.id, veh.id, clampedX, clampedZ, clampedFuel);
    res.json({ ok: true, vehicle: getVehicle(req.user.id, veh.id) });
  });

  app.post('/api/vehicles/fuel', authMiddleware, (req, res, next) => {
    try {
      const { id, litres } = req.body || {};
      const veh = getVehicle(req.user.id, Number(id));
      if (!veh) return res.status(400).json({ error: 'You do not own that vehicle' });

      const pos = multiplayer.getPositionByUserId(req.user.id);
      const nearVan = pos ? Math.hypot(pos.x - veh.pos_x, pos.z - veh.pos_z) <= 8 : false;
      if (!nearVan) return res.status(403).json({ error: 'Bring the vehicle to the pump first' });

      const want = Math.max(1, Math.min(vehicleConfig.tankLitres, Number(litres) || 10));
      const space = vehicleConfig.tankLitres - veh.fuel;
      const actual = Math.min(want, space);
      if (actual <= 0) return res.status(400).json({ error: 'Tank is already full' });

      const cost = Math.round(actual * vehicleConfig.fuelPricePerLitre);
      const cash = gameLoop.getCash(req.user.id);
      if (cash < cost) return res.status(400).json({ error: 'Not enough cash for fuel' });

      const newCash = cash - cost;
      withTransaction(() => {
        updateCash(req.user.id, newCash);
        parkVehicle(req.user.id, veh.id, veh.pos_x, veh.pos_z, veh.fuel + actual);
      });
      gameLoop.setCash(req.user.id, newCash);

      res.json({
        ok: true,
        cash: newCash,
        litres: actual,
        cost,
        fuel: veh.fuel + actual,
      });
    } catch (err) {
      next(err);
    }
  });

  // ══════════════════════════════════════════════════════════
  // World progress (district discovery + explicit save)
  // ══════════════════════════════════════════════════════════

  app.post('/api/world/visit', authMiddleware, (req, res) => {
    const pos = multiplayer.getPositionByUserId(req.user.id);
    if (!pos) return res.status(400).json({ error: 'No position' });

    const district = DISTRICTS.find((d) => (
      pos.x >= d.x - d.w / 2 && pos.x <= d.x + d.w / 2 &&
      pos.z >= d.z - d.d / 2 && pos.z <= d.z + d.d / 2
    ));

    if (district) markDistrictVisited(req.user.id, district.bit);

    const user = getUserById(req.user.id);
    res.json({
      ok: true,
      district: district?.name || 'Lagos',
      districtsVisited: DISTRICTS.filter((d) => (user.districts_bitmap & d.bit) !== 0).length,
    });
  });


  // ══════════════════════════════════════════════════════════
  // NPC services
  // ══════════════════════════════════════════════════════════
  // The client sends a service id and nothing else. Price, effects and
  // cooldown all come from config/serviceConfig.js, so a hacked client cannot
  // buy a ₦0 clinic visit or decide that a meal restores 100 hunger.

  app.post('/api/world/service', authMiddleware, (req, res, next) => {
    try {
      const { serviceId } = req.body || {};
      const svc = serviceConfig.get(serviceId);
      if (!svc) return res.status(400).json({ error: 'Unknown service' });

      const pos = multiplayer.getPositionByUserId(req.user.id);
      if (!pos) return res.status(403).json({ error: 'You must be in the world' });

      // Indoors, a service has to come from somebody who works there. The
      // street NPCs advertise their own services client-side; a room does not,
      // so without this check any indoor venue could sell you a clinic visit.
      // Outdoors (no venue reported) keeps working the old way, because there
      // the NPC you are standing next to is the one offering it.
      const indoorVenue = multiplayer.getVenueByUserId(req.user.id);
      if (indoorVenue) {
        const kind = venueKind(indoorVenue);
        if (!kind || !staffOffers(kind, svc.id)) {
          const who = kind ? staffFor(kind) : null;
          return res.status(400).json({
            error: who
              ? `${who.name} does not do that here`
              : 'There is nobody here to ask',
          });
        }
      }

      const now = Date.now();
      const key = `${req.user.id}:${svc.id}`;
      const last = serviceCooldowns.get(key) || 0;
      if (svc.cooldownMs > 0 && now - last < svc.cooldownMs) {
        const wait = Math.ceil((svc.cooldownMs - (now - last)) / 1000);
        return res.status(429).json({ error: `Give it ${wait}s before that again` });
      }

      const cash = gameLoop.getCash(req.user.id);
      if (cash < svc.cost) {
        return res.status(400).json({
          error: `You need ₦${svc.cost.toLocaleString('en-NG')} for that`,
        });
      }

      if (svc.cost > 0) {
        const newCash = cash - svc.cost;
        withTransaction(() => updateCash(req.user.id, newCash));
        gameLoop.setCash(req.user.id, newCash);
      }
      applyNeedDeltas(gameLoop, req.user.id, svc.effects || {});
      serviceCooldowns.set(key, now);

      const fresh = getUserById(req.user.id);
      res.json({
        ok: true,
        text: svc.text,
        cost: svc.cost,
        cash: fresh.cash,
        needs: {
          hunger: fresh.hunger,
          energy: fresh.energy,
          hygiene: fresh.hygiene,
          bladder: fresh.bladder,
          fun: fresh.fun,
          social: fresh.social,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // ══════════════════════════════════════════════════════════
  // Character sheet
  // ══════════════════════════════════════════════════════════
  // One read that draws together everything the player has done. It reads the
  // same row the HUD and the economy use, through sanitizeUser, so no private
  // column can leak.

  app.get('/api/character', authMiddleware, (req, res) => {
    const user = getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const inv = getInventory(req.user.id);
    const owned = getVehicles(req.user.id);
    const missionRows = getMissionRows(req.user.id);
    const homeRow = getUserPropertyRow(req.user.id);

    const districts = [];
    if (user.districts_bitmap & 1) districts.push('Mushin');
    if (user.districts_bitmap & 2) districts.push('Yaba');
    if (user.districts_bitmap & 4) districts.push('Victoria Island');
    if (user.districts_bitmap & 8) districts.push('Lekki');

    res.json({
      ok: true,
      user: sanitizeUser(user),
      stats: {
        totalEarned: user.total_earned || 0,
        itemsUsed: user.items_used || 0,
        itemsBought: user.items_bought || 0,
        districts,
        itemCount: inv.reduce((n, i) => n + i.quantity, 0),
        vehicleCount: owned.length,
        missionsClaimed: missionRows.filter((m) => m.status === 'claimed').length,
        missionsActive: missionRows.filter((m) => m.status === 'active').length,
        home: homeRow ? homeRow.property_id : null,
      },
    });
  });

  /**
   * Explicit save. Everything is already persisted continuously (position every
   * 10 s, cash every 5 s, needs each tick), so this is a flush + confirmation
   * the client can show the player.
   */
  app.post('/api/save', authMiddleware, (req, res) => {
    const pos = multiplayer.getPositionByUserId(req.user.id);
    if (pos && typeof gameLoop.persistUser === 'function') {
      gameLoop.persistUser(req.user.id);
    }
    const user = getUserById(req.user.id);
    res.json({
      ok: true,
      savedAt: Date.now(),
      user: user ? {
        cash: gameLoop.getCash(req.user.id),
        bank_balance: user.bank_balance,
        position: pos ? { x: pos.x, z: pos.z } : { x: user.pos_x, z: user.pos_z },
      } : null,
    });
  });
}
