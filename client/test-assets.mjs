// client/test-assets.mjs
// The real-asset pipeline, tested without a network and without a browser.
//
// Two things matter here and neither is "do the files exist":
//
//   1. The fallback. Every consumer of the asset library must behave exactly as
//      it did before the assets existed when they are missing. A slow CDN, a
//      failed download or a user who deleted public/assets must produce the old
//      procedural world — not a crash, not a hole, not six missing cars.
//
//   2. The wiring. When assets *are* present, the trees, cars, lamps and
//      furniture must actually switch over — and the traffic system's instance
//      bookkeeping has to stay correct, because a car with a real model must not
//      also draw a box, and an index left uncompacted silently draws a car at
//      the origin.

// Canvas stub for materials.js (same approach as test-interiors.mjs).
const ctxStub = new Proxy({}, {
  get(_, prop) {
    if (prop === 'canvas') return { width: 256, height: 256 };
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
      return () => ({ addColorStop() {} });
    }
    if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (prop === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set() { return true; },
});
globalThis.document = {
  createElement: () => ({ width: 256, height: 256, style: {}, getContext: () => ctxStub, toDataURL: () => 'data:,' }),
};

import * as THREE from 'three';
import { AssetLibrary, MODEL_CATALOGUE, TEXTURE_CATALOGUE, HDRI_CATALOGUE } from './src/assets/AssetLibrary.js';
import { installSurfaceTextures, installRealSky, installStreetAssets, retile } from './src/assets/installAssets.js';
import { getTexture, realTextureNames } from './src/world/textures.js';
import { createTrees } from './src/world/Trees.js';
import { materials } from './src/world/materials.js';
import { TrafficSystem, CAR_KINDS } from './src/world/TrafficSystem.js';

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Fakes ────────────────────────────────────────────────────
/** A two-box glTF stand-in: body + a smaller part, sharing one material. */
function fakeGLTF({ height = 1, width = 1, depth = 1 } = {}) {
  const material = new THREE.MeshStandardMaterial({ name: 'colormap' });
  material.map = null;
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  body.position.y = height / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, height * 0.3, depth * 0.5), material);
  roof.position.y = height + height * 0.15;
  const scene = new THREE.Group();
  scene.add(body, roof);
  return { scene };
}

function fakeTexture(size = 4) {
  const data = new Uint8Array(size * size * 4).fill(128);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

/** An AssetLibrary whose loaders answer instantly from memory. */
function makeLibrary({ fail = [] } = {}) {
  const shouldFail = (path) => fail.some((f) => path.includes(f));
  const loaders = {
    gltf: async (path) => {
      if (shouldFail(path)) throw new Error('404');
      const depth = path.includes('/car/') ? 4 : 1;
      return fakeGLTF({ height: 1.2, width: 1, depth });
    },
    texture: async (path) => {
      if (shouldFail(path)) throw new Error('404');
      return fakeTexture();
    },
    hdr: async (path) => {
      if (shouldFail(path)) throw new Error('404');
      const tex = fakeTexture(8);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return tex;
    },
  };
  return new AssetLibrary({ loaders, timeoutMs: 2000 });
}

// ── Catalogue ────────────────────────────────────────────────
console.log('[Catalogue]');
check('Every model entry names a kit and a file',
  Object.values(MODEL_CATALOGUE).every((e) => e.kit && e.file.endsWith('.glb')));
check('Six surface photographs are catalogued', Object.keys(TEXTURE_CATALOGUE).length === 6);
check('Three skies are catalogued', Object.keys(HDRI_CATALOGUE).length === 3);

// ── Loading ──────────────────────────────────────────────────
console.log('\n[Loading]');
{
  const lib = makeLibrary();
  const progress = [];
  await lib.load((done, total) => progress.push(done / total));
  const s = lib.summary;
  check('Everything loads', s.models === Object.keys(MODEL_CATALOGUE).length
    && s.textures === 6 && s.skies === 3, `${s.models} models, ${s.textures} textures, ${s.skies} skies`);
  check('Progress is reported', progress.length === s.models + s.textures + s.skies);
  check('Nothing failed', s.failed.length === 0);

  const car = lib.model('car.sedan');
  check('A model is returned as a clone', !!car && car !== lib.models.get('car.sedan'));
  check('Models are merged per material — one mesh for the body and the roof',
    lib.models.get('car.sedan').children[0].children.length === 1,
    `${lib.models.get('car.sedan').children[0].children.length} mesh(es)`);
  check('Model size is recorded', !!lib.modelSize('car.sedan').y);
  check('Instance parts are baked into template space',
    lib.instanceParts('car.sedan').length === 1
    && lib.instanceParts('car.sedan')[0].geometry.boundingBox.min.y >= -0.01);

  const tex = lib.texture('asphalt', { repeat: 3, metresPerTile: 5.5 });
  check('Textures are marked real, with their physical size',
    tex.userData.real === true && tex.userData.metresPerTile === 5.5);
  check('Texture repeat is applied', tex.repeat.x === 3);
  check('Textures are sRGB', tex.colorSpace === THREE.SRGBColorSpace);
  check('Skies are exposed', !!lib.hdri('sky_day'));
}

console.log('\n[A missing asset is a fallback, not a crash]');
{
  const lib = makeLibrary({ fail: ['/models/car/', '/textures/'] });
  await lib.load();
  const s = lib.summary;
  check('The load resolves anyway', lib.loaded === true, `${s.ms} ms`);
  check('Failures are recorded', s.failed.length > 0, `${s.failed.length} failed`);
  check('Missing models report unavailable', lib.hasModel('car.sedan') === false);
  check('Missing models return null', lib.model('car.sedan') === null);
  check('Missing textures return null', lib.texture('asphalt') === null);
  check('Skies still loaded', lib.hdris.size === 3);
}

console.log('\n[A dead CDN does not hang the boot]');
{
  const lib = new AssetLibrary({
    timeoutMs: 120,
    loaders: {
      gltf: () => new Promise(() => {}),      // never settles
      texture: () => new Promise(() => {}),
      hdr: () => new Promise(() => {}),
    },
  });
  const t0 = Date.now();
  await lib.load();
  const ms = Date.now() - t0;
  check('load() gives up at the timeout', ms < 2000 && lib.loaded === true, `${ms} ms`);
}

// ── Wiring ───────────────────────────────────────────────────
console.log('\n[Surface textures]');
{
  const lib = makeLibrary();
  await lib.load();
  const installed = installSurfaceTextures(lib);
  check('Photographs install over the generated surfaces', installed.length === 10, installed.join(', '));
  const asphalt = getTexture('asphalt', { repeat: 4 });
  check('getTexture returns the photograph', asphalt.userData?.real === true);
  check('The real name is recorded for re-tiling', asphalt.userData.realName === 'asphalt');
  check('registerRealTexture invalidates the old cache',
    realTextureNames().includes('asphalt'));
}

console.log('\n[Retiling]');
{
  const lib = makeLibrary();
  await lib.load();
  installSurfaceTextures(lib);
  const root = new THREE.Group();
  // A 140 m × 12 m road: with authored UVs this is one stretched tile.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(140, 12), materials.asphalt());
  road.rotation.x = -Math.PI / 2;
  root.add(road);
  const stats = retile(root);
  const uv = road.geometry.attributes.uv;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    min = Math.min(min, uv.getX(i));
    max = Math.max(max, uv.getX(i));
  }
  const metresAcross = (max - min) * 5.5;
  check('World-space UVs cover the real length of the road',
    Math.abs(metresAcross - 140) < 1.5, `${metresAcross.toFixed(1)} m across the UV range`);
  check('The retile pass reports what it did', stats.retiled === 1, JSON.stringify(stats.tiles));
  check('Material repeat is reset so it does not double up',
    materials.asphalt().map.repeat.x === 1);
}

console.log('\n[Real sky]');
{
  const lib = makeLibrary();
  await lib.load();
  // Minimal stand-in for SkyEnvironment's contract.
  const skyEnv = {
    skies: new Map(),
    setEquirect(name, tex) { this.skies.set(name, tex); return true; },
  };
  const installed = installRealSky(skyEnv, lib);
  check('All three skies install', installed.length === 3, installed.join(', '));
  check('Skies are equirectangular', skyEnv.skies.get('sky_day').mapping === THREE.EquirectangularReflectionMapping);

  const bare = { skies: new Map() };
  check('A SkyEnvironment without setEquirect is left alone', installRealSky(bare, lib).length === 0);
}

console.log('\n[Traffic models]');
{
  const lib = makeLibrary();
  await lib.load();
  const traffic = new TrafficSystem({ parkedCount: 24, movingCount: 12 });
  const before = traffic.getStats();
  const ok = installStreetAssets(lib, { traffic }).vehicles.length > 0;
  check('Real cars install', ok);
  // 3 CC0 Kenney models + 3 part-built Lagos vehicles (Hiace, tricycle, okada)
  check('Model instanced meshes exist for each swapped kind',
    traffic.modelMeshes.size === 6, [...traffic.modelMeshes.keys()].join(', '));

  // Every car must be represented exactly once: either as a box or as a model.
  const all = [...traffic.parked, ...traffic.moving];
  const modelled = all.filter((c) => c._slot.type === 'model').length;
  const prim = all.filter((c) => c._slot.type === 'prim').length;
  check('Every car has exactly one renderer', modelled + prim === all.length,
    `${modelled} modellled, ${prim} primitives, ${all.length} total`);
  check('The Hiace, tricycle and motorbike are part-built, not plain boxes',
    all.filter((c) => ['hiace', 'tricycle', 'motorcycle'].includes(c.kind))
      .every((c) => c._slot.type === 'model'));
  check('No danfo, keke or okada is left on the road',
    all.every((c) => !['danfo', 'keke', 'okada'].includes(c.kind)),
    [...new Set(all.map((c) => c.kind))].join(', '));
  check('Primitive instance counts are compacted',
    traffic.bodyMesh.count === prim && traffic.cabinMesh.count === prim,
    `body ${traffic.bodyMesh.count} / cabin ${traffic.cabinMesh.count} / expected ${prim}`);

  traffic.update(0.016, 1);
  check('The fleet still simulates after the swap',
    all.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z)));
  check('Only known kinds are in the fleet',
    all.every((c) => !!CAR_KINDS[c.kind]));

  const bare = new TrafficSystem({ parkedCount: 12, movingCount: 6 });
  const bareAll = [...bare.parked, ...bare.moving];
  check('Without assets the fleet is all primitives',
    bareAll.length > 0 && bareAll.every((c) => c._slot.type === 'prim')
    && bare.modelMeshes.size === 0 && before.parked > 0);
}

console.log('\n[Real trees]');
{
  const lib = makeLibrary();
  await lib.load();
  const parent = new THREE.Group();
  const trees = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 8, z: 0 }];
  const palms = [{ x: 12, z: 0 }];
  const stats = createTrees(parent, trees, palms, materials, { assets: lib });
  check('Trees come from the nature kit', stats.real === true);
  check('They are instanced', parent.children.every((c) => c.isInstancedMesh),
    `${parent.children.length} instanced meshes`);
  check('Every tree is placed', parent.children
    .filter((c) => c.name.startsWith('tree-real'))
    .reduce((n, c) => n + c.count, 0) === trees.length,
  `${parent.children.filter((c) => c.name.startsWith('tree-real')).length} model meshes`);
  check('Palms are still built', parent.children.some((c) => c.name === 'palm-trunks'));

  const bare = new THREE.Group();
  const bareStats = createTrees(bare, trees, [], materials);
  check('Without assets the procedural trees return', bareStats.real === false);
  check('…and they are still instanced', bare.children.length >= 3);
}

console.log('\n[Furniture]');
{
  const { useFurnitureAssets, hasRealFurniture, plasticChair, bed } = await import('./src/world/furniture.js');
  const lib = makeLibrary();
  await lib.load();
  useFurnitureAssets(lib);
  check('Furniture assets install', hasRealFurniture() === true);
  const chair = plasticChair(0xff0000);
  check('A chair is a real model', chair.name === 'asset');
  // The kit model is 1.56 m tall; asking for a 0.92 m chair scales it down.
  check('It is scaled to the size the caller asked for',
    Math.abs(chair.scale.x * chair.userData.baseHeight - 0.92) < 0.01,
    `${(chair.scale.x * chair.userData.baseHeight).toFixed(2)} m tall`);
  const bedModel = bed(1.6);
  check('A bed is a real model too', bedModel.name === 'asset');
  check('Two calls return two objects', chair !== bedModel);

  useFurnitureAssets(null);
  const procedural = plasticChair(0xff0000);
  check('Switching back restores the primitive chair', procedural.name !== 'asset');
}

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed === 0 ? 0 : 1);
