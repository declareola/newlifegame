// client/src/world/BuildingFactory.js
// Generates real architecture instead of plain boxes.
//
// A building is assembled from parts: a body, a plinth, a facade grid of
// recessed windows with sills and lintels, one of several roof styles,
// edge trim, and Lagos-specific details — rooftop water tanks, satellite
// dishes, AC units, external staircases, shopfront awnings and signage.
//
// Every mesh is merged per material where possible to keep draw calls low.

import * as THREE from 'three';
import { materials } from './materials.js';

// ── Deterministic RNG so a given building id always looks the same ──
function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function makeRng(seedString) {
  let s = hashString(String(seedString)) || 12345;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function plane(w, h, material, x, y, z, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

// ── Facade ──────────────────────────────────────────────────────

/**
 * Punch a grid of windows into one wall of a building.
 * Windows are inset (recessed), with a sill below and a lintel above, so the
 * facade reads as constructed rather than painted on.
 */
function addWindowGrid(group, {
  width, height, wallZ, wallX = 0, faceZ = 1, baseY = 0,
  cols, rows, winW, winH, litChance, rng, glassMat, litMat,
  frameMat, sillMat,
}) {
  const spacingX = width / cols;
  const usableH = height * 0.82;
  const spacingY = usableH / rows;
  const startY = baseY + height * 0.09 + spacingY / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = wallX - width / 2 + spacingX * (c + 0.5);
      const y = startY + spacingY * r;

      const lit = rng() < litChance;
      const mat = lit ? litMat : glassMat;

      // Recessed reveal — a slightly larger dark box behind the glass
      group.add(box(winW + 0.09, winH + 0.09, 0.06, frameMat, x, y, wallZ + faceZ * 0.02));

      // Glass
      const g = plane(winW, winH, mat, x, y, wallZ + faceZ * 0.055, faceZ > 0 ? 0 : Math.PI);
      group.add(g);

      // Sill below
      group.add(box(winW + 0.18, 0.06, 0.14, sillMat, x, y - winH / 2 - 0.05, wallZ + faceZ * 0.07));

      // Lintel above
      group.add(box(winW + 0.18, 0.05, 0.10, sillMat, x, y + winH / 2 + 0.05, wallZ + faceZ * 0.05));

      // Mullion (vertical divider) on wider windows
      if (winW > 0.75) {
        group.add(box(0.03, winH, 0.03, frameMat, x, y, wallZ + faceZ * 0.06));
      }
    }
  }
}

// ── Rooftop details ─────────────────────────────────────────────

/** The classic black rooftop water tank — every Lagos building has one. */
function waterTank(rng) {
  const g = new THREE.Group();
  const h = 0.9 + rng() * 1.1;
  const r = 0.42 + rng() * 0.2;

  // Stand
  const legMat = materials.metalDark();
  for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) {
    g.add(box(0.05, 0.35, 0.05, legMat, x, 0.175, z));
  }
  // Tank body
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 14),
    materials.matte(rng() < 0.6 ? 0x1e1e22 : 0x2b3a4a)
  );
  tank.position.y = 0.35 + h / 2;
  tank.castShadow = true;
  g.add(tank);
  // Lid
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.08, 14), materials.matte(0x151518));
  lid.position.y = 0.35 + h + 0.04;
  g.add(lid);
  // Outlet pipe
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), materials.metalLight())
    .translateX(r).translateY(0.5));
  return g;
}

function satelliteDish(rng) {
  const g = new THREE.Group();
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3),
    materials.metalLight()
  );
  dish.rotation.x = Math.PI * 0.62;
  dish.rotation.z = rng() * 1.2 - 0.6;
  dish.position.y = 0.45;
  dish.castShadow = true;
  g.add(dish);
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 6), materials.metalDark())
    .translateY(0.22));
  return g;
}

function roofACUnit() {
  const g = new THREE.Group();
  g.add(box(0.7, 0.45, 0.5, materials.metalLight(), 0, 0.225, 0));
  // Grille
  g.add(box(0.55, 0.30, 0.02, materials.matte(0x333333), 0, 0.225, 0.26));
  return g;
}

// ── Building assembly ───────────────────────────────────────────

/**
 * Build one building.
 * @param {object} spec - the entry from cityData
 * @returns {THREE.Group}
 */
export function buildBuilding(spec) {
  const g = new THREE.Group();
  const rng = makeRng(spec.id);

  const w = spec.size.w;
  const d = spec.size.d;
  const h = spec.size.h;

  // Flat pads (bus park, construction site) are handled by the old path.
  if (h < 0.5) return g;

  // ── Choose a style ─────────────────────────────────────────
  const styleRoll = rng();
  const styleKey = spec.style
    ? styleKeyFromSpec(spec.style)
    : (h > 18 ? (styleRoll < 0.55 ? 'panel' : 'panel')
      : h > 9 ? (styleRoll < 0.5 ? 'plaster' : 'warm')
      : (styleRoll < 0.45 ? 'brick' : 'warm'));
  const tintIndex = Math.floor(rng() * TINTS.length);
  const trimMat = materials.matte(0xdedad2);
  const frameMat = materials.matte(0x2a2e33);
  const sillMat = materials.matte(0xd6d1c8);

  // ── Body ──────────────────────────────────────────────────
  const bodyMat = tintedWall(styleKey, tintIndex);

  const body = box(w, h, d, bodyMat, 0, h / 2, 0);
  g.add(body);

  // ── Plinth (ground floor band) ────────────────────────────
  const plinthH = Math.min(1.2, h * 0.14);
  g.add(box(w + 0.12, plinthH, d + 0.12, materials.matte(0x6b6660), 0, plinthH / 2, 0));
  // Plinth cap
  g.add(box(w + 0.22, 0.08, d + 0.22, trimMat, 0, plinthH + 0.04, 0));

  // ── Floor bands (storey separations) ──────────────────────
  const storeys = Math.max(1, Math.round(h / 3.2));
  const storeyH = h / storeys;
  for (let i = 1; i < storeys; i++) {
    g.add(box(w + 0.14, 0.10, d + 0.14, trimMat, 0, storeyH * i, 0));
  }

  // ── Windows ───────────────────────────────────────────────
  const glassMat = materials.glass();
  const litMat = materials.glassLit();
  const isTall = h > 10;

  // Compute a sensible window grid for each face
  const colsFront = Math.max(1, Math.floor(w / (isTall ? 1.9 : 2.4)));
  const rowsFront = Math.max(1, storeys - (storeys > 2 ? 1 : 0));
  const colsSide = Math.max(1, Math.floor(d / (isTall ? 1.9 : 2.4)));

  const winW = Math.min(1.25, (w / colsFront) * 0.55);
  const winH = Math.min(1.5, storeyH * 0.52);
  const litChance = 0.25;

  const facadeStartY = plinthH + 0.2;
  const facadeH = h - plinthH - 0.4;

  // Front (+Z) and back (-Z)
  addWindowGrid(g, {
    width: w, height: facadeH, wallZ: d / 2, faceZ: 1, baseY: facadeStartY,
    cols: colsFront, rows: rowsFront, winW, winH, litChance, rng,
    glassMat, litMat, frameMat, sillMat,
  });
  addWindowGrid(g, {
    width: w, height: facadeH, wallZ: -d / 2, faceZ: -1, baseY: facadeStartY,
    cols: colsFront, rows: rowsFront, winW, winH, litChance, rng,
    glassMat, litMat, frameMat, sillMat,
  });

  // Sides (+X and -X) — rotate the whole thing by using a rotated group
  for (const side of [1, -1]) {
    const sideGroup = new THREE.Group();
    addWindowGrid(sideGroup, {
      width: d, height: facadeH, wallZ: 0, faceZ: 1, baseY: facadeStartY,
      cols: colsSide, rows: rowsFront, winW: Math.min(1.2, (d / colsSide) * 0.55), winH,
      litChance, rng, glassMat, litMat, frameMat, sillMat,
    });
    sideGroup.rotation.y = side * Math.PI / 2;
    sideGroup.position.x = side * (w / 2);
    g.add(sideGroup);
  }

  // ── Corner pilasters ──────────────────────────────────────
  const pilasterW = 0.22;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(
        pilasterW, h, pilasterW, trimMat,
        sx * (w / 2 - pilasterW / 2 + 0.02), h / 2, sz * (d / 2 - pilasterW / 2 + 0.02)
      ));
    }
  }

  // ── Roof ──────────────────────────────────────────────────
  const roofStyle = h > 14 ? 'flat' : (rng() < 0.45 ? 'parapet' : 'ribbed');
  addRoof(g, { w, d, h, style: roofStyle, trimMat, rng });

  // ── Ground-floor shopfront (short buildings, street facing) ──
  if (h < 14 && rng() < 0.7) {
    addShopfront(g, { w, d, plinthH, rng });
  }

  // ── Rooftop clutter ───────────────────────────────────────
  const roofY = h + (roofStyle === 'parapet' ? 0.7 : 0.15);
  const tankCount = h > 8 ? (rng() < 0.75 ? 1 : 0) : (rng() < 0.4 ? 1 : 0);
  for (let i = 0; i < tankCount; i++) {
    const t = waterTank(rng);
    t.position.set((rng() - 0.5) * (w - 1.6), roofY, (rng() - 0.5) * (d - 1.6));
    g.add(t);
  }
  if (h > 6 && rng() < 0.5) {
    const dish = satelliteDish(rng);
    dish.position.set((rng() - 0.5) * (w - 1.2), roofY, (rng() - 0.5) * (d - 1.2));
    g.add(dish);
  }
  if (h > 8 && rng() < 0.45) {
    const ac = roofACUnit();
    ac.position.set((rng() - 0.5) * (w - 1.4), roofY, (rng() - 0.5) * (d - 1.4));
    g.add(ac);
  }

  // ── Side AC units on tall buildings ───────────────────────
  if (isTall) {
    const acCount = Math.min(6, Math.floor(h / 5));
    for (let i = 0; i < acCount; i++) {
      const y = plinthH + 1.4 + i * (facadeH / acCount) + rng() * 0.4;
      const side = rng() < 0.5 ? -1 : 1;
      const ac = box(0.62, 0.34, 0.30, materials.matte(0xe8e6e2), side * (w / 2 + 0.15), y, (rng() - 0.5) * (d * 0.7));
      g.add(ac);
    }
  }

  // ── Sign board for named buildings ────────────────────────
  if (spec.signColour) {
    addSign(g, spec, { w, d, h, plinthH });
  }

  return g;
}

// ── Tinted body materials ───────────────────────────────────────
// Each building gets a slightly different body colour, but only from a small
// fixed palette so the material cache stays tiny and buildings of the same
// style share one material instance.
const TINTS = [
  0xffffff, 0xfff2e0, 0xf7e6cf, 0xe9eef2,
  0xe4ece2, 0xf3e4ec, 0xece4d6, 0xdfe7ea,
  0xd9e4f0, 0xf0ead8,
];

const tintCache = new Map();

function tintedWall(styleKey, tintIndex) {
  const key = `${styleKey}:${tintIndex}`;
  if (tintCache.has(key)) return tintCache.get(key);

  let base;
  switch (styleKey) {
    case 'brick': base = materials.wallBrick(); break;
    case 'panel': base = materials.wallConcretePanel(); break;
    case 'glass': base = materials.wallConcretePanel(); break; // curtain wall base
    case 'warm':  base = materials.wallPlasterWarm(); break;
    case 'plaster':
    default:      base = materials.wallPlaster(); break;
  }
  const mat = base.clone();
  mat.color = new THREE.Color(TINTS[tintIndex % TINTS.length]);
  tintCache.set(key, mat);
  return mat;
}

function styleKeyFromSpec(style) {
  switch (style) {
    case 'brick': return 'brick';
    case 'panel': return 'panel';
    case 'warm':  return 'warm';
    case 'glass': return 'glass';
    default:      return 'plaster';
  }
}

function addRoof(g, { w, d, h, style, trimMat, rng }) {
  if (style === 'flat') {
    // Flat roof with a machine room
    g.add(box(w + 0.2, 0.14, d + 0.2, trimMat, 0, h + 0.07, 0));
    g.add(box(w * 0.35, 1.1, d * 0.35, materials.matte(0x8c8880), 0, h + 0.62, 0));
    return;
  }

  if (style === 'parapet') {
    // Flat roof with a low wall around the edge — very common
    g.add(box(w + 0.24, 0.14, d + 0.24, trimMat, 0, h + 0.07, 0));
    const ph = 0.7;
    const t = 0.16;
    g.add(box(w + 0.2, ph, t, trimMat, 0, h + ph / 2, d / 2));
    g.add(box(w + 0.2, ph, t, trimMat, 0, h + ph / 2, -d / 2));
    g.add(box(t, ph, d + 0.2, trimMat, w / 2, h + ph / 2, 0));
    g.add(box(t, ph, d + 0.2, trimMat, -w / 2, h + ph / 2, 0));
    return;
  }

  // Ribbed / corrugated pitched roof
  const roofH = Math.min(1.4, Math.max(0.6, w * 0.12));
  const roofMat = rng() < 0.5 ? materials.roofRust() : materials.roofShingle();

  const halfW = w / 2 + 0.25;
  const slopeLen = Math.sqrt(halfW * halfW + roofH * roofH);
  const angle = Math.atan2(roofH, halfW);

  for (const side of [1, -1]) {
    const slab = box(slopeLen, 0.10, d + 0.5, roofMat, 0, 0, 0);
    slab.rotation.z = side * -angle;
    slab.position.set(side * (halfW / 2), h + roofH / 2, 0);
    g.add(slab);
  }
  // Ridge cap
  g.add(box(0.18, 0.12, d + 0.5, materials.matte(0x4a4540), 0, h + roofH + 0.02, 0));
  // Gable ends
  const gable = new THREE.Shape();
  gable.moveTo(-halfW, 0);
  gable.lineTo(halfW, 0);
  gable.lineTo(0, roofH);
  gable.closePath();
  for (const z of [d / 2, -d / 2]) {
    const geo = new THREE.ExtrudeGeometry(gable, { depth: 0.1, bevelEnabled: false });
    const m = new THREE.Mesh(geo, trimMat);
    m.position.set(0, h, z - (z > 0 ? 0 : 0.1));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
}

/** Ground-floor shop: recessed glazing, awning, goods on display. */
function addShopfront(g, { w, d, plinthH, rng }) {
  const shopH = 2.4;
  const awningColors = [0xc0392b, 0x27ae60, 0x2980b9, 0xf39c12, 0x8e44ad];
  const awningColor = awningColors[Math.floor(rng() * awningColors.length)];

  // Shop glazing across the front
  const glassW = w * 0.72;
  g.add(plane(glassW, shopH * 0.72, materials.glass(), 0, plinthH + shopH * 0.42, d / 2 + 0.04));

  // Awning — sloped slab over the shopfront
  const awning = box(glassW + 0.5, 0.06, 0.9, materials.paint(awningColor), 0, 0, 0);
  awning.rotation.x = -0.22;
  awning.position.set(0, plinthH + shopH * 0.9, d / 2 + 0.42);
  g.add(awning);

  // Awning support posts
  for (const sx of [-1, 1]) {
    g.add(box(0.06, shopH * 0.85, 0.06,
      materials.metalDark(), sx * (glassW / 2 + 0.2), plinthH + shopH * 0.42, d / 2 + 0.82));
  }

  // Stalls / crates outside
  if (rng() < 0.5) {
    const crateColor = rng() < 0.5 ? 0x8b5a2b : 0x2e86c1;
    for (let i = 0; i < 3; i++) {
      g.add(box(0.4, 0.28, 0.4, materials.paint(crateColor),
        -glassW / 2 + i * 0.5, plinthH + 0.14, d / 2 + 1.0));
    }
  }
}

/** Illuminated sign board above the entrance. */
function addSign(g, spec, { w, d, h, plinthH }) {
  const signW = Math.min(w * 0.7, 6);
  const signH = 1.0;
  const y = Math.min(h - 0.8, plinthH + 3.2);

  // Board
  g.add(box(signW + 0.16, signH + 0.16, 0.10, materials.matte(0x1a1a1a), 0, y, d / 2 + 0.10));

  // Emissive face in the building's sign colour
  const faceColor = spec.signColour;
  const faceMat = materials.glow(faceColor);
  g.add(plane(signW, signH, faceMat, 0, y, d / 2 + 0.17));

  // Mounting brackets
  for (const sx of [-1, 1]) {
    g.add(box(0.05, 0.05, 0.24, materials.metalDark(), sx * signW * 0.35, y + signH * 0.5, d / 2 + 0.05));
  }
}
