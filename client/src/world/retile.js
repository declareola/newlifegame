// client/src/world/retile.js
// World-space texture coordinates for photographic surfaces.
//
// The procedural textures were tuned by eye: a wall got `repeat: 3`, the road
// `repeat: 12`, and because each road segment is its own plane, both were
// "correct" on the segment they were authored for. Swap in a photograph and
// that arithmetic falls apart — a 12 m × 140 m avenue gets one square of asphalt
// stretched over the whole thing, which is exactly how you get the grey smears
// this file exists to remove.
//
// So the photographs do not use UVs at all. Every vertex gets a texture
// coordinate derived from its *world* position and its surface normal, with one
// tile pinned to a number of metres. A road tile is a road tile whether it is on
// a 4 m side street or a 140 m avenue, walls are measured in metres rather than
// in "whatever the box happened to be", and because the coordinates are in world
// space, two adjacent road segments made of two separate meshes line up exactly.
//
// This is deliberately a pass over the built scene rather than something baked
// into each builder: there are a dozen places that create geometry, and none of
// them should have to know how big a tile is.

import * as THREE from 'three';

/** Metres covered by one tile of each photographic texture. */
export const METRES_PER_TILE = {
  asphalt: 5.5,
  paving: 2.2,
  grass: 6,
  plaster: 2.5,
  facade: 4,
  wood: 1.8,
};

const _pos = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _mat = new THREE.Matrix4();
const _nmat = new THREE.Matrix3();
const _v = new THREE.Vector3();

/**
 * The photographic tile size for a material, or 0 when the material is not a
 * photograph (procedural textures keep their authored UVs).
 */
function tileFor(material) {
  const map = material?.map;
  if (!map || !map.userData?.real) return 0;
  return map.userData.metresPerTile || METRES_PER_TILE[map.userData.realName] || 0;
}

/**
 * Replace a geometry's UVs with world-space planar projections.
 * @param {THREE.BufferGeometry} geo
 * @param {THREE.Matrix4} matrixWorld
 * @param {number} tile metres per texture repeat
 */
function bakeWorldUVs(geo, matrixWorld, tile) {
  const position = geo.attributes.position;
  if (!position) return false;
  const normal = geo.attributes.normal;

  const count = position.count;
  const uv = new Float32Array(count * 2);
  _nmat.getNormalMatrix(matrixWorld);

  for (let i = 0; i < count; i++) {
    _pos.fromBufferAttribute(position, i).applyMatrix4(matrixWorld);

    if (normal) {
      _nrm.fromBufferAttribute(normal, i).applyMatrix3(_nmat).normalize();
    } else {
      _nrm.set(0, 1, 0);
    }

    const ax = Math.abs(_nrm.x);
    const ay = Math.abs(_nrm.y);
    const az = Math.abs(_nrm.z);

    let u;
    let v;
    if (ay >= ax && ay >= az) {
      // Horizontal: floors, roads, roofs, pavements.
      u = _pos.x;
      v = _pos.z;
    } else if (ax >= az) {
      // Facing along X: walls.
      u = _pos.z;
      v = _pos.y;
    } else {
      // Facing along Z: walls.
      u = _pos.x;
      v = _pos.y;
    }

    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return true;
}

/**
 * Re-tile every photographic surface under `root`.
 *
 * Instanced meshes are skipped: one geometry, many transforms, so a world-space
 * UV bake would be wrong for every instance but one. Their materials keep the
 * authored repeat, which at in-world scale reads fine for kerbs and benches.
 *
 * @param {THREE.Object3D} root
 * @returns {{retiled:number, skipped:number, tiles:Object<string,number>}}
 */
export function retileWorld(root, { metresPerTile = METRES_PER_TILE } = {}) {
  if (!root) return { retiled: 0, skipped: 0, tiles: {} };

  // Which geometries are shared between meshes? Those cannot carry a
  // per-mesh world projection, so they are cloned first.
  const uses = new Map();
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.geometry) {
      uses.set(o.geometry, (uses.get(o.geometry) || 0) + 1);
    }
  });

  root.updateMatrixWorld(true);
  const tiles = {};
  let retiled = 0;
  let skipped = 0;
  const done = new WeakSet();

  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) { skipped++; return; }
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    const tile = tileFor(material);
    if (!tile) return;

    // Materials that have been re-tiled must not also apply their old repeat on
    // top of the world-space UVs.
    const map = material.map;
    if (map.repeat.x !== 1 || map.repeat.y !== 1) map.repeat.set(1, 1);

    let geo = o.geometry;
    if (!geo) return;
    if (uses.get(geo) > 1) {
      geo = geo.clone();
      o.geometry = geo;
      uses.set(geo, 1);
    }
    if (done.has(geo)) return;
    if (!bakeWorldUVs(geo, o.matrixWorld, tile)) return;
    done.add(geo);

    const name = map.userData.realName;
    tiles[name] = tile;
    retiled++;
  });

  return { retiled, skipped, tiles };
}
