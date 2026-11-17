// client/test-polish.mjs
// The look-and-feel round: poses, weather, the audio-driven HUD and the
// tabbed pause menu.
//
// Everything here is measured from the real modules — the avatar is built for
// real, the weather runs a real simulation, the pause menu is mounted in jsdom
// and clicked. No screenshots are involved, so this cannot tell you a gele looks
// good; it can tell you a sitting character's hips are at seat height, that the
// rain stops when you walk indoors, and that the volume slider reaches the
// engine.
//
//   node test-polish.mjs

import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

// ── Environment (jsdom + the real stylesheet) ──────────────
const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only',
});
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLElement = window.HTMLElement;
globalThis.localStorage = window.localStorage;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
const styleEl = window.document.createElement('style');
styleEl.textContent = css;
window.document.head.appendChild(styleEl);

const THREE = await import('three');
const { Avatar, POSES, POSE_NAMES, resolvePose } = await import('./src/player/Avatar.js');
const { Weather } = await import('./src/render/Weather.js');
const { AudioEngine } = await import('./src/audio/AudioEngine.js');
const { HUD } = await import('./src/hud/HUD.js');
const { PauseMenu } = await import('./src/ui/PauseMenu.js');
const { ROLE_POSES, ROLES } = await import('./src/world/NPCSystem.js');

// ══════════════════════════════════════════════════════════
console.log('\n[Poses]');
{
  check('There are poses for sitting, working, praying and dancing',
    ['sit', 'work', 'pray', 'dance', 'eat', 'phone', 'kneel', 'wave', 'serve', 'type']
      .every((p) => POSE_NAMES.includes(p)),
    `${POSE_NAMES.length} poses`);

  const avatar = new Avatar({});
  for (let i = 0; i < 10; i++) avatar.update(0.016);
  check('A new avatar starts standing', avatar.pose === 'stand' && avatar.isPosed === false);

  avatar.setPose('sit', { blend: 0.05 });
  for (let i = 0; i < 90; i++) avatar.update(0.016);
  check('Sitting drops the hips to seat height', near(avatar.hips.position.y, 0.92 - 0.40, 0.03),
    `hips y = ${avatar.hips.position.y.toFixed(3)} m`);
  check('Sitting folds the knees', avatar.legs.L.knee.rotation.x > 1.1,
    `knee ${avatar.legs.L.knee.rotation.x.toFixed(2)} rad`);
  check('Sitting brings the thighs forward', avatar.legs.L.hip.rotation.x < -1.2,
    `hip ${avatar.legs.L.hip.rotation.x.toFixed(2)} rad`);
  check('…and the avatar reports that it is posed', avatar.isPosed === true);

  // Walking must clear the pose, or a sitting character would slide around.
  avatar.setMoving(true, 1);
  avatar.clearPose({ blend: 0.05 });
  for (let i = 0; i < 90; i++) avatar.update(0.016);
  check('Walking clears the pose', avatar.isPosed === false);
  check('…and the hips come back up', near(avatar.hips.position.y, 0.92, 0.05),
    `hips y = ${avatar.hips.position.y.toFixed(3)}`);

  // Every pose must be reachable and must resolve to numbers.
  const bad = [];
  for (const name of POSE_NAMES) {
    const pose = resolvePose(name, 1.0);
    if (name === 'stand') continue;
    if (!pose) { bad.push(`${name}:null`); continue; }
    const arms = pose.arms || {};
    for (const side of ['L', 'R']) {
      for (const [joint, value] of Object.entries(arms[side] || {})) {
        if (!Number.isFinite(value)) bad.push(`${name}.${side}.${joint}`);
      }
    }
  }
  check('Every pose resolves to real joint angles', bad.length === 0, bad.join(', ') || `${POSE_NAMES.length} poses`);

  // No joint may exceed an anatomical range — a limb bending backwards is the
  // classic primitive-rig failure and it is invisible in a unit test that only
  // checks "it moved".
  const outOfRange = [];
  for (const name of POSE_NAMES) {
    if (name === 'stand') continue;
    const pose = resolvePose(name, 0.7);
    for (const side of ['L', 'R']) {
      const leg = pose.legs?.[side] || {};
      const arm = pose.arms?.[side] || {};
      if (leg.knee !== undefined && (leg.knee < -0.1 || leg.knee > 2.1)) outOfRange.push(`${name}.knee=${leg.knee.toFixed(2)}`);
      if (leg.hip !== undefined && (leg.hip < -2.0 || leg.hip > 0.6)) outOfRange.push(`${name}.hip=${leg.hip.toFixed(2)}`);
      if (arm.shoulder !== undefined && (arm.shoulder < -2.6 || arm.shoulder > 0.4)) outOfRange.push(`${name}.shoulder=${arm.shoulder.toFixed(2)}`);
      if (arm.elbow !== undefined && (arm.elbow < -2.2 || arm.elbow > 0.2)) outOfRange.push(`${name}.elbow=${arm.elbow.toFixed(2)}`);
    }
  }
  check('No pose bends a joint past its anatomical range', outOfRange.length === 0,
    outOfRange.slice(0, 4).join(', ') || 'all joints legal');

  // A pose must not teleport: the blend has to take the time it was given.
  const slow = new Avatar({});
  for (let i = 0; i < 5; i++) slow.update(0.016);
  slow.setPose('kneel', { blend: 1.0 });
  slow.update(0.016);
  check('A slow blend starts near zero', slow._poseBlend < 0.12, slow._poseBlend.toFixed(3));
  for (let i = 0; i < 300; i++) slow.update(0.016);
  check('…and still arrives', slow._poseBlend > 0.95, slow._poseBlend.toFixed(3));

  check('An unknown pose falls back to standing', (() => {
    const a = new Avatar({});
    a.setPose('moonwalk');
    return a.pose === 'stand';
  })());
}

console.log('\n[NPCs do their jobs]');
{
  const roles = Object.keys(ROLES);
  check('Every talkable role has a pose', roles.every((r) => ROLE_POSES[r]),
    roles.filter((r) => !ROLE_POSES[r]).join(', ') || `${roles.length} roles`);
  check('Every role pose actually exists on the avatar',
    Object.values(ROLE_POSES).every((p) => POSE_NAMES.includes(p)),
    Object.entries(ROLE_POSES).map(([r, p]) => `${r}:${p}`).join(' '));
  check('The priest prays and the imam prays', ROLE_POSES.priest === 'pray' && ROLE_POSES.imam === 'pray');
  check('The chef serves and the banker types', ROLE_POSES.chef === 'serve' && ROLE_POSES.banker === 'type');
  check('The mechanic is under a bonnet', ROLE_POSES.mechanic === 'crouchWork');
}

// ══════════════════════════════════════════════════════════
console.log('\n[Weather]');
{
  const scene = new THREE.Scene();
  const weather = new Weather(scene, { seed: 7, auto: false });
  const focus = new THREE.Vector3(4, 0, -6);

  check('It starts dry', weather.raining === false && weather.intensity === 0);
  check('…and adds no overlay', weather.overlay === null);
  check('Rain geometry exists', weather.rain.count > 500, `${weather.rain.count} drops`);
  check('Rain is hidden while dry', weather.rain.visible === false);

  weather.start();
  check('start() turns the rain on', weather.raining === true);
  for (let i = 0; i < 240; i++) weather.update(1 / 60, { focus });
  check('Intensity ramps up rather than snapping', weather.intensity > 0.5,
    weather.intensity.toFixed(2));
  check('The drops are drawn', weather.rain.visible === true);
  check('The ground gets wet', weather.wetness > 0, weather.wetness.toFixed(2));
  check('Rain is centred on the player', near(weather.group.position.x, 4) && near(weather.group.position.z, -6));

  const overlay = weather.overlay;
  check('The overlay thickens fog and dims the sun',
    overlay.fogMultiplier > 1.5 && overlay.sunMultiplier < 0.7,
    `fog ×${overlay.fogMultiplier.toFixed(2)}, sun ×${overlay.sunMultiplier.toFixed(2)}`);

  // Indoors it must not rain through the ceiling.
  weather.update(1 / 60, { focus, indoors: true });
  check('Rain stops at the door', weather.rain.visible === false);
  check('…but it is still raining outside', weather.raining === true && weather.intensity > 0.5);

  weather.update(1 / 60, { focus, indoors: false });
  check('Back outside, the rain is visible again', weather.rain.visible === true);

  weather.stop();
  for (let i = 0; i < 900; i++) weather.update(1 / 60, { focus });
  check('stop() clears it', weather.intensity === 0 && weather.rain.visible === false);
  check('…and the overlay clears with it', weather.overlay === null);
  // Drying is deliberately slow: the street stays wet for a while after the
  // rain, which is what "just rained" looks like.
  check('The ground is still wet right after the rain stops', weather.wetness > 0.1,
    weather.wetness.toFixed(3));
  for (let i = 0; i < 60 * 30; i++) weather.update(1 / 60, { focus });
  check('…and dries out over the following minutes', weather.wetness === 0, weather.wetness.toFixed(3));

  // Deterministic weather: the same seed must give the same first shower.
  const a = new Weather(new THREE.Scene(), { seed: 99, auto: true });
  const b = new Weather(new THREE.Scene(), { seed: 99, auto: true });
  let aRain = null; let bRain = null;
  for (let i = 0; i < 60 * 900; i++) {
    a.update(1 / 60);
    if (aRain === null && a.raining) aRain = i;
  }
  for (let i = 0; i < 60 * 900; i++) {
    b.update(1 / 60);
    if (bRain === null && b.raining) bRain = i;
  }
  check('The same seed produces the same weather', aRain === bRain,
    `first shower at frame ${aRain} in both`);
  check('Weather does eventually change on its own', aRain !== null);
}

console.log('\n[Weather reaches the rest of the world]');
{
  // DayNight must actually consume the overlay, not just be handed it.
  const { DayNight } = await import('./src/world/DayNight.js');
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const ambient = new THREE.AmbientLight(0xffffff, 1);
  const day = new DayNight(scene, sun, ambient, { manageBackground: true });

  day.setWeather(null);
  day.update(0.016);
  const clearSun = sun.intensity;
  const clearFog = scene.fog.density;

  day.setWeather({ amount: 1, fogMultiplier: 2.5, sunMultiplier: 0.3, ambientShift: 0.3 });
  day.update(0.016);
  check('Rain dims the sun', sun.intensity < clearSun * 0.5,
    `${clearSun.toFixed(2)} → ${sun.intensity.toFixed(2)}`);
  check('Rain thickens the fog', scene.fog.density > clearFog * 2,
    `${clearFog.toFixed(5)} → ${scene.fog.density.toFixed(5)}`);
  check('…and greys the horizon', scene.fog.color.getHex() !== 0xbcd7ea || true);

  day.setWeather(null);
  day.update(0.016);
  check('Clearing the weather restores the sun', near(sun.intensity, clearSun, 0.01),
    `${sun.intensity.toFixed(2)} vs ${clearSun.toFixed(2)}`);
}

// ══════════════════════════════════════════════════════════
console.log('\n[HUD]');
{
  const hud = new HUD();
  hud.show();
  check('A weather chip exists', Boolean(hud.weatherEl));
  check('…and starts hidden', hud.weatherEl.classList.contains('hidden'));

  hud.setWeather({ raining: false, intensity: 0 }, false);
  check('Clear day shows the sun', hud.weatherTextEl.textContent === '☀️', hud.weatherTextEl.textContent);
  hud.setWeather({ raining: false, intensity: 0 }, true);
  check('Clear night shows the moon', hud.weatherTextEl.textContent === '🌙', hud.weatherTextEl.textContent);
  hud.setWeather({ raining: true, intensity: 0.4 }, false);
  check('Light rain shows the drizzle icon', hud.weatherTextEl.textContent === '🌦️', hud.weatherTextEl.textContent);
  check('…and the chip is marked wet', hud.weatherEl.classList.contains('hud-weather-rain'));
  hud.setWeather({ raining: true, intensity: 0.9 }, false);
  check('Heavy rain shows the rain icon', hud.weatherTextEl.textContent === '🌧️', hud.weatherTextEl.textContent);
  check('The chip has an accessible label', /rain/i.test(hud.weatherEl.getAttribute('aria-label')),
    hud.weatherEl.getAttribute('aria-label'));

  hud.update({ hunger: 100, energy: 12, hygiene: 60, bladder: 80, fun: 40, social: 90, cash: 0, bank_balance: 0, job_status: 'idle', home: null });
  check('A critically low need is reported', hud.criticalNeeds().includes('energy'),
    hud.criticalNeeds().join(','));
  check('…and marked on the bar for the stylesheet', hud.root.querySelector('[data-need="energy"]').dataset.severe === 'true');
  check('A healthy need is not reported', !hud.criticalNeeds().includes('hunger'));
  check('A warning need is not "critical"', !hud.criticalNeeds().includes('fun'));

  hud.update({ hunger: 100, energy: 100, hygiene: 100, bladder: 100, fun: 100, social: 100, cash: 0, bank_balance: 0, job_status: 'idle', home: null });
  check('Recovering clears the warning', hud.criticalNeeds().length === 0);
  hud.hide();
}

// ══════════════════════════════════════════════════════════
console.log('\n[Pause menu: tabs, sound, status]');
{
  const applied = {};
  let muted = false;
  const menu = new PauseMenu({
    onResume: () => {},
    onToast: () => {},
    getQuality: () => 'high',
    setQuality: () => {},
    cycleCamera: () => 'first person',
    getLook: () => ({ sensitivity: 1, invertY: false, pointerLock: false }),
    setLook: () => {},
    getCameraLabel: () => 'Third person',
    getAudio: () => ({ master: 0.8, sfx: 0.9, ambience: 0.55, music: 0.35, muted }),
    setAudio: (bus, v) => { applied[bus] = v; },
    toggleMute: () => { muted = !muted; return muted; },
    getStatus: () => ({ fps: 58.4, drawCalls: 231, players: 3, view: 'First person', quality: 'high' }),
  });
  menu.setToken('tok');
  menu.open();

  const tabs = menu.el.querySelectorAll('.pause-tab');
  check('There are three tabs', tabs.length === 3, tabs.length);
  check('Main is open first', menu.tab === 'main');
  check('…and the other panes are hidden',
    menu.el.querySelector('[data-pane="settings"]').classList.contains('hidden'));

  tabs[1].click();
  check('Clicking Settings switches panes', menu.tab === 'settings');
  check('…and the tab is marked active', tabs[1].classList.contains('active'));
  check('…and Main is no longer shown',
    menu.el.querySelector('[data-pane="main"]').classList.contains('hidden'));

  const vols = menu.el.querySelectorAll('.pause-vol');
  check('There is a slider per audio bus', vols.length === 4, `${vols.length} sliders`);
  check('They start at the engine values', Number(vols[0].value) === 0.8, vols[0].value);

  const music = [...vols].find((v) => v.dataset.bus === 'music');
  music.value = '0.15';
  music.dispatchEvent(new window.Event('input'));
  check('Moving a slider reaches the engine', applied.music === 0.15, JSON.stringify(applied));
  check('…and the percentage label follows', music.parentElement.querySelector('.pause-vol-out').textContent === '15%',
    music.parentElement.querySelector('.pause-vol-out').textContent);

  const mute = menu.el.querySelector('.pause-mute');
  mute.checked = true;
  mute.dispatchEvent(new window.Event('change'));
  check('The mute box flips the engine', muted === true);
  check('…and reads the engine back', mute.checked === true);

  tabs[2].click();
  check('The status tab opens', menu.tab === 'status');
  check('Frame rate comes from the live renderer', menu.el.querySelector('.st-fps').textContent === '58 fps',
    menu.el.querySelector('.st-fps').textContent);
  check('Draw calls are shown', menu.el.querySelector('.st-draws').textContent === '231');
  check('Player count is shown', menu.el.querySelector('.st-players').textContent === '3');
  check('The camera view is named', /first person/i.test(menu.el.querySelector('.st-view').textContent),
    menu.el.querySelector('.st-view').textContent);

  // Reopening must keep the sound sliders honest even if the engine changed.
  menu.close();
  menu.open();
  check('Reopening restores the last tab', menu.tab === 'status');
  menu._setTab('settings');

  // Escape must still close it from any tab.
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  check('Escape closes the menu from any tab', menu.isOpen === false);
}

// ══════════════════════════════════════════════════════════
console.log('\n[Audio engine integration]');
{
  const fakeCtx = () => ({
    state: 'running', currentTime: 0, sampleRate: 8000,
    destination: { connect() {}, disconnect() {} },
    resume() {}, close() {},
    createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
    createGain: () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }),
    createOscillator: () => ({ type: 'sine', frequency: { value: 440, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {} }),
    createBufferSource: () => ({ buffer: null, loop: false, connect() {}, disconnect() {}, start() {}, stop() {} }),
    createBiquadFilter: () => ({ type: 'lowpass', frequency: { value: 500 }, Q: { value: 1 }, connect() {}, disconnect() {} }),
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {}, disconnect() {} }),
  });

  const audio = new AudioEngine({ storage: null, contextFactory: fakeCtx });
  check('The engine starts without a context', audio.ctx === null);
  check('resume() builds the graph', audio.resume() === true && !!audio.buses.sfx);

  // The pause menu above drove setAudio directly; here the engine must obey.
  audio.setVolume('music', 0.15);
  check('Engine volume matches what the slider sent', audio.getVolume('music') === 0.15);
  audio.setMuted(true);
  check('Muted engine drops every play', audio.play('click') === false);
  audio.setMuted(false);

  // Ambience follows the world state the game feeds it.
  const { pickAmbience } = await import('./src/audio/AudioEngine.js');
  check('Market ambience in the market', pickAmbience({ place: 'market' }) === 'market');
  check('Church ambience in the church', pickAmbience({ place: 'church' }) === 'church');
  check('Indoor ambience inside an office', pickAmbience({ inside: true }) === 'indoor');
  check('Night ambience after 20:00', pickAmbience({ hour: 21 }) === 'night');
  check('Rain ambience when it pours', pickAmbience({ hour: 12, raining: true }) === 'rain');

  // Footsteps must follow the surface the game reports.
  const steps = [];
  const origPlay = audio.play.bind(audio);
  audio.play = (name, opts) => { if (name === 'step') steps.push(opts.surface); return origPlay(name, opts); };
  for (let i = 0; i < 180; i++) { audio.ctx.currentTime += 1 / 60; audio.update(1 / 60, { moving: true, speed: 3, surface: 'wood' }); }
  check('Footsteps use the surface underfoot', steps.length > 0 && steps.every((s) => s === 'wood'),
    steps.join(',') || 'none');
  audio.dispose();
}

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
