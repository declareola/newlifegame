// client/src/world/VehicleSystem.js
// Drivable vehicles: the 18-seater Hiace, the tricycle, the motorbike, the
// saloon, the SUV, the taxi and the Range Rover.
//
// The three Lagos vehicles are assembled from parts in world/vehicleParts.js
// (shared with the street fleet, so the bus you drive is the bus you saw
// parked); the cars are boxes and cylinders. Handling comes from the server's
// catalogue values (maxSpeed / acceleration / handling / seats), so a tricycle
// really is slow and a motorbike really is quick.
//
// The server owns money, fuel and where the vehicle was parked. This module
// owns only the moment-to-moment driving, and it reports the parking spot back
// with POST /api/vehicles/park when you step out.

import * as THREE from 'three';
import { getVehicles, buyVehicle, parkVehicle, refuelVehicle } from '../auth/api.js';
import { icon } from '../ui/icons.js';
import {
  hiaceParts, tricycleParts, motorcycleParts, currentKind, PART_KINDS,
} from './vehicleParts.js';

const ENTER_RANGE = 3.2;

// Shapes for the box-built cars. The Hiace / tricycle / motorbike are in
// vehicleParts.js instead; they only need a wheel count here.
const KIND_SHAPE = {
  hiace: { body: [1.9, 0.95, 5.3], cabin: [1.84, 0.78, 4.8], wheels: 4, roof: true },
  tricycle: { body: [1.35, 0.7, 2.7], cabin: [1.3, 1.32, 1.5], wheels: 3, roof: true },
  keke: { body: [1.5, 1.15, 2.1], cabin: [1.4, 1.3, 1.3], wheels: 3, roof: true },
  taxi: { body: [1.8, 0.75, 4.1], cabin: [1.66, 0.85, 1.9], wheels: 4, roof: true },
  sedan: { body: [1.85, 0.72, 4.3], cabin: [1.7, 0.8, 2.0], wheels: 4, roof: true },
  suv: { body: [2.0, 1.0, 4.6], cabin: [1.9, 1.05, 2.5], wheels: 4, roof: true },
  bus: { body: [1.9, 1.9, 5.3], cabin: [1.84, 0.78, 4.8], wheels: 4, roof: true },
  motorcycle: { body: [0.55, 0.55, 2.0], cabin: [0.5, 0.5, 0.9], wheels: 2, roof: false },
};

function makeWheel(radius, width) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 14);
  const m = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9, metalness: 0.05 });
  const wheel = new THREE.Mesh(g, m);
  wheel.rotation.z = Math.PI / 2;
  wheel.castShadow = true;
  return wheel;
}

/** Build one vehicle mesh from primitives, sized by its catalogue kind. */
/** The three vehicles that are drawn from real parts rather than boxes. */
const PART_BUILDERS = {
  hiace: (c) => hiaceParts(c, 0x2f6f9f),
  tricycle: (c) => tricycleParts(c, 0x2e8b57),
  motorcycle: (c) => motorcycleParts(c),
};

export function buildVehicleMesh(colour, kind = 'sedan') {
  kind = currentKind(kind);

  // Part-built vehicles: same geometry the street fleet uses, so what you buy
  // is what you were looking at.
  const parts = PART_BUILDERS[kind]?.(colour);
  if (parts) {
    const group = new THREE.Group();
    const wheels = [];
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geometry, p.material);
      if (p.offset) mesh.position.set(p.offset[0], p.offset[1], p.offset[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      if (p.wheel) {
        mesh.userData.wheelRadius = p.wheel;
        wheels.push(mesh);
      }
    }
    const box = PART_KINDS[kind].box;
    group.userData.kind = kind;
    group.userData.wheels = wheels;
    group.userData.wheelRadius = wheels[0]?.userData.wheelRadius || 0.33;
    group.userData.width = box.w;
    group.userData.length = box.l;
    group.userData.offset = 0.42;
    return group;
  }

  const shape = KIND_SHAPE[kind] || KIND_SHAPE.sedan;
  const group = new THREE.Group();
  group.userData.kind = kind;

  const paint = new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.42,
    metalness: 0.35,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fd7ea,
    roughness: 0.14,
    metalness: 0.6,
    transparent: true,
    opacity: 0.66,
  });

  const [bw, bh, bl] = shape.body;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bl), paint);
  body.position.y = 0.42 + bh / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const [cw, ch, cl] = shape.cabin;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cl), glass);
  cabin.position.y = 0.42 + bh + ch / 2 - 0.06;
  cabin.castShadow = true;
  group.add(cabin);

  if (shape.roof) {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(cw + 0.06, 0.09, cl * 0.94),
      paint
    );
    roof.position.y = 0.42 + bh + ch - 0.04;
    roof.castShadow = true;
    group.add(roof);
  }

  // Headlights + tail lights — cheap boxes, visible at night
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff3c4, emissive: 0xfff0b0, emissiveIntensity: 1.4, roughness: 0.4,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0xff5a5a, emissive: 0xd21f1f, emissiveIntensity: 1.1, roughness: 0.5,
  });
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.08), lampMat);
    lamp.position.set((sx * bw) / 2.6, 0.42 + bh * 0.6, -bl / 2 - 0.02);
    group.add(lamp);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.07), tailMat);
    tail.position.set((sx * bw) / 2.6, 0.42 + bh * 0.6, bl / 2 + 0.02);
    group.add(tail);
  }

  // Wheels
  const wheelR = kind === 'motorcycle' ? 0.34 : 0.36;
  const wheelW = kind === 'motorcycle' ? 0.14 : 0.26;
  const axleZ = bl / 2 - 0.85;
  const wheelRows = shape.wheels === 3
    ? [{ x: 0, z: -axleZ }, { x: -bw / 2, z: axleZ }, { x: bw / 2, z: axleZ }]
    : shape.wheels === 2
      ? [{ x: 0, z: -axleZ }, { x: 0, z: axleZ }]
      : [
          { x: -bw / 2, z: -axleZ }, { x: bw / 2, z: -axleZ },
          { x: -bw / 2, z: axleZ }, { x: bw / 2, z: axleZ },
          ...(shape.wheels === 6 ? [{ x: -bw / 2, z: axleZ - 1.2 }, { x: bw / 2, z: axleZ - 1.2 }] : []),
        ];

  const wheels = [];
  for (const w of wheelRows) {
    const wheel = makeWheel(wheelR, wheelW);
    wheel.position.set(w.x, wheelR, w.z);
    group.add(wheel);
    wheels.push(wheel);
  }

  group.userData.wheels = wheels;
  group.userData.wheelRadius = wheelR;
  group.userData.length = bl;
  group.userData.width = bw;

  return group;
}

export class VehicleSystem {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Object3D} o.avatar            - the walking avatar
   * @param {object} o.controller                - PlayerController (locked while driving)
   * @param {Array} o.collisionBoxes             - city AABBs
   * @param {function} o.getPosition             - () => {x, z, rot}
   * @param {function} o.onToast                 - (msg, type) => void
   * @param {function} o.onSpeed                 - (kph|null, vehicle) => void
   * @param {function} o.onFuel                  - (litres, tank) => void
   */
  constructor({ scene, avatar, controller, collisionBoxes, getPosition, onToast, onSpeed, onFuel, onPrompt }) {
    this.scene = scene;
    this.avatar = avatar;
    this.controller = controller;
    this.collisionBoxes = collisionBoxes || [];
    this.getPosition = getPosition || (() => ({ x: 0, z: 0, rot: 0 }));
    this.onToast = onToast || (() => {});
    this.onSpeed = onSpeed || (() => {});
    this.onFuel = onFuel || (() => {});
    this.onPrompt = onPrompt || (() => {});

    this.token = null;
    this.catalog = [];
    this.owned = [];          // [{id, vehicle_id, pos_x, pos_z, fuel, def}]
    this.meshes = new Map();  // vehicle row id -> THREE.Group

    this.driving = null;      // the row currently being driven
    this.speed = 0;           // m/s, signed
    this.heading = 0;
    this.nearby = null;

    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    scene.add(this.group);

    this._bindKeys();
  }

  setToken(token) {
    this.token = token;
  }

  // ── Loading ────────────────────────────────────────────────
  async load() {
    if (!this.token) return;
    const res = await getVehicles(this.token);
    if (res.error) {
      this.onToast(res.error, 'warning');
      return;
    }
    this.catalog = res.catalog || [];
    this.owned = res.owned || [];
    this.fuelPrice = res.fuelPricePerLitre || 900;
    this._syncMeshes();
  }

  /** Rebuild meshes from `this.owned`. Existing meshes are reused. */
  _syncMeshes() {
    const seen = new Set();
    for (const v of this.owned) {
      seen.add(v.id);
      if (this.meshes.has(v.id)) continue;
      const mesh = buildVehicleMesh(v.colour || v.def?.colour || 0x2f6fd0, v.def?.kind || 'sedan');
      mesh.position.set(v.pos_x, 0, v.pos_z);
      this.group.add(mesh);
      this.meshes.set(v.id, mesh);
    }
    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) {
        this.group.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }

  /** Remove a spawned vehicle (after exit the mesh stays; this is for logout). */
  clear() {
    for (const [, mesh] of this.meshes) this.group.remove(mesh);
    this.meshes.clear();
    this.owned = [];
    this.driving = null;
  }

  // ── Buying ─────────────────────────────────────────────────
  async buy(vehicleId, colour) {
    const res = await buyVehicle(this.token, vehicleId, colour);
    if (res.error) {
      this.onToast(res.error, 'warning');
      return null;
    }
    this.owned.push(res.vehicle);
    this._syncMeshes();
    this.onToast(`Bought a ${res.vehicle.def?.name || vehicleId}`, 'success');
    return res.vehicle;
  }

  async refuel(litres) {
    if (!this.driving) return;
    const res = await refuelVehicle(this.token, this.driving.id, litres);
    if (res.error) {
      this.onToast(res.error, 'warning');
      return;
    }
    this.driving.fuel = res.vehicle.fuel;
    this.onFuel(res.vehicle.fuel, res.tankLitres || 45);
    this.onToast(res.message || `Refuelled — ₦${Number(res.cost || 0).toLocaleString('en-NG')}`, 'info');
  }

  // ── Enter / exit ───────────────────────────────────────────
  _closestOwned() {
    const p = this.getPosition();
    let best = null;
    let bestD = ENTER_RANGE;
    for (const v of this.owned) {
      const d = Math.hypot(v.pos_x - p.x, v.pos_z - p.z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  enter(vehicle) {
    const target = vehicle || this._closestOwned();
    if (!target) return false;
    if (target.fuel <= 0.2) {
      this.onToast('Out of fuel — you cannot drive this', 'warning');
      return false;
    }

    this.driving = target;
    this.speed = 0;
    this.heading = this.getPosition().rot || 0;

    const mesh = this.meshes.get(target.id);
    if (mesh) mesh.rotation.y = this.heading;

    // Hide the walking avatar; the controller stops accepting input.
    this.avatar.visible = false;
    this.controller.setControlsLocked(true);
    if (typeof this.controller.setPaused === 'function') this.controller.setPaused(true);

    if (this.onPrompt) this.onPrompt(null);
    this.onSpeed(0, target);
    this.onFuel(target.fuel, target.def?.tankLitres || 45);
    this.onToast(`Driving the ${target.def?.name || 'vehicle'} — W/S throttle, A/D steer, F to get out`, 'info');
    return true;
  }

  async exit() {
    if (!this.driving) return;
    const v = this.driving;
    const mesh = this.meshes.get(v.id);

    // Step out on the driver's left, and only where there is room.
    const side = this.heading + Math.PI / 2;
    let outX = v.pos_x + Math.sin(side) * 1.7;
    let outZ = v.pos_z + Math.cos(side) * 1.7;
    if (this._blockedAt(outX, outZ)) {
      outX = v.pos_x - Math.sin(side) * 1.7;
      outZ = v.pos_z - Math.cos(side) * 1.7;
    }
    if (this._blockedAt(outX, outZ)) {
      outX = v.pos_x;
      outZ = v.pos_z;
    }

    this.avatar.position.set(outX, 0, outZ);
    this.avatar.visible = true;
    this.controller.setControlsLocked(false);
    if (typeof this.controller.setPaused === 'function') this.controller.setPaused(false);
    this.controller.facing = this.heading;

    this.driving = null;
    this.speed = 0;
    this.onSpeed(null, null);

    // Persist where it was parked, plus the fuel burned on the trip.
    if (mesh) {
      v.pos_x = mesh.position.x;
      v.pos_z = mesh.position.z;
    }
    await this._persistPark(v);

    const near = this._closestOwned();
    if (near) this.onPrompt(near);
  }

  async _persistPark(v) {
    if (!this.token) return;
    const res = await parkVehicle(this.token, v.id, v.pos_x, v.pos_z, v.fuel);
    if (res.error) this.onToast(`Could not save vehicle position: ${res.error}`, 'warning');
  }

  // ── Input ──────────────────────────────────────────────────
  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // F: get in the nearest owned vehicle / get out of the one you are in
      if (e.code === 'KeyF' && !e.repeat) {
        if (this.driving) this.exit();
        else if (this.nearby) this.enter(this.nearby);
      }
      if (e.code === 'KeyE' && !e.repeat && this.driving) {
        // E while driving refuels at a pump if the tank is not full
        this.refuel(15);
      }
    });
  }

  // ── Collision ──────────────────────────────────────────────
  _blockedAt(x, z, pad = 0.45) {
    for (const b of this.collisionBoxes) {
      if (
        x > b.minX - pad && x < b.maxX + pad &&
        z > b.minZ - pad && z < b.maxZ + pad
      ) return true;
    }
    return false;
  }

  /** Extra obstacles that move (street traffic); set by main.js after boot. */
  getDynamicObstacles = null;

  _circleBlocked(x, z, radius) {
    if (this.getDynamicObstacles) {
      for (const o of this.getDynamicObstacles()) {
        if (Math.hypot(x - o.x, z - o.z) < radius + o.r) return true;
      }
    }
    for (const b of this.collisionBoxes) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if (Math.hypot(x - cx, z - cz) < radius) return true;
    }
    return false;
  }

  // ── Per-frame ──────────────────────────────────────────────
  update(dt) {
    if (this.driving) this._drive(dt);
    else this._updatePrompt();
  }

  _updatePrompt() {
    const near = this._closestOwned();
    const changed = (near?.id ?? null) !== (this.nearby?.id ?? null);
    this.nearby = near;
    if (changed && this.onPrompt) this.onPrompt(near);
  }

  _drive(dt) {
    const v = this.driving;
    const mesh = this.meshes.get(v.id);
    if (!mesh) {
      this.driving = null;
      return;
    }

    const keys = this.controller.keys || {};
    const def = v.def || {};
    const maxSpeed = Math.max(6, (def.maxSpeed || 22) * 0.28);   // catalogue km/h → m/s
    const accel = (def.acceleration || 6) * 0.9;
    const handling = (def.handling || 5) * 0.22;
    const tank = def.tankLitres || 45;

    const throttle = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) -
                     (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
    const steer = (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0) -
                  (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0);
    const braking = keys['Space'] ? 1 : 0;

    if (v.fuel <= 0) {
      this.speed *= Math.max(0, 1 - 2.2 * dt);
    } else {
      // Throttle
      if (throttle > 0) this.speed += accel * dt;
      else if (throttle < 0) this.speed -= accel * 0.75 * dt;
      else this.speed *= Math.max(0, 1 - 0.9 * dt);

      // Brake
      if (braking) this.speed *= Math.max(0, 1 - 6 * dt);

      this.speed = THREE.MathUtils.clamp(this.speed, -maxSpeed * 0.4, maxSpeed);

      // Steering needs some speed to bite
      const grip = Math.min(1, Math.abs(this.speed) / 4);
      this.heading += steer * handling * grip * dt * Math.sign(this.speed || 1);

      // Fuel burn: ~1 litre per 90 m
      v.fuel = Math.max(0, v.fuel - (Math.abs(this.speed) * dt) / 90);
      if (v.fuel === 0) this.onToast('The tank ran dry — coast to a stop', 'warning');
    }

    // Move with collision slide
    const stepX = Math.sin(this.heading) * this.speed * dt;
    const stepZ = Math.cos(this.heading) * this.speed * dt;
    const radius = Math.max(0.9, (mesh.userData.width || 1.8) / 2);

    let nx = mesh.position.x + stepX;
    let nz = mesh.position.z + stepZ;
    let hit = false;

    if (this._circleBlocked(nx, nz, radius)) {
      // Try each axis alone so the vehicle slides along walls instead of sticking
      if (!this._circleBlocked(mesh.position.x + stepX, mesh.position.z, radius)) {
        nx = mesh.position.x + stepX;
        nz = mesh.position.z;
      } else if (!this._circleBlocked(mesh.position.x, mesh.position.z + stepZ, radius)) {
        nx = mesh.position.x;
        nz = mesh.position.z + stepZ;
      } else {
        nx = mesh.position.x;
        nz = mesh.position.z;
      }
      hit = true;
    }

    nx = THREE.MathUtils.clamp(nx, -92, 92);
    nz = THREE.MathUtils.clamp(nz, -92, 92);

    mesh.position.set(nx, 0, nz);
    mesh.rotation.y = this.heading;
    if (hit) this.speed *= 0.35;

    // Spin the wheels
    const wheels = mesh.userData.wheels || [];
    const spin = (this.speed * dt) / (mesh.userData.wheelRadius || 0.36);
    for (const w of wheels) w.rotation.x += spin;

    // Keep the live row in step so parking saves the true position
    v.pos_x = nx;
    v.pos_z = nz;

    // Follow camera + avatar riding inside
    this.avatar.position.set(nx, 0.9, nz);
    this.avatar.rotation.y = this.heading;

    this.onSpeed(Math.abs(this.speed) * 3.6, v);
    this.onFuel(v.fuel, tank);
  }

  /** Obstacles other systems (NPCs, player when on foot) must avoid. */
  getObstacles() {
    return this.owned.map((v) => ({
      x: v.pos_x,
      z: v.pos_z,
      radius: Math.max(1.1, ((v.def?.width || 1.9) / 2) + 0.4),
    }));
  }

  getPositions() {
    return this.owned.map((v) => ({ x: v.pos_x, z: v.pos_z }));
  }

  getOwned() {
    return this.owned;
  }
}
