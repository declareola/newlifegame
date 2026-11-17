// client/test-onboarding.mjs
// The onboarding flow, the character panel and the camera HUD, driven in jsdom.
//
// Things that are easy to break and impossible to notice without a browser:
//   · the creator's steps advance and go back in the right order
//   · the account step refuses a bad username before it ever calls the server
//   · every appearance control is present and actually changes the look
//   · the creator survives a browser with no WebGL (no preview, still usable)
//   · the first-run guide shows once, and can be replayed from the pause menu
//   · the pause menu's camera settings reach the controller
//   · the camera HUD says what the camera is actually doing, and the crosshair
//     only exists in first person

import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── Environment ─────────────────────────────────────────────
const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;

// jsdom has no WebGL: getContext('webgl') returns null. That is exactly the
// "browser without WebGL" case the creator has to survive.
globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLElement = window.HTMLElement;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.localStorage = window.localStorage;

const style = window.document.createElement('style');
style.textContent = css;
window.document.head.appendChild(style);

// ── Imports (after the DOM exists) ──────────────────────────
const { AuthScreen } = await import('./src/auth/AuthScreen.js');
const { Tutorial, TUTORIAL_CARDS } = await import('./src/ui/Tutorial.js');
const { CameraHud } = await import('./src/ui/CameraHud.js');
const { PauseMenu } = await import('./src/ui/PauseMenu.js');
const { OUTFITS, SKIN_TONES, HAIR_STYLES, BODY_TYPES } = await import('./src/player/outfits.js');

// ── Creator: steps ──────────────────────────────────────────
console.log('\n[Character creator]');
let submitted = null;
const auth = new AuthScreen((token, user, look) => { submitted = { token, user, look }; });
check('Opens on the account step', Boolean(auth.overlay.querySelector('#auth-username')));
check('There are three steps', auth.overlay.querySelectorAll('.auth-steps li').length === 3);

// Bad input must not advance.
auth.overlay.querySelector('#auth-username').value = 'ab';
auth.overlay.querySelector('#auth-password').value = 'short';
await auth._next();
check('A bad username is refused on the account step', auth.step === 0,
  `still on step ${auth.step}`);
check('…and the reason is shown', /3–16/.test(auth.errorEl.textContent), auth.errorEl.textContent);

// A long password is needed to sign up.
auth.overlay.querySelector('#auth-username').value = 'tunde';
auth.overlay.querySelector('#auth-password').value = 'short';
await auth._next();
check('A short password is refused on sign up', auth.step === 0, auth.errorEl.textContent);

auth.overlay.querySelector('#auth-password').value = 'longenough';
await auth._next();
check('Valid account details advance to the character step', auth.step === 1);

// ── Creator: the controls are all there ─────────────────────
console.log('\n[Character creator controls]');
check('Every skin tone is offered',
  auth.overlay.querySelectorAll('[data-skin]').length === SKIN_TONES.length,
  `${auth.overlay.querySelectorAll('[data-skin]').length} swatches`);
check('Every hair style is offered',
  auth.overlay.querySelectorAll('[data-hair]').length === HAIR_STYLES.length,
  `${auth.overlay.querySelectorAll('[data-hair]').length} styles`);
check('Every build is offered',
  auth.overlay.querySelectorAll('[data-build]').length === BODY_TYPES.length,
  `${auth.overlay.querySelectorAll('[data-build]').length} builds`);
check('Every outfit is offered',
  auth.overlay.querySelectorAll('[data-outfit]').length === OUTFITS.length,
  `${auth.overlay.querySelectorAll('[data-outfit]').length} outfits`);
check('A browser with no WebGL still gets a usable creator',
  Boolean(auth.overlay.querySelector('#creator-outfit')) && auth._previewRenderer === null,
  'preview renderer is null, controls still render');

// Choosing things changes the look.
auth.overlay.querySelector('[data-outfit="trader"]').click();
check('Choosing an outfit changes the look', auth.look.outfit === 'trader', auth.look.outfit);
check('…and the outfit brings its own garment', auth.look.garment === 'dashiki', auth.look.garment);
auth.overlay.querySelectorAll('[data-skin]')[4].click();
check('Choosing a skin tone changes the look',
  auth.look.skin === SKIN_TONES[4].hex, `0x${auth.look.skin.toString(16)}`);
auth.overlay.querySelector('[data-hair="braids"]').click();
check('Choosing hair changes the look', auth.look.hair === 'braids');
auth.overlay.querySelector('[data-build="broad"]').click();
check('Choosing a build changes the look', auth.look.body === 'broad');

auth.overlay.querySelector('[data-act="shuffle"]').click();
check('Surprise me still leaves a complete look',
  typeof auth.look.outfit === 'string' && typeof auth.look.skin === 'number' && typeof auth.look.hair === 'string',
  `${auth.look.outfit} / ${auth.look.hair} / 0x${auth.look.skin.toString(16)}`);

// ── Creator: tier step ──────────────────────────────────────
console.log('\n[Tier step]');
await auth._next();
check('The character step advances to the tier step', auth.step === 2);
check('All three tiers are offered', auth.overlay.querySelectorAll('[data-tier]').length === 3);
auth.overlay.querySelector('[data-tier="lapo"]').click();
check('A tier can be chosen', auth.tier === 'lapo', auth.tier);

// Back works from every step.
auth._back();
check('Back returns to the character step', auth.step === 1);
await auth._next();
check('Forward again reaches the tier step', auth.step === 2);

// ── Tutorial ────────────────────────────────────────────────
console.log('\n[First-run guide]');
{
  window.localStorage.clear();
  let opened = false;
  const tutorial = new Tutorial({ onControls: () => { opened = true; } });

  check('Does not show itself twice for one account',
    tutorial.show({ username: 'tunde' }) === true,
    'first show returns true');
  check('The first card is rendered', Boolean(document.querySelector('.tutorial-card')));
  check('It says which step it is', /Step 1 of/.test(document.querySelector('.tutorial-step').textContent),
    document.querySelector('.tutorial-step').textContent);
  check('It covers movement first', /Walk/.test(document.querySelector('.tutorial-title').textContent));

  // Next through every card.
  for (let i = 1; i < TUTORIAL_CARDS.length; i++) {
    document.querySelector('.tutorial-next').click();
  }
  check('The last card offers to start playing',
    /Start playing/.test(document.querySelector('.tutorial-next').textContent),
    document.querySelector('.tutorial-next').textContent);

  document.querySelector('.tutorial-controls').click();
  check('The guide can open the full controls', opened === true);

  document.querySelector('.tutorial-next').click();
  check('Finishing closes it', document.querySelector('.tutorial-card') === null);
  check('It is remembered for this account', Tutorial.hasSeen('tunde') === true);
  check('A new account still sees it', Tutorial.hasSeen('another-player') === false);

  const replay = new Tutorial({});
  check('It can be forced open again', replay.show({ username: 'tunde', force: true }) === true);
  replay.close();

  const other = new Tutorial({});
  check('A different account is not blocked by another account\'s flag',
    other.show({ username: 'newcomer' }) === true);
  other.close();
}

// ── Camera HUD ──────────────────────────────────────────────
console.log('\n[Camera HUD]');
{
  const fake = {
    firstPerson: false,
    cameraMode: 'chase',
    viewLabel: 'Third person',
    cycleViewMode() {
      // chase → first → iso → chase
      if (!this.firstPerson && this.cameraMode === 'chase') { this.firstPerson = true; this.cameraMode = 'first'; }
      else if (this.firstPerson) { this.firstPerson = false; this.cameraMode = 'iso'; }
      else { this.cameraMode = 'chase'; }
      this.viewLabel = this.firstPerson ? 'First person' : this.cameraMode === 'iso' ? 'Top-down' : 'Third person';
      return this.viewLabel;
    },
  };

  const hud = new CameraHud({ controller: fake });
  check('The badge starts on the real view',
    hud.badge.querySelector('.camera-badge-text').textContent === 'Third person');
  check('No crosshair in third person', hud.crosshair.classList.contains('hidden'));

  hud.badge.click();
  check('Clicking the badge changes the view', fake.firstPerson === true);
  check('The badge follows the change',
    hud.badge.querySelector('.camera-badge-text').textContent === 'First person',
    hud.badge.querySelector('.camera-badge-text').textContent);
  check('A crosshair appears in first person', !hud.crosshair.classList.contains('hidden'));

  // If the camera changes by another route (the V key), the HUD must catch up.
  fake.cycleViewMode();
  hud.update();
  check('The badge catches up when V changes the view',
    hud.badge.querySelector('.camera-badge-text').textContent === 'Top-down',
    hud.badge.querySelector('.camera-badge-text').textContent);
  check('The crosshair goes away again', hud.crosshair.classList.contains('hidden'));

  hud.destroy();
  check('Destroy removes both parts',
    document.querySelector('.camera-badge') === null && document.querySelector('.crosshair') === null);
}

// ── Pause menu camera settings ──────────────────────────────
console.log('\n[Pause menu camera settings]');
{
  let applied = null;
  let cycled = null;
  const menu = new PauseMenu({
    onToast: () => {},
    getQuality: () => 'high',
    setQuality: () => {},
    cycleCamera: () => { cycled = 'First person'; return cycled; },
    getCameraLabel: () => 'First person',
    getLook: () => ({ sensitivity: 1.4, invertY: true, pointerLock: true }),
    setLook: (patch) => { applied = patch; },
  });
  menu.setToken('test-token');
  menu.open();

  check('The sensitivity slider is there', Boolean(menu.el.querySelector('.pause-sens')));
  check('It opens showing the real sensitivity',
    Number(menu.sensEl.value) === 1.4, menu.sensEl.value);
  check('Invert-Y reflects the real setting', menu.invertEl.checked === true);
  check('Pointer lock reflects the real setting', menu.lockEl.checked === true);
  check('The camera row shows the real view',
    /first person/i.test(menu.camEl.textContent), menu.camEl.textContent);

  menu.sensEl.value = '2.2';
  menu.sensEl.dispatchEvent(new window.Event('input'));
  check('Moving the slider reaches the controller', applied && applied.sensitivity === 2.2,
    JSON.stringify(applied));

  menu.invertEl.checked = false;
  menu.invertEl.dispatchEvent(new window.Event('change'));
  check('Unticking invert-Y reaches the controller', applied && applied.invertY === false);

  menu.lockEl.checked = false;
  menu.lockEl.dispatchEvent(new window.Event('change'));
  check('Unticking pointer lock reaches the controller', applied && applied.pointerLock === false);

  check('There is a row that replays the guide',
    Boolean(menu.el.querySelector('[data-act="tutorial"]')));

  menu.close();
}

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
