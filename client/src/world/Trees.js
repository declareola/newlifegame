// client/src/world/Trees.js
// Street trees and palms, built from primitives but shaped like plants.
//
// The old version was a cone on a stick, which is why it read as a traffic cone
// with a hat. A real tree silhouette needs three things that a cone cannot give
// you: a trunk that tapers and branches, a canopy made of several overlapping
// masses at different heights, and enough per-instance variation that the row
// along a street does not look copy-pasted.
//
// Everything is instanced, so a whole avenue of trees is five draw calls.

import * as THREE from 'three';

// ── Deterministic randomness ──────────────────────────────────
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

const GREENS = [0x3f7d34, 0x4c8c3a, 0x356b2c, 0x568f42, 0x2f5f2a, 0x629b47];

/**
 * Build the tree meshes.
 *
 * @param {THREE.Object3D} parent   where the instanced meshes are added
 * @param {Array<{x:number,z:number}>} trees   broadleaf street trees
 * @param {Array<{x:number,z:number}>} palms   palms for the Lekki waterfront
 * @param {object} materials        the shared material registry
 * @param {object} [opts]
 * @param {AssetLibrary} [opts.assets] when present, real Kenney tree models
 *        replace the procedural broadleaf trees (palms stay procedural — the
 *        kit has no palm)
 * @returns {{trees:number, palms:number, meshes:number, real:boolean}}
 */
export function createTrees(parent, trees, palms, materials, { assets = null } = {}) {
  const rnd = lcg(90210);
  const created = [];

  // ── Real trees ─────────────────────────────────────────────
  // Kenney's nature kit, instanced: one draw call per material per model, for
  // the whole city. A tree is a tree model now; the procedural version below
  // only runs when the assets are missing.
  const modelNames = assets
    ? ['tree.default', 'tree.pine', 'tree.thin'].filter((n) => assets.hasModel(n))
    : [];
  if (trees.length && modelNames.length) {
    const realStats = createModelTrees(parent, trees, assets, modelNames, rnd);
    return {
      trees: trees.length,
      palms: palms.length,
      meshes: realStats.meshes + createPalms(parent, palms, materials, rnd).meshes,
      real: true,
    };
  }

  // ── Broadleaf trees ────────────────────────────────────────
  if (trees.length) {
    // Trunk: unit height, tapered. Scaled per instance.
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 1, 7, 1);
    trunkGeo.translate(0, 0.5, 0);   // pivot at the base
    const trunkMat = materials.trunk();
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    trunkMesh.name = 'tree-trunks';

    // Branches: two per tree, angled outward.
    const branchGeo = new THREE.CylinderGeometry(0.055, 0.12, 1, 5, 1);
    branchGeo.translate(0, 0.5, 0);
    const branchMesh = new THREE.InstancedMesh(branchGeo, trunkMat, trees.length * 2);
    branchMesh.castShadow = true;
    branchMesh.name = 'tree-branches';

    // Canopy: low-poly icospheres, five per tree in a loose cluster. This is
    // the part that makes it read as a tree rather than a shape.
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);
    const leafMat = materials.leaf().clone();
    leafMat.flatShading = true;
    const BLOBS = 5;
    const canopyMesh = new THREE.InstancedMesh(leafGeo, leafMat, trees.length * BLOBS);
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    canopyMesh.name = 'tree-canopies';

    let branchIndex = 0;
    let blobIndex = 0;

    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      const height = 4.2 + rnd() * 2.6;         // 4.2–6.8 m trunk
      const lean = (rnd() - 0.5) * 0.12;
      const yaw = rnd() * Math.PI * 2;

      // Trunk
      _q.setFromEuler(_e.set(lean, yaw, lean * 0.6));
      _m.compose(_v.set(t.x, 0, t.z), _q, _s.set(1, height, 1));
      trunkMesh.setMatrixAt(i, _m);

      // Branches, from 60% and 75% of the trunk height
      for (let b = 0; b < 2; b++) {
        const baseY = height * (0.58 + b * 0.16);
        const spread = 0.7 + rnd() * 0.3;         // radians from vertical
        const around = yaw + b * 2.1 + rnd();
        _q.setFromEuler(_e.set(spread * Math.cos(around), around, spread * Math.sin(around)));
        _m.compose(
          _v.set(t.x + Math.cos(around) * 0.1, baseY, t.z + Math.sin(around) * 0.1),
          _q,
          _s.set(1, height * 0.34, 1),
        );
        branchMesh.setMatrixAt(branchIndex++, _m);
      }

      // Canopy cluster: one main mass plus four offset lobes
      const crownY = height * 0.92;
      const crownR = 1.9 + rnd() * 0.9;
      const green = GREENS[Math.floor(rnd() * GREENS.length)];

      for (let b = 0; b < BLOBS; b++) {
        const main = b === 0;
        const ang = yaw + (b / BLOBS) * Math.PI * 2 + rnd() * 0.5;
        const dist = main ? 0 : crownR * (0.42 + rnd() * 0.34);
        const scale = main ? crownR : crownR * (0.52 + rnd() * 0.3);
        const y = crownY + (main ? crownR * 0.28 : (rnd() - 0.35) * crownR * 0.75);

        _q.setFromEuler(_e.set(rnd() * 0.4, rnd() * Math.PI, rnd() * 0.4));
        _m.compose(
          _v.set(t.x + Math.cos(ang) * dist, y, t.z + Math.sin(ang) * dist),
          _q,
          // Flattened vertically: a tree crown is wider than it is tall.
          _s.set(scale, scale * 0.82, scale),
        );
        canopyMesh.setMatrixAt(blobIndex, _m);
        canopyMesh.setColorAt(blobIndex, _col.setHex(green).offsetHSL(0, 0, (rnd() - 0.5) * 0.08));
        blobIndex++;
      }
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    branchMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (canopyMesh.instanceColor) canopyMesh.instanceColor.needsUpdate = true;

    parent.add(trunkMesh, branchMesh, canopyMesh);
    created.push(trunkMesh, branchMesh, canopyMesh);
  }

  // ── Palms ──────────────────────────────────────────────────
  created.push(...createPalms(parent, palms, materials, rnd));

  return { trees: trees.length, palms: palms.length, meshes: created.length, real: false };
}

/**
 * Real tree models, instanced per material.
 * @returns {{meshes:number}}
 */
function createModelTrees(parent, trees, assets, names) {
  const rnd = lcg(5150);
  const perModel = new Map();   // name → { parts, size, slots: [] }
  for (const name of names) {
    const parts = assets.instanceParts(name);
    const size = assets.modelSize(name);
    if (parts && size) perModel.set(name, { parts, size, slots: [] });
  }
  if (!perModel.size) return { meshes: 0 };

  const keys = [...perModel.keys()];
  for (let i = 0; i < trees.length; i++) {
    const name = keys[i % keys.length];
    perModel.get(name).slots.push(trees[i]);
  }

  let meshes = 0;
  for (const [name, entry] of perModel) {
    const count = entry.slots.length;
    if (!count) continue;
    const baseHeight = entry.size.y || 1;

    const matrices = [];
    for (const t of entry.slots) {
      const height = 5.0 + rnd() * 3.4;         // 5–8.4 m
      const s = height / baseHeight;
      const yaw = rnd() * Math.PI * 2;
      _q.setFromEuler(_e.set(0, yaw, 0));
      _m.compose(
        _v.set(t.x, 0, t.z),
        _q,
        _s.set(s * (0.92 + rnd() * 0.18), s, s * (0.92 + rnd() * 0.18)),
      );
      matrices.push(_m.clone());
    }

    for (const part of entry.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `tree-real-${name}-${meshes}`;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      parent.add(mesh);
      meshes++;
    }
  }
  return { meshes };
}

/**
 * Palms for the Lekki waterfront. Procedural on purpose: the Kenney nature kit
 * has broadleaf trees and conifers but no palm, and a palm is the one tree that
 * must look right on a Lagos seafront.
 * @returns {Array<THREE.InstancedMesh>}
 */
function createPalms(parent, palms, materials, rnd) {
  const created = [];
  if (!palms.length) return created;
  const palmTrunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 1, 7, 1);
  palmTrunkGeo.translate(0, 0.5, 0);
  const palmTrunkMat = materials.trunk();
  const palmTrunk = new THREE.InstancedMesh(palmTrunkGeo, palmTrunkMat, palms.length);
  palmTrunk.castShadow = true;
  palmTrunk.name = 'palm-trunks';

  // Fronds: long, thin and drooping, eight per palm.
  const frondGeo = new THREE.BoxGeometry(0.34, 0.05, 2.6);
  frondGeo.translate(0, 0, 1.3);   // pivot at the crown, extends outward
  const frondMat = materials.leafDark().clone();
  frondMat.flatShading = true;
  const FRONDS = 8;
  const frondMesh = new THREE.InstancedMesh(frondGeo, frondMat, palms.length * FRONDS);
  frondMesh.castShadow = true;
  frondMesh.name = 'palm-fronds';

  let frondIndex = 0;
  for (let i = 0; i < palms.length; i++) {
    const p = palms[i];
    const height = 6.5 + rnd() * 3.5;
    const lean = 0.05 + rnd() * 0.13;     // palms lean toward the sea
    const leanDir = rnd() * Math.PI * 2;

    _q.setFromEuler(_e.set(Math.cos(leanDir) * lean, 0, Math.sin(leanDir) * lean));
    _m.compose(_v.set(p.x, 0, p.z), _q, _s.set(1, height, 1));
    palmTrunk.setMatrixAt(i, _m);

    // Crown sits where the leaning trunk ends.
    const topX = p.x + Math.sin(leanDir) * lean * height * 0.5;
    const topZ = p.z + Math.cos(leanDir) * lean * height * 0.5;

    for (let f = 0; f < FRONDS; f++) {
      const around = (f / FRONDS) * Math.PI * 2 + rnd() * 0.18;
      const droop = 0.30 + rnd() * 0.34;    // radians below horizontal
      const len = 0.82 + rnd() * 0.36;
      _q.setFromEuler(_e.set(0, around, 0));
      _q.multiply(new THREE.Quaternion().setFromEuler(_e.set(droop, 0, 0)));
      _m.compose(
        _v.set(topX, height - 0.15, topZ),
        _q,
        _s.set(1, 1, len),
      );
      frondMesh.setMatrixAt(frondIndex++, _m);
    }
  }

  palmTrunk.instanceMatrix.needsUpdate = true;
  frondMesh.instanceMatrix.needsUpdate = true;
  created.push(palmTrunk, frondMesh);
  parent.add(palmTrunk, frondMesh);
  return created;
}
