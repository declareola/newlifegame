// client/src/render/Weather.js
// Lagos rain, as a system rather than an effect.
//
// It rains hard and suddenly here, and then the sun comes back and the street
// steams. That is the whole idea: rain is not a particle demo bolted onto the
// camera, it is a state the world is in, and other systems read it.
//
//   · a cylinder of instanced streaks follows the player, so rain is always
//     where you are and costs one draw call
//   · splashes on the ground at a fixed rate, from a small pool of quads
//   · fog thickens, the sky dims, the sun's intensity drops, the ambient goes
//     cool and grey — the same palette path the time of day uses
//   · `raining` and `intensity` are public, so traffic can slow, the market can
//     empty, the audio can switch to its rain bed and the HUD can show it
//
// No textures, no external assets: the streaks are two triangles each, shaded
// per-instance by colour, and the splashes are flat rings.

import * as THREE from 'three';

const RAIN_COUNT = 2600;
const RAIN_RADIUS = 26;
const RAIN_HEIGHT = 22;
const SPLASH_COUNT = 90;

/** How long a full rain cycle lasts: a short shower, then a long dry spell. */
const CYCLE = {
  dryMin: 150,     // seconds of guaranteed dry weather after a shower
  dryMax: 320,
  rainMin: 55,     // a shower is never shorter than this
  rainMax: 140,
  ramp: 6,         // seconds to build up / fade out
};

export class Weather {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [o]
   * @param {number} [o.seed] - deterministic weather for tests
   * @param {boolean} [o.auto] - false starts dry and never rains on its own
   */
  constructor(scene, { seed = null, auto = true, volume = 60 } = {}) {
    this.scene = scene;
    this.auto = auto;
    this.raining = false;
    this.intensity = 0;          // 0 → 1, ramped
    this.wetness = 0;            // 0 → 1, rises while raining, dries slowly
    this.volume = volume;

    this._rng = seed === null ? Math.random : mulberry32(seed);
    this._timer = auto ? rand(this._rng, CYCLE.dryMin, CYCLE.dryMax) : Infinity;
    this._state = 'dry';

    this.group = new THREE.Group();
    this.group.name = 'weather';
    this.group.frustumCulled = false;
    scene.add(this.group);

    this._buildRain();
    this._buildSplashes();
    this._buildClouds();
  }

  // ── Geometry ───────────────────────────────────────────────

  _buildRain() {
    // One thin quad per drop, laid out in a disc around the player. The shader
    // is the stock one; the drops move by updating the instance matrices, which
    // is cheaper than a vertex shader trick for this count.
    const geo = new THREE.PlaneGeometry(0.014, 0.55);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xcfe3f2,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.rain = new THREE.InstancedMesh(geo, mat, RAIN_COUNT);
    this.rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rain.frustumCulled = false;
    this.rain.visible = false;

    this._drop = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      const angle = this._rng() * Math.PI * 2;
      const radius = Math.sqrt(this._rng()) * RAIN_RADIUS;
      this._drop.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        y: this._rng() * RAIN_HEIGHT,
        speed: 16 + this._rng() * 12,
        len: 0.7 + this._rng() * 0.9,
      });
    }
    this.group.add(this.rain);
  }

  _buildSplashes() {
    const geo = new THREE.RingGeometry(0.06, 0.12, 8);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd8ecf7,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.splashes = new THREE.InstancedMesh(geo, mat, SPLASH_COUNT);
    this.splashes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.splashes.frustumCulled = false;
    this.splashes.visible = false;
    this._splash = Array.from({ length: SPLASH_COUNT }, () => ({ life: 0, x: 0, z: 0, scale: 1 }));
    this.group.add(this.splashes);
  }

  _buildClouds() {
    // A dark ceiling that fades in with the rain. Cheap: one big soft disc.
    const geo = new THREE.CircleGeometry(this.volume * 1.6, 24);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5a6673,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.clouds = new THREE.Mesh(geo, mat);
    this.clouds.position.y = 42;
    this.group.add(this.clouds);
  }

  // ── Control ────────────────────────────────────────────────

  /** Start a shower now (debug panel and tests). */
  start() {
    this._state = 'raining';
    this.raining = true;
    this._timer = rand(this._rng, CYCLE.rainMin, CYCLE.rainMax);
    return this;
  }

  /** Stop it now. */
  stop() {
    this._state = 'dry';
    this.raining = false;
    this._timer = rand(this._rng, CYCLE.dryMin, CYCLE.dryMax);
    return this;
  }

  toggle() { return this.raining ? (this.stop(), this) : (this.start(), this); }

  // ── Per-frame ──────────────────────────────────────────────

  /**
   * @param {number} dt
   * @param {object} o
   * @param {THREE.Vector3} [o.focus] - where the player is, so rain is local
   * @param {boolean} [o.indoors] - no rain shown inside a building
   */
  update(dt, { focus = null, indoors = false } = {}) {
    const step = Math.min(dt, 0.05);

    if (this.auto) {
      this._timer -= step;
      if (this._timer <= 0) {
        if (this.raining) this.stop(); else this.start();
      }
    }

    // Ramp in and out so the sky does not snap.
    const target = this.raining ? 1 : 0;
    const rate = 1 / CYCLE.ramp;
    if (this.intensity < target) this.intensity = Math.min(target, this.intensity + step * rate);
    else if (this.intensity > target) this.intensity = Math.max(target, this.intensity - step * rate);

    // The ground stays wet for a while after the rain stops.
    if (this.intensity > 0.2) this.wetness = Math.min(1, this.wetness + step * 0.09);
    else this.wetness = Math.max(0, this.wetness - step * 0.02);

    const shown = this.intensity > 0.01 && !indoors;
    this.rain.visible = shown;
    this.splashes.visible = shown;
    this.clouds.material.opacity = this.intensity * 0.55;
    this.rain.material.opacity = 0.42 * this.intensity;

    if (shown) {
      this._animateRain(step, focus);
      this._animateSplashes(step, focus);
      if (focus) this.group.position.set(focus.x, 0, focus.z);
    }

    // Grey out the world a little while it pours.
    this.lightScale = 1 - this.intensity * 0.35;
    return this;
  }

  _animateRain(dt, focus) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    // Slight lean, the way wind-driven rain looks.
    q.setFromEuler(new THREE.Euler(0, 0, 0.10));

    const visible = Math.ceil(RAIN_COUNT * Math.max(0.15, this.intensity));
    for (let i = 0; i < RAIN_COUNT; i++) {
      const d = this._drop[i];
      if (i >= visible) {
        // Park the unused drops out of sight rather than resizing the buffer.
        m.makeScale(0, 0, 0);
        this.rain.setMatrixAt(i, m);
        continue;
      }
      d.y -= d.speed * dt;
      if (d.y < 0) {
        d.y += RAIN_HEIGHT;
        const angle = this._rng() * Math.PI * 2;
        const radius = Math.sqrt(this._rng()) * RAIN_RADIUS;
        d.x = Math.cos(angle) * radius;
        d.z = Math.sin(angle) * radius;
      }
      pos.set(d.x, d.y, d.z);
      scale.set(1, d.len * (0.8 + this.intensity * 0.5), 1);
      m.compose(pos, q, scale);
      this.rain.setMatrixAt(i, m);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }

  _animateSplashes(dt, focus) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const spawnRate = 55 * this.intensity;

    this._splashAcc = (this._splashAcc || 0) + spawnRate * dt;
    while (this._splashAcc >= 1) {
      this._splashAcc -= 1;
      const free = this._splash.find((s) => s.life <= 0);
      if (!free) break;
      const angle = this._rng() * Math.PI * 2;
      const radius = Math.sqrt(this._rng()) * RAIN_RADIUS * 0.8;
      free.x = Math.cos(angle) * radius;
      free.z = Math.sin(angle) * radius;
      free.life = 0.42;
      free.maxLife = 0.42;
    }

    for (let i = 0; i < SPLASH_COUNT; i++) {
      const s = this._splash[i];
      if (s.life > 0) {
        s.life -= dt;
        const t = 1 - Math.max(0, s.life) / s.maxLife;
        pos.set(s.x, 0.016, s.z);
        const k = 0.4 + t * 1.5;
        scale.set(k, 1, k);
      } else {
        pos.set(0, -50, 0);
        scale.set(0.001, 0.001, 0.001);
      }
      m.compose(pos, q, scale);
      this.splashes.setMatrixAt(i, m);
    }
    this.splashes.instanceMatrix.needsUpdate = true;
  }

  /** Colour/fog hints for DayNight, or null when it is dry. */
  get overlay() {
    if (this.intensity < 0.01) return null;
    return {
      amount: this.intensity,
      fogMultiplier: 1 + this.intensity * 1.9,
      sunMultiplier: 1 - this.intensity * 0.72,
      ambientShift: 0.35 * this.intensity,
      wetness: this.wetness,
    };
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }
}

function rand(rng, a, b) { return a + rng() * (b - a); }

/** Small deterministic PRNG so weather can be tested. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { CYCLE as WEATHER_CYCLE };
