// client/src/assets/installAssets.js
// Wire a loaded AssetLibrary into the systems that can use real data.
//
// One call, before the city is built, and everything downstream — materials,
// sky, cars, trees — picks up the real asset if it exists. Each function is
// independent and returns what it installed, so the debug panel can show
// exactly which parts of the world are real and which are still primitives.

import * as THREE from 'three';
import { hiaceParts, tricycleParts, motorcycleParts } from '../world/vehicleParts.js';
import { registerRealTexture } from '../world/textures.js';
import { retileWorld, METRES_PER_TILE } from '../world/retile.js';

/**
 * Photographic surfaces for the ground, roads, walls and interiors.
 * The names match the existing generators, so `materials.asphalt()` and friends
 * keep working with no changes at their call sites.
 */
export function installSurfaceTextures(assets) {
  const installed = [];
  const map = [
    ['asphalt', 'asphalt', { aniso: 8 }],
    ['grass', 'grass', { aniso: 4 }],
    ['grassLarge', 'grass', { aniso: 4 }],
    ['concrete', 'paving', { aniso: 4 }],
    ['sand', 'paving', { aniso: 2 }],
    ['wallPlaster', 'plaster', { aniso: 4 }],
    ['wallConcretePanel', 'facade', { aniso: 4 }],
    ['wallBrick', 'plaster', { aniso: 4 }],
    ['floorWood', 'wood', { aniso: 4 }],
    ['floorTile', 'paving', { aniso: 4 }],
  ];

  for (const [generatorName, assetName, { aniso }] of map) {
    if (!assets.textures.has(assetName)) continue;
    const metresPerTile = METRES_PER_TILE[assetName] || 0;
    const ok = registerRealTexture(generatorName, ({ repeat = 1 }) => (
      assets.texture(assetName, { repeat, aniso, metresPerTile })
    ));
    if (ok) installed.push(generatorName);
  }
  return installed;
}

/**
 * Re-tile every photographic surface under a root, in world space, at a real
 * physical scale. Call once after the city is built and again after each
 * interior, so a 140 m avenue and a 3 m bathroom wall both get sane tiles.
 */
export function retile(root) {
  try {
    return retileWorld(root);
  } catch (err) {
    console.warn('[assets] re-tiling failed; keeping authored UVs', err);
    return { retiled: 0, skipped: 0, tiles: {} };
  }
}

/**
 * Swap the procedural Sky shader for a real photograph of a sky.
 *
 * Done by handing SkyEnvironment an equirectangular texture: it converts the
 * photograph into an environment map (PMREM) so reflections and ambient light
 * come from the actual sky, and uses it as the backdrop. The procedural path
 * stays as the fallback and is used at night, where the day photograph would be
 * a lie.
 *
 * @param {object} skyEnv  SkyEnvironment instance
 * @param {AssetLibrary} assets
 * @returns {string[]} installed sky names
 */
export function installRealSky(skyEnv, assets) {
  const installed = [];
  if (!skyEnv || typeof skyEnv.setEquirect !== 'function') return installed;
  for (const name of ['sky_day', 'sky_dusk', 'sky_night']) {
    const tex = assets.hdri(name);
    if (!tex) continue;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    if (skyEnv.setEquirect(name, tex)) installed.push(name);
  }
  return installed;
}

/**
 * Two jobs in one pass:
 *   · real vehicle models for the kinds that have one
 *   · real street furniture along the pavements
 *
 * @returns {{vehicles: string[], props: string[]}}
 */
export function installStreetAssets(assets, { traffic = null, scene = null } = {}) {
  const vehicles = [];
  const props = [];

  if (traffic && typeof traffic.useModels === 'function') {
    // The Kenney kit has saloons, SUVs and a yellow taxi — use them.
    const candidates = {
      sedan: 'car.sedan',
      suv: 'car.suv',
      taxi: 'car.taxi',
    };
    // The three vehicles that make a Lagos street a Lagos street have no CC0
    // model that looks like them (a Hiace minibus, a keke NAPEP, an okada), so
    // they are built part by part in world/vehicleParts.js — real proportions,
    // real glazing, one instanced draw call per part for the whole fleet.
    const map = {};
    for (const [kind, modelName] of Object.entries(candidates)) {
      if (!assets.hasModel(modelName)) continue;
      map[kind] = modelName;
      vehicles.push(`${kind}→${modelName}`);
    }
    // White base paint: the fleet supplies each car's colour via instanceColor.
    const fleetColour = 0xffffff;
    map.hiace = { parts: hiaceParts(fleetColour, 0x7f8790), size: { x: 1.9, y: 2.2, z: 5.3 } };
    map.tricycle = { parts: tricycleParts(fleetColour, 0x2e8b57), size: { x: 1.35, y: 1.6, z: 2.7 } };
    map.motorcycle = { parts: motorcycleParts(fleetColour), size: { x: 0.62, y: 1.1, z: 2.0 } };
    vehicles.push('hiace→18-seater', 'tricycle→keke', 'motorcycle→okada');
    if (Object.keys(map).length) traffic.useModels(map, assets);
  }

  return { vehicles, props };
}

/**
 * Real trees. Given a template name, returns a factory the tree scatterer can
 * call, or null when the model is missing.
 */
export function treeModels(assets) {
  if (!assets) return null;
  const names = ['tree.default', 'tree.pine', 'tree.thin'].filter((n) => assets.hasModel(n));
  if (!names.length) return null;
  return {
    names,
    /** @param {number} i deterministic pick @param {number} height metres */
    create(i, height) {
      const name = names[i % names.length];
      return assets.model(name, { height });
    },
  };
}
