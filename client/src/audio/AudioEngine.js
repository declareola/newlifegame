// client/src/audio/AudioEngine.js
// Every sound in NewLife, synthesised — there are no audio files.
//
// The game had no audio at all: no AudioContext, no <audio>, nothing. A city
// with no footsteps, no horns and no hum reads as a tech demo no matter how many
// polygons are in it, so this module is the whole soundtrack: footsteps per
// ground surface, an ambience bed per place (street, market, interior, church,
// rain), UI feedback, money, thunder and car horns.
//
// Everything is built from oscillators and generated noise buffers, so it costs
// no downloads and stays inside the project's "no external assets" rule.
//
// Design notes
//   · the context is created lazily on the first user gesture — browsers block
//     audio before that, and creating it early just logs a warning
//   · four buses (master → compressor → destination, with sfx/ambience/music
//     children) so a settings slider can move one layer without touching others
//   · volume settings persist in localStorage and are clamped on load
//   · every public method is a no-op when WebAudio is unavailable, so the game
//     (and the jsdom tests) run exactly the same without it

const STORAGE_KEY = 'newlife.audio';

const DEFAULT_SETTINGS = {
  master: 0.8,
  sfx: 0.9,
  ambience: 0.55,
  music: 0.35,
  muted: false,
};

const BUSES = ['sfx', 'ambience', 'music'];

/** Ground surfaces the player can walk on, and how they sound. */
export const SURFACES = {
  asphalt:  { freq: 220, q: 1.1, decay: 0.11, gain: 0.30, tone: 'thud' },
  pavement: { freq: 480, q: 1.4, decay: 0.09, gain: 0.24, tone: 'click' },
  tile:     { freq: 1200, q: 2.2, decay: 0.07, gain: 0.20, tone: 'click' },
  wood:     { freq: 320, q: 1.8, decay: 0.12, gain: 0.26, tone: 'hollow' },
  grass:    { freq: 160, q: 0.7, decay: 0.14, gain: 0.16, tone: 'soft' },
};

/** The ambience bed that plays in each kind of place. */
export const AMBIENCES = {
  street:   { bed: 'traffic', bedGain: 0.35, events: ['horn', 'traffic_pass'], every: [7, 16] },
  market:   { bed: 'chatter', bedGain: 0.45, events: ['chatter', 'horn', 'traffic_pass'], every: [2.5, 6] },
  indoor:   { bed: 'hum',     bedGain: 0.22, events: ['creak', 'chatter'], every: [12, 26] },
  church:   { bed: 'room',    bedGain: 0.18, events: ['bell'], every: [20, 40] },
  night:    { bed: 'traffic', bedGain: 0.22, events: ['horn', 'cricket'], every: [6, 14] },
  rain:     { bed: 'rain',    bedGain: 0.5,  events: ['thunder', 'traffic_pass'], every: [10, 24] },
  none:     { bed: null, bedGain: 0, events: [], every: [1, 1] },
};

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const rand = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  /**
   * @param {object} [o]
   * @param {object} [o.storage] - localStorage-compatible store (tests inject one)
   * @param {function} [o.contextFactory] - () => AudioContext (tests inject a fake)
   */
  constructor({ storage = safeStorage(), contextFactory = null } = {}) {
    this.storage = storage;
    this._contextFactory = contextFactory
      || (() => globalThis.AudioContext || globalThis.webkitAudioContext || null);

    this.ctx = null;
    this.master = null;
    this.buses = {};
    this.settings = this._loadSettings();
    this.available = typeof this._contextFactory === 'function' && !!this._contextFactory();

    this.ambience = 'none';
    this._ambienceTimer = 0;
    this._ambienceNodes = null;
    this._stepDistance = 0;
    this._stepSide = 0;
    this._lastPlay = new Map();   // name -> time, so a sound cannot machine-gun
    this._disposed = false;
    this._noise = null;
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /**
   * Create the audio graph. Browsers only allow this after a user gesture, so
   * main.js calls it from the first click/keypress.
   */
  resume() {
    if (this._disposed) return false;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume?.();
      return true;
    }
    if (!this.available) return false;

    let ctx;
    try {
      ctx = this._contextFactory();
    } catch {
      this.available = false;
      return false;
    }
    if (!ctx || typeof ctx.createGain !== 'function') { this.available = false; return false; }

    this.ctx = ctx;

    // master → compressor → speakers. The compressor keeps a horn + a footstep +
    // thunder from clipping when they land on the same frame.
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor?.();
    if (comp) {
      comp.threshold.value = -14;
      comp.knee.value = 24;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master.connect(comp);
      comp.connect(ctx.destination);
    } else {
      this.master.connect(ctx.destination);
    }

    for (const name of BUSES) {
      const g = ctx.createGain();
      g.gain.value = this.settings.muted ? 0 : this.settings[name];
      g.connect(this.master);
      this.buses[name] = g;
    }
    this.master.gain.value = this.settings.muted ? 0 : this.settings.master;

    this._noise = this._makeNoiseBuffer(2);
    return true;
  }

  dispose() {
    this._disposed = true;
    this._stopAmbience();
    try { this.ctx?.close?.(); } catch { /* already gone */ }
    this.ctx = null;
  }

  // ── Settings ───────────────────────────────────────────────

  getVolume(bus) { return this.settings[bus] ?? 0; }
  isMuted() { return !!this.settings.muted; }

  /** @param {'master'|'sfx'|'ambience'|'music'} bus */
  setVolume(bus, value) {
    if (!(bus in DEFAULT_SETTINGS) || bus === 'muted') return false;
    const v = clamp01(value);
    this.settings[bus] = v;
    this._applyGains();
    this._saveSettings();
    return true;
  }

  setMuted(muted) {
    this.settings.muted = !!muted;
    this._applyGains();
    this._saveSettings();
    return this.settings.muted;
  }

  toggleMute() { return this.setMuted(!this.settings.muted); }

  _applyGains() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const mute = this.settings.muted ? 0 : 1;
    const ramp = (node, target) => {
      if (!node) return;
      const g = node.gain;
      if (g.setTargetAtTime) g.setTargetAtTime(target, now, 0.03);
      else g.value = target;
    };
    ramp(this.master, this.settings.master * mute);
    for (const name of BUSES) ramp(this.buses[name], this.settings[name] * mute);
  }

  _loadSettings() {
    const out = { ...DEFAULT_SETTINGS };
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return out;
      const saved = JSON.parse(raw);
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (k === 'muted') out.muted = !!saved.muted;
        else if (Number.isFinite(saved[k])) out[k] = clamp01(saved[k]);
      }
    } catch { /* corrupt prefs are not fatal */ }
    return out;
  }

  _saveSettings() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* private mode */ }
  }

  // ── Graph helpers ──────────────────────────────────────────

  _makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate || 44100;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buffer = ctx.createBuffer(1, len, rate);
    const data = buffer.getChannelData(0);
    // Brown-ish noise: pink enough to sound like air, not like a hiss.
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  /** A filtered noise burst — the basis of footsteps, impacts and rain. */
  _noiseBurst({ t0, dur, freq, q = 1.2, gain = 0.25, bus = 'sfx', type = 'bandpass', attack = 0.004 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.buses[bus] || this.buses.sfx || this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    return { src, env, filter };
  }

  /** A pitched blip. */
  _tone({ t0, dur, from, to = null, type = 'sine', gain = 0.2, bus = 'sfx', attack = 0.006 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    if (to && to !== from && osc.frequency.exponentialRampToValueAtTime) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(env);
    env.connect(this.buses[bus] || this.buses.sfx || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    return { osc, env };
  }

  // ── One-shots ──────────────────────────────────────────────

  /**
   * Play a named sound.
   * @param {string} name
   * @param {object} [opts] - { gain, surface, pan }
   * @returns {boolean} whether it actually played
   */
  play(name, opts = {}) {
    if (!this.ctx || this.settings.muted) return false;
    const t0 = this.ctx.currentTime + 0.001;
    const g = opts.gain ?? 1;

    // Nothing may fire twice inside its own minimum gap — a player walking into
    // a wall should not turn a footstep into a machine gun.
    const gap = MIN_GAP[name] || 0;
    if (gap > 0) {
      const last = this._lastPlay.get(name) || 0;
      if (t0 - last < gap) return false;
      this._lastPlay.set(name, t0);
    }

    switch (name) {
      case 'click':
        this._tone({ t0, dur: 0.055, from: 880, to: 620, type: 'square', gain: 0.10 * g });
        return true;
      case 'hover':
        this._tone({ t0, dur: 0.03, from: 1400, gain: 0.03 * g, type: 'sine' });
        return true;
      case 'open':
        this._noiseBurst({ t0, dur: 0.22, freq: 900, q: 0.8, gain: 0.10 * g });
        this._tone({ t0, dur: 0.18, from: 420, to: 720, gain: 0.05 * g });
        return true;
      case 'close':
        this._tone({ t0, dur: 0.16, from: 640, to: 320, gain: 0.06 * g });
        this._noiseBurst({ t0, dur: 0.14, freq: 700, q: 0.8, gain: 0.07 * g });
        return true;
      case 'error':
        this._tone({ t0, dur: 0.18, from: 150, to: 110, type: 'sawtooth', gain: 0.10 * g });
        this._tone({ t0: t0 + 0.09, dur: 0.16, from: 130, to: 95, type: 'sawtooth', gain: 0.08 * g });
        return true;
      case 'success':
        [660, 880, 1320].forEach((f, i) => {
          this._tone({ t0: t0 + i * 0.07, dur: 0.16, from: f, gain: 0.07 * g });
        });
        return true;
      case 'cash':
        this._tone({ t0, dur: 0.10, from: 1568, gain: 0.09 * g });
        this._tone({ t0: t0 + 0.07, dur: 0.22, from: 2093, gain: 0.07 * g });
        this._noiseBurst({ t0, dur: 0.08, freq: 4200, q: 2.5, gain: 0.04 * g });
        return true;
      case 'pickup':
        this._tone({ t0, dur: 0.10, from: 520, to: 900, gain: 0.08 * g });
        return true;
      case 'door':
        this._noiseBurst({ t0, dur: 0.30, freq: 260, q: 1.6, gain: 0.10 * g, type: 'lowpass' });
        this._tone({ t0, dur: 0.25, from: 220, to: 160, type: 'triangle', gain: 0.05 * g });
        return true;
      case 'horn':
        this._tone({ t0, dur: 0.32, from: 415, type: 'square', gain: 0.05 * g });
        this._tone({ t0, dur: 0.32, from: 523, type: 'square', gain: 0.04 * g });
        return true;
      case 'thunder':
        this._noiseBurst({ t0, dur: 1.6, freq: 120, q: 0.6, gain: 0.30 * g, type: 'lowpass' });
        this._noiseBurst({ t0: t0 + 0.25, dur: 2.0, freq: 70, q: 0.5, gain: 0.22 * g, type: 'lowpass' });
        return true;
      case 'bell':
        [523, 1046, 1568].forEach((f, i) => {
          this._tone({ t0: t0 + i * 0.02, dur: 1.4 - i * 0.3, from: f, gain: 0.05 * g });
        });
        return true;
      case 'cricket':
        for (let i = 0; i < 3; i++) {
          this._tone({ t0: t0 + i * 0.09, dur: 0.045, from: 4400, gain: 0.02 * g, type: 'triangle' });
        }
        return true;
      case 'need-warning':
        this._tone({ t0, dur: 0.12, from: 880, to: 660, type: 'triangle', gain: 0.07 * g });
        return true;
      case 'step':
        return this._step(opts.surface || 'pavement', g, t0);
      default:
        return false;
    }
  }

  _step(surface, gain = 1, t0 = null) {
    const s = SURFACES[surface] || SURFACES.pavement;
    const at = t0 ?? this.ctx.currentTime + 0.001;
    // Alternate feet get a slightly different pitch, the way real steps do.
    this._stepSide = 1 - this._stepSide;
    const detune = this._stepSide ? 1 : 0.93;
    this._noiseBurst({
      t0: at,
      dur: s.decay,
      freq: s.freq * detune,
      q: s.q,
      gain: s.gain * gain,
      type: s.tone === 'thud' ? 'lowpass' : 'bandpass',
    });
    if (s.tone === 'click') {
      this._tone({ t0: at, dur: 0.03, from: s.freq * 1.9, gain: 0.02 * gain, type: 'triangle' });
    }
    if (s.tone === 'hollow') {
      this._tone({ t0: at, dur: 0.07, from: 180, gain: 0.03 * gain, type: 'triangle' });
    }
    return true;
  }

  // ── Ambience ───────────────────────────────────────────────

  /** @param {'street'|'market'|'indoor'|'church'|'night'|'rain'|'none'} kind */
  setAmbience(kind) {
    if (!(kind in AMBIENCES)) kind = 'none';
    if (kind === this.ambience) return this.ambience;
    this.ambience = kind;
    this._ambienceTimer = rand(...AMBIENCES[kind].every) * 0.5;
    if (this.ctx) this._restartAmbience();
    return this.ambience;
  }

  _restartAmbience() {
    this._stopAmbience();
    if (!this.ctx || this.settings.muted) return;
    const def = AMBIENCES[this.ambience];
    if (!def || !def.bed) return;

    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t0);
    out.gain.linearRampToValueAtTime(def.bedGain, t0 + 1.2); // fade in, never a pop
    out.connect(this.buses.ambience || this.master);

    const nodes = { out, sources: [] };

    if (def.bed === 'traffic' || def.bed === 'rain' || def.bed === 'chatter' || def.bed === 'room') {
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      const cfg = {
        traffic: { type: 'lowpass', freq: 380, q: 0.7 },
        rain:    { type: 'bandpass', freq: 2200, q: 0.5 },
        chatter: { type: 'bandpass', freq: 780, q: 0.9 },
        room:    { type: 'lowpass', freq: 240, q: 0.6 },
      }[def.bed];
      filter.type = cfg.type;
      filter.frequency.value = cfg.freq;
      filter.Q.value = cfg.q;

      // A slow wobble makes the bed sound like traffic rather than a hiss.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.11;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = cfg.freq * 0.22;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start(t0);

      src.connect(filter);
      filter.connect(out);
      src.start(t0);
      nodes.sources.push(src, lfo);
    }

    if (def.bed === 'hum' || def.bed === 'traffic') {
      // Generator hum — Lagos runs on generators.
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = def.bed === 'hum' ? 50 : 38;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = def.bed === 'hum' ? 0.12 : 0.05;
      osc.connect(lp);
      lp.connect(g);
      g.connect(out);
      osc.start(t0);
      nodes.sources.push(osc);
    }

    this._ambienceNodes = nodes;
  }

  _stopAmbience() {
    const nodes = this._ambienceNodes;
    this._ambienceNodes = null;
    if (!nodes || !this.ctx) return;
    const t = this.ctx.currentTime;
    try {
      nodes.out.gain.cancelScheduledValues?.(t);
      nodes.out.gain.setTargetAtTime(0, t, 0.2);
    } catch { /* node already gone */ }
    // Stop a beat later so the fade is audible.
    setTimeout(() => {
      for (const s of nodes.sources) { try { s.stop(); } catch { /* already stopped */ } }
      try { nodes.out.disconnect(); } catch { /* already disconnected */ }
    }, 900);
  }

  // ── Per-frame ──────────────────────────────────────────────

  /**
   * Drive footsteps and ambience events from the real player state.
   *
   * @param {number} dt seconds
   * @param {object} state
   * @param {boolean} [state.moving]
   * @param {number}  [state.speed]      metres/second
   * @param {boolean} [state.grounded]
   * @param {string}  [state.surface]    key of SURFACES
   * @param {number}  [state.hour]       0–24, for night ambience
   * @param {boolean} [state.inside]
   * @param {boolean} [state.raining]
   * @param {string}  [state.place]      'market' | 'church' | null
   */
  update(dt, state = {}) {
    if (!this.ctx || this.settings.muted) return;

    // ── Footsteps: driven by distance walked, not by time, so a slow walk is
    //    quiet and a sprint is a run of steps.
    const speed = state.moving ? Math.max(0, state.speed || 0) : 0;
    if (speed > 0.4 && state.grounded !== false) {
      this._stepDistance += speed * dt;
      const stride = speed > 4.2 ? 0.95 : 1.45;   // metres per step
      if (this._stepDistance >= stride) {
        this._stepDistance = 0;
        this.play('step', { surface: state.surface || 'pavement', gain: Math.min(1, 0.5 + speed / 9) });
      }
    } else {
      this._stepDistance = 0;
    }

    // ── Ambience: pick the bed for where the player is, then fire events.
    const want = pickAmbience(state);
    if (want !== this.ambience) this.setAmbience(want);

    const def = AMBIENCES[this.ambience];
    if (!def || !def.events.length) return;
    this._ambienceTimer -= dt;
    if (this._ambienceTimer <= 0) {
      this._ambienceTimer = rand(...def.every);
      const event = def.events[Math.floor(Math.random() * def.events.length)];
      this.play(event, { gain: 0.7 });
    }
  }
}

/** Minimum gap between repeats of the same one-shot, in seconds. */
const MIN_GAP = {
  step: 0.14,
  click: 0.03,
  hover: 0.02,
  horn: 1.5,
  thunder: 6,
  bell: 10,
  cricket: 1.2,
  'need-warning': 4,
  cash: 0.25,
  error: 0.3,
};

/** Which ambience bed belongs to a given world state. */
export function pickAmbience(state = {}) {
  if (state.place === 'market') return 'market';
  if (state.place === 'church') return 'church';
  if (state.raining) return 'rain';
  if (state.inside) return 'indoor';
  const hour = Number.isFinite(state.hour) ? state.hour : 12;
  if (hour < 6 || hour >= 20) return 'night';
  return 'street';
}

function safeStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export { DEFAULT_SETTINGS as AUDIO_DEFAULTS };
