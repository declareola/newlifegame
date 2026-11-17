// client/src/world/materials.js
// Shared, cached PBR materials built on top of the procedural textures.
//
// Materials are shared aggressively — every wall of the same type uses one
// instance — which keeps draw calls low while still giving every surface
// texture, roughness and (for glass/metal) reflections.

import * as THREE from 'three';
import { getTexture, windowGlass, contactShadow } from './textures.js';

const cache = new Map();

/**
 * Materials that should only glow when it is dark.
 *
 * A lit window is warm and bright at midnight and looks like a rendering fault
 * at noon, and an emissive lamp head in daylight is a white ball hanging off a
 * pole. Each entry keeps the strength it should have in full day and in full
 * night; `setNightFactor` interpolates between them as the sun sets, so the city
 * lights up gradually instead of switching on.
 *
 * @type {Array<{material: THREE.Material, day: number, night: number}>}
 */
const nightEmissive = [];

/** How dark it is, 0 (daylight) → 1 (night). Driven by render/NightLights.js. */
let nightFactor = 0;

/**
 * Register a material whose emissive strength follows the daylight.
 * @param {THREE.Material} material
 * @param {{day?:number, night?:number}} [o] emissive intensity at each extreme
 */
export function registerNightEmissive(material, { day = 0, night = 1 } = {}) {
  if (!material || !('emissiveIntensity' in material)) return material;
  nightEmissive.push({ material, day, night });
  material.emissiveIntensity = day + (night - day) * nightFactor;
  return material;
}

/**
 * How lit the city is, 0 → 1. Called by NightLights every frame with an eased
 * value, so nothing here has to know about clocks or sun angles.
 * @param {number} factor
 */
export function setNightFactor(factor) {
  const f = Math.min(1, Math.max(0, Number.isFinite(factor) ? factor : 0));
  if (Math.abs(f - nightFactor) < 0.0005) return nightFactor;
  nightFactor = f;
  for (const entry of nightEmissive) {
    entry.material.emissiveIntensity = entry.day + (entry.night - entry.day) * f;
  }
  return nightFactor;
}

/** The current night factor (0 day → 1 night). */
export function getNightFactor() {
  return nightFactor;
}

function make(key, factory) {
  if (!cache.has(key)) {
    const mat = factory();
    // three r160 has no scene.environmentIntensity, so the environment map's
    // strength is set per material. 0.6 keeps PBR reflections readable
    // without washing out the paint and plaster colours.
    if (mat && mat.isMeshStandardMaterial) mat.envMapIntensity = 0.6;
    cache.set(key, mat);
  }
  return cache.get(key);
}

/** Standard textured surface. */
function surface(key, textureName, { roughness = 0.9, metalness = 0, repeat, color = 0xffffff } = {}) {
  return make(key, () => new THREE.MeshStandardMaterial({
    map: getTexture(textureName, { repeat }),
    color,
    roughness,
    metalness,
  }));
}

export const materials = {
  setNightFactor,
  getNightFactor,
  registerNightEmissive,

  // ── Ground ────────────────────────────────────────────────
  grass: () => surface('grass', 'grass', { roughness: 1, repeat: 26 }),
  /** Ground plane scale: a 600-unit plane needs many more tiles than a park. */
  grassLarge: () => surface('grassLarge', 'grass', { roughness: 1, repeat: 90 }),
  asphalt: () => surface('asphalt', 'asphalt', { roughness: 0.95, repeat: 12 }),
  // A grey tint over the paving photograph: pavements and kerbs in Lagos are
  // concrete, and the raw photo's warm beige reads as timber decking once it is
  // tiled up a 3 m median.
  concreteGround: () => surface('concreteGround', 'concrete', { roughness: 0.9, repeat: 8, color: 0xc6ccd2 }),
  sand: () => surface('sand', 'sand', { roughness: 1, repeat: 14 }),

  // ── Building exteriors ────────────────────────────────────
  wallPlaster: () => surface('wallPlaster', 'wallPlaster', { roughness: 0.85, repeat: 3 }),
  wallPlasterWarm: () => make('wallPlasterWarm', () => new THREE.MeshStandardMaterial({
    map: getTexture('wallPlaster', { repeat: 3 }),
    color: 0xf0d9b5,
    roughness: 0.85,
  })),
  wallBrick: () => surface('wallBrick', 'wallBrick', { roughness: 0.92, repeat: 2 }),
  wallConcretePanel: () => surface('wallConcretePanel', 'wallConcretePanel', { roughness: 0.88, repeat: 4 }),
  roofShingle: () => surface('roofShingle', 'roofShingle', { roughness: 0.85, repeat: 5 }),
  roofRust: () => surface('roofRust', 'roofRust', { roughness: 0.8, metalness: 0.35, repeat: 4 }),

  // ── Interiors ─────────────────────────────────────────────
  floorTile: () => surface('floorTile', 'floorTile', { roughness: 0.35, repeat: 5 }),
  floorWood: () => surface('floorWood', 'floorWood', { roughness: 0.55, repeat: 4 }),
  carpet: () => surface('carpet', 'carpet', { roughness: 1, repeat: 6 }),
  tileBathroom: () => surface('tileBathroom', 'tileBathroom', { roughness: 0.25, repeat: 6 }),
  interiorWall: () => make('interiorWall', () => new THREE.MeshStandardMaterial({
    map: getTexture('wallPlaster', { repeat: 2 }),
    color: 0xf2ede4,
    roughness: 0.95,
  })),
  ceiling: () => make('ceiling', () => new THREE.MeshStandardMaterial({
    color: 0xf6f4f0,
    roughness: 1,
  })),

  // ── Glass & metal ─────────────────────────────────────────
  /** Window glass: reflective, slightly transparent, with a sky gradient. */
  glass: () => make('glass', () => new THREE.MeshStandardMaterial({
    map: windowGlass(),
    color: 0xbfe0f5,
    metalness: 0.65,
    roughness: 0.12,
    transparent: true,
    opacity: 0.92,
  })),
  /** Night-time lit window — emissive so it glows. */
  glassLit: () => make('glassLit', () => registerNightEmissive(
    new THREE.MeshStandardMaterial({
      map: windowGlass(),
      color: 0xffd9a0,
      emissive: 0xffb347,
      emissiveIntensity: 0,
      metalness: 0.4,
      roughness: 0.25,
    }),
    // At noon a lit window is a slightly warm pane; after dark it is a lamp.
    { day: 0.06, night: 1.25 },
  )),
  metalDark: () => make('metalDark', () => new THREE.MeshStandardMaterial({
    color: 0x3a3f45, metalness: 0.85, roughness: 0.35,
  })),
  metalLight: () => make('metalLight', () => new THREE.MeshStandardMaterial({
    color: 0xb8bfc6, metalness: 0.9, roughness: 0.28,
  })),
  chrome: () => make('chrome', () => new THREE.MeshStandardMaterial({
    color: 0xdfe6ec, metalness: 1, roughness: 0.1,
  })),

  // ── Generic painted surfaces ──────────────────────────────
  paint: (hex) => make(`paint:${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.6, metalness: 0.05,
  })),
  matte: (hex) => make(`matte:${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.95,
  })),
  glow: (hex) => make(`glow:${hex}`, () => registerNightEmissive(
    new THREE.MeshStandardMaterial({
      color: hex, emissive: hex, emissiveIntensity: 1.4, roughness: 0.4,
    }),
    { day: 0.5, night: 2.0 },
  )),

  // ── Furniture fabrics ─────────────────────────────────────
  fabric: (hex) => make(`fabric:${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 1, metalness: 0,
  })),
  leather: (hex) => make(`leather:${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.45, metalness: 0.08,
  })),
  wood: (hex = 0x9c6b3f) => make(`wood:${hex}`, () => new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.7, metalness: 0.02,
  })),

  // ── Nature ────────────────────────────────────────────────
  trunk: () => make('trunk', () => new THREE.MeshStandardMaterial({
    color: 0x6b4f35, roughness: 1,
  })),
  leaf: () => make('leaf', () => new THREE.MeshStandardMaterial({
    color: 0x3f8b3a, roughness: 0.95,
  })),
  leafDark: () => make('leafDark', () => new THREE.MeshStandardMaterial({
    color: 0x2d6b2b, roughness: 0.95,
  })),

  // ── Water ─────────────────────────────────────────────────
  water: () => make('water', () => new THREE.MeshStandardMaterial({
    map: getTexture('waterSurface', { repeat: 8 }),
    color: 0x7fd4f0,
    metalness: 0.5,
    roughness: 0.08,
    transparent: true,
    opacity: 0.88,
  })),

  // ── Contact shadow decal ──────────────────────────────────
  contactShadow: () => make('contactShadowMat', () => new THREE.MeshBasicMaterial({
    map: contactShadow(),
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  })),
};

/** Clear the material cache (used on teardown). */
export function disposeMaterials() {
  for (const mat of cache.values()) mat.dispose();
  cache.clear();
}
