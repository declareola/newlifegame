// server/src/multiplayer.js
// Step 9 — presence, movement synchronisation and text chat.
//
// The server owns the player list. Each client sends its position ~10–15
// times a second; the server validates and re-broadcasts a snapshot to
// everyone else on its own timer. Clients cannot decide where other
// players are, and cannot spoof another player's position.

import { multiplayerConfig } from '../config/multiplayerConfig.js';
import { WORLD_BOUNDS } from '../config/worldGeometry.js';
import { updatePosition, getVehicles } from './db.js';
import { logEvent } from './securityLog.js';

/** Clamp a finite number to the map bounds, or return null if unusable. */
/**
 * Interior ids are `in-…` slugs. Anything else is dropped rather than trusted:
 * the value is only ever compared against the server's own venue catalogue, but
 * a length cap and a character class keep junk out of the logs and the DB.
 */
function sanitiseVenue(value) {
  if (typeof value !== 'string') return null;
  if (!/^[a-z0-9-]{2,40}$/.test(value)) return null;
  return value;
}

function sanitiseCoord(value, axis) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Clamp to the map the game actually renders. This used to clamp to the
  // constant multiplayerConfig.mapBound = 95 — a leftover from the old 200 m
  // city. Eko Basin runs from -398 to 399 in x, so every player walking west
  // was pinned at x = -95: the marina, Victoria Island and most of the map were
  // unreachable, and the server silently slid them along the wall instead.
  const min = axis === 'z' ? WORLD_BOUNDS.minZ : WORLD_BOUNDS.minX;
  const max = axis === 'z' ? WORLD_BOUNDS.maxZ : WORLD_BOUNDS.maxX;
  return Math.max(min, Math.min(max, n));
}

/**
 * Strip control characters and trim, so a chat message can never contain
 * line breaks that fake extra chat lines, or terminal escapes.
 */
function sanitiseChat(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, multiplayerConfig.chatMaxLength);
}

export class Multiplayer {
  /**
   * @param {import('socket.io').Server} io
   * @param {import('./gameLoop.js').GameLoop} gameLoop - source of live activity/pass-out state
   */
  constructor(io, gameLoop) {
    this.io = io;
    this.gameLoop = gameLoop;
    this.sessions = new Map(); // socket.id -> session
    this.connectionsPerIp = new Map(); // ip -> live socket count
    this.broadcastTimer = null;
    this.recentChat = []; // last N messages, replayed to new joiners
  }

  start() {
    console.log(
      `Multiplayer started (broadcast: ${multiplayerConfig.broadcastInterval}ms)`
    );
    this.broadcastTimer = setInterval(
      () => this._broadcastPositions(),
      multiplayerConfig.broadcastInterval
    );
    // Write positions to the DB every 30 s so a server crash loses at most
    // half a minute of walking.
    this.persistTimer = setInterval(() => this._persistPositions(), 30000);
  }

  stop() {
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    if (this.persistTimer) clearInterval(this.persistTimer);
    this.broadcastTimer = null;
    this.persistTimer = null;
  }

  _persistPositions() {
    for (const session of this.sessions.values()) {
      updatePosition(session.userId, session.x, session.z);
    }
  }

  // ── Session lifecycle ─────────────────────────────────────────

  registerPlayer(socket, user) {
    if (!user) return;

    // Kick any existing session for this account. One account = one session:
    // this prevents duplicate income streams from multiple tabs, and stops a
    // single user opening dozens of sockets to exhaust the server.
    if (multiplayerConfig.maxSessionsPerUser > 0) {
      for (const existing of [...this.sessions.values()]) {
        if (existing.userId === user.id && existing.socketId !== socket.id) {
          existing.socket.emit('session:replaced', {
            message: 'You signed in from somewhere else.',
          });
          existing.socket.disconnect(true);
        }
      }
    }

    // Track live connections per IP so one host can't hold thousands open.
    // Reuse the IP the connection middleware already resolved (proxy-aware).
    const ip = socket.clientIp || socket.handshake?.address || 'unknown';
    this.connectionsPerIp.set(ip, (this.connectionsPerIp.get(ip) || 0) + 1);

    const session = {
      socket,
      socketId: socket.id,
      userId:   user.id,
      username: user.username,
      ip,
      // Start from where this player actually is, so the very first movement
      // packet is distance-checked like every other one.
      x: Number.isFinite(user.pos_x) ? user.pos_x : 0,
      z: Number.isFinite(user.pos_z) ? user.pos_z : 0,
      rot: 0,
      moving: false,
      skinColor:   user.skin_color,
      outfitColor: user.outfit_color,
      // The full look, so another player sees the same character you built
      // rather than a random hair style guessed from your name.
      hairStyle:   user.hair_style || 'short',
      hairColor:   user.hair_color,
      bodyType:    user.body_type || 'average',
      outfitId:    user.outfit_id || 'casual',
      bottomColor: user.bottom_color,
      lastMoveAt: 0,
      // Simple per-second packet budget
      moveBudget: multiplayerConfig.maxMovePacketsPerSecond,
      budgetResetAt: Date.now() + 1000,
      lastChatAt: 0,
    };

    this.sessions.set(socket.id, session);

    // Tell everyone else this player arrived, and tell the newcomer who is
    // already here plus the recent chat.
    socket.emit('world:init', {
      you: socket.id,
      players: this._snapshotExcept(socket.id),
      chat: this.recentChat.slice(-multiplayerConfig.chatHistoryForNewJoiners),
    });

    this._emitToOthers(socket.id, 'world:player-joined', this._publicSession(session));
    this._pushSystemMessage(`${user.username} joined the city`, socket.id);
  }

  unregisterPlayer(socket) {
    const session = this.sessions.get(socket.id);
    if (!session) return;
    // Remember where they were standing (Step 11)
    updatePosition(session.userId, session.x, session.z);
    this.sessions.delete(socket.id);

    // Release the per-IP connection slot
    const count = this.connectionsPerIp.get(session.ip) || 1;
    if (count <= 1) this.connectionsPerIp.delete(session.ip);
    else this.connectionsPerIp.set(session.ip, count - 1);
    this._emitToOthers(socket.id, 'world:player-left', { id: socket.id });
    this._pushSystemMessage(`${session.username} left the city`, socket.id);
  }

  // ── Movement ──────────────────────────────────────────────────

  updatePosition(socket, data) {
    const session = this.sessions.get(socket.id);
    if (!session) return;

    // Per-second packet budget — silently drop floods.
    const now = Date.now();
    if (now >= session.budgetResetAt) {
      session.moveBudget = multiplayerConfig.maxMovePacketsPerSecond;
      session.budgetResetAt = now + 1000;
    }
    if (session.moveBudget <= 0) return;
    session.moveBudget -= 1;

    if (!data || typeof data !== 'object') return;
    const x = sanitiseCoord(data.x, 'x');
    const z = sanitiseCoord(data.z, 'z');
    if (x === null || z === null) return;

    // ── Anti-teleport / anti-speedhack ───────────────────────
    // The client is not trusted. Work out how far it could legitimately
    // have moved since its last packet, and clamp anything beyond that.
    // A vehicle the sender owns earns a higher speed cap. Ownership is checked
    // once per vehicle per session, not on every packet.
    let speedCap = multiplayerConfig.maxSpeed;
    const claimedVehicle = Number(data.vehicle);
    if (Number.isFinite(claimedVehicle) && claimedVehicle > 0) {
      if (session.vehicleId !== claimedVehicle) {
        const owned = getVehicles(session.userId).some((v) => v.id === claimedVehicle);
        session.vehicleId = owned ? claimedVehicle : null;
      }
      if (session.vehicleId) speedCap = multiplayerConfig.maxVehicleSpeed;
    } else {
      session.vehicleId = null;
    }

    const elapsedMs = session.lastMoveAt === 0
      ? 0
      : Math.min(now - session.lastMoveAt, multiplayerConfig.maxCatchUpMs);
    const maxDistance = (speedCap * elapsedMs) / 1000
      + multiplayerConfig.movementTolerance;

    const dx = x - session.x;
    const dz = z - session.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    let nextX = x;
    let nextZ = z;
    if (distance > maxDistance && distance > 0) {
      // Slide to the furthest reachable point in the intended direction
      // instead of rejecting outright, so laggy players glide rather than
      // stutter.
      const scale = maxDistance / distance;
      nextX = session.x + dx * scale;
      nextZ = session.z + dz * scale;

      session.rejectedMoves = (session.rejectedMoves || 0) + 1;
      if (session.rejectedMoves === 1 || session.rejectedMoves % 20 === 0) {
        // Log the first offence and then occasionally, not every packet.
        logEvent('movement_clamped', {
          userId: session.userId,
          username: session.username,
          attempted: Math.round(distance),
          allowed: Math.round(maxDistance),
          count: session.rejectedMoves,
        });
      }
    }

    let rot = Number(data.rot);
    if (!Number.isFinite(rot)) rot = session.rot;

    // Which interior the player says they are inside, if any. Validated
    // cheaply (it must look like an interior id) and stored on the session, so
    // the REST routes can refuse a purchase made from outside the shop that
    // sells the thing. It is a claim, exactly like the position — but it is a
    // claim the server can check against its own venue catalogue.
    session.venue = sanitiseVenue(data.venue);

    session.x = nextX;
    session.z = nextZ;
    session.rot = rot;
    session.moving = !!data.moving && distance > 0.001;
    session.lastMoveAt = now;
  }

  // ── Chat ──────────────────────────────────────────────────────

  handleChat(socket, rawText) {
    const session = this.sessions.get(socket.id);
    if (!session) return;

    const now = Date.now();
    if (now - session.lastChatAt < multiplayerConfig.chatCooldownMs) {
      socket.emit('chat:error', {
        message: 'Slow down — you can send one message every 1.5 seconds.',
      });
      return;
    }

    const text = sanitiseChat(rawText);
    if (!text) return;

    session.lastChatAt = now;
    const message = {
      id: `${socket.id}-${now}`,
      userId: session.userId,
      username: session.username,
      text,
      at: now,
      system: false,
    };

    this.recentChat.push(message);
    if (this.recentChat.length > 100) this.recentChat.shift();

    this.io.emit('chat:message', message);
  }

  /** Server-generated join/leave notices. Not rate-limited by players. */
  _pushSystemMessage(text, excludeSocketId = null) {
    const message = {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      userId: 0,
      username: 'City',
      text,
      at: Date.now(),
      system: true,
    };
    this.recentChat.push(message);
    if (this.recentChat.length > 100) this.recentChat.shift();
    this.io.emit('chat:message', message);
  }

  // ── Broadcast ─────────────────────────────────────────────────

  _broadcastPositions() {
    if (this.sessions.size === 0) return;
    const now = Date.now();
    const all = [...this.sessions.values()];

    for (const session of all) {
      if (!session.socket) continue;
      const others = [];
      for (const other of all) {
        if (other.socketId === session.socketId) continue;
        others.push(this._publicSession(other, now));
      }
      session.socket.emit('world:players', {
        players: others,
        count: all.length,
        at: now,
      });
    }
  }

  _snapshotExcept(excludeSocketId) {
    const now = Date.now();
    const out = [];
    for (const s of this.sessions.values()) {
      if (s.socketId === excludeSocketId) continue;
      out.push(this._publicSession(s, now));
    }
    return out;
  }

  /** Build the wire format for one player. */
  _publicSession(session, now = Date.now()) {
    // Pull the authoritative activity / pass-out state from the game loop.
    const gp = this.gameLoop?.players?.get(session.socketId);
    const idle = now - session.lastMoveAt > multiplayerConfig.idleAfterMs;

    return {
      id: session.socketId,
      username: session.username,
      x: session.x,
      z: session.z,
      rot: session.rot,
      moving: session.moving && !idle,
      skinColor: session.skinColor,
      outfitColor: session.outfitColor,
      hairStyle: session.hairStyle,
      hairColor: session.hairColor,
      bodyType: session.bodyType,
      outfitId: session.outfitId,
      bottomColor: session.bottomColor,
      activity: gp?.currentActivity || null,
      passedOut: !!gp?.passedOut,
      homeIcon: gp?.homeProperty ? gp.homeProperty.icon : null,
    };
  }

  /**
   * A player changed their look in the character panel.
   * Update their live session so the next broadcast carries the new look; the
   * client rebuilds the avatar when the look it receives differs from the one
   * it is showing.
   */
  updateAppearance(userId, patch) {
    let changed = 0;
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      if (patch.skin_color !== undefined) session.skinColor = patch.skin_color;
      if (patch.outfit_color !== undefined) session.outfitColor = patch.outfit_color;
      if (patch.hair_style !== undefined) session.hairStyle = patch.hair_style;
      if (patch.hair_color !== undefined) session.hairColor = patch.hair_color;
      if (patch.body_type !== undefined) session.bodyType = patch.body_type;
      if (patch.outfit_id !== undefined) session.outfitId = patch.outfit_id;
      if (patch.bottom_color !== undefined) session.bottomColor = patch.bottom_color;
      changed++;
    }
    return changed;
  }

  _emitToOthers(excludeSocketId, event, payload) {
    for (const s of this.sessions.values()) {
      if (s.socketId === excludeSocketId) continue;
      s.socket.emit(event, payload);
    }
  }

  /**
   * The interior a user reports being inside, or null for the open city.
   * Used by the venue shop route.
   */
  getVenueByUserId(userId) {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) return s.venue || null;
    }
    return null;
  }

  /**
   * Last known position for a user, or null if they have no live session.
   * Used by the REST routes to verify a player is actually standing near
   * the bank or shop they are trying to use.
   */
  getPositionByUserId(userId) {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) return { x: s.x, z: s.z };
    }
    return null;
  }

  /** How many live sockets this IP currently holds. */
  connectionCountForIp(ip) {
    return this.connectionsPerIp.get(ip) || 0;
  }

  /** Number of players currently online — used by the client HUD. */
  get onlineCount() {
    return this.sessions.size;
  }
}
