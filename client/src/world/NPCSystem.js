// client/src/world/NPCSystem.js
// Ambient population with real interaction.
//
// NPCs walk patrol loops that are validated against the navigation grid, so
// none of them can walk through a building or get stuck behind one. Approaching
// one shows their name and role; E opens a dialogue with branching choices that
// actually do things — hand out work, sell food, top up a need, or point you at
// a place and start navigation.
//
// Everything an NPC can do routes through the same callbacks the rest of the
// game uses (open the job board, buy an item, start navigation), never a
// special-cased fake result.

import * as THREE from 'three';
import { Avatar } from '../player/Avatar.js';
import { buildings } from './cityData.js';
import { materials } from './materials.js';

const TALK_RADIUS = 3.0;

// ── Role poses ──────────────────────────────────────────────────
// What each role does when they stop walking. The avatar has thirteen poses;
// these are the ones that make a place read as a place: a banker types, a
// priest prays, a chef serves, a student reads.
export const ROLE_POSES = {
  vendor: 'serve',
  banker: 'type',
  employer: 'work',
  officer: 'sitUpright',
  nurse: 'work',
  mechanic: 'crouchWork',
  resident: 'stand',
  trader: 'serve',
  priest: 'pray',
  imam: 'pray',
  teacher: 'work',
  chef: 'serve',
  agent: 'type',
  student: 'sit',
};

// ── Role definitions ────────────────────────────────────────────
// Each role gets a look, a name plate and a dialogue tree. Dialogue nodes are
// functions so they can react to live state (cash, needs, current job).
export const ROLES = {
  vendor: {
    label: 'Food Vendor',
    look: { outfit: 'trader', skin: 0x8d5524, hair: 'braids' },
    greeting: 'Hot suya, fresh from the grill. You want some?',
  },
  banker: {
    label: 'Bank Clerk',
    look: { outfit: 'office', skin: 0x6b4a2f, hair: 'braids', body: 'slim' },
    greeting: 'Welcome to the bank. Deposit, withdraw, or just checking your balance?',
  },
  employer: {
    label: 'Site Foreman',
    look: { outfit: 'worker', top: 0xe67e22, bottom: 0x2f3640, skin: 0x5c3a21, hair: 'bald', body: 'broad', head: 'cap' },
    greeting: 'You look like you can work. We always need hands.',
  },
  officer: {
    label: 'Police Officer',
    look: { outfit: 'office', top: 0x2c3e6b, bottom: 0x1c2833, garment: 'blazer', skin: 0x7a4f2a, hair: 'short', body: 'broad', head: 'cap', extra: 'none' },
    greeting: 'Keep your nose clean and we will get along fine.',
  },
  nurse: {
    label: 'Nurse',
    look: { outfit: 'office', top: 0xeef5f8, bottom: 0x2f6f8f, garment: 'none', sleeve: 'short', skin: 0x8d5524, hair: 'short', body: 'slim', head: 'none', extra: 'watch' },
    greeting: 'Are you hurt? You look tired, honestly.',
  },
  mechanic: {
    label: 'Mechanic',
    look: { outfit: 'worker', top: 0x2b5d8a, bottom: 0x2f3640, skin: 0x3b2416, hair: 'bald', body: 'broad', head: 'cap' },
    greeting: 'Engine trouble? Or are you here to buy?',
  },
  resident: {
    label: 'Resident',
    look: { outfit: 'casual', top: 0x3f6b5e, bottom: 0x4a4038, skin: 0x5c3a21, hair: 'afro' },
    greeting: 'Afternoon. Nice day for a walk, abi?',
  },
  trader: {
    label: 'Trader',
    look: { outfit: 'trader', skin: 0x6b4a2f, hair: 'afro' },
    greeting: 'Buy something or move, my friend. Time is money.',
  },
  priest: {
    label: 'Father Emeka',
    // A long cream robe: the closest the wardrobe gets to a cassock (kaba).
    look: { outfit: 'modest', top: 0xf5f3ec, bottom: 0xece7da, garment: 'kaba', sleeve: 'long', skin: 0x8d5524, hair: 'short', body: 'slim', head: 'none', extra: 'none', shoes: 'loafers' },
    greeting: 'You are welcome in the house of the Lord. Sit anywhere — the pews are for everyone.',
  },
  imam: {
    label: 'Imam Sulaiman',
    look: { outfit: 'kaftan', top: 0xf7f7f2, bottom: 0xf7f7f2, skin: 0x7a4f2a, hair: 'short', body: 'average', head: 'kufi', extra: 'none' },
    greeting: 'As-salamu alaykum. Remove your shoes at the rack before you come in.',
  },
  teacher: {
    label: 'Madam Bisi',
    look: { outfit: 'office', top: 0x2f6f8f, bottom: 0x243b53, garment: 'blazer', skin: 0x6b4a2f, hair: 'braids', body: 'slim', head: 'none', extra: 'glasses' },
    greeting: 'Class is in session. If you can read a blackboard you can learn a trade.',
  },
  chef: {
    label: 'Mama Nkechi',
    look: { outfit: 'worker', top: 0xf0efe9, bottom: 0x2f3640, garment: 'none', sleeve: 'short', skin: 0x5c3a21, hair: 'braids', body: 'average', head: 'cap', extra: 'none' },
    greeting: 'Jollof is on the fire. Suya, pepper soup — what are you eating today?',
  },
  agent: {
    label: 'Airport Agent',
    look: { outfit: 'office', top: 0x0b3d91, bottom: 0x1c2833, garment: 'waistcoat', skin: 0x8d5524, hair: 'short', body: 'average', head: 'cap', extra: 'none' },
    greeting: 'Boarding pass and ID, please. Check-in closes an hour before departure.',
  },
  student: {
    label: 'Student',
    look: { outfit: 'student', skin: 0x6b4a2f, hair: 'afro', body: 'slim', extra: 'backpack' },
    greeting: 'We are on break. You want to see the classroom?',
  },
};

/**
 * The front door of a named building, so a priest stands outside the church
 * even after the street planner has slid the church to a free lot.
 */
function venueDoor(id, offset = 7) {
  const b = buildings.find((x) => x.id === id);
  if (!b) return null;
  return { x: b.position.x, z: b.position.z + b.size.d / 2 + offset };
}

/** Where NPCs live. `anchor` is a world position they patrol around. */
export const NPC_DEFS = [
  { id: 'npc-vendor', role: 'vendor', anchor: { x: 6, z: 12 }, radius: 5 },
  { id: 'npc-banker', role: 'banker', anchor: { x: 12, z: 20 }, radius: 3 },
  { id: 'npc-foreman', role: 'employer', anchor: { x: 30, z: -55 }, radius: 6 },
  { id: 'npc-officer', role: 'officer', anchor: { x: 0, z: -14 }, radius: 6 },
  { id: 'npc-nurse', role: 'nurse', anchor: { x: -10, z: 18 }, radius: 4 },
  { id: 'npc-mechanic', role: 'mechanic', anchor: { x: 24, z: 13 }, radius: 4 },
  { id: 'npc-resident-1', role: 'resident', anchor: { x: -30, z: 55 }, radius: 7 },
  { id: 'npc-resident-2', role: 'resident', anchor: { x: 35, z: 35 }, radius: 7 },
  { id: 'npc-trader', role: 'trader', anchor: { x: -60, z: 30 }, radius: 6 },
  { id: 'npc-resident-3', role: 'resident', anchor: { x: -40, z: -40 }, radius: 8 },
  // Round 7: every new venue has somebody in it to talk to. Anchors are read
  // from the building itself, so they follow it wherever the planner puts it.
  { id: 'npc-priest',  role: 'priest',  anchor: venueDoor('church', 6) || { x: 26, z: 44 }, radius: 4 },
  { id: 'npc-imam',    role: 'imam',    anchor: venueDoor('mosque', 5) || { x: -34, z: 34 }, radius: 3 },
  { id: 'npc-teacher', role: 'teacher', anchor: venueDoor('school', 6) || { x: -20, z: 57 }, radius: 4 },
  { id: 'npc-agent',   role: 'agent',   anchor: venueDoor('airport', 6) || { x: 44, z: -65 }, radius: 5 },
  { id: 'npc-chef',    role: 'chef',    anchor: venueDoor('restaurant', 4) || { x: -8, z: -8 }, radius: 3 },
  { id: 'npc-student', role: 'student', anchor: venueDoor('school', 3) || { x: -22, z: 54 }, radius: 3 },
];

function nameTag(text, colour = '#eaf6ff') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(6,10,16,0.72)';
  const w = Math.min(248, ctx.measureText(text).width + 26);
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 10, w, 44, 12);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillText(text, 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(2.0, 0.5, 1);
  sprite.position.y = 2.15;
  sprite.renderOrder = 10;
  return sprite;
}

export class NPCSystem {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {object} o.nav
   * @param {function} o.getPlayer - () => {x,z}
   * @param {object} o.actions - callbacks: openJobs, openShop, setNeed, navigateTo, startMission
   * @param {function} o.onToast
   * @param {object} [o.dialogueUI]
   */
  constructor({ scene, nav, getPlayer, actions, onToast, dialogueUI }) {
    this.scene = scene;
    this.nav = nav;
    this.getPlayer = getPlayer || (() => ({ x: 0, z: 0 }));
    this.actions = actions || {};
    this.onToast = onToast || (() => {});
    this.dialogue = dialogueUI;

    this.group = new THREE.Group();
    this.group.name = 'npcs';
    scene.add(this.group);

    this.npcs = [];
    this.nearby = null;
    this.memories = new Map();   // npcId -> Set of flags, survives the session

    this._spawnAll();
    this._buildPrompt();
  }

  // ── Spawning ──────────────────────────────────────────────

  _spawnAll() {
    for (const def of NPC_DEFS) {
      const role = ROLES[def.role];
      const spot = this.nav.nearestReachable(def.anchor.x, def.anchor.z, 12);
      if (!spot) continue;

      const avatar = new Avatar({
        skinColor: role.skin,
        outfitColor: role.outfit,
        hairStyle: role.hair,
        // Roles that name a full look get the real outfit: a nurse in scrubs,
        // a trader with a gele, a foreman in a hard hat and a hi-vis vest.
        look: role.look || null,
      });
      avatar.position.set(spot.x, 0, spot.z);
      avatar.rotation.y = Math.random() * Math.PI * 2;

      const tag = nameTag(role.label, '#9beeff');
      avatar.add(tag);

      this.group.add(avatar);

      const npc = {
        id: def.id,
        role: def.role,
        roleDef: role,
        avatar,
        tag,
        home: spot,
        radius: def.radius,
        // Patrol state
        target: null,
        waitTimer: 1 + Math.random() * 4,
        speed: 1.25 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        pose: ROLE_POSES[def.role] || 'stand',
        // How long they stand still doing their job before wandering again.
        workTimer: 3 + Math.random() * 6,
      };
      this._pickTarget(npc);
      this.npcs.push(npc);
    }
  }

  /**
   * Weather is an input to behaviour: when it pours, everyone without a roof
   * walks for the nearest doorway and the crowd thins out.
   * @param {{raining:boolean, intensity:number}} weather
   */
  setWeather(weather = {}) {
    this.raining = Boolean(weather.raining);
    this.rainIntensity = Number(weather.intensity) || 0;
  }

  _pickTarget(npc) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * npc.radius;
      const x = npc.home.x + Math.cos(a) * r;
      const z = npc.home.z + Math.sin(a) * r;
      if (this.nav.isReachable(x, z)) {
        npc.target = { x, z };
        return;
      }
    }
    npc.target = { ...npc.home };
  }

  // ── Prompt ────────────────────────────────────────────────

  _buildPrompt() {
    const el = document.createElement('div');
    el.className = 'npc-prompt hidden';
    el.innerHTML = '<span class="npc-key">E</span><span class="npc-text"></span>';
    document.body.appendChild(el);
    this.promptEl = el;
    this.promptText = el.querySelector('.npc-text');
    el.addEventListener('click', () => this.talkToNearby());
  }

  // ── Per-frame ─────────────────────────────────────────────

  /**
   * The street crowd only exists outside. Indoors the player still reports the
   * door's city position, so without this every NPC within four metres of the
   * door argues for a "Talk to…" prompt inside the building.
   * @param {boolean} on
   */
  setActive(on) {
    this.active = on !== false;
    for (const npc of this.npcs) npc.avatar.visible = this.active;
    if (!this.active) {
      this.nearby = null;
      this.promptEl?.classList.add('hidden');
    }
  }

  update(deltaTime) {
    const dt = Math.min(deltaTime, 0.05);
    if (this.active === false) return;
    const p = this.getPlayer();

    let closest = null;
    let closestDist = TALK_RADIUS * TALK_RADIUS;

    for (const npc of this.npcs) {
      this._updateNPC(npc, dt);

      const dx = npc.avatar.position.x - p.x;
      const dz = npc.avatar.position.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < closestDist) {
        closestDist = d2;
        closest = npc;
      }

      // Name tag stays readable but never blocks the camera
      npc.tag.material.opacity = d2 < 400 ? 1 : 0.35;
    }

    this.nearby = closest;

    if (closest && !this.dialogue?.isOpen) {
      this.promptEl.classList.remove('hidden');
      this.promptText.textContent = `Talk to ${closest.roleDef.label}`;
    } else {
      this.promptEl.classList.add('hidden');
    }
  }

  _updateNPC(npc, dt) {
    const a = npc.avatar;

    if (npc.waitTimer > 0) {
      npc.waitTimer -= dt;
      a.setMoving(false, 1);
      // Standing still is a job: the vendor serves, the banker types, the
      // priest prays. The pose is released the moment they walk again.
      if (npc.pose && npc.pose !== 'stand' && !a.isPosed) a.setPose(npc.pose, { blend: 0.35 });
      a.update(dt);
      return;
    }

    // On the move again: drop the working pose so the walk cycle is clean.
    if (a.isPosed) a.clearPose({ blend: 0.2 });

    if (!npc.target) {
      this._pickTarget(npc);
      npc.waitTimer = 1 + Math.random() * 3;
      return;
    }

    const dx = npc.target.x - a.position.x;
    const dz = npc.target.z - a.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.6) {
      // Reached the waypoint: idle for a beat, then choose another
      npc.target = null;
      npc.waitTimer = 2 + Math.random() * 5;
      a.setMoving(false, 1);
      a.update(dt);
      return;
    }

    const speed = npc.speed * (this.raining ? 1.55 : 1);
    const stepX = (dx / dist) * speed * dt;
    const stepZ = (dz / dist) * speed * dt;

    // Never walk into a blocked cell — if the next step is unwalkable, pick a
    // new target instead of grinding against a wall forever.
    const nextX = a.position.x + stepX;
    const nextZ = a.position.z + stepZ;
    if (!this.nav.isReachable(nextX, nextZ)) {
      npc.target = null;
      npc.waitTimer = 0.5 + Math.random();
      return;
    }

    a.position.x = nextX;
    a.position.z = nextZ;

    const wanted = Math.atan2(dx, dz);
    let diff = wanted - a.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    a.rotation.y += diff * (1 - Math.exp(-10 * dt));

    a.setMoving(true, 0.8);
    a.update(dt);
  }

  /** Dynamic obstacles for the player controller, so NPCs are solid. */
  getObstacles() {
    return this.npcs.map((n) => ({
      x: n.avatar.position.x,
      z: n.avatar.position.z,
      radius: 0.45,
    }));
  }

  // ── Dialogue ──────────────────────────────────────────────

  talkToNearby() {
    if (!this.nearby) return false;
    this.talkTo(this.nearby);
    return true;
  }

  talkTo(npc) {
    if (!this.dialogue) return;
    this.dialogue.open({
      title: npc.roleDef.label,
      subtitle: 'Lagos',
      greeting: npc.roleDef.greeting,
      options: this._optionsFor(npc),
      onClose: () => {},
    });
  }

  _remember(npc, flag) {
    if (!this.memories.has(npc.id)) this.memories.set(npc.id, new Set());
    this.memories.get(npc.id).add(flag);
  }

  _recalls(npc, flag) {
    return this.memories.get(npc.id)?.has(flag) || false;
  }

  /** The actual dialogue tree. Options do things, they do not pretend to. */
  _optionsFor(npc) {
    const opts = [];
    const role = npc.role;

    // Universal
    opts.push({
      label: 'Just saying hello',
      hint: '+ social',
      run: async () => {
        await this.actions.service?.('chat');
        this._remember(npc, 'greeted');
      },
    });

    if (role === 'vendor' || role === 'trader') {
      opts.push({
        label: 'Buy food (₦1,500)',
        hint: '+35 hunger, paid from cash',
        run: () => this._buyFood(npc),
      });
      opts.push({
        label: 'Ask about the market',
        run: () => {
          this.actions.navigateTo?.({ name: 'Mushin Market', x: -75, z: 66, kind: 'shop' });
        },
      });
    }

    if (role === 'employer') {
      opts.push({
        label: 'I need work',
        hint: 'opens the job board',
        run: () => {
          this.actions.openJobs?.();
          this._remember(npc, 'offered-work');
        },
      });
      opts.push({
        label: 'Where is the construction site?',
        run: () => this.actions.navigateTo?.({ name: 'Construction Site', x: 30, z: -55, kind: 'job' }),
      });
    }

    if (role === 'banker') {
      opts.push({
        label: 'Take me to the ATM',
        run: () => this.actions.navigateTo?.({ name: 'ATM', x: 12, z: 17.5, kind: 'bank' }),
      });
      opts.push({
        label: 'How do I grow my money?',
        run: () => this.onToast('Work a job, bank the cash, then buy property — rent pays itself.', 'info'),
      });
    }

    if (role === 'nurse') {
      opts.push({
        label: 'I feel worn out',
        hint: 'restores energy',
        run: async () => {
          const ok = await this.actions.service?.('clinic');
          if (ok !== false) this._remember(npc, 'treated');
        },
      });
      opts.push({
        label: 'Where is the hospital?',
        run: () => this.actions.navigateTo?.({ name: 'General Hospital', x: -78, z: 24, kind: 'hospital' }),
      });
    }

    if (role === 'officer') {
      opts.push({
        label: 'Any trouble around here?',
        run: () => this.onToast('Keep to the main roads at night and you will be fine.', 'info'),
      });
      opts.push({
        label: 'Where is the police station?',
        run: () => this.actions.navigateTo?.({ name: 'Police Station', x: -64, z: 26, kind: 'police' }),
      });
    }

    if (role === 'mechanic') {
      opts.push({
        label: 'Show me the dealership',
        run: () => this.actions.navigateTo?.({ name: 'Auto Dealership', x: -50, z: 26, kind: 'vehicle' }),
      });
      opts.push({
        label: 'Can I get a car here?',
        run: () => this.onToast('Dealership is across town. Come back when you have the naira.', 'info'),
      });
    }

    if (role === 'resident') {
      opts.push({
        label: 'What is there to do here?',
        run: () => this.onToast('Try the gym, the market, or just ride around. Lagos never sleeps.', 'info'),
      });
      if (!this._recalls(npc, 'greeted')) {
        opts.push({
          label: 'Ask for directions',
          run: () => this.actions.openMap?.(),
        });
      }
    }

    opts.push({ label: 'Goodbye', run: () => {} });
    return opts;
  }

  async _buyFood(npc) {
    const ok = await this.actions.service?.('street-food');
    if (ok) this._remember(npc, 'fed-me');
  }

  /** Where the NPCs are, for debugging and tests. */
  getPositions() {
    return this.npcs.map((n) => ({
      id: n.id,
      role: n.role,
      x: n.avatar.position.x,
      z: n.avatar.position.z,
    }));
  }
}
