// client/src/render/NightLights.js
// Real light after dark.
//
// The lamp heads are emissive, which draws a bright white ball — but an emissive
// ball lights nothing. The pavement under it stays as dark as the pavement thirty
// metres away, and a street at night looks like a row of glowing dots floating in
// a void.
//
// Lighting every lamp with a real point light is impossible: Eko Basin has
// hundreds of them, and WebGL dies somewhere around twenty. So this keeps a small
// pool (ten) of warm point lights and re-seats them, every few frames, on the
// lamps *nearest the player*. Wherever the player stands, the lamps around them
// are lit; the ones four hundred metres away are not lit, which nobody can see.
//
// The pool is seamless because the re-seat is distance-sorted and the light
// intensity eases — a lamp that swaps out is always the most distant one, which
// is already outside its own falloff radius.
//
// The bridge lamps are handed in through the same list (see EkoBuilder's
// `bridgeLampPositions`), so a crossing is lit deck-level the whole way over and
// the bridge does not turn into a black hole in the middle of the lagoon.

import * as THREE from 'three';
import { materials } from '../world/materials.js';

/** How many real point lights exist at once. */
const POOL = 10;

/** Point-light reach, in metres. */
const RANGE = 26;

/** Point-light strength at full night. */
const INTENSITY = 22;

/** Lamp head height when a position does not carry its own y. */
const DEFAULT_HEAD_Y = 4.6;

/** How often the pool may be re-seated, in seconds. */
const RESEAT_INTERVAL = 0.35;

/** Daylight above which the lamps are off entirely. */
const DAY_CUTOFF = 0.62;

export class NightLights {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [o]
   * @param {Array<{x:number,z:number,y?:number}>} [o.positions] lamp heads
   * @param {number} [o.count] lights in the pool
   */
  constructor(scene, { positions = [], count = POOL } = {}) {
    this.scene = scene;
    this.positions = positions.filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.z));
    this.count = Math.max(1, Math.min(count, this.positions.length || count));

    /** 0 in daylight, 1 at full night. Read by PostFX and the HUD. */
    this.nightFactor = 0;

    this._sinceReseat = RESEAT_INTERVAL;
    this._seated = [];

    // Pre-sort once by nothing; the pool re-seats on distance each time.
    const group = new THREE.Group();
    group.name = 'night-lights';
    this.group = group;
    scene.add(group);

    /** @type {THREE.PointLight[]} */
    this.lights = [];
    for (let i = 0; i < this.count; i++) {
      const light = new THREE.PointLight(0xffd9a0, 0, RANGE, 2);
      light.castShadow = false; // ten shadow casters would halve the frame rate
      light.visible = false;
      light.name = `night-light-${i}`;
      group.add(light);
      this.lights.push(light);
    }
  }

  /**
   * @param {number} dt seconds since the last frame
   * @param {object} [state]
   * @param {{x:number,y:number,z:number}} [state.player] the avatar, if any
   * @param {number} [state.daylight] 0 at night, 1 at noon (from DayNight)
   */
  update(dt, { player = null, daylight = 1 } = {}) {
    const step = Math.min(Math.max(dt, 0), 0.1);
    const day = Number.isFinite(daylight) ? daylight : 1;

    // Night factor: 0 while the sun is up, ramping to 1 as it sets. The ramp is
    // deliberately wide (0.62 → 0.16 of daylight) so dusk is a gradual warm-up
    // rather than a switch, and it is eased so no frame can jump.
    const raw = Math.min(1, Math.max(0, (DAY_CUTOFF - day) / (DAY_CUTOFF - 0.16)));
    const target = raw * raw * (3 - 2 * raw); // smoothstep
    this.nightFactor += (target - this.nightFactor) * Math.min(1, step * 3.5);
    if (Math.abs(target - this.nightFactor) < 0.002) this.nightFactor = target;

    // The emissive windows and lamp heads glow only as much as it is dark: a lit
    // window at noon looks like a bug, not a building.
    materials.setNightFactor(this.nightFactor);

    const on = this.nightFactor > 0.02;
    if (!on) {
      for (const light of this.lights) light.visible = false;
      return this.nightFactor;
    }

    this._sinceReseat += step;
    if (this._sinceReseat >= RESEAT_INTERVAL) {
      this._sinceReseat = 0;
      this._reseat(player);
    }

    const intensity = INTENSITY * this.nightFactor;
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const seat = this._seated[i];
      const want = seat ? intensity : 0;
      // Ease so a re-seat cannot pop: the light goes dark before it moves.
      light.intensity += (want - light.intensity) * Math.min(1, step * 6);
      light.visible = light.intensity > 0.05;
    }
    return this.nightFactor;
  }

  /** Put the pool on the lamps nearest the player. */
  _reseat(player) {
    const px = Number.isFinite(player?.x) ? player.x : 0;
    const pz = Number.isFinite(player?.z) ? player.z : 0;

    const scored = [];
    for (const p of this.positions) {
      const d = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
      scored.push({ p, d });
    }
    scored.sort((a, b) => a.d - b.d);

    this._seated = [];
    for (let i = 0; i < this.lights.length; i++) {
      const entry = scored[i];
      if (!entry) { this._seated[i] = null; continue; }
      const { p } = entry;
      const light = this.lights[i];
      light.position.set(
        p.x,
        Number.isFinite(p.y) ? p.y : DEFAULT_HEAD_Y,
        p.z,
      );
      this._seated[i] = p;
    }
  }

  /** Counts for the HUD, the debug window and the screenshot harness. */
  getStats() {
    return {
      pool: this.lights.length,
      lit: this.lights.filter((l) => l.visible).length,
      candidates: this.positions.length,
      nightFactor: Number(this.nightFactor.toFixed(3)),
    };
  }

  dispose() {
    for (const light of this.lights) {
      light.parent?.remove(light);
      light.dispose?.();
    }
    this.lights.length = 0;
    this.scene.remove(this.group);
  }
}
