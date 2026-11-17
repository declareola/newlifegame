// client/src/world/InteriorSystem.js
// Walking into buildings.
//
// The city and the interiors live in two separate THREE.Scene objects. The city
// scene keeps its sun, fog and shadows; the interior scene has its own small
// light rig (hemisphere fill + one point light per ceiling fitting + a shaft of
// daylight through the window). Entering swaps the active scene, the collision
// set, the movement bounds and the camera rig; leaving puts them back.
//
// Interiors are built lazily and cached, so a building is only generated the
// first time somebody opens its door.

import * as THREE from 'three';
import { buildInterior } from './InteriorBuilder.js';
import { allInteriors, buildDoorRegistry, buildingById } from './interiorData.js';
import { nearestStation } from './stations.js';
import { buildAirfield } from './airfield.js';

const ENTER_RADIUS = 2.4;

/** Interior types that have their own soundscape or NPC behaviour. */
const PLACE_BY_TYPE = {
  market: 'market',
  church: 'church',
  mosque: 'mosque',
  hospital: 'hospital',
  airport: 'airport',
  bank: 'bank',
  school: 'school',
  restaurant: 'restaurant',
  gym: 'gym',
  shop: 'shop',
  office: 'office',
};

export class InteriorSystem {
  /**
   * @param {object} o
   * @param {THREE.Object3D} o.avatar       - the local player avatar
   * @param {object} o.controller           - PlayerController
   * @param {THREE.Scene} o.cityScene       - the outdoor scene
   * @param {function} o.onSceneChange      - (scene|null) => void, null = back to city
   * @param {function} o.onToast            - (message, type) => void
   * @param {function} o.getSpeedMultiplier - optional
   */
  constructor({ avatar, controller, cityScene, onSceneChange, onToast, nav = null }) {
    this.avatar = avatar;
    this.controller = controller;
    this.cityScene = cityScene;
    this.onSceneChange = onSceneChange || (() => {});
    this.onToast = onToast || (() => {});
    this.nav = nav;

    this.defs = new Map();       // interiorId -> def
    this.cache = new Map();      // interiorId -> built interior
    // Doors are only placed where the player can actually reach them; the nav
    // grid is what knows which pavement connects to the street network.
    this.doors = buildDoorRegistry(nav);

    for (const d of allInteriors()) this.defs.set(d.id, d);

    this.isInside = false;
    this.place = null;
    this.activeId = null;
    this.active = null;          // built interior currently loaded
    this.returnTo = null;        // where to put the player on exit

    this.scene = this._makeScene();
    this.nearbyDoor = null;
    this.nearbyStation = null;
    this.stations = [];
    this.promptShown = false;

    this._buildPrompt();
    this._bindKeys();
    this._buildDoorMarkers();
  }

  // ── Scene + lights ────────────────────────────────────────

  _makeScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1013);

    // Interior light rig. Sunlight and street lights from the city do not
    // apply in here — this is a self-contained, warm indoor setup.
    const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x2a241d, 0.85);
    scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xfff2e0, 0.42);
    scene.add(ambient);

    // A soft directional "window light" for shape and contact shadows
    const sun = new THREE.DirectionalLight(0xffe9c9, 1.15);
    sun.position.set(-6, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    this.roomLights = [];
    return scene;
  }

  // ── Door markers in the city ──────────────────────────────

  _buildDoorMarkers() {
    this.markerGroup = new THREE.Group();
    this.markerGroup.name = 'door-markers';

    const ringGeo = new THREE.RingGeometry(0.72, 0.92, 28);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x6fe3ff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (const door of this.doors) {
      const ring = new THREE.Mesh(ringGeo, glowMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(door.x, 0.06, door.z);
      this.markerGroup.add(ring);

      // Little upright marker so doors are findable from a distance
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6),
        new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.28 })
      );
      post.position.set(door.x, 0.55, door.z);
      this.markerGroup.add(post);

      door._ring = ring;
      door._post = post;
    }
  }

  getMarkerGroup() {
    return this.markerGroup;
  }

  // ── Prompt UI ─────────────────────────────────────────────

  _buildPrompt() {
    const el = document.createElement('div');
    el.className = 'door-prompt hidden';
    el.innerHTML = '<span class="door-key">E</span><span class="door-label"></span>';
    document.body.appendChild(el);
    this.promptEl = el;
    this.promptLabel = el.querySelector('.door-label');

    el.addEventListener('click', () => this.interact());
  }

  _showPrompt(text) {
    if (!this.promptShown) {
      this.promptEl.classList.remove('hidden');
      this.promptShown = true;
    }
    if (this.promptLabel.textContent !== text) this.promptLabel.textContent = text;
  }

  _hidePrompt() {
    if (this.promptShown) {
      this.promptEl.classList.add('hidden');
      this.promptShown = false;
    }
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (this.nearbyDoor || this.isInside) this.interact();
    });
  }

  // ── Enter / leave ─────────────────────────────────────────

  /**
   * Does the player live at this listing?
   * Injected by main.js from the server's housing state — the client never
   * decides who owns what, it only mirrors what the server said.
   * @param {function(string):boolean} fn
   */
  setPropertyCheck(fn) {
    this.ownsProperty = typeof fn === 'function' ? fn : null;
  }

  /** Can this door be opened by this player? */
  canEnterDoor(door) {
    if (!door) return false;
    if (!door.propertyId) return true;
    return this.ownsProperty ? this.ownsProperty(door.propertyId) : false;
  }

  interact() {
    if (this.isInside) {
      // Standing at a bed, hob, till or gate: that is what E does. Anywhere
      // else in the room, E leaves — the way it always has.
      if (this.nearbyStation) {
        this.onStation?.(this.nearbyStation);
        return true;
      }
      this.leave();
      return true;
    }
    if (!this.nearbyDoor) return false;
    const door = this.nearbyDoor;

    if (!this.canEnterDoor(door)) {
      // A locked door says so, out loud. Silently doing nothing is the thing
      // that makes a game feel broken.
      this.onLocked?.(door);
      return false;
    }
    return this.enter(door.interiorId);
  }

  /** Build (or fetch from cache) an interior. */
  _getBuilt(interiorId) {
    if (this.cache.has(interiorId)) return this.cache.get(interiorId);

    const def = this.defs.get(interiorId);
    if (!def) return null;

    // Most interiors are rooms from InteriorBuilder. Airside is a scene of its
    // own and says so with `custom`, so the door/prompt/station machinery does
    // not need to know the difference.
    const built = def.custom === 'airfield' ? buildAirfield(def) : buildInterior(def);
    built.def = def;
    this.cache.set(interiorId, built);
    return built;
  }

  enter(interiorId) {
    const def = this.defs.get(interiorId);
    const built = this._getBuilt(interiorId);
    if (!def || !built) return false;

    // Remember where we came from — but only once. Walking from the terminal
    // out to the airfield must still leave you on the street when you finally
    // walk out of the airport, not in the terminal's doorway.
    if (!this.isInside) {
      this.returnTo = {
        x: this.avatar.position.x,
        z: this.avatar.position.z,
        rotY: this.avatar.rotation.y,
      };
    }

    // Swap contents
    if (this.active) this.scene.remove(this.active.group);
    this.scene.add(built.group);
    this._setRoomLights(built);

    // Move the avatar indoors
    this.cityScene.remove(this.avatar);
    this.scene.add(this.avatar);
    this.avatar.position.set(built.spawn.x, 0, built.spawn.z);
    this.avatar.rotation.y = built.spawn.rotY;

    // Walls, bounds, camera
    this.controller.setCollisionBoxes(built.collisions);
    this.controller.setBounds(built.bounds);
    this.controller.setRoomBounds({
      minX: built.bounds.minX + 0.35,
      maxX: built.bounds.maxX - 0.35,
      minZ: built.bounds.minZ + 0.35,
      maxZ: built.bounds.maxZ - 0.35,
      maxY: (def.height ?? 3) - 0.35,
    });
    this.controller.setCameraMode('interior');
    // Stand the character facing into the room, with the camera behind them.
    // Setting avatar.rotation.y alone did nothing: the controller rewrites it
    // from its own `facing` every frame, so the player entered every building
    // walking backwards, staring at the door.
    const spawnRot = built.spawn?.rotY ?? Math.PI;
    if (this.controller.setFacing) this.controller.setFacing(spawnRot, { cameraYaw: 0 });
    else { this.controller.cameraYaw = 0; this.avatar.rotation.y = spawnRot; }

    this.isInside = true;
    // What can be done in here. Stations live in the built room (they are
    // registered by the layout that placed the furniture), so they always sit
    // where the furniture they belong to actually is.
    this.stations = built.stations || [];
    this.nearbyStation = null;
    // Which kind of place this is, for ambience and for pose choices.
    this.place = PLACE_BY_TYPE[def.type] || null;
    this.activeId = interiorId;
    this.active = built;
    this.nearbyDoor = null;
    this._hidePrompt();

    this.onSceneChange(this.scene);
    this.onToast(`Entered ${def.name}`, 'info');
    return true;
  }

  leave() {
    if (!this.isInside) return false;

    this.scene.remove(this.avatar);
    this.cityScene.add(this.avatar);

    const back = this.returnTo || { x: 0, z: 0, rotY: 0 };
    this.avatar.position.set(back.x, 0, back.z);
    // Same trap as entering: the controller owns the rotation.
    if (this.controller.setFacing) this.controller.setFacing(back.rotY ?? 0, { cameraYaw: null });
    else this.avatar.rotation.y = back.rotY;

    // Restore city collision + bounds
    if (this.cityCollisionBoxes) this.controller.setCollisionBoxes(this.cityCollisionBoxes);
    this.controller.setBounds(null);
    this.controller.setRoomBounds(null);
    this.controller.setCameraMode('chase');

    this.isInside = false;
    this.place = null;
    this.activeId = null;
    this.active = null;
    this.stations = [];
    this.nearbyStation = null;
    this._hidePrompt();

    this.onSceneChange(null);
    this.onToast('Left the building', 'info');
    return true;
  }

  /**
   * Walk from one interior straight into another (the airport gate → airside).
   * Keeps the street return position, so leaving the airport still puts you back
   * on the pavement where you came in.
   * @param {string} interiorId
   * @returns {boolean}
   */
  enterFromInside(interiorId) {
    if (!this.isInside) return this.enter(interiorId);
    const target = this.defs.get(interiorId);
    if (!target) return false;
    if (!this._getBuilt(interiorId)) return false;
    return this.enter(interiorId);
  }

  /** main.js hands the city collision set over so leave() can restore it. */
  setCityCollisionBoxes(boxes) {
    this.cityCollisionBoxes = boxes;
  }

  _setRoomLights(built) {
    for (const l of this.roomLights) this.scene.remove(l);
    this.roomLights = [];

    // Real point lights, capped at 3 for performance — but *spread* across the
    // fittings rather than taken from the front of the list. A shop floor has
    // six downlights; lighting only the first three leaves the back half dark.
    const all = built.lights;
    const positions = all.length <= 3
      ? all
      : [0, Math.floor((all.length - 1) / 2), all.length - 1].map((i) => all[i]);
    for (const p of positions) {
      const light = new THREE.PointLight(0xffe4b8, 12, 9, 2);
      light.position.set(p.x, p.y, p.z);
      light.castShadow = false;
      this.scene.add(light);
      this.roomLights.push(light);
    }

    // Aim the window light at the middle of the room
    if (this.sun) {
      this.sun.position.set(-7, 8, 5);
      this.sun.target.position.set(0, 0.8, 0);
      this.sun.target.updateMatrixWorld();
    }
  }

  // ── Per-frame ─────────────────────────────────────────────

  update(dt = 0.016) {
    if (this.isInside) {
      // Airside has moving aircraft; every other room has nothing to animate.
      if (this.active && typeof this.active.update === 'function') {
        try {
          this.active.update(dt);
        } catch {
          this.active.update = null;   // stop trying every frame
        }
      }

      // What is within arm's reach in this room?
      this.nearbyStation = nearestStation(this.stations, this.avatar.position);

      // Leaving is always available near the door
      const bounds = this.active?.bounds;
      const nearExit = bounds && this.avatar.position.z > bounds.maxZ - 1.4;
      this.nearbyDoor = nearExit ? { interiorId: this.activeId, name: 'Outside' } : null;

      // The prompt tells the truth about what E will do: a station wins when
      // you are standing at one, otherwise E still walks you out.
      if (this.nearbyStation) {
        this._showPrompt(`${this.nearbyStation.icon} ${this.nearbyStation.label}`);
      } else if (nearExit) {
        this._showPrompt('Leave the building');
      } else {
        this._showPrompt('Press E to leave');
      }
      return;
    }

    // Find the closest enterable door
    let best = null;
    let bestDist = ENTER_RADIUS * ENTER_RADIUS;
    const px = this.avatar.position.x;
    const pz = this.avatar.position.z;

    for (const door of this.doors) {
      const dx = door.x - px;
      const dz = door.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDist) {
        bestDist = d2;
        best = door;
      }
    }

    this.nearbyDoor = best;

    if (best) {
      this._showPrompt(this.canEnterDoor(best)
        ? `Enter ${best.name}`
        : `🔒 ${best.name} — not your home`);
    } else {
      this._hidePrompt();
    }

    // Pulse the door rings
    const t = performance.now() * 0.002;
    for (const door of this.doors) {
      if (!door._ring) continue;
      const near = best && best.interiorId === door.interiorId;
      const s = near ? 1 + Math.sin(t * 2) * 0.06 : 1;
      door._ring.scale.setScalar(s);
      door._ring.material.opacity = near ? 0.85 : 0.45;
    }
  }

  /** Position to report to the server — always a city coordinate. */
  getReportPosition() {
    if (this.isInside && this.returnTo) {
      return { x: this.returnTo.x, z: this.returnTo.z, rot: this.returnTo.rotY, moving: false };
    }
    return {
      x: this.avatar.position.x,
      z: this.avatar.position.z,
      rot: this.avatar.rotation.y,
      moving: this.avatar.isMoving,
    };
  }

  /** List of enterable places, for the UI. */
  listDoors() {
    return this.doors.map((d) => ({
      interiorId: d.interiorId,
      name: d.name,
      x: d.x,
      z: d.z,
      residential: d.residential,
      buildingName: buildingById(d.buildingId)?.name || d.name,
    }));
  }
}
