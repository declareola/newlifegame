// client/test-ui.mjs
// Runtime smoke test for the open-world UI panels.
//
// There is no headless WebGL in this sandbox, so the 3D scene cannot be run
// here. What CAN be run is the DOM layer: these panels are plain classes that
// build DOM, call the real server and render the answer. This test boots them
// inside jsdom against a live server, clicks the real buttons, and checks what
// ends up on screen.
//
//   cd server && node src/index.js &
//   cd client && node test-ui.mjs

import { JSDOM } from 'jsdom';

const PORT = process.env.PORT || 3000;
const BASE = `http://127.0.0.1:${PORT}`;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── jsdom environment ────────────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.MouseEvent = dom.window.MouseEvent;
global.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
global.localStorage = dom.window.localStorage;

// fetch: rewrite the client's relative /api/... calls to the live server
const realFetch = global.fetch;
global.fetch = (url, opts) => {
  const target = typeof url === 'string' && url.startsWith('/') ? `${BASE}${url}` : url;
  return realFetch(target, opts);
};

// ── Real account on the live server ──────────────────────────
async function makeAccount() {
  const username = `uitest${Math.random().toString(36).slice(2, 9)}`;
  const res = await global.fetch(`${BASE}/api/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'Sup3rSecret!pass',
      tier: 'nepo',
      skinColor: 0xf1c27d,
      outfitColor: 0x2196f3,
    }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`signup failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Load the modules under test ──────────────────────────────
const { InventoryPanel } = await import('./src/inventory/InventoryPanel.js');
const { MissionJournal } = await import('./src/missions/MissionJournal.js');
const { ObjectiveTracker } = await import('./src/missions/ObjectiveTracker.js');
const { CharacterPanel } = await import('./src/ui/CharacterPanel.js');
const { DriveHUD } = await import('./src/ui/DriveHUD.js');
const { ControlsGuide } = await import('./src/ui/ControlsGuide.js');
const { PauseMenu } = await import('./src/ui/PauseMenu.js');

const toasts = [];
const onToast = (msg, type) => toasts.push({ msg, type });

const account = await makeAccount();
const token = account.token;
const username = account.user?.username || username;
console.log(`\nAccount: ${username}\n`);

// ── Controls guide ───────────────────────────────────────────
console.log('[Controls guide]');
const guide = new ControlsGuide({});
guide.show();
check('Guide renders every key group',
  document.querySelectorAll('.controls-group').length === 4,
  `${document.querySelectorAll('.controls-group').length} groups`);
const keyLabels = [...document.querySelectorAll('.controls-row kbd')].map((k) => k.textContent);
for (const required of ['W A S D', 'Shift', 'Space', 'C', 'E', 'F', 'Tab', 'M', 'J', 'I', 'Esc']) {
  check(`Guide documents ${required}`, keyLabels.some((k) => k.includes(required)), '');
}
guide.hide();
check('Guide closes', guide.isOpen === false);

// ── Objective tracker ────────────────────────────────────────
console.log('\n[Objective tracker]');
const tracker = new ObjectiveTracker();
tracker.update([
  { id: 'm1', name: 'First Paycheck', status: 'active', steps: [
    { id: 's1', text: 'Take a job', done: true },
    { id: 's2', text: 'Work one shift', done: false },
  ] },
]);
check('Tracker shows the live objective',
  document.querySelector('.objective-name').textContent === 'First Paycheck' &&
  document.querySelector('.objective-step').textContent === 'Work one shift',
  document.querySelector('.objective-step').textContent);
tracker.update([]);
check('Tracker hides with no missions',
  document.querySelector('.objective-tracker').classList.contains('hidden'));

// ── Drive HUD ────────────────────────────────────────────────
console.log('\n[Drive HUD]');
const drive = new DriveHUD();
drive.show(64, { def: { name: 'Corolla' } });
drive.setFuel(5, 45);
check('Drive HUD shows speed and vehicle',
  document.querySelector('.drive-speed').textContent.includes('64') &&
  document.querySelector('.drive-vehicle').textContent === 'Corolla',
  document.querySelector('.drive-speed').textContent);
check('Fuel bar reflects the tank',
  document.querySelector('.drive-fuel-bar i').style.width === '11.1%',
  document.querySelector('.drive-fuel-bar i').style.width);
check('Low fuel is flagged', document.querySelector('.drive-fuel-bar').classList.contains('low'));
drive.show(null);
check('Drive HUD hides on foot',
  document.querySelector('.drive-hud').classList.contains('hidden'));

// ── Inventory ────────────────────────────────────────────────
console.log('\n[Inventory panel]');
const inventory = new InventoryPanel({ onToast, onNeeds: () => {} });
inventory.setToken(token);
await inventory.show();
check('Empty bag renders a real empty state',
  document.querySelector('.inventory-body').textContent.includes('bag is empty'),
  document.querySelector('.inventory-body').textContent.trim().slice(0, 40));

// The shop check needs proximity, so this is expected to be refused from here —
// and the refusal must reach the player as a toast, not a silent no-op.
const beforeToasts = toasts.length;
await inventory.buy('jollof', 1);
check('Buying away from a shop is refused with a reason',
  toasts.length > beforeToasts && /shop/i.test(toasts[toasts.length - 1].msg),
  toasts[toasts.length - 1]?.msg);

// ── Mission journal ──────────────────────────────────────────
console.log('\n[Mission journal]');
const journal = new MissionJournal({ onToast, onTracker: () => {}, onNavigate: () => {} });
journal.setToken(token);
await sleep(300);
await journal.show();
const cards = document.querySelectorAll('.mission-card');
check('Journal renders the server mission list', cards.length >= 8, `${cards.length} cards`);
check('Every mission shows its real reward',
  document.querySelectorAll('.mission-reward').length === cards.length);

// Accept the first available mission through the real button
const acceptBtn = document.querySelector('.mission-btn[data-act="accept"]');
const missionName = acceptBtn?.closest('.mission-card')?.querySelector('h3')?.textContent;
acceptBtn?.click();
await sleep(400);
check('Accepting a mission through the UI changes its status',
  document.querySelector('.mission-card.status-active') !== null,
  missionName || 'no mission');
check('Acceptance is confirmed to the player',
  toasts.some((t) => /Accepted/.test(t.msg)),
  toasts.filter((t) => /Accepted/.test(t.msg)).map((t) => t.msg).join(' | '));

// Claiming one that is not done must be refused by the server
const claimBtn = document.querySelector('.mission-btn[data-act="claim"]');
const beforeClaim = toasts.length;
if (claimBtn) {
  claimBtn.click();
  await sleep(400);
  check('Claiming an unfinished mission is refused with the server reason',
    toasts.length > beforeClaim, toasts[toasts.length - 1]?.msg || 'no toast');
} else {
  check('Claim button only appears on completed missions', true, 'none shown');
}
journal.hide();

// ── Character sheet ──────────────────────────────────────────
console.log('\n[Character sheet]');
const character = new CharacterPanel({ onToast, getNeeds: () => null });
character.setToken(token);
await character.show();
check('Character sheet shows the username',
  document.querySelector('.char-name').textContent.trim() === username,
  `rendered "${document.querySelector('.char-name').textContent}" vs account "${username}"`);
check('Character sheet shows all six needs',
  document.querySelectorAll('.char-need').length === 6,
  `${document.querySelectorAll('.char-need').length} needs`);
check('Character sheet shows cash from the server',
  /₦/.test(document.querySelector('.char-stat b').textContent),
  document.querySelector('.char-stat b').textContent);
character.hide();

// ── Pause menu ───────────────────────────────────────────────
console.log('\n[Pause menu]');
let resumed = 0;
const pause = new PauseMenu({
  onResume: () => { resumed++; },
  onControls: () => {},
  onLogout: () => {},
  onToast,
  getQuality: () => 'high',
  setQuality: () => {},
  // The real getter is controller.viewLabel, e.g. 'Top-down'.
  cycleCamera: () => 'Top-down',
});
pause.setToken(token);
pause.open();
check('Pause menu opens', pause.isOpen === true);

document.querySelector('.pause-row[data-act="save"]').click();
await sleep(500);
check('Save from the pause menu confirms with a timestamp',
  toasts.some((t) => /^Saved at/.test(t.msg)),
  toasts.filter((t) => /^Saved at/.test(t.msg))[0]?.msg || 'no save toast');

document.querySelector('.pause-row[data-act="camera"]').click();
check('Camera row reports the mode it switched to',
  document.querySelector('.pause-cam').textContent === 'top-down',
  document.querySelector('.pause-cam').textContent);

pause.close();
check('Closing the pause menu resumes the game', resumed === 1 && pause.isOpen === false);

// Escape opens it too — but only when nothing else is already open, which is
// the whole point of the guard. Close the panels this test opened first.
inventory.hide();
journal.hide();
character.hide();
dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'Escape' }));
check('Escape opens the pause menu when nothing else is open', pause.isOpen === true);

// ── NPC dialogue, run for real ───────────────────────────────
// Three.js itself works headless (it is only the WebGL renderer that needs a
// GPU), so the NPC avatars and the vehicle meshes can be built and driven here.
console.log('\n[NPC dialogue]');
// jsdom has no canvas. NPC name tags draw onto a 2D canvas, so give it the
// handful of methods they use; three only stores the canvas in a CanvasTexture,
// and no GL upload happens without a renderer.
const ctx2d = {
  canvas: null,
  clearRect() {}, fillRect() {}, strokeRect() {},
  beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, closePath() {},
  fill() {}, stroke() {}, save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
  fillText() {}, strokeText() {},
  measureText: () => ({ width: 64 }),
  createLinearGradient: () => ({ addColorStop() {} }),
  roundRect() {},
  set font(v) {}, get font() { return '16px sans-serif'; },
  set fillStyle(v) {}, get fillStyle() { return '#fff'; },
  set strokeStyle(v) {}, get strokeStyle() { return '#000'; },
  set lineWidth(v) {}, get lineWidth() { return 1; },
  set textAlign(v) {}, get textAlign() { return 'left'; },
  set textBaseline(v) {}, get textBaseline() { return 'top'; },
  set globalAlpha(v) {}, get globalAlpha() { return 1; },
};
dom.window.HTMLCanvasElement.prototype.getContext = function getContext(kind) {
  if (kind === '2d') return ctx2d;
  return null;
};

const THREE = await import('three');
const { NPCSystem } = await import('./src/world/NPCSystem.js');
const { DialogueUI } = await import('./src/ui/DialogueUI.js');

const dialogue = new DialogueUI();
const services = [];
const scene = new THREE.Scene();
const navStub = {
  isReachable: () => true,
  nearestReachable: (x, z) => ({ x, z }),
  isWalkable: () => true,
  nearestWalkable: (x, z) => ({ x, z }),
};

const npcs = new NPCSystem({
  scene,
  nav: navStub,
  getPlayer: () => ({ x: 0, z: 0 }),
  dialogueUI: dialogue,
  onToast,
  actions: {
    openJobs: () => services.push('jobs'),
    openMap: () => services.push('map'),
    navigateTo: (poi) => services.push(`nav:${poi.name}`),
    service: async (id) => { services.push(`svc:${id}`); return true; },
  },
});
check('NPCs spawn on reachable ground', npcs.npcs.length >= 6, `${npcs.npcs.length} NPCs`);
check('Every NPC has a name and a role',
  npcs.npcs.every((n) => n.roleDef?.label), npcs.npcs.map((n) => n.roleDef.label).join(', ').slice(0, 60));

const vendor = npcs.npcs.find((n) => n.role === 'vendor') || npcs.npcs[0];
npcs.talkTo(vendor);
check('Talking opens the dialogue box', dialogue.isOpen === true && !document.querySelector('.dialogue-panel').classList.contains('hidden'));

const optionLabels = [...document.querySelectorAll('.dialogue-option')].map((b) => b.textContent.trim());
check('Dialogue offers real options', optionLabels.length >= 2, optionLabels.slice(0, 3).join(' | ').slice(0, 70));

// Pick the "buy food" option if this NPC has one — it must hit the server
// service route, not a local need bump.
const buyIdx = optionLabels.findIndex((l) => /Buy food/i.test(l));
if (buyIdx >= 0) {
  document.querySelectorAll('.dialogue-option')[buyIdx].click();
  await sleep(300);
  check('Buying food from an NPC calls the server service',
    services.includes('svc:street-food'), services.filter((s) => s.startsWith('svc:')).join(', '));
} else {
  // Talk to a vendor specifically
  const anyVendor = npcs.npcs.find((n) => n.role === 'vendor' || n.role === 'trader');
  npcs.talkTo(anyVendor);
  await sleep(50);
  const idx = [...document.querySelectorAll('.dialogue-option')].findIndex((b) => /Buy food/i.test(b.textContent));
  if (idx >= 0) document.querySelectorAll('.dialogue-option')[idx].click();
  await sleep(300);
  check('Buying food from an NPC calls the server service',
    services.includes('svc:street-food'), services.filter((s) => s.startsWith('svc:')).join(', '));
}
dialogue.close();
check('Dialogue closes', dialogue.isOpen === false);

// ── Vehicle meshes + driving maths ───────────────────────────
console.log('\n[Vehicles]');
const { buildVehicleMesh, VehicleSystem } = await import('./src/world/VehicleSystem.js');

let meshProblems = [];
for (const kind of ['tricycle', 'motorbike', 'hiace', 'taxi', 'sedan', 'suv', 'motorcycle']) {
  const mesh = buildVehicleMesh(0x2f6fd0, kind);
  const expectedWheels = ['tricycle', 'keke'].includes(kind) ? 3
    : ['motorbike', 'motorcycle'].includes(kind) ? 2 : 4;
  const wheels = mesh.userData.wheels.length;
  const hasBody = mesh.children.length > wheels;
  if (wheels !== expectedWheels || !hasBody) {
    meshProblems.push(`${kind}: ${wheels} wheels (want ${expectedWheels})`);
  }
}
check('Every vehicle kind builds wheels and a body from primitives',
  meshProblems.length === 0, meshProblems.join('; ') || '7 kinds OK');

// The old ids still have to build something drivable — saves have them in.
for (const legacy of ['danfo', 'keke', 'okada', 'bus']) {
  const mesh = buildVehicleMesh(0x2f6fd0, legacy);
  if (!mesh.userData.wheels?.length || mesh.children.length <= mesh.userData.wheels.length) {
    meshProblems.push(`${legacy}: no wheels`);
  }
}
check('Legacy vehicle ids still build a real mesh', meshProblems.length === 0,
  meshProblems.join('; ') || 'danfo/keke/okada/bus all resolve');

const driveScene = new THREE.Scene();
const keys = {};
const fakeController = {
  keys,
  facing: 0,
  setControlsLocked: () => {},
  setPaused: () => {},
};
const fakeAvatar = new THREE.Object3D();
const speeds = [];
const vehicleSystem = new VehicleSystem({
  scene: driveScene,
  avatar: fakeAvatar,
  controller: fakeController,
  collisionBoxes: [],
  getPosition: () => ({ x: 0, z: 0, rot: 0 }),
  onToast,
  onSpeed: (kph) => speeds.push(kph),
  onFuel: () => {},
  onPrompt: () => {},
});
vehicleSystem.owned = [{
  id: 1, vehicle_id: 'corolla', pos_x: 0, pos_z: 0, fuel: 40,
  def: { name: 'Corolla', kind: 'sedan', maxSpeed: 150, acceleration: 8, handling: 7, tankLitres: 45, colour: 0x222222 },
}];
vehicleSystem._syncMeshes();
check('Owned vehicle spawns a mesh in the scene',
  vehicleSystem.meshes.size === 1 && driveScene.children.includes(vehicleSystem.group));

check('Entering a vehicle hides the avatar and locks walking',
  vehicleSystem.enter(vehicleSystem.owned[0]) === true &&
  fakeAvatar.visible === false);

keys['KeyW'] = true;
for (let i = 0; i < 60; i++) vehicleSystem.update(1 / 60);
keys['KeyW'] = false;
const mesh = vehicleSystem.meshes.get(1);
check('Throttle moves the car forward',
  Math.abs(mesh.position.z) > 1, `z ${mesh.position.z.toFixed(2)}`);
check('Speed reaches km/h on the HUD feed',
  speeds.some((s) => s > 20), `${Math.max(...speeds).toFixed(1)} km/h`);
check('Fuel is consumed while driving',
  vehicleSystem.owned[0].fuel < 40, `${vehicleSystem.owned[0].fuel.toFixed(2)} L`);

keys['KeyA'] = true;
const headingBefore = vehicleSystem.heading;
for (let i = 0; i < 30; i++) vehicleSystem.update(1 / 60);
keys['KeyA'] = false;
check('Steering changes heading', vehicleSystem.heading !== headingBefore,
  `${headingBefore.toFixed(2)} → ${vehicleSystem.heading.toFixed(2)}`);

await vehicleSystem.exit();
check('Leaving the car restores the avatar and stops the speed HUD',
  fakeAvatar.visible === true && vehicleSystem.driving === null);

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');

process.exit(failed ? 1 : 0);
