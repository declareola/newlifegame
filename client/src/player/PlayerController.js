// client/src/player/PlayerController.js
// Character controller: input, movement, gravity, collision, camera.
//
// Replaces the Step 2 controller. Everything that was exported before is still
// exported with the same signature, so existing callers keep working:
//   setCollisionBoxes / setSpeedMultiplier / setControlsLocked /
//   setCameraMode / cycleCameraMode / setBounds / setRoomBounds / update
//
// New in this version:
//   · gravity + jumping (Space) with coyote time and jump buffering
//   · sprint (Shift) with a stamina-free but speed-scaled gait
//   · crouch (C) that lowers the capsule and slows movement
//   · acceleration / deceleration / turn smoothing instead of instant velocity
//   · circle collision against dynamic obstacles (NPCs, vehicles)
//   · three view modes on V: chase, **first person**, top-down
//   · mouse look (drag, or pointer-locked), , / . to turn, wheel to zoom
//   · touch look: drag anywhere on the world to swing the camera
//   · camera collision so the view never ends up inside a wall
//
// Camera model
// ------------
// Two independent things:
//   rig   — how far from the body we stand ('chase' | 'iso' | 'interior')
//   view  — 'third' or 'first'
// V cycles chase(third) → chase(first) → top-down(third) → chase(third).
// Interiors force the 'interior' rig but keep whichever view you were in, so
// first person works indoors too.

import * as THREE from 'three';
import { isTouchDevice } from '../hud/TouchControls.js';

const WALK_SPEED = 4.2;
const RUN_SPEED = 8.4;
const CROUCH_SPEED = 2.0;

const ACCEL = 26;          // m/s² toward target velocity
const DECEL = 30;
const AIR_CONTROL = 0.32;

const GRAVITY = 24;
const JUMP_VELOCITY = 7.4;
const COYOTE_TIME = 0.12;  // grace period after walking off a ledge
const JUMP_BUFFER = 0.16;  // pressing jump just before landing still works

const MAP_BOUND = 95;

const EYE_HEIGHT = 1.62;
const CROUCH_EYE = 1.05;

const CAMERA_MODES = {
  // Chase sits higher and further back than a game-pad third person camera,
  // because the point of it is to read the street: kerbs, doors, junctions.
  // At 3.6 m the kerb wall filled the bottom third of the first screenshot and
  // the city was almost invisible.
  chase:    { distance: 9.5,  height: 5.2,  lookHeight: 1.5,  fov: 62 },
  iso:      { distance: 22,   height: 19.0, lookHeight: 1.0,  fov: 42 },
  // Indoors the rig has to fit behind the player *inside* the room: 3.4 m of
  // distance and 2.2 m of height clears a 4.2 m ceiling and still shows the
  // floor either side of the character.
  interior: { distance: 3.0,  height: 2.15, lookHeight: 1.10, fov: 62 },
  // First person is a rig of its own: no distance, the camera IS the head.
  first:    { distance: 0,    height: 0,    lookHeight: 0,    fov: 72 },
};

// The order V steps through. First person sits between the two third-person
// reads so a single key always reaches it.
export const VIEW_CYCLE = ['chase', 'first', 'iso'];

// Pitch limits (radians). Positive pitch looks DOWN, in first and third person
// alike, because the look direction is (-sin yaw·cosP, -sinP, -cos yaw·cosP).
const PITCH_MIN = -1.43;        // first person: 82° up
const PITCH_MAX = 1.43;         // first person: 82° down
const PITCH_MIN_THIRD = -0.35;  // third person: a little above the horizon
const PITCH_MAX_THIRD = 1.15;

export class PlayerController {
  constructor(avatar, camera, domElement) {
    this.avatar = avatar;
    this.camera = camera;
    this.domElement = domElement;

    this.isTouch = this._detectTouch();

    // ── Camera orbit ──
    this.cameraYaw = 0;
    this.cameraPitch = 0.30;          // radians above the horizon
    this.cameraMode = 'chase';        // rig preset
    this.firstPerson = false;         // view flag
    this._rig = { distance: 8.5, height: 3.6, lookHeight: 1.5, fov: 60 };
    this.zoomLevel = 1;               // multiplier on the mode distance
    this._roomBounds = null;
    this._bobPhase = 0;
    this._bob = 0;

    // ── Look settings (persisted; the pause menu edits these) ──
    this.look = {
      sensitivity: 1.0,     // multiplier on mouse/touch look
      invertY: false,
      pointerLock: false,   // click the world to capture the mouse
      smooth: 18,           // how quickly the view catches up
    };
    this.pointerLocked = false;
    this.lookAxis = { x: 0, y: 0 };   // Q/E + arrow-free keyboard turning

    // ── Movement state ──
    this.velocity = new THREE.Vector3();  // horizontal only (x, z)
    this.verticalVelocity = 0;
    this.grounded = true;
    this.crouching = false;
    this.sprinting = false;
    this.jumping = false;
    this.airTime = 0;
    this._coyote = 0;
    this._jumpBuffer = 0;
    this.facing = 0;                  // smoothed facing angle

    // ── Collision ──
    this.collisionBoxes = [];
    this.playerRadius = 0.38;
    this.dynamicObstacles = [];       // [{x, z, radius}] — NPCs and vehicles
    this.bounds = { minX: -MAP_BOUND, maxX: MAP_BOUND, minZ: -MAP_BOUND, maxZ: MAP_BOUND };

    // ── Server-controlled ──
    this.speedMultiplier = 1.0;
    this.controlsLocked = false;

    // ── Input ──
    this.keys = {};
    this.joystickActive = false;
    this.joystickPointerId = null;
    this.joystickVector = { x: 0, y: 0 };
    this.dragging = false;
    this.dragPointerId = null;
    this.lastPointer = { x: 0, y: 0 };
    this.touchCameraDrag = null;

    // Callbacks other systems can hook (used by the vehicle system)
    this.onJump = null;

    this._createJoystick();
    this._bindEvents();
  }

  // ── Public API (unchanged names) ───────────────────────────

  /**
   * Terrain test for things that are not boxes: on Eko Basin the lagoon.
   * `fn(x, z) === false` means "cannot stand here". Boxes alone cannot express
   * the sea, and without this the player simply walks off the quay.
   */
  setTerrainCheck(fn) {
    this.terrainCheck = typeof fn === 'function' ? fn : null;
  }

  /**
   * How high the ground is under a world position.
   *
   * It used to be flat everywhere in this city, so the controller hard-coded
   * y = 0 as the floor. The three Eko Basin bridges are ramps: the deck climbs to
   * its crown and comes back down, so the floor is a function of where you stand.
   * Off a bridge the profile answers 0, which is the island surface, so nothing
   * else about the world has to change.
   *
   * @param {(x:number, z:number) => (number|null)} [fn]
   */
  setGroundHeight(fn) {
    this.groundHeight = typeof fn === 'function' ? fn : null;
  }

  /** Ground height underfoot at (x, z); 0 when there is no profile. */
  _groundAt(x, z) {
    if (!this.groundHeight) return 0;
    const y = this.groundHeight(x, z);
    return Number.isFinite(y) ? y : 0;
  }

  setCollisionBoxes(boxes) {
    this.collisionBoxes = boxes || [];
  }

  setDynamicObstacles(list) {
    this.dynamicObstacles = list || [];
  }

  setSpeedMultiplier(value) {
    this.speedMultiplier = value;
  }

  setControlsLocked(value) {
    this.controlsLocked = value;
    if (value) {
      this.velocity.set(0, 0, 0);
      this.crouching = false;
    }
  }

  setBounds(bounds) {
    this.bounds = bounds || { minX: -MAP_BOUND, maxX: MAP_BOUND, minZ: -MAP_BOUND, maxZ: MAP_BOUND };
  }

  setRoomBounds(bounds) {
    this._roomBounds = bounds;
  }

  /**
   * Point the character somewhere and keep it there.
   *
   * `_updateMovement` writes `avatar.rotation.y = this.facing` every frame, so
   * anything that turns the avatar directly (entering a building, exiting one,
   * a teleport) has its rotation overwritten on the very next frame and the
   * character ends up facing the door it just walked through. This sets the
   * controller's own facing, which is the value that actually sticks.
   *
   * @param {number} rotY radians
   * @param {object} [o]
   * @param {number} [o.cameraYaw] camera yaw to match (0 = looking the same way)
   * @param {boolean} [o.snap] true to apply this frame instead of easing
   */
  setFacing(rotY, { cameraYaw = null, snap = true } = {}) {
    if (!Number.isFinite(rotY)) return this.facing;
    this.facing = rotY;
    this.avatar.rotation.y = rotY;
    if (Number.isFinite(cameraYaw)) this.cameraYaw = cameraYaw;
    if (snap) this._facingSettled = true;
    return this.facing;
  }

  setCameraMode(mode) {
    if (!CAMERA_MODES[mode]) return;
    // A top-down rig inside a 4 m room puts the camera in the ceiling. Callers
    // that do not know about rooms (the pause menu, scripts) get the interior
    // rig instead of a grey screen.
    if (mode === 'iso' && this._roomBounds) mode = 'interior';
    this.cameraMode = mode;
    // A top-down view has no meaningful "over the shoulder" angle.
    if (mode === 'iso') {
      this.cameraYaw = Math.PI / 4;
      this.cameraPitch = 0.55;
      this.firstPerson = false;
    }
    if (mode === 'first') this.firstPerson = true;
    else if (mode !== 'interior') this.firstPerson = false;
  }

  /** Legacy alias: cycles the rig between chase and top-down. */
  cycleCameraMode() {
    if (this.firstPerson) {
      this.firstPerson = false;
      if (this.cameraMode === 'first') this.cameraMode = 'chase';
      return this.cameraMode;
    }
    if (this.cameraMode === 'interior') return this.cameraMode;
    this.setCameraMode(this.cameraMode === 'chase' ? 'iso' : 'chase');
    return this.cameraMode;
  }

  /** V — third person → the character's own eyes → top-down → third person. */
  cycleViewMode() {
    // Indoors there is no top-down rig, so V just flips the view.
    if (this.cameraMode === 'interior') {
      this.firstPerson = !this.firstPerson;
      return this.firstPerson ? 'first' : 'interior';
    }
    const current = this.firstPerson ? 'first' : this.cameraMode;
    const next = VIEW_CYCLE[(VIEW_CYCLE.indexOf(current) + 1) % VIEW_CYCLE.length];
    this.setCameraMode(next);
    return next;
  }

  /** Human-readable label for the HUD/toast. */
  get viewLabel() {
    if (this.firstPerson) return this.cameraMode === 'interior' ? 'First person (inside)' : 'First person';
    if (this.cameraMode === 'iso') return 'Top-down';
    if (this.cameraMode === 'interior') return 'Interior';
    return 'Third person';
  }

  /** V — backwards-compatible toggle for anything that only wants two views. */
  toggleFirstPerson() {
    if (this.cameraMode === 'iso') {
      this.setCameraMode('chase');
      return false;
    }
    this.firstPerson = !this.firstPerson;
    return this.firstPerson;
  }

  setLookSettings(next = {}) {
    Object.assign(this.look, next);
    if (typeof this.look.sensitivity !== 'number' || !Number.isFinite(this.look.sensitivity)) {
      this.look.sensitivity = 1;
    }
    this.look.sensitivity = THREE.MathUtils.clamp(this.look.sensitivity, 0.15, 4);
    // Leaving pointer lock on while it is being turned off must release the mouse.
    if (!this.look.pointerLock && this.pointerLocked) this.exitPointerLock();
  }

  /** Programmatic look, used by Q/E and by the touch look area. */
  lookBy(dxPixels, dyPixels) {
    const s = this.look.sensitivity;
    this.cameraYaw -= dxPixels * 0.005 * s;
    const pitchDelta = dyPixels * 0.004 * s * (this.look.invertY ? -1 : 1);
    const [lo, hi] = this.firstPerson ? [PITCH_MIN, PITCH_MAX] : [PITCH_MIN_THIRD, PITCH_MAX_THIRD];
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + pitchDelta, lo, hi);
  }

  enterPointerLock() {
    if (!this.look.pointerLock || this.pointerLocked) return false;
    const el = this.domElement;
    if (!el?.requestPointerLock) return false;
    if (typeof el.requestPointerLock === 'function') {
      el.requestPointerLock();
      return true;
    }
    return false;
  }

  exitPointerLock() {
    if (document.exitPointerLock) document.exitPointerLock();
    this.pointerLocked = false;
  }

  /** Wheel zoom. `delta` is the raw wheel deltaY. */
  zoom(delta) {
    if (this.firstPerson) return;
    const factor = delta > 0 ? 1.12 : 1 / 1.12;
    this.zoomLevel = THREE.MathUtils.clamp(this.zoomLevel * factor, 0.45, 2.6);
  }

  /** Freeze movement while a menu is open, without losing camera control. */
  setPaused(paused) {
    this.paused = paused;
    if (paused) this.velocity.set(0, 0, 0);
  }

  // ── Collision ──────────────────────────────────────────────

  _collides(x, z) {
    const r = this.playerRadius;
    const rSq = r * r;

    for (const box of this.collisionBoxes) {
      const cx = Math.max(box.minX, Math.min(x, box.maxX));
      const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < rSq) return true;
    }

    if (this.terrainCheck && this.terrainCheck(x, z) === false) return true;

    for (const ob of this.dynamicObstacles) {
      const dx = x - ob.x;
      const dz = z - ob.z;
      const rr = r + (ob.radius || 0.4);
      if (dx * dx + dz * dz < rr * rr) return true;
    }

    return false;
  }

  // ── Input setup ────────────────────────────────────────────

  _detectTouch() {
    return (
      isTouchDevice() ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches
    );
  }

  _createJoystick() {
    this.joystickZone = document.createElement('div');
    this.joystickZone.className = 'joystick-zone';

    this.joystickBase = document.createElement('div');
    this.joystickBase.className = 'joystick-base';

    this.joystickKnob = document.createElement('div');
    this.joystickKnob.className = 'joystick-knob';

    this.joystickBase.appendChild(this.joystickKnob);
    this.joystickZone.appendChild(this.joystickBase);
    document.body.appendChild(this.joystickZone);

    if (!this.isTouch) this.joystickZone.classList.add('hidden');
  }

  _bindEvents() {
    window.addEventListener('keydown', (e) => {
      // Ignore movement keys while the player is typing in a text field
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      this.keys[e.code] = true;

      // Jump with buffering, so a press a frame or two early still fires
      if (e.code === 'Space') {
        e.preventDefault();
        this._jumpBuffer = JUMP_BUFFER;
      }
      if (e.code === 'KeyC' && !e.repeat) this.crouching = !this.crouching;

      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprinting = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sprinting = false;
    });

    // Losing focus must not leave keys stuck down
    window.addEventListener('blur', () => {
      this.keys = {};
      this.sprinting = false;
    });

    // ── Joystick ──
    this.joystickZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.joystickActive = true;
      this.joystickPointerId = e.pointerId;
      this.joystickZone.setPointerCapture?.(e.pointerId);
      this._updateJoystick(e);
    });
    this.joystickZone.addEventListener('pointermove', (e) => {
      if (this.joystickActive && e.pointerId === this.joystickPointerId) {
        e.preventDefault();
        this._updateJoystick(e);
      }
    });
    const endJoy = (e) => {
      if (e.pointerId === this.joystickPointerId) {
        this.joystickActive = false;
        this._resetJoystick();
      }
    };
    this.joystickZone.addEventListener('pointerup', endJoy);
    this.joystickZone.addEventListener('pointercancel', endJoy);

    // ── Mouse look ──
    //
    // Two ways to look, both standard:
    //   · pointer-lock off (default): press and drag anywhere in the world
    //   · pointer-lock on: one click captures the mouse, then just move it
    // Right-drag always looks, even with pointer lock available, so the left
    // button stays free for the UI.
    this.domElement.addEventListener('pointerdown', (e) => {
      if (e.button === 1) return;
      this.dragging = true;
      this.dragPointerId = e.pointerId;
      this.lastPointer.x = e.clientX;
      this.lastPointer.y = e.clientY;
      this.domElement.setPointerCapture?.(e.pointerId);

      // Click-to-capture, but only for a genuine mouse click on the world.
      if (this.look.pointerLock && !this.pointerLocked && e.pointerType === 'mouse') {
        this.enterPointerLock();
      }
    });

    this.domElement.addEventListener('pointermove', (e) => {
      if (this.pointerLocked) {
        // movementX/Y is already a delta and keeps working past the screen edge.
        this.lookBy(e.movementX || 0, e.movementY || 0);
        return;
      }
      if (!this.dragging || e.pointerId !== this.dragPointerId) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lookBy(dx, dy);
      this.lastPointer.x = e.clientX;
      this.lastPointer.y = e.clientY;
    });

    // Pointer lock can be released by the browser (Esc, tab switch).
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = Boolean(document.pointerLockElement);
    });

    // Touch look: a drag that starts on the world rotates the camera. The
    // joystick lives on its own element, so the two never fight.
    this.domElement.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      this.touchLook = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    this.domElement.addEventListener('touchmove', (e) => {
      if (!this.touchLook || e.touches.length !== 1) return;
      const t = e.touches[0];
      this.lookBy((t.clientX - this.touchLook.x) * 1.35, (t.clientY - this.touchLook.y) * 1.35);
      this.touchLook = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    this.domElement.addEventListener('touchend', () => { this.touchLook = null; }, { passive: true });

    const endDrag = (e) => {
      if (e.pointerId === this.dragPointerId) this.dragging = false;
    };
    this.domElement.addEventListener('pointerup', endDrag);
    this.domElement.addEventListener('pointercancel', endDrag);

    // ── Wheel zoom ──
    this.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY);
    }, { passive: false });

    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _updateJoystick(e) {
    const r = this.joystickBase.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    const max = r.width / 2 || 1;

    if (dist > max) {
      this.joystickVector.x = dx / dist;
      this.joystickVector.y = dy / dist;
    } else {
      this.joystickVector.x = dx / max;
      this.joystickVector.y = dy / max;
    }

    const knobX = this.joystickVector.x * max;
    const knobY = this.joystickVector.y * max;
    this.joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  }

  _resetJoystick() {
    this.joystickVector.x = 0;
    this.joystickVector.y = 0;
    this.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  // ── Per-frame ──────────────────────────────────────────────

  /**
   * Movement intent in world space, from keyboard + joystick.
   * Camera-relative, so "W" is always "away from the camera".
   */
  getMoveIntent() {
    const forwardX = -Math.sin(this.cameraYaw);
    const forwardZ = -Math.cos(this.cameraYaw);
    const rightX = Math.cos(this.cameraYaw);
    const rightZ = -Math.sin(this.cameraYaw);

    let kx = 0;
    let kz = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) { kx += forwardX; kz += forwardZ; }
    if (this.keys['KeyS'] || this.keys['ArrowDown']) { kx -= forwardX; kz -= forwardZ; }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) { kx -= rightX; kz -= rightZ; }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) { kx += rightX; kz += rightZ; }

    let jx = 0;
    let jz = 0;
    if (this.isTouch && this.joystickActive) {
      let joyX = this.joystickVector.x;
      let joyY = -this.joystickVector.y;
      if (Math.abs(joyX) < 0.08) joyX = 0;
      if (Math.abs(joyY) < 0.08) joyY = 0;
      jx = joyX * rightX + joyY * forwardX;
      jz = joyX * rightZ + joyY * forwardZ;
    }

    let x = kx + jx;
    let z = kz + jz;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, length: Math.min(len, 1) };
  }

  /** Target ground speed for the current stance. */
  getTargetSpeed() {
    if (this.crouching) return CROUCH_SPEED;
    return (this.sprinting ? RUN_SPEED : WALK_SPEED) * this.speedMultiplier;
  }

  update(deltaTime) {
    const dt = Math.min(deltaTime, 0.05);

    const intent = this.controlsLocked || this.paused
      ? { x: 0, z: 0, length: 0 }
      : this.getMoveIntent();

    const moving = intent.length > 0.06;
    const targetSpeed = this.getTargetSpeed();

    // ── Horizontal velocity: accelerate toward the intent, decelerate to rest ──
    const targetVX = intent.x * targetSpeed;
    const targetVZ = intent.z * targetSpeed;
    const rate = (moving ? ACCEL : DECEL) * (this.grounded ? 1 : AIR_CONTROL);
    const blend = 1 - Math.exp(-rate * dt);

    this.velocity.x += (targetVX - this.velocity.x) * blend;
    this.velocity.z += (targetVZ - this.velocity.z) * blend;

    if (Math.abs(this.velocity.x) < 0.02) this.velocity.x = 0;
    if (Math.abs(this.velocity.z) < 0.02) this.velocity.z = 0;

    // ── Gravity ──
    const wasGrounded = this.grounded;
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);
    this._coyote = this.grounded ? COYOTE_TIME : Math.max(0, this._coyote - dt);

    if (this._jumpBuffer > 0 && this._coyote > 0 && !this.controlsLocked && !this.paused) {
      this.verticalVelocity = JUMP_VELOCITY;
      this.grounded = false;
      this.jumping = true;
      this._jumpBuffer = 0;
      this._coyote = 0;
      if (this.onJump) this.onJump();
    }

    if (!this.grounded) {
      this.verticalVelocity -= GRAVITY * dt;
      this.airTime += dt;
    }

    this.avatar.position.y += this.verticalVelocity * dt;

    // The floor under the player, which is the bridge profile on a span and 0
    // everywhere else (roads, pavements, interiors).
    const groundY = this._groundAt(this.avatar.position.x, this.avatar.position.z);

    // Walking a ramp slides the ground under a grounded player. Without this the
    // character is airborne for one frame on every ascent and skips down the far
    // side, which reads as the bridge bucking under their feet.
    if (this.grounded && this.verticalVelocity <= 0
      && this.avatar.position.y > groundY
      && this.avatar.position.y - groundY < 0.75) {
      this.avatar.position.y = groundY;
    }

    if (this.avatar.position.y <= groundY) {
      this.avatar.position.y = groundY;
      if (!wasGrounded && this.verticalVelocity < -3) {
        // Landing: squash the gait and cancel the airborne pose
        this.airTime = 0;
      }
      this.verticalVelocity = 0;
      this.grounded = true;
      this.jumping = false;
      this.airTime = 0;
    } else {
      this.grounded = false;
    }

    // ── Apply movement with axis-separated collision (wall sliding) ──
    const stepX = this.velocity.x * dt;
    const stepZ = this.velocity.z * dt;

    // Sub-step so fast movement cannot tunnel through thin walls
    const steps = Math.max(1, Math.ceil(Math.hypot(stepX, stepZ) / 0.18));
    for (let i = 0; i < steps; i++) {
      const sx = stepX / steps;
      const sz = stepZ / steps;

      const tryX = this.avatar.position.x + sx;
      if (!this._collides(tryX, this.avatar.position.z)) {
        this.avatar.position.x = tryX;
      } else {
        this.velocity.x *= 0.4;
      }

      const tryZ = this.avatar.position.z + sz;
      if (!this._collides(this.avatar.position.x, tryZ)) {
        this.avatar.position.z = tryZ;
      } else {
        this.velocity.z *= 0.4;
      }
    }

    // ── Bounds ──
    const b = this.bounds;
    this.avatar.position.x = THREE.MathUtils.clamp(this.avatar.position.x, b.minX, b.maxX);
    this.avatar.position.z = THREE.MathUtils.clamp(this.avatar.position.z, b.minZ, b.maxZ);

    // ── Facing: turn smoothly toward travel direction ──
    const speedNow = Math.hypot(this.velocity.x, this.velocity.z);
    if (speedNow > 0.35) {
      const wanted = Math.atan2(this.velocity.x, this.velocity.z);
      let diff = wanted - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * (1 - Math.exp(-14 * dt));
    }
    this.avatar.rotation.y = this.facing;

    // ── Avatar animation state ──
    const gait = speedNow > 6 ? 1.6 : speedNow > 3 ? 1.0 : 0.65;
    this.avatar.setMoving(speedNow > 0.35, gait);
    this.avatar.setAirborne?.(!this.grounded);
    this.avatar.setCrouch?.(this.crouching);
    this.avatar.update(dt);

    this._updateCamera(dt, speedNow);

    this.isMoving = speedNow > 0.35;
    this.speed = speedNow;
  }

  _updateCamera(dt, speedNow, intent = null) {
    // ── Keyboard turning (Q / E, and the joystick's camera nub on touch) ──
    const turnSpeed = 2.2 * this.look.sensitivity;   // rad/s
    // Comma / period turn the camera. Q is the graphics cycle and E is
    // interact, so neither can be used for this.
    if (this.keys['Comma']) this.cameraYaw += turnSpeed * dt;
    if (this.keys['Period']) this.cameraYaw -= turnSpeed * dt;
    if (this.keys['PageUp']) this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch - 1.4 * dt, this.firstPerson ? PITCH_MIN : PITCH_MIN_THIRD, this.firstPerson ? PITCH_MAX : PITCH_MAX_THIRD);
    if (this.keys['PageDown']) this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + 1.4 * dt, this.firstPerson ? PITCH_MIN : PITCH_MIN_THIRD, this.firstPerson ? PITCH_MAX : PITCH_MAX_THIRD);

    // Keep the pitch legal for the view we just switched into.
    const [lo, hi] = this.firstPerson ? [PITCH_MIN, PITCH_MAX] : [PITCH_MIN_THIRD, PITCH_MAX_THIRD];
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch, lo, hi);

    const mode = this.firstPerson
      ? CAMERA_MODES.first
      : (CAMERA_MODES[this.cameraMode] || CAMERA_MODES.chase);

    // Interpolation rates. Third person eases; first person sticks to the head.
    const ease = 1 - Math.exp(-(this.firstPerson ? 26 : 8) * dt);

    const wantDistance = this.firstPerson ? 0 : mode.distance * this.zoomLevel;
    const wantHeight = this.firstPerson
      ? 0
      : mode.height * this.zoomLevel * (1 - this.cameraPitch * 0.25) + this.cameraPitch * 3.2;

    this._rig.distance += (wantDistance - this._rig.distance) * ease;
    this._rig.height += (wantHeight - this._rig.height) * ease;
    this._rig.lookHeight += (mode.lookHeight - this._rig.lookHeight) * ease;
    this._rig.fov += (mode.fov - this._rig.fov) * ease;

    if (Math.abs(this.camera.fov - this._rig.fov) > 0.01) {
      this.camera.fov = this._rig.fov;
      this.camera.updateProjectionMatrix();
    }

    const p = this.avatar.position;
    const yaw = this.cameraYaw;

    // ── First person ────────────────────────────────────────
    if (this.firstPerson) {
      // Hide the body: you are the eyes. (Remote players are separate objects.)
      this.avatar.visible = false;

      // Walk bob: small, vertical, and driven by actual speed so standing still
      // is perfectly steady.
      const speed = speedNow || 0;
      this._bobPhase += dt * (speed > 0.4 ? 7.5 + speed * 0.6 : 0);
      const bobTarget = speed > 0.4 ? Math.sin(this._bobPhase) * 0.022 * Math.min(speed / 4.2, 1.6) : 0;
      this._bob += (bobTarget - this._bob) * (1 - Math.exp(-16 * dt));

      const eyeY = p.y + (this.crouching ? CROUCH_EYE : EYE_HEIGHT) + this._bob;
      const lerp = 1 - Math.exp(-30 * dt);
      this.camera.position.x += (p.x - this.camera.position.x) * lerp;
      this.camera.position.y += (eyeY - this.camera.position.y) * lerp;
      this.camera.position.z += (p.z - this.camera.position.z) * lerp;

      // Look direction from yaw + pitch. Positive pitch looks down.
      const cosP = Math.cos(this.cameraPitch);
      const dirX = -Math.sin(yaw) * cosP;
      const dirY = -Math.sin(this.cameraPitch);
      const dirZ = -Math.cos(yaw) * cosP;
      this._lookTarget = this._lookTarget || new THREE.Vector3();
      this._lookTarget.set(
        this.camera.position.x + dirX * 8,
        this.camera.position.y + dirY * 8,
        this.camera.position.z + dirZ * 8,
      );
      this.camera.lookAt(this._lookTarget);

      // The avatar still faces where you look while walking, and stands still
      // facing forward when idle — so stepping back to third person is seamless.
      if (speed < 0.35 && this.grounded) {
        let diff = (yaw + Math.PI) - this.avatar.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.avatar.rotation.y += diff * (1 - Math.exp(-6 * dt));
      }
      return;
    }

    // ── Third person / top-down ─────────────────────────────
    this.avatar.visible = true;

    const targetX = p.x + Math.sin(yaw) * this._rig.distance;
    const targetZ = p.z + Math.cos(yaw) * this._rig.distance;
    const targetY = p.y + this._rig.height;

    const lerp = 1 - Math.exp(-12 * dt);
    this.camera.position.x += (targetX - this.camera.position.x) * lerp;
    this.camera.position.y += (targetY - this.camera.position.y) * lerp;
    this.camera.position.z += (targetZ - this.camera.position.z) * lerp;

    // Keep the camera out of walls: if it lands in a collider, pull it toward
    // the player until it is clear. This is a cheap sphere-cast substitute.
    if (this.collisionBoxes.length) {
      let guard = 0;
      while (this._collides(this.camera.position.x, this.camera.position.z) && guard++ < 8) {
        this.camera.position.x += (p.x - this.camera.position.x) * 0.25;
        this.camera.position.z += (p.z - this.camera.position.z) * 0.25;
        this.camera.position.y += 0.12;
      }
    }

    if (this._roomBounds) {
      const r = this._roomBounds;
      this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, r.minX, r.maxX);
      this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, r.minZ, r.maxZ);
      this.camera.position.y = Math.min(this.camera.position.y, r.maxY ?? 2.9);
    }

    const shake = this.grounded ? 0 : Math.min(this.airTime, 0.4) * 0.02;
    this._lookTarget = this._lookTarget || new THREE.Vector3();
    this._lookTarget.set(
      p.x + (Math.random() - 0.5) * shake,
      p.y + this._rig.lookHeight,
      p.z + (Math.random() - 0.5) * shake
    );
    this.camera.lookAt(this._lookTarget);
    void intent;
  }

  /** Serialisable movement state, for save/restore and the HUD. */
  getState() {
    return {
      x: this.avatar.position.x,
      y: this.avatar.position.y,
      z: this.avatar.position.z,
      rot: this.avatar.rotation.y,
      grounded: this.grounded,
      crouching: this.crouching,
      sprinting: this.sprinting,
      speed: this.speed || 0,
      firstPerson: this.firstPerson,
      cameraMode: this.cameraMode,
    };
  }
}
