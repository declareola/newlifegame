// client/test-overlay.mjs
// Regression test for the bug where the pause menu appeared after login and
// Escape did not dismiss it.
//
// Two separate causes, both covered here:
//   1. CSS — `.pause-overlay` set `display:grid` and none of the wave-6
//      components defined a `.hidden` rule, so `classList.add('hidden')` had no
//      visual effect at all.
//   2. Interaction — Escape is listened for by several components, and the
//      pause menu has to distinguish "close me" from "open me".
//
// The stylesheet is loaded into jsdom for real, so this asserts the cascade
// rather than trusting the class name.
//
//   cd client && node test-overlay.mjs

import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Environment with the real stylesheet ────────────────────
const css = await readFile(new URL('./src/styles.css', import.meta.url), 'utf8');
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;

const styleEl = window.document.createElement('style');
styleEl.textContent = css;
window.document.head.appendChild(styleEl);

global.window = window;
global.document = window.document;
// Node already has a monotonic performance.now(); do not override it with
// jsdom's, which delegates back to the global and recurses infinitely.
global.KeyboardEvent = window.KeyboardEvent;
global.MouseEvent = window.MouseEvent;
global.localStorage = window.localStorage;
global.HTMLElement = window.HTMLElement;
global.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);

// The panels fetch by default; this test is about visibility, so stub it.
global.fetch = async () => ({
  ok: true,
  json: async () => ({
    ok: true, items: [], cash: 0, missions: [], catalog: [], owned: [],
    user: { username: 'tester', cash: 0, bank_balance: 0, debt: 0 },
    stats: { totalEarned: 0, itemsUsed: 0, itemsBought: 0, districts: [], itemCount: 0,
      vehicleCount: 0, missionsClaimed: 0, missionsActive: 0, home: null },
    savedAt: Date.now(),
  }),
});

const visible = (el) => window.getComputedStyle(el).display !== 'none';

// ── 1. The utility rule itself ──────────────────────────────
console.log('[CSS: the .hidden utility]');
const probe = window.document.createElement('div');
probe.className = 'pause-overlay hidden';
window.document.body.appendChild(probe);
check('A .hidden element with display:grid is actually hidden',
  !visible(probe), `computed display: ${window.getComputedStyle(probe).display}`);
probe.classList.remove('hidden');
check('Removing .hidden makes the same element visible again', visible(probe));
probe.remove();

// The two fade-out overlays must keep their opacity transition
const auth = window.document.createElement('div');
auth.className = 'auth-overlay hidden';
window.document.body.appendChild(auth);
const authStyle = window.getComputedStyle(auth);
check('Auth overlay keeps its fade (not display:none)',
  authStyle.display !== 'none', `display: ${authStyle.display}, opacity: ${authStyle.opacity}`);
auth.remove();

// ── 2. Every wave-6 component starts hidden ─────────────────
console.log('\n[Components start hidden]');
const { PauseMenu } = await import('./src/ui/PauseMenu.js');
const { ControlsGuide } = await import('./src/ui/ControlsGuide.js');
const { InventoryPanel } = await import('./src/inventory/InventoryPanel.js');
const { MissionJournal } = await import('./src/missions/MissionJournal.js');
const { CharacterPanel } = await import('./src/ui/CharacterPanel.js');
const { DialogueUI } = await import('./src/ui/DialogueUI.js');
const { DriveHUD } = await import('./src/ui/DriveHUD.js');
const { ObjectiveTracker } = await import('./src/missions/ObjectiveTracker.js');

let resumed = 0;
const pause = new PauseMenu({
  onResume: () => { resumed++; },
  onControls: () => {}, onLogout: () => {}, onToast: () => {},
  getQuality: () => 'high', setQuality: () => {}, cycleCamera: () => 'chase',
});
const guide = new ControlsGuide({});
const inventory = new InventoryPanel({ onToast: () => {} });
const journal = new MissionJournal({ onToast: () => {} });
const character = new CharacterPanel({ onToast: () => {}, getNeeds: () => null });
const dialogue = new DialogueUI();
const drive = new DriveHUD();
const tracker = new ObjectiveTracker();

const components = [
  ['pause menu', '.pause-overlay'],
  ['controls guide', '.controls-overlay'],
  ['inventory', '.inventory-panel'],
  ['mission journal', '.missions-panel'],
  ['character sheet', '.character-panel'],
  ['dialogue', '.dialogue'],
  ['drive hud', '.drive-hud'],
  ['objective tracker', '.objective-tracker'],
];
for (const [label, selector] of components) {
  const el = window.document.querySelector(selector);
  check(`${label} is not on screen after construction`,
    el !== null && !visible(el),
    el ? `display: ${window.getComputedStyle(el).display}` : 'MISSING ELEMENT');
}

// ── 3. Escape opens, Escape closes ──────────────────────────
console.log('\n[Escape]');
pause.setToken('test-token');
const overlay = window.document.querySelector('.pause-overlay');
const fireKey = (code) => window.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true }));

fireKey('Escape');
check('Escape opens the pause menu', pause.isOpen === true && visible(overlay));

fireKey('Escape');
check('Escape closes the pause menu again',
  pause.isOpen === false && !visible(overlay),
  `isOpen: ${pause.isOpen}, display: ${window.getComputedStyle(overlay).display}`);
check('Closing the pause menu resumes the game', resumed === 1, `${resumed} resume callbacks`);

// Repeated presses must not trap the player
fireKey('Escape');
const opened = pause.isOpen;
fireKey('Escape');
check('Two quick Escape presses both register (open, then close)',
  opened === true && pause.isOpen === false,
  `after first: ${opened}, after second: ${pause.isOpen}`);

// ── 4. Clicking outside dismisses it ────────────────────────
console.log('\n[Click outside]');
pause.open();
check('Pause menu open before the click', pause.isOpen === true && visible(overlay));

// A click on a button inside the panel must NOT close it
const saveBtn = window.document.querySelector('.pause-row[data-act="save"]');
saveBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 60));
check('Clicking a button inside the panel does not dismiss it', pause.isOpen === true);

// A click on the backdrop itself must close it
overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('Clicking the dimmed backdrop dismisses the pause menu',
  pause.isOpen === false && !visible(overlay),
  `isOpen: ${pause.isOpen}, display: ${window.getComputedStyle(overlay).display}`);

// ── 5. One Escape press = one action ────────────────────────
console.log('\n[Escape is not double-handled]');
pause.setToken('test-token');
journal.setToken('test-token');
journal.show();
await new Promise((r) => setTimeout(r, 60));
check('Journal open', journal.isOpen === true && visible(window.document.querySelector('.missions-panel')));

fireKey('Escape');
await new Promise((r) => setTimeout(r, 20));
check('Escape closes the journal',
  journal.isOpen === false && !visible(window.document.querySelector('.missions-panel')));
check('...and does not also open the pause menu behind it',
  pause.isOpen === false,
  `pause.isOpen: ${pause.isOpen}`);

// With nothing open, Escape still reaches the pause menu
await new Promise((r) => setTimeout(r, 120));
fireKey('Escape');
check('Once nothing is open, Escape opens the pause menu',
  pause.isOpen === true && visible(overlay));

// ── 6. The controls guide can be dismissed both ways ────────
console.log('\n[Controls guide]');
pause.close();
guide.show();
check('Guide opens', guide.isOpen === true && visible(window.document.querySelector('.controls-overlay')));
fireKey('Escape');
check('Escape closes the guide',
  guide.isOpen === false && !visible(window.document.querySelector('.controls-overlay')));

guide.show();
window.document.querySelector('.controls-overlay')
  .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('Backdrop click closes the guide', guide.isOpen === false);

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed ? 1 : 0);
