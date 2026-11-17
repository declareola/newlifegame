// client/src/world/DayNight.js
// Drives the sky, sun, fog and ambient light through a day/night cycle.
//
// Phase 0.00 = midnight   0.25 = sunrise (06:00)
//     0.50 = noon        0.75 = sunset  (18:00)
//
// The phase comes from the absolute clock, so every client sees the same sky at
// the same moment.
//
// What changed in the realism pass:
//   · the sun's position now comes from real geometry (render/atmosphere.js)
//     instead of an ad-hoc sinusoid, so elevation and azimuth agree
//   · fog is exponential and tinted from the sky's *horizon* colour, which is
//     what makes distance read as distance
//   · the light/ambient colours come from one palette, so the sun, the fog and
//     the ambient fill never disagree about the time of day
//   · the directional light's *position* is owned by ShadowRig now (it follows
//     the player); this class only sets its colour and intensity

import * as THREE from 'three';
import {
  DAY_LENGTH_MS,
  sunElevation,
  sunDirection,
  skyPalette,
  fogDensity,
} from '../render/atmosphere.js';

/** The colour rain mixes into every light. */
const WEATHER_GREY = new THREE.Color(0x6d7784);

export class DayNight {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.DirectionalLight} sunLight
   * @param {THREE.AmbientLight} ambientLight
   * @param {object} [options]
   * @param {function} [options.onSunChange] (state) => void, called every update
   * @param {boolean} [options.useSky] false keeps the old flat-colour backdrop
   * @param {boolean} [options.manageBackground] false leaves scene.background to
   *   whoever owns the sky (SkyEnvironment bakes it into a cube map; if this
   *   class also wrote a flat colour every frame it would erase the sky)
   */
  constructor(scene, sunLight, ambientLight, options = {}) {
    this.scene = scene;
    this.sunLight = sunLight;
    this.ambientLight = ambientLight;
    this.onSunChange = options.onSunChange || null;
    this.useSky = options.useSky !== false;
    this.manageBackground = options.manageBackground !== false;

    // Exponential fog: cheap, physically-plausible aerial perspective.
    this.scene.fog = new THREE.FogExp2(0xbcd7ea, 0.0045);

    // Scratch vectors/colours — reused every frame.
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this._horizon = new THREE.Color();
    this._sun = new THREE.Color();
    this._ambient = new THREE.Color();
    this._backgroundFallback = new THREE.Color(0x87ceeb);

    // Overrides settable from the debug panel.
    this.fogDensityOverride = null;

    this.phase = this._currentPhase();
    this.elevation = 0;
    this.daylight = 0;

    // Apply once immediately so the first rendered frame is already correct.
    this.update(0);
  }

  _currentPhase() {
    return (Date.now() % DAY_LENGTH_MS) / DAY_LENGTH_MS;
  }

  /** Human-readable clock label, e.g. "18:42". */
  get clockLabel() {
    const totalMinutes = (this.phase * 24 * 60) % (24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = Math.floor(totalMinutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /** Is the sun below the horizon? (used to dim the HUD clock) */
  get isNight() {
    return this.elevation < -0.02;
  }

  /**
   * Weather overlay: rain darkens the sun, greys the horizon, thickens the fog
   * and cools the ambient fill. Set every frame by main.js from Weather.overlay;
   * `null` means clear skies.
   * @param {{amount:number, fogMultiplier:number, sunMultiplier:number, ambientShift:number}|null} overlay
   */
  setWeather(overlay) {
    this._weather = overlay || null;
  }

  update(_deltaTime) {
    this.phase = this._currentPhase();

    const elevation = sunElevation(this.phase);
    this.elevation = elevation;
    sunDirection(this.phase, this.sunDir);

    const palette = skyPalette(elevation);
    this.daylight = palette.daylight;

    // Copy out of the palette's scratch colours before anything else uses them.
    this._horizon.copy(palette.horizon);
    this._sun.copy(palette.sun);
    this._ambient.copy(palette.ambient);

    // ── Weather ──
    // One grey colour is mixed into the horizon, the sun and the ambient fill,
    // scaled by how hard it is raining, so the whole palette agrees.
    const w = this._weather;
    const amount = w ? Math.min(1, Math.max(0, w.amount || 0)) : 0;
    let sunScale = 1;
    let fogScale = 1;
    if (amount > 0) {
      const grey = WEATHER_GREY;
      this._horizon.lerp(grey, amount * 0.55);
      this._sun.lerp(grey, amount * 0.45);
      this._ambient.lerp(grey, amount * 0.4);
      sunScale = w.sunMultiplier ?? 1 - amount * 0.7;
      fogScale = w.fogMultiplier ?? 1 + amount * 1.9;
    }

    // ── Lights ── (position is ShadowRig's job)
    this.sunLight.color.copy(this._sun);
    this.sunLight.intensity = palette.sunIntensity * sunScale;
    this.ambientLight.color.copy(this._ambient);
    this.ambientLight.intensity = palette.ambientIntensity * (1 - amount * 0.15);

    // ── Backdrop fallback ──
    // Only touched when this class owns the background. With a baked sky cube in
    // scene.background, writing a flat colour here would wipe it out every frame.
    if (!this.manageBackground) {
      // the sky (or whoever else) owns it
    } else if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(this._horizon);
    } else {
      this.scene.background = this._backgroundFallback.copy(this._horizon);
    }

    // ── Fog ──
    // Tinted with the horizon colour so distant geometry dissolves into the
    // sky it is silhouetted against.
    if (this.scene.fog) {
      this.scene.fog.color.copy(this._horizon);
      this.scene.fog.density = (this.fogDensityOverride ?? fogDensity(elevation)) * fogScale;
    }

    if (this.onSunChange) {
      this.onSunChange({
        phase: this.phase,
        elevation,
        daylight: this.daylight,
        direction: this.sunDir,
        horizonColor: this._horizon,
        skyEnabled: this.useSky,
        weather: amount,
      });
    }
  }
}
