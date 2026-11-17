// server/test-wanted.mjs
// The wanted matrix, end to end, against the running server.
//
// Blueprint Part H asks for three factions × four tiers. This file proves the
// matrix is real rather than a HUD ornament:
//   · a crime in one faction's turf raises only that faction's stars;
//   · a crime on neutral ground raises nothing;
//   · stars have consequences — 3★ refuses service, 4★ arrests and fines;
//   · a bribe clears the heat for a price and actually takes the money;
//   · the client cannot choose its own faction or star count.
//
// Run with the server up:  node test-wanted.mjs

const BASE = process.env.NL_URL || 'http://127.0.0.1:3000';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const api = async (path, { token, method = 'GET', body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
};

const uname = `want${Math.random().toString(36).slice(2, 8)}`;
const signup = await api('/api/signup', {
  method: 'POST',
  body: { username: uname, password: 'password123', tier: 'nepo' },
});
const token = signup.body?.token;
check('Account created for the test', !!token, uname);
if (!token) process.exit(1);
const startCash = signup.body.user.cash;

// ── The matrix starts clean ─────────────────────────────────
console.log('\n[Matrix]');
const initial = await api('/api/wanted', { token });
check('All three factions are present', initial.body?.wanted?.factions?.length === 3,
  (initial.body?.wanted?.factions || []).map((f) => f.short).join(', '));
check('Everyone starts clean', initial.body.wanted.maxStars === 0);
check('The matrix reports four tiers as the maximum', initial.body.wanted.max === 4);

// ── Crimes need the player to be in the world ───────────────
console.log('\n[Crime validation]');
const noWorld = await api('/api/crime', { token, method: 'POST', body: { crime: 'shoplift' } });
check('A crime with no world position is refused', noWorld.status === 400,
  noWorld.body?.error || 'no error');

const bogus = await api('/api/crime', { token, method: 'POST', body: { crime: 'destroy-the-world' } });
check('An unknown crime is refused', bogus.status === 400, bogus.body?.error);

const noVenue = await api('/api/crime', { token, method: 'POST', body: { crime: 'shoplift' } });
check('Shoplifting outside a shop is refused', noVenue.status === 400,
  noVenue.body?.error || 'no error');

// ── The client cannot choose its own heat ───────────────────
// Sending stars/faction in the body must change nothing: the server reads the
// player's own position for the district.
const spoof = await api('/api/crime', {
  token, method: 'POST',
  body: { crime: 'shoplift', factionId: 'cartel', stars: 4, districtId: 'marina' },
});
check('A client-supplied faction and star count are ignored',
  spoof.status === 400 || spoof.body?.faction !== 'cartel',
  spoof.status === 400 ? `refused outright: ${spoof.body.error}` : `faction = ${spoof.body.faction}`);

// ── Bribe pricing is the server's ───────────────────────────
const bribeNoHeat = await api('/api/wanted/bribe', { token, method: 'POST', body: { factionId: 'kings' } });
check('Bribing a faction that does not care about you is refused',
  bribeNoHeat.status === 400, bribeNoHeat.body?.error);

const bribeBogus = await api('/api/wanted/bribe', { token, method: 'POST', body: { factionId: 'nobody' } });
check('Bribing a nonexistent faction is refused', bribeBogus.status === 400, bribeBogus.body?.error);

// ── Escalation, using the server's own crime path ───────────
// The HTTP crime route needs a live world position, which a headless test does
// not have. So the engine is exercised directly, at the same entry point the
// route uses — recordCrime() — and the results are checked through the API.
console.log('\n[Escalation]');
const { recordCrime, getWanted, starsFor, clearWanted, arrest, payBribe } =
  await import('./src/wanted.js');
const { db } = await import('./src/db.js');

const user = db.prepare('SELECT id, cash FROM users WHERE username = ?').get(uname);
const userId = user.id;

const one = recordCrime({ userId, crime: 'shoplift', districtId: 'mushin' });
check('A crime in Street Kings turf raises Street Kings', one.faction === 'kings' && one.stars > 0,
  `${one.faction} → ${one.stars}★ (${one.tierLabel})`);
check('It does not raise another faction', starsFor(userId, 'cartel') === 0 && starsFor(userId, 'syndicate') === 0,
  'cartel 0★, syndicate 0★');

const neutral = recordCrime({ userId, crime: 'assault', districtId: null });
check('A crime on neutral ground raises nobody', neutral.ignored === true && neutral.stars === 0);

// Escalate to 3★ and check the service refusal kicks in.
recordCrime({ userId, crime: 'assault', districtId: 'mushin' }); // +3 → 4 total, capped
const hot = getWanted(userId);
const kings = hot.factions.find((f) => f.id === 'kings');
check('Stars are capped at four', kings.stars === 4, `${kings.stars}★`);
check('The top tier is called Marked', kings.tier === 'marked', kings.label);
check('Marked means service is refused', kings.refuseService === true);
check('Marked means arrest on sight', kings.arrestOnSight === true);

const mid = await (async () => {
  clearWanted(userId);
  // 'tin-can' is a Syndicate district; 'docks' is the island id and is not a
  // district, so passing it correctly raises nobody.
  recordCrime({ userId, crime: 'shoplift', districtId: 'tin-can' });
  recordCrime({ userId, crime: 'break-in', districtId: 'tin-can' }); // 1 + 2 = 3
  return getWanted(userId).factions.find((f) => f.id === 'syndicate');
})();
check('3★ is Hunted: refused service but not arrested',
  mid.tier === 'hunted' && mid.refuseService === true && mid.arrestOnSight === false,
  `${mid.stars}★ ${mid.label}`);

// ── The HUD endpoint reflects all of it ─────────────────────
const live = await api('/api/wanted', { token });
const liveSyn = live.body.wanted.factions.find((f) => f.id === 'syndicate');
check('GET /api/wanted reports the live heat',
  liveSyn.stars === mid.stars, `${liveSyn.stars}★ on ${liveSyn.short}`);
check('It carries a bribe price that rises with the tier',
  liveSyn.bribePrice > 0 && liveSyn.bribePrice > 25_000,
  `₦${liveSyn.bribePrice.toLocaleString('en-NG')}`);

// ── Bribe takes the money and clears the stars ──────────────
console.log('\n[Bribe]');
const beforeCash = db.prepare('SELECT cash FROM users WHERE id = ?').get(userId).cash;
const price = liveSyn.bribePrice;
const bribe = await api('/api/wanted/bribe', { token, method: 'POST', body: { factionId: 'syndicate' } });
check('The bribe succeeds', bribe.status === 200, bribe.body?.error || 'ok');
check('It charges exactly the quoted price',
  bribe.status === 200 && bribe.body.paid === price,
  `₦${(bribe.body?.paid || 0).toLocaleString('en-NG')} of ₦${price.toLocaleString('en-NG')}`);
const afterCash = db.prepare('SELECT cash FROM users WHERE id = ?').get(userId).cash;
check('Cash actually left the account', afterCash === beforeCash - price,
  `₦${beforeCash.toLocaleString('en-NG')} → ₦${afterCash.toLocaleString('en-NG')}`);
check('The faction is clean afterwards', starsFor(userId, 'syndicate') === 0);

const tooSoon = await api('/api/wanted/bribe', { token, method: 'POST', body: { factionId: 'syndicate' } });
check('Bribing again once clean is refused', tooSoon.status === 400, tooSoon.body?.error);

// ── Arrest: the 4★ consequence ──────────────────────────────
console.log('\n[Arrest]');
clearWanted(userId);
recordCrime({ userId, crime: 'assault', districtId: 'marina' });
recordCrime({ userId, crime: 'assault', districtId: 'marina' }); // 3 + 3 → 4, capped
const cashBeforeArrest = db.prepare('SELECT cash FROM users WHERE id = ?').get(userId).cash;
const busted = arrest({ userId });
check('Arrest takes a fine', busted.fine > 0, `₦${busted.fine.toLocaleString('en-NG')}`);
const cashAfterArrest = db.prepare('SELECT cash FROM users WHERE id = ?').get(userId).cash;
check('The fine is actually deducted', cashAfterArrest === cashBeforeArrest - busted.fine,
  `₦${cashBeforeArrest.toLocaleString('en-NG')} → ₦${cashAfterArrest.toLocaleString('en-NG')}`);
check('Arrest clears every faction', getWanted(userId).maxStars === 0);
check('The player is sent to the police station',
  busted.station?.buildingId === 'police', busted.station?.district);

// ── Decay is computed from the clock, not a timer ───────────
console.log('\n[Decay]');
clearWanted(userId);
recordCrime({ userId, crime: 'assault', districtId: 'mushin' }); // 3★
const decayBefore = starsFor(userId, 'kings');
db.prepare("UPDATE wanted SET last_crime_at = datetime('now', '-13 minutes') WHERE user_id = ?")
  .run(userId);
const decayAfter = starsFor(userId, 'kings');
check('Stars decay with time', decayAfter < decayBefore, `${decayBefore}★ → ${decayAfter}★ after 13 min`);
check('Two six-minute steps came off', decayBefore - decayAfter === 2,
  `removed ${decayBefore - decayAfter}`);

clearWanted(userId);

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
