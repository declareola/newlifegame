// client/src/assets/AssetLibrary.js
// Real-world assets, loaded once, with a fallback for every single one.
//
// Up to this round the game was 100% primitives: every car was three boxes, the
// sky was a shader, the road was a canvas noise texture. That was a deliberate
// constraint, and it is now lifted — but *not* ripped out. This library loads
// genuine CC0 models and photographs, and every consumer still has the
// primitive path it had before. If the network is slow, the files are missing,
// or the browser blocks them, the game looks exactly as it did last round
// instead of showing a hole.
//
// Where things come from
//   skies and surface photographs   Poly Haven  (CC0)
//   cars, trees, street, furniture  Kenney      (CC0, via the shorepine mirror)
//
// Everything is loaded through three's own loaders. Models are merged by
// material on arrival, because a Kenney car is five meshes sharing one palette
// texture and twenty of them would be a hundred draw calls.
//
//   const assets = new AssetLibrary();
//   await assets.load();          // never throws
//   assets.model('car.sedan')     // → THREE.Object3D (a fresh clone) | null
//   assets.texture('asphalt')     // → THREE.Texture | null
//   assets.hdri('sky_day')        // → THREE.Texture (equirectangular) | null

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeByMaterial } from '../world/mergeUtils.js';

const BASE = '/assets';

/**
 * The brightest value a sky photograph may contribute.
 *
 * Poly Haven skies carry a real sun. A physically-correct 1k HDRI peaks around
 * 1e4 in linear light; used directly as `scene.environment` that is a blowtorch,
 * and every surface in the city washes out to white. 8 keeps a blue midday sky
 * blue and still leaves the sun (after bloom) as the brightest thing on screen.
 */
export const MAX_RADIANCE = 8;

/**
 * Decode a Radiance RGBE picture into a linear float equirect texture.
 *
 * Supports both the run-length scanline format (what Poly Haven and every modern
 * HDRI use) and the old flat format.
 *
 * @param {ArrayBuffer} buffer
 * @param {string} [label] used in the error message only
 * @returns {THREE.DataTexture}
 */
export function decodeHDR(buffer, label = 'hdr') {
  const bytes = new Uint8Array(buffer);
  const fail = (why) => { throw new Error(`${label}: ${why}`); };

  // ── Header: text lines until the empty line ──
  let pos = 0;
  const readLine = () => {
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 0x0a) pos++;
    const line = String.fromCharCode(...bytes.subarray(start, pos));
    pos++; // skip \n
    return line.replace(/\r$/, '');
  };

  let format = null;
  for (let guard = 0; guard < 64; guard++) {
    if (pos >= bytes.length) fail('truncated header');
    const line = readLine();
    if (line === '') break;
    if (line.startsWith('FORMAT=')) format = line.slice(7).trim();
  }
  if (format && format !== '32-bit_rle_rgbe') fail(`unsupported format ${format}`);

  // ── Resolution line, e.g. "-Y 512 +X 1024" ──
  const res = readLine();
  const m = res.match(/^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)$/);
  if (!m) fail(`bad resolution line "${res}"`);
  const height = Number(m[2]);
  const width = Number(m[4]);
  if (!width || !height) fail('zero-sized image');

  const pixels = new Uint8Array(width * height * 4);
  const scanline = new Uint8Array(width * 4);

  for (let y = 0; y < height; y++) {
    if (pos + 4 > bytes.length) fail('truncated pixel data');

    // New-style run-length scanline marker.
    const isRLE = bytes[pos] === 2 && bytes[pos + 1] === 2 && (bytes[pos + 2] & 0x80) === 0;
    if (isRLE) {
      const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 4;
      if (len !== width) fail(`scanline length ${len} != width ${width}`);
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          if (pos >= bytes.length) fail('truncated run');
          const count = bytes[pos++];
          if (count > 128) {
            // A run: the next byte repeated (count - 128) times.
            const times = count - 128;
            if (pos >= bytes.length) fail('truncated run value');
            const value = bytes[pos++];
            for (let i = 0; i < times && x < width; i++) scanline[(x++) * 4 + c] = value;
          } else {
            // Literal bytes.
            if (count === 0) fail('zero-length run');
            for (let i = 0; i < count && x < width; i++) {
              if (pos >= bytes.length) fail('truncated literal');
              scanline[(x++) * 4 + c] = bytes[pos++];
            }
          }
        }
      }
    } else {
      // Flat scanline: RGBE quads straight out of the file.
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) scanline[x * 4 + c] = bytes[pos++] ?? 0;
      }
    }

    pixels.set(scanline, y * width * 4);
  }

  // ── RGBE → linear float, clamped ──
  const data = new Float32Array(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 4) {
    const e = pixels[i + 3];
    if (e === 0) {
      data[j] = 0; data[j + 1] = 0; data[j + 2] = 0; data[j + 3] = 1;
      continue;
    }
    // scale = 2^(E-128) / 256
    const scale = Math.pow(2, e - 136);
    for (let c = 0; c < 3; c++) {
      const v = pixels[i + c] * scale;
      data[j + c] = v > MAX_RADIANCE ? MAX_RADIANCE : v;
    }
    data[j + 3] = 1;
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** name → { file, kit } — the model catalogue, matching fetch-assets.sh. */
export const MODEL_CATALOGUE = {
  'car.sedan':      { kit: 'car', file: 'sedan.glb' },
  'car.van':        { kit: 'car', file: 'van.glb' },
  'car.taxi':       { kit: 'car', file: 'taxi.glb' },
  'car.suv':        { kit: 'car', file: 'suv.glb' },
  'car.truck':      { kit: 'car', file: 'truck-flat.glb' },
  'car.hatchback':  { kit: 'car', file: 'hatchback-sports.glb' },
  'car.police':     { kit: 'car', file: 'police.glb' },

  'tree.default':   { kit: 'nature', file: 'tree_default.glb' },
  'tree.pine':      { kit: 'nature', file: 'tree_pineDefaultA.glb' },
  'tree.thin':      { kit: 'nature', file: 'tree_thin.glb' },
  'plant.bush':     { kit: 'nature', file: 'plant_bushLarge.glb' },

  'street.lamp':    { kit: 'street', file: 'light-square.glb' },
  'street.lampCurved': { kit: 'street', file: 'light-curved.glb' },
  'street.barrier':  { kit: 'street', file: 'construction-barrier.glb' },
  'street.cone':     { kit: 'street', file: 'construction-cone.glb' },
  'street.bendBarrier': { kit: 'street', file: 'road-bend-barrier.glb' },

  'furniture.chair':     { kit: 'furniture', file: 'chair.glb' },
  'furniture.chairRound': { kit: 'furniture', file: 'chairRounded.glb' },
  'furniture.chairDesk': { kit: 'furniture', file: 'chairDesk.glb' },
  'furniture.table':     { kit: 'furniture', file: 'table.glb' },
  'furniture.tableRound': { kit: 'furniture', file: 'tableRound.glb' },
  'furniture.desk':      { kit: 'furniture', file: 'desk.glb' },
  'furniture.bed':       { kit: 'furniture', file: 'bedDouble.glb' },
  'furniture.bench':     { kit: 'furniture', file: 'bench.glb' },
  'furniture.bookcase':  { kit: 'furniture', file: 'bookcaseOpen.glb' },
  'furniture.sofa':      { kit: 'furniture', file: 'loungeSofa.glb' },
  'furniture.toilet':    { kit: 'furniture', file: 'toilet.glb' },
  'furniture.sink':      { kit: 'furniture', file: 'kitchenSink.glb' },
  'furniture.cabinet':   { kit: 'furniture', file: 'cabinetBedDrawer.glb' },
  'furniture.stove':     { kit: 'furniture', file: 'kitchenStove.glb' },
};

/** name → file — surface photographs, installed into world/textures.js. */
export const TEXTURE_CATALOGUE = {
  asphalt: 'asphalt.jpg',
  paving: 'paving.jpg',
  grass: 'grass.jpg',
  plaster: 'plaster.jpg',
  facade: 'facade.jpg',
  wood: 'wood.jpg',
};

/** name → file — equirectangular skies, used for the backdrop and the IBL. */
export const HDRI_CATALOGUE = {
  sky_day: 'sky_day.hdr',
  sky_dusk: 'sky_dusk.hdr',
  sky_night: 'sky_night.hdr',
};

export class AssetLibrary {
  /**
   * @param {object} [o]
   * @param {string} [o.base] base URL for the assets folder
   * @param {number} [o.timeoutMs] give up on the whole load after this long
   * @param {object} [o.loaders] inject loaders (tests)
   */
  constructor({ base = BASE, timeoutMs = 20000, loaders = null } = {}) {
    this.base = base.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.loaders = loaders;

    this.models = new Map();      // name → merged template Object3D
    this.textures = new Map();    // name → THREE.Texture
    this.hdris = new Map();       // name → THREE.Texture (equirect)
    this.failed = [];             // names that could not be loaded
    this.loaded = false;
    this.ms = 0;
    this._templates = new Map();

    // Resolves when the current (or next) load has finished. main.js installs
    // real models, textures and skies only once the pipeline is quiet, so a
    // half-loaded library can never be baked into the scene.
    this._settled = null;
    this._resolveSettled = null;
  }

  // ── Loading ────────────────────────────────────────────────

  /**
   * Load everything that is available. Never rejects: a missing file is a
   * fallback, not a crash.
   * @param {function} [onProgress] (done, total) => void
   */
  async load(onProgress = null) {
    this._settled = new Promise((resolve) => { this._resolveSettled = resolve; });
    const started = (globalThis.performance?.now?.() ?? Date.now());
    const jobs = [];

    for (const [name, entry] of Object.entries(MODEL_CATALOGUE)) {
      jobs.push({ name, path: `${this.base}/models/${entry.kit}/${entry.file}`, kind: 'model' });
    }
    for (const [name, file] of Object.entries(TEXTURE_CATALOGUE)) {
      jobs.push({ name, path: `${this.base}/textures/${file}`, kind: 'texture' });
    }
    for (const [name, file] of Object.entries(HDRI_CATALOGUE)) {
      jobs.push({ name, path: `${this.base}/hdri/${file}`, kind: 'hdri' });
    }

    let done = 0;
    const total = jobs.length;

    const run = async (job) => {
      try {
        if (job.kind === 'model') {
          const gltf = await this._loadGLTF(job.path);
          const template = this._prepareModel(gltf);
          if (!template) throw new Error('empty model');
          this.models.set(job.name, template);
        } else if (job.kind === 'texture') {
          this.textures.set(job.name, await this._loadTexture(job.path));
        } else {
          this.hdris.set(job.name, await this._loadHDR(job.path));
        }
      } catch (err) {
        // Loud, not silent: a sky that failed to load is why the day might look
        // flat, and swallowing the reason is how that stays undiagnosed for weeks.
        this.failed.push(job.name);
        console.warn(`[assets] ${job.name} failed:`, err?.message || err);
      } finally {
        done++;
        if (onProgress) onProgress(done, total);
      }
    };

    const all = Promise.all(jobs.map(run));
    // A dead CDN must not hold the loading screen hostage.
    await Promise.race([
      all,
      new Promise((resolve) => setTimeout(resolve, this.timeoutMs)),
    ]);

    this.loaded = true;
    this.ms = Math.round((globalThis.performance?.now?.() ?? Date.now()) - started);
    this._resolveSettled?.(this);
    return this;
  }

  /**
   * Resolve once everything the catalogue offers has been tried.
   *
   * Never rejects and never hangs: if `load()` has not been called it resolves
   * immediately, and a load that ran out of its timeout still resolves, because
   * a slow CDN must not leave the game on the loading screen forever.
   *
   * @returns {Promise<AssetLibrary>}
   */
  whenIdle() {
    if (this.loaded) return Promise.resolve(this);
    if (!this._settled) return Promise.resolve(this);
    return this._settled;
  }

  // ── Loaders ────────────────────────────────────────────────
  //
  // All three fetch the bytes first and then *parse* them, instead of handing a
  // URL to three's loaders. That is deliberate: when a file is missing, the dev
  // server answers 404 with an HTML error page, and three's loaders treat a
  // non-empty response as success and blow up while parsing it — inside an XHR
  // callback, where our try/catch cannot see it. Fetching first means a missing
  // file is a rejected promise like any other, and the fallback stays quiet.

  async _fetchBytes(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/html')) throw new Error(`${path} → not an asset`);
    return res.arrayBuffer();
  }

  async _loadGLTF(path) {
    if (this.loaders?.gltf) return this.loaders.gltf(path);
    const buffer = await this._fetchBytes(path);
    const base = path.slice(0, path.lastIndexOf('/') + 1);
    const loader = new GLTFLoader();
    return new Promise((resolve, reject) => loader.parse(buffer, base, resolve, reject));
  }

  async _loadTexture(path) {
    if (this.loaders?.texture) return this.loaders.texture(path);
    const buffer = await this._fetchBytes(path);
    const blob = new Blob([buffer]);
    const bitmap = await createImageBitmap(blob);
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Load a Radiance `.hdr` and turn it into an equirect texture.
   *
   * `RGBELoader.parse()` never resolves for the Poly Haven 1k skies this project
   * ships — it does not throw either, it just sits there. The asset load has a
   * 20 s ceiling, so the three sky jobs were still pending when the game started
   * building, the sky quietly fell back to the procedural shader, and the day was
   * a flat grey sheet. Nothing in `failed` said so, because nothing had failed:
   * the promises were simply never settled.
   *
   * So the file is decoded here instead. RGBE is a tiny format — a text header and
   * then either flat or run-length pixels — and decoding it ourselves also lets us
   * clamp the radiance, which is the other half of the problem: an unclamped sky
   * photograph carries a sun at 4000× the sky's own brightness, and once it is used
   * as the environment map the whole city is lit to a white-out.
   *
   * @param {string} path
   * @returns {Promise<THREE.DataTexture>}
   */
  async _loadHDR(path) {
    if (this.loaders?.hdr) return this.loaders.hdr(path);
    const buffer = await this._fetchBytes(path);
    return decodeHDR(buffer, path);
  }

  /**
   * Turn a loaded glTF into a template: one merged mesh per material, sized
   * and stood on the ground, with its footprint recorded.
   */
  _prepareModel(gltf) {
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) return null;

    root.updateMatrixWorld(true);

    // Collapse the draw calls. Kenney kits share a palette texture per kit, so
    // five meshes usually become one or two.
    let merged;
    try {
      merged = mergeByMaterial(root, { bakeWorld: true });
    } catch {
      merged = root;
    }

    // Normalise: origin on the ground, centred, and 1 unit tall — every caller
    // scales to the size it needs, so a tree and a chair use the same code.
    const box = new THREE.Box3().setFromObject(merged);
    const size = new THREE.Vector3();
    box.getSize(size);
    const centre = new THREE.Vector3();
    box.getCenter(centre);

    const holder = new THREE.Group();
    holder.name = 'asset';
    if (size.y > 0.0001) {
      merged.position.set(-centre.x, -box.min.y, -centre.z);
    }
    holder.add(merged);

    holder.userData.size = { x: size.x, y: size.y, z: size.z };
    holder.userData.height = size.y || 1;
    holder.userData.footprint = { w: size.x, d: size.z };
    holder.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      // Kenney's palette texture is authored unlit-ish; make sure it is sRGB
      // or every car comes out washed out next to the real photographs.
      const maps = [o.material?.map, o.material?.emissiveMap];
      for (const map of maps) if (map) map.colorSpace = THREE.SRGBColorSpace;
      if (o.material?.isMeshStandardMaterial) o.material.envMapIntensity = 0.75;
    });
    return holder;
  }

  // ── Access ─────────────────────────────────────────────────

  /** Is this model available? */
  hasModel(name) { return this.models.has(name); }

  /**
   * A fresh copy of a model, scaled so it is `height` metres tall (or to the
   * model's own size when height is omitted). Returns null when unavailable, so
   * callers can fall back to their primitive.
   */
  model(name, { height = null, scale = null } = {}) {
    const template = this.models.get(name);
    if (!template) return null;
    const copy = cloneWithMaterials(template);
    const baseHeight = template.userData.height || 1;
    const s = scale ?? (height ? height / baseHeight : 1);
    copy.scale.setScalar(s);
    copy.userData.baseHeight = baseHeight;
    copy.userData.size = { ...template.userData.size };
    return copy;
  }

  /** The template's bounding size, in metres. */
  modelSize(name) {
    const template = this.models.get(name);
    return template ? { ...template.userData.size } : null;
  }

  /**
   * Geometry for hard-instancing, already baked into the template's own space
   * (origin on the ground, centred) and merged per material — so a Kenney car
   * with a body and four wheels becomes a handful of InstancedMeshes for the
   * whole fleet instead of 5 draw calls per car.
   * @returns {Array<{geometry:THREE.BufferGeometry, material:THREE.Material}>|null}
   */
  instanceParts(name) {
    const template = this.models.get(name);
    if (!template) return null;
    const parts = [];
    template.updateMatrixWorld(true);
    template.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
      geometry.computeBoundingBox();
      parts.push({ geometry, material: o.material });
    });
    return parts.length ? parts : null;
  }

  /** Scale factor that would make this model `height` metres tall. */
  scaleFor(name, height) {
    const template = this.models.get(name);
    if (!template) return null;
    return height / (template.userData.height || 1);
  }

  /**
   * A surface photograph. `metresPerTile` is carried on the texture so the
   * world-space re-tiling pass knows the physical size of one tile.
   */
  texture(name, { repeat = 1, aniso = 4, metresPerTile = 0 } = {}) {
    const tex = this.textures.get(name);
    if (!tex) return null;
    const copy = tex.clone();
    copy.userData = { ...copy.userData, real: true, realName: name, metresPerTile };
    copy.wrapS = THREE.RepeatWrapping;
    copy.wrapT = THREE.RepeatWrapping;
    copy.repeat.set(repeat, repeat);
    copy.colorSpace = THREE.SRGBColorSpace;
    copy.anisotropy = aniso;
    copy.needsUpdate = true;
    return copy;
  }

  /** An equirectangular sky. */
  hdri(name) {
    return this.hdris.get(name) || null;
  }

  get summary() {
    return {
      models: this.models.size,
      textures: this.textures.size,
      skies: this.hdris.size,
      failed: [...this.failed],
      ms: this.ms,
    };
  }
}

/** Clone an object graph, cloning materials so per-instance tweaks do not leak. */
export function cloneWithMaterials(root) {
  const clone = root.clone(true);
  const seen = new Map();
  clone.traverse((o) => {
    if (!o.isMesh) return;
    const mat = o.material;
    const list = Array.isArray(mat) ? mat : [mat];
    const cloned = list.map((m) => {
      if (!m) return m;
      if (!seen.has(m.uuid)) seen.set(m.uuid, m.clone());
      return seen.get(m.uuid);
    });
    o.material = Array.isArray(mat) ? cloned : cloned[0];
  });
  // `clone(true)` copies children but shares geometry — which is what we want:
  // the GPU keeps one buffer per template.
  return clone;
}
