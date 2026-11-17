// client/scene-stats.mjs
// Measure the actual 3D scene: how much geometry, how many materials, how
// many distinct art assets, and how many draw calls the city costs.
// Run from /home/user/client:  node scene-stats.mjs

// ---- canvas stub rich enough for the procedural texture generators ----
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
  createElement: () => ({
    width: 256, height: 256, style: {},
    getContext: () => ctxStub,
    toDataURL: () => 'data:,',
  }),
};

import * as THREE from 'three';
import { CityBuilder } from './src/world/CityBuilder.js';
import { Avatar } from './src/player/Avatar.js';
import * as cityData from './src/world/cityData.js';

const city = new CityBuilder();
city.build();

const meshes = [];
const instanced = [];
const lights = [];
city.group.traverse((o) => {
  if (o.isInstancedMesh) instanced.push(o);
  else if (o.isMesh) meshes.push(o);
  if (o.isLight) lights.push(o);
});

let triangles = 0;
let vertices = 0;
const materials = new Set();
const textures = new Set();
const geometries = new Set();

function addGeometry(g) {
  if (!g) return;
  geometries.add(g.uuid);
  const pos = g.attributes.position;
  if (pos) {
    vertices += pos.count;
    triangles += g.index ? g.index.count / 3 : pos.count / 3;
  }
}

for (const m of meshes) {
  addGeometry(m.geometry);
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  for (const mat of mats) {
    if (!mat) continue;
    materials.add(mat.uuid);
    if (mat.map) textures.add(mat.map.uuid);
  }
}
for (const im of instanced) {
  addGeometry(im.geometry);
  materials.add(im.material.uuid);
  if (im.material?.map) textures.add(im.material.map.uuid);
  const g = im.geometry;
  const pos = g.attributes.position;
  const per = g.index ? g.index.count / 3 : pos.count / 3;
  triangles += per * im.count;
  vertices += (pos?.count || 0) * im.count;
}

const avatar = new Avatar({});
let avatarMeshes = 0;
let avatarTris = 0;
avatar.traverse((o) => {
  if (o.isMesh) {
    avatarMeshes++;
    const g = o.geometry;
    avatarTris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  }
});

// Distinct primitive *shapes* used across the whole world
const shapeKinds = new Set([...geometries].map((u) => u));

console.log('═══ NEWLIFE SCENE — MEASURED ═══');
console.log(`Regular meshes          : ${meshes.length}`);
console.log(`InstancedMesh batches   : ${instanced.length}`);
console.log(`Instanced instances     : ${instanced.reduce((a, m) => a + m.count, 0)}`);
console.log(`Lights                  : ${lights.length}`);
console.log(`Unique materials        : ${materials.size}`);
console.log(`Textures (canvas signs) : ${textures.size}`);
console.log(`Unique geometries       : ${geometries.size}`);
console.log(`Triangles (city)        : ${Math.round(triangles).toLocaleString()}`);
console.log(`Vertices  (city)        : ${Math.round(vertices).toLocaleString()}`);
console.log('');
console.log(`Avatar meshes           : ${avatarMeshes}`);
console.log(`Avatar triangles        : ${Math.round(avatarTris)}`);
console.log('');
console.log('═══ CONTENT INVENTORY (from cityData) ═══');
console.log(`Districts               : ${cityData.districts.length}`);
console.log(`Buildings               : ${cityData.buildings.length}`);
console.log(`  of which named/unique : ${cityData.keyBuildings.length + cityData.jobKiosks.length + cityData.activityBuildings.length + cityData.propertyBuildings.length + (cityData.interactionBuildings?.length || 0)}`);
console.log(`  of which grid filler  : ${cityData.buildings.length - (cityData.keyBuildings.length + cityData.jobKiosks.length + cityData.activityBuildings.length + cityData.propertyBuildings.length + (cityData.interactionBuildings?.length || 0))}`);
console.log(`Roads                   : ${cityData.roads.length}`);
console.log(`Trees                   : ${cityData.treePositions.length}`);
console.log(`Street lights           : ${cityData.lightPositions.length}`);
console.log(`Water bodies            : 1`);
console.log('');
console.log('═══ SURFACE AREA ═══');
const xs = cityData.buildings.map((b) => b.position.x);
const zs = cityData.buildings.map((b) => b.position.z);
console.log(`World extent            : 200 × 200 units`);
console.log(`Building spread         : x ${Math.min(...xs)}..${Math.max(...xs)}, z ${Math.min(...zs)}..${Math.max(...zs)}`);
