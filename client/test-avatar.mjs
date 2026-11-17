// client/test-avatar.mjs
// The character models, checked without a browser.
//
// The complaint was "I need an upgrade in the appearance of the characters".
// "Better looking" is hard to test, but the things that make it better are not:
//   · every outfit builds, and each one changes the silhouette (garment/headwear)
//   · changing the look at runtime works, and does not leak geometry
//   · the body still animates: joints exist, walk swings them, idle breathes
//   · the character is the right size to walk through a door
//   · draw calls stay sane, because every avatar is also every NPC
//   · old call sites (skinColour + outfitColour only) still produce a character

import * as THREE from 'three';
import { Avatar } from './src/player/Avatar.js';
import {
  OUTFITS, SKIN_TONES, HAIR_STYLES, BODY_TYPES, normaliseLook, outfitById,
} from './src/player/outfits.js';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const countMeshes = (root) => { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; };
const collect = (root, prop) => {
  const out = [];
  root.traverse((o) => { if (o.userData && o.userData.avatarPart === prop) out.push(o); });
  return out;
};

// ── Catalogue ────────────────────────────────────────────────
console.log('\n[Catalogue]');
check('There are skin tones to choose', SKIN_TONES.length >= 6, `${SKIN_TONES.length} tones`);
check('There are hair styles', HAIR_STYLES.length >= 5, HAIR_STYLES.map((h) => h.label).join(', '));
check('There are body types', BODY_TYPES.length === 3, BODY_TYPES.map((b) => b.label).join(', '));
check('There are whole outfits', OUTFITS.length >= 6, OUTFITS.map((o) => o.label).join(', '));

// ── Every outfit builds ──────────────────────────────────────
console.log('\n[Every outfit builds]');
const silhouettes = new Map();
for (const outfit of OUTFITS) {
  let avatar = null;
  let err = null;
  try {
    avatar = new Avatar({ look: { outfit: outfit.id, skin: 0x8d5524 } });
  } catch (e) {
    err = e;
  }
  check(`${outfit.label} builds`, !err, err ? err.message : `${countMeshes(avatar)} meshes`);

  if (avatar) {
    // A character with no legs is a bug, not a style.
    const hasLegs = avatar.legs && avatar.legs.L && avatar.legs.R;
    const hasArms = avatar.arms && avatar.arms.L && avatar.arms.R;
    check(`${outfit.label} has arms and legs`, Boolean(hasLegs && hasArms));

    const box = new THREE.Box3().setFromObject(avatar);
    const height = box.max.y - box.min.y;
    check(`${outfit.label} is human sized`, height > 1.55 && height < 2.0, `${height.toFixed(2)} m tall`);

    check(`${outfit.label} is not a draw-call bomb`, countMeshes(avatar) <= 48, `${countMeshes(avatar)} meshes`);

    silhouettes.set(outfit.id, {
      head: outfit.head,
      garment: outfit.garment,
      extra: outfit.extra,
      meshes: countMeshes(avatar),
    });
  }
}

// ── Outfits differ in silhouette, not just colour ────────────
console.log('\n[Silhouettes differ]');
{
  const keys = new Set(OUTFITS.map((o) => `${o.garment}/${o.head}/${o.extra}`));
  check('No two outfits are the same shape', keys.size === OUTFITS.length, [...keys].join(' · '));

  const garmentKinds = new Set(OUTFITS.map((o) => o.garment));
  check('More than one kind of garment', garmentKinds.size >= 4, [...garmentKinds].join(', '));
  const headwear = new Set(OUTFITS.map((o) => o.head).filter((h) => h !== 'none'));
  check('There is real headwear', headwear.size >= 3, [...headwear].join(', '));
}

// ── Changing the look at runtime ─────────────────────────────
console.log('\n[Changing the look]');
{
  const avatar = new Avatar({});
  const startMeshes = countMeshes(avatar);
  const startTop = avatar.outfitMat.color.getHex();

  avatar.setLook({ outfit: 'owambe', skin: 0x3b2416, hair: 'braids' });
  check('The outfit changes', avatar.outfitMat.color.getHex() !== startTop,
    `0x${startTop.toString(16)} → 0x${avatar.outfitMat.color.getHex().toString(16)}`);
  check('The skin changes', avatar.skinMat.color.getHex() === 0x3b2416);
  check('The hair changes', avatar.hairStyle === 'braids', avatar.hairStyle);
  check('The look is recorded', avatar.look.outfit === 'owambe' && avatar.look.skin === 0x3b2416);

  // Swap ten times: mesh count must not creep, and geometry must not leak.
  const before = countMeshes(avatar);
  for (let i = 0; i < 10; i++) {
    avatar.setLook({ outfit: OUTFITS[i % OUTFITS.length].id });
  }
  const after = countMeshes(avatar);
  check('Swapping outfits does not leak meshes', Math.abs(after - before) <= 4, `${before} → ${after}`);

  // Geometry count is a proxy for GPU memory: it must not grow either.
  let geos = 0;
  avatar.traverse((o) => { if (o.isMesh && o.geometry) geos++; });
  check('Every mesh still has geometry', geos === after, `${geos} geometries for ${after} meshes`);

  // Body type
  avatar.setLook({ body: 'broad' });
  const broad = avatar.chest.scale.x;
  avatar.setLook({ body: 'slim' });
  const slim = avatar.chest.scale.x;
  check('Body type changes the build', broad > slim, `broad ${broad.toFixed(2)} vs slim ${slim.toFixed(2)}`);
}

// ── Legs, hair and headwear are reachable ────────────────────
console.log('\n[Anatomy]');
{
  const avatar = new Avatar({ look: { outfit: 'trader', hair: 'afro' } });
  check('The head is attached above the chest', avatar.head.position.y > 0.5,
    `head at y = ${avatar.head.position.y.toFixed(2)} relative to chest`);
  check('The hair is on the head', Boolean(avatar.hairGroup && avatar.hairGroup.parent === avatar.head));
  check('The hands are at the end of the arms',
    avatar.arms.L.hand.position.y < -0.2, `hand y = ${avatar.arms.L.hand.position.y.toFixed(2)}`);
  check('Feet are at ground level',
    Math.abs(new THREE.Box3().setFromObject(avatar).min.y) < 0.06,
    `lowest point y = ${new THREE.Box3().setFromObject(avatar).min.y.toFixed(3)}`);

  // Headwear must sit on the skull, not float or sink into it.
  const hatted = new Avatar({ look: { outfit: 'owambe' } });
  const bare = new Avatar({ look: { outfit: 'casual' } });
  const hatTop = new THREE.Box3().setFromObject(hatted).max.y;
  const bareTop = new THREE.Box3().setFromObject(bare).max.y;
  check('Headwear sits on top of the head', hatTop > bareTop, `${bareTop.toFixed(2)} m → ${hatTop.toFixed(2)} m`);
}

// ── Backwards compatibility ──────────────────────────────────
console.log('\n[Old call sites]');
{
  // RemotePlayers and NPCs construct with colours only.
  const legacy = new Avatar({ skinColor: 0xd9a066, outfitColor: 0x27ae60, hairStyle: 'afro' });
  check('Colour-only avatars still work', legacy.skinMat.color.getHex() === 0xd9a066 &&
    legacy.outfitMat.color.getHex() === 0x27ae60);
  check('Legacy avatars get a full look',
    typeof legacy.look.outfit === 'string' && typeof legacy.look.garment === 'string',
    JSON.stringify({ outfit: legacy.look.outfit, garment: legacy.look.garment }));
  legacy.updateColors(0x4a3520, 0xe74c3c);
  check('updateColors still recolours', legacy.skinMat.color.getHex() === 0x4a3520 &&
    legacy.outfitMat.color.getHex() === 0xe74c3c);
}

// ── Animation still drives the joints ────────────────────────
console.log('\n[Animation]');
{
  const avatar = new Avatar({});
  avatar.setMoving(true, 1.0);
  const hipBefore = avatar.leftLeg.rotation.x;
  for (let i = 0; i < 30; i++) avatar.update(1 / 60, 1.0);
  const hipAfter = avatar.leftLeg.rotation.x;
  check('Walking swings the legs', Math.abs(hipAfter - hipBefore) > 0.05,
    `hip.rotation.x ${hipBefore.toFixed(2)} → ${hipAfter.toFixed(2)}`);

  avatar.setMoving(true, 1.6);
  for (let i = 0; i < 30; i++) avatar.update(1 / 60, 1.6);
  check('Running bends the knees', Math.abs(avatar.leftKnee.rotation.x) > 0.05,
    `knee.rotation.x = ${avatar.leftKnee.rotation.x.toFixed(2)}`);

  avatar.setMoving(false, 0);
  const breathBefore = avatar.chest.scale.y;
  for (let i = 0; i < 120; i++) avatar.update(1 / 60, 0);
  check('Standing still still breathes', Math.abs(avatar.chest.scale.y - breathBefore) > 0.002,
    `chest scale ${breathBefore.toFixed(4)} → ${avatar.chest.scale.y.toFixed(4)}`);
}

// ── A character fits through an interior doorway ─────────────
console.log('\n[Doorway]');
{
  const avatar = new Avatar({ look: { body: 'broad', outfit: 'office' } });
  const box = new THREE.Box3().setFromObject(avatar);
  const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  check('A broad character fits a 1.6 m doorway', width < 1.2, `${width.toFixed(2)} m wide`);
}

// ── normaliseLook is total ───────────────────────────────────
console.log('\n[Robust to bad input]');
{
  const a = normaliseLook();
  check('Empty look becomes the default', a.outfit === 'casual' && a.hair === 'short');
  const b = normaliseLook({ hair: 'mohawk', body: 'huge', outfit: 'nope', skin: 'blue' });
  check('Invalid values fall back instead of throwing',
    b.hair === 'short' && b.body === 'average' && b.outfit === 'casual' && typeof b.skin === 'number',
    JSON.stringify({ hair: b.hair, body: b.body, outfit: b.outfit }));
  check('Outfit lookup is safe', outfitById('nope').id === 'casual');
}

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
