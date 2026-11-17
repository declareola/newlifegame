import * as THREE from 'three';
import { Avatar } from '../player/Avatar.js';

// Status icons shown next to a remote player's name.
const ACTIVITY_ICON = {
  eat: '🍔',
  sleep: '🛏️',
  shower: '🚿',
  toilet: '🚻',
  social: '👥',
  exercise: '🏃',
};

/** Draw a name tag onto a canvas and return it as a sprite. */
function createNameTag(username) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontSize = 44;
  canvas.width = 512;
  canvas.height = 128;

  ctx.font = `bold ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
  const textWidth = ctx.measureText(username).width;
  const padding = 28;
  const boxWidth = Math.min(canvas.width - 8, textWidth + padding * 2);
  const boxHeight = 76;
  const boxX = (canvas.width - boxWidth) / 2;
  const boxY = (canvas.height - boxHeight) / 2;

  // Rounded background
  const radius = 20;
  ctx.beginPath();
  ctx.moveTo(boxX + radius, boxY);
  ctx.lineTo(boxX + boxWidth - radius, boxY);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
  ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
  ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
  ctx.lineTo(boxX + radius, boxY + boxHeight);
  ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
  ctx.lineTo(boxX, boxY + radius);
  ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 20, 35, 0.82)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
  ctx.fillText(username, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.2, 0.8, 1);
  sprite.position.y = 2.75;
  sprite.renderOrder = 999;
  return sprite;
}

/**
 * Renders every other player in the world.
 *
 * Positions arrive as snapshots ~10 times a second. Each avatar keeps a
 * target position and lerps toward it every frame, so movement looks smooth
 * instead of teleporting between packets.
 */
// Deterministic hair style per username so every player looks distinct
// without storing it on the server.
const HAIR_STYLES = ['short', 'afro', 'braids', 'bald'];
function pickHairStyle(username = '') {
  let h = 2166136261;
  for (let i = 0; i < username.length; i++) {
    h ^= username.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return HAIR_STYLES[h % HAIR_STYLES.length];
}

/**
 * Turn a server player payload into an Avatar look.
 * Falls back to the old username-derived hair style for accounts created
 * before the character creator existed.
 */
export function lookFromPayload(p = {}) {
  const hasLook = p.outfitId || p.hairStyle || p.bodyType;
  if (!hasLook) {
    return {
      skin: p.skinColor,
      top: p.outfitColor,
      hair: pickHairStyle(p.username),
    };
  }
  return {
    outfit: p.outfitId || 'casual',
    skin: p.skinColor,
    top: p.outfitColor,
    bottom: p.bottomColor,
    hair: p.hairStyle || 'short',
    hairColour: p.hairColor,
    body: p.bodyType || 'average',
  };
}

/** Cheap identity for "did this player's clothing change?". */
export function lookKeyOf(p = {}) {
  return [p.skinColor, p.outfitColor, p.bottomColor, p.hairStyle, p.hairColor, p.bodyType, p.outfitId]
    .map((v) => (v === undefined || v === null ? '-' : v))
    .join(':');
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map(); // socketId -> { avatar, nameTag, target, ... }
  }

  /** @returns {number} how many other players are rendered */
  get count() {
    return this.players.size;
  }

  /**
   * Apply a `world:players` snapshot.
   * @param {Array} list - player objects from the server
   * @param {string} selfId - our own socket id, so we never draw ourselves
   */
  applySnapshot(list, selfId) {
    if (!Array.isArray(list)) return;

    const seen = new Set();

    for (const p of list) {
      if (!p || !p.id || p.id === selfId) continue;
      seen.add(p.id);

      let entry = this.players.get(p.id);
      if (!entry) {
        entry = this._create(p);
        this.players.set(p.id, entry);
      }

      // Somebody changed their clothes: rebuild their look on our screen too.
      const lookKey = lookKeyOf(p);
      if (lookKey !== entry.lookKey) {
        entry.lookKey = lookKey;
        entry.avatar.setLook(lookFromPayload(p));
      }

      entry.target.x = p.x;
      entry.target.z = p.z;
      entry.target.rot = p.rot;
      entry.moving = !!p.moving;
      entry.lastSeen = performance.now();

      // Status changed? Redraw the name tag.
      const status = this._statusKey(p);
      if (status !== entry.status) {
        entry.status = status;
        this._refreshNameTag(entry, p.username, p, status);
      }
    }

    // Remove anyone who is no longer in the snapshot
    for (const [id, entry] of this.players) {
      if (!seen.has(id)) this.remove(id);
    }
  }

  _statusKey(p) {
    if (p.passedOut) return 'out';
    if (p.activity) return p.activity;
    return '';
  }

  _create(p) {
    const avatar = new Avatar({ look: lookFromPayload(p) });
    avatar.position.set(p.x, 0, p.z);
    avatar.rotation.y = p.rot || 0;
    this.scene.add(avatar);

    const nameTag = createNameTag(p.username);
    avatar.add(nameTag);

    const entry = {
      avatar,
      nameTag,
      username: p.username,
      status: this._statusKey(p),
      target: { x: p.x, z: p.z, rot: p.rot || 0 },
      moving: !!p.moving,
      lookKey: lookKeyOf(p),
      lastSeen: performance.now(),
      // Smoothed walk state so remote avatars don't flicker between idle/walk
      walkTimer: 0,
    };

    this._refreshNameTag(entry, p.username, p, entry.status);
    return entry;
  }

  _refreshNameTag(entry, username, p, status) {
    let label = username;
    if (status && status !== '') {
      if (status === 'out') {
        label = `${username} 😵`;
      } else if (ACTIVITY_ICON[status]) {
        label = `${username} ${ACTIVITY_ICON[status]}`;
      }
    }
    if (p && p.homeIcon) label = `${p.homeIcon} ${label}`;

    if (entry.nameTag) {
      entry.avatar.remove(entry.nameTag);
      entry.nameTag.material.map?.dispose();
      entry.nameTag.material.dispose();
    }
    entry.nameTag = createNameTag(label);
    entry.avatar.add(entry.nameTag);
  }

  remove(id) {
    const entry = this.players.get(id);
    if (!entry) return;
    this.scene.remove(entry.avatar);
    entry.avatar.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this.players.delete(id);
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }

  /**
   * Interpolate every remote avatar toward its latest server position.
   * @param {number} deltaTime - seconds since last frame
   */
  update(deltaTime) {
    const now = performance.now();
    // Frame-rate independent smoothing factor. ~12/s feels responsive
    // without snapping when a packet is late.
    const lerp = 1 - Math.exp(-12 * deltaTime);

    for (const entry of this.players.values()) {
      const a = entry.avatar;

      const dx = entry.target.x - a.position.x;
      const dz = entry.target.z - a.position.z;
      const distSq = dx * dx + dz * dz;

      a.position.x += dx * lerp;
      a.position.z += dz * lerp;

      // Rotate toward the target heading the short way around.
      let rotDelta = entry.target.rot - a.rotation.y;
      while (rotDelta > Math.PI) rotDelta -= Math.PI * 2;
      while (rotDelta < -Math.PI) rotDelta += Math.PI * 2;
      a.rotation.y += rotDelta * Math.min(1, lerp * 1.6);

      // Decide walk animation from recent movement or the server flag.
      const stale = now - entry.lastSeen > 2000;
      const actuallyMoving = !stale && (entry.moving || distSq > 0.0004);

      if (actuallyMoving) {
        entry.walkTimer = 0.25;
      } else {
        entry.walkTimer = Math.max(0, entry.walkTimer - deltaTime);
      }

      a.setMoving(entry.walkTimer > 0, 1);
      a.update(deltaTime);
    }
  }
}
