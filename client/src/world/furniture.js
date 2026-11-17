// client/src/world/furniture.js
// A library of furniture built from Three.js primitives.
//
// Every function returns a THREE.Group positioned with its base at y=0, so
// callers can drop it anywhere on a floor and rotate it. Nothing here is a
// single box pretending to be furniture — chairs have legs and backs, sofas
// have arms and cushions, beds have mattresses and headboards.

import * as THREE from 'three';
import { materials } from './materials.js';

// ── Real furniture ──────────────────────────────────────────────
// When the CC0 Kenney furniture kit is on disk, these functions return a real
// model instead of a primitive assembly. Every one of them still has the
// procedural version below it, so the interiors build identically offline —
// and each swap is a one-line `const m = realModel(...)` at the top.
let furnitureAssets = null;

/** Install the asset library used for real furniture (null to go back). */
export function useFurnitureAssets(assets) {
  furnitureAssets = assets || null;
  return !!furnitureAssets;
}

/** Is real furniture in use? */
export function hasRealFurniture() {
  return !!furnitureAssets;
}

/**
 * A real model scaled to `height` metres, or null.
 * The clone is fresh, so per-room tinting never leaks between interiors.
 */
function realModel(name, height) {
  if (!furnitureAssets || !furnitureAssets.hasModel(name)) return null;
  const model = furnitureAssets.model(name, { height });
  if (!model) return null;
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return model;
}

// ── Small helpers ───────────────────────────────────────────────

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, seg, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function roundedBox(w, h, d, material, radius = 0.06) {
  // Approximated with a slightly bevelled box: cheap and reads well at
  // game distance. Real RoundedBoxGeometry would need the addons import.
  const geo = new THREE.BoxGeometry(w, h, d, 1, 1, 1);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── Seating ─────────────────────────────────────────────────────

/** Robust plastic chair — the ubiquitous Nigerian event chair. */
export function plasticChair(color = 0xc0392b) {
  const real = realModel('furniture.chair', 0.92);
  if (real) return real;
  const g = new THREE.Group();
  const mat = materials.paint(color);
  const seatH = 0.45;

  // Seat
  g.add(box(0.46, 0.05, 0.44, mat, 0, seatH, 0));
  // Back
  const back = box(0.46, 0.46, 0.05, mat, 0, seatH + 0.25, -0.20);
  back.rotation.x = -0.10;
  g.add(back);
  // Backrest ribs
  for (let i = -1; i <= 1; i++) {
    const rib = box(0.04, 0.40, 0.03, mat, i * 0.14, seatH + 0.25, -0.225);
    rib.rotation.x = -0.10;
    g.add(rib);
  }
  // Four legs, splayed outward like the real thing
  const legPositions = [
    [-0.19, 0.17, 0.10], [0.19, 0.17, 0.10],
    [-0.19, 0.17, -0.17], [0.19, 0.17, -0.17],
  ];
  for (const [x, y, z] of legPositions) {
    const leg = box(0.045, 0.42, 0.045, mat, x, y - 0.16, z);
    leg.rotation.z = x > 0 ? -0.06 : 0.06;
    leg.rotation.x = z > 0 ? -0.05 : 0.05;
    g.add(leg);
  }
  return g;
}

/** Upholstered armchair with arms and a cushion. */
export function armchair(color = 0x3d6b5a) {
  const real = realModel('furniture.chairRound', 0.85);
  if (real) return real;
  const g = new THREE.Group();
  const fabric = materials.fabric(color);
  const dark = materials.matte(0x2a2a2a);
  const seatH = 0.42;

  g.add(box(0.90, 0.30, 0.85, fabric, 0, seatH - 0.10, 0));      // base
  g.add(box(0.78, 0.14, 0.72, fabric, 0, seatH + 0.07, 0.02));   // cushion
  g.add(box(0.90, 0.62, 0.18, fabric, 0, seatH + 0.36, -0.36));  // back
  g.add(box(0.16, 0.34, 0.85, fabric, -0.37, seatH + 0.10, 0));  // left arm
  g.add(box(0.16, 0.34, 0.85, fabric, 0.37, seatH + 0.10, 0));   // right arm

  // Back cushion tuft
  g.add(box(0.66, 0.42, 0.10, fabric, 0, seatH + 0.42, -0.27));

  // Feet
  for (const x of [-0.34, 0.34]) {
    for (const z of [-0.32, 0.32]) {
      g.add(cyl(0.045, 0.035, 0.12, 8, dark, x, 0.06, z));
    }
  }
  return g;
}

/** Two/three-seat sofa with arms, cushions and a throw pillow. */
export function sofa(color = 0x2f5d50, seats = 3) {
  const real = realModel('furniture.sofa', 0.8);
  if (real) {
    real.scale.z *= seats >= 3 ? 1 : 0.72;
    real.userData.seats = seats;
    return real;
  }
  const g = new THREE.Group();
  const fabric = materials.fabric(color);
  const dark = materials.matte(0x252525);
  const width = seats === 2 ? 1.55 : 2.10;
  const seatH = 0.42;

  g.add(box(width, 0.32, 0.88, fabric, 0, seatH - 0.11, 0));
  g.add(box(width - 0.06, 0.64, 0.20, fabric, 0, seatH + 0.36, -0.36));

  // Seat cushions
  const cushionW = (width - 0.34) / seats;
  for (let i = 0; i < seats; i++) {
    const x = -width / 2 + 0.17 + cushionW * (i + 0.5);
    g.add(box(cushionW - 0.05, 0.15, 0.74, fabric, x, seatH + 0.08, 0.02));
    const backCushion = box(cushionW - 0.05, 0.48, 0.14, fabric, x, seatH + 0.36, -0.26);
    backCushion.rotation.x = -0.08;
    g.add(backCushion);
  }

  // Arms
  g.add(box(0.17, 0.40, 0.88, fabric, -width / 2 + 0.085, seatH + 0.12, 0));
  g.add(box(0.17, 0.40, 0.88, fabric, width / 2 - 0.085, seatH + 0.12, 0));

  // A throw pillow, because empty sofas look wrong
  const pillow = box(0.34, 0.34, 0.12, materials.fabric(0xc9a227), -width / 2 + 0.42, seatH + 0.30, -0.16);
  pillow.rotation.z = 0.22;
  g.add(pillow);

  // Feet
  for (const x of [-width / 2 + 0.12, width / 2 - 0.12]) {
    for (const z of [-0.34, 0.34]) {
      g.add(cyl(0.045, 0.035, 0.12, 8, dark, x, 0.06, z));
    }
  }
  return g;
}

/** Bar stool. */
export function stool(color = 0x8b5a2b) {
  const real = realModel('furniture.chair', 0.68);
  if (real) return real;
  const g = new THREE.Group();
  const seat = materials.wood(color);
  const metal = materials.metalDark();
  g.add(cyl(0.19, 0.17, 0.07, 16, seat, 0, 0.66, 0));
  g.add(cyl(0.03, 0.03, 0.62, 8, metal, 0, 0.33, 0));
  g.add(cyl(0.22, 0.22, 0.03, 16, metal, 0, 0.02, 0));
  return g;
}

// ── Beds ────────────────────────────────────────────────────────

/** Double bed with mattress, pillows, headboard and a duvet. */
export function bed(width = 1.6, duvetColor = 0xb5482f) {
  const real = realModel('furniture.bed', 1.0);
  if (real) return real;
  const g = new THREE.Group();
  const frame = materials.wood(0x6b4a30);
  const sheet = materials.fabric(0xf0ece4);
  const duvet = materials.fabric(duvetColor);
  const length = 2.0;

  // Frame + legs
  g.add(box(width, 0.22, length, frame, 0, 0.24, 0));
  for (const x of [-width / 2 + 0.08, width / 2 - 0.08]) {
    for (const z of [-length / 2 + 0.08, length / 2 - 0.08]) {
      g.add(box(0.08, 0.16, 0.08, frame, x, 0.08, z));
    }
  }

  // Mattress
  g.add(box(width - 0.06, 0.22, length - 0.08, sheet, 0, 0.47, 0));

  // Duvet covering the lower two thirds, slightly overhanging
  g.add(box(width + 0.04, 0.10, length * 0.62, duvet, 0, 0.60, length * 0.17));
  // Duvet fold-back
  g.add(box(width + 0.04, 0.13, 0.22, sheet, 0, 0.61, -length * 0.16));

  // Headboard
  g.add(box(width + 0.08, 0.85, 0.10, frame, 0, 0.60, -length / 2 - 0.04));
  g.add(box(width - 0.16, 0.55, 0.06, materials.fabric(0x5a4632), 0, 0.66, -length / 2 + 0.02));

  // Pillows
  const pillow = materials.fabric(0xffffff);
  const p1 = box(width * 0.42, 0.14, 0.38, pillow, -width * 0.23, 0.64, -length * 0.33);
  p1.rotation.x = 0.12;
  const p2 = box(width * 0.42, 0.14, 0.38, pillow, width * 0.23, 0.64, -length * 0.33);
  p2.rotation.x = 0.12;
  g.add(p1, p2);

  return g;
}

// ── Tables & storage ────────────────────────────────────────────

/** Dining / work table. */
export function table(w = 1.2, d = 0.75, color = 0x9c6b3f) {
  const real = realModel('furniture.table', 0.75);
  if (real) return real;
  const g = new THREE.Group();
  const wood = materials.wood(color);
  g.add(box(w, 0.06, d, wood, 0, 0.74, 0));
  // Apron
  g.add(box(w - 0.10, 0.08, d - 0.10, wood, 0, 0.68, 0));
  for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) {
    for (const z of [-d / 2 + 0.07, d / 2 - 0.07]) {
      g.add(box(0.07, 0.72, 0.07, wood, x, 0.36, z));
    }
  }
  return g;
}

/** Low coffee table. */
export function coffeeTable(w = 1.1, d = 0.6) {
  const real = realModel('furniture.tableRound', 0.42);
  if (real) return real;
  const g = new THREE.Group();
  const wood = materials.wood(0x7a5230);
  const glass = materials.glass();
  g.add(box(w, 0.05, d, wood, 0, 0.40, 0));
  g.add(box(w - 0.14, 0.03, d - 0.12, glass, 0, 0.27, 0)); // lower shelf
  for (const x of [-w / 2 + 0.06, w / 2 - 0.06]) {
    for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) {
      g.add(box(0.06, 0.40, 0.06, wood, x, 0.20, z));
    }
  }
  return g;
}

/** Wardrobe with two doors and handles. */
export function wardrobe(w = 1.2, h = 2.0, d = 0.6) {
  const real = realModel('furniture.cabinet', h);
  if (real) return real;
  const g = new THREE.Group();
  const body = materials.wood(0x6d4c33);
  const handle = materials.metalLight();
  g.add(box(w, h, d, body, 0, h / 2, 0));
  // Door seams
  g.add(box(0.02, h - 0.08, 0.02, materials.matte(0x3a2a1c), 0, h / 2, d / 2 + 0.005));
  // Handles
  g.add(cyl(0.015, 0.015, 0.14, 8, handle, -0.08, h * 0.55, d / 2 + 0.03));
  g.add(cyl(0.015, 0.015, 0.14, 8, handle, 0.08, h * 0.55, d / 2 + 0.03));
  return g;
}

/** Bookshelf with visible books. */
export function bookshelf(w = 1.0, h = 1.8, d = 0.32) {
  const real = realModel('furniture.bookcase', h);
  if (real) return real;
  const g = new THREE.Group();
  const wood = materials.wood(0x5d4230);
  const shelfCount = 4;

  // Sides and back
  g.add(box(0.04, h, d, wood, -w / 2, h / 2, 0));
  g.add(box(0.04, h, d, wood, w / 2, h / 2, 0));
  g.add(box(w, h, 0.02, wood, 0, h / 2, -d / 2));

  const bookColors = [0xb03a2e, 0x2e6da4, 0x3f7d3f, 0xc9a227, 0x7d3f7d, 0x2b2b2b, 0xd8d0c0];
  const rng = (() => { let s = 42; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }; })();

  for (let i = 0; i < shelfCount; i++) {
    const y = (h / shelfCount) * i + 0.02;
    // Shelf board
    g.add(box(w - 0.06, 0.03, d - 0.02, wood, 0, y, 0));

    // Books standing on it
    let x = -w / 2 + 0.07;
    while (x < w / 2 - 0.09) {
      const bw = 0.025 + rng() * 0.04;
      const bh = 0.16 + rng() * 0.12;
      const bookMat = materials.matte(bookColors[Math.floor(rng() * bookColors.length)]);
      g.add(box(bw, bh, d * 0.72, bookMat, x + bw / 2, y + 0.015 + bh / 2, 0));
      x += bw + 0.006;
    }
  }
  return g;
}

/** TV on a low media unit, with a lit screen. */
export function tvUnit(w = 1.4) {
  const g = new THREE.Group();
  const wood = materials.wood(0x3b2c20);
  const screen = materials.paint(0x0d1117);
  const bezel = materials.matte(0x1a1a1a);
  const glow = materials.glow(0x2a4a7a);

  // Media unit
  g.add(box(w, 0.42, 0.42, wood, 0, 0.21, 0));
  g.add(box(w - 0.1, 0.02, 0.02, materials.matte(0x222222), 0, 0.28, 0.215));

  // TV
  const tvW = w * 0.82;
  const tvH = tvW * 0.56;
  g.add(box(tvW, tvH, 0.045, bezel, 0, 0.42 + tvH / 2 + 0.06, 0));
  g.add(box(tvW - 0.05, tvH - 0.05, 0.01, screen, 0, 0.42 + tvH / 2 + 0.06, 0.03));
  g.add(box(tvW - 0.12, tvH - 0.12, 0.005, glow, 0, 0.42 + tvH / 2 + 0.06, 0.036));
  // Stand
  g.add(box(0.22, 0.06, 0.14, bezel, 0, 0.45, 0));
  return g;
}

// ── Kitchen & bathroom ──────────────────────────────────────────

/** Kitchen counter run with cabinets, worktop, sink and hob. */
export function kitchenCounter(w = 2.0, d = 0.62, h = 0.9) {
  const g = new THREE.Group();
  const cabinet = materials.paint(0xe8e4dc);
  const worktop = materials.matte(0x2f3338);
  const steel = materials.metalLight();

  g.add(box(w, h - 0.04, d, cabinet, 0, (h - 0.04) / 2, 0));
  g.add(box(w + 0.04, 0.05, d + 0.03, worktop, 0, h, 0));

  // Cabinet door seams
  const doors = Math.max(2, Math.round(w / 0.6));
  for (let i = 1; i < doors; i++) {
    const x = -w / 2 + (w / doors) * i;
    g.add(box(0.012, h - 0.14, 0.012, materials.matte(0xb8b2a8), x, (h - 0.04) / 2, d / 2 + 0.002));
  }
  // Handles
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5);
    g.add(cyl(0.012, 0.012, 0.12, 6, steel, x, h - 0.16, d / 2 + 0.025));
  }

  // Sink basin + tap
  g.add(box(0.5, 0.02, 0.36, steel, -w / 4, h + 0.028, 0));
  g.add(box(0.44, 0.10, 0.30, materials.matte(0x1e2226), -w / 4, h - 0.02, 0));
  g.add(cyl(0.02, 0.02, 0.28, 8, steel, -w / 4, h + 0.16, -0.13));
  const spout = cyl(0.018, 0.018, 0.16, 8, steel, -w / 4, h + 0.30, -0.06);
  spout.rotation.x = Math.PI / 2;
  g.add(spout);

  // Hob with four burners
  g.add(box(0.56, 0.015, 0.42, materials.matte(0x14161a), w / 4, h + 0.026, 0));
  for (const bx of [-0.13, 0.13]) {
    for (const bz of [-0.10, 0.10]) {
      g.add(cyl(0.075, 0.075, 0.012, 16, materials.metalDark(), w / 4 + bx, h + 0.035, bz));
    }
  }
  return g;
}

/** Wall cabinets. */
export function wallCabinets(w = 2.0, h = 0.65, d = 0.35) {
  const g = new THREE.Group();
  const body = materials.paint(0xe8e4dc);
  g.add(box(w, h, d, body, 0, h / 2, 0));
  const doors = Math.max(2, Math.round(w / 0.55));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5);
    g.add(box((w / doors) - 0.04, h - 0.05, 0.02, materials.paint(0xf2efe8), x, h / 2, d / 2 + 0.008));
  }
  return g;
}

/** Bathroom suite: WC, basin and mirror. */
export function toilet() {
  const real = realModel('furniture.toilet', 0.78);
  if (real) return real;
  const g = new THREE.Group();
  const white = materials.paint(0xf5f5f2);
  g.add(cyl(0.20, 0.17, 0.36, 16, white, 0, 0.18, 0));
  const bowl = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.045, 8, 20), white);
  bowl.rotation.x = Math.PI / 2;
  bowl.position.set(0, 0.37, 0);
  bowl.castShadow = true;
  g.add(bowl);
  // Seat
  g.add(box(0.38, 0.05, 0.44, white, 0, 0.40, 0));
  // Cistern
  g.add(box(0.36, 0.34, 0.16, white, 0, 0.62, -0.20));
  g.add(cyl(0.03, 0.03, 0.02, 12, materials.metalLight(), 0, 0.80, -0.20));
  return g;
}

export function basin() {
  const real = realModel('furniture.sink', 0.95);
  if (real) return real;
  const g = new THREE.Group();
  const white = materials.paint(0xf5f5f2);
  const steel = materials.chrome();
  g.add(box(0.5, 0.14, 0.40, white, 0, 0.84, 0));
  g.add(cyl(0.06, 0.06, 0.76, 10, white, 0, 0.38, -0.12));
  g.add(cyl(0.02, 0.02, 0.18, 8, steel, 0, 0.96, -0.14));
  const spout = cyl(0.016, 0.016, 0.12, 8, steel, 0, 1.03, -0.08);
  spout.rotation.x = Math.PI / 2;
  g.add(spout);
  // Mirror
  g.add(box(0.44, 0.60, 0.03, materials.chrome(), 0, 1.42, -0.17));
  return g;
}

export function showerUnit() {
  const g = new THREE.Group();
  const glass = materials.glass();
  const steel = materials.chrome();
  // Tray
  g.add(box(0.9, 0.08, 0.9, materials.paint(0xeceae4), 0, 0.04, 0));
  // Glass panels
  g.add(box(0.9, 1.9, 0.02, glass, 0, 1.0, -0.45));
  g.add(box(0.02, 1.9, 0.9, glass, 0.45, 1.0, 0));
  // Shower head
  g.add(cyl(0.02, 0.02, 0.30, 8, steel, -0.30, 1.95, -0.35));
  const head = cyl(0.09, 0.07, 0.04, 12, steel, -0.30, 2.08, -0.28);
  head.rotation.x = 0.35;
  g.add(head);
  return g;
}

/** Kitchen fridge. */
export function fridge() {
  const g = new THREE.Group();
  const body = materials.metalLight();
  const dark = materials.matte(0x22262a);
  g.add(box(0.70, 1.75, 0.68, body, 0, 0.875, 0));
  // Door split
  g.add(box(0.72, 0.02, 0.02, dark, 0, 1.18, 0.345));
  // Handles
  g.add(cyl(0.014, 0.014, 0.30, 8, dark, 0.28, 1.42, 0.36));
  g.add(cyl(0.014, 0.014, 0.26, 8, dark, 0.28, 0.92, 0.36));
  return g;
}

// ── Decor ───────────────────────────────────────────────────────

/** Potted plant. */
export function pottedPlant(height = 1.1) {
  const g = new THREE.Group();
  const potH = height * 0.28;
  const pot = materials.matte(0xa9563a);
  g.add(cyl(0.20, 0.15, potH, 14, pot, 0, potH / 2, 0));
  g.add(cyl(0.19, 0.19, 0.02, 14, materials.matte(0x3b2a1e), 0, potH, 0));
  g.add(cyl(0.03, 0.04, height * 0.5, 6, materials.trunk(), 0, potH + height * 0.25, 0));

  // Foliage: several flattened spheres clustered together
  const leaf = materials.leaf();
  const leafDark = materials.leafDark();
  const blobs = [
    [0, potH + height * 0.62, 0, 0.30],
    [-0.16, potH + height * 0.52, 0.10, 0.22],
    [0.18, potH + height * 0.55, -0.08, 0.24],
    [0.05, potH + height * 0.76, 0.06, 0.20],
  ];
  for (const [x, y, z, r] of blobs) {
    const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), x > 0 ? leaf : leafDark);
    blob.position.set(x, y, z);
    blob.scale.y = 0.82;
    blob.castShadow = true;
    g.add(blob);
  }
  return g;
}

/** Ceiling light fitting (emissive). */
export function ceilingLamp(radius = 0.28) {
  const g = new THREE.Group();
  g.add(cyl(0.03, 0.03, 0.25, 6, materials.metalDark(), 0, -0.12, 0));
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(radius, radius * 0.9, 16, 1, true),
    materials.paint(0xf0ede6)
  );
  shade.position.y = -0.35;
  shade.rotation.x = Math.PI;
  shade.castShadow = false;
  g.add(shade);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.4, 10, 8),
    materials.glow(0xfff0c8)
  );
  bulb.position.y = -0.36;
  g.add(bulb);

  return g;
}

/** Wall-mounted air conditioner. */
export function aircon() {
  const g = new THREE.Group();
  g.add(box(0.85, 0.28, 0.20, materials.paint(0xf2f2ef), 0, 0, 0));
  g.add(box(0.80, 0.02, 0.02, materials.matte(0xdddddd), 0, -0.14, 0.10));
  g.add(box(0.70, 0.015, 0.03, materials.matte(0xc8c8c8), 0, -0.10, 0.105));
  return g;
}

/** Wall art / framed picture. */
export function pictureFrame(w = 0.6, h = 0.45, artColor = 0x2e6da4) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.03, materials.wood(0x3a2a1c), 0, 0, 0));
  g.add(box(w - 0.06, h - 0.06, 0.01, materials.paint(artColor), 0, 0, 0.022));
  return g;
}

/** Rugs — a flat coloured rectangle. */
export function rug(w = 2.0, d = 1.4, color = 0x8e4b3a) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), materials.carpet());
  base.receiveShadow = true;
  g.add(base);
  const border = new THREE.Mesh(new THREE.BoxGeometry(w - 0.16, 0.013, d - 0.16), materials.fabric(color));
  border.position.y = 0.002;
  border.receiveShadow = true;
  g.add(border);
  return g;
}
