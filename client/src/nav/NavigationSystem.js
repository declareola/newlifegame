// client/src/nav/NavigationSystem.js
// Destination selection, routing, guidance and arrival.
//
// Owns exactly one active destination. When one is set it asks the nav grid for
// a route from the player's current position, draws it on the map, shows a
// compass ribbon + distance, and watches for arrival. If the player wanders
// off the route or the route becomes invalid, it recalculates — but only every
// couple of metres or after a cooldown, so it never thrashes the CPU.

import * as THREE from 'three';

const ARRIVE_RADIUS = 3.2;
const REROUTE_DISTANCE = 9;     // drift from the path before recalculating
const REROUTE_COOLDOWN = 1.2;   // seconds

export class NavigationSystem {
  /**
   * @param {object} o
   * @param {object} o.nav        - NavGrid
   * @param {object} o.map        - MapSystem
   * @param {function} o.getPlayer - () => { x, z }
   * @param {function} o.onToast  - (msg, type) => void
   * @param {function} o.onArrive - (destination) => void
   */
  constructor({ nav, map, getPlayer, onToast, onArrive }) {
    this.nav = nav;
    this.map = map;
    this.getPlayer = getPlayer;
    this.onToast = onToast || (() => {});
    this.onArrive = onArrive || (() => {});

    this.destination = null;
    this.route = null;
    this.routeIndex = 0;
    this.cooldown = 0;
    this.lastRerouteAt = 0;
    this._buildGuide();
  }

  // ── Guidance UI ───────────────────────────────────────────

  _buildGuide() {
    const el = document.createElement('div');
    el.className = 'nav-guide hidden';
    el.innerHTML = `
      <div class="nav-arrow" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="30" height="30"><path d="M16 3 27 27 16 21 5 27Z" fill="currentColor"/></svg>
      </div>
      <div class="nav-text">
        <div class="nav-name"></div>
        <div class="nav-meta"><span class="nav-dist"></span><span class="nav-sep">·</span><span class="nav-eta"></span></div>
      </div>
      <button class="nav-cancel" title="Cancel navigation">×</button>
    `;
    document.body.appendChild(el);

    this.guideEl = el;
    this.arrowEl = el.querySelector('.nav-arrow');
    this.nameEl = el.querySelector('.nav-name');
    this.distEl = el.querySelector('.nav-dist');
    this.etaEl = el.querySelector('.nav-eta');
    el.querySelector('.nav-cancel').addEventListener('click', () => {
      this.clear();
      this.onToast('Navigation cancelled', 'info');
    });
  }

  // ── Destination ───────────────────────────────────────────

  /**
   * Route to a POI (or any {name, x, z}).
   * @returns {boolean} true when a route was found
   */
  navigateTo(poi, { silent = false } = {}) {
    if (!poi) return false;
    const p = this.getPlayer();

    let target = { x: poi.x, z: poi.z };

    // If the POI is inside a building, route to its door instead — routing to
    // the building centre would try to walk through a wall.
    if (!this.nav.isReachable(target.x, target.z)) {
      const nearest = this.nav.nearestReachable(target.x, target.z, 20);
      if (nearest) target = nearest;
    }

    const route = this.nav.findPath(p, target);
    if (!route || route.length === 0) {
      if (!silent) this.onToast(`No route to ${poi.name}`, 'warning');
      return false;
    }

    this.destination = {
      name: poi.name,
      kind: poi.kind,
      x: target.x,
      z: target.z,
      poi,
    };
    this.route = route;
    this.routeIndex = 0;
    this.lastRerouteAt = performance.now();

    this.map.setRoute(route, this.destination);
    this.guideEl.classList.remove('hidden');
    this.nameEl.textContent = poi.name;

    if (!silent) this.onToast(`Navigating to ${poi.name}`, 'info');
    return true;
  }

  clear() {
    this.destination = null;
    this.route = null;
    this.routeIndex = 0;
    this.guideEl.classList.add('hidden');
    this.map.clearRoute();
  }

  /** Recompute the route from the player's current position. */
  recalculate() {
    if (!this.destination) return false;
    const p = this.getPlayer();
    const route = this.nav.findPath(p, { x: this.destination.x, z: this.destination.z });
    if (!route) return false;
    this.route = route;
    this.routeIndex = 0;
    this.lastRerouteAt = performance.now();
    this.map.setRoute(route, this.destination);
    return true;
  }

  // ── Per-frame ─────────────────────────────────────────────

  update(deltaTime) {
    if (!this.destination) return;

    const p = this.getPlayer();
    const distToDest = Math.hypot(this.destination.x - p.x, this.destination.z - p.z);

    // ── Arrival ──
    if (distToDest <= ARRIVE_RADIUS) {
      const arrived = this.destination;
      this.clear();
      this.onToast(`Arrived at ${arrived.name}`, 'success');
      this.onArrive(arrived);
      return;
    }

    // ── Guidance readout ──
    const remaining = this._remainingLength(p);
    this.distEl.textContent = `${Math.round(remaining)} m`;

    // ETA at a walking pace, which is what the player actually does on foot
    const eta = Math.max(1, Math.round(remaining / 4.2 / 60));
    this.etaEl.textContent = eta < 1 ? 'under a minute' : `~${eta} min walk`;

    // Arrow points toward the next waypoint in *screen* space
    const next = this._nextWaypoint(p);
    if (next) {
      const worldAngle = Math.atan2(next.x - p.x, next.z - p.z);
      // Screen-space angle: the minimap draws +z downward, and heading-up mode
      // rotates the map by the player's facing.
      const cameraRot = this.map.mode === 'heading' ? this._playerRot : 0;
      this.arrowEl.style.transform = `rotate(${worldAngle + cameraRot}rad)`;
    }

    // ── Reroute if the player left the path ──
    this.cooldown -= deltaTime;
    if (this.cooldown <= 0) {
      const off = this._distanceToRoute(p);
      if (off > REROUTE_DISTANCE) {
        this.cooldown = REROUTE_COOLDOWN;
        if (!this.recalculate()) {
          this.onToast(`Route to ${this.destination.name} is blocked`, 'warning');
          this.clear();
        }
      }
    }
  }

  _nextWaypoint(p) {
    if (!this.route) return null;
    // Skip waypoints we have already passed
    while (this.routeIndex < this.route.length - 1) {
      const w = this.route[this.routeIndex];
      if (Math.hypot(w.x - p.x, w.z - p.z) > 2.0) break;
      this.routeIndex++;
    }
    return this.route[Math.min(this.routeIndex, this.route.length - 1)];
  }

  _remainingLength(p) {
    if (!this.route) return 0;
    let len = 0;
    let px = p.x;
    let pz = p.z;
    for (let i = this.routeIndex; i < this.route.length; i++) {
      const w = this.route[i];
      len += Math.hypot(w.x - px, w.z - pz);
      px = w.x;
      pz = w.z;
    }
    return len;
  }

  _distanceToRoute(p) {
    if (!this.route || this.route.length < 2) return 0;
    let best = Infinity;
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1];
      const b = this.route[i];
      best = Math.min(best, this._pointSegmentDistance(p.x, p.z, a.x, a.z, b.x, b.z));
    }
    return best;
  }

  _pointSegmentDistance(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    if (lenSq === 0) return Math.hypot(px - ax, pz - az);
    let t = ((px - ax) * dx + (pz - az) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
  }

  setPlayerRotProvider(fn) {
    Object.defineProperty(this, '_playerRot', { get: fn, configurable: true });
  }

  getState() {
    return this.destination
      ? { name: this.destination.name, x: this.destination.x, z: this.destination.z }
      : null;
  }
}
