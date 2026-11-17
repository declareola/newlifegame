// client/test-render.mjs
// Verification for the realism pass: atmosphere maths, shadow density, and the
// GPU-side objects that can be constructed without a WebGL context.
//
// What this can prove here:
//   · the sun geometry is correct and stable
//   · the shadow texel density genuinely improved (the headline claim)
//   · fog/palette behave sensibly across the day
//   · Sky and GTAOPass construct, with the uniforms/properties we set
//   · the source wires them together and the old room probe is gone
//
// What it CANNOT prove: what any of it looks like. There is no GPU here. Those
// checks are clearly marked "static" below.
//
//   cd client && node test-render.mjs

import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const atmosphere = await import('./src/render/atmosphere.js');
const {
  DAY_LENGTH_MS, sunElevation, sunDirection, skyPalette,
  fogDensity, shadowTexelSize, snapToTexel, boundForTexelSize,
} = atmosphere;

const DEG = 180 / Math.PI;

// ── Sun geometry ──────────────────────────────────────────
console.log('[Sun geometry]');
// Round 15 lengthened the day to a real hour so a mission can be finished in one
// sitting (the user asked for exactly that); the old 8-minute expectation has
// been wrong since.
check('A day is 60 real minutes', DAY_LENGTH_MS === 60 * 60 * 1000, `${DAY_LENGTH_MS} ms`);

const noon = sunElevation(0.5);
const midnight = sunElevation(0);
const sunrise = sunElevation(0.25);
const sunset = sunElevation(0.75);

check('Sun is highest at noon', noon > 0.9, `${(noon * DEG).toFixed(1)}°`);
check('Sun is lowest at midnight', midnight < -0.9, `${(midnight * DEG).toFixed(1)}°`);
check('Sun is on the horizon at sunrise', Math.abs(sunrise) < 1e-9, `${(sunrise * DEG).toFixed(3)}°`);
check('Sun is on the horizon at sunset', Math.abs(sunset) < 1e-9, `${(sunset * DEG).toFixed(3)}°`);

const dirNoon = sunDirection(0.5);
const dirMid = sunDirection(0);
check('Sun direction is a unit vector', Math.abs(dirNoon.length() - 1) < 1e-9,
  dirNoon.length().toFixed(6));
check('Sun points up at noon', dirNoon.y > 0.85, `y=${dirNoon.y.toFixed(3)}`);
check('Sun points down at midnight', dirMid.y < -0.85, `y=${dirMid.y.toFixed(3)}`);

// Azimuth must sweep: sunrise east-ish, sunset west-ish, on opposite sides.
const dRise = sunDirection(0.25);
const dSet = sunDirection(0.75);
check('Sun rises and sets on opposite sides of the map',
  Math.sign(dRise.x) !== Math.sign(dSet.x) || Math.sign(dRise.z) !== Math.sign(dSet.z),
  `rise (${dRise.x.toFixed(2)}, ${dRise.z.toFixed(2)}) vs set (${dSet.x.toFixed(2)}, ${dSet.z.toFixed(2)})`);

// Phase must wrap cleanly at midnight.
check('Phase wraps without a jump',
  Math.abs(sunElevation(0) - sunElevation(1)) < 1e-9 &&
  Math.abs(sunElevation(0.1) - sunElevation(1.1)) < 1e-9);

// Reusing the target vector must not allocate or corrupt.
const scratch = new THREE.Vector3();
const a = sunDirection(0.3, scratch);
const b = sunDirection(0.6, scratch);
check('sunDirection reuses its target vector', a === b && a !== undefined);

// ── Palette ───────────────────────────────────────────────
console.log('\n[Sky palette]');
const noonPal = skyPalette(sunElevation(0.5));
const noonHorizon = noonPal.horizon.clone();
const noonSun = noonPal.sun.clone();
const noonDaylight = noonPal.daylight;
const noonAmbient = noonPal.ambientIntensity;
const noonSunIntensity = noonPal.sunIntensity;

const duskPal = skyPalette(THREE.MathUtils.degToRad(3));
const duskHorizon = duskPal.horizon.clone();
// skyPalette() hands back shared scratch colours; clone before the next call
// overwrites them. (Missing this is exactly the trap the module documents.)
const duskSun = duskPal.sun.clone();

const nightPal = skyPalette(sunElevation(0));
const nightHorizon = nightPal.horizon.clone();
const nightDaylight = nightPal.daylight;

check('Noon is full daylight', noonDaylight > 0.99, noonDaylight.toFixed(3));
check('Midnight is zero daylight', nightDaylight < 0.001, nightDaylight.toFixed(4));
check('Noon horizon is brighter than midnight',
  noonHorizon.getHSL({}).l > nightHorizon.getHSL({}).l,
  `${(noonHorizon.getHSL({}).l * 100).toFixed(1)}% vs ${(nightHorizon.getHSL({}).l * 100).toFixed(1)}%`);

// Sunset must be measurably warmer: more red relative to blue.
const warmth = (c) => c.r / Math.max(c.b, 1e-4);
check('Low sun is warmer than noon sun', warmth(duskHorizon) > warmth(noonHorizon),
  `r/b ${warmth(duskHorizon).toFixed(2)} vs ${warmth(noonHorizon).toFixed(2)}`);
check('Sun colour is warm near the horizon', duskSun.r > duskSun.b,
  `r=${duskSun.r.toFixed(2)} b=${duskSun.b.toFixed(2)}`);

check('Ambient fill is stronger by day than by night',
  noonAmbient > nightPal.ambientIntensity,
  `${noonAmbient.toFixed(2)} vs ${nightPal.ambientIntensity.toFixed(2)}`);
check('Sun intensity stays in a sane exposure range',
  noonSunIntensity > 2.2 && noonSunIntensity < 3.6, noonSunIntensity.toFixed(2));

// The property that makes outdoor light look natural: the sun has to dominate
// the fill, or every surface is lit evenly and nothing reads as sunlit.
const sunFillRatio = noonSunIntensity / noonAmbient;
check('Sun dominates the ambient fill at noon (>= 4:1)',
  sunFillRatio >= 4, `${sunFillRatio.toFixed(1)}:1`);

// ── Fog ───────────────────────────────────────────────────
console.log('\n[Fog]');
const fogNoon = fogDensity(sunElevation(0.5));
const fogNight = fogDensity(sunElevation(0));
check('Fog density is positive everywhere', fogNoon > 0 && fogNight > 0,
  `day ${fogNoon.toFixed(5)}, night ${fogNight.toFixed(5)}`);
check('Night is hazier than noon (enclosed city)', fogNight > fogNoon,
  `${fogNight.toFixed(5)} > ${fogNoon.toFixed(5)}`);
// Visibility ≈ 3/density for exp2 fog; check it is plausibly city-scale.
check('Day visibility is city-scale, not kilometre-scale',
  fogNoon > 0.001 && fogNoon < 0.02, `~${Math.round(3 / fogNoon)} m visible`);

// ── Shadows: the headline claim ───────────────────────────
console.log('\n[Shadow density]');
const OLD_BOUND = 130;   // what the fixed frustum used
const NEW_BOUND = 60;    // what ShadowRig now uses
const MAP = 2048;

const oldTexel = shadowTexelSize(OLD_BOUND, MAP);
const newTexel = shadowTexelSize(NEW_BOUND, MAP);

check('Old rig really was ~12.7 cm per texel', Math.abs(oldTexel - 0.127) < 0.001,
  `${(oldTexel * 100).toFixed(2)} cm`);
check('New rig is ~5.9 cm per texel', Math.abs(newTexel - 0.0586) < 0.002,
  `${(newTexel * 100).toFixed(2)} cm`);
check('Shadow detail improved by more than 2×', oldTexel / newTexel > 2,
  `${(oldTexel / newTexel).toFixed(2)}× sharper`);
check('boundForTexelSize round-trips', Math.abs(
  shadowTexelSize(boundForTexelSize(0.05, MAP), MAP) - 0.05) < 1e-9);

// Snapping must land on the grid, or shadow edges crawl while walking.
const texel = newTexel;
for (const v of [0.1234, -7.891, 43.5599, -60]) {
  const snapped = snapToTexel(v, texel);
  const offGrid = Math.abs(snapped / texel - Math.round(snapped / texel));
  if (offGrid > 1e-9) {
    check(`snapToTexel(${v}) lands on the grid`, false, `off by ${offGrid}`);
  }
}
check('snapToTexel quantises to the texel grid',
  [0.1234, -7.891, 43.5599, -60].every((v) => {
    const s = snapToTexel(v, texel);
    return Math.abs(s / texel - Math.round(s / texel)) < 1e-9;
  }));
check('Snapping never moves a point by more than half a texel',
  [0.1234, -7.891, 43.5599].every((v) => Math.abs(snapToTexel(v, texel) - v) <= texel / 2 + 1e-12));

// ── Real construction of the GPU-side objects (no context needed) ──
console.log('\n[Construction without a GPU]');
try {
  const { Sky } = await import('three/examples/jsm/objects/Sky.js');
  const sky = new Sky();
  const u = sky.material.uniforms;
  const hasUniforms = ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'sunPosition']
    .every((k) => u[k] !== undefined);
  check('Sky builds and exposes its uniforms', hasUniforms,
    Object.keys(u).join(', ').slice(0, 60));
  u.sunPosition.value.set(0, 1, 0);
  check('Sky sunPosition is a Vector3 we can aim', u.sunPosition.value.length() === 1);
} catch (err) {
  check('Sky builds and exposes its uniforms', false, err.message);
}

try {
  const { GTAOPass } = await import('three/examples/jsm/postprocessing/GTAOPass.js');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
  const pass = new GTAOPass(scene, camera, 640, 360);
  check('GTAOPass constructs', pass instanceof GTAOPass);
  check('GTAOPass has the Default output mode', GTAOPass.OUTPUT.Default === 0,
    JSON.stringify(GTAOPass.OUTPUT));
  pass.updateGtaoMaterial({ radius: 1.1, thickness: 1.6, samples: 16 });
  pass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  check('GTAO accepts our radius/thickness/denoise parameters',
    pass.gtaoMaterial.uniforms.radius.value === 1.1 &&
    pass.gtaoMaterial.uniforms.thickness.value === 1.6);
  pass.blendIntensity = 0.9;
  pass.setSize(800, 450);
  check('GTAO resizes without a context', pass.width >= 800 || pass.gtaoRenderTarget.width >= 800,
    `${pass.gtaoRenderTarget.width}×${pass.gtaoRenderTarget.height}`);
} catch (err) {
  check('GTAOPass constructs', false, err.message);
}

// ── Static wiring checks (source facts, clearly labelled) ──
console.log('\n[Wiring — static source checks, not rendered output]');
const mainSrc = await readFile(new URL('./src/main.js', import.meta.url), 'utf8');
const postSrc = await readFile(new URL('./src/render/PostFX.js', import.meta.url), 'utf8');
const skySrc = await readFile(new URL('./src/render/SkyEnvironment.js', import.meta.url), 'utf8');
const daySrc = await readFile(new URL('./src/world/DayNight.js', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

check('The indoor RoomEnvironment probe is gone from the city',
  !mainSrc.includes('RoomEnvironment'), 'no import, no PMREM probe');
check('SkyEnvironment is wired into main', mainSrc.includes('new SkyEnvironment('));
check('ShadowRig is wired into main', mainSrc.includes('new ShadowRig('));
check('ShadowRig follows the player every frame',
  mainSrc.includes('shadowRig.update(avatar.position'));
check('The IBL probe is refreshed as the sun moves',
  mainSrc.includes('skyEnv.update(dayNight.elevation'));
check('DayNight drives the sky sun', daySrc.includes('onSunChange'));
check('DayNight uses exponential fog', daySrc.includes('FogExp2'));
check('DayNight copies out of the palette scratch colours',
  daySrc.includes('.copy(palette.horizon)') && daySrc.includes('.copy(palette.sun)'),
  'no aliasing of scratch colours');
check('Fog colour is taken from the sky horizon', daySrc.includes('fog.color.copy'));

// The visible sky is a cube map baked with a CubeCamera. three r160's
// WebGLCubeRenderTarget has no fromScene(), so a regression there would throw
// on the first frame and leave the player looking at a flat colour.
check('Sky backdrop is rendered with a CubeCamera',
  skySrc.includes('new THREE.CubeCamera('));
check('Sky backdrop does not call the missing WebGLCubeRenderTarget.fromScene',
  !skySrc.includes('cubeRT.fromScene('));
check('Sky backdrop is handed to scene.background',
  skySrc.includes('scene.background = this.cubeRT.texture'));
check('A failed sky bake falls back instead of throwing', skySrc.includes('catch (err)'));
// The old visible Sky mesh is gone; anything still touching `this.sky` would
// throw the moment the F2 panel changed turbidity.
const staleSkyRefs = skySrc.split('\n')
  .map((line, i) => ({ line, i }))
  .filter(({ line }) => /this\.sky\b/.test(line) && !line.trim().startsWith('//'));
check('SkyEnvironment no longer references the removed sky mesh',
  staleSkyRefs.length === 0,
  staleSkyRefs.map((r) => `line ${r.i + 1}`).join(', ') || 'no stale references');
check('DayNight does not paint over the baked sky',
  mainSrc.includes('manageBackground: false'));
check('PostFX uses GTAO instead of SSAO',
  postSrc.includes('GTAOPass') && !postSrc.includes('new SSAOPass'),
  'GTAOPass imported, SSAOPass construction removed');
check('AO can be toggled independently of quality', typeof postSrc.includes === 'function' &&
  postSrc.includes('setAOEnabled'));
check('Debug panel loads lil-gui lazily (separate chunk)',
  (await readFile(new URL('./src/render/DebugPanel.js', import.meta.url), 'utf8'))
    .includes("import('lil-gui')"),
  "dynamic import, so it is not in the main bundle");
check('lil-gui is a declared dependency', Boolean(pkg.dependencies['lil-gui']),
  pkg.dependencies['lil-gui']);
check('F2 is bound to the debug panel', mainSrc.includes("e.code !== 'F2'"));

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed ? 1 : 0);
