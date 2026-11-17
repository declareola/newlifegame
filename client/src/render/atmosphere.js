// client/src/render/atmosphere.js
// Sun geometry, sky palette and fog — the pure maths behind the lighting.
//
// Everything here is deliberately free of WebGL so it can be unit-tested in
// Node. The GPU-side pieces (the Sky shader, the PMREM environment probe) live
// in SkyEnvironment.js and only consume what this module computes.
//
// Phase convention, used by DayNight:
//   0.00 = midnight   0.25 = sunrise (06:00)   0.50 = noon   0.75 = sunset (18:00)

import * as THREE from 'three';

/**
 * One in-game day lasts 60 real minutes, shared by every client.
 *
 * This was 8 minutes, which sounds generous until you try to play in it: an
 * evening lasted about 80 real seconds, night fell while you were reading a
 * shop list, and any job or mission that expects "do this today" could not be
 * finished before the clock rolled over. The blueprint's story runs on a
 * thirty-day act, and a day that a player can actually live in is the unit that
 * makes that structure playable rather than decorative.
 *
 * At an hour a day: one in-game hour is 2.5 real minutes, an evening is about
 * a quarter of an hour, and a thirty-day act is a month of sessions — which is
 * what "thirty days left" in the prologue is asking for.
 *
 * Change this one constant and the clock, the sun, the sky and the HUD all
 * follow; nothing else hard-codes a day length.
 */
export const DAY_LENGTH_MS = 60 * 60 * 1000;

/** The sun never gets further than this from the horizon (~62°). */
const MAX_ELEVATION = THREE.MathUtils.degToRad(62);

/** Elevation above which the sky counts as fully daylight. */
const FULL_DAY_ELEVATION = THREE.MathUtils.degToRad(18);

/**
 * Sun elevation in radians for a day phase.
 * @param {number} phase 0..1 (wraps)
 * @returns {number} -MAX_ELEVATION (midnight) .. +MAX_ELEVATION (noon)
 */
export function sunElevation(phase) {
  const t = ((phase % 1) + 1) % 1;
  return Math.sin((t - 0.25) * Math.PI * 2) * MAX_ELEVATION;
}

/**
 * Unit vector pointing from the ground toward the sun.
 * Azimuth sweeps east → west over the day.
 *
 * @param {number} phase 0..1
 * @param {THREE.Vector3} [target] reused to avoid per-frame allocation
 * @returns {THREE.Vector3}
 */
export function sunDirection(phase, target = new THREE.Vector3()) {
  const elevation = sunElevation(phase);
  const t = ((phase % 1) + 1) % 1;
  const azimuth = (t - 0.25) * Math.PI * 2 + Math.PI / 2;

  const horizontal = Math.cos(elevation);
  return target.set(
    horizontal * Math.cos(azimuth),
    Math.sin(elevation),
    horizontal * Math.sin(azimuth)
  ).normalize();
}

// ── Palette ──────────────────────────────────────────────────
// Chosen so the horizon stays warm near sunrise/sunset and cool at noon, which
// is what makes aerial perspective read as distance rather than as grey haze.

const NIGHT_HORIZON = new THREE.Color(0x0a1020);
const DUSK_HORIZON = new THREE.Color(0xf2915a);
const DAY_HORIZON = new THREE.Color(0xbcd7ea);

const NIGHT_SUN = new THREE.Color(0x9fb4e6);
const DUSK_SUN = new THREE.Color(0xffa552);
const DAY_SUN = new THREE.Color(0xfff6e8);

const NIGHT_AMBIENT = new THREE.Color(0x2a3358);
const DAY_AMBIENT = new THREE.Color(0x9fb8d8);

// Scratch colours — skyPalette() writes into these, so it must not be held
// across frames. Callers copy what they need.
const _horizon = new THREE.Color();
const _sun = new THREE.Color();
const _ambient = new THREE.Color();

/**
 * Colours and light levels for a sun elevation.
 *
 * @param {number} elevation radians
 * @returns {{ horizon: THREE.Color, sun: THREE.Color, ambient: THREE.Color,
 *             daylight: number, sunIntensity: number, ambientIntensity: number }}
 *   NOTE: the returned Color instances are shared scratch objects.
 */
export function skyPalette(elevation) {
  const dayK = THREE.MathUtils.clamp(elevation / FULL_DAY_ELEVATION, 0, 1);
  const daylight = THREE.MathUtils.clamp(Math.sin(Math.max(elevation, 0)) / Math.sin(FULL_DAY_ELEVATION), 0, 1);

  if (elevation < 0) {
    // Below the horizon: fade from dusk warmth down into night as the sun sinks.
    const k = THREE.MathUtils.clamp((elevation + THREE.MathUtils.degToRad(12)) / THREE.MathUtils.degToRad(12), 0, 1);
    _horizon.copy(NIGHT_HORIZON).lerp(DUSK_HORIZON, k * 0.6);
    _sun.copy(NIGHT_SUN).lerp(DUSK_SUN, k * 0.7);
    _ambient.copy(NIGHT_AMBIENT).lerp(DAY_AMBIENT, k * 0.25);
  } else {
    _horizon.copy(DUSK_HORIZON).lerp(DAY_HORIZON, dayK);
    _sun.copy(DUSK_SUN).lerp(DAY_SUN, dayK);
    _ambient.copy(NIGHT_AMBIENT).lerp(DAY_AMBIENT, 0.25 + dayK * 0.75);
  }

  return {
    horizon: _horizon,
    sun: _sun,
    ambient: _ambient,
    daylight,
    // Sun-to-fill ratio is what decides whether a scene looks lit or flat. The
    // old pair was 1.25 : 0.65 at noon — the ambient was half as strong as the
    // sun, so nothing had a lit side and nothing had a shadow side. Outdoors the
    // sun should dominate and the sky should only fill: ~6:1 at noon.
    sunIntensity: 0.35 + daylight * 2.55,     // ≈ 2.90 at noon
    ambientIntensity: 0.12 + daylight * 0.34, // ≈ 0.46 at noon
  };
}

/**
 * Exponential fog density for an elevation.
 * Denser at night (the city feels enclosed), thinner at noon (long sight lines).
 */
export function fogDensity(elevation) {
  const dayK = THREE.MathUtils.clamp(elevation / FULL_DAY_ELEVATION, 0, 1);
  return THREE.MathUtils.lerp(0.0092, 0.0038, dayK);
}

// ── Shadows ──────────────────────────────────────────────────

/**
 * Metres of world covered by one shadow-map texel.
 * The previous rig used a 130 m half-extent, i.e. 260 m / 2048 = 0.127 m.
 *
 * @param {number} bound half-extent of the shadow camera, in metres
 * @param {number} mapSize shadow map resolution per side
 */
export function shadowTexelSize(bound, mapSize) {
  return (bound * 2) / mapSize;
}

/**
 * Snap a world coordinate to the shadow-map texel grid.
 * Without this the shadow camera slides continuously and shadow edges crawl
 * and shimmer as the player walks — the classic "shadow acne disco".
 */
export function snapToTexel(value, texel) {
  return Math.round(value / texel) * texel;
}

/** Half-extent that yields a target texel size, used by the debug panel. */
export function boundForTexelSize(targetTexel, mapSize) {
  return (targetTexel * mapSize) / 2;
}
