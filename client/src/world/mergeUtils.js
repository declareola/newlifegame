// client/src/world/mergeUtils.js
// Static-geometry merging.
//
// A detailed building is made of a few hundred small boxes. Left alone that is
// a few hundred draw calls, which would tank the frame rate once there are a
// hundred buildings. Everything static is therefore merged per material:
// a whole building collapses to roughly one draw call per distinct material
// (body, trim, glass, lit glass, metal), and a whole district can collapse to
// a handful.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Merge every mesh in a group into one mesh per material.
 * @param {THREE.Group|THREE.Object3D} root
 * @param {object} [opts]
 * @param {boolean} [opts.bakeWorld=false] - bake the root's own transform in
 * @returns {THREE.Group} a new group of merged meshes
 */
export function mergeByMaterial(root, { bakeWorld = false } = {}) {
  root.updateMatrixWorld(true);

  const buckets = new Map(); // material.uuid -> { material, geos: [], cast, receive }
  const leftovers = [];      // things we cannot merge (lights, groups with no geometry)

  root.traverse((obj) => {
    if (!obj.isMesh) {
      if (obj.isLight) leftovers.push(obj.clone());
      return;
    }
    if (obj.isInstancedMesh) { leftovers.push(obj); return; }
    if (Array.isArray(obj.material)) { leftovers.push(obj); return; }

    let geo = obj.geometry.clone();
    // World (or root-local) transform
    const m = bakeWorld ? obj.matrixWorld.clone() : obj.matrix.clone();
    geo.applyMatrix4(m);

    // Strip attributes that not every primitive has, so merges never fail.
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    }
    // Merged geometry needs identical attribute sets.
    if (!geo.attributes.uv) {
      const count = geo.attributes.position.count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    geo.morphAttributes = {};

    // Indexed and non-indexed geometry cannot be merged together. Rather than
    // expanding every indexed primitive to non-indexed (which would triple the
    // vertex count), give the non-indexed ones a trivial sequential index.
    if (!geo.index) {
      const count = geo.attributes.position.count;
      const arr = count > 65535 ? new Uint32Array(count) : new Uint16Array(count);
      for (let i = 0; i < count; i++) arr[i] = i;
      geo.setIndex(new THREE.BufferAttribute(arr, 1));
    }

    const key = obj.material.uuid;
    if (!buckets.has(key)) {
      buckets.set(key, {
        material: obj.material,
        geos: [],
        cast: false,
        receive: false,
      });
    }
    const b = buckets.get(key);
    b.geos.push(geo);
    b.cast = b.cast || obj.castShadow;
    b.receive = b.receive || obj.receiveShadow;
  });

  const out = new THREE.Group();

  for (const { material, geos, cast, receive } of buckets.values()) {
    if (geos.length === 0) continue;

    let merged = null;
    try {
      merged = mergeGeometries(geos, false);
    } catch (err) {
      merged = null;
    }

    if (merged) {
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      out.add(mesh);
      for (const g of geos) g.dispose();
    } else {
      // Fallback: keep the parts unmerged rather than losing them.
      for (const g of geos) {
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
        out.add(mesh);
      }
    }
  }

  for (const l of leftovers) out.add(l);
  return out;
}

/** Count meshes + triangles under an object (for diagnostics). */
export function countMeshes(obj) {
  let meshes = 0;
  let triangles = 0;
  obj.traverse((o) => {
    if (o.isMesh && o.geometry) {
      meshes++;
      const g = o.geometry;
      const tris = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      triangles += tris * (o.isInstancedMesh ? o.count : 1);
    }
  });
  return { meshes, triangles: Math.round(triangles) };
}
