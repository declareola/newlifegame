// client/src/render/ShadowRig.js
// A tight, player-following shadow frustum.
//
// The previous rig covered a 260 × 260 m square with a 2048² map: 12.7 cm per
// texel, meaning a doorframe cast a shadow wider than the door handle. This rig
// keeps the map centred on the player with a much smaller half-extent, which
// multiplies the effective resolution without touching the map size.
//
// Two details that matter more than the numbers:
//   1. The target is snapped to the texel grid. Without snapping, the shadow
//      camera slides continuously with the player and shadow edges crawl and
//      shimmer — very visible on kerbs and railings.
//   2. `normalBias` is set alongside `bias`. Tighter texels make acne worse, and
//      normal-bias fixes it without the peter-panning that raw bias causes.

import * as THREE from 'three';
import { shadowTexelSize, snapToTexel } from './atmosphere.js';

const DEFAULTS = {
  mapSize: 2048,
  bound: 60,        // half-extent of the shadow camera, metres
  distance: 180,    // how far along the sun direction the light sits
  minSunHeight: 8,  // keep the light above ground even at night
};

export class ShadowRig {
  /**
   * @param {THREE.DirectionalLight} light
   * @param {object} [options]
   */
  constructor(light, options = {}) {
    this.light = light;
    this.config = { ...DEFAULTS, ...options };

    const cam = light.shadow.camera;
    cam.near = 1;
    cam.far = this.config.distance * 2.5;
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.06;

    light.castShadow = true;
    light.shadow.mapSize.set(this.config.mapSize, this.config.mapSize);

    this._applyBound();
  }

  /** Metres per shadow texel at the current settings. */
  get texelSize() {
    return shadowTexelSize(this.config.bound, this.config.mapSize);
  }

  _applyBound() {
    const cam = this.light.shadow.camera;
    cam.left = -this.config.bound;
    cam.right = this.config.bound;
    cam.top = this.config.bound;
    cam.bottom = -this.config.bound;
    cam.updateProjectionMatrix();
  }

  /**
   * @param {object} settings  { mapSize?, bound? }
   */
  configure(settings = {}) {
    Object.assign(this.config, settings);

    if (settings.mapSize) {
      this.light.shadow.mapSize.set(settings.mapSize, settings.mapSize);
      // A resolution change needs a fresh render target; three reallocates when
      // the existing map is disposed.
      if (this.light.shadow.map) {
        this.light.shadow.map.dispose();
        this.light.shadow.map = null;
      }
    }
    if (settings.bound) this._applyBound();
    return this.config;
  }

  setEnabled(enabled) {
    this.light.castShadow = enabled;
  }

  /**
   * Follow the player.
   * @param {{x:number,z:number}} position
   * @param {THREE.Vector3} sunDirection unit vector toward the sun
   */
  update(position, sunDirection) {
    if (!this.light.castShadow) return;

    const texel = this.texelSize;
    // Snap the centre so the shadow texel grid stays put as the player walks.
    const cx = snapToTexel(position.x, texel);
    const cz = snapToTexel(position.z, texel);

    const target = this.light.target;
    target.position.set(cx, 0, cz);
    target.updateMatrixWorld();

    const d = this.config.distance;
    const dir = sunDirection;
    this.light.position.set(
      cx + dir.x * d,
      Math.max(this.config.minSunHeight, dir.y * d),
      cz + dir.z * d
    );
  }
}
