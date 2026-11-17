// client/test-camera.mjs
// The camera, tested by driving the real PlayerController.
//
// A browser is not needed: the controller only touches a small slice of the DOM
// (createElement for the joystick, a canvas with pointer/wheel listeners), so a
// 40-line fake is enough to run the actual camera maths.
//
// What this proves:
//   · V really cycles third person → first person → top-down → back
//   · first person puts the camera at the character's eyes, looking forward
//   · the body is hidden in first person and shown again in third
//   · pitch cannot flip over the top; yaw is free
//   · mouse drag rotates the view, and sensitivity scales it
//   · invert-Y flips only the vertical axis
//   · wheel zoom is clamped and does nothing in first person
//   · Q/E are NOT hijacked (Q is graphics, E is interact) — , and . turn instead
//   · the third-person camera never ends up inside a wall

import * as THREE from 'three';

// ── Minimal DOM ──────────────────────────────────────────────
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = {
      _set: new Set(),
      add: (...c) => c.forEach((x) => this.classList._set.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
      toggle: (c, on) => (on ? this.classList._set.add(c) : this.classList._set.delete(c)),
      contains: (c) => this.classList._set.has(c),
    };
    this._listeners = new Map();
  }
  appendChild(c) { this.children.push(c); return c; }
  remove() {}
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 120 }; }
  requestPointerLock() { fakeDom.pointerLockElement = this; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  /** Fire an event at this element (test helper). */
  emit(type, payload = {}) {
    for (const fn of this._listeners.get(type) || []) fn({ preventDefault() {}, ...payload });
  }
}

const fakeDom = { pointerLockElement: null };
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  body: new FakeEl('body'),
  addEventListener() {},
  exitPointerLock() { fakeDom.pointerLockElement = null; },
  querySelector: () => null,
  activeElement: null,
};
Object.defineProperty(globalThis.document, 'pointerLockElement', {
  get: () => fakeDom.pointerLockElement,
});
globalThis.window = {
  addEventListener() {},
  matchMedia: () => ({ matches: false }),
  innerWidth: 1280,
  innerHeight: 720,
};
globalThis.navigator = { maxTouchPoints: 0 };

const { PlayerController, VIEW_CYCLE } = await import('./src/player/PlayerController.js');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── Rig ─────────────────────────────────────────────────────
function makeRig() {
  // The avatar is consumed by the controller through a handful of calls; a
  // Group with those stubs is enough and keeps the test focused on the camera.
  const avatar = new THREE.Group();
  avatar.position.set(0, 0, 0);
  avatar.visible = true;
  avatar.setMoving = () => {};
  avatar.setGait = () => {};
  avatar.playAction = () => {};
  avatar.setCrouching = () => {};
  avatar.update = () => {};
  avatar.setLookYaw = () => {};
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 5, 10);
  const canvas = new FakeEl('canvas');
  const controller = new PlayerController(avatar, camera, canvas);
  return { avatar, camera, canvas, controller };
}

const run = (controller, seconds = 1, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) controller.update(dt);
};

// ── Modes ───────────────────────────────────────────────────
console.log('\n[View modes]');
{
  const { controller } = makeRig();
  check('Starts in third person', controller.viewLabel === 'Third person', controller.viewLabel);
  check('V cycle has three stops', VIEW_CYCLE.length === 3, VIEW_CYCLE.join(' → '));

  controller.cycleViewMode();
  check('First V → first person', controller.firstPerson === true, controller.viewLabel);

  controller.cycleViewMode();
  check('Second V → top-down', controller.cameraMode === 'iso', controller.viewLabel);

  controller.cycleViewMode();
  check('Third V → back to third person',
    !controller.firstPerson && controller.cameraMode === 'chase', controller.viewLabel);

  // First person must also work inside a building: interiors set the rig, but
  // the player still chooses the view.
  controller.setCameraMode('interior');
  const insideLabel = controller.viewLabel;
  controller.cycleViewMode();
  check('First person works inside interiors',
    controller.firstPerson === true && controller.cameraMode === 'interior',
    `${insideLabel} → ${controller.viewLabel}`);
}

// ── First person geometry ───────────────────────────────────
console.log('\n[First person]');
{
  const { controller, camera, avatar } = makeRig();
  avatar.position.set(10, 0, -4);
  controller.cameraYaw = 0;
  controller.cameraPitch = 0;
  controller.setCameraMode('first');
  run(controller, 1.5);

  check('Camera sits at eye height', Math.abs(camera.position.y - 1.62) < 0.12,
    `y = ${camera.position.y.toFixed(2)} m`);
  check('Camera sits on the character', Math.hypot(camera.position.x - 10, camera.position.z + 4) < 0.2,
    `(${camera.position.x.toFixed(2)}, ${camera.position.z.toFixed(2)}) vs (10, -4)`);
  check('The body is hidden so you see through your own eyes', avatar.visible === false);

  // Looking forward at yaw 0 means -Z.
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  check('Looking forward at yaw 0', dir.z < -0.95, `dir z = ${dir.z.toFixed(2)}`);

  // Crouching lowers the eye.
  controller.crouching = true;
  run(controller, 0.6);
  check('Crouching lowers the eye line', camera.position.y < 1.2,
    `y = ${camera.position.y.toFixed(2)} m`);

  // Switching back restores the body.
  controller.crouching = false;
  controller.setCameraMode('chase');
  run(controller, 0.6);
  check('Leaving first person shows the body again', avatar.visible === true);
}

// ── Pitch / yaw limits ──────────────────────────────────────
console.log('\n[Look limits]');
{
  const { controller } = makeRig();
  controller.setCameraMode('first');
  // Drag far past the top of the screen, then far past the bottom.
  for (let i = 0; i < 40; i++) controller.lookBy(0, -100);
  const up = controller.cameraPitch;
  for (let i = 0; i < 80; i++) controller.lookBy(0, 100);
  const down = controller.cameraPitch;

  check('Pitch clamps looking up', up >= -Math.PI / 2 && up <= -1.3, `${(up * 180 / Math.PI).toFixed(0)}°`);
  check('Pitch clamps looking down', down >= 1.3 && down <= Math.PI / 2, `${(down * 180 / Math.PI).toFixed(0)}°`);

  const yawBefore = controller.cameraYaw;
  for (let i = 0; i < 200; i++) controller.lookBy(60, 0);
  check('Yaw turns freely through a full circle',
    Math.abs(controller.cameraYaw - yawBefore) > Math.PI * 2,
    `${((controller.cameraYaw - yawBefore) / Math.PI).toFixed(1)}π turned`);
}

// ── Mouse drag through the real event path ──────────────────
console.log('\n[Mouse and touchpad]');
{
  const { controller, canvas } = makeRig();
  controller.setCameraMode('chase');

  const yaw0 = controller.cameraYaw;
  canvas.emit('pointerdown', { button: 0, pointerId: 1, clientX: 500, clientY: 400, pointerType: 'mouse' });
  canvas.emit('pointermove', { pointerId: 1, clientX: 600, clientY: 400 });
  canvas.emit('pointerup', { pointerId: 1 });
  check('Dragging the mouse rotates the camera', Math.abs(controller.cameraYaw - yaw0) > 0.2,
    `yaw moved ${(controller.cameraYaw - yaw0).toFixed(2)} rad`);

  // Dragging right swings the camera one way; check the sign is consistent.
  const yawLeft = controller.cameraYaw;
  canvas.emit('pointerdown', { button: 0, pointerId: 2, clientX: 0, clientY: 0, pointerType: 'mouse' });
  canvas.emit('pointermove', { pointerId: 2, clientX: -100, clientY: 0 });
  canvas.emit('pointerup', { pointerId: 2 });
  check('Dragging back the other way turns it back', controller.cameraYaw > yawLeft,
    `${yawLeft.toFixed(2)} → ${controller.cameraYaw.toFixed(2)}`);

  // Sensitivity scales the same gesture.
  controller.setLookSettings({ sensitivity: 1 });
  const a = controller.cameraYaw;
  controller.lookBy(100, 0);
  const base = Math.abs(controller.cameraYaw - a);

  controller.setLookSettings({ sensitivity: 2 });
  const b = controller.cameraYaw;
  controller.lookBy(100, 0);
  const doubled = Math.abs(controller.cameraYaw - b);
  check('Sensitivity scales the look', Math.abs(doubled / base - 2) < 0.05,
    `${base.toFixed(3)} vs ${doubled.toFixed(3)} rad`);

  controller.setLookSettings({ sensitivity: 100 });
  check('Sensitivity is clamped to a sane range', controller.look.sensitivity <= 4,
    `${controller.look.sensitivity}×`);

  // Invert Y flips only pitch. Small movement, so no clamp can hide the sign.
  controller.setCameraMode('first');
  controller.setLookSettings({ sensitivity: 1, invertY: false });
  controller.cameraPitch = 0;
  controller.lookBy(0, 20);
  const normalPitch = controller.cameraPitch;
  controller.cameraPitch = 0;
  controller.setLookSettings({ invertY: true });
  controller.lookBy(0, 20);
  const invertedPitch = controller.cameraPitch;
  check('Invert Y flips the vertical axis',
    Math.sign(normalPitch) === -Math.sign(invertedPitch) && Math.abs(normalPitch + invertedPitch) < 1e-6,
    `${normalPitch.toFixed(3)} vs ${invertedPitch.toFixed(3)}`);

  // Touch drag on the world rotates too (touch handling lives on the canvas).
  controller.setLookSettings({ invertY: false });
  const yawT0 = controller.cameraYaw;
  canvas.emit('touchstart', { touches: [{ clientX: 300, clientY: 300 }] });
  canvas.emit('touchmove', { touches: [{ clientX: 420, clientY: 300 }] });
  canvas.emit('touchend', { touches: [] });
  check('Touch-drag rotates the camera', Math.abs(controller.cameraYaw - yawT0) > 0.2,
    `${(controller.cameraYaw - yawT0).toFixed(2)} rad`);
}

// ── Wheel zoom ──────────────────────────────────────────────
console.log('\n[Zoom]');
{
  const { controller, canvas } = makeRig();
  controller.setCameraMode('chase');
  const z0 = controller.zoomLevel;
  canvas.emit('wheel', { deltaY: 240 });
  check('Wheel zooms out', controller.zoomLevel > z0, `${z0.toFixed(2)} → ${controller.zoomLevel.toFixed(2)}`);
  for (let i = 0; i < 60; i++) controller.zoom(240);
  check('Zoom out is clamped', controller.zoomLevel <= 2.6, `${controller.zoomLevel.toFixed(2)}×`);
  for (let i = 0; i < 120; i++) controller.zoom(-240);
  check('Zoom in is clamped', controller.zoomLevel >= 0.45, `${controller.zoomLevel.toFixed(2)}×`);

  controller.setCameraMode('first');
  const before = controller.zoomLevel;
  controller.zoom(240);
  check('First person ignores zoom', controller.zoomLevel === before, `${before}×`);
}

// ── Keyboard turning does not steal other keys ──────────────
console.log('\n[Keyboard]');
{
  const { controller } = makeRig();
  controller.setCameraMode('chase');

  controller.keys['KeyQ'] = true;
  const qYaw = controller.cameraYaw;
  run(controller, 0.4);
  check('Q does not turn the camera (it is the graphics cycle)',
    Math.abs(controller.cameraYaw - qYaw) < 1e-9, 'Q ignored by the camera');
  controller.keys['KeyQ'] = false;

  controller.keys['KeyE'] = true;
  const eYaw = controller.cameraYaw;
  run(controller, 0.4);
  check('E does not turn the camera (it is interact)',
    Math.abs(controller.cameraYaw - eYaw) < 1e-9, 'E ignored by the camera');
  controller.keys['KeyE'] = false;

  controller.keys['Comma'] = true;
  run(controller, 0.4);
  controller.keys['Comma'] = false;
  check(', turns the camera left', controller.cameraYaw > eYaw,
    `yaw ${controller.cameraYaw.toFixed(2)} rad`);

  const beforePeriod = controller.cameraYaw;
  controller.keys['Period'] = true;
  run(controller, 0.4);
  controller.keys['Period'] = false;
  check('. turns the camera right', controller.cameraYaw < beforePeriod,
    `yaw ${controller.cameraYaw.toFixed(2)} rad`);
}

// ── Pointer lock ────────────────────────────────────────────
console.log('\n[Pointer lock]');
{
  const { controller, canvas } = makeRig();
  fakeDom.pointerLockElement = null;

  // Off by default: a click must not capture the mouse.
  canvas.emit('pointerdown', { button: 0, pointerId: 3, clientX: 10, clientY: 10, pointerType: 'mouse' });
  check('Pointer lock is off by default', fakeDom.pointerLockElement === null);

  controller.setLookSettings({ pointerLock: true });
  canvas.emit('pointerdown', { button: 0, pointerId: 4, clientX: 10, clientY: 10, pointerType: 'mouse' });
  check('Clicking captures the mouse when the setting is on',
    fakeDom.pointerLockElement === canvas, 'requestPointerLock called');

  // Turning the setting off must release it.
  controller.pointerLocked = true;
  controller.setLookSettings({ pointerLock: false });
  check('Turning the setting off releases the mouse', fakeDom.pointerLockElement === null);
}

// ── Third-person camera stays out of walls ──────────────────
console.log('\n[Third person collision]');
{
  const { controller, camera, avatar } = makeRig();
  // A wall exactly where the third-person camera wants to sit (+Z, 8.5 m back).
  controller.setCollisionBoxes([{ minX: -8, maxX: 8, minZ: 4, maxZ: 12 }]);
  avatar.position.set(0, 0, 0);
  controller.cameraYaw = 0;       // camera sits at +Z, i.e. inside that wall
  controller.setCameraMode('chase');
  run(controller, 2);

  const inside = controller._collides(camera.position.x, camera.position.z);
  check('The camera pulls in rather than entering the wall', inside === false,
    `camera at (${camera.position.x.toFixed(1)}, ${camera.position.z.toFixed(1)}), wall starts at z = 4`);
  check('The camera is still behind the character',
    camera.position.z > 0.5, `z = ${camera.position.z.toFixed(2)}`);
}

// ── State export ────────────────────────────────────────────
console.log('\n[State]');
{
  const { controller } = makeRig();
  controller.setCameraMode('first');
  const state = controller.getState();
  check('getState reports the real view', state.firstPerson === true, JSON.stringify({ fp: state.firstPerson, mode: state.cameraMode }));
  check('getState keeps the movement fields',
    Number.isFinite(state.x) && Number.isFinite(state.z) && typeof state.crouching === 'boolean');
}

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
