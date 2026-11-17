// client/interior-stats.mjs
// Build every interior type headlessly and report what came out.
// Run from /home/user/client:  node interior-stats.mjs

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

import { buildInterior } from './src/world/InteriorBuilder.js';
import { allInteriors, buildDoorRegistry } from './src/world/interiorData.js';
import { countMeshes } from './src/world/mergeUtils.js';

const TYPES = ['studio', 'onebed', 'twobed', 'office', 'bank', 'clinic', 'kiosk', 'shop', 'duplex'];

console.log('═══ INTERIOR BUILD TEST ═══');
let failed = 0;
for (const type of TYPES) {
  try {
    const built = buildInterior({
      id: `test-${type}`, name: type, type,
      width: 11, depth: 9, height: 3.0, floor: 'wood',
    });
    const { meshes, triangles } = countMeshes(built.group);
    console.log(
      `${type.padEnd(8)} meshes ${String(meshes).padStart(4)}  tris ${String(triangles).padStart(6)}` +
      `  colliders ${String(built.collisions.length).padStart(3)}  lights ${built.lights.length}` +
      `  spawn (${built.spawn.x.toFixed(1)}, ${built.spawn.z.toFixed(1)})`
    );
  } catch (err) {
    failed++;
    console.log(`${type.padEnd(8)} ✗ ${err.message}`);
  }
}

console.log('\n═══ INTERIOR REGISTRY ═══');
const all = allInteriors();
const doors = buildDoorRegistry();
console.log(`Interiors defined       : ${all.length}`);
for (const d of all) {
  console.log(`  ${d.type.padEnd(8)} ${String(d.width).padStart(3)}×${String(d.depth).padEnd(3)} ${d.name}`);
}
console.log(`Doors placed in the city: ${doors.length}`);
for (const d of doors) {
  console.log(`  (${d.x.toFixed(1)}, ${d.z.toFixed(1)})  ${d.name}`);
}

console.log(`\n${failed} failed`);
process.exit(failed ? 1 : 0);
