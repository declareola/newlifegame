// client/test-audio.mjs
// The audio engine, driven by a fake WebAudio context.
//
// Node has no WebAudio, and the game has to work when a browser has none
// either, so the engine is written against the interface and tested against a
// stand-in that records every node it creates. That is enough to prove the
// things that actually break: silent buses, a mute that only mutes half the
// mix, footsteps that fire from a timer instead of from distance, and an
// ambience bed that never changes when you walk into a church.
//
//   node test-audio.mjs

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── A fake AudioContext ─────────────────────────────────────
function makeFakeContext() {
  const created = { gain: 0, osc: 0, buffer: 0, filter: 0, source: 0, comp: 0 };
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 8000,
    destination: { connect() {}, disconnect() {} },
    created,
    resume() { ctx.state = 'running'; },
    close() { ctx.state = 'closed'; },
    createBuffer(channels, len) {
      created.buffer++;
      const data = new Float32Array(len);
      return { getChannelData: () => data, length: len };
    },
    createGain() {
      created.gain++;
      const node = {
        gain: {
          value: 1,
          setValueAtTime: (v) => { node.gain.value = v; },
          linearRampToValueAtTime: (v) => { node.gain.value = v; },
          exponentialRampToValueAtTime: (v) => { node.gain.value = v; },
          setTargetAtTime: (v) => { node.gain.value = v; },
          cancelScheduledValues() {},
        },
        connect() {}, disconnect() {},
      };
      return node;
    },
    createOscillator() {
      created.osc++;
      return {
        type: 'sine',
        frequency: {
          value: 440,
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {}, disconnect() {},
        start() { nodeStarted.count++; }, stop() {},
      };
    },
    createBufferSource() {
      created.source++;
      return {
        buffer: null, loop: false,
        connect() {}, disconnect() {},
        start() { nodeStarted.count++; }, stop() {},
      };
    },
    createBiquadFilter() {
      created.filter++;
      return {
        type: 'lowpass',
        frequency: { value: 1000, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        Q: { value: 1 },
        connect() {}, disconnect() {},
      };
    },
    createDynamicsCompressor() {
      created.comp++;
      return {
        threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 },
        attack: { value: 0 }, release: { value: 0 },
        connect() {}, disconnect() {},
      };
    },
  };
  return ctx;
}
const nodeStarted = { count: 0 };

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// ── Imports ─────────────────────────────────────────────────
const { AudioEngine, pickAmbience, SURFACES, AUDIO_DEFAULTS } = await import('./src/audio/AudioEngine.js');

// ── No WebAudio at all ──────────────────────────────────────
console.log('\n[A browser with no audio]');
{
  const engine = new AudioEngine({ storage: makeStorage(), contextFactory: () => null });
  check('The engine reports itself unavailable', engine.available === false);
  check('resume() declines instead of throwing', engine.resume() === false);
  check('play() is a no-op', engine.play('click') === false);
  check('update() survives a frame', (() => {
    engine.update(0.016, { moving: true, speed: 3, surface: 'tile' });
    return true;
  })());
  check('setAmbience is still bookkeeping-only', engine.setAmbience('market') === 'market');
  engine.dispose();
  check('dispose() is safe with no context', true);
}

// ── Graph construction ──────────────────────────────────────
console.log('\n[The mix]');
const storage = makeStorage();
const contextFactory = () => makeFakeContext();
const audio = new AudioEngine({ storage, contextFactory });

check('A context is not created before a gesture', audio.ctx === null);
check('resume() creates one', audio.resume() === true && audio.ctx !== null);
check('A compressor sits before the speakers', audio.ctx.created.comp === 1);
check('Four gains exist: master + three buses',
  audio.ctx.created.gain === 4, `${audio.ctx.created.gain} gains`);
check('Every bus exists', ['sfx', 'ambience', 'music'].every((b) => audio.buses[b]));
check('Volumes start at their defaults',
  audio.getVolume('master') === AUDIO_DEFAULTS.master && audio.getVolume('sfx') === AUDIO_DEFAULTS.sfx);

audio.setVolume('sfx', 0.25);
check('A bus volume can be set', audio.getVolume('sfx') === 0.25);
check('…and reaches the gain node', Math.abs(audio.buses.sfx.gain.value - 0.25) < 0.001,
  String(audio.buses.sfx.gain.value));
audio.setVolume('sfx', 5);
check('Volume is clamped above', audio.getVolume('sfx') === 1);
audio.setVolume('sfx', -3);
check('Volume is clamped below', audio.getVolume('sfx') === 0);
check('An unknown bus is refused', audio.setVolume('nonsense', 0.5) === false);

const saved = JSON.parse(storage.getItem('newlife.audio'));
check('Settings persist to storage', typeof saved === 'object' && saved.master === AUDIO_DEFAULTS.master);

console.log('\n[Mute]');
audio.setVolume('sfx', 0.6);
audio.setMuted(true);
check('Muting silences every bus', audio.buses.sfx.gain.value === 0 && audio.master.gain.value === 0,
  `master ${audio.master.gain.value}`);
check('play() refuses while muted', audio.play('click') === false);
audio.setMuted(false);
check('Unmuting restores the bus', Math.abs(audio.buses.sfx.gain.value - 0.6) < 0.001);
check('toggleMute flips it', audio.toggleMute() === true && audio.toggleMute() === false);

console.log('\n[Persistence]');
{
  const first = new AudioEngine({ storage, contextFactory });
  first.resume();
  first.setVolume('music', 0.1);
  first.setMuted(true);
  const second = new AudioEngine({ storage, contextFactory });
  check('A new engine loads the saved volumes', second.getVolume('music') === 0.1, String(second.getVolume('music')));
  check('…including the mute flag', second.isMuted() === true);
  second.setMuted(false);
  first.dispose(); second.dispose();
}
{
  const corrupt = makeStorage({ 'newlife.audio': '{not json' });
  const engine = new AudioEngine({ storage: corrupt, contextFactory });
  check('Corrupt saved settings fall back to defaults',
    engine.getVolume('master') === AUDIO_DEFAULTS.master);
  engine.dispose();
}

// ── One-shots ───────────────────────────────────────────────
console.log('\n[One-shots]');
audio.setMuted(false);
{
  // The mute test above already clicked once; move past its debounce window.
  audio.ctx.currentTime += 1;
  const before = nodeStarted.count;
  check('A click plays', audio.play('click') === true);
  check('…and creates real nodes', nodeStarted.count > before);
  check('A second click inside the debounce window is dropped', audio.play('click') === false);

  audio.ctx.currentTime += 0.5;
  check('After the window it plays again', audio.play('click') === true);

  const names = ['open', 'close', 'error', 'success', 'cash', 'pickup', 'door', 'horn', 'thunder', 'bell', 'cricket', 'need-warning'];
  const missing = names.filter((n) => {
    audio.ctx.currentTime += 10;
    return audio.play(n) !== true;
  });
  check('Every named UI/world sound exists', missing.length === 0, missing.join(', ') || `${names.length} sounds`);

  audio.ctx.currentTime += 10;
  check('An unknown sound returns false', audio.play('kazoo') === false);
  check('A step names its surface', audio.play('step', { surface: 'wood' }) === true);
}

// ── Footsteps are distance-driven ───────────────────────────
console.log('\n[Footsteps]');
{
  const steps = [];
  const original = audio.play.bind(audio);
  audio.play = (name, opts) => { if (name === 'step') steps.push(opts); return original(name, opts); };

  audio.ctx.currentTime += 10;
  steps.length = 0;
  // Two seconds of walking at 1.4 m/s ≈ 1 step per 1.45 m ≈ 2 steps.
  for (let i = 0; i < 120; i++) { audio.ctx.currentTime += 1 / 60; audio.update(1 / 60, { moving: true, speed: 1.4, grounded: true, surface: 'pavement' }); }
  const walked = steps.length;
  check('Walking produces about a step per stride', walked >= 1 && walked <= 3, `${walked} steps in 2 s at 1.4 m/s`);

  audio.ctx.currentTime += 10;
  steps.length = 0;
  for (let i = 0; i < 120; i++) { audio.ctx.currentTime += 1 / 60; audio.update(1 / 60, { moving: true, speed: 6, grounded: true, surface: 'asphalt' }); }
  check('Sprinting produces more steps than walking', steps.length > walked, `${steps.length} steps in 2 s at 6 m/s`);
  check('…and they use the surface it was given', steps.every((s) => s.surface === 'asphalt'));

  audio.ctx.currentTime += 10;
  steps.length = 0;
  for (let i = 0; i < 60; i++) audio.update(1 / 60, { moving: false, speed: 0 });
  check('Standing still is silent', steps.length === 0);
  audio.play = original;
}

// ── Ambience ────────────────────────────────────────────────
console.log('\n[Ambience]');
check('A daytime street is traffic', pickAmbience({ hour: 12 }) === 'street');
check('A night street is quieter traffic', pickAmbience({ hour: 23 }) === 'night');
check('The market has its own bed', pickAmbience({ hour: 12, place: 'market' }) === 'market');
check('The church has its own bed', pickAmbience({ hour: 12, place: 'church' }) === 'church');
check('Indoors sounds indoors', pickAmbience({ hour: 12, inside: true }) === 'indoor');
check('Rain overrides everything outdoors', pickAmbience({ hour: 12, raining: true }) === 'rain');
check('The bed changes when the player moves', audio.setAmbience('market') === 'market');
check('…and the graph follows', audio._ambienceNodes !== null);
{
  const before = audio._ambienceNodes;
  audio.setAmbience('church');
  check('Switching beds replaces the nodes', audio._ambienceNodes !== before);
  check('An unknown bed is refused as "none"', audio.setAmbience('disco') === 'none');
}
check('Every surface has a footstep recipe', Object.keys(SURFACES).length >= 4
  && Object.values(SURFACES).every((s) => Number.isFinite(s.freq) && Number.isFinite(s.gain)));

audio.dispose();
check('dispose() closes the context', audio.ctx === null);

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
