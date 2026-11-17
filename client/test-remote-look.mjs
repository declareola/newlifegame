// client/test-remote-look.mjs
// Other players have to look like themselves.
//
// The bug this covers: the server broadcast only a skin colour and a shirt
// colour, so the client guessed a hair style from the username and every remote
// player wore the default outfit. Then, even once the server sent the look, a
// player who changed clothes in the character panel kept their old outfit on
// everyone else's screen until they reconnected.
//
//   node test-remote-look.mjs

import { JSDOM } from 'jsdom';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── A DOM, with just enough canvas for the name tags ────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.navigator = window.navigator;
globalThis.HTMLElement = window.HTMLElement;

// jsdom has no canvas. Name tags only need a 2D context that accepts calls.
const fakeCtx = new Proxy({}, {
  get(_, key) {
    if (key === 'measureText') return () => ({ width: 80 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    if (key === 'canvas') return { width: 512, height: 128 };
    return () => {};
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => fakeCtx;

// ── Imports ─────────────────────────────────────────────────
const THREE = await import('three');
const { lookFromPayload, lookKeyOf, RemotePlayers } = await import('./src/multiplayer/RemotePlayers.js');
const { normaliseLook } = await import('./src/player/outfits.js');

console.log('\n[Payload → look]');
const full = lookFromPayload({
  username: 'tunde',
  skinColor: 0x8d5524,
  outfitColor: 0xf4f1e8,
  bottomColor: 0x2f3640,
  hairStyle: 'braids',
  hairColor: 0x3b2a1d,
  bodyType: 'broad',
  outfitId: 'kaftan',
});
check('The outfit the player chose is used', full.outfit === 'kaftan', full.outfit);
check('Skin, hair, hair colour and build all travel', full.skin === 0x8d5524
  && full.hair === 'braids' && full.hairColour === 0x3b2a1d && full.body === 'broad',
  `${full.hair} / ${full.body}`);
check('Both cloth colours survive', full.top === 0xf4f1e8 && full.bottom === 0x2f3640,
  `${full.top.toString(16)} / ${full.bottom.toString(16)}`);

const legacy = lookFromPayload({ username: 'tunde', skinColor: 0xf1c27d, outfitColor: 0x2196f3 });
const legacyAgain = lookFromPayload({ username: 'tunde', skinColor: 0xf1c27d, outfitColor: 0x2196f3 });
check('An account from before the creator still gets a look', typeof legacy.hair === 'string' && legacy.hair.length > 0,
  legacy.hair);
check('…and the same account always gets the same one', legacy.hair === legacyAgain.hair, legacy.hair);

const broken = normaliseLook(lookFromPayload({ username: 'x', outfitId: 'nonsense' }));
check('An unknown outfit falls back instead of throwing', broken.outfit === 'casual', broken.outfit);

console.log('\n[Look identity]');
const a = { skinColor: 1, outfitColor: 2, outfitId: 'casual', hairStyle: 'short' };
check('The same look hashes the same', lookKeyOf(a) === lookKeyOf({ ...a }));
check('A new outfit changes the hash', lookKeyOf(a) !== lookKeyOf({ ...a, outfitId: 'owambe' }));
check('A new hair style changes the hash', lookKeyOf(a) !== lookKeyOf({ ...a, hairStyle: 'afro' }));
check('A missing field does not break the hash', typeof lookKeyOf({}) === 'string');

console.log('\n[Remote players]');
const scene = new THREE.Scene();
const remote = new RemotePlayers(scene);

const player = {
  id: 'sock-1', username: 'amaka', x: 3, z: -4, rot: 0.5, moving: false,
  skinColor: 0x5c3a21, outfitColor: 0x8e44ad, bottomColor: 0x4a235a,
  hairStyle: 'fade', hairColor: 0x181310, bodyType: 'slim', outfitId: 'owambe',
};

remote.applySnapshot([player], 'me');
check('One remote player is drawn', remote.count === 1, `${remote.count}`);
const entry = remote.players.get('sock-1');
check('…in the outfit the server sent', entry.avatar.look.outfit === 'owambe', entry.avatar.look.outfit);
check('…with that player\'s build', entry.avatar.look.body === 'slim', entry.avatar.look.body);
check('…and their hair', entry.avatar.look.hair === 'fade', entry.avatar.look.hair);
check('…at their position', Math.abs(entry.avatar.position.x - 3) < 0.001 && Math.abs(entry.avatar.position.z + 4) < 0.001);

// Change clothes mid-session: the avatar on our screen must follow.
remote.applySnapshot([{ ...player, outfitId: 'office', hairStyle: 'short' }], 'me');
check('Changing outfit updates the live avatar', entry.avatar.look.outfit === 'office', entry.avatar.look.outfit);
check('Changing hair updates too', entry.avatar.look.hair === 'short', entry.avatar.look.hair);
check('The player was not duplicated', remote.count === 1, `${remote.count}`);
check('The avatar is still the same object', remote.players.get('sock-1') === entry);

// An unchanged snapshot must not rebuild anything.
const before = entry.avatar.children.length;
remote.applySnapshot([{ ...player, outfitId: 'office', hairStyle: 'short' }], 'me');
check('An unchanged look does not rebuild the model', entry.avatar.children.length === before,
  `${entry.avatar.children.length} children`);

remote.applySnapshot([], 'me');
check('Leaving removes the avatar', remote.count === 0);

console.log('\n[NPCs wear the right clothes]');
const { ROLES, NPC_DEFS } = await import('./src/world/NPCSystem.js');
const VENUE_ROLES = {
  priest: 'church', imam: 'mosque', teacher: 'school', chef: 'restaurant',
  agent: 'airport', student: 'school', banker: 'bank', nurse: 'hospital',
};
for (const [role, venue] of Object.entries(VENUE_ROLES)) {
  const def = ROLES[role];
  check(`A ${role} exists for the ${venue}`, Boolean(def && def.look),
    def ? def.look.outfit : 'missing');
  if (!def || !def.look) continue;
  const look = normaliseLook(def.look);
  check(`…and their outfit is real, not a fallback`,
    look.outfit === (def.look.outfit || 'casual') && look.garment !== undefined,
    `${look.outfit} / garment ${look.garment} / head ${look.head}`);
  check(`…and they have something to say`, typeof def.greeting === 'string' && def.greeting.length > 10);
}

const placedRoles = new Set(NPC_DEFS.map((d) => d.role));
for (const role of Object.keys(VENUE_ROLES)) {
  if (role === 'banker' || role === 'nurse') continue;
  check(`A ${role} is actually placed in the world`, placedRoles.has(role));
}
const badAnchors = NPC_DEFS.filter((d) => !Number.isFinite(d.anchor?.x) || !Number.isFinite(d.anchor?.z));
check('Every NPC has a real anchor', badAnchors.length === 0,
  badAnchors.map((d) => d.id).join(',') || `${NPC_DEFS.length} NPCs`);
check('The crowd got bigger, not smaller', NPC_DEFS.length >= 16, `${NPC_DEFS.length} NPCs`);

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
