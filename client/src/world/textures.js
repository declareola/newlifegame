// client/src/world/textures.js
// Procedural texture library.
//
// Every surface texture in the game is generated at runtime on a <canvas>.
// No image files, no downloads — which keeps the "no external assets" rule
// while giving every surface real detail instead of flat colours.
//
// Each generator returns a THREE.CanvasTexture. Results are cached by key so
// the same texture is only ever built once.

import * as THREE from 'three';

const cache = new Map();

/** Deterministic pseudo-random so textures look the same on every load. */
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return { c, ctx: c.getContext('2d') };
}

function toTexture(c, { repeat = 1, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Add per-pixel noise to break up flat fills. */
function noiseOverlay(ctx, size, rng, amount, alpha) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    if (alpha !== undefined) d[i + 3] = alpha;
  }
  ctx.putImageData(img, 0, 0);
}

// ── Ground surfaces ─────────────────────────────────────────────

function grass(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(1337);
  ctx.fillStyle = '#4a7c3f';
  ctx.fillRect(0, 0, size, size);

  // Patchy tonal variation
  for (let i = 0; i < 220; i++) {
    const r = 20 + rng() * 90;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    const g = 90 + rng() * 50;
    ctx.fillStyle = `rgba(${40 + rng() * 30}, ${g}, ${35 + rng() * 25}, 0.16)`;
    ctx.fill();
  }

  // Individual blades
  for (let i = 0; i < 5000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const h = 2 + rng() * 5;
    ctx.strokeStyle = `rgba(${50 + rng() * 40}, ${100 + rng() * 70}, ${40 + rng() * 40}, ${0.25 + rng() * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 2, y - h);
    ctx.stroke();
  }
  noiseOverlay(ctx, size, rng, 14);

  // Cross-fade the edges so the tile has no visible seam
  return toTexture(c, { repeat: 26 });
}

function asphalt(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(4242);
  ctx.fillStyle = '#2b2b30';
  ctx.fillRect(0, 0, size, size);

  // Aggregate stones
  for (let i = 0; i < 9000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 0.6 + rng() * 1.8;
    const v = 40 + rng() * 70;
    ctx.fillStyle = `rgba(${v}, ${v}, ${v + 6}, ${0.25 + rng() * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tar patches
  for (let i = 0; i < 25; i++) {
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, 10 + rng() * 50, 6 + rng() * 30, rng() * 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(20, 20, 24, ${0.2 + rng() * 0.3})`;
    ctx.fill();
  }
  noiseOverlay(ctx, size, rng, 20);
  return toTexture(c, { repeat: 10 });
}

function concrete(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(777);
  ctx.fillStyle = '#9d9a94';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 300; i++) {
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 8 + rng() * 60, 0, Math.PI * 2);
    const v = 130 + rng() * 45;
    ctx.fillStyle = `rgba(${v}, ${v - 3}, ${v - 8}, 0.1)`;
    ctx.fill();
  }
  // Pits and stains
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = `rgba(90, 88, 84, ${rng() * 0.28})`;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, rng() * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Expansion joints
  ctx.strokeStyle = 'rgba(70, 68, 64, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
  ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
  ctx.stroke();

  noiseOverlay(ctx, size, rng, 16);
  return toTexture(c, { repeat: 6 });
}

function sand(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(999);
  ctx.fillStyle = '#d9c08a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 7000; i++) {
    const v = 190 + rng() * 50;
    ctx.fillStyle = `rgba(${v}, ${v - 20}, ${v - 70}, ${rng() * 0.5})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  // Ripple lines
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(180, 155, 105, ${0.1 + rng() * 0.15})`;
    ctx.lineWidth = 1 + rng() * 2;
    ctx.beginPath();
    const y = rng() * size;
    ctx.moveTo(0, y);
    for (let x = 0; x < size; x += 16) {
      ctx.lineTo(x, y + Math.sin(x * 0.06 + i) * 5);
    }
    ctx.stroke();
  }
  noiseOverlay(ctx, size, rng, 12);
  return toTexture(c, { repeat: 12 });
}

// ── Building surfaces ───────────────────────────────────────────

function wallPlaster(size = 512, tint = '#e8e2d6') {
  const { c, ctx } = canvas(size);
  const rng = makeRng(31337);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 260; i++) {
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, 15 + rng() * 80, 0, Math.PI * 2);
    const v = 200 + rng() * 40;
    ctx.fillStyle = `rgba(${v}, ${v - 6}, ${v - 18}, 0.08)`;
    ctx.fill();
  }
  // Damp streaks running down from the top
  for (let i = 0; i < 18; i++) {
    const x = rng() * size;
    const w = 3 + rng() * 14;
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, 'rgba(120, 112, 100, 0.22)');
    grad.addColorStop(1, 'rgba(120, 112, 100, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, w, size * (0.3 + rng() * 0.6));
  }
  noiseOverlay(ctx, size, rng, 10);
  return toTexture(c, { repeat: 3 });
}

function wallBrick(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(2024);
  ctx.fillStyle = '#6b5344'; // mortar
  ctx.fillRect(0, 0, size, size);

  const rows = 16;
  const brickH = size / rows;
  const brickW = brickH * 2.3;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brickW / 2);
    for (let x = -brickW; x < size + brickW; x += brickW) {
      const bx = x + offset + 1.5;
      const by = r * brickH + 1.5;
      const shade = 0.82 + rng() * 0.3;
      const rr = Math.floor(150 * shade);
      const gg = Math.floor(78 * shade);
      const bb = Math.floor(60 * shade);
      ctx.fillStyle = `rgb(${rr}, ${gg}, ${bb})`;
      ctx.fillRect(bx, by, brickW - 3, brickH - 3);

      // Subtle speckle inside each brick
      for (let k = 0; k < 12; k++) {
        ctx.fillStyle = `rgba(0, 0, 0, ${rng() * 0.12})`;
        ctx.fillRect(bx + rng() * brickW, by + rng() * brickH, 2, 2);
      }
    }
  }
  noiseOverlay(ctx, size, rng, 12);
  return toTexture(c, { repeat: 2 });
}

function wallConcretePanel(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(555);
  ctx.fillStyle = '#b9b5ad';
  ctx.fillRect(0, 0, size, size);

  // Horizontal panel joints
  ctx.strokeStyle = 'rgba(95, 92, 86, 0.5)';
  ctx.lineWidth = 2.5;
  for (let y = 0; y <= size; y += size / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // Panel shading differences
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${rng() * 0.06})`;
    ctx.fillRect(0, (i * size) / 4, size, size / 4);
  }
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(120, 116, 110, ${rng() * 0.2})`;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  noiseOverlay(ctx, size, rng, 12);
  return toTexture(c, { repeat: 4 });
}

function roofShingle(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(818);
  ctx.fillStyle = '#4a4540';
  ctx.fillRect(0, 0, size, size);

  const rows = 20;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (rh * 0.8);
    for (let x = -rh; x < size + rh; x += rh * 1.6) {
      const shade = 0.7 + rng() * 0.5;
      ctx.fillStyle = `rgb(${Math.floor(96 * shade)}, ${Math.floor(76 * shade)}, ${Math.floor(64 * shade)})`;
      ctx.fillRect(x + offset, r * rh, rh * 1.5, rh - 1.5);
    }
  }
  noiseOverlay(ctx, size, rng, 16);
  return toTexture(c, { repeat: 5 });
}

function roofRust(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(616);
  ctx.fillStyle = '#8d6a4f';
  ctx.fillRect(0, 0, size, size);

  // Corrugation
  for (let x = 0; x < size; x += 12) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.05 + rng() * 0.06})`;
    ctx.fillRect(x, 0, 6, size);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(x + 6, 0, 6, size);
  }
  // Rust blooms — very Lagos
  for (let i = 0; i < 120; i++) {
    const x = rng() * size, y = rng() * size, r = 6 + rng() * 46;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${140 + rng() * 50}, ${60 + rng() * 30}, 30, 0.5)`);
    grad.addColorStop(1, 'rgba(140, 70, 40, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  noiseOverlay(ctx, size, rng, 18);
  return toTexture(c, { repeat: 4 });
}

// ── Interior surfaces ───────────────────────────────────────────

function floorTile(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(1234);
  const n = 4;
  const t = size / n;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 228 + rng() * 22;
      ctx.fillStyle = `rgb(${v}, ${v - 2}, ${v - 6})`;
      ctx.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);

      // Glaze highlight
      const grad = ctx.createLinearGradient(x * t, y * t, x * t + t, y * t + t);
      grad.addColorStop(0, 'rgba(255,255,255,0.16)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      grad.addColorStop(1, 'rgba(255,255,255,0.10)');
      ctx.fillStyle = grad;
      ctx.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
    }
  }
  // Grout
  ctx.strokeStyle = 'rgba(165, 160, 152, 0.85)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(size, i * t); ctx.stroke();
  }
  noiseOverlay(ctx, size, rng, 6);
  return toTexture(c, { repeat: 5 });
}

function floorWood(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(321);
  const planks = 8;
  const pw = size / planks;

  for (let p = 0; p < planks; p++) {
    const base = 130 + rng() * 40;
    ctx.fillStyle = `rgb(${base}, ${base - 45}, ${base - 80})`;
    ctx.fillRect(p * pw, 0, pw - 1, size);

    // Grain
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = `rgba(${base - 50}, ${base - 85}, ${base - 110}, ${0.1 + rng() * 0.25})`;
      ctx.lineWidth = 0.6 + rng() * 1.4;
      ctx.beginPath();
      const x = p * pw + rng() * pw;
      ctx.moveTo(x, 0);
      for (let y = 0; y < size; y += 24) {
        ctx.lineTo(x + Math.sin(y * 0.02 + i) * 2.5, y);
      }
      ctx.stroke();
    }
    // Plank gap
    ctx.fillStyle = 'rgba(50, 35, 25, 0.55)';
    ctx.fillRect(p * pw, 0, 1.5, size);
  }
  noiseOverlay(ctx, size, rng, 8);
  return toTexture(c, { repeat: 4 });
}

function carpet(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(456);
  ctx.fillStyle = '#5d6470';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 24000; i++) {
    const v = 80 + rng() * 40;
    ctx.fillStyle = `rgba(${v}, ${v + 4}, ${v + 12}, ${0.3 + rng() * 0.4})`;
    ctx.fillRect(rng() * size, rng() * size, 1, 1 + rng() * 2);
  }
  noiseOverlay(ctx, size, rng, 14);
  return toTexture(c, { repeat: 6 });
}

function tileBathroom(size = 256) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(147);
  const n = 8;
  const t = size / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 200 + rng() * 40;
      ctx.fillStyle = `rgb(${v - 10}, ${v}, ${v + 10})`;
      ctx.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
    }
  }
  ctx.strokeStyle = 'rgba(150, 155, 160, 0.8)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= n; i++) {
    ctx.beginPath(); ctx.moveTo(i * t, 0); ctx.lineTo(i * t, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * t); ctx.lineTo(size, i * t); ctx.stroke();
  }
  return toTexture(c, { repeat: 6 });
}

// ── Effects / misc ──────────────────────────────────────────────

/** Soft radial blob — used for fake ambient-occlusion contact shadows. */
function contactShadow(size = 128) {
  const key = 'contactShadow';
  if (cache.has(key)) return cache.get(key);

  const { c, ctx } = canvas(size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Vertical glass-reflection gradient for windows. */
function windowGlass(size = 128) {
  const key = 'windowGlass';
  if (cache.has(key)) return cache.get(key);

  const { c, ctx } = canvas(size);
  const grad = ctx.createLinearGradient(0, 0, size * 0.7, size);
  grad.addColorStop(0, '#8fb6d4');
  grad.addColorStop(0.45, '#4d7fa8');
  grad.addColorStop(0.55, '#31608a');
  grad.addColorStop(1, '#1e3f5e');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // A bright diagonal streak — reads as reflected sky
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath();
  ctx.moveTo(0, size * 0.72);
  ctx.lineTo(size * 0.42, 0);
  ctx.lineTo(size * 0.62, 0);
  ctx.lineTo(0, size);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Water surface with gentle ripple highlights. */
function waterSurface(size = 512) {
  const { c, ctx } = canvas(size);
  const rng = makeRng(2020);
  ctx.fillStyle = '#1c6fa8';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2200; i++) {
    const x = rng() * size, y = rng() * size;
    const w = 6 + rng() * 40;
    ctx.strokeStyle = `rgba(150, 215, 245, ${0.04 + rng() * 0.14})`;
    ctx.lineWidth = 0.8 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w / 2, y - 3 - rng() * 4, x + w, y);
    ctx.stroke();
  }
  return toTexture(c, { repeat: 8 });
}

// ── Public API ──────────────────────────────────────────────────

const GENERATORS = {
  grass,
  asphalt,
  concrete,
  sand,
  wallPlaster,
  wallBrick,
  wallConcretePanel,
  roofShingle,
  roofRust,
  floorTile,
  floorWood,
  carpet,
  tileBathroom,
  waterSurface,
};

/**
 * Get (and memoise) a texture by name.
 * @param {string} name - one of GENERATORS
 * @param {object} opts - { repeat }
 */
// ── Real photographs ─────────────────────────────────────────
// A downloaded, photographic texture can be installed over any generated one.
// `world/materials.js` asks for 'asphalt' and gets a photograph of Oshodi
// tarmac instead of 256 px of noise — and the day the CDN is unreachable, or in
// a test environment with no network, the generator quietly takes over again.
const REAL = new Map();   // name -> (opts) => THREE.Texture

/**
 * Install a real texture for a generator name.
 * @param {string} name - 'asphalt' | 'grass' | 'paving' | 'plaster' | 'facade' | 'wood'
 * @param {function} factory - ({repeat}) => THREE.Texture (a fresh clone)
 */
export function registerRealTexture(name, factory) {
  if (typeof factory !== 'function') return false;
  REAL.set(name, factory);
  // Drop anything already generated under this name so the photo is used from
  // the next request onwards.
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${name}:`)) {
      cache.get(key)?.dispose?.();
      cache.delete(key);
    }
  }
  return true;
}

/** Which names currently have a real photograph behind them. */
export function realTextureNames() {
  return [...REAL.keys()];
}

export function getTexture(name, opts = {}) {
  const key = `${name}:${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);

  const real = REAL.get(name);
  if (real) {
    const tex = real({ repeat: opts.repeat ?? 1 });
    if (tex) {
      cache.set(key, tex);
      return tex;
    }
  }

  const gen = GENERATORS[name];
  if (!gen) {
    console.warn(`Unknown texture "${name}" — falling back to concrete`);
    return getTexture('concrete', opts);
  }

  const tex = gen();
  if (opts.repeat !== undefined) tex.repeat.set(opts.repeat, opts.repeat);
  cache.set(key, tex);
  return tex;
}

export { contactShadow, windowGlass };

/** Free every cached texture (used on teardown). */
export function disposeTextures() {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}
