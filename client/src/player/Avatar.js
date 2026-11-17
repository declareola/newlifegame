// client/src/player/Avatar.js
// The player character — a jointed humanoid built from Three.js primitives.
//
// Structure:
//   hips ─┬─ spine ─ chest ─┬─ neck ─ head (face, ears, hair)
//         │                 ├─ shoulder.L ─ upperArm ─ elbow ─ forearm ─ hand
//         │                 └─ shoulder.R ─ upperArm ─ elbow ─ forearm ─ hand
//         ├─ hip.L ─ thigh ─ knee ─ shin ─ ankle ─ shoe
//         └─ hip.R ─ thigh ─ knee ─ shin ─ ankle ─ shoe
//
// Every joint is a THREE.Group so the animation is real joint rotation rather
// than whole-limb swinging: elbows and knees bend, the shoulders counter-rotate
// against the hips, and the chest has a slight secondary bob.
//
// The public API is unchanged from Step 2 (constructor / updateColors /
// setMoving / update), so RemotePlayers and main.js keep working.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { normaliseLook, outfitById } from './outfits.js';

const DEFAULT_SKIN = 0xf1c27d;
const DEFAULT_OUTFIT = 0x2196f3;

// Proportion constants (metres). Total standing height ≈ 1.78 m.
const H = {
  ankleY: 0.09,
  kneeY: 0.46,
  hipY: 0.92,
  waistY: 1.03,
  chestY: 1.24,
  shoulderY: 1.47,
  neckY: 1.56,
  headY: 1.72,
};

const HAIR_STYLES = ['short', 'afro', 'braids', 'bald', 'fade'];

// How far the foot hangs below the ankle joint, so shoes sit on y = 0.
const FOOT_DROP = 0.066;

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── Poses ────────────────────────────────────────────────────
// Joint angles for the things characters actually *do*: sit on a pew, pray,
// type, serve food, take a phone call, dance at an owambe. Every character is
// still primitives on a joint hierarchy — this is a table of joint rotations
// blended over the walk/idle base, not a second animation system.
//
// A pose is merged over whatever the base did that frame, weighted by how far
// the blend has progressed, so entering and leaving a pose is smooth and the
// walk cycle keeps running underneath (a character can sit still and breathe).
//
// Angle signs: hips/knees/shoulders rotate about X; a negative shoulder value
// raises the arm forward, a positive knee value bends the shin back.

const mirror = (l) => ({
  L: { shoulder: l.shoulder, elbow: l.elbow },
  R: { shoulder: l.shoulder, elbow: l.elbow },
});

export const POSES = {
  stand: null,

  /** Sitting on a chair, pew or bench: hips drop, thighs forward, shins down. */
  sit: {
    hipDrop: 0.40,
    legs: { L: { hip: -1.45, knee: 1.32 }, R: { hip: -1.45, knee: 1.32 } },
    arms: { L: { shoulder: -0.22, elbow: -0.55 }, R: { shoulder: -0.22, elbow: -0.55 } },
    chestPitch: 0.03,
  },

  /** Sitting with hands on the thighs, alert — hospital waiting, police desk. */
  sitUpright: {
    hipDrop: 0.40,
    legs: { L: { hip: -1.42, knee: 1.30 }, R: { hip: -1.42, knee: 1.30 } },
    arms: { L: { shoulder: -0.05, elbow: -0.35 }, R: { shoulder: -0.05, elbow: -0.35 } },
    chestPitch: -0.02,
  },

  /** Standing at a desk or counter, leaning in, both hands forward. */
  work: {
    legs: { L: { hip: -0.06, knee: 0.08 }, R: { hip: 0.06, knee: 0.08 } },
    arms: { L: { shoulder: -0.95, elbow: -1.25 }, R: { shoulder: -0.90, elbow: -1.30 } },
    chestPitch: 0.16,
  },

  /** Typing: small alternating hand movement driven by the pose phase. */
  type: (phase) => ({
    legs: { L: { hip: -0.04, knee: 0.05 }, R: { hip: 0.04, knee: 0.05 } },
    arms: {
      L: { shoulder: -0.85, elbow: -1.15 + Math.sin(phase * 9) * 0.06 },
      R: { shoulder: -0.82, elbow: -1.10 + Math.sin(phase * 9 + 2.1) * 0.06 },
    },
    chestPitch: 0.12,
  }),

  /** Serving behind a counter — one arm out to hand something over. */
  serve: {
    arms: {
      L: { shoulder: -0.35, elbow: -0.75 },
      R: { shoulder: -1.05 + Math.sin(Date.now() / 900) * 0.04, elbow: -0.35 },
    },
    chestPitch: 0.05,
  },

  /** Eating: hand to mouth, elbow tucked. */
  eat: {
    arms: {
      L: { shoulder: -0.18, elbow: -0.60 },
      R: { shoulder: -1.20, elbow: -1.75 },
    },
    chestPitch: 0.06,
  },

  /** On the phone. */
  phone: {
    arms: {
      L: { shoulder: -0.10, elbow: -0.45 },
      R: { shoulder: -1.35, elbow: -1.95 },
    },
    headPitch: -0.10,
    headYaw: -0.12,
  },

  /** Praying: hands together in front of the chest. */
  pray: {
    arms: mirror({ shoulder: -0.75, elbow: -1.65 }),
    chestPitch: 0.10,
    headPitch: 0.12,
  },

  /** Kneeling for prayer — hips low, both knees folded. */
  kneel: {
    hipDrop: 0.52,
    legs: { L: { hip: -1.75, knee: 1.85 }, R: { hip: -1.75, knee: 1.85 } },
    arms: mirror({ shoulder: -0.55, elbow: -1.45 }),
    chestPitch: 0.20,
    headPitch: 0.18,
  },

  /** Raising a hand — greeting, hailing a bus, waving someone over. */
  wave: (phase) => ({
    arms: {
      L: { shoulder: -0.15, elbow: -0.5 },
      R: { shoulder: -2.35, elbow: -0.55 + Math.sin(phase * 7) * 0.25 },
    },
    headYaw: 0.06,
  }),

  /** Dancing: weight shift, arms up, hips and chest counter-rotating. */
  dance: (phase) => {
    const a = Math.sin(phase * 4.2);
    const b = Math.sin(phase * 4.2 + Math.PI);
    return {
      legs: { L: { hip: a * 0.32, knee: 0.20 + Math.max(0, -a) * 0.35 }, R: { hip: b * 0.32, knee: 0.20 + Math.max(0, -b) * 0.35 } },
      arms: {
        L: { shoulder: -2.1 + a * 0.35, elbow: -0.75 + a * 0.3 },
        R: { shoulder: -2.1 - a * 0.35, elbow: -0.75 - a * 0.3 },
      },
      chestYaw: a * 0.22,
      headYaw: -a * 0.12,
    };
  },

  /** Working under a car bonnet or over a machine: bent right over. */
  crouchWork: {
    hipDrop: 0.30,
    legs: { L: { hip: -0.85, knee: 1.15 }, R: { hip: -0.35, knee: 0.85 } },
    arms: { L: { shoulder: -1.15, elbow: -0.55 }, R: { shoulder: -1.10, elbow: -0.60 } },
    chestPitch: 0.45,
  },
};

export const POSE_NAMES = Object.keys(POSES);

/** Resolve a pose entry (which may be a function of phase) to numbers. */
export function resolvePose(name, phase = 0) {
  const entry = POSES[name] ?? null;
  if (!entry) return null;
  return (typeof entry === 'function' ? entry(phase) : entry) || null;
}

export class Avatar extends THREE.Group {
  /**
   * @param {object} opts
   * @param {number} opts.skinColor   - hex colour for skin
   * @param {number} opts.outfitColor - hex colour for the top/legs
   * @param {string} [opts.hairStyle] - 'short' | 'afro' | 'braids' | 'bald'
   * @param {number} [opts.hairColor]
   * @param {string} [opts.bodyType]  - 'slim' | 'average' | 'broad'
   */
  constructor({
    skinColor = DEFAULT_SKIN,
    outfitColor = DEFAULT_OUTFIT,
    hairStyle = 'short',
    hairColor = 0x231a14,
    bodyType = 'average',
    look = null,
  } = {}) {
    super();

    // Two ways in: a full look object (character creator, character panel) or
    // the original colour arguments (NPCs, remote players, tests). Both end up
    // as the same complete look, so a half-specified character still renders.
    this.look = normaliseLook(look || {
      skin: skinColor,
      hair: hairStyle,
      hairColour: hairColor,
      body: bodyType,
      top: outfitColor,
      bottom: new THREE.Color(outfitColor).multiplyScalar(0.62).getHex(),
    });

    this.skinColor = this.look.skin;
    this.outfitColor = this.look.top;
    this.hairStyle = HAIR_STYLES.includes(this.look.hair) ? this.look.hair : 'short';
    this.hairColor = this.look.hairColour;
    this.bodyType = this.look.body;
    this._wearGroups = [];

    // Animation state
    this.isMoving = false;
    this.walkSpeed = 1;   // 1 = walk, ~1.5 = run
    this.walkPhase = 0;
    this.idlePhase = Math.random() * Math.PI * 2;
    this.airborne = false;
    this.crouching = false;
    this._crouchBlend = 0;

    // Pose state: a named pose blended over the locomotion base.
    this.pose = 'stand';
    this.posePhase = 0;
    this._poseBlend = 0;       // 0 = base animation only, 1 = fully posed
    this._poseTarget = 0;

    this._buildMaterials();
    this._buildBody();
    this._buildHead();
    this._buildHair();
    this._buildArms();
    this._buildLegs();
    this._buildWear();
    this._applyBodyType();
    this._optimise();
  }

  /**
   * Collapse the static meshes that form each joint into one mesh per material.
   * The joints stay separate (they animate), but a hand is one draw call
   * instead of seven. Cuts an avatar from 56 meshes to about 24.
   */
  _optimise() {
    const joints = [
      this.hips, this.chest, this.head, this.hairGroup,
      this.arms.L.shoulder, this.arms.R.shoulder,
      this.arms.L.elbow, this.arms.R.elbow,
      this.arms.L.hand, this.arms.R.hand,
      this.legs.L.hip, this.legs.R.hip,
      this.legs.L.knee, this.legs.R.knee,
      this.legs.L.ankle, this.legs.R.ankle,
    ];

    for (const joint of joints) this._mergeGroup(joint);
    for (const g of this._wearGroups) this._mergeGroup(g);
  }

  /**
   * Merge a group's direct mesh children into one mesh per material.
   * Used for joints (which stay animatable) and for wear pieces (which do not
   * animate, so a head tie becomes one or two draw calls instead of nine).
   */
  _mergeGroup(joint) {
    {
      if (!joint) return;
      const direct = joint.children.filter((c) => c.isMesh && !c.isInstancedMesh);
      if (direct.length < 2) return;

      const buckets = new Map();
      for (const m of direct) {
        if (!buckets.has(m.material)) buckets.set(m.material, []);
        buckets.get(m.material).push(m);
      }

      for (const [material, list] of buckets) {
        if (list.length < 2) continue;
        const geos = [];
        for (const m of list) {
          const g = m.geometry.clone();
          m.updateMatrix();
          g.applyMatrix4(m.matrix);
          if (!g.index) {
            const n = g.attributes.position.count;
            const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
            for (let i = 0; i < n; i++) arr[i] = i;
            g.setIndex(new THREE.BufferAttribute(arr, 1));
          }
          for (const name of Object.keys(g.attributes)) {
            if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
          }
          geos.push(g);
        }

        let merged = null;
        try {
          merged = mergeGeometries(geos, false);
        } catch (err) {
          merged = null;
        }
        if (!merged) {
          for (const g of geos) g.dispose();
          continue;
        }

        for (const m of list) {
          joint.remove(m);
          m.geometry.dispose();
        }
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        joint.add(mesh);
      }
    }
  }

  // ── Materials ─────────────────────────────────────────────

  _buildMaterials() {
    this.skinMat = new THREE.MeshStandardMaterial({
      color: this.skinColor,
      roughness: 0.72,
      metalness: 0.0,
    });
    this.outfitMat = new THREE.MeshStandardMaterial({
      color: this.look.top,
      roughness: 0.85,
      metalness: 0.0,
    });
    // The bottom half is its own colour now — the creator picks it, and a dark
    // trouser under a light shirt is most of what makes an outfit read.
    this.trouserMat = new THREE.MeshStandardMaterial({
      color: this.look.bottom,
      roughness: 0.9,
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.look.top).offsetHSL(0, 0.05, -0.18),
      roughness: 0.8,
    });
    // Trim is an *accent*, not a contrast colour. It used to be the complement
    // of the outfit (+0.45 of a turn in hue, saturated), which turned a purple
    // owambe into a lime-green head tie — the first thing anyone saw in the
    // first screenshot of this game. A small hue shift with less saturation and
    // a little more lightness reads as matching fabric and dyed thread.
    this.trimMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.look.top).offsetHSL(0.035, -0.10, 0.13),
      roughness: 0.7,
    });
    this.shoeMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.55 });
    this.soleMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.8 });
    this.hairMat = new THREE.MeshStandardMaterial({ color: this.hairColor, roughness: 0.85 });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.25 });
    this.pupilMat = new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 0.2 });
    this.mouthMat = new THREE.MeshStandardMaterial({ color: 0x6d3b33, roughness: 0.7 });
    this.browMat = new THREE.MeshStandardMaterial({ color: 0x1b1310, roughness: 0.9 });
    this.beltMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.5, metalness: 0.2 });
    this.buckleMat = new THREE.MeshStandardMaterial({ color: 0xd8b64a, roughness: 0.35, metalness: 0.9 });
  }

  // ── Torso ─────────────────────────────────────────────────

  _buildBody() {
    // Hips
    this.hips = new THREE.Group();
    this.hips.position.y = H.hipY;
    this.add(this.hips);

    this.hips.add(mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), this.trouserMat, 0, -0.05, 0));

    // Waist + chest, slightly tapered so the silhouette is not a box
    this.chest = new THREE.Group();
    this.chest.position.y = 0.11; // relative to hips
    this.hips.add(this.chest);

    const waist = mesh(new THREE.CylinderGeometry(0.19, 0.185, 0.30, 12), this.outfitMat, 0, 0.13, 0);
    waist.scale.z = 0.72;
    this.chest.add(waist);

    const chestMesh = mesh(new THREE.CylinderGeometry(0.225, 0.195, 0.26, 12), this.outfitMat, 0, 0.38, 0);
    chestMesh.scale.z = 0.68;
    this.chest.add(chestMesh);

    // Shoulder caps
    for (const s of [-1, 1]) {
      const cap = mesh(new THREE.SphereGeometry(0.085, 10, 8), this.outfitMat, s * 0.2, 0.45, 0);
      cap.scale.set(1, 0.85, 0.9);
      this.chest.add(cap);
    }

    // Collar
    const collar = mesh(new THREE.CylinderGeometry(0.10, 0.115, 0.06, 12), this.outfitMat, 0, 0.52, 0);
    collar.scale.z = 0.8;
    this.chest.add(collar);

    // Shirt placket down the front
    this.chest.add(mesh(new THREE.BoxGeometry(0.03, 0.36, 0.01), this.beltMat, 0, 0.33, 0.148));

    // Belt + buckle
    this.hips.add(mesh(new THREE.BoxGeometry(0.36, 0.055, 0.235), this.beltMat, 0, 0.055, 0));
    this.hips.add(mesh(new THREE.BoxGeometry(0.07, 0.045, 0.02), this.buckleMat, 0, 0.055, 0.122));

    // Neck
    this.neck = mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 10), this.skinMat, 0, 0.56, 0);
    this.chest.add(this.neck);
  }

  // ── Head ──────────────────────────────────────────────────

  _buildHead() {
    this.head = new THREE.Group();
    // Head sits on top of the chest group so breathing and bob carry it along
    this.head.position.y = 0.66;
    this.chest.add(this.head);

    const skull = mesh(new THREE.SphereGeometry(0.115, 18, 16), this.skinMat, 0, 0, 0);
    skull.scale.set(1, 1.12, 0.95);
    this.head.add(skull);

    // Jaw / chin
    const jaw = mesh(new THREE.SphereGeometry(0.088, 14, 12), this.skinMat, 0, -0.055, 0.018);
    jaw.scale.set(1, 0.8, 0.92);
    this.head.add(jaw);

    // Ears
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.028, 8, 8), this.skinMat, s * 0.112, -0.005, 0);
      ear.scale.set(0.5, 1, 0.8);
      this.head.add(ear);
    }

    // Eyes: white + pupil
    for (const s of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.021, 10, 10), this.eyeMat, s * 0.043, 0.012, 0.096);
      eye.scale.set(1, 1, 0.6);
      this.head.add(eye);
      this.head.add(mesh(new THREE.SphereGeometry(0.0125, 8, 8), this.pupilMat, s * 0.043, 0.012, 0.109));
      // Brow
      const brow = mesh(new THREE.BoxGeometry(0.045, 0.009, 0.012), this.browMat, s * 0.045, 0.048, 0.099);
      brow.rotation.z = s * 0.12;
      this.head.add(brow);
    }

    // Nose
    const nose = mesh(new THREE.ConeGeometry(0.021, 0.045, 8), this.skinMat, 0, -0.012, 0.107);
    nose.rotation.x = Math.PI * 0.52;
    this.head.add(nose);

    // Mouth: two short bars with a slight lift at the corners, which reads as a
    // mouth rather than a strip of tape.
    const mouth = new THREE.Group();
    for (const [sx, w, ry] of [[-1, 0.026, 0.10], [1, 0.026, -0.10]]) {
      const half = mesh(new THREE.BoxGeometry(w, 0.011, 0.011), this.mouthMat, sx * 0.0135, -0.056, 0.099);
      half.rotation.z = ry * sx;
      mouth.add(half);
    }
    this.head.add(mouth);
  }

  // ── Hair variants ─────────────────────────────────────────

  _buildHair() {
    const g = new THREE.Group();
    this.head.add(g);
    this.hairGroup = g;

    if (this.hairStyle === 'bald') {
      // A hint of hairline only
      const rim = mesh(new THREE.SphereGeometry(0.118, 16, 10), this.hairMat, 0, -0.01, -0.005);
      rim.scale.set(1.0, 0.72, 0.98);
      rim.position.z = -0.06;
      g.add(rim);
      return;
    }

    if (this.hairStyle === 'afro') {
      const puff = mesh(new THREE.SphereGeometry(0.155, 16, 14), this.hairMat, 0, 0.045, -0.012);
      puff.scale.set(1.05, 1.0, 1.02);
      g.add(puff);
      return;
    }

    if (this.hairStyle === 'braids') {
      // Cap + hanging braids down the back
      const cap = mesh(new THREE.SphereGeometry(0.121, 16, 12), this.hairMat, 0, 0.012, -0.006);
      cap.scale.set(1, 0.92, 1);
      g.add(cap);
      for (let i = 0; i < 6; i++) {
        const t = (i / 5 - 0.5) * 0.17;
        const braid = mesh(new THREE.CylinderGeometry(0.014, 0.010, 0.26, 6), this.hairMat, t, -0.10, -0.10);
        braid.rotation.x = 0.16;
        g.add(braid);
      }
      return;
    }

    if (this.hairStyle === 'fade') {
      // Tight on the sides, a little height on top, and a hard hairline.
      const top = mesh(new THREE.SphereGeometry(0.118, 16, 12), this.hairMat, 0, 0.028, -0.004);
      top.scale.set(0.98, 0.78, 0.98);
      g.add(top);
      for (const s of [-1, 1]) {
        const side = mesh(new THREE.BoxGeometry(0.016, 0.07, 0.11), this.hairMat, s * 0.108, -0.006, -0.02);
        side.rotation.z = s * 0.12;
        g.add(side);
      }
      const line = mesh(new THREE.BoxGeometry(0.15, 0.012, 0.02), this.hairMat, 0, 0.062, 0.098);
      g.add(line);
      return;
    }

    // 'short' — a close cap with a slight fringe
    const cap = mesh(new THREE.SphereGeometry(0.122, 16, 12), this.hairMat, 0, 0.014, -0.004);
    cap.scale.set(1.0, 0.88, 1.0);
    g.add(cap);
    // The fringe sits *above* the brow line. At y = 0.055 it covered the eyes,
    // which is why every default character looked like they were wearing a
    // blindfold in the first screenshot ever taken of this game.
    const fringe = mesh(new THREE.BoxGeometry(0.165, 0.03, 0.045), this.hairMat, 0, 0.082, 0.072);
    fringe.rotation.x = -0.34;
    g.add(fringe);
  }

  // ── Arms ──────────────────────────────────────────────────

  _buildArms() {
    this.arms = {};

    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;

      // Shoulder joint
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.235, 0.45, 0); // relative to chest
      this.chest.add(shoulder);

      // Upper arm
      const upperLen = 0.27;
      const upper = mesh(new THREE.CylinderGeometry(0.055, 0.048, upperLen, 10), this.outfitMat, 0, -upperLen / 2, 0);
      shoulder.add(upper);
      // Sleeve cuff
      shoulder.add(mesh(new THREE.CylinderGeometry(0.058, 0.056, 0.03, 10), this.outfitMat, 0, -upperLen + 0.02, 0));

      // Elbow joint
      const elbow = new THREE.Group();
      elbow.position.y = -upperLen;
      shoulder.add(elbow);

      const foreLen = 0.25;
      const fore = mesh(new THREE.CylinderGeometry(0.045, 0.038, foreLen, 10), this.skinMat, 0, -foreLen / 2, 0);
      elbow.add(fore);
      // Elbow cap
      elbow.add(mesh(new THREE.SphereGeometry(0.047, 10, 8), this.skinMat, 0, 0, 0));
      // Sleeve state: a long sleeve covers the forearm in cloth with a cuff, a
      // short sleeve leaves it bare. Kept as a reference so setLook can switch
      // it without rebuilding the character.
      this._forearms = this._forearms || [];
      this._forearms.push({ side, fore, foreLen, elbow });

      // Hand: palm + four fingers + thumb
      const hand = new THREE.Group();
      hand.position.y = -foreLen;
      elbow.add(hand);
      const palm = mesh(new THREE.BoxGeometry(0.058, 0.075, 0.032), this.skinMat, 0, -0.037, 0);
      hand.add(palm);
      for (let f = 0; f < 4; f++) {
        const fx = (f / 3 - 0.5) * 0.042;
        hand.add(mesh(new THREE.BoxGeometry(0.011, 0.045, 0.026), this.skinMat, fx, -0.094, 0.001));
      }
      const thumb = mesh(new THREE.BoxGeometry(0.014, 0.035, 0.024), this.skinMat, s * 0.032, -0.055, 0.006);
      thumb.rotation.z = s * 0.5;
      hand.add(thumb);

      this.arms[side] = { shoulder, elbow, hand };
      if (side === 'L') {
        this.leftArm = shoulder;
        this.leftElbow = elbow;
      } else {
        this.rightArm = shoulder;
        this.rightElbow = elbow;
      }
    }
  }

  // ── Legs ──────────────────────────────────────────────────

  _buildLegs() {
    this.legs = {};

    for (const side of ['L', 'R']) {
      const s = side === 'L' ? 1 : -1;

      const hip = new THREE.Group();
      hip.position.set(s * 0.095, -0.13, 0); // relative to hips group
      this.hips.add(hip);

      const thighLen = 0.34;
      const thigh = mesh(new THREE.CylinderGeometry(0.072, 0.062, thighLen, 10), this.trouserMat, 0, -thighLen / 2, 0);
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.y = -thighLen;
      hip.add(knee);
      knee.add(mesh(new THREE.SphereGeometry(0.062, 10, 8), this.trouserMat, 0, 0, 0));

      const shinLen = 0.35;
      const shin = mesh(new THREE.CylinderGeometry(0.058, 0.045, shinLen, 10), this.trouserMat, 0, -shinLen / 2, 0);
      knee.add(shin);

      // Ankle + shoe. The foot is dropped so the sole meets the ground: the
      // character used to be modelled hovering about 6 cm above it, which is
      // very visible when you stand still next to an NPC.
      const ankle = new THREE.Group();
      ankle.position.y = -(shinLen + FOOT_DROP);
      knee.add(ankle);

      const shoe = mesh(new THREE.BoxGeometry(0.088, 0.062, 0.19), this.shoeMat, 0, 0.012, 0.032);
      ankle.add(shoe);
      ankle.add(mesh(new THREE.BoxGeometry(0.094, 0.022, 0.20), this.soleMat, 0, -0.024, 0.032));
      // Toe cap
      const toe = mesh(new THREE.SphereGeometry(0.045, 10, 8), this.shoeMat, 0, 0.010, 0.118);
      toe.scale.set(0.95, 0.7, 0.8);
      ankle.add(toe);

      this.legs[side] = { hip, knee, ankle };
      if (side === 'L') {
        this.leftLeg = hip;
        this.leftKnee = knee;
      } else {
        this.rightLeg = hip;
        this.rightKnee = knee;
      }
    }
  }


  // ── What the character is wearing ─────────────────────────

  /** Remove and rebuild every piece of wear (garment, head, extra, shoes). */
  _buildWear() {
    for (const g of this._wearGroups) {
      if (g.parent) g.parent.remove(g);
      g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this._wearGroups = [];

    this._applySleeves();
    this._buildShoes();
    this._buildGarment();
    this._buildHeadwear();
    this._buildExtra();

    // Wear never animates per-piece, so bake each piece down to one mesh per
    // material: a gele goes from nine draw calls to three.
    for (const g of this._wearGroups) this._mergeGroup(g);
  }

  _addWear(group, parent) {
    parent.add(group);
    this._wearGroups.push(group);
    return group;
  }

  /** Long sleeves cover the forearm in cloth; short sleeves leave skin. */
  _applySleeves() {
    const long = this.look.sleeve === 'long';
    for (const f of this._forearms || []) {
      f.fore.material = long ? this.outfitMat : this.skinMat;
      if (long) {
        // Cuff at the wrist, in the trim colour, so the sleeve ends on purpose.
        const cuff = mesh(new THREE.CylinderGeometry(0.046, 0.042, 0.03, 10), this.trimMat, 0, -f.foreLen + 0.012, 0);
        cuff.name = 'sleeve-cuff';
        f.elbow.add(cuff);
        this._wearGroups.push(cuff);
      }
    }
  }

  /** Footwear: chunky sneakers, flat loafers, or strappy sandals. */
  _buildShoes() {
    const style = this.look.shoes || 'sneakers';
    const upper = style === 'sandals' ? 0x5a3d2b : style === 'loafers' ? 0x2a2018 : 0x24262b;
    this.shoeMat.color.setHex(upper);
    this.soleMat.color.setHex(style === 'loafers' ? 0xe8e6e0 : style === 'sandals' ? 0x7a5c3e : 0xf0efe9);

    for (const side of ['L', 'R']) {
      const ankle = this.legs[side].ankle;
      const g = new THREE.Group();
      if (style === 'sandals') {
        g.add(mesh(new THREE.BoxGeometry(0.09, 0.022, 0.20), this.soleMat, 0, -0.02, 0.03));
        for (let i = 0; i < 3; i++) {
          g.add(mesh(new THREE.BoxGeometry(0.092, 0.02, 0.022), this.shoeMat, 0, 0.005, -0.03 + i * 0.055));
        }
      } else if (style === 'loafers') {
        g.add(mesh(new THREE.BoxGeometry(0.088, 0.05, 0.185), this.shoeMat, 0, 0.012, 0.03));
        g.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.05), this.trimMat, 0, 0.04, 0.02));
      }
      if (g.children.length) this._addWear(g, ankle);
    }
  }

  /**
   * Garments that change the silhouette:
   *   dashiki  — a long patterned tunic that covers the belt and hips
   *   kaba     — a flared skirt from the waist with a matching trim
   *   waistcoat— a sleeveless panel with buttons
   *   blazer   — an open jacket with lapels and a pocket
   */
  _buildGarment() {
    const kind = this.look.garment || 'none';
    if (kind === 'none') return;

    const g = new THREE.Group();

    if (kind === 'dashiki') {
      const tunic = mesh(new THREE.CylinderGeometry(0.235, 0.27, 0.52, 14), this.outfitMat, 0, 0.16, 0);
      tunic.scale.z = 0.74;
      g.add(tunic);
      // Neck trim and hem trim, in the accent colour
      g.add(mesh(new THREE.TorusGeometry(0.115, 0.014, 6, 16), this.trimMat, 0, 0.44, 0)).rotation.x = Math.PI / 2;
      const hem = mesh(new THREE.CylinderGeometry(0.272, 0.272, 0.035, 14), this.trimMat, 0, -0.09, 0);
      hem.scale.z = 0.74;
      g.add(hem);
      // Chest embroidery: two short rows of stitching
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.02, 0.18, 0.01), this.trimMat, s * 0.07, 0.3, 0.155));
      }
      this._addWear(g, this.chest);
    } else if (kind === 'kaba') {
      // Flared skirt from waist to below the knee
      const skirt = mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.62, 16, 1, true), this.outfitMat, 0, -0.18, 0);
      skirt.scale.z = 0.86;
      g.add(skirt);
      const band = mesh(new THREE.CylinderGeometry(0.362, 0.362, 0.05, 16, 1, true), this.trimMat, 0, -0.49, 0);
      band.scale.z = 0.86;
      g.add(band);
      // Fitted bodice over the chest
      const bodice = mesh(new THREE.CylinderGeometry(0.215, 0.235, 0.3, 14), this.outfitMat, 0, 0.34, 0);
      bodice.scale.z = 0.7;
      g.add(bodice);
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), this.trimMat, 0, 0.43, 0.16));
      this._addWear(g, this.hips);
    } else if (kind === 'waistcoat') {
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.11, 0.34, 0.06), this.accentMat, s * 0.1, 0.3, 0.115));
      }
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.3, 0.03), this.accentMat, 0, 0.3, -0.13));
      for (let i = 0; i < 3; i++) {
        g.add(mesh(new THREE.SphereGeometry(0.011, 6, 6), this.buckleMat, 0, 0.2 + i * 0.09, 0.155));
      }
      this._addWear(g, this.chest);
    } else if (kind === 'blazer') {
      for (const s of [-1, 1]) {
        // Front panel
        g.add(mesh(new THREE.BoxGeometry(0.1, 0.44, 0.05), this.outfitMat, s * 0.11, 0.28, 0.1));
        // Lapel
        const lapel = mesh(new THREE.BoxGeometry(0.055, 0.16, 0.02), this.accentMat, s * 0.075, 0.4, 0.13);
        lapel.rotation.z = s * 0.3;
        g.add(lapel);
        // Shoulder pad
        g.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), this.outfitMat, s * 0.2, 0.46, 0));
      }
      g.add(mesh(new THREE.BoxGeometry(0.24, 0.42, 0.04), this.outfitMat, 0, 0.28, -0.13));
      g.add(mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), this.buckleMat, 0.05, 0.16, 0.12));  // pocket square
      this._addWear(g, this.chest);
    }
  }

  /** Headwear: cap, gele (head tie), kufi, hijab. */
  _buildHeadwear() {
    const kind = this.look.head || 'none';
    if (kind === 'none') return;

    const g = new THREE.Group();

    if (kind === 'cap') {
      const crown = mesh(new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), this.accentMat, 0, 0.03, -0.005);
      g.add(crown);
      const brim = mesh(new THREE.BoxGeometry(0.2, 0.018, 0.1), this.accentMat, 0, 0.035, 0.115);
      brim.rotation.x = -0.12;
      g.add(brim);
      g.add(mesh(new THREE.SphereGeometry(0.014, 6, 6), this.trimMat, 0, 0.15, 0));
    } else if (kind === 'kufi') {
      const cap = mesh(new THREE.CylinderGeometry(0.108, 0.118, 0.075, 14), this.trimMat, 0, 0.085, -0.004);
      g.add(cap);
      g.add(mesh(new THREE.TorusGeometry(0.11, 0.008, 6, 14), this.trimMat, 0, 0.05, 0)).rotation.x = Math.PI / 2;
    } else if (kind === 'gele') {
      // A wrapped head tie: three stacked bands, widest at the top.
      const bands = [
        { r: 0.135, h: 0.05, y: 0.075, z: -0.01 },
        { r: 0.145, h: 0.055, y: 0.115, z: -0.015 },
        { r: 0.128, h: 0.045, y: 0.155, z: -0.02 },
      ];
      for (const b of bands) {
        const band = mesh(new THREE.CylinderGeometry(b.r, b.r, b.h, 16), this.trimMat, 0, b.y, b.z);
        band.scale.z = 0.92;
        g.add(band);
      }
      const knot = mesh(new THREE.SphereGeometry(0.05, 10, 8), this.trimMat, 0.1, 0.14, -0.06);
      g.add(knot);
      const tail = mesh(new THREE.BoxGeometry(0.05, 0.16, 0.03), this.trimMat, 0.14, 0.05, -0.09);
      tail.rotation.z = 0.4;
      g.add(tail);
    } else if (kind === 'hijab') {
      // Covers the hair, frames the face and falls over the shoulders.
      const hood = mesh(new THREE.SphereGeometry(0.145, 16, 12), this.accentMat, 0, 0.02, -0.02);
      hood.scale.set(1.02, 1.05, 1.04);
      g.add(hood);
      const drape = mesh(new THREE.CylinderGeometry(0.15, 0.19, 0.3, 14, 1, true), this.accentMat, 0, -0.17, -0.01);
      g.add(drape);
      // Face opening: a lighter band so it does not read as a solid ball
      const frame = mesh(new THREE.TorusGeometry(0.108, 0.014, 6, 16), this.trimMat, 0, 0.0, 0.05);
      g.add(frame);
    }

    this._addWear(g, this.head);
  }

  /** Small accessories: watch, glasses, backpack, satchel. */
  _buildExtra() {
    const kind = this.look.extra || 'none';
    if (kind === 'none') return;

    if (kind === 'watch' && this._forearms) {
      for (const f of this._forearms) {
        if (f.side !== 'L') continue;
        const g = new THREE.Group();
        g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.016, 12), this.buckleMat, 0, -f.foreLen + 0.05, 0));
        g.add(mesh(new THREE.BoxGeometry(0.03, 0.022, 0.008), this.metalFaceMat(), 0, -f.foreLen + 0.05, 0.045));
        this._addWear(g, f.elbow);
      }
      return;
    }

    if (kind === 'glasses') {
      const g = new THREE.Group();
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.TorusGeometry(0.032, 0.005, 6, 14), this.metalFaceMat(), s * 0.042, 0.0, 0.108)).rotation.y = 0;
        g.add(mesh(new THREE.BoxGeometry(0.026, 0.004, 0.004), this.metalFaceMat(), s * 0.07, 0.005, 0.09));
      }
      g.add(mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), this.metalFaceMat(), 0, 0.005, 0.112));
      this._addWear(g, this.head);
      return;
    }

    if (kind === 'backpack') {
      const g = new THREE.Group();
      const body = mesh(new THREE.BoxGeometry(0.26, 0.34, 0.15), this.accentMat, 0, 0.28, -0.19);
      body.rotation.x = 0.06;
      g.add(body);
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), this.trimMat, 0, 0.22, -0.28));
      for (const s of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(0.03, 0.3, 0.02), this.trimMat, s * 0.1, 0.36, 0.075));
      }
      this._addWear(g, this.chest);
      return;
    }

    if (kind === 'satchel') {
      const g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(0.22, 0.18, 0.09), this.trouserMat, 0.16, -0.02, 0.06));
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.075, 0.02), this.accentMat, 0.16, 0.02, 0.11));
      const strap = mesh(new THREE.BoxGeometry(0.025, 0.5, 0.02), this.trouserMat, 0.0, 0.34, 0.09);
      strap.rotation.z = -0.34;
      g.add(strap);
      this._addWear(g, this.hips);
    }
  }

  /** A tiny chrome-ish material for glasses and watch faces. */
  metalFaceMat() {
    if (!this._metalFace) {
      this._metalFace = new THREE.MeshStandardMaterial({ color: 0xb9c6cf, roughness: 0.3, metalness: 0.85 });
    }
    return this._metalFace;
  }

  /**
   * Change appearance at runtime (character panel, or the creator previewing a
   * choice). Rebuilds the pieces that changed and refreshes the colours.
   */
  setLook(look) {
    const before = this.look;

    // Changing outfit swaps the whole outfit: garment, headwear, sleeves and
    // accessories come from the new one unless the caller names them. Without
    // this, putting the kaftan on kept the old cap.
    const input = { ...before, ...look };
    if (look.outfit && look.outfit !== before.outfit) {
      for (const key of ['garment', 'head', 'extra', 'sleeve', 'shoes', 'top', 'bottom']) {
        if (look[key] === undefined) delete input[key];
      }
    }
    this.look = normaliseLook(input);

    this.skinColor = this.look.skin;
    this.outfitColor = this.look.top;
    this.hairColor = this.look.hairColour;
    this.skinMat.color.setHex(this.look.skin);
    this.outfitMat.color.setHex(this.look.top);
    this.trouserMat.color.setHex(this.look.bottom);
    this.hairMat.color.setHex(this.look.hairColour);
    this.accentMat.color.set(new THREE.Color(this.look.top).offsetHSL(0, 0.05, -0.18));
    this.trimMat.color.set(new THREE.Color(this.look.top).offsetHSL(0.45, 0.25, 0.06));

    if (this.look.hair !== before.hair) {
      this.hairStyle = this.look.hair;
      if (this.hairGroup) {
        this.head.remove(this.hairGroup);
        this.hairGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      }
      this._buildHair();
    }

    if (this.look.body !== before.body) {
      this.bodyType = this.look.body;
      this._applyBodyType();
    }

    this._buildWear();
    // Re-merge: the freshly built hair and wear groups are unmerged meshes.
    this._optimise();
  }

  // ── Body shape ────────────────────────────────────────────

  _applyBodyType() {
    const widthScale = this.bodyType === 'slim' ? 0.88 : this.bodyType === 'broad' ? 1.14 : 1;
    this.chest.scale.x = widthScale;
    this.hips.scale.x = (widthScale + 1) / 2;
    for (const side of ['L', 'R']) {
      // Widen the stance a little for broader builds
      const s = side === 'L' ? 1 : -1;
      this.arms[side].shoulder.position.x = s * 0.235 * widthScale;
    }
  }

  // ── Public API ────────────────────────────────────────────

  /**
   * Update skin and outfit colours at runtime.
   * Trousers are derived from the outfit colour, matching the initial build.
   */
  updateColors(skinColor, outfitColor) {
    if (skinColor !== undefined) {
      this.skinMat.color.setHex(skinColor);
      this.look.skin = skinColor;
    }
    if (outfitColor !== undefined) {
      this.outfitMat.color.setHex(outfitColor);
      this.trouserMat.color.set(new THREE.Color(outfitColor).multiplyScalar(0.62));
      this.look.top = outfitColor;
      this.look.bottom = new THREE.Color(outfitColor).multiplyScalar(0.62).getHex();
    }
  }

  /** Rebuild the hair with a different style. */
  setHairStyle(style) {
    if (!HAIR_STYLES.includes(style) || style === this.hairStyle) return;
    this.hairStyle = style;
    this.look.hair = style;
    if (this.hairGroup) {
      this.head.remove(this.hairGroup);
      this.hairGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this._buildHair();
  }

  /** Recolour the hair. */
  setHairColor(hex) {
    this.hairColor = hex;
    this.hairMat.color.setHex(hex);
  }

  setMoving(moving, speed = 1) {
    this.isMoving = moving;
    this.walkSpeed = speed;
  }

  /** Jump / fall pose. */
  setAirborne(v) {
    this.airborne = !!v;
  }

  /** Crouched stance. */
  setCrouch(v) {
    this.crouching = !!v;
  }

  /**
   * Hold a named pose. Blends over `blend` seconds; `null`/`stand` releases it.
   * @param {string} name - a key of POSES
   * @param {object} [opts] - { blend: seconds, weight: 0..1 }
   */
  setPose(name, { blend = 0.25, weight = 1 } = {}) {
    const next = POSES[name] ? name : 'stand';
    if (next === this.pose) {
      this._poseTarget = next === 'stand' ? 0 : weight;
      return this.pose;
    }
    this.pose = next;
    this._poseTarget = next === 'stand' ? 0 : weight;
    // Rate so the blend takes `blend` seconds, whatever the frame rate.
    this._poseRate = blend > 0 ? 3 / blend : 40;
    return this.pose;
  }

  /** Drop any pose and return to the walk/idle animation. */
  clearPose(opts) { return this.setPose('stand', opts); }

  get isPosed() { return this.pose !== 'stand' && this._poseBlend > 0.02; }

  update(deltaTime) {
    this._updateBase(deltaTime);
    this._applyPose(deltaTime);
  }

  _updateBase(deltaTime) {
    // Guard against tab-switch spikes so limbs never teleport
    const dt = Math.min(deltaTime, 0.05);

    // Blended crouch offset — never snaps
    const wantCrouch = this.crouching ? 1 : 0;
    this._crouchBlend += (wantCrouch - this._crouchBlend) * (1 - Math.exp(-14 * dt));
    const crouchDrop = this._crouchBlend * 0.30;

    if (this.airborne) {
      // ── Airborne: tuck the legs, raise the arms, no walk cycle ──
      this.walkPhase += dt * 2;
      const rise = this.verticalVelocity > 0;

      this.legs.L.hip.rotation.x += ((rise ? -0.55 : -0.25) - this.legs.L.hip.rotation.x) * (1 - Math.exp(-12 * dt));
      this.legs.R.hip.rotation.x += ((rise ? -0.30 : -0.55) - this.legs.R.hip.rotation.x) * (1 - Math.exp(-12 * dt));
      this.legs.L.knee.rotation.x += (-(rise ? 0.9 : 0.5) - this.legs.L.knee.rotation.x) * (1 - Math.exp(-12 * dt));
      this.legs.R.knee.rotation.x += (-(rise ? 0.5 : 0.3) - this.legs.R.knee.rotation.x) * (1 - Math.exp(-12 * dt));

      this.arms.L.shoulder.rotation.x += (-0.9 - this.arms.L.shoulder.rotation.x) * (1 - Math.exp(-10 * dt));
      this.arms.R.shoulder.rotation.x += (-0.9 - this.arms.R.shoulder.rotation.x) * (1 - Math.exp(-10 * dt));
      this.arms.L.elbow.rotation.x += (-0.7 - this.arms.L.elbow.rotation.x) * (1 - Math.exp(-10 * dt));
      this.arms.R.elbow.rotation.x += (-0.7 - this.arms.R.elbow.rotation.x) * (1 - Math.exp(-10 * dt));

      this.hips.position.y = H.hipY;
      this.chest.rotation.y *= 0.9;
      this.chest.rotation.z *= 0.9;
      this.head.rotation.y *= 0.9;
      return;
    }

    this.hips.position.y = H.hipY - crouchDrop;

    if (this.isMoving) {
      const amplitude = (0.42 + this.walkSpeed * 0.16) * (1 - this._crouchBlend * 0.45);
      const phaseSpeed = 5.5 + this.walkSpeed * 3.5;
      this.walkPhase += dt * phaseSpeed;

      const swing = Math.sin(this.walkPhase) * amplitude;
      const swing2 = Math.sin(this.walkPhase + Math.PI) * amplitude;

      // Hips hold the legs; shoulders counter-rotate against them
      this.legs.L.hip.rotation.x = swing;
      this.legs.R.hip.rotation.x = swing2;
      this.arms.L.shoulder.rotation.x = swing2 * 0.85;
      this.arms.R.shoulder.rotation.x = swing * 0.85;

      // Knees bend on the back half of each stride, never hyperextend
      this.legs.L.knee.rotation.x = -Math.max(0, Math.sin(this.walkPhase - 0.9)) * (0.5 + this.walkSpeed * 0.22);
      this.legs.R.knee.rotation.x = -Math.max(0, Math.sin(this.walkPhase + Math.PI - 0.9)) * (0.5 + this.walkSpeed * 0.22);

      // Elbows stay slightly bent and add a little follow-through
      this.arms.L.elbow.rotation.x = -0.22 - Math.max(0, -swing) * 0.5;
      this.arms.R.elbow.rotation.x = -0.22 - Math.max(0, -swing2) * 0.5;

      // Arms swing slightly outward so they clear the body
      this.arms.L.shoulder.rotation.z = 0.06;
      this.arms.R.shoulder.rotation.z = -0.06;

      // Vertical bob + a touch of roll through the torso
      const bob = Math.abs(Math.sin(this.walkPhase)) * 0.028 * (1 - this._crouchBlend);
      this.hips.position.y = H.hipY - crouchDrop + bob;
      // Knees stay bent while crouched, even mid-stride
      if (this._crouchBlend > 0.02) {
        this.legs.L.knee.rotation.x -= 0.55 * this._crouchBlend;
        this.legs.R.knee.rotation.x -= 0.55 * this._crouchBlend;
        this.arms.L.shoulder.rotation.x *= 0.55;
        this.arms.R.shoulder.rotation.x *= 0.55;
      }
      this.chest.rotation.y = Math.sin(this.walkPhase) * 0.07;
      this.chest.rotation.z = Math.sin(this.walkPhase) * 0.018;
      this.chest.position.y = 0.11;
      // Head stabilises against the torso roll
      this.head.rotation.y = -Math.sin(this.walkPhase) * 0.05;
    } else {
      // Idle: breathing, a slow weight shift and a settled stance
      this.idlePhase += dt * 1.6;
      const breath = Math.sin(this.idlePhase) * 0.02;

      this.chest.scale.y = 1 + breath;
      this.chest.position.y = 0.11 + breath * 0.05;
      this.hips.position.y = H.hipY - crouchDrop + Math.sin(this.idlePhase * 0.5) * 0.006;
      if (this._crouchBlend > 0.02) {
        this.legs.L.knee.rotation.x = -0.75 * this._crouchBlend;
        this.legs.R.knee.rotation.x = -0.75 * this._crouchBlend;
      }

      // Head turns a little as if looking around
      this.head.rotation.y = Math.sin(this.idlePhase * 0.37) * 0.12;
      this.head.rotation.x = Math.sin(this.idlePhase * 0.29) * 0.03;

      const damp = Math.exp(-9 * dt);
      for (const side of ['L', 'R']) {
        this.arms[side].shoulder.rotation.x *= damp;
        this.arms[side].elbow.rotation.x += (-0.16 - this.arms[side].elbow.rotation.x) * (1 - damp);
        this.arms[side].shoulder.rotation.z += ((side === 'L' ? 0.07 : -0.07) - this.arms[side].shoulder.rotation.z) * (1 - damp);
        this.legs[side].hip.rotation.x *= damp;
        this.legs[side].knee.rotation.x *= damp;
      }
      this.chest.rotation.y *= damp;
      this.chest.rotation.z *= damp;
    }
  }
  /**
   * Blend the current pose over the base animation.
   *
   * The base pass has already written every joint for this frame; this pass
   * reads those values, mixes toward the pose by `_poseBlend`, and writes them
   * back. That is what makes entering a pose smooth *and* lets the idle
   * breathing and walk cycle keep running underneath.
   */
  _applyPose(deltaTime) {
    const dt = Math.min(deltaTime, 0.05);
    this.posePhase += dt;

    const rate = this._poseRate || 8;
    this._poseBlend += (this._poseTarget - this._poseBlend) * (1 - Math.exp(-rate * dt));
    if (this._poseBlend < 0.002) this._poseBlend = 0;

    if (this._poseBlend <= 0 || !this.legs || !this.arms) return;

    const pose = resolvePose(this.pose, this.posePhase);
    if (!pose) return;

    const t = this._poseBlend;
    const mix = (current, target) => current + (target - current) * t;
    const joint = (obj, key, value) => {
      if (!obj || value === undefined) return;
      obj.rotation[key] = mix(obj.rotation[key], value);
    };

    // Torso and legs
    for (const side of ['L', 'R']) {
      const leg = pose.legs?.[side];
      if (leg) {
        joint(this.legs[side].hip, 'x', leg.hip);
        joint(this.legs[side].knee, 'x', leg.knee);
      }
      const arm = pose.arms?.[side];
      if (arm) {
        joint(this.arms[side].shoulder, 'x', arm.shoulder);
        joint(this.arms[side].elbow, 'x', arm.elbow);
      }
    }

    if (pose.hipDrop) {
      this.hips.position.y = mix(this.hips.position.y, H.hipY - pose.hipDrop - this._crouchBlend * 0.30);
    }
    joint(this.chest, 'x', pose.chestPitch);
    joint(this.chest, 'y', pose.chestYaw);
    joint(this.head, 'x', pose.headPitch);
    joint(this.head, 'y', pose.headYaw);
  }

}
