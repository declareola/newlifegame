// client/src/render/SkyEnvironment.js
// Physically-motivated sky + image-based lighting.
//
// Replaces the RoomEnvironment probe that used to light the outdoor city. That
// probe is a virtual *indoor photography studio*: every facade, car and window
// in Lagos was reflecting a white studio wall instead of a sky. This module
// generates the real thing with three's Sky shader and bakes it into an
// environment map with PMREMGenerator, so ambient light and reflections both
// agree with the sun.
//
// The visible backdrop is a *baked cubemap*, not a mesh. A Sky mesh is a 500 m
// box: it has to fit inside the camera's far plane, it has to survive the
// post-processing chain, and it has to be re-centred as the player walks. Baking
// the same shader into a cube render target and handing it to scene.background
// removes all three failure modes — the background cannot be clipped, fogged or
// hidden behind a post pass, and it costs one draw call.
//
// The same private scene also feeds the PMREM probe, so the backdrop and the
// ambient light can never disagree about where the sun is.
//
// Regenerating is not free, so it is throttled: only when the sun has moved
// meaningfully, and never more often than `regenIntervalMs`.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const DEFAULTS = {
  // 2 = crystal clear, 10 = hazy harmattan afternoon. The old 8/2.4 pair was
  // so hazy that ACES tone mapping crushed the zenith to near-white, which is
  // why the sky read as a flat pale sheet instead of blue.
  turbidity: 3.2,
  rayleigh: 1.8,
  mieCoefficient: 0.0038,
  mieDirectionalG: 0.74,
  regenIntervalMs: 2000, // hard floor between background/PMREM rebuilds
  elevationStep: 0.02,   // radians of sun movement that justifies a rebuild
};

export class SkyEnvironment {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {THREE.Scene} o.scene           the city scene
   * @param {object} [o.params]             override any of DEFAULTS
   */
  constructor({ renderer, scene, params = {} }) {
    this.renderer = renderer;
    this.scene = scene;
    this.params = { ...DEFAULTS, ...params };

    // ── Sky source scene (shared by the background bake and the IBL probe) ──
    // 450 units puts the box comfortably inside the far plane, which matters
    // because a cube render uses the same near/far it is given here.
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this._applyParams(this.envSky);
    this.envScene.add(this.envSky);

    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    // A cube *camera* is what renders a scene into a cube target in three r160
    // (WebGLCubeRenderTarget has no fromScene — only PMREMGenerator does).
    this.cubeCamera = new THREE.CubeCamera(1, 5000, this.cubeRT);

    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.rt = null;
    this.envEnabled = true;
    this.skyVisible = true;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this._fallbackBackground = new THREE.Color(0x9fc6e8);

    this._lastElevation = null;
    this._lastRegenAt = -Infinity;

    this.renderCount = 0;

    // ── Real skies ──
    // Equirectangular HDR photographs (Poly Haven, CC0), converted to an
    // environment map with PMREM. When one is active it *replaces* the shader
    // for both the backdrop and the light probe: reflections and background
    // then come from the same photograph, which is the whole point of an HDRI.
    this.equirects = new Map();   // name -> { texture, env }
    this.activeEquirect = null;
    this._equirectMode = false;
  }

  /**
   * Register an equirectangular sky photograph.
   * @param {string} name    'sky_day' | 'sky_dusk' | 'sky_night'
   * @param {THREE.Texture} texture already-mapped equirect texture
   * @returns {boolean} whether it was accepted
   */
  setEquirect(name, texture) {
    if (!texture || !this.renderer || !this.pmrem) return false;
    try {
      const env = this.pmrem.fromEquirectangular(texture);
      this.equirects.set(name, { texture, env });
      if (!this.activeEquirect) this.useEquirect(name);
      return true;
    } catch (err) {
      console.warn('[SkyEnvironment] could not build an HDRI probe', err);
      return false;
    }
  }

  /**
   * Switch the visible sky (and usually the light probe) to a photograph.
   *
   * `asEnvironment: false` uses the photograph as the backdrop only, leaving the
   * lighting to the procedural sky. That is what a night sky wants: the real
   * photograph is the honest thing to look at, but a night HDRI's moon makes a
   * terrible light source — it lights the whole city like an overcast noon.
   */
  useEquirect(name, { asEnvironment = true } = {}) {
    const entry = this.equirects.get(name);
    if (!entry) return false;
    this.activeEquirect = name;
    this._equirectMode = true;
    this._equirectEnv = asEnvironment;
    if (this.skyVisible) this.scene.background = entry.texture;
    if (asEnvironment) {
      if (this.envEnabled) this.scene.environment = entry.env.texture;
    } else {
      this._bakeProceduralEnv();
    }
    return true;
  }

  /** PMREM the shader sky into the light probe (no change to the backdrop). */
  _bakeProceduralEnv() {
    try {
      const previous = this.rt;
      this.rt = this.pmrem.fromScene(this.envScene, 0, 1, 5000);
      this.renderCount++;
      if (this.envEnabled) this.scene.environment = this.rt.texture;
      if (previous && previous !== this.rt) previous.dispose();
    } catch (err) {
      console.warn('[SkyEnvironment] procedural probe failed', err);
    }
  }

  /** Fall back to the procedural Sky shader. */
  useProceduralSky() {
    if (!this._equirectMode) return false;
    this._equirectMode = false;
    this.activeEquirect = null;
    this.regenerate();
    return true;
  }

  /** Which sky is on screen: an HDRI name, or 'procedural'. */
  get skyName() {
    return this._equirectMode ? this.activeEquirect : 'procedural';
  }

  _applyParams(sky) {
    const u = sky.material.uniforms;
    u.turbidity.value = this.params.turbidity;
    u.rayleigh.value = this.params.rayleigh;
    u.mieCoefficient.value = this.params.mieCoefficient;
    u.mieDirectionalG.value = this.params.mieDirectionalG;
  }

  /** Aim the sun. Cheap — call every frame. */
  setSun(direction) {
    this.sunDirection.copy(direction).normalize();
    this.envSky.material.uniforms.sunPosition.value.copy(this.sunDirection);
  }

  /**
   * Rebuild the environment probe if the sun has moved enough.
   * @param {number} elevation current sun elevation in radians
   * @param {number} now       performance.now()
   * @returns {boolean} whether a rebuild happened
   */
  update(elevation, now = performance.now()) {
    const movedEnough = this._lastElevation === null
      || Math.abs(elevation - this._lastElevation) >= this.params.elevationStep;
    const longEnough = now - this._lastRegenAt >= this.params.regenIntervalMs;

    if (!movedEnough || !longEnough) return false;

    this.regenerate();
    this._lastElevation = elevation;
    this._lastRegenAt = now;
    return true;
  }

  /** Force an immediate rebuild of both the visible sky and the light probe. */
  regenerate() {
    // With a photograph in charge, the shader bake would overwrite it. The sun
    // still moves — DayNight keeps its light — but the sky itself is fixed.
    if (this._equirectMode) {
      const entry = this.equirects.get(this.activeEquirect);
      if (entry && this.skyVisible) this.scene.background = entry.texture;
      if (this._equirectEnv) {
        if (entry && this.envEnabled) this.scene.environment = entry.env.texture;
      } else {
        // Backdrop is a photograph, lighting is the moving sky.
        this._bakeProceduralEnv();
      }
      return;
    }

    const previous = this.rt;

    // 1. Visible backdrop: render the sky shader into a cube map. One draw call
    //    at draw time, and no far-plane or post-processing exposure.
    try {
      this.cubeCamera.update(this.renderer, this.envScene);
      if (this.skyVisible) this.scene.background = this.cubeRT.texture;
    } catch (err) {
      // Never let a sky failure take the frame down: fall back to flat colour.
      console.warn('[SkyEnvironment] sky bake failed, using flat backdrop', err);
      this.scene.background = this._fallbackBackground;
    }

    // 2. Light probe: the same scene through PMREM, for reflections/ambient.
    this.rt = this.pmrem.fromScene(this.envScene, 0, 1, 5000);
    this.renderCount++;

    if (this.envEnabled) this.scene.environment = this.rt.texture;
    if (previous) previous.dispose();
  }

  setEnvironmentEnabled(enabled) {
    this.envEnabled = enabled;
    this.scene.environment = enabled && this.rt ? this.rt.texture : null;
  }

  /**
   * Show or hide the sky. Hidden falls back to a flat colour, which is what the
   * debug panel uses to prove how much of the look the sky is doing.
   */
  setSkyVisible(visible) {
    this.skyVisible = visible;
    this.scene.background = visible && this.rt ? this.cubeRT.texture : this._fallbackBackground;
  }

  get isSkyVisible() {
    return this.skyVisible;
  }

  setParams(next) {
    Object.assign(this.params, next);
    // Only the probe source exists now — the visible sky is baked from it.
    this._applyParams(this.envSky);
    // Parameters changed, so the probe is stale.
    this._lastElevation = null;
  }

  dispose() {
    this.envSky.material.dispose();
    this.envSky.geometry.dispose();
    this.pmrem.dispose();
    this.cubeRT.dispose();
    this.cubeCamera = null;
    if (this.rt) this.rt.dispose();
  }
}
