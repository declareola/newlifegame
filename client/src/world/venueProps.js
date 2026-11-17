// client/src/world/venueProps.js
// Props for places that are not homes: a market stall, a church pew, a hospital
// bed, a check-in desk, a bank teller, a school desk, a prayer mat.
//
// Everything is built from Three.js primitives, base at y = 0, front facing +Z,
// so a layout can drop it on the floor and turn it like any other furniture.
// The rule from furniture.js holds here: nothing is one box pretending to be a
// thing — a hospital bed has a frame, a mattress, a raised back and side rails.

import * as THREE from 'three';
import { materials } from './materials.js';

// Every prop group carries its own name, so a built room can be inspected by
// what is in it ("does the market have stalls?") instead of by guessing from
// merged geometry. InteriorBuilder collects these into a manifest.
function tag(g, name) {
  g.traverse((o) => { o.userData.venueProp = name; });
  return g;
}

// ── Helpers ─────────────────────────────────────────────────────
function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

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

/** Thin plate lying flat — tarpaulin, board, conveyer, mat. */
function plate(w, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), mat);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

const grey = () => materials.metalDark();
const steel = () => materials.chrome();
const cloth = (c) => materials.fabric(c);
const plastic = (c) => materials.paint(c);
const glow = (c) => materials.glow(c);
const wood = () => materials.wood(0x9c6b3f);

// ══════════════════════════════════════════════════════════════
// MARKET
// ══════════════════════════════════════════════════════════════

/**
 * A market stall: four posts, a sloping tarpaulin, a display table and trays of
 * goods. `palette` colours the canopy and `goods` picks what is on the table.
 */
export function marketStall({ w = 2.6, d = 1.5, palette = 0xc0392b, goods = 'produce', rng = Math.random } = {}) {
  const g = new THREE.Group();
  const postMat = grey();
  const legH = 2.0;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(cyl(0.035, legH, postMat, sx * (w / 2 - 0.05), legH / 2, sz * (d / 2 - 0.05), 6));
    }
  }

  // Tarpaulin: a slab tilted down toward the front, plus a scalloped valance.
  const canopy = box(w + 0.35, 0.05, d + 0.3, cloth(palette), 0, legH + 0.15, 0);
  canopy.rotation.x = -0.14;
  g.add(canopy);
  g.add(box(w + 0.35, 0.22, 0.03, cloth(palette), 0, legH + 0.02, d / 2 + 0.14));

  // Table top and apron.
  g.add(box(w, 0.07, d, wood(), 0, 0.86, 0));
  g.add(box(w - 0.1, 0.5, 0.04, cloth(0xe8e0d0), 0, 0.6, d / 2 - 0.02));

  // Goods in trays on the table.
  const trayColors = { produce: [0xe74c3c, 0xf39c12, 0x27ae60, 0xf1c40f], fish: [0xbfc9d1, 0x8e9aa6], fabric: null };
  const colors = trayColors[goods] || trayColors.produce;
  const trays = Math.max(2, Math.round(w / 0.85));
  for (let i = 0; i < trays; i++) {
    const tx = -w / 2 + (w / trays) * (i + 0.5);
    g.add(box(w / trays - 0.12, 0.07, d - 0.35, materials.matte(0x6d4c2f), tx, 0.93, 0));
    if (goods === 'fabric') {
      // Rolls of cloth standing on end.
      for (let k = 0; k < 3; k++) {
        const c = [0xd94f70, 0x2e86de, 0xe1b12c][k % 3];
        g.add(cyl(0.11, 0.45 + rng() * 0.2, cloth(c), tx + (k - 1) * 0.2, 1.18, 0, 8));
      }
    } else {
      // A heap of the good: overlapping spheres read as produce at any distance.
      const c = colors[i % colors.length];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        g.add(sphere(0.075 + rng() * 0.03, plastic(c),
          tx + Math.cos(a) * 0.19, 1.0 + rng() * 0.05, Math.sin(a) * 0.22, 6));
      }
      g.add(sphere(0.1, plastic(c), tx, 1.06, 0, 6));
    }
  }

  // Crates and sacks under the table.
  g.add(box(0.5, 0.34, 0.36, plastic(0x2f7ed8), -w / 2 + 0.4, 0.17, 0));
  g.add(box(0.5, 0.34, 0.36, plastic(0x2f7ed8), -w / 2 + 0.4, 0.51, 0));
  g.add(sphere(0.26, cloth(0xd8cba8), w / 2 - 0.5, 0.26, 0, 8));

  return tag(g, 'marketStall');
}

/** A big trading umbrella — the other half of a Lagos street market. */
export function marketUmbrella(color = 0x2e86de) {
  const g = new THREE.Group();
  g.add(cyl(0.05, 2.3, grey(), 0, 1.15, 0, 6));
  g.add(cyl(0.4, 0.05, materials.matte(0x555555), 0, 0.03, 0, 8));
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.5, 10, 1, true), cloth(color));
  canopy.position.y = 2.35;
  canopy.castShadow = true;
  g.add(canopy);
  return tag(g, 'marketUmbrella');
}

/** Standing price board with chalked lines. */
export function priceBoard() {
  const g = new THREE.Group();
  g.add(box(0.6, 0.8, 0.05, materials.matte(0x2f2f2f), 0, 1.05, 0));
  g.add(box(0.05, 0.65, 0.05, wood(), -0.22, 0.32, 0));
  g.add(box(0.05, 0.65, 0.05, wood(), 0.22, 0.32, 0));
  for (let i = 0; i < 4; i++) {
    g.add(box(0.34 - i * 0.04, 0.03, 0.01, materials.matte(0xf2f2e8), -0.06, 1.32 - i * 0.16, 0.031));
  }
  return tag(g, 'priceBoard');
}

/** Fish laid out on ice, for the wet side of the market. */
export function fishTable() {
  const g = new THREE.Group();
  g.add(box(1.6, 0.06, 0.8, wood(), 0, 0.72, 0));
  for (const sx of [-1, 1]) g.add(box(0.06, 0.72, 0.06, grey(), sx * 0.75, 0.36, 0));
  g.add(box(1.5, 0.06, 0.7, materials.matte(0xe6f2f7), 0, 0.76, 0));
  for (let i = 0; i < 5; i++) {
    const fish = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), materials.matte(0x9aa8b4));
    fish.scale.set(2.2, 0.5, 0.8);
    fish.position.set(-0.6 + i * 0.3, 0.83, (i % 2 ? 0.12 : -0.12));
    fish.castShadow = true;
    g.add(fish);
  }
  return tag(g, 'fishTable');
}

/** Stacked sacks of grain or charcoal. */
export function sackStack(color = 0xd8cba8) {
  const g = new THREE.Group();
  const mat = cloth(color);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 2 - r; c++) {
      const s = box(0.42, 0.3, 0.34, mat, (c - (1 - r) / 2) * 0.46, 0.15 + r * 0.3, 0);
      s.rotation.y = (r + c) * 0.2;
      g.add(s);
    }
  }
  return tag(g, 'sackStack');
}

// ══════════════════════════════════════════════════════════════
// CHURCH / MOSQUE
// ══════════════════════════════════════════════════════════════

/** One pew: seat, back, kneeler, legs. Front faces +Z (toward the altar). */
export function pew(len = 3.0) {
  const g = new THREE.Group();
  const mat = wood();
  g.add(box(len, 0.08, 0.42, mat, 0, 0.45, 0));
  g.add(box(len, 0.5, 0.07, mat, 0, 0.72, -0.2));
  g.add(box(len, 0.06, 0.16, mat, 0, 0.78, 0.18));      // top rail
  g.add(box(len, 0.05, 0.2, mat, 0, 0.18, -0.34));      // kneeler
  for (const sx of [-1, 1]) {
    g.add(box(0.07, 0.45, 0.42, mat, sx * (len / 2 - 0.06), 0.22, 0));
    g.add(box(0.07, 0.72, 0.07, mat, sx * (len / 2 - 0.06), 0.36, -0.2));
  }
  return tag(g, 'pew');
}

/** Altar table with a white cloth, candles and a cross. */
export function altar() {
  const g = new THREE.Group();
  g.add(box(2.0, 0.08, 0.75, materials.matte(0xf2eee4), 0, 0.95, 0));
  g.add(box(2.05, 0.02, 0.8, cloth(0xfdfbf5), 0, 0.32, 0));
  for (const sx of [-1, 1]) {
    g.add(box(0.08, 0.95, 0.7, materials.matte(0xe8e2d4), sx * 0.85, 0.47, 0));
  }
  // Cross
  g.add(box(0.07, 0.55, 0.05, materials.matte(0xd8c98a), 0, 1.35, 0));
  g.add(box(0.32, 0.06, 0.05, materials.matte(0xd8c98a), 0, 1.45, 0));
  // Candlesticks
  for (const sx of [-1, 1]) {
    g.add(cyl(0.03, 0.28, materials.matte(0xd9c37a), sx * 0.7, 1.13, 0.1, 8));
    g.add(cyl(0.025, 0.14, materials.matte(0xfff6d0), sx * 0.7, 1.34, 0.1, 8));
  }
  return tag(g, 'altar');
}

/** Lectern / pulpit. */
export function pulpit() {
  const g = new THREE.Group();
  g.add(box(0.9, 1.1, 0.6, wood(), 0, 0.55, 0));
  const top = box(0.8, 0.07, 0.5, wood(), 0, 1.16, 0);
  top.rotation.x = -0.3;
  g.add(top);
  g.add(box(0.5, 0.03, 0.34, materials.matte(0xfdfbf5), 0, 1.2, 0.02));
  return tag(g, 'pulpit');
}

/**
 * Stained-glass panel: a lit pane split into coloured quarries. Sits flat
 * against a wall; caller rotates it to face into the room.
 */
export function stainedGlass(w = 1.6, h = 2.6) {
  const g = new THREE.Group();
  const frameMat = materials.matte(0x6b5a45);
  g.add(box(w, h, 0.06, frameMat, 0, h / 2, 0));
  const cols = [0xc0392b, 0x2e86de, 0xe1b12c, 0x27ae60, 0x8e44ad];
  const paneW = (w - 0.16) / 3;
  const paneH = (h - 0.16) / 4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(paneW - 0.04, paneH - 0.04, 0.02),
        glow(cols[(r * 3 + c) % cols.length]));
      m.position.set(-w / 2 + 0.08 + paneW * (c + 0.5), 0.08 + paneH * (r + 0.5), 0.035);
      g.add(m);
    }
  }
  return tag(g, 'stainedGlass');
}

/** Prayer mat: a flat rug with a pointed top, laid toward the mihrab. */
export function prayerMat(color = 0x2e6b5e) {
  const g = new THREE.Group();
  g.add(plate(0.62, 1.05, cloth(color), 0, 0.015, 0));
  g.add(plate(0.44, 0.02, cloth(0xd9b451), 0, 0.035, 0.42));  // band at the top
  const arch = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.14, 4), cloth(0xd9b451));
  arch.position.set(0, 0.04, -0.36);
  arch.rotation.y = Math.PI / 4;
  arch.scale.z = 0.05;
  g.add(arch);
  return tag(g, 'prayerMat');
}

/** The mihrab niche: an arched recess. Faces +Z. */
export function mihrab() {
  const g = new THREE.Group();
  g.add(box(1.8, 2.6, 0.12, materials.matte(0xe6dfd0), 0, 1.3, 0));
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 14, 1, false, 0, Math.PI), materials.matte(0x2e6b5e));
  arch.rotation.z = Math.PI;
  arch.rotation.x = Math.PI / 2;
  arch.position.set(0, 1.5, 0.08);
  g.add(arch);
  g.add(box(1.24, 1.5, 0.1, materials.matte(0x2e6b5e), 0, 0.75, 0.08));
  g.add(box(1.3, 0.06, 0.16, materials.matte(0xd9b451), 0, 1.5, 0.11));
  return tag(g, 'mihrab');
}

/** Shoe rack by the door. */
export function shoeRack() {
  const g = new THREE.Group();
  g.add(box(1.6, 0.06, 0.32, wood(), 0, 0.3, 0));
  g.add(box(1.6, 0.06, 0.32, wood(), 0, 0.62, 0));
  for (const sx of [-1, 1]) g.add(box(0.06, 0.65, 0.32, wood(), sx * 0.77, 0.33, 0));
  for (let i = 0; i < 6; i++) {
    g.add(box(0.18, 0.1, 0.26, plastic(i % 2 ? 0x333333 : 0x8d6e63), -0.6 + (i % 3) * 0.5, 0.37 + Math.floor(i / 3) * 0.32, 0));
  }
  return tag(g, 'shoeRack');
}

// ══════════════════════════════════════════════════════════════
// HOSPITAL
// ══════════════════════════════════════════════════════════════

/** Hospital bed: frame, mattress, pillow, raised head, side rails, wheels. */
export function hospitalBed(duvet = 0xdff0f6) {
  const g = new THREE.Group();
  const frame = steel();
  g.add(box(0.95, 0.12, 2.0, frame, 0, 0.55, 0));
  g.add(box(0.92, 0.16, 1.95, cloth(duvet), 0, 0.68, 0));
  const head = box(0.92, 0.5, 0.1, materials.matte(0xf2f6f8), 0, 0.92, -0.86);
  head.rotation.x = 0.35;
  g.add(head);
  g.add(box(0.4, 0.12, 0.26, materials.matte(0xfdfbf5), 0, 0.8, -0.66));
  for (const sx of [-1, 1]) {
    // side rail
    g.add(box(0.04, 0.04, 1.1, frame, sx * 0.5, 0.86, 0.05));
    g.add(box(0.04, 0.3, 0.04, frame, sx * 0.5, 0.72, -0.45));
    g.add(box(0.04, 0.3, 0.04, frame, sx * 0.5, 0.72, 0.55));
    // legs + wheels
    g.add(box(0.06, 0.5, 0.06, frame, sx * 0.4, 0.3, -0.85));
    g.add(box(0.06, 0.5, 0.06, frame, sx * 0.4, 0.3, 0.85));
    g.add(cyl(0.07, 0.05, grey(), sx * 0.4, 0.05, -0.85, 8));
    g.add(cyl(0.07, 0.05, grey(), sx * 0.4, 0.05, 0.85, 8));
  }
  return tag(g, 'hospitalBed');
}

/** Drip stand with a bag. */
export function ivStand() {
  const g = new THREE.Group();
  g.add(cyl(0.03, 1.9, steel(), 0, 0.95, 0, 6));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(box(0.03, 0.03, 0.34, grey(), 0, 0.05, 0));
    const leg = g.children[g.children.length - 1];
    leg.rotation.y = a;
    leg.translateZ(0.14);
  }
  g.add(box(0.16, 0.26, 0.07, materials.matte(0xd8eef7), 0.1, 1.72, 0));
  g.add(box(0.02, 0.5, 0.02, materials.matte(0xcfe8f2), 0.1, 1.34, 0));
  return tag(g, 'ivStand');
}

/** Gurney / patient trolley. */
export function trolley() {
  const g = new THREE.Group();
  g.add(box(0.7, 0.1, 1.9, steel(), 0, 0.72, 0));
  g.add(box(0.68, 0.1, 1.8, cloth(0x2f6f8f), 0, 0.82, 0));
  for (const sz of [-1, 1]) {
    g.add(box(0.74, 0.05, 0.05, steel(), 0, 1.05, sz * 0.85));
    g.add(box(0.05, 0.28, 0.05, steel(), -0.33, 0.92, sz * 0.85));
    g.add(box(0.05, 0.28, 0.05, steel(), 0.33, 0.92, sz * 0.85));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(0.05, 0.66, 0.05, steel(), sx * 0.3, 0.36, sz * 0.8));
      g.add(cyl(0.08, 0.05, grey(), sx * 0.3, 0.06, sz * 0.8, 8));
    }
  }
  return tag(g, 'trolley');
}

/** Glass-fronted medicine cabinet. */
export function medicalCabinet(w = 1.0, h = 1.9) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.42, materials.matte(0xeef3f5), 0, h / 2, 0));
  g.add(box(w - 0.1, h - 0.2, 0.02, materials.glass(), 0, h / 2, 0.22));
  for (let i = 1; i < 3; i++) g.add(box(w - 0.14, 0.03, 0.3, materials.matte(0xc8d3d8), 0, (h / 3) * i, 0.04));
  const colors = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71];
  for (let i = 0; i < 8; i++) {
    g.add(box(0.1, 0.16, 0.1, plastic(colors[i % 4]), -w / 2 + 0.18 + (i % 4) * 0.2, 0.4 + Math.floor(i / 4) * 0.6, 0.05));
  }
  return tag(g, 'medicalCabinet');
}

/** Wheelchair. */
export function wheelchair() {
  const g = new THREE.Group();
  g.add(box(0.46, 0.06, 0.44, cloth(0x2c3e50), 0, 0.5, 0));
  g.add(box(0.46, 0.5, 0.06, cloth(0x2c3e50), 0, 0.75, -0.2));
  for (const sx of [-1, 1]) {
    const wheel = cyl(0.28, 0.04, grey(), sx * 0.26, 0.28, 0, 14);
    wheel.rotation.z = Math.PI / 2;
    g.add(wheel);
    g.add(box(0.04, 0.04, 0.3, steel(), sx * 0.24, 0.62, 0.16));
    g.add(box(0.04, 0.22, 0.04, steel(), sx * 0.24, 0.6, 0.24));
    g.add(cyl(0.09, 0.03, grey(), sx * 0.26, 0.09, 0.24, 10));
  }
  return tag(g, 'wheelchair');
}

/** Reception / triage desk with a screen. */
export function receptionCounter(w = 3.0, color = 0xeef2f4) {
  const g = new THREE.Group();
  g.add(box(w, 1.05, 0.62, materials.matte(color), 0, 0.52, 0));
  g.add(box(w + 0.1, 0.07, 0.7, materials.matte(0xd6dde1), 0, 1.07, 0));
  g.add(box(w * 0.8, 0.5, 0.04, materials.glass(), 0, 1.45, -0.05));
  g.add(box(0.36, 0.24, 0.22, materials.matte(0x23282e), -w * 0.25, 1.2, 0.1));
  g.add(box(0.2, 0.03, 0.3, materials.matte(0x33393f), -w * 0.25, 1.1, 0.12));
  g.add(box(0.05, 0.02, 0.05, steel(), -w * 0.25, 1.12, 0.1));
  return tag(g, 'receptionCounter');
}

/** A row of linked waiting chairs. Faces +Z. */
export function waitingRow(n = 4, color = 0x2980b9) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.55;
    g.add(box(0.48, 0.06, 0.44, plastic(color), x, 0.44, 0));
    const back = box(0.48, 0.44, 0.05, plastic(color), x, 0.68, -0.2);
    back.rotation.x = -0.12;
    g.add(back);
    g.add(box(0.05, 0.44, 0.05, steel(), x - 0.2, 0.22, -0.16));
    g.add(box(0.05, 0.44, 0.05, steel(), x + 0.2, 0.22, -0.16));
  }
  g.add(box(n * 0.55, 0.05, 0.05, steel(), 0, 0.68, -0.24));
  return tag(g, 'waitingRow');
}

// ══════════════════════════════════════════════════════════════
// AIRPORT
// ══════════════════════════════════════════════════════════════

/** Check-in desk: counter, monitor, baggage scale and a strip of belt. */
export function checkInDesk(color = 0x2c3e50) {
  const g = new THREE.Group();
  g.add(box(2.4, 1.1, 0.8, materials.matte(color), 0, 0.55, 0));
  g.add(box(2.5, 0.07, 0.9, materials.matte(0xdfe6ea), 0, 1.13, 0));
  g.add(box(0.42, 0.3, 0.06, materials.matte(0x1a1f24), -0.6, 1.4, -0.25));
  g.add(box(0.4, 0.26, 0.02, glow(0x3fa0e0), -0.6, 1.4, -0.21));
  // Scale platform + belt
  g.add(box(0.8, 0.08, 0.6, steel(), 0.7, 1.18, 0.1));
  g.add(box(2.6, 0.06, 0.6, materials.matte(0x30363b), 1.6, 0.95, 0.1));
  // Overhead flight sign
  g.add(box(0.9, 0.3, 0.06, materials.matte(0x1b232a), 0, 2.5, -0.3));
  g.add(box(0.7, 0.16, 0.02, glow(0x7be0a8), 0, 2.5, -0.26));
  return tag(g, 'checkInDesk');
}

/** Security archway (metal detector). */
export function securityGate(color = 0xb7c2c8) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) g.add(box(0.2, 2.1, 0.28, materials.matte(color), sx * 0.55, 1.05, 0));
  g.add(box(1.32, 0.22, 0.28, materials.matte(color), 0, 2.2, 0));
  g.add(box(0.08, 2.0, 0.1, materials.matte(0x2c3e50), 0.4, 1.05, 0.18));
  g.add(box(0.06, 0.06, 0.06, glow(0x54e08a), 0, 2.2, 0.16));
  return tag(g, 'securityGate');
}

/** X-ray scanner: a belt running through a tunnel. */
export function xrayScanner() {
  const g = new THREE.Group();
  g.add(box(1.6, 0.6, 1.2, materials.matte(0x4a5560), 0, 0.3, 0));
  g.add(box(1.1, 0.9, 0.9, materials.matte(0x2f3941), 0, 1.0, 0));
  g.add(box(1.0, 0.5, 0.6, materials.matte(0x14181c), 0, 1.0, 0.02));
  g.add(box(2.6, 0.05, 0.5, materials.matte(0x30363b), 0, 0.62, 0));
  g.add(box(0.3, 0.2, 0.05, glow(0x3fa0e0), 0.75, 1.35, 0));
  return tag(g, 'xrayScanner');
}

/** Departure board: a dark panel with glowing rows of flights. */
export function departureBoard(w = 3.2) {
  const g = new THREE.Group();
  g.add(box(w, 1.1, 0.12, materials.matte(0x12171c), 0, 1.7, 0));
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    for (let c = 0; c < 4; c++) {
      const cw = (w - 0.3) / 4;
      const len = 0.35 + ((i * 7 + c * 3) % 5) * 0.12;
      g.add(box(len * cw, 0.07, 0.02, glow(c === 3 ? 0x54e08a : 0xe8c95a),
        -w / 2 + 0.15 + cw * (c + 0.5), 2.05 - i * 0.18, 0.07));
    }
  }
  return tag(g, 'departureBoard');
}

/** Airport seat row: metal beam, three moulded seats. */
export function airportSeatRow(n = 3, color = 0x2c3e50) {
  const g = new THREE.Group();
  const width = n * 0.62;
  g.add(box(0.06, 0.45, 0.06, steel(), -width / 2 + 0.1, 0.22, 0));
  g.add(box(0.06, 0.45, 0.06, steel(), width / 2 - 0.1, 0.22, 0));
  g.add(box(width - 0.1, 0.07, 0.07, steel(), 0, 0.44, 0));
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + 0.31 + i * 0.62;
    g.add(box(0.5, 0.07, 0.5, plastic(color), x, 0.48, 0));
    const back = box(0.5, 0.46, 0.06, plastic(color), x, 0.72, -0.22);
    back.rotation.x = -0.15;
    g.add(back);
  }
  return tag(g, 'airportSeatRow');
}

/** Baggage carousel: a rounded belt with flaps. */
export function carousel(radius = 1.8) {
  const g = new THREE.Group();
  const belt = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.22, 8, 24), materials.matte(0x30363b));
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.5;
  belt.castShadow = true;
  g.add(belt);
  g.add(cyl(radius - 0.3, 0.45, materials.matte(0x4a5560), 0, 0.24, 0, 20));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const flap = box(0.7, 0.04, 0.3, materials.matte(0x22282e), Math.cos(a) * radius, 0.72, Math.sin(a) * radius);
    flap.rotation.y = -a;
    g.add(flap);
  }
  // A couple of suitcases riding the belt.
  for (const [a, c] of [[0.6, 0xd94f70], [3.1, 0x2e86de]]) {
    const bag = box(0.5, 0.34, 0.24, plastic(c), Math.cos(a) * radius, 0.86, Math.sin(a) * radius);
    bag.rotation.y = -a;
    g.add(bag);
  }
  return tag(g, 'carousel');
}

/** Rope stanchion for the queue. */
export function stanchion() {
  const g = new THREE.Group();
  g.add(cyl(0.16, 0.03, steel(), 0, 0.015, 0, 10));
  g.add(cyl(0.03, 1.0, steel(), 0, 0.5, 0, 6));
  g.add(sphere(0.045, steel(), 0, 1.02, 0, 8));
  return tag(g, 'stanchion');
}

// ══════════════════════════════════════════════════════════════
// BANK
// ══════════════════════════════════════════════════════════════

/** Teller counter: raised counter, glass screen with a speaking hole, cash drawer. */
export function tellerCounter(w = 2.6, color = 0x1c2833) {
  const g = new THREE.Group();
  g.add(box(w, 1.1, 0.7, materials.matte(color), 0, 0.55, 0));
  g.add(box(w + 0.12, 0.08, 0.86, materials.matte(0xdfe6ea), 0, 1.14, 0));
  // Glass screen from 1.18 up to 2.0 with a gap for passing cash
  g.add(box(w, 0.6, 0.03, materials.glass(), 0, 1.6, -0.24));
  g.add(box(w * 0.28, 0.42, 0.03, materials.glass(), 0, 1.6, -0.24));
  g.add(box(0.3, 0.06, 0.2, steel(), 0, 1.18, 0));
  g.add(box(0.34, 0.26, 0.22, materials.matte(0x23282e), w / 2 - 0.4, 1.42, -0.4));
  g.add(box(0.2, 0.02, 0.3, materials.matte(0x33393f), w / 2 - 0.4, 1.2, -0.3));
  g.add(box(0.5, 0.06, 0.3, materials.matte(0x2b7a4b), -w / 2 + 0.5, 1.2, 0));  // cash tray
  return tag(g, 'tellerCounter');
}

/** The vault: heavy steel door with a wheel, set into a wall of deposit boxes. */
export function vaultDoor() {
  const g = new THREE.Group();
  g.add(box(2.6, 2.9, 0.22, materials.matte(0x39424b), 0, 1.45, 0));
  g.add(box(2.2, 2.6, 0.1, materials.metalDark(), 0, 1.35, 0.14));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 8, 16), steel());
  wheel.position.set(0, 1.5, 0.22);
  g.add(wheel);
  for (let i = 0; i < 4; i++) {
    const spoke = box(0.06, 0.7, 0.04, steel(), 0, 1.5, 0.24);
    spoke.rotation.z = (i / 4) * Math.PI;
    g.add(spoke);
  }
  for (let i = 0; i < 3; i++) g.add(box(0.12, 0.12, 0.08, materials.matte(0x6d7b86), 0, 1.5, 0.3)); // bolts
  return tag(g, 'vaultDoor');
}

/** Wall of safe-deposit boxes. */
export function depositBoxes(w = 2.2, h = 1.8) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.4, materials.matte(0x8e9aa4), 0, h / 2, 0));
  const cols = 6;
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      g.add(box(w / cols - 0.05, h / rows - 0.05, 0.03, materials.matte(0x5f6b74),
        -w / 2 + (w / cols) * (c + 0.5), (h / rows) * (r + 0.5), 0.21));
    }
  }
  return tag(g, 'depositBoxes');
}

/** Standalone ATM. */
export function atmMachine() {
  const g = new THREE.Group();
  g.add(box(0.9, 1.9, 0.6, materials.matte(0x1f4f7a), 0, 0.95, 0));
  g.add(box(0.7, 0.4, 0.05, glow(0x3fa0e0), 0, 1.5, 0.31));
  g.add(box(0.5, 0.14, 0.06, materials.matte(0x30363b), 0, 1.12, 0.32));
  g.add(box(0.3, 0.05, 0.1, materials.matte(0x1a1f24), 0, 0.98, 0.32));  // card slot
  g.add(box(0.4, 0.06, 0.1, materials.matte(0x1a1f24), 0, 0.82, 0.32));  // cash slot
  g.add(box(0.9, 0.1, 0.62, materials.matte(0x14181c), 0, 1.95, 0));
  return tag(g, 'atmMachine');
}

// ══════════════════════════════════════════════════════════════
// OFFICE
// ══════════════════════════════════════════════════════════════

/** Office workstation: desk, monitor, keyboard, phone, chair. Faces +Z. */
export function officeDesk(color = 0x9c7b52) {
  const g = new THREE.Group();
  g.add(box(1.5, 0.06, 0.75, materials.wood(color), 0, 0.73, 0));
  for (const sx of [-1, 1]) {
    g.add(box(0.06, 0.7, 0.06, steel(), sx * 0.68, 0.37, -0.3));
    g.add(box(0.06, 0.7, 0.06, steel(), sx * 0.68, 0.37, 0.3));
  }
  g.add(box(0.5, 0.32, 0.03, materials.matte(0x1a1f24), 0, 1.0, -0.22));
  g.add(box(0.46, 0.28, 0.01, glow(0x5aa9e6), 0, 1.0, -0.2));
  g.add(box(0.08, 0.16, 0.08, materials.metalDark(), 0, 0.85, -0.24));
  g.add(box(0.4, 0.02, 0.14, materials.matte(0x2b2f36), 0, 0.77, 0.12));
  g.add(box(0.16, 0.06, 0.12, materials.matte(0x2b2f36), 0.55, 0.79, -0.1)); // phone
  // Chair
  g.add(box(0.46, 0.07, 0.46, cloth(0x2c3e50), 0, 0.46, 0.58));
  g.add(box(0.46, 0.5, 0.06, cloth(0x2c3e50), 0, 0.72, 0.82));
  g.add(cyl(0.04, 0.46, steel(), 0, 0.23, 0.58, 6));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = box(0.05, 0.04, 0.3, grey(), 0, 0.06, 0);
    leg.rotation.y = a;
    leg.position.set(Math.cos(a) * 0.14, 0.06, 0.58 + Math.sin(a) * 0.14);
    g.add(leg);
  }
  return tag(g, 'officeDesk');
}

/** Cubicle partition panel (sits on the floor, blocks sight lines). */
export function cubiclePanel(w = 2.2, h = 1.55, color = 0xb9c6cf) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.06, materials.matte(color), 0, h / 2 + 0.05, 0));
  g.add(box(w, 0.05, 0.09, materials.matte(0x8e9aa4), 0, h + 0.08, 0));
  return tag(g, 'cubiclePanel');
}

/** Filing cabinet with open drawers. */
export function filingCabinet(h = 1.35) {
  const g = new THREE.Group();
  g.add(box(0.5, h, 0.45, materials.matte(0x8e9aa4), 0, h / 2, 0));
  for (let i = 0; i < 4; i++) {
    g.add(box(0.44, 0.24, 0.02, materials.matte(0x6d7b86), 0, 0.2 + i * 0.3, 0.23));
    g.add(box(0.14, 0.03, 0.04, steel(), 0, 0.2 + i * 0.3, 0.26));
  }
  const open = box(0.42, 0.2, 0.3, materials.matte(0x5f6b74), 0, 0.5, 0.4);
  g.add(open);
  return tag(g, 'filingCabinet');
}

/** Whiteboard on legs. */
export function whiteboard(w = 1.8, h = 1.1) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.04, materials.matte(0xf4f6f7), 0, 1.3, 0));
  for (const sx of [-1, 1]) g.add(box(0.05, 1.3, 0.05, steel(), sx * (w / 2 - 0.1), 0.65, 0));
  g.add(box(w * 0.5, 0.03, 0.01, materials.matte(0x2e86de), -w * 0.15, 1.55, 0.03));
  g.add(box(w * 0.3, 0.03, 0.01, materials.matte(0xc0392b), w * 0.1, 1.3, 0.03));
  return tag(g, 'whiteboard');
}

/** Water dispenser. */
export function waterDispenser() {
  const g = new THREE.Group();
  g.add(box(0.4, 1.0, 0.4, materials.matte(0xe8eef2), 0, 0.5, 0));
  g.add(cyl(0.16, 0.45, materials.glass(), 0, 1.28, 0, 12));
  g.add(box(0.06, 0.06, 0.1, materials.matte(0x2e86de), 0.1, 0.75, 0.22));
  return tag(g, 'waterDispenser');
}

// ══════════════════════════════════════════════════════════════
// SHOP / SUPERMARKET
// ══════════════════════════════════════════════════════════════

/** Gondola shelving stacked with colour-coded goods. `len` runs along X. */
export function shopShelf(len = 2.4, seed = 1) {
  const g = new THREE.Group();
  const h = 1.7;
  g.add(box(len, 0.06, 0.9, materials.matte(0xdfe6ea), 0, 0.72, 0));
  g.add(box(len, 0.06, 0.9, materials.matte(0xdfe6ea), 0, 1.24, 0));
  g.add(box(len, 0.06, 0.9, materials.matte(0xdfe6ea), 0, h, 0));
  g.add(box(len, 0.6, 0.04, materials.matte(0xf2f4f6), 0, 0.32, 0));   // base plinth
  g.add(box(len, 0.05, 0.05, materials.matte(0xb0bcc4), 0, h + 0.06, 0));
  const colors = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0xe67e22, 0x9b59b6];
  const perRow = Math.max(4, Math.round(len / 0.3));
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < perRow; i++) {
      const c = colors[(i * 3 + row + seed) % colors.length];
      const hh = 0.16 + ((i + seed) % 3) * 0.06;
      g.add(box(0.16, hh, 0.22, plastic(c),
        -len / 2 + 0.15 + i * (len / perRow), 0.35 + row * 0.52 + hh / 2, (i % 2 ? 0.12 : -0.12)));
    }
  }
  return tag(g, 'shopShelf');
}

/** Checkout till: conveyor, till, bag stand, screen. */
export function checkout() {
  const g = new THREE.Group();
  g.add(box(2.2, 0.75, 0.9, materials.matte(0xdfe6ea), 0, 0.38, 0));
  g.add(box(1.2, 0.04, 0.6, materials.matte(0x30363b), -0.45, 0.77, 0));
  g.add(box(0.5, 0.2, 0.4, materials.matte(0x2b2f36), 0.65, 0.86, 0));
  g.add(box(0.4, 0.28, 0.05, glow(0x54e08a), 0.65, 1.2, -0.3));
  g.add(box(0.4, 0.02, 0.02, steel(), 0.65, 1.05, -0.28));
  g.add(box(0.5, 0.1, 0.4, materials.matte(0x1a1f24), 0.65, 0.82, 0.3));
  // A basket of shopping
  g.add(box(0.4, 0.24, 0.3, plastic(0xd94f70), -0.9, 0.88, 0));
  return tag(g, 'checkout');
}

/** Glass-fronted drinks fridge. */
export function fridgeCase(w = 1.2, h = 2.0) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.65, materials.matte(0x2c3e50), 0, h / 2, 0));
  g.add(box(w - 0.12, h - 0.24, 0.02, materials.glassLit(), 0, h / 2, 0.34));
  for (let r = 0; r < 4; r++) {
    g.add(box(w - 0.16, 0.03, 0.5, materials.matte(0x8e9aa4), 0, 0.3 + r * 0.45, 0.05));
    for (let i = 0; i < 5; i++) {
      g.add(cyl(0.045, 0.22, plastic([0xe74c3c, 0x2ecc71, 0xf1c40f][(i + r) % 3]),
        -w / 2 + 0.2 + i * ((w - 0.4) / 5), 0.44 + r * 0.45, 0.08, 8));
    }
  }
  return tag(g, 'fridgeCase');
}

/** Shopping trolley. */
export function shoppingTrolley() {
  const g = new THREE.Group();
  g.add(box(0.5, 0.05, 0.8, steel(), 0, 0.5, 0));
  for (const sx of [-1, 1]) {
    g.add(box(0.04, 0.42, 0.8, steel(), sx * 0.25, 0.7, 0));
    g.add(box(0.04, 0.04, 0.04, grey(), sx * 0.2, 0.1, -0.3));
    g.add(box(0.04, 0.04, 0.04, grey(), sx * 0.2, 0.1, 0.3));
  }
  g.add(box(0.5, 0.04, 0.04, steel(), 0, 0.92, -0.4));
  g.add(box(0.04, 0.4, 0.04, steel(), 0, 0.72, 0.42));
  return tag(g, 'shoppingTrolley');
}

// ══════════════════════════════════════════════════════════════
// FOOD, SCHOOL, POLICE, GYM
// ══════════════════════════════════════════════════════════════

/** Restaurant table set: table and two chairs. */
export function diningSet(c = 0xd9a441) {
  const g = new THREE.Group();
  g.add(cyl(0.42, 0.05, materials.wood(0x8a6540), 0, 0.74, 0, 16));
  g.add(cyl(0.05, 0.72, steel(), 0, 0.37, 0, 8));
  g.add(cyl(0.24, 0.04, grey(), 0, 0.02, 0, 10));
  for (const sz of [-1, 1]) {
    g.add(box(0.42, 0.06, 0.42, plastic(c), 0, 0.45, sz * 0.72));
    const back = box(0.42, 0.42, 0.05, plastic(c), 0, 0.66, sz * 0.93);
    back.rotation.x = -0.1 * sz;
    g.add(back);
    g.add(box(0.05, 0.44, 0.05, steel(), -0.17, 0.22, sz * 0.72));
    g.add(box(0.05, 0.44, 0.05, steel(), 0.17, 0.22, sz * 0.72));
  }
  g.add(cyl(0.05, 0.1, materials.matte(0x2b2f36), 0, 0.82, 0, 8)); // condiment
  return tag(g, 'diningSet');
}

/** Hot-food serving counter with trays under lamps. */
export function servingCounter(w = 3.0) {
  const g = new THREE.Group();
  g.add(box(w, 0.95, 0.7, materials.matte(0x8e9aa4), 0, 0.48, 0));
  g.add(box(w, 0.06, 0.8, steel(), 0, 0.98, 0));
  g.add(box(w - 0.2, 0.5, 0.03, materials.glass(), 0, 1.35, -0.3));
  for (let i = 0; i < 4; i++) {
    g.add(box((w - 0.4) / 4 - 0.08, 0.14, 0.5, materials.matte(0x30363b),
      -w / 2 + 0.2 + ((w - 0.4) / 4) * (i + 0.5), 1.08, 0.05));
    g.add(box(0.06, 0.06, 0.06, glow(0xffcf7a),
      -w / 2 + 0.2 + ((w - 0.4) / 4) * (i + 0.5), 1.7, 0));
  }
  g.add(box(w, 0.05, 0.05, materials.matte(0x2b2f36), 0, 1.75, 0));
  return tag(g, 'servingCounter');
}

/** School desk with an attached bench seat. Faces +Z. */
export function schoolDesk() {
  const g = new THREE.Group();
  g.add(box(0.9, 0.05, 0.5, materials.wood(0xa9825a), 0, 0.68, 0));
  g.add(box(0.9, 0.2, 0.03, materials.wood(0xa9825a), 0, 0.57, 0.24));
  g.add(box(0.9, 0.05, 0.28, materials.wood(0xa9825a), 0, 0.42, -0.4));
  for (const sx of [-1, 1]) {
    g.add(box(0.05, 0.7, 0.05, steel(), sx * 0.4, 0.35, -0.2));
    g.add(box(0.05, 0.42, 0.05, steel(), sx * 0.4, 0.21, -0.4));
  }
  g.add(box(0.24, 0.02, 0.3, materials.matte(0xf6f3e8), -0.2, 0.71, 0));
  g.add(box(0.05, 0.14, 0.05, plastic(0xc0392b), 0.2, 0.77, 0.1));  // pencil case
  return tag(g, 'schoolDesk');
}

/** Blackboard mounted on a wall (caller places it against the wall). */
export function blackboard(w = 4.0, h = 1.5) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.06, materials.matte(0x1f3b2c), 0, h / 2, 0));
  g.add(box(w + 0.12, 0.08, 0.1, materials.wood(0x8a6540), 0, h + 0.02, 0));
  g.add(box(w + 0.12, 0.08, 0.14, materials.wood(0x8a6540), 0, 0.02, 0.03));
  g.add(box(w * 0.3, 0.03, 0.03, materials.matte(0xf4f4ee), -w * 0.2, h * 0.65, 0.05));
  g.add(box(w * 0.18, 0.03, 0.03, materials.matte(0xf4f4ee), w * 0.15, h * 0.35, 0.05));
  return tag(g, 'blackboard');
}

/** Police front desk: counter, monitor, radio, notice board above. */
export function policeDesk(w = 3.2) {
  const g = new THREE.Group();
  g.add(box(w, 1.1, 0.7, materials.matte(0x243447), 0, 0.55, 0));
  g.add(box(w + 0.1, 0.07, 0.8, materials.matte(0xdfe6ea), 0, 1.13, 0));
  g.add(box(0.5, 0.32, 0.05, materials.matte(0x1a1f24), -0.7, 1.38, -0.2));
  g.add(box(0.46, 0.28, 0.01, glow(0x5aa9e6), -0.7, 1.38, -0.17));
  g.add(box(0.14, 0.22, 0.1, materials.matte(0x2b2f36), 0.6, 1.28, 0));
  g.add(box(0.04, 0.3, 0.04, steel(), 0.6, 1.35, 0));
  g.add(box(0.9, 0.6, 0.03, materials.matte(0x6d4c2f), w / 2 - 0.8, 1.75, -0.3));
  return tag(g, 'policeDesk');
}

/** Holding cell: barred front with a bench and a bucket. */
export function holdingCell(w = 3.0, h = 2.5) {
  const g = new THREE.Group();
  const barMat = steel();
  for (let i = 0; i < Math.floor(w / 0.22); i++) {
    g.add(cyl(0.02, h, barMat, -w / 2 + 0.11 + i * 0.22, h / 2, 0, 6));
  }
  g.add(cyl(0.05, w, barMat, 0, h, 0, 8).rotateZ(Math.PI / 2));
  const mid = cyl(0.04, w, barMat, 0, h * 0.45, 0, 8);
  mid.rotation.z = Math.PI / 2;
  g.add(mid);
  g.add(box(w, 0.08, 0.35, materials.concreteGround(), 0, 0.45, -1.2));
  g.add(cyl(0.14, 0.3, materials.matte(0x8e9aa4), 0.8, 0.15, -1.5, 10));
  return tag(g, 'holdingCell');
}

/** Locker bank. */
export function lockerBank(n = 4, h = 1.9) {
  const g = new THREE.Group();
  const w = n * 0.42;
  g.add(box(w, h, 0.45, materials.matte(0x4a5560), 0, h / 2, 0));
  for (let i = 0; i < n; i++) {
    g.add(box(0.38, h - 0.1, 0.02, materials.matte(0x5f6b74), -w / 2 + 0.21 + i * 0.42, h / 2, 0.23));
    g.add(box(0.06, 0.06, 0.03, steel(), -w / 2 + 0.34 + i * 0.42, h / 2, 0.25));
  }
  return tag(g, 'lockerBank');
}

/** Treadmill. */
export function treadmill() {
  const g = new THREE.Group();
  g.add(box(0.7, 0.12, 1.5, materials.matte(0x2b2f36), 0, 0.16, 0));
  g.add(box(0.6, 0.03, 1.35, materials.matte(0x14181c), 0, 0.23, 0));
  for (const sx of [-1, 1]) g.add(box(0.06, 1.1, 0.06, steel(), sx * 0.3, 0.7, -0.6));
  g.add(box(0.72, 0.1, 0.24, materials.matte(0x1a1f24), 0, 1.24, -0.58));
  g.add(box(0.4, 0.16, 0.02, glow(0x3fa0e0), 0, 1.3, -0.45));
  g.add(box(0.08, 1.0, 0.08, steel(), 0, 0.7, -0.62));
  g.add(box(0.7, 0.05, 0.08, steel(), 0, 1.2, -0.55));
  return tag(g, 'treadmill');
}

/** Dumbbell rack. */
export function weightRack(w = 1.8) {
  const g = new THREE.Group();
  g.add(box(w, 0.06, 0.5, steel(), 0, 0.9, 0));
  g.add(box(w, 0.06, 0.5, steel(), 0, 0.45, 0));
  for (const sx of [-1, 1]) g.add(box(0.07, 0.95, 0.5, steel(), sx * (w / 2 - 0.05), 0.48, 0));
  for (let i = 0; i < 5; i++) {
    for (const [y, z] of [[0.98, 0], [0.53, 0]]) {
      const x = -w / 2 + 0.3 + i * ((w - 0.6) / 4);
      g.add(cyl(0.09, 0.18, materials.metalDark(), x, y + 0.09, z, 10));
      g.add(cyl(0.11, 0.05, materials.metalDark(), x, y + 0.09, z + 0.11, 10));
      g.add(cyl(0.11, 0.05, materials.metalDark(), x, y + 0.09, z - 0.11, 10));
    }
  }
  return tag(g, 'weightRack');
}

/** Bench press with a loaded bar. */
export function benchPress() {
  const g = new THREE.Group();
  g.add(box(0.4, 0.12, 1.3, cloth(0x1a1f24), 0, 0.5, 0.1));
  for (const sz of [-1, 1]) {
    g.add(box(0.1, 0.5, 0.1, steel(), 0, 0.25, sz * 0.5));
    g.add(box(0.06, 1.1, 0.06, steel(), 0, 0.55, sz * 0.3));
  }
  g.add(box(1.8, 0.05, 0.05, steel(), 0, 1.1, -0.3));
  for (const sx of [-1, 1]) g.add(cyl(0.18, 0.1, materials.metalDark(), sx * 0.75, 1.1, -0.3, 12));
  return tag(g, 'benchPress');
}

// ══════════════════════════════════════════════════════════════
// SMALL BITS
// ══════════════════════════════════════════════════════════════

/** Unframed wall sign, glowing letters. Faces +Z. */
export function wallSign(w = 1.4, h = 0.4, color = 0x54e08a) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.05, materials.matte(0x14181c), 0, h / 2, 0));
  const n = Math.max(3, Math.round(w / 0.22));
  for (let i = 0; i < n; i++) {
    g.add(box((w / n) * 0.55, h * 0.42, 0.02, glow(color), -w / 2 + (w / n) * (i + 0.5), h / 2, 0.035));
  }
  return tag(g, 'wallSign');
}

/** Floor-standing queue post with a retractable ribbon (short run, along X). */
export function queuePosters(count = 4, len = 2.6) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const p = stanchion();
    p.position.x = -len / 2 + (len / (count - 1)) * i;
    g.add(p);
    if (i < count - 1) {
      g.add(box(len / (count - 1) - 0.06, 0.03, 0.01, cloth(0x1c2833),
        p.position.x + len / (count - 1) / 2, 0.9, 0));
    }
  }
  return tag(g, 'queuePosters');
}

/** Stack of test-tube racks / lab bench, used by the hospital lab corner. */
export function labBench(w = 1.6) {
  const g = new THREE.Group();
  g.add(box(w, 0.06, 0.7, materials.matte(0xeef3f5), 0, 0.95, 0));
  for (const sx of [-1, 1]) g.add(box(0.06, 0.95, 0.6, materials.matte(0xdfe6ea), sx * (w / 2 - 0.06), 0.47, 0));
  for (let i = 0; i < 4; i++) {
    g.add(cyl(0.03, 0.16, materials.glass(), -w / 2 + 0.3 + i * 0.3, 1.06, 0.1, 8));
    g.add(cyl(0.035, 0.05, plastic(0xc0392b), -w / 2 + 0.3 + i * 0.3, 1.0, 0.1, 8));
  }
  g.add(box(0.3, 0.22, 0.24, materials.matte(0xf2f6f8), w / 2 - 0.4, 1.06, -0.1));
  return tag(g, 'labBench');
}

// ══════════════════════════════════════════════════════════════
// WORKSHOP
// ══════════════════════════════════════════════════════════════

/** A stack of tyres, the universal garage furniture. */
export function tyreStack(count = 4) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 8, 14), materials.matte(0x1a1f24));
    t.rotation.x = Math.PI / 2;
    t.position.y = 0.12 + i * 0.22;
    t.castShadow = true;
    g.add(t);
  }
  return tag(g, 'tyreStack');
}

/** Oil drum. */
export function oilDrum(color = 0x2b5d8a) {
  const g = new THREE.Group();
  g.add(cyl(0.28, 0.9, materials.paint(color), 0, 0.45, 0, 14));
  g.add(cyl(0.29, 0.04, materials.metalDark(), 0, 0.28, 0, 14));
  g.add(cyl(0.29, 0.04, materials.metalDark(), 0, 0.62, 0, 14));
  g.add(cyl(0.05, 0.04, materials.metalDark(), 0.18, 0.92, 0, 8));
  return tag(g, 'oilDrum');
}

/** Pegboard of tools for a workshop wall. Faces +Z. */
export function toolBoard(w = 2.0, h = 1.0) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.05, materials.matte(0x5f6b74), 0, h / 2 + 0.3, 0));
  const toolMat = materials.metalDark();
  for (let i = 0; i < 5; i++) g.add(box(0.05, 0.3, 0.03, toolMat, -w / 2 + 0.2 + i * 0.35, h / 2 + 0.25, 0.04));
  g.add(box(0.4, 0.06, 0.03, toolMat, w / 2 - 0.4, h / 2 + 0.2, 0.04));
  g.add(box(0.06, 0.22, 0.03, toolMat, w / 2 - 0.25, h / 2 + 0.05, 0.04));
  return tag(g, 'toolBoard');
}

/** Snack rack for a kiosk: hooks of hanging sachets. */
export function snackRack(w = 1.2, h = 1.6) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.05, materials.matte(0x8e9aa4), 0, h / 2, 0));
  const colors = [0xe74c3c, 0xf1c40f, 0x2ecc71, 0x3498db];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 4; i++) {
      g.add(box(0.16, 0.2, 0.02, materials.paint(colors[(r + i) % 4]),
        -w / 2 + 0.2 + i * ((w - 0.4) / 4), 0.25 + r * 0.36, 0.04));
    }
  }
  return tag(g, 'snackRack');
}

// ── People ──────────────────────────────────────────────────────
/**
 * A standing member of staff, or a passenger, or a market trader.
 *
 * The complaint was "no attendant". A shop with nobody in it feels abandoned no
 * matter how good the shelving is, and this game is set in Lagos — there is
 * always somebody behind the counter. Built from primitives like everything else
 * here: head, torso, arms, legs, plus an optional apron, cap or hi-vis vest.
 *
 * @param {object} [o]
 * @param {number} [o.shirt] uniform colour
 * @param {number} [o.skin] skin tone
 * @param {number} [o.trousers]
 * @param {string} [o.role] 'cashier' | 'trader' | 'agent' | 'pilot' | 'guard' | 'passenger' | 'nurse'
 * @returns {THREE.Group} 1.75 m tall, facing +Z
 */
export function staffFigure({
  shirt = 0x2c6fbb, skin = 0x8d5524, trousers = 0x2b2f36,
  role = 'cashier', hair = 0x1b1310,
} = {}) {
  const g = new THREE.Group();
  const shirtMat = materials.paint(shirt);
  const skinMat = materials.paint(skin);
  const trouserMat = materials.paint(trousers);

  const legH = 0.82;
  for (const sx of [-0.11, 0.11]) {
    g.add(box(0.15, legH, 0.17, trouserMat, sx, legH / 2, 0));
  }
  // Shoes
  for (const sx of [-0.11, 0.11]) {
    g.add(box(0.17, 0.07, 0.26, materials.matte(0x15181c), sx, 0.035, 0.04));
  }
  // Torso
  g.add(box(0.42, 0.56, 0.24, shirtMat, 0, legH + 0.28, 0));
  // Arms
  for (const sx of [-0.255, 0.255]) {
    g.add(box(0.11, 0.5, 0.13, shirtMat, sx, legH + 0.30, 0));
    g.add(box(0.1, 0.12, 0.12, skinMat, sx, legH + 0.02, 0));
  }
  // Neck + head
  g.add(box(0.1, 0.08, 0.1, skinMat, 0, legH + 0.6, 0));
  g.add(box(0.2, 0.24, 0.2, skinMat, 0, legH + 0.76, 0));
  // Hair
  g.add(box(0.21, 0.08, 0.21, materials.paint(hair), 0, legH + 0.88, 0));

  if (role === 'cashier' || role === 'trader') {
    // Apron over the shirt, tied at the waist.
    g.add(box(0.34, 0.5, 0.03, materials.matte(0x2e8b57), 0, legH + 0.26, 0.13));
  }
  if (role === 'pilot') {
    // Jacket, tie, cap with a peak.
    g.add(box(0.44, 0.58, 0.26, materials.matte(0x1b2a41), 0, legH + 0.28, 0));
    g.add(box(0.07, 0.3, 0.02, materials.matte(0xc0392b), 0, legH + 0.36, 0.135));
    g.add(box(0.22, 0.07, 0.22, materials.matte(0x1b2a41), 0, legH + 0.9, 0));
    g.add(box(0.22, 0.03, 0.1, materials.matte(0x101820), 0, legH + 0.87, 0.14));
  }
  if (role === 'guard') {
    g.add(box(0.46, 0.3, 0.27, materials.matte(0xf1c40f), 0, legH + 0.42, 0));
    g.add(box(0.24, 0.08, 0.24, materials.matte(0x1b2a41), 0, legH + 0.9, 0));
  }
  if (role === 'nurse') {
    g.add(box(0.4, 0.6, 0.25, materials.matte(0xf4f6f6), 0, legH + 0.28, 0));
    g.add(box(0.16, 0.16, 0.02, materials.matte(0xc0392b), 0, legH + 0.42, 0.13));
  }
  if (role === 'passenger') {
    // A shoulder bag, because nobody at an airport travels empty-handed.
    g.add(box(0.26, 0.3, 0.12, materials.matte(0x6d4c41), 0.28, legH + 0.2, 0.02));
  }
  return tag(g, `staff-${role}`);
}

// ── Supermarket fittings ────────────────────────────────────────
/**
 * A double-sided gondola: two back-to-back shelving runs with goods on them.
 * This is the shape that makes a supermarket read as a supermarket — long
 * parallel runs with a walking aisle between them.
 */
export function gondola(len = 4.0, { seed = 1, colours = null } = {}) {
  const g = new THREE.Group();
  const shell = materials.matte(0xdfe4e8);
  const shelfMat = materials.matte(0xc3cbd1);
  const palette = colours || [0xc0392b, 0xf1c40f, 0x2ecc71, 0x3498db, 0xe67e22, 0x8e44ad, 0x16a085];

  // Base + back panel + four shelves, mirrored either side.
  g.add(box(len, 0.12, 0.86, materials.matte(0x9aa5ad), 0, 0.06, 0));
  g.add(box(len, 1.62, 0.06, shell, 0, 0.9, 0));
  const levels = [0.34, 0.72, 1.1, 1.46];
  for (const side of [-1, 1]) {
    for (const y of levels) {
      g.add(box(len, 0.04, 0.4, shelfMat, 0, y, side * 0.22));
      // Price strip on the front lip of every shelf.
      g.add(box(len, 0.05, 0.02, materials.matte(0xffd166), 0, y - 0.03, side * 0.42));
    }
  }

  // Goods: rows of little boxes with a deterministic colour pattern.
  let n = seed;
  for (const side of [-1, 1]) {
    for (const y of levels) {
      const perShelf = Math.max(3, Math.floor(len / 0.34));
      for (let i = 0; i < perShelf; i++) {
        n = (n * 1103515245 + 12345) & 0x7fffffff;
        const pick = palette[n % palette.length];
        const w = 0.18 + ((n >> 8) % 3) * 0.05;
        const h = 0.16 + ((n >> 12) % 4) * 0.04;
        const x = -len / 2 + 0.17 + i * (len - 0.34) / Math.max(1, perShelf - 1);
        g.add(box(w, h, 0.24, materials.paint(pick), x, y + h / 2 + 0.02, side * 0.24));
      }
    }
  }
  // End cap sign
  g.add(box(0.05, 0.36, 0.5, materials.matte(0xe67e22), len / 2 + 0.02, 1.72, 0));
  return tag(g, 'gondola');
}

/** Multi-deck chiller cabinet for the dairy/perimeter wall. Faces +Z. */
export function chillerCase(w = 2.4, h = 2.1) {
  const g = new THREE.Group();
  const frame = materials.matte(0xb7c2c8);
  const glass = materials.glass();
  g.add(box(w, h, 0.7, materials.matte(0xdfe4e8), 0, h / 2, 0));
  g.add(box(w, 0.1, 0.72, frame, 0, h, 0));
  const levels = [0.42, 0.86, 1.3, 1.74];
  for (const y of levels) {
    g.add(box(w - 0.1, 0.05, 0.6, frame, 0, y, 0.04));
    // Cold-field glow behind the goods.
    g.add(box(w - 0.16, 0.3, 0.02, materials.glow(0xcfe9f5), 0, y + 0.18, -0.28));
    const per = Math.max(2, Math.floor(w / 0.4));
    for (let i = 0; i < per; i++) {
      const x = -w / 2 + 0.25 + i * (w - 0.5) / Math.max(1, per - 1);
      g.add(box(0.16, 0.24, 0.2, materials.paint([0xf4f6f6, 0xf5d033, 0xcfe9f5][i % 3]), x, y + 0.15, 0.06));
    }
  }
  // Glass doors
  g.add(box(w - 0.08, h - 0.2, 0.03, glass, 0, h / 2 - 0.02, 0.34));
  return tag(g, 'chillerCase');
}

/** Sloped produce display with misting nozzles above it. */
export function produceTable(w = 2.6) {
  const g = new THREE.Group();
  g.add(box(w, 0.72, 1.0, materials.matte(0x8d6e63), 0, 0.36, 0));
  // Angled display bed
  const bed = box(w - 0.1, 0.08, 0.92, materials.matte(0xbfa484), 0, 0.78, 0);
  bed.rotation.x = -0.16;
  g.add(bed);
  // Crates of produce
  const colours = [0x2e7d32, 0xc62828, 0xf9a825, 0x6d4c41, 0x558b2f];
  const per = Math.max(3, Math.floor(w / 0.5));
  for (let i = 0; i < per; i++) {
    const x = -w / 2 + 0.3 + i * (w - 0.6) / Math.max(1, per - 1);
    g.add(box(0.36, 0.16, 0.62, materials.matte(0xa1887f), x, 0.86, 0));
    for (let k = 0; k < 3; k++) {
      g.add(sphere(0.08, materials.paint(colours[(i + k) % colours.length]), x - 0.1 + k * 0.1, 0.98, -0.12 + (k % 2) * 0.18, 6));
    }
  }
  // Misting rail
  g.add(box(w, 0.05, 0.05, materials.metalDark(), 0, 1.72, -0.1));
  for (let i = 0; i < 3; i++) {
    const x = -w / 2 + 0.4 + i * (w - 0.8) / 2;
    g.add(box(0.05, 0.28, 0.05, materials.metalDark(), x, 1.58, -0.1));
    g.add(sphere(0.03, materials.matte(0xd7e4ea), x, 1.44, -0.1, 5));
  }
  return tag(g, 'produceTable');
}

/** Self-checkout pod: scanner, screen, bagging area, card pad. */
export function selfCheckout() {
  const g = new THREE.Group();
  const bodyMat = materials.matte(0x34495e);
  g.add(box(0.8, 1.0, 0.55, bodyMat, 0, 0.5, 0));
  // Screen on a stalk
  g.add(box(0.06, 0.4, 0.06, materials.metalDark(), 0, 1.2, -0.2));
  const screen = box(0.52, 0.34, 0.04, materials.matte(0x1a1f24), 0, 1.42, -0.2);
  screen.rotation.x = -0.18;
  g.add(screen);
  g.add(box(0.46, 0.28, 0.01, materials.glow(0x5aa9e6), 0, 1.42, -0.175));
  // Scanner glass and bagging shelf
  g.add(box(0.4, 0.04, 0.3, materials.glow(0xc8f2d4), 0, 1.0, 0.05));
  g.add(box(0.9, 0.05, 0.6, materials.matte(0xb7c2c8), 0, 0.86, 0.62));
  for (const sx of [-0.4, 0.4]) g.add(box(0.05, 0.86, 0.05, materials.metalDark(), sx, 0.43, 0.62));
  // Card pad
  g.add(box(0.14, 0.06, 0.18, materials.matte(0x1f2a33), 0.5, 1.0, 0.1));
  // Bag stand
  g.add(box(0.02, 0.5, 0.02, materials.metalDark(), 0.52, 1.25, 0.1));
  return tag(g, 'selfCheckout');
}

/** Stack of hand baskets by the entrance. */
export function basketStack(n = 6) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    g.add(box(0.5, 0.1, 0.36, materials.paint(i % 2 ? 0xc0392b : 0xd35400), 0, 0.06 + i * 0.11, 0));
  }
  g.add(box(0.56, 0.05, 0.42, materials.metalDark(), 0, 0.82, 0));
  return tag(g, 'basketStack');
}

/** Aisle sign hanging from the ceiling: "Aisle 3 · Tinned goods". */
export function aisleSign(text, colour = 0x24425a) {
  const g = new THREE.Group();
  g.add(box(0.03, 0.5, 0.03, materials.metalDark(), -0.7, 0.25, 0));
  g.add(box(0.03, 0.5, 0.03, materials.metalDark(), 0.7, 0.25, 0));
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.42),
    new THREE.MeshStandardMaterial({ map: textPlate(text, colour), roughness: 0.8 }),
  );
  plate.position.set(0, 0.5, 0);
  g.add(plate);
  const back = plate.clone();
  back.rotation.y = Math.PI;
  g.add(back);
  return tag(g, 'aisleSign');
}

/** Canvas texture for a written plate. Same approach as the building signs. */
function textPlate(text, bg = 0x24425a) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const bgHex = `#${bg.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#f7fafc';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
