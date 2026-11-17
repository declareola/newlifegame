// client/src/world/navGraph.js
// Walkability grid + A* pathfinding.
//
// The world is Eko Basin: 840 m × 420 m of land and lagoon. The real collision
// set is rasterised into a 1-metre occupancy grid once at start-up, cells the
// player capsule cannot stand in are marked, and A* routes over the free cells.
// Because the grid is built from the *same* AABBs the movement code collides
// against, a route can never pass through a wall, a locked door, or a building
// with no entrance.
//
// The grid follows the map's extent rather than a hard-coded square, so it keeps
// working when the map changes — which it has done twice.
//
// Road cells are cheaper than grass, so routes prefer streets and pavements —
// the player walks down the road instead of diagonally across every lawn —
// without ever being *forbidden* from cutting across open ground.

import { discoverStreets, distanceToStreet } from './streets.js';
import { islandAt } from './ekoBasin.js';

const CELL = 1.0;

const ROAD_COST = 1.0;
const OFFROAD_COST = 1.45;

export class NavGrid {
  /**
   * @param {object} o
   * @param {Array<{minX,maxX,minZ,maxZ}>} o.boxes - collision AABBs
   * @param {number} [o.radius=0.45] - clearance the player needs
   * @param {number} [o.bounds] - half-extent of the walkable area
   */
  constructor({ boxes = [], radius = 0.45, bounds = null, walkways = [] } = {}) {
    // bounds = {minX, maxX, minZ, maxZ}; without one, fall back to the old
    // 200 m square so a caller that has not been updated still gets a grid.
    const b = bounds || { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
    this.bounds = b;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.nx = Math.max(1, Math.round((b.maxX - b.minX) / CELL));
    this.nz = Math.max(1, Math.round((b.maxZ - b.minZ) / CELL));
    this.n = this.nx;
    this.cell = CELL;
    const N = this.nx * this.nz;
    this.blocked = new Uint8Array(N);
    /** 1 where a building blocks the cell — these are never carved open. */
    this.structural = new Uint8Array(N);
    this.cost = new Float32Array(N).fill(OFFROAD_COST);
    this.streets = discoverStreets();

    this.walkways = walkways;
    this._rasterise(boxes, radius);
    this._blockWater();
    this._carveWalkways();
    this._applyStreetCosts();

    // Reusable A* buffers — allocated once, reset per search
    this._gScore = new Float32Array(this.nx * this.nz);
    this._cameFrom = new Int32Array(this.nx * this.nz);
    this._open = new MinHeap();
    this._stamp = new Int32Array(this.nx * this.nz);
    this._closed = new Int32Array(this.nx * this.nz);
    this._searchId = 0;
  }

  // ── Build ─────────────────────────────────────────────────

  _rasterise(boxes, radius) {
    for (const b of boxes) {
      // A cell (ix, iz) covers world [minX + ix*CELL, minX + (ix+1)*CELL]. Block every
      // cell that *overlaps* the footprint inflated by the player's radius.
      // (Using floor/ceil inclusively here would over-block by a full cell on
      // each side and crush a 4 m alley down to a single walkable column.)
      const minX = Math.floor((b.minX - radius - this.minX) / CELL);
      const maxX = Math.ceil((b.maxX + radius - this.minX) / CELL) - 1;
      const minZ = Math.floor((b.minZ - radius - this.minZ) / CELL);
      const maxZ = Math.ceil((b.maxZ + radius - this.minZ) / CELL) - 1;

      for (let iz = Math.max(0, minZ); iz <= Math.min(this.nz - 1, maxZ); iz++) {
        for (let ix = Math.max(0, minX); ix <= Math.min(this.nx - 1, maxX); ix++) {
          this.blocked[this.id(ix, iz)] = 1;
          this.structural[this.id(ix, iz)] = 1;
        }
      }
    }

    // Keep a hard margin at the map edge so NPCs and routes stay inside
    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.nz; j++) {
        const x = this.idxToWorld(i);
        const z = this.worldToZ(j);
        if (Math.abs(x) > this.bound || Math.abs(z) > this.bound) {
          this.blocked[this.id(i, j)] = 1;
        }
      }
    }
  }

  _applyStreetCosts() {
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const cell = this.id(ix, iz);
        if (this.blocked[cell]) continue;
        const x = this.idxToWorld(ix);
        const z = this.worldToZ(iz);
        const d = distanceToStreet(x, z, this.streets.segments);
        // Within 3 m of a street centre line = pavement pricing
        this.cost[cell] = d <= 3 ? ROAD_COST : OFFROAD_COST;
      }
    }
  }

  // ── Coordinates ───────────────────────────────────────────

  /**
   * The lagoon is not walkable.
   *
   * Buildings are boxes; the sea is not, and Eko Basin is four islands. Without
   * this pass the route planner happily takes a shortcut from the Outer Borough
   * to Banana Island across open water — which is exactly what it did before
   * this check existed.
   */
  _blockWater() {
    for (let iz = 0; iz < this.nz; iz++) {
      const z = this.worldToZ(iz);
      for (let ix = 0; ix < this.nx; ix++) {
        const id = this.id(ix, iz);
        if (this.blocked[id]) continue;
        if (!islandAt(this.idxToWorld(ix), z)) this.blocked[id] = 1;
      }
    }
  }

  /**
   * Bridges are walkable ground over water. The lagoon pass blocks everything
   * between the islands, which is correct — but Eko Basin's three bridges are
   * how you get from one island to another, so their decks are carved back in
   * (and only where no building stands) after the water is blocked.
   */
  _carveWalkways() {
    for (const w of this.walkways) {
      const half = (w.width ?? 3.2) / 2;
      const minX = Math.min(w.a.x, w.b.x) - half;
      const maxX = Math.max(w.a.x, w.b.x) + half;
      const minZ = Math.min(w.a.z, w.b.z) - half;
      const maxZ = Math.max(w.a.z, w.b.z) + half;
      const ix0 = Math.max(0, this.worldToIdx(minX));
      const ix1 = Math.min(this.nx - 1, this.worldToIdx(maxX));
      const iz0 = Math.max(0, this.worldToIdxZ(minZ));
      const iz1 = Math.min(this.nz - 1, this.worldToIdxZ(maxZ));

      const dx = w.b.x - w.a.x;
      const dz = w.b.z - w.a.z;
      const len2 = dx * dx + dz * dz || 1;

      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const px = this.idxToWorld(ix);
          const pz = this.worldToZ(iz);
          // Distance from the point to the deck's centre line.
          let t = ((px - w.a.x) * dx + (pz - w.a.z) * dz) / len2;
          t = Math.max(0, Math.min(1, t));
          const cx = w.a.x + dx * t;
          const cz = w.a.z + dz * t;
          if (Math.hypot(px - cx, pz - cz) > half) continue;
          // A building on the deck wins: never carve walkable space through one.
          if (this.structural?.[this.id(ix, iz)]) continue;
          this.blocked[this.id(ix, iz)] = 0;
        }
      }
    }
  }

  idxToWorld(i) { return (i + 0.5) * CELL + this.minX; }
  worldToZ(i) { return (i + 0.5) * CELL + this.minZ; }
  worldToIdx(v) { return Math.floor((v - this.minX) / CELL); }
  worldToIdxZ(v) { return Math.floor((v - this.minZ) / CELL); }

  /** Flat index for a grid cell. */
  id(ix, iz) { return iz * this.nx + ix; }
  /** Grid x of a flat index. */
  gx(i) { return i % this.nx; }
  /** Grid z of a flat index. */
  gz(i) { return (i - (i % this.nx)) / this.nx; }

  inBounds(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz; }

  isWalkable(x, z) {
    const ix = this.worldToIdx(x);
    const iz = this.worldToIdxZ(z);
    if (!this.inBounds(ix, iz)) return false;
    return !this.blocked[this.id(ix, iz)];
  }

  /** Closest walkable cell to a world point, searched in expanding rings. */
  nearestWalkable(x, z, maxRing = 14) {
    const ix = this.worldToIdx(x);
    const iz = this.worldToIdxZ(z);
    if (this.inBounds(ix, iz) && !this.blocked[this.id(ix, iz)]) {
      return { x: this.idxToWorld(ix), z: this.worldToZ(iz), ix, iz };
    }

    for (let r = 1; r <= maxRing; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = ix + dx;
          const nz = iz + dz;
          if (!this.inBounds(nx, nz)) continue;
          if (!this.blocked[this.id(nx, nz)]) {
            return { x: this.idxToWorld(nx), z: this.worldToZ(nz), ix: nx, iz: nz };
          }
        }
      }
    }
    return null;
  }

  // ── A* ────────────────────────────────────────────────────

  /**
   * Find a path between two world points.
   * @returns {Array<{x:number,z:number}>|null} world-space waypoints, or null
   */
  findPath(start, goal, { maxNodes = 120000 } = {}) {
    // The start must be in the walkable component the player is standing in;
    // the goal only has to be standable. Without the wider ring on the goal, a
    // district label that lands inside a building (a market hall, say) makes the
    // whole query return null in a millisecond — which reads as "no route to the
    // market" rather than "the label is 15 m inside the hall".
    const s = (this.reachable ? this.nearestReachable(start.x, start.z, 6) : null) || this.nearestWalkable(start.x, start.z);
    const g = this.nearestWalkable(goal.x, goal.z, 30);
    if (!s || !g) return null;

    const startId = this.id(s.ix, s.iz);
    const goalId = this.id(g.ix, g.iz);
    if (startId === goalId) return [{ x: goal.x, z: goal.z }];

    // Fresh search state without reallocating the buffers
    this._searchId++;
    const stamp = this._stamp;
    const closed = this._closed;
    const gScore = this._gScore;
    const cameFrom = this._cameFrom;
    const open = this._open;
    open.clear();

    const sid = this._searchId;
    stamp[startId] = sid;
    gScore[startId] = 0;
    cameFrom[startId] = -1;
    open.push(startId, this._heuristic(s.ix, s.iz, g.ix, g.iz));

    const gx = g.ix;
    const gz = g.iz;
    let visited = 0;
    let found = false;

    while (open.size > 0) {
      const current = open.pop();

      // Lazy-deletion heap: the same node can sit in the queue several times.
      // Only the first pop (the best f-score) is expanded.
      if (closed[current] === sid) continue;
      closed[current] = sid;

      if (current === goalId) { found = true; break; }
      if (++visited > maxNodes) break;

      const cx = this.gx(current);
      const cz = this.gz(current);

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const nid = this.id(nx, nz);
          if (this.blocked[nid]) continue;

          // No corner cutting: a diagonal step needs both orthogonal cells free
          if (dx !== 0 && dz !== 0) {
            if (this.blocked[this.id(nx, cz)] || this.blocked[this.id(cx, nz)]) continue;
          }

          const step = (dx !== 0 && dz !== 0 ? 1.4142 : 1) * this.cost[nid];
          const tentative = gScore[current] + step;

          if (stamp[nid] !== sid || tentative < gScore[nid]) {
            stamp[nid] = sid;
            gScore[nid] = tentative;
            cameFrom[nid] = current;
            open.push(nid, tentative + this._heuristic(nx, nz, gx, gz));
          }
        }
      }
    }

    if (!found) return null;

    // Reconstruct
    const cells = [];
    let cur = goalId;
    let guard = 0;
    while (cur !== -1 && guard++ < 100000) {
      const cx = this.gx(cur);
      const cz = this.gz(cur);
      cells.push({ x: this.idxToWorld(cx), z: this.worldToZ(cz) });
      cur = cameFrom[cur];
    }
    cells.reverse();

    // Snap the ends to the exact requested points — but only when the final
    // segment keeps capsule clearance. Snapping blindly is what produces a
    // route that is legal on the grid and then clips a wall corner on the last
    // metre into the door.
    if (cells.length > 1 && this.isWalkable(start.x, start.z) &&
        this._lineWalkable({ x: start.x, z: start.z }, cells[1])) {
      cells[0] = { x: start.x, z: start.z };
    }
    const lastIdx = cells.length - 1;
    if (lastIdx > 0 && this.isWalkable(goal.x, goal.z) &&
        this._lineWalkable(cells[lastIdx - 1], { x: goal.x, z: goal.z })) {
      cells[lastIdx] = { x: goal.x, z: goal.z };
    } else if (lastIdx > 0 && this.isWalkable(goal.x, goal.z) && !this._lineWalkable(cells[lastIdx - 1], { x: goal.x, z: goal.z })) {
      // The door is reachable but the grid cell path ends awkwardly. Add the
      // door as a final waypoint the player walks to directly — the movement
      // code slides along walls, so a short close-range step is safe.
      const gap = Math.hypot(goal.x - cells[lastIdx].x, goal.z - cells[lastIdx].z);
      if (gap < 2.5) cells.push({ x: goal.x, z: goal.z });
    }

    return this.smooth(cells);
  }

  _heuristic(ax, az, bx, bz) {
    const dx = Math.abs(ax - bx);
    const dz = Math.abs(az - bz);
    // Octile distance, scaled by the cheapest cell cost
    return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz);
  }

  /**
   * String-pull the raw grid path: drop waypoints that a straight line can skip
   * while staying on walkable ground. Turns a staircase of 1 m cells into a
   * handful of natural corners.
   */
  smooth(cells) {
    if (cells.length < 3) return cells;
    const out = [cells[0]];
    let anchor = 0;

    for (let i = 2; i < cells.length; i++) {
      if (!this._lineWalkable(cells[anchor], cells[i])) {
        out.push(cells[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }

  /**
   * Can a 0.2 m capsule stand centred here? Samples the centre plus four
   * offsets, so a route that hugs a wall corner too tightly is rejected and
   * the player never gets visually clipped by the corner they are rounding.
   */
  _pointClear(x, z, r = 0.2) {
    return (
      this.isWalkable(x, z) &&
      this.isWalkable(x + r, z) &&
      this.isWalkable(x - r, z) &&
      this.isWalkable(x, z + r) &&
      this.isWalkable(x, z - r)
    );
  }

  /**
   * Flood fill from a world point. Stores a Uint8Array of reachable cells so
   * other systems (doors, NPC spawns, missions) can ask "can the player
   * actually walk here?" without running A* every time.
   */
  computeReachable(from) {
    const start = this.nearestWalkable(from.x, from.z);
    const reach = new Uint8Array(this.nx * this.nz);
    if (!start) { this.reachable = reach; return reach; }

    const stack = [this.id(start.ix, start.iz)];
    reach[stack[0]] = 1;

    while (stack.length) {
      const cur = stack.pop();
      const cx = this.gx(cur);
      const cz = this.gz(cur);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const nid = this.id(nx, nz);
          if (reach[nid] || this.blocked[nid]) continue;
          reach[nid] = 1;
          stack.push(nid);
        }
      }
    }

    this.reachable = reach;
    return reach;
  }

  /** Is this world point in the walkable component the player starts in? */
  isReachable(x, z) {
    if (!this.reachable) return this.isWalkable(x, z);
    const ix = this.worldToIdx(x);
    const iz = this.worldToIdxZ(z);
    if (!this.inBounds(ix, iz)) return false;
    return !!this.reachable[this.id(ix, iz)];
  }

  /** Nearest reachable cell to a point, searched in expanding rings. */
  nearestReachable(x, z, maxRing = 18) {
    const ix = this.worldToIdx(x);
    const iz = this.worldToIdxZ(z);
    for (let r = 0; r <= maxRing; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = ix + dx;
          const nz = iz + dz;
          if (!this.inBounds(nx, nz)) continue;
          if (this.isReachable(this.idxToWorld(nx), this.worldToZ(nz))) {
            return { x: this.idxToWorld(nx), z: this.worldToZ(nz), ix: nx, iz: nz };
          }
        }
      }
    }
    return null;
  }

  _lineWalkable(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const steps = Math.ceil(dist / 0.25);
    if (steps === 0) return true;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      // Centre-line sampling alone passes a diagonal that grazes a building
      // corner: the centre can sit in a free cell while the capsule the player
      // occupies overlaps the wall. Test the capsule, not the point.
      if (!this._pointClear(x, z)) return false;
    }
    return true;
  }

  /** Total length of a world-space path. */
  static pathLength(path, fromX, fromZ) {
    if (!path || path.length === 0) return 0;
    let len = 0;
    let px = fromX;
    let pz = fromZ;
    for (const p of path) {
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
    }
    return len;
  }
}

/** Small binary min-heap keyed by f-score, index-safe for repeated pushes. */
class MinHeap {
  constructor() {
    this.ids = [];
    this.keys = [];
  }

  get size() { return this.ids.length; }

  clear() {
    this.ids.length = 0;
    this.keys.length = 0;
  }

  push(id, key) {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this._swap(i, parent);
      i = parent;
    }
  }

  pop() {
    const top = this.ids[0];
    const lastId = this.ids.pop();
    const lastKey = this.keys.pop();
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.ids.length && this.keys[l] < this.keys[smallest]) smallest = l;
        if (r < this.ids.length && this.keys[r] < this.keys[smallest]) smallest = r;
        if (smallest === i) break;
        this._swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  _swap(a, b) {
    const ti = this.ids[a]; this.ids[a] = this.ids[b]; this.ids[b] = ti;
    const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk;
  }
}
