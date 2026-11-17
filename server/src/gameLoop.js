import { needsConfig } from '../config/needsConfig.js';
import { jobConfig, incomePerTick } from '../config/jobConfig.js';
import { activityConfig, STAT_KEYS, NEED_KEYS } from '../config/activityConfig.js';
import { RENT_PERIOD_MS, getProperty } from '../config/propertyConfig.js';
import {
  getUserById,
  updateNeeds,
  updateCash,
  cancelActivity,
  updateStats,
  getRental,
  extendRent,
  endRental,
  deductBank,
} from './db.js';

/**
 * Server-authoritative game loop.
 *
 * Responsibilities:
 *  - Decays all six needs every tickInterval (5 s)
 *  - Broadcasts player state to each connected client
 *  - Persists needs to DB every persistInterval (30 s)
 *  - Handles pass-out logic (10 s controls lock when energy reaches 0)
 *  - Persists needs on disconnect
 */
export class GameLoop {
  constructor(io) {
    this.io = io;
    this.players = new Map(); // socket.id -> player state
    this.tickInterval = null;
    this.persistInterval = null;
  }

  start() {
    console.log(
      `Game loop started (tick: ${needsConfig.tickInterval}ms, ` +
      `persist: ${needsConfig.persistInterval}ms)`
    );
    this.tickInterval = setInterval(() => this._tick(), needsConfig.tickInterval);
    this.persistInterval = setInterval(() => this.persistAll(), needsConfig.persistInterval);
  }

  stop() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.persistInterval) clearInterval(this.persistInterval);
  }

  // ── Player management ─────────────────────────────────────────

  registerPlayer(socket) {
    const user = getUserById(socket.userId);
    if (!user) return;

    const needs = {
      hunger:  user.hunger,
      energy:  user.energy,
      hygiene: user.hygiene,
      bladder: user.bladder,
      fun:     user.fun,
      social:  user.social,
    };

    // Housing state — refreshed every tick from the DB so purchases and
    // rentals made through the REST API take effect immediately.
    const home = user.home_property ? getProperty(user.home_property) : null;
    const rental = getRental(socket.userId);

    this.players.set(socket.id, {
      userId:    socket.userId,
      socket,
      needs,
      cash:      user.cash,
      passedOut: false,
      passOutUntil: 0,
      homePropertyId: user.home_property || null,
      homeProperty:   home,
      rentPaidUntil:  rental ? rental.rent_paid_until : 0,
      currentActivity: user.current_activity || null,
    });

    // Send initial state immediately so the client HUD populates
    this._broadcast(this.players.get(socket.id), user);
  }

  unregisterPlayer(socket) {
    const player = this.players.get(socket.id);
    if (player) {
      this._persistPlayer(player);
      this.players.delete(socket.id);
    }
  }

  // ── Cash access for REST routes ───────────────────────────────
  //
  // Cash lives in memory while a player is connected and is written back to
  // the DB every tick. REST routes must therefore go through these helpers,
  // otherwise the next tick would overwrite a DB-side deduction with the
  // stale in-memory balance.

  /** Cash on hand — the live value when connected, otherwise the DB value. */
  getCash(userId) {
    for (const player of this.players.values()) {
      if (player.userId === userId) return player.cash;
    }
    const user = getUserById(userId);
    return user ? user.cash : 0;
  }

  /**
   * Set a user's cash to an absolute value across every live session.
   * Used by the atomic economy operations once their transaction commits.
   */
  setCash(userId, value) {
    const safe = Math.max(0, Math.round(value * 100) / 100);
    let found = false;
    for (const player of this.players.values()) {
      if (player.userId === userId) {
        player.cash = safe;
        found = true;
      }
    }
    if (!found) {
      // Not connected — write it straight through so the value isn't lost.
      updateCash(userId, safe);
    }
    return safe;
  }

  /** Apply a cash delta to every live session for a user and persist it. */
  adjustCash(userId, delta) {
    let balance = null;
    for (const player of this.players.values()) {
      if (player.userId === userId) {
        player.cash = Math.max(0, player.cash + delta);
        balance = player.cash;
      }
    }
    if (balance === null) {
      const user = getUserById(userId);
      balance = Math.max(0, (user ? user.cash : 0) + delta);
    }
    updateCash(userId, balance);
    return balance;
  }

  /** Apply a need delta (e.g. eating food) to every live session. */
  applyNeedDelta(userId, deltas) {
    let applied = false;
    for (const player of this.players.values()) {
      if (player.userId !== userId) continue;
      for (const [key, amount] of Object.entries(deltas)) {
        if (!NEED_KEYS.includes(key)) continue;
        player.needs[key] = Math.max(0, Math.min(100, player.needs[key] + amount));
      }
      updateNeeds(userId, player.needs);
      applied = true;
    }
    return applied;
  }

  // ── Tick ─────────────────────────────────────────────────────

  _tick() {
    const now = Date.now();
    for (const player of this.players.values()) {
      // Read latest user data from DB (picks up job changes via API)
      const user = getUserById(player.userId);
      if (!user) continue;

      // ── Housing state (Step 8) ────────────────────────────────
      // Refreshed every tick so buys/rentals/move-ins made via the REST
      // API are picked up without reconnecting.
      player.homePropertyId = user.home_property || null;
      const home = player.homePropertyId ? getProperty(player.homePropertyId) : null;
      player.homeProperty = home;
      // Read by the multiplayer snapshot so other players see your status.
      player.currentActivity = user.current_activity || null;


      // Decay needs (skip while passed out — body is conserving energy).
      // A home's comfortBonus slows energy drain.
      if (!player.passedOut) {
        const comfortMultiplier = home ? 1 - home.comfortBonus : 1;
        for (const [key, rate] of Object.entries(needsConfig.decay)) {
          const multiplier = key === 'energy' ? comfortMultiplier : 1;
          player.needs[key] = Math.max(0, player.needs[key] - rate * multiplier);
        }
      }

      // Check for pass out
      if (player.needs.energy <= 0 && !player.passedOut) {
        player.passedOut = true;
        player.passOutUntil = now + needsConfig.passOutDuration;
        // Cancel activity — can't eat while unconscious
        if (user && user.current_activity) {
          cancelActivity(player.userId);
          user.current_activity = null;
          user.activity_ends_at = 0;
        }
      }

      // Check for wake up
      if (player.passedOut && now >= player.passOutUntil) {
        player.passedOut = false;
        player.needs.energy = needsConfig.wakeUpEnergy;
      }

      // Check for activity completion — apply effects when done
      if (user && user.current_activity) {
        const activity = activityConfig.activities[user.current_activity];
        if (activity && now >= user.activity_ends_at) {
          // Activities flagged homeBonus get their POSITIVE effects boosted
          // by the player's home. Sleeping on the street gives no bonus.
          const homeMultiplier =
            activity.homeBonus && home ? 1 + home.sleepBonus : 1;

          // Apply effects to needs (in-memory)
          for (const [key, amount] of Object.entries(activity.effects)) {
            if (NEED_KEYS.includes(key)) {
              const adjusted = amount > 0 ? amount * homeMultiplier : amount;
              player.needs[key] = Math.max(0, Math.min(100, player.needs[key] + adjusted));
            }
          }
          // Apply effects to stats (DB — they don't decay)
          const statUpdates = {};
          for (const [key, amount] of Object.entries(activity.effects)) {
            if (STAT_KEYS.includes(key)) {
              statUpdates[key] = Math.max(0, Math.min(100, user[key] + amount));
            }
          }
          if (Object.keys(statUpdates).length > 0) {
            updateStats(player.userId, statUpdates);
            // Update user object in memory so broadcast shows fresh values
            for (const [key, value] of Object.entries(statUpdates)) {
              user[key] = value;
            }
          }
          // Persist needs immediately
          updateNeeds(player.userId, player.needs);
          // Clear activity
          cancelActivity(player.userId);
          user.current_activity = null;
          user.activity_ends_at = 0;
        }
      }

      // Calculate job income — server is authoritative for earnings
      if (user && user.job_status === 'working' && user.job_type) {
        const job = jobConfig.jobs.find(j => j.id === user.job_type);
        if (job) {
          player.cash += incomePerTick(job.hourlyRate);
        }
      }

      // Collect rent when a rental period has elapsed
      this._chargeRent(player, user, now);

      // Persist cash each tick so the DB always reflects earned income
      updateCash(player.userId, player.cash);

      this._broadcast(player, user);
    }
  }

  // ── Rent collection (Step 8) ──────────────────────────────────

  /**
   * Charge rent when the current rental period has expired.
   * Order of payment: cash first, then the bank balance, then eviction.
   * Runs inside the tick so the server — not the client — decides whether
   * a player keeps their home.
   */
  _chargeRent(player, user, now) {
    const rental = getRental(player.userId);
    player.rentPaidUntil = rental ? rental.rent_paid_until : 0;

    if (!rental) return;
    if (now < rental.rent_paid_until) return;

    const property = getProperty(rental.property_id);
    if (!property) {
      // Listing no longer exists (config changed) — drop the stale tenancy.
      endRental(player.userId, rental.property_id);
      user.home_property = null;
      player.rentPaidUntil = 0;
      return;
    }

    // A player-let property pays a player. The amount is whatever the landlord
    // asked when they listed it, falling back to the city rate.
    const due = rental.rent_amount || property.rentPerPeriod;
    const landlordId = rental.landlord_user_id || null;
    const newPaidUntil = now + RENT_PERIOD_MS;

    // Paying a landlord: the money leaves cash, then the bank, and lands in the
    // landlord's account. If neither account covers it, the tenancy ends.
    if (landlordId) {
      const landlord = getUserById(landlordId);
      const cashPart = Math.min(player.cash, due);
      const bankPart = due - cashPart;
      const canPay = cashPart + (landlord ? user.bank_balance : 0) >= due
        && (bankPart === 0 || (landlord && user.bank_balance >= bankPart));

      if (canPay && landlord) {
        player.cash -= cashPart;
        if (bankPart > 0) {
          player.bank_balance = deductBank(player.userId, bankPart);
          user.bank_balance = player.bank_balance;
        }
        const landlordNewCash = this.getCash(landlordId) + due;
        updateCash(landlordId, landlordNewCash);
        const landlordPlayer = [...this.players.values()]
          .find((p) => p.userId === landlordId) || null;
        if (landlordPlayer) {
          landlordPlayer.cash = landlordNewCash;
          landlordPlayer.socket.emit('home:event', {
            type: 'rent-received',
            amount: due,
            from: user.username,
            propertyId: property.id,
            propertyName: property.name,
          });
        }
        extendRent(player.userId, rental.property_id, newPaidUntil);
        player.rentPaidUntil = newPaidUntil;
        player.socket.emit('home:event', {
          type: 'rent-paid',
          source: bankPart > 0 ? 'bank' : 'cash',
          amount: due,
          landlord: landlord.username,
          propertyId: property.id,
          propertyName: property.name,
          paidUntil: newPaidUntil,
        });
        return;
      }

      // Could not pay the landlord — out.
      endRental(player.userId, rental.property_id);
      user.home_property = null;
      player.homePropertyId = null;
      player.homeProperty = null;
      player.rentPaidUntil = 0;
      player.socket.emit('home:event', {
        type: 'evicted',
        amount: due,
        propertyId: property.id,
        propertyName: property.name,
      });
      return;
    }

    // 1) Pay from cash on hand
    if (player.cash >= due) {
      player.cash -= due;
      extendRent(player.userId, rental.property_id, newPaidUntil);
      player.rentPaidUntil = newPaidUntil;
      player.socket.emit('home:event', {
        type: 'rent-paid',
        source: 'cash',
        amount: due,
        propertyId: property.id,
        propertyName: property.name,
        paidUntil: newPaidUntil,
      });
      return;
    }

    // 2) Top up from the bank balance
    const shortfall = due - player.cash;
    if (user.bank_balance >= shortfall) {
      player.bank_balance = deductBank(player.userId, shortfall);
      user.bank_balance = player.bank_balance;
      const fromCash = player.cash;
      player.cash = 0;
      extendRent(player.userId, rental.property_id, newPaidUntil);
      player.rentPaidUntil = newPaidUntil;
      player.socket.emit('home:event', {
        type: 'rent-paid',
        source: 'bank',
        amount: due,
        cashUsed: fromCash,
        bankUsed: shortfall,
        propertyId: property.id,
        propertyName: property.name,
        paidUntil: newPaidUntil,
      });
      return;
    }

    // 3) Can't pay — evicted, and the player becomes homeless
    endRental(player.userId, rental.property_id);
    user.home_property = null;
    player.homePropertyId = null;
    player.homeProperty = null;
    player.rentPaidUntil = 0;
    player.socket.emit('home:event', {
      type: 'evicted',
      amount: due,
      propertyId: property.id,
      propertyName: property.name,
    });
  }

  // ── Broadcast ─────────────────────────────────────────────────

  _broadcast(player, user = null) {
    if (!user) user = getUserById(player.userId);
    if (!user) return;

    // Speed multiplier: 0.5 if hunger or energy below warning threshold
    let speedMultiplier = 1.0;
    if (player.needs.hunger < needsConfig.warningThreshold ||
        player.needs.energy < needsConfig.warningThreshold) {
      speedMultiplier = 0.5;
    }

    const state = {
      username:     user.username,
      cash:         player.cash,
      bank_balance: user.bank_balance,
      debt:         user.debt,
      job_type:     user.job_type,
      job_status:   user.job_status,
      activity:        user.current_activity || null,
      activityEndsAt:  user.activity_ends_at || 0,
      hunger:  player.needs.hunger,
      energy:  player.needs.energy,
      hygiene: player.needs.hygiene,
      bladder: player.needs.bladder,
      fun:     player.needs.fun,
      social:  player.needs.social,
      smarts:     user.smarts,
      charisma:   user.charisma,
      fitness:    user.fitness,
      speedMultiplier,
      passedOut:  player.passedOut,
      controlsLocked: player.passedOut || !!user.current_activity,
      // ── Housing (Step 8) ──
      home:               player.homeProperty ? player.homeProperty.id : null,
      homeName:           player.homeProperty ? player.homeProperty.name : null,
      homeIcon:           player.homeProperty ? player.homeProperty.icon : null,
      rentPaidUntil:      player.rentPaidUntil || 0,
      rentAmount:         player.homeProperty && player.rentPaidUntil
                            ? player.homeProperty.rentPerPeriod
                            : 0,
      isRentingHome:      !!(player.homeProperty && player.rentPaidUntil),
    };

    player.socket.emit('player:update', state);
  }

  // ── Persistence ───────────────────────────────────────────────

  _persistPlayer(player) {
    updateNeeds(player.userId, player.needs);
    updateCash(player.userId, player.cash);
  }

  /**
   * Flush one user's live state to the database immediately.
   * Used by the explicit "save progress" action; everything is already
   * persisted on timers, this just makes the save feel immediate.
   */
  persistUser(userId) {
    for (const player of this.players.values()) {
      if (player.userId === userId) {
        this._persistPlayer(player);
        return true;
      }
    }
    return false;
  }

  persistAll() {
    for (const player of this.players.values()) {
      this._persistPlayer(player);
    }
  }
}
