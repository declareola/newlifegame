// client/src/world/InteriorBuilder.js
// Generates the inside of buildings: walls with real doorways and windows,
// skirting boards, ceilings, zoned flooring (tile kitchen, carpet bedroom,
// wood living room) and a full furniture layout per building type.
//
// Everything is generated from primitives at runtime, like the exterior.
// Coordinates are interior-local: the room is centred on the origin, the door
// is always on the +Z wall, and the floor sits at y = 0.

import * as THREE from 'three';
import { materials } from './materials.js';
import { mergeByMaterial } from './mergeUtils.js';
import {
  plasticChair, armchair, sofa, stool, bed, table, coffeeTable, wardrobe,
  bookshelf, tvUnit, kitchenCounter, wallCabinets, toilet, basin, showerUnit,
  fridge, pottedPlant, ceilingLamp, aircon, pictureFrame, rug,
} from './furniture.js';
import { makeRng } from './BuildingFactory.js';
import { furnish } from './interiorLayouts.js';
import { makeStation, createStationMarker } from './stations.js';

// ── Small helpers ───────────────────────────────────────────────

function segBox(len, h, thick, mat, cx, cy, cz, rotY) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, h, thick), mat);
  m.position.set(cx, cy, cz);
  m.rotation.y = rotY;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Axis-aligned bounds of a w×d footprint rotated by rotY about its centre. */
function rotatedAabb(x, z, w, d, rotY) {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  const halfW = (w * c + d * s) / 2;
  const halfD = (w * s + d * c) / 2;
  return { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD };
}

// ── Shell ───────────────────────────────────────────────────────

/**
 * A wall run with optional openings.
 * @param {THREE.Group} group
 * @param {Array} collisions
 * @param {object} o
 *   x1,z1,x2,z2  line
 *   height       wall height
 *   thickness
 *   door         {at, width, height}  full-height gap (at = distance from (x1,z1))
 *   windows      [{at, width, sill, top}]
 */
function wallRun(group, collisions, o) {
  const {
    x1, z1, x2, z2,
    height = 3.0,
    thickness = 0.20,
    mat = materials.interiorWall(),
    door = null,
    windows = [],
    skirting = true,
  } = o;

  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const rotY = -Math.atan2(dz, dx);
  const ux = dx / len;
  const uz = dz / len;

  const at = (t) => ({ x: x1 + ux * t, z: z1 + uz * t });

  // Split the run into solid spans, inserting sills and lintels over windows.
  const spans = [];
  let cursor = 0;
  const openings = [];

  if (door) {
    openings.push({ type: 'door', from: door.at - door.width / 2, to: door.at + door.width / 2, door });
  }
  for (const w of windows) {
    openings.push({
      type: 'window', from: w.at - w.width / 2, to: w.at + w.width / 2,
      sill: w.sill ?? 0.95, top: w.top ?? 2.25,
    });
  }
  openings.sort((a, b) => a.from - b.from);

  for (const op of openings) {
    const from = Math.max(0, op.from);
    const to = Math.min(len, op.to);
    if (from > cursor) spans.push({ from: cursor, to: from, solid: true });
    spans.push({ from, to, solid: false, op });
    cursor = Math.max(cursor, to);
  }
  if (cursor < len) spans.push({ from: cursor, to: len, solid: true });

  const skirtingMat = materials.matte(0xd9d4cb);

  for (const span of spans) {
    const spanLen = span.to - span.from;
    if (spanLen <= 0.02) continue;
    const mid = (span.from + span.to) / 2;
    const p = at(mid);

    if (span.solid) {
      group.add(segBox(spanLen, height, thickness, mat, p.x, height / 2, p.z, rotY));
      // Collision for solid spans only — openings stay walkable.
      const a = rotatedAabb(p.x, p.z, spanLen, thickness, rotY);
      collisions.push(a);
      if (skirting) {
        group.add(segBox(spanLen, 0.10, thickness + 0.03, skirtingMat, p.x, 0.05, p.z, rotY));
      }
      continue;
    }

    const op = span.op;

    if (op.type === 'door') {
      // Lintel above the doorway
      const lintelH = Math.max(0.15, height - (op.door.height ?? 2.15));
      group.add(segBox(spanLen, lintelH, thickness, mat, p.x, height - lintelH / 2, p.z, rotY));
      // Door frame
      const frameMat = materials.matte(0xf0ece4);
      const doorH = op.door.height ?? 2.15;
      for (const edge of [span.from, span.to]) {
        const e = at(edge);
        group.add(segBox(0.09, doorH, thickness + 0.06, frameMat, e.x, doorH / 2, e.z, rotY));
      }
      group.add(segBox(spanLen, 0.09, thickness + 0.06, frameMat, p.x, doorH, p.z, rotY));
      continue;
    }

    // Window: solid below the sill, solid above the head, glass in between.
    group.add(segBox(spanLen, op.sill, thickness, mat, p.x, op.sill / 2, p.z, rotY));
    const above = height - op.top;
    if (above > 0.02) {
      group.add(segBox(spanLen, above, thickness, mat, p.x, op.top + above / 2, p.z, rotY));
    }
    const a = rotatedAabb(p.x, p.z, spanLen, thickness, rotY);
    collisions.push(a);

    const winH = op.top - op.sill;
    // Bright pane — daylight coming in
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(spanLen - 0.06, winH - 0.06),
      materials.glassLit()
    );
    pane.position.set(p.x, op.sill + winH / 2, p.z);
    pane.rotation.y = rotY + Math.PI / 2;
    group.add(pane);

    // Reveal box behind the pane so it reads as a real opening
    group.add(segBox(spanLen, winH, thickness * 0.6, materials.matte(0x20242a), p.x, op.sill + winH / 2, p.z, rotY)
      .translateY(0));

    // Frame + mullion
    const frameMat = materials.matte(0xf2eee6);
    const trans = Math.abs(Math.cos(rotY));
    const ox = trans * thickness * 0.28 * Math.sign(Math.cos(rotY) || 1);
    const oz = (1 - trans) * thickness * 0.28 * Math.sign(Math.sin(rotY) || 1);
    for (const edge of [op.sill, op.top]) {
      group.add(segBox(spanLen, 0.06, thickness + 0.02, frameMat, p.x, edge, p.z, rotY));
    }
    group.add(segBox(0.05, winH, thickness + 0.02, frameMat, p.x, op.sill + winH / 2, p.z, rotY));
    void ox; void oz;

    if (skirting) {
      group.add(segBox(spanLen, 0.10, thickness + 0.03, skirtingMat, p.x, 0.05, p.z, rotY));
    }
  }
}

/** Floor patch (zone) at a given y with a chosen material. */
function cyl(r, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function sphere(r, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Thin flat slab — mats, tarpaulins, conveyor belts. */
function plate(w, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

function floorPatch(group, x, z, w, d, mat, y = 0.01) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  group.add(m);
  return m;
}

// ── Layout vocabulary ───────────────────────────────────────────

// How much of a furniture footprint is *not* solid. A sofa's AABB is its
// silhouette, but the player only bumps into the seat and arms — the overhang
// and the skirt are walkable space. Insetting every furniture collider by this
// margin is what stops a room full of furniture from feeling like a maze.
const FURNITURE_INSET = 0.18;

// Anything below this footprint area is decor, not an obstacle: rugs, stools,
// pot plants, side tables. You step over or around these; you do not get stuck.
const MIN_SOLID_AREA = 0.75;

/**
 * Place a furniture group and register its footprint as collision.
 *
 * Only things a person would actually bump into become solids, and every solid
 * is inset by FURNITURE_INSET so the walkable area around it is the space the
 * mesh visually leaves, not the space its bounding box claims.
 */
function place(group, collisions, prop, x, z, rotY = 0, footprint = null, y = 0) {
  prop.position.set(x, y, z);
  prop.rotation.y = rotY;
  group.add(prop);

  if (footprint) {
    const area = footprint.w * footprint.d;
    if (area >= MIN_SOLID_AREA) {
      const w = Math.max(0.2, footprint.w - FURNITURE_INSET * 2);
      const d = Math.max(0.2, footprint.d - FURNITURE_INSET * 2);
      collisions.push(rotatedAabb(x, z, w, d, rotY));
    }
  }
  return prop;
}

/** Ceiling light fitting + the position a real PointLight should go. */
function addCeilingLamp(group, lights, x, z, ceilingY) {
  const lamp = ceilingLamp(0.26);
  lamp.position.set(x, ceilingY - 0.02, z);
  group.add(lamp);
  lights.push({ x, y: ceilingY - 0.35, z });
}

/** Framed picture on a wall, facing inward. rotY selects the wall. */
function addPicture(group, x, z, y, rotY, color) {
  const frame = pictureFrame(0.62, 0.46, color);
  frame.position.set(x, y, z);
  frame.rotation.y = rotY;
  group.add(frame);
}

// ── Room definitions ────────────────────────────────────────────

const PALETTES = [
  { living: 0x2f5d50, accent: 0xc8763c, duvet: 0xb5482f, rug: 0x8e4b3a },
  { living: 0x37474f, accent: 0xd9a441, duvet: 0x2f6f8f, rug: 0x3f6b5e },
  { living: 0x6d3b47, accent: 0xe0b060, duvet: 0x5b4b8a, rug: 0x9c6b3f },
  { living: 0x243b53, accent: 0x8fb8a8, duvet: 0xa0452e, rug: 0x4a5d6b },
  { living: 0x5d4037, accent: 0xf0a35e, duvet: 0x6d8c3f, rug: 0x7b5e57 },
  { living: 0x1f4e5f, accent: 0xe07a5f, duvet: 0x3d405b, rug: 0x81b29a },
];

// Wall paint per interior. Same architecture, different paint and floors, which
// is most of what makes two rooms feel like different rooms.
const WALL_TINTS = [
  0xf2ede4, 0xefe6d8, 0xe6edf0, 0xf7ebe3, 0xe9ecdf, 0xf0eaf2, 0xe4e9e2, 0xf4efe6,
];

/**
 * Register a station and draw its floor ring.
 *
 * Stations are pushed *before* the room is merged, so the ring becomes part of
 * the merged geometry: one extra draw call per room, not per station. A station
 * whose marker would sit inside furniture is still registered — the radius is
 * what matters for interaction — but the ring is skipped so it cannot be seen
 * glowing through a sofa.
 *
 * @param {Array} stations
 * @param {THREE.Group} group
 * @param {object} spec
 * @returns {object|null} the station
 */
function addStation(stations, group, spec) {
  const station = makeStation(spec);
  if (!station) return null;
  stations.push(station);
  try {
    group.add(createStationMarker(station));
  } catch {
    // A marker is decoration; a failure must not stop the room being built.
  }
  return station;
}

/**
 * Build one interior.
 * @param {object} def - { id, name, type, width, depth, height, floor }
 * @returns {{group, collisions, spawn, bounds, lights, exitZ}}
 */
export function buildInterior(def) {
  const rng = makeRng(def.id || 'interior');
  const pal = PALETTES[Math.floor(rng() * PALETTES.length)];

  // One tinted plaster material per interior. Cloned, because materials.js
  // caches shared instances and tinting one would repaint every room.
  const wallTint = WALL_TINTS[Math.floor(rng() * WALL_TINTS.length)];
  const wallMat = materials.interiorWall().clone();
  wallMat.color.setHex(wallTint);

  const type = def.type || 'studio';
  const W = def.width ?? 9;
  const D = def.depth ?? 8;
  const H = def.height ?? 3.0;

  const group = new THREE.Group();
  const collisions = [];
  const lights = [];
  const reservedFloor = [];
  const stations = [];

  const hw = W / 2;
  const hd = D / 2;
  const T = 0.20;
  const doorW = 1.6;

  // ── Floor ────────────────────────────────────────────────
  floorPatch(group, 0, 0, W, D, def.floor === 'tile' ? materials.floorTile() : materials.floorWood(), 0.01);
  // Structural slab edge (visible through the doorway)
  group.add(box(W + 0.4, 0.25, D + 0.4, materials.concreteGround(), 0, -0.13, 0));

  // ── Ceiling ──────────────────────────────────────────────
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), materials.ceiling());
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  ceil.receiveShadow = true;
  group.add(ceil);
  // Ceiling cornice
  for (const s of [-1, 1]) {
    group.add(box(W, 0.08, 0.08, materials.matte(0xf7f5f1), 0, H - 0.04, s * (hd - 0.06)));
    group.add(box(0.08, 0.08, D, materials.matte(0xf7f5f1), s * (hw - 0.06), H - 0.04, 0));
  }

  // ── Outer walls ──────────────────────────────────────────
  // +Z wall (front) holds the entrance door
  wallRun(group, collisions, {
    x1: -hw, z1: hd, x2: hw, z2: hd, height: H, thickness: T, mat: wallMat,
    door: { at: W / 2, width: doorW, height: 2.2 },
    windows: [{ at: W * 0.14, width: Math.min(2.2, W * 0.24), sill: 0.9, top: 2.2 }],
  });
  // -Z wall (back) — picture window
  wallRun(group, collisions, {
    x1: -hw, z1: -hd, x2: hw, z2: -hd, height: H, thickness: T, mat: wallMat,
    windows: [{ at: W / 2, width: Math.min(3.0, W * 0.42), sill: 0.8, top: 2.3 }],
  });
  // -X and +X walls
  wallRun(group, collisions, {
    x1: -hw, z1: -hd, x2: -hw, z2: hd, height: H, thickness: T, mat: wallMat,
    windows: [{ at: D / 2, width: Math.min(2.4, D * 0.3), sill: 0.95, top: 2.25 }],
  });
  wallRun(group, collisions, {
    x1: hw, z1: -hd, x2: hw, z2: hd, height: H, thickness: T, mat: wallMat,
    windows: [{ at: D * 0.5, width: Math.min(2.0, D * 0.26), sill: 0.95, top: 2.25 }],
  });

  // ── What kind of room is this? ────────────────────────────
  //
  // This is the fix for "the inside of the houses are all the same": the old
  // builder put a sofa, a kitchen and a bed into *every* interior and then
  // sprinkled shop shelving on top, so a garage and a market were the same flat
  // with different clutter. Only homes get a home. Shops, clinics, offices and
  // kiosks get a working floor instead, and each of those is fitted differently.
  const RESIDENTIAL = new Set(['studio', 'onebed', 'twobed', 'home', 'apartment', 'loft']);
  const isResidential = def.residential === true || RESIDENTIAL.has(type);

  // Commercial layouts: where the service counter sits and whether there is a
  // back room. Derived from the id so a given building always looks the same.
  const counterSide = rng() < 0.5 ? -1 : 1;
  const hasBackRoom = !isResidential && (type === 'office' || type === 'bank' || type === 'clinic') && D >= 9;

  // Homes are mirrored left/right so two flats on the same street are not
  // identical: bedroom wing on the right (+1) or the left (-1).
  const side = rng() < 0.5 ? 1 : -1;

  const partitionX = isResidential && type !== 'studio'
    ? side * (hw - Math.min(4.2, W * 0.42))
    : null;

  const outerX = side * hw;
  const roomW = partitionX !== null ? Math.abs(outerX - partitionX) : 0;
  const roomCX = partitionX !== null ? (partitionX + outerX) / 2 : 0;
  const livingCX = partitionX !== null ? (partitionX - outerX) / 2 : 0;
  const livingW = partitionX !== null ? Math.abs(partitionX + outerX) : W;

  if (partitionX !== null) {
    // Partition runs front-to-back, leaving a doorway near the front.
    wallRun(group, collisions, {
      x1: partitionX, z1: -hd, x2: partitionX, z2: hd, height: H, thickness: T * 0.75,
      mat: wallMat,
      door: { at: D * 0.82, width: 1.3, height: 2.1 },
    });
  }

  if (isResidential) {
    // ── Kitchen zone in the back corner ──────────────────────
    const kitchenDepth = Math.min(2.6, D * 0.32);
    floorPatch(group, livingCX, -hd + kitchenDepth / 2, livingW - 0.3, kitchenDepth, materials.floorTile(), 0.015);

    if (partitionX !== null) {
      // Carpet in the bedroom
      floorPatch(group, roomCX, 0, roomW - 0.3, D - 0.3, materials.carpet(), 0.015);
    }

    // ── Furniture: living area ─────────────────────────────
    const sofaZ = hd - 2.4;
    place(group, collisions, sofa(pal.living, 3), livingCX, sofaZ, 0, { w: 2.3, d: 0.95 });
    place(group, collisions, rug(2.4, 1.7, pal.rug), livingCX, sofaZ - 1.5, 0, null, 0.02);
    place(group, collisions, coffeeTable(1.2, 0.65), livingCX, sofaZ - 1.45, 0, { w: 1.2, d: 0.65 });
    place(group, collisions, tvUnit(1.5), livingCX, -hd + kitchenDepth + 0.75, 0, { w: 1.5, d: 0.45 });
    place(group, collisions, armchair(pal.accent), livingCX + side * 1.9, sofaZ - 1.4, Math.PI * 0.5, { w: 0.95, d: 0.9 });

    addPicture(group, livingCX - 1.2, hd - T / 2 - 0.02, 1.9, Math.PI, pal.accent);
    addPicture(group, livingCX + 1.4, hd - T / 2 - 0.02, 1.9, Math.PI, pal.living);
    addPicture(group, -outerX + T / 2 + 0.02, 0, 1.75, Math.PI / 2, pal.rug);

    // Bookshelf against the living-side wall
    place(group, collisions, bookshelf(1.1, 1.9, 0.34),
      -outerX + 0.9, 0.3, Math.PI / 2, { w: 1.1, d: 0.34 });
    place(group, collisions, pottedPlant(1.25), -outerX + 0.75, hd - 0.9, 0, { w: 0.5, d: 0.5 });

    // ── Furniture: kitchen ─────────────────────────────────
    const kx = livingCX + side * (livingW * 0.5 - 1.6);
    place(group, collisions, kitchenCounter(2.4, 0.62, 0.9), kx, -hd + 0.42, 0, { w: 2.4, d: 0.62 });
    const cab = wallCabinets(2.4, 0.7, 0.34);
    cab.position.set(kx, 1.62, -hd + 0.28);
    group.add(cab);
    place(group, collisions, fridge(), livingCX - side * (livingW * 0.5 - 0.75), -hd + 1.0, 0, { w: 0.7, d: 0.68 });
    place(group, collisions, table(1.1, 0.75, 0xa9825a), kx - side * 0.2, -hd + kitchenDepth + 0.95, 0, { w: 1.1, d: 0.75 });
    // Stools are decor: you push them in to sit down, so they never block.
    place(group, collisions, stool(0xb08a5a), kx - side * 0.9, -hd + kitchenDepth + 0.95, 0, null);
    place(group, collisions, stool(0xb08a5a), kx + side * 0.5, -hd + kitchenDepth + 0.95, 0, null);

    // ── Furniture: bedroom + bathroom (non-studio) ─────────
    //
    // The bathroom used to be a nook in the *front* corner of the bedroom,
    // separated by a wall whose run crossed the bedroom doorway — so the wing
    // was sealed and the player could see a bedroom they could never enter.
    // The nook now takes the back strip, the doorway is the one clear path in,
    // and the bed is pushed against the partition instead of the far wall.
    if (partitionX !== null) {
      const nookDepth = D >= 8 ? 2.2 : 0;        // back strip for the bathroom
      const bathZ = -hd + nookDepth;
      const bedZ = bathZ + (hd - bathZ) * 0.42;  // middle of the remaining room

      // Bed against the partition wall, head at the partition.
      place(group, collisions, bed(1.6, pal.duvet),
        partitionX + side * 1.05, bedZ, Math.PI / 2, { w: 1.6, d: 2.05 });
      // Wardrobe on the outer wall, clear of the doorway.
      place(group, collisions, wardrobe(1.3, 2.05, 0.6),
        outerX - side * 0.32, bathZ + 1.2, Math.PI / 2, { w: 1.3, d: 0.6 });
      addPicture(group, roomCX, -hd + T / 2 + 0.03, 2.0, 0, pal.accent);

      const ac = aircon();
      ac.position.set(roomCX, 2.15, hd - T / 2 - 0.12);
      ac.rotation.y = Math.PI;
      group.add(ac);

      const acLiving = aircon();
      acLiving.position.set(livingCX + 0.6, 2.2, -hd + T / 2 + 0.12);
      group.add(acLiving);

      if (nookDepth > 0) {
        // Bathroom: back strip, wall across the bedroom, door at the far end
        // from the bedroom doorway so the two openings never line up.
        const bathX0 = partitionX + side * T * 0.5;
        const bathX1 = outerX - side * 0.1;
        const bathDoorAt = side > 0 ? 0.8 : Math.abs(bathX1 - bathX0) - 0.8;
        wallRun(group, collisions, {
          x1: bathX0, z1: bathZ, x2: bathX1, z2: bathZ,
          height: 2.2, thickness: 0.10,
          door: { at: bathDoorAt, width: 0.85, height: 2.0 },
        });
        floorPatch(group, (partitionX + outerX) / 2, (-hd + bathZ) / 2,
          roomW - 0.2, nookDepth - 0.1, materials.tileBathroom(), 0.02);
        place(group, collisions, toilet(), outerX - side * 0.6, -hd + 0.55, side * Math.PI / 2, null);
        place(group, collisions, basin(), partitionX + side * 0.75, -hd + 0.4, 0, null);
        place(group, collisions, showerUnit(), roomCX, -hd + 1.55, 0, { w: 0.9, d: 0.9 });
      }
    }
    // ── What you can do at home ──────────────────────────────
    //
    // A home is not a thing you look at. Every fitting that implies an action
    // gets a station, and each action is a real server call:
    //   · sleep / nap on the bed        (homeBonus: a better home restores more)
    //   · cook at the hob, eat from the fridge
    //   · shower, toilet, laundry
    //   · change clothes at the wardrobe (the appearance endpoint)
    //   · watch TV on the sofa, read at the bookshelf
    //   · work from home at the desk (smarts, no commute)
    const bedX = partitionX !== null ? partitionX + side * 1.05 : livingCX + side * 2.2;
    const bedZ = partitionX !== null
      ? (-hd + (D >= 8 ? 2.2 : 0)) + (hd - (-hd + (D >= 8 ? 2.2 : 0))) * 0.42
      : -hd + 2.4;

    addStation(stations, group, {
      id: 'bed', label: 'Use the bed', icon: '🛏️', x: bedX + side * 0.9, z: bedZ + 0.4,
      radius: 1.9,
      actions: [
        { kind: 'activity', id: 'sleep', label: 'Sleep', hint: 'Restores energy — boosted by your home' },
        { kind: 'activity', id: 'nap', label: 'Lie down for a nap', hint: 'A short rest' },
      ],
    });

    addStation(stations, group, {
      id: 'hob', label: 'Cook at the hob', icon: '🍳', x: kx, z: -hd + kitchenDepth * 0.55,
      radius: 1.8,
      actions: [
        { kind: 'activity', id: 'cook', label: 'Cook a meal', hint: 'Hunger +45, energy −8' },
        { kind: 'activity', id: 'eat', label: 'Fix a quick plate', hint: 'Hunger +40' },
      ],
    });

    addStation(stations, group, {
      id: 'fridge', label: 'Open the fridge', icon: '🧊',
      x: livingCX - side * (livingW * 0.5 - 0.75), z: -hd + 1.9, radius: 1.7,
      actions: [
        { kind: 'activity', id: 'eat', label: 'Eat from the fridge', hint: 'Hunger +40' },
        { kind: 'activity', id: 'cook', label: 'Cook something proper', hint: 'Hunger +45' },
      ],
    });

    addStation(stations, group, {
      id: 'bath', label: 'Wash up', icon: '🚿',
      x: partitionX !== null ? roomCX : livingCX + side * 1.8,
      z: -hd + 1.2, radius: 2.1,
      actions: [
        { kind: 'activity', id: 'shower', label: 'Take a shower', hint: 'Hygiene +50 — boosted by your home' },
        { kind: 'activity', id: 'toilet', label: 'Use the toilet', hint: 'Bladder +50' },
        { kind: 'activity', id: 'laundry', label: 'Do the laundry', hint: 'Hygiene +22' },
      ],
    });

    addStation(stations, group, {
      id: 'wardrobe', label: 'Get changed', icon: '👕',
      x: outerX - side * 1.0, z: 0.6, radius: 1.8,
      actions: [
        { kind: 'appearance', label: 'Change clothes', hint: 'Open your wardrobe and restyle' },
        { kind: 'activity', id: 'laundry', label: 'Do the laundry', hint: 'Hygiene +22' },
      ],
    });

    addStation(stations, group, {
      id: 'tv', label: 'Watch TV', icon: '📺', x: livingCX, z: sofaZ - 1.0,
      radius: 1.9,
      actions: [
        { kind: 'activity', id: 'watch_tv', label: 'Watch TV', hint: 'Fun +25, energy +5' },
        { kind: 'activity', id: 'rest', label: 'Put your feet up', hint: 'Energy +30 — home bonus applies' },
        { kind: 'activity', id: 'social', label: 'Call someone', hint: 'Social +40' },
      ],
    });

    addStation(stations, group, {
      id: 'books', label: 'Look at the shelf', icon: '📖',
      x: -outerX + 1.4, z: 0.3, radius: 1.6,
      actions: [
        { kind: 'activity', id: 'read_book', label: 'Read a book', hint: 'Fun +14, smarts +8' },
      ],
    });

    // Storage: the cupboard where your things live. It opens the real
    // server-backed inventory, which is where everything you have bought is.
    addStation(stations, group, {
      id: 'storage', label: 'Open the cupboard', icon: '📦',
      x: -outerX + 1.0, z: hd - 2.2, radius: 1.7,
      actions: [
        { kind: 'inventory', label: 'Look through your things', hint: 'Everything you own, and what it does' },
        { kind: 'appearance', label: 'Change clothes', hint: 'Restyle at the cupboard' },
      ],
    });

    // The meter cupboard. Prepaid electricity, the water tank, the gas bottle
    // and the solar array — the part of a modern home that actually runs.
    addStation(stations, group, {
      id: 'meter', label: 'Check the meter', icon: '⚡',
      x: outerX - side * 1.0, z: -hd + 1.1, radius: 1.7,
      actions: [
        { kind: 'utilities', label: 'Open the meter cupboard', hint: 'Power, water, gas and solar' },
        { kind: 'activity', id: 'rest', label: 'Put your feet up', hint: 'Energy +30 — home bonus applies' },
      ],
    });

    addStation(stations, group, {
      id: 'desk', label: 'Sit at the desk', icon: '💻',
      x: livingCX - side * 1.6, z: hd - 1.5, radius: 1.7,
      actions: [
        { kind: 'activity', id: 'home_work', label: 'Work from home', hint: 'Smarts +10, charisma +2' },
        { kind: 'activity', id: 'read_book', label: 'Read a book', hint: 'Fun +14, smarts +8' },
      ],
    });
  } else {
    // ── Commercial: service counter, then the trade fittings ──
    //
    // No living room, no kitchen, no bed. A shop floor is a shop floor.
    const counterX = counterSide * (hw - 2.4);
    const counterZ = hd - 2.6;

    if (type === 'kiosk') {
      // A kiosk is one counter and shelves; nothing else fits.
      place(group, collisions, kitchenCounter(Math.min(W - 1.6, 2.6), 0.7, 1.0),
        0, -hd + 0.6, 0, { w: Math.min(W - 1.6, 2.6), d: 0.7 });
      addPicture(group, 0, -hd + T / 2 + 0.03, 1.8, 0, pal.accent);
    } else {
      const counter = box(2.6, 1.0, 0.62, materials.wood(0x8a6540), counterX, 0.5, counterZ);
      group.add(counter);
      collisions.push(rotatedAabb(counterX, counterZ, 2.6 - FURNITURE_INSET * 2, 0.62 - FURNITURE_INSET * 2, 0));
      group.add(box(0.36, 0.26, 0.3, materials.matte(0x2b2f36), counterX, 1.13, counterZ));
      // Staff stool behind the counter
      place(group, collisions, stool(0x33404d), counterX, counterZ - 0.85, 0, null);

      // Back room for offices, banks and clinics: a glassed-off area so the
      // floor plan is visibly not one open box.
      if (hasBackRoom) {
        const backZ = -hd + Math.min(3.4, D * 0.34);
        const doorX = -hw + T + W * 0.72;
        reservedFloor.push({ minX: doorX - 0.9, maxX: doorX + 0.9, minZ: backZ - 0.9, maxZ: backZ + 0.9 });
        wallRun(group, collisions, {
          x1: -hw + T, z1: backZ, x2: hw - T, z2: backZ, height: 2.6, thickness: 0.09,
          door: { at: W * 0.72, width: 1.1, height: 2.1 },
        });
        addPicture(group, -hw + T / 2 + 0.03, backZ / 2, 1.7, Math.PI / 2, pal.accent);
      }
    }

    addPicture(group, livingCX - 1.0, hd - T / 2 - 0.02, 1.85, Math.PI, pal.accent);
    addPicture(group, -hw + T / 2 + 0.02, 0.4, 1.75, Math.PI / 2, pal.rug);
  }

  // ── Ceiling lights ───────────────────────────────────────
  if (isResidential) {
    addCeilingLamp(group, lights, livingCX, hd - 2.6, H);
    addCeilingLamp(group, lights, livingCX, -hd + Math.min(2.6, D * 0.32) + 0.9, H);
    if (partitionX !== null) addCeilingLamp(group, lights, roomCX, -0.4, H);
  }
  // Commercial rooms get their lighting from their layout, so there is exactly
  // one set of fittings and the light positions match the furniture. A layout
  // that hung nothing still gets a plain grid of downlights — a dark room is a
  // bug, not a style.
  if (!isResidential && lights.length === 0) {
    const rows = D > 9 ? 3 : 2;
    for (let i = 0; i < rows; i++) {
      const z = -hd + (D * (i + 0.5)) / rows;
      addCeilingLamp(group, lights, -hw * 0.45, z, H);
      addCeilingLamp(group, lights, hw * 0.45, z, H);
    }
  }

  // ── What is inside the room ──────────────────────────────
  //
  // Homes keep the hand-built plan above (living room, kitchen, bedroom,
  // bathroom). Everything else is furnished by world/interiorLayouts.js, which
  // has one real floor plan per venue: a market has stalls and sacks of grain, a
  // church has pews and an altar, a hospital has beds and a trolley, an airport
  // has check-in desks and a security gate.
  //
  // The ctx object is the only way a layout can touch the room — it can add
  // props, register collision and hang lights, and nothing else.
  if (!isResidential || def.layout) {
    const ctx = {
      group, collisions, lights, materials,
      W, D, H, hw, hd, rng, pal, type,
      // The interior id as well as its type: two rooms can share a type and
      // still be different places (the tech hub and the community centre are
      // both `office`). Station plans look this up first.
      id: def.id,
      place, box, cyl, sphere, plate,
      rotatedAabb, wallRun, floorPatch,
      addPicture, addCeilingLamp,
      // Station registration: a layout says "you can shop here", and the
      // marker + proximity handling follow from that.
      station: (spec) => addStation(stations, group, spec),
      // Furniture from furniture.js, exposed so layouts never import it twice.
      bookshelfProp: bookshelf,
      tableProp: table,
      stoolProp: stool,
      officeDeskProp: () => officeDeskFallback(),
      kitchenCounterProp: kitchenCounter,
      plantProp: pottedPlant,
      rugProp: rug,
      coffeeTableProp: coffeeTable,
      plasticChairProp: plasticChair,
      wardrobeProp: wardrobe,
      toiletProp: toilet,
      basinProp: basin,
      // A small variant index derived from the room id, so two offices on the
      // same street are not furnished identically.
      variant: hashVariant(def.id || def.name || 'room'),
      // Floor that a layout must leave alone: doorway openings the shell cut
      // into partitions, so no desk can be parked across a doorway.
      reserved: reservedFloor,
    };
    furnish({ ...ctx, type: def.layout || type });
  }

  // ── What ended up in the room ────────────────────────────
  // Collected before merging, because merging collapses the prop groups into
  // per-material batches. This is what test-venues.mjs checks against: a market
  // must report stalls, a church pews, an airport check-in desks.
  const manifest = {};
  group.traverse((o) => {
    const name = o.userData && o.userData.venueProp;
    // Count the prop root only, not every mesh inside it — one market stall is
    // forty meshes, and "how many stalls" must not depend on how many parts a
    // stall is built from.
    if (!name) return;
    if (o.parent && o.parent.userData && o.parent.userData.venueProp) return;
    manifest[name] = (manifest[name] || 0) + 1;
  });

  // ── Where the player starts ──────────────────────────────
  // Three things have to be true at once: inside the room, in front of the door
  // rather than on its mat, and clear of furniture. Rooms differ in size, so
  // this is measured from the built collision list instead of guessed: walk in
  // from the door and stop at the first point that is legal and at least 2.4 m
  // in. Small apartments fall back to the doormat, which is always legal.
  const spawnZ = findSpawnZ(collisions, hd, hw);

  // ── Merge for draw calls ─────────────────────────────────
  const merged = mergeByMaterial(group, { bakeWorld: true });

  return {
    group: merged,
    collisions,
    // Facing into the room, far enough in that the third-person camera has
    // somewhere to stand (see findSpawnZ).
    spawn: { x: 0, z: spawnZ, rotY: Math.PI },
    exitZ: hd - 0.35,
    bounds: { minX: -hw + 0.3, maxX: hw - 0.3, minZ: -hd + 0.3, maxZ: hd - 0.3 },
    lights,
    manifest,
    stations,
  };
}

/** Stable 0..2 variant from a string, so a given room always picks the same one. */
function hashVariant(str) {
  // FNV-1a. A plain multiply-and-add hash sent every id in this game to the same
  // bucket, because they all start with "in-" and are the same length.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 3;
}

/**
 * A plain office desk, for layouts that need one and do not want to pull in the
 * whole venue prop set. Same proportions as officeDesk().
 */
function officeDeskFallback() {
  const g = new THREE.Group();
  g.add(box(1.5, 0.06, 0.75, materials.wood(0x9c7b52), 0, 0.73, 0));
  for (const sx of [-1, 1]) {
    g.add(box(0.06, 0.7, 0.06, materials.metalDark(), sx * 0.68, 0.37, -0.3));
    g.add(box(0.06, 0.7, 0.06, materials.metalDark(), sx * 0.68, 0.37, 0.3));
  }
  g.add(box(0.5, 0.32, 0.03, materials.matte(0x1a1f24), 0, 1.0, -0.22));
  g.add(box(0.46, 0.28, 0.01, materials.glow(0x5aa9e6), 0, 1.0, -0.2));
  g.add(box(0.4, 0.02, 0.14, materials.matte(0x2b2f36), 0, 0.77, 0.12));
  g.add(box(0.46, 0.07, 0.46, materials.fabric(0x2c3e50), 0, 0.46, 0.58));
  g.add(box(0.46, 0.5, 0.06, materials.fabric(0x2c3e50), 0, 0.72, 0.82));
  g.add(box(0.04, 0.46, 0.04, materials.metalDark(), 0, 0.23, 0.58));
  return g;
}

// ── Extra fittings per building type ────────────────────────────

// The old generic fitting routines (addShopFittings / addOfficeFittings /
// addClinicFittings) are gone on purpose: every venue has a real layout in
// interiorLayouts.js now, and leaving the generic ones behind invited a future
// edit to quietly reintroduce "every shop is the same shop".

/**
 * Pick the deepest legal spawn point straight in from the door.
 *
 * The interior camera sits behind the player, so a spawn on the doormat means a
 * camera jammed against the front wall and a screenshot of the entrance mat
 * instead of the room. Walking the centre line in until the floor is clear gives
 * big venues a proper starting position and leaves small flats on the mat.
 *
 * @param {Array<{minX:number,maxX:number,minZ:number,maxZ:number}>} collisions
 * @param {number} hd half depth of the room
 * @param {number} hw half width
 * @param {number} [clearance] player radius plus room to breathe
 */
export function findSpawnZ(collisions, hd, hw, clearance = 0.55) {
  const legal = (x, z) => collisions.every((c) => (
    x < c.minX - clearance || x > c.maxX + clearance ||
    z < c.minZ - clearance || z > c.maxZ + clearance
  ));

  const mat = hd - 1.1;
  if (!legal(0, mat)) return mat;      // nothing better to offer

  // Prefer ~2.6 m in; accept the deepest clear point after that.
  for (let z = hd - 2.6; z > -hd + 1.2; z -= 0.2) {
    if (legal(0, z)) return Math.round(z * 100) / 100;
  }
  return mat;
}
