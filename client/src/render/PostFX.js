// client/src/render/PostFX.js
// Post-processing pipeline.
//
// Order matters:
//   RenderPass  -> draws the scene into a linear HDR buffer
//   GTAOPass    -> ground-truth ambient occlusion in the contact areas
//                  (under furniture, inside window reveals, along kerbs).
//                  Replaced SSAOPass: GTAO finds contact shadows in the same
//                  passes with fewer halos and no bright rim artefacts.
//   BloomPass   -> the warm glow of lit windows, signs and street lamps
//   SMAAPass    -> cleans up jagged edges that the composer's buffer loses
//   OutputPass  -> tone mapping + sRGB conversion for the final image
//
// Three quality tiers, chosen from the device at start-up and switchable from
// the UI. 'low' bypasses the composer entirely, which is the right default for
// older phones.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { isTouchDevice } from '../hud/TouchControls.js';

const QUALITY = {
  low:    { ao: false, bloom: false, smaa: false },
  medium: { ao: false, bloom: true,  smaa: true  },
  high:   { ao: true,  bloom: true,  smaa: true  },
};

export class PostFX {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {'low'|'medium'|'high'} quality
   */
  constructor(renderer, scene, camera, quality = 'high') {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    this.width = Math.max(1, size.x);
    this.height = Math.max(1, size.y);

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(this.width, this.height);
    this.composer.setPixelRatio(renderer.getPixelRatio());

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // ── Ambient occlusion ──
    // radius/thickness are in world metres: this city is ~200 m across with
    // 3 m storeys, so contact shadows want roughly a metre of reach.
    this.gtaoPass = new GTAOPass(scene, camera, this.width, this.height);
    this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    this.gtaoPass.blendIntensity = 0.9;
    this.gtaoPass.updateGtaoMaterial({
      radius: 1.1,
      distanceExponent: 1.4,
      thickness: 1.6,
      scale: 1.0,
      samples: 16,
      distanceFallOff: 1.0,
    });
    this.gtaoPass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 6,
      rings: 2,
      samples: 16,
    });
    this.composer.addPass(this.gtaoPass);
    // Backwards-compatible alias for anything that still reaches for ssaoPass.
    this.ssaoPass = this.gtaoPass;

    // ── Bloom ──
    // Two looks, one pass. By day the bloom is barely there — just enough to
    // soften a white wall in the sun. After dark the city is lit by lamps and
    // windows, so the bloom is stronger, tighter and reaches lower: that is what
    // turns a glowing lamp into a pool of light and a lit tower into a skyline.
    this.bloomDay = { strength: 0.36, radius: 0.72, threshold: 0.86 };
    this.bloomNight = { strength: 0.85, radius: 0.62, threshold: 0.42 };
    this.nightFactor = 0;
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      this.bloomDay.strength,   // subtle, so daylight does not haze over
      this.bloomDay.radius,
      this.bloomDay.threshold,  // only genuinely bright things glow
    );
    this.composer.addPass(this.bloomPass);

    // ── Anti-aliasing ──
    this.smaaPass = new SMAAPass(
      this.width * renderer.getPixelRatio(),
      this.height * renderer.getPixelRatio()
    );
    this.composer.addPass(this.smaaPass);

    // ── Tone map + colour space ──
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.quality = 'high';
    this.setQuality(quality);
  }

  /**
   * Toggle AO independently of the quality tier (debug panel uses this).
   * `null` restores the tier's own setting.
   */
  setAOEnabled(enabled) {
    this.aoOverride = enabled;
    this._applyPassFlags();
  }

  /**
   * How dark it is, 0 (noon) → 1 (night). Blend the two bloom looks.
   * @param {number} factor
   */
  setNight(factor) {
    const f = Math.min(1, Math.max(0, Number.isFinite(factor) ? factor : 0));
    if (Math.abs(f - this.nightFactor) < 0.001) return this.nightFactor;
    this.nightFactor = f;
    const mix = (a, b) => a + (b - a) * f;
    this.bloomPass.strength = mix(this.bloomDay.strength, this.bloomNight.strength);
    this.bloomPass.radius = mix(this.bloomDay.radius, this.bloomNight.radius);
    this.bloomPass.threshold = mix(this.bloomDay.threshold, this.bloomNight.threshold);
    return this.nightFactor;
  }

  setBloomEnabled(enabled) {
    this.bloomOverride = enabled;
    this._applyPassFlags();
  }

  _applyPassFlags() {
    const q = QUALITY[this.quality] || QUALITY.high;
    this.gtaoPass.enabled = this.aoOverride ?? q.ao;
    this.bloomPass.enabled = this.bloomOverride ?? q.bloom;
    this.smaaPass.enabled = q.smaa;
  }

  /** Choose the set of passes to run. */
  setQuality(quality) {
    this.quality = QUALITY[quality] ? quality : 'high';
    this._applyPassFlags();

    // Cheap win: the composer's internal targets can drop to half resolution
    // on medium without a visible difference at normal viewing distance.
    if (quality === 'medium') {
      this.composer.setPixelRatio(Math.min(this.renderer.getPixelRatio(), 1));
    } else {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }
    return this.quality;
  }

  /** Point the pipeline at a different scene (used when entering interiors). */
  setScene(scene) {
    this.scene = scene;
    this.renderPass.scene = scene;
    this.gtaoPass.scene = scene;
    // The AO pass re-renders its own g-buffer; force it after a scene swap.
    this.gtaoPass._renderGBuffer = true;
  }

  setSize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer.setSize(this.width, this.height);
    this.gtaoPass.setSize(this.width, this.height);
    this.bloomPass.setSize(this.width, this.height);
    const pr = this.renderer.getPixelRatio();
    this.smaaPass.setSize(this.width * pr, this.height * pr);
  }

  render() {
    if (this.quality === 'low') {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render();
  }
}

/**
 * Pick a starting quality tier for this device.
 * No user agent sniffing beyond touch capability — this is about fill rate.
 */
export function detectQuality() {
  // An explicit choice always wins: ?q=low is how a player on a weak laptop,
  // and how the screenshot harness on software WebGL, asks for the cheap path.
  const forced = typeof location !== 'undefined'
    ? new URLSearchParams(location.search).get('q')
    : null;
  if (forced === 'low' || forced === 'medium' || forced === 'high') return forced;
  const isTouch = isTouchDevice();
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 720;
  const lowDpr = window.devicePixelRatio < 1.5;

  if (isTouch && (smallScreen || lowDpr)) return 'low';
  if (isTouch) return 'medium';
  return 'high';
}
