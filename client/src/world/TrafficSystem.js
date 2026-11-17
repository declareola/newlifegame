// client/src/world/TrafficSystem.js
// Street traffic: cars parked along the kerbs and cars actually driving.
//
// Why instanced: a car built the way VehicleSystem builds a player car is about
// nine meshes. Forty parked cars would be 360 draw calls on their own, which is
// the whole frame budget for this scene. Instead every body, cabin and wheel is
// one InstancedMesh, so the entire fleet costs six draw calls no matter how many
// cars are on the street.
//
// The fleet is Lagos-flavoured on purpose: 18-seater Hiace minibuses (white and
// yellow — they replaced the danfo on most routes), keke NAPEP tricycles, okada
// motorcycles, plus ordinary sedans, SUVs and taxis.
//
// Everything here is deterministic except the driving, which advances with the
// clock — so the parked cars are always in the same place (tests can rely on
// that) while the traffic looks alive on screen.

import * as THREE from 'three';
import { roads as EKO_ROADS } from './ekoWorld.js';
import { islandAt } from './ekoBasin.js';
import { BRIDGE_PATHS, deckHeightAt, deckPoint, deckSlopeAt } from './bridgeProfile.js';
import { currentKind } from './vehicleParts.js';

// ── Fleet catalogue ───────────────────────────────────────────
// w = width, h = body height, l = length, wheelR = tyre radius,
// wheels = 4 | 3 | 2, weight = how common it is on the street.
export const CAR_KINDS = {
  sedan:      { w: 1.86, h: 0.72, l: 4.44, wheelR: 0.34, wheels: 4, weight: 30, colours: [0x1b2a41, 0x8d99ae, 0x2b2d42, 0xb9bcc2, 0x6d1a1a, 0x1f7a5a] },
  suv:        { w: 1.98, h: 0.94, l: 4.82, wheelR: 0.38, wheels: 4, weight: 20, colours: [0x24272b, 0xe4e4e4, 0x3d5a80, 0x7a4b1f] },
  taxi:       { w: 1.84, h: 0.76, l: 4.40, wheelR: 0.33, wheels: 4, weight: 14, colours: [0xf2c200, 0xf5d033] },
  hiace:      { w: 1.90, h: 1.90, l: 5.30, wheelR: 0.36, wheels: 4, weight: 20, colours: [0xdfe5e9, 0xf2e34a, 0xc9d2d8, 0x2a7d4f] },
  tricycle:   { w: 1.35, h: 1.42, l: 2.70, wheelR: 0.28, wheels: 3, weight: 12, colours: [0xf2c200, 0x2e8b57, 0xf5f5f5] },
  motorcycle: { w: 0.62, h: 0.90, l: 2.00, wheelR: 0.31, wheels: 2, weight: 8,  colours: [0x8b0000, 0x1a1a1a, 0x2f4f4f] },
};

export { FLEET_ALIASES, currentKind } from './vehicleParts.js';

/**
 * How far past each abutment a bridge car runs before it turns around, in metres.
 * Long enough that the turn happens on the approach road behind the abutment,
 * which is out of sight from the deck, and short enough that the cars are not
 * seen queueing on the island.
 */
export const RUN_OFF = 44;

/**
 * Inside this radius of a wrap point, a bridge car is *never* teleported.
 *
 * A car that vanishes at the far end of a bridge the player is looking down is
 * the single most obvious way to break the illusion, so instead of wrapping it
 * holds at the end of its run-off and waits for the player to leave. The radius is
 * wider than the run-off itself so the wait happens behind the abutment.
 */
export const WRAP_HIDE_RADIUS = 85;

/** Cars per span. Three spans of three is the nine the bridge should carry. */
const BRIDGE_CARS_PER_SPAN = 3;

/** Metres from the centreline of the lane a bridge car drives in. */
const BRIDGE_LANE = 2.2;

const COLOUR_BAG = (() => {
  const bag = [];
  for (const [kind, def] of Object.entries(CAR_KINDS)) {
    for (let i = 0; i < def.weight; i++) bag.push(kind);
  }
  return bag;
})();

// Deterministic PRNG — same fleet every load.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── Signals ───────────────────────────────────────────────────
// One cycle: avenues green, amber, streets green, amber. The cars obey it, which
// is what makes the traffic look like traffic instead of a conveyor belt.
const GREEN = 13;
const AMBER = 2.5;
const CYCLE = (GREEN + AMBER) * 2;

/** @returns {'green'|'amber'|'red'} for a travel axis at time t */
export function signalState(axis, t) {
  const p = ((t % CYCLE) + CYCLE) % CYCLE;
  if (axis === 'avenue') {
    if (p < GREEN) return 'green';
    if (p < GREEN + AMBER) return 'amber';
    return 'red';
  }
  if (p < GREEN + AMBER) return 'red';
  if (p < GREEN + AMBER + GREEN) return 'green';
  return 'amber';
}

// ── The road network, as the cars see it ─────────────────────
// Eko Basin's roads are axis-aligned strips of varying width (a 7.5 m avenue
// on the Core, a 3.4 m side street on the Outer Borough). A car does not know
// about "avenues" and "streets" any more — it drives down one strip, in one
// direction, and stops when a crossing strip has the green.
export const NETWORK = (() => {
  const strips = EKO_ROADS.map((r) => {
    const vertical = r.d >= r.w;
    const half = (vertical ? r.w : r.d) / 2;
    const from = (vertical ? r.z : r.x) - (vertical ? r.d : r.w) / 2;
    const to = (vertical ? r.z : r.x) + (vertical ? r.d : r.w) / 2;
    return {
      vertical,
      axis: vertical ? 'avenue' : 'street',
      fixed: vertical ? r.x : r.z,
      half,
      from,
      to,
      len: to - from,
      avenue: !!r.avenue,
      island: r.island,
    };
  }).filter((s) => s.len > 4);

  // Junctions: every place a vertical strip crosses a horizontal one.
  const junctions = [];
  for (const v of strips.filter((s) => s.vertical)) {
    for (const h of strips.filter((s) => !s.vertical)) {
      // A junction is where a horizontal strip's x-range covers the vertical
      // strip's x, and the vertical's z-range covers the horizontal's z.
      // (Comparing v.fixed to h.fixed compares an x to a z and finds almost
      // nothing — which is what this did before it was fixed.)
      if (v.fixed < h.from - 1 || v.fixed > h.to + 1) continue;
      if (h.fixed < v.from - 1 || h.fixed > v.to + 1) continue;
      junctions.push({
        x: v.fixed,
        z: h.fixed,
        // How far a car must stay clear of the box, measured from its centre.
        clearAvenue: h.half + 1.2,
        clearStreet: v.half + 1.2,
      });
    }
  }

  for (const s of strips) {
    s.junctions = junctions.filter((j) => (s.vertical
      ? Math.abs(j.x - s.fixed) < s.half + 1 && j.z > s.from - 6 && j.z < s.to + 6
      : Math.abs(j.z - s.fixed) < s.half + 1 && j.x > s.from - 6 && j.x < s.to + 6));
  }

  return { strips, junctions };
})();

/** Kerb inset and lane offset, in metres, from a strip's centreline. */
const KERB_OFFSET = 1.25;
const LANE_OFFSET = 1.45;

// ── Geometry helpers ──────────────────────────────────────────
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/**
 * Traffic.
 *
 * Public surface used by main.js:
 *   group            — add to the scene
 *   update(dt, t)    — advance the driving cars
 *   getObstacles()   — circles the player controller must not walk through
 */
export class TrafficSystem {
  constructor({ seed = 424242, parkedCount = 54, movingCount = 22 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'traffic';

    this.rnd = lcg(seed);
    this.parked = [];
    this.moving = [];
    this.bridgeCars = [];
    this._obstacles = [];

    this._buildParked(parkedCount);
    this._buildMoving(movingCount);
    this._buildBridgeCars();
    this._buildInstances();
    this._syncInstances(0);
  }

  // ── Fleet placement ────────────────────────────────────────
  /**
   * Where cars may park: the kerb lane of every road, in the gaps between
   * junctions. A crosswalk or junction is never a parking space.
   */
  _parkingSlots() {
    // Kerb space along every strip, cut away at the junctions: nobody parks in
    // a junction in Lagos unless they want their wing mirror taken off.
    const slots = [];
    for (const strip of NETWORK.strips) {
      if (strip.len < 12) continue;
      const off = Math.max(0.9, strip.half - KERB_OFFSET);
      const cuts = strip.junctions
        .map((j) => (strip.vertical ? j.z : j.x))
        .sort((a, b) => a - b);

      let from = strip.from + 3;
      const runs = [];
      for (const c of cuts) {
        const stop = c - (strip.vertical ? 8 : 8);
        if (stop - from > 6) runs.push([from, stop]);
        from = Math.max(from, c + 8);
      }
      if (strip.to - 3 - from > 6) runs.push([from, strip.to - 3]);

      for (const [a, b] of runs) {
        for (const side of [-1, 1]) {
          // A kerb space that has drifted over the shoreline is not a space.
          const midAlong = (a + b) / 2;
          const cx = strip.vertical ? strip.fixed + side * off : midAlong;
          const cz = strip.vertical ? midAlong : strip.fixed + side * off;
          if (!islandAt(cx, cz)) continue;
          slots.push({
            axis: strip.axis,
            vertical: strip.vertical,
            fixed: strip.fixed + side * off,
            from: a,
            to: b,
            dir: side > 0 ? 1 : -1,
            half: strip.half,
          });
        }
      }
    }
    return slots;
  }

  _buildParked(count) {
    const slots = this._parkingSlots();
    let attempts = 0;

    while (this.parked.length < count && attempts < count * 40) {
      attempts++;
      const slot = slots[Math.floor(this.rnd() * slots.length)];
      const kindName = COLOUR_BAG[Math.floor(this.rnd() * COLOUR_BAG.length)];
      const kind = CAR_KINDS[kindName];
      const span = slot.to - slot.from;
      if (span < kind.l + 1.5) continue;

      const along = slot.from + kind.l / 2 + this.rnd() * (span - kind.l);
      let x;
      let z;
      if (slot.axis === 'avenue') {
        x = slot.fixed;
        z = along;
      } else {
        x = along;
        z = slot.fixed;
      }

      // A slot's ends are checked, but a car sits up to five metres into it, so
      // re-test the exact spot: on a shoreline strip the far end of the slot can
      // already be over the water.
      if (!islandAt(x, z)) continue;

      // Two cars may not share the street.
      const clash = this.parked.some((p) => (kindName === 'motorcycle' || p.l < 2.2
        ? Math.hypot(p.x - x, p.z - z) < Math.max(p.l, kind.l) + 1.1
        : Math.hypot(p.x - x, p.z - z) < Math.max(p.l, kind.l) + 1.6));
      if (clash) continue;

      // Park facing the way that side of the road travels.
      const forward = slot.axis === 'avenue'
        ? { x: 0, z: slot.dir }
        : { x: slot.dir, z: 0 };

      this.parked.push({
        kind: kindName,
        def: kind,
        colour: kind.colours[Math.floor(this.rnd() * kind.colours.length)],
        x,
        z,
        heading: Math.atan2(forward.x, forward.z),
        l: kind.l,
        w: kind.w,
        spin: this.rnd() * Math.PI * 2,
      });
    }
  }

  _buildMoving(count) {
    const usable = NETWORK.strips.filter((s) => s.len > 18);
    let attempts = 0;
    while (this.moving.length < count && attempts < count * 20) {
      attempts++;
      const strip = usable[Math.floor(this.rnd() * usable.length)];
      const kindName = COLOUR_BAG[Math.floor(this.rnd() * COLOUR_BAG.length)];
      const kind = CAR_KINDS[kindName];
      const dir = this.rnd() < 0.5 ? 1 : -1;

      // Keep right, like Lagos does: the driving lane is offset from the
      // centreline, and wider vehicles sit a little further out.
      const laneOffset = Math.min(LANE_OFFSET + (kind.w > 2 ? 0.3 : 0), strip.half - 1.1);
      const along = strip.from + this.rnd() * strip.len;

      this.moving.push({
        kind: kindName,
        def: kind,
        colour: kind.colours[Math.floor(this.rnd() * kind.colours.length)],
        axis: strip.axis,
        vertical: strip.vertical,
        strip,
        dir,
        along,
        cross: strip.fixed + dir * laneOffset,
        speed: (strip.avenue ? 9 : 7) + this.rnd() * 5,
        maxSpeed: (strip.avenue ? 9 : 7) + this.rnd() * 5,
        l: kind.l,
        w: kind.w,
        spin: 0,
        x: 0,
        z: 0,
        heading: 0,
      });
    }
  }

  // ── Real models ────────────────────────────────────────────
  /**
   * Replace the box bodies of some kinds with real Kenney car models.
   *
   * Only the kinds that have a model are touched: the danfo, keke and okada
   * stay procedural, because they are the three most Lagos-specific vehicles on
   * the road and a generic hatchback wearing a danfo's yellow would be worse
   * than a box that is honestly a danfo.
   *
   * @param {Object<string,string>} map  kind → asset name ('sedan' → 'car.sedan')
   * @param {AssetLibrary} assets
   */
  useModels(map, assets) {
    const resolved = new Map();
    for (const [kind, value] of Object.entries(map || {})) {
      // A plain string is an asset name; an object is a ready-made part set
      // (see world/vehicleParts.js) already in vehicle-local metres.
      if (value && typeof value === 'object' && Array.isArray(value.parts)) {
        resolved.set(currentKind(kind), value);
        continue;
      }
      const assetName = value;
      const parts = assets?.instanceParts?.(assetName);
      const size = assets?.modelSize?.(assetName);
      if (!parts || !size) continue;
      resolved.set(currentKind(kind), { parts, size });
    }
    if (!resolved.size) return false;

    this.modelKinds = resolved;

    // Rebuild the instanced meshes so the model draw calls exist.
    for (const mesh of [this.bodyMesh, this.cabinMesh, this.wheelMesh]) {
      if (mesh) {
        this.group.remove(mesh);
        mesh.dispose?.();
      }
    }
    for (const list of (this.modelMeshes?.values() || [])) {
      for (const mesh of list) {
        this.group.remove(mesh);
        mesh.dispose?.();
      }
    }
    this.modelMeshes = new Map();
    this._buildInstances();
    this._syncInstances(0);
    return true;
  }

  /**
   * The cars on the bridges.
   *
   * These are not part of the street fleet: a strip car is pinned to a straight
   * road and would drive through the parapet. A bridge car is parameterised by how
   * far along its span it is (`u`), how far off the centreline it sits, and which
   * way it is going, and its world position and height come from the bridge
   * profile. That is what lets it climb the ramp: `y` is the deck under it, and its
   * pitch is the slope of that deck.
   */
  _buildBridgeCars() {
    for (const path of BRIDGE_PATHS) {
      for (let i = 0; i < BRIDGE_CARS_PER_SPAN; i++) {
        const kindName = COLOUR_BAG[Math.floor(this.rnd() * COLOUR_BAG.length)];
        const kind = CAR_KINDS[kindName];
        const dir = i % 2 === 0 ? 1 : -1;
        // Staggered, so they are not a convoy, and never spawned on top of each
        // other: the first car of each direction starts a third of the way in.
        const u = (i + 0.5) / BRIDGE_CARS_PER_SPAN - 0.5;
        this.bridgeCars.push({
          kind: kindName,
          def: kind,
          colour: kind.colours[Math.floor(this.rnd() * kind.colours.length)],
          path,
          dir,
          u,
          lateral: dir * BRIDGE_LANE,
          speed: 8 + this.rnd() * 6,
          maxSpeed: 8 + this.rnd() * 6,
          waiting: false,
          l: kind.l,
          w: kind.w,
          spin: 0,
          pitch: 0,
          x: 0,
          y: 0,
          z: 0,
          heading: 0,
        });
      }
    }
    this._placeBridgeCars();
  }

  /** Write each bridge car's world position, heading and pitch from the profile. */
  _placeBridgeCars() {
    for (const car of this.bridgeCars) {
      const u = Math.min(1, Math.max(0, car.u));
      const p = deckPoint(car.path, u, car.lateral);
      car.x = p.x;
      car.y = p.y;
      car.z = p.z;
      // Heading: forward is (sin h, cos h), and the travel direction is ±(ux, uz).
      car.heading = Math.atan2(car.path.ux * car.dir, car.path.uz * car.dir);
      // Nose up on the climb, nose down on the descent: rotate the car about its
      // own X axis by the slope it is standing on.
      car.pitch = -Math.atan(deckSlopeAt(car.path, u) * car.dir);
    }
  }

  // ── Rendering ──────────────────────────────────────────────
  _buildInstances() {
    const all = [...this.parked, ...this.moving, ...this.bridgeCars];
    this.modelMeshes = this.modelMeshes || new Map();

    // Which cars get a real model, and which fall back to boxes. The two groups
    // need independent instance indices, so the mapping is computed once here
    // and reused every frame.
    const prim = [];
    const byModel = new Map();
    for (const car of all) {
      const spec = this.modelKinds?.get(car.kind);
      if (spec) {
        if (!byModel.has(car.kind)) byModel.set(car.kind, []);
        car._slot = { type: 'model', kind: car.kind, i: byModel.get(car.kind).length };
        byModel.get(car.kind).push(car);
      } else {
        car._slot = { type: 'prim', i: prim.length };
        prim.push(car);
      }
    }
    this._primCars = prim;
    this._modelCars = byModel;

    // Body: one box per car, scaled per instance. Scaled boxes keep the
    // silhouette simple, and a car is mostly a box anyway.
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.35 });
    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, Math.max(prim.length, 1));
    this.bodyMesh.castShadow = true;
    this.bodyMesh.receiveShadow = true;
    this.bodyMesh.name = 'traffic-bodies';

    // Cabin: dark glass, slightly inset.
    const cabinGeo = new THREE.BoxGeometry(1, 1, 1);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x33404a, roughness: 0.15, metalness: 0.55,
    });
    this.cabinMesh = new THREE.InstancedMesh(cabinGeo, cabinMat, Math.max(prim.length, 1));
    this.cabinMesh.castShadow = true;
    this.cabinMesh.name = 'traffic-cabins';

    // Wheels: 4 per four-wheeler, fewer for keke and okada. Allocate the max.
    const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
    const wheelTotal = prim.reduce((n, c) => n + (c.def.wheels === 3 ? 3 : c.def.wheels === 2 ? 2 : 4), 0);
    this.wheelMesh = new THREE.InstancedMesh(wheelGeo, wheelMat, Math.max(wheelTotal, 1));
    this.wheelMesh.castShadow = true;
    this.wheelMesh.name = 'traffic-wheels';

    // Per-instance colour, so the fleet is not all one shade.
    for (let i = 0; i < prim.length; i++) {
      this.bodyMesh.setColorAt(i, _col.setHex(prim[i].colour));
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;

    this.group.add(this.bodyMesh, this.cabinMesh, this.wheelMesh);

    // One InstancedMesh per model part, per kind — the whole fleet of real cars
    // is a handful of draw calls.
    for (const [kind, cars] of byModel) {
      const spec = this.modelKinds.get(kind);
      const meshes = [];
      for (const part of spec.parts) {
        const material = part.material.clone();
        material.envMapIntensity = 0.8;
        // Parts with an offset (wheels) keep a centred geometry so a drivable
        // vehicle can spin them; bake the offset into the copy used here.
        const geometry = part.offset
          ? part.geometry.clone().translate(part.offset[0], part.offset[1], part.offset[2])
          : part.geometry;
        const mesh = new THREE.InstancedMesh(geometry, material, Math.max(cars.length, 1));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `traffic-model-${kind}-${meshes.length}`;
        for (let i = 0; i < cars.length; i++) {
          // The palette texture already carries the model's own paint; tinting
          // it a quarter of the way to the fleet colour gives variety without
          // turning a yellow taxi green. Our own procedural parts tag the
          // paintable ones with `tint`, so glass and chrome stay as they are.
          if (part.tint) mesh.setColorAt(i, _col.setHex(cars[i].colour));
          else mesh.setColorAt(i, _col.setHex(cars[i].colour).lerp(WHITE, 0.72));
        }
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        meshes.push(mesh);
        this.group.add(mesh);
      }
      this.modelMeshes.set(kind, meshes);
    }
  }

  /** Write every car's transform into the instanced meshes. */
  _syncInstances(dt) {
    let wheelIndex = 0;
    // Yaw first, then pitch: a car turns about its own vertical axis, and the ramp
    // tilts it about its own side-to-side axis. Doing it in the other order makes
    // a car on a diagonal span lean sideways.
    _e.order = 'YXZ';

    // ── Procedural cars (danfo, keke, okada, and anything without a model) ──
    for (const car of this._primCars || []) {
      const i = car._slot.i;
      const { w, h, l, wheelR } = car.def;
      const heading = car.heading;
      const deckY = car.y || 0;
      const pitch = car.pitch || 0;

      const bodyY = deckY + wheelR + h / 2;
      _q.setFromEuler(_e.set(pitch, heading, 0));
      _m.compose(_v.set(car.x, bodyY, car.z), _q, _s.set(w, h, l));
      this.bodyMesh.setMatrixAt(i, _m);

      const cabinH = h * 0.58;
      const cabinL = l * 0.52;
      _m.compose(
        _v.set(car.x, bodyY + h / 2 + cabinH / 2 - 0.04, car.z),
        _q,
        _s.set(w * 0.86, cabinH, cabinL),
      );
      this.cabinMesh.setMatrixAt(i, _m);

      const axle = l / 2 - 0.78;
      const rows = car.def.wheels === 3
        ? [{ x: 0, z: -axle }, { x: -w / 2, z: axle }, { x: w / 2, z: axle }]
        : car.def.wheels === 2
          ? [{ x: 0, z: -axle }, { x: 0, z: axle }]
          : [
              { x: -w / 2, z: -axle }, { x: w / 2, z: -axle },
              { x: -w / 2, z: axle }, { x: w / 2, z: axle },
            ];

      const cos = Math.cos(heading);
      const sin = Math.sin(heading);
      for (const r of rows) {
        const wx = car.x + r.x * cos + r.z * sin;
        const wz = car.z - r.x * sin + r.z * cos;
        _q.setFromEuler(_e.set(car.spin, heading, 0));
        _m.compose(_v.set(wx, deckY + wheelR, wz), _q, _s.set(wheelR, wheelR, wheelR * 0.72));
        this.wheelMesh.setMatrixAt(wheelIndex++, _m);
      }
    }

    // ── Real models ──
    // The Kenney models face +Z, which is the same convention the primitive
    // cars use, so the heading goes straight in. Each model is scaled to the
    // kind's real length so a sedan stays a sedan next to a flatbed truck.
    if (this._modelCars && this.modelMeshes) {
      for (const [kind, cars] of this._modelCars) {
        const meshes = this.modelMeshes.get(kind);
        if (!meshes || !meshes.length) continue;
        const spec = this.modelKinds.get(kind);
        const modelLength = spec.size.z || spec.size.x || 1;
        for (let i = 0; i < cars.length; i++) {
          const car = cars[i];
          const scale = car.def.l / modelLength;
          _q.setFromEuler(_e.set(car.pitch || 0, car.heading, 0));
          _m.compose(_v.set(car.x, 0.01 + (car.y || 0), car.z), _q, _s.set(scale, scale, scale));
          for (const mesh of meshes) mesh.setMatrixAt(i, _m);
        }
        for (const mesh of meshes) {
          mesh.count = cars.length;
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }

    this.bodyMesh.count = this._primCars ? this._primCars.length : 0;
    this.cabinMesh.count = this._primCars ? this._primCars.length : 0;
    this.wheelMesh.count = wheelIndex;

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.cabinMesh.instanceMatrix.needsUpdate = true;
    this.wheelMesh.instanceMatrix.needsUpdate = true;
    void dt;
  }

  // ── Simulation ─────────────────────────────────────────────
  /**
   * @param {number} dt seconds since the last frame
   * @param {number} t  seconds since load (drives the signal cycle)
   */
  update(dt, t = 0, player = null) {
    const step = Math.min(dt, 0.1);

    for (const car of this.moving) {
      let speed = car.maxSpeed;
      const strip = car.strip;
      const state = signalState(car.axis, t);

      // Red or amber ahead → ease to a stop at the junction's stop line.
      if (state !== 'green') {
        for (const j of strip.junctions) {
          const centre = car.vertical ? j.z : j.x;
          const ahead = (centre - car.along) * car.dir;
          const stopLine = ahead - (car.vertical ? j.clearAvenue : j.clearStreet) - 1.4;
          if (stopLine > 0 && stopLine < 9) {
            // Already inside the junction? Keep going, never stop in the box.
            speed = Math.min(speed, Math.max(0, stopLine * 1.6 - 0.4));
          }
        }
      }

      // Do not drive through the car in front.
      for (const other of this.moving) {
        if (other === car || other.strip !== strip || other.dir !== car.dir) continue;
        const gap = (other.along - car.along) * car.dir;
        if (gap > 0 && gap < car.l / 2 + other.l / 2 + 4.5) {
          speed = Math.min(speed, Math.max(0, (gap - car.l / 2 - other.l / 2 - 1.2) * 1.8));
        }
      }

      car.speed += (speed - car.speed) * Math.min(1, step * 4);
      car.along += car.speed * car.dir * step;
      car.spin += (car.speed * step) / car.def.wheelR;

      // Wrap around at the end of the strip, out of sight behind the block.
      if (car.along > strip.to + 4) car.along = strip.from - 4;
      if (car.along < strip.from - 4) car.along = strip.to + 4;

      if (car.vertical) {
        car.x = car.cross;
        car.z = car.along;
        car.heading = car.dir > 0 ? 0 : Math.PI;
      } else {
        car.x = car.along;
        car.z = car.cross;
        car.heading = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
    }

    // ── The bridges ──
    for (const car of this.bridgeCars) {
      // Do not drive into the car in front on the same span, in the same lane.
      let target = car.maxSpeed;
      for (const other of this.bridgeCars) {
        if (other === car || other.path !== car.path || other.dir !== car.dir) continue;
        const ahead = (other.u - car.u) * car.dir * car.path.length;
        const gap = ahead - car.l / 2 - other.l / 2;
        if (ahead > 0 && gap < 6) target = Math.min(target, Math.max(0, gap * 1.4));
      }

      car.speed += (target - car.speed) * Math.min(1, step * 3);
      if (car.waiting) car.speed = Math.min(car.speed, 0.5);

      car.u += (car.speed * car.dir * step) / Math.max(car.path.length, 1);
      car.spin += (car.speed * step) / car.def.wheelR;

      // The end of the run-off. Wrap only when nobody can see the wrap happen;
      // otherwise pull up and wait, on the approach, out of sight of the deck.
      const past = car.u > 1 + RUN_OFF / car.path.length
        || car.u < -RUN_OFF / car.path.length;

      if (past) {
        const endU = car.u > 0.5 ? 1 : 0;
        const end = deckPoint(car.path, endU, 0);
        const unwatched = !player
          || Math.hypot(player.x - end.x, player.z - end.z) > WRAP_HIDE_RADIUS;

        if (unwatched) {
          car.u = car.u > 0.5 ? -RUN_OFF / car.path.length : 1 + RUN_OFF / car.path.length;
          car.waiting = false;
        } else {
          // Hold at the end of the run-off: speed decays to a crawl.
          car.u = endU + (car.dir > 0 ? 1 : -1) * (RUN_OFF / car.path.length) * 0.02;
          car.waiting = true;
        }
      }
    }
    this._placeBridgeCars();

    this._syncInstances(dt);
  }

  /**
   * Circles the player must not walk through. Parked cars never move, but the
   * driving ones do, so this is rebuilt on demand rather than cached at build.
   */
  getObstacles() {
    const out = this._obstacles;
    out.length = 0;

    for (const car of this.parked) {
      const r = Math.max(1.0, car.w * 0.62);
      const dx = Math.sin(car.heading) * car.l * 0.26;
      const dz = Math.cos(car.heading) * car.l * 0.26;
      out.push({ x: car.x + dx, z: car.z + dz, r });
      out.push({ x: car.x - dx, z: car.z - dz, r });
    }
    for (const car of this.moving) {
      if (car.speed < 0.2) continue;
      const r = Math.max(1.0, car.w * 0.62);
      const dx = Math.sin(car.heading) * car.l * 0.26;
      const dz = Math.cos(car.heading) * car.l * 0.26;
      out.push({ x: car.x + dx, z: car.z + dz, r });
      out.push({ x: car.x - dx, z: car.z - dz, r });
    }
    // Bridge cars are solid as well: walking the deck means walking around them.
    for (const car of this.bridgeCars) {
      const r = Math.max(1.0, car.w * 0.62);
      const dx = Math.sin(car.heading) * car.l * 0.26;
      const dz = Math.cos(car.heading) * car.l * 0.26;
      out.push({ x: car.x + dx, z: car.z + dz, r });
      out.push({ x: car.x - dx, z: car.z - dz, r });
    }
    return out;
  }

  /** Counts for the debug panel and tests. */
  getStats() {
    return {
      parked: this.parked.length,
      moving: this.moving.length,
      bridgeCars: this.bridgeCars.length,
      onBridges: this.bridgeCars.filter((c) => c.u >= 0 && c.u <= 1).length,
      wheels: this.wheelMesh.count,
      bodies: this.bodyMesh.count,
    };
  }
}
