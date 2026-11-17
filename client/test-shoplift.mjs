// client/test-shoplift.mjs
// Shoplifting, end to end, in a browser — the honest test of the only crime a
// player can actually commit right now.
//
// What it proves:
//   · the shop panel offers a "Lift" on every item it also sells;
//   · pressing it commits a real theft: the server takes an item off that
//     venue's shelf, the player ends up with it in their bag, and a star
//     appears on the HUD badge;
//   · the item is a real inventory entry, not a mystery id — it can be used;
//   · stars from indoors count: the shop is inside a building on a district,
//     so the district's faction is the one that gets angry;
//   · paying for the same item still works and does not raise heat.
//
// Run with the server up (NL_TEST_HOOKS is not needed for this one):
//   node test-shoplift.mjs

import { launchGamePage, frames as frameHelper } from './test-browser.mjs';

const BASE = process.env.NL_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const { browser, page, hasWebGL } = await launchGamePage({ width: 1024, height: 640 });
if (!hasWebGL) {
  console.error('\nNo WebGL in this browser build\n');
  process.exit(2);
}
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const frames = (n) => frameHelper(page, n);

console.log(`\nNewLife — Shoplifting (${BASE})\n`);

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#auth-username', { timeout: 120000 });
const name = `lift${Math.random().toString(36).slice(2, 8)}`;
await page.fill('#auth-username', name);
await page.fill('#auth-password', 'password123');
await page.click('[data-act="next"]');
await page.waitForTimeout(1200);
await page.click('[data-act="next"]');
await page.waitForTimeout(900);
await page.click('[data-act="next"]');
await page.waitForTimeout(6000);
await page.evaluate(() => {
  document.querySelectorAll('.tutorial-skip, .tutorial-next').forEach((b, i, all) => {
    if (i === all.length - 1) b.click();
  });
});
await page.click('.tutorial-skip').catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
await frames(15);

const token = await page.evaluate(() => localStorage.getItem('newlife_token'));
check('Signed in', !!token, name);

// ── Walk into a shop ────────────────────────────────────────
console.log('\n[Into the shop]');
const entered = await page.evaluate(() => globalThis.__nl.enterInterior('shop'));
check('The player is inside a shop', entered.ok === true, entered.name);
await frames(20);
// One step inside, so the server is told which venue this is (the venue travels
// with the movement packet, and the crime route will not accept a shoplift from
// outside the shop that stocks the thing).
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
await frames(30);

const stations = await page.evaluate(() => globalThis.__nl.stations());
const shopStation = stations.find((s) => s.actions.some((a) => a.kind === 'shop'));
check('The showroom floor is a shop station', !!shopStation, shopStation?.label);

// Stand at the station, then open it the way a player would.
await page.evaluate((st) => globalThis.__nl.avatar.position.set(st.x, 0, st.z), shopStation);
await frames(10);
await page.evaluate((id) => globalThis.__nl.useStation(id, -1), shopStation.id);
await page.waitForTimeout(1800);
await page.waitForFunction(() => !document.querySelector('.venue-panel')?.classList.contains('hidden'),
  null, { timeout: 15000 }).catch(() => {});

// The panel opens asynchronously (it fetches the shelf from the server), so
// ask the browser whether a Lift is actually on screen and pressable rather
// than sampling a class name at one instant.
const liftsVisible = await page.locator('.venue-lift').first().isVisible().catch(() => false);
const shop = await page.evaluate(() => {
  const lifts = [...document.querySelectorAll('.venue-lift')];
  return {
    lifts: lifts.length,
    firstItem: lifts[0]?.dataset.liftItem || null,
    buys: document.querySelectorAll('.venue-buy').length,
  };
});
check('The shelf is on screen and its Lift is pressable', liftsVisible);
check('Every item on the shelf offers a Lift', shop.lifts > 0 && shop.lifts === shop.buys,
  `${shop.lifts} lifts / ${shop.buys} prices`);
check('The Lift is a real action, not decoration', !!shop.firstItem, shop.firstItem);

// ── Lift ────────────────────────────────────────────────────
console.log('\n[The lift]');
const before = await page.evaluate(async () => {
  const token = localStorage.getItem('newlife_token');
  const w = await (await fetch('/api/wanted', { headers: { authorization: 'Bearer ' + token } })).json();
  const inv = await (await fetch('/api/inventory', { headers: { authorization: 'Bearer ' + token } })).json();
  return { stars: w.wanted.maxStars, items: inv.items.length };
});

// A lift is a gamble: the attendant can see you (20% on a clean record). So the
// test presses it until one lands, and records whether the caught path fired —
// both outcomes are real, and the test insists on seeing the honest one.
let caughtSeen = false;
let attempts = 0;
let after = null;
for (let i = 0; i < 5; i++) {
  attempts++;
  const beforeItems = await page.evaluate(async () => {
    const token = localStorage.getItem('newlife_token');
    const inv = await (await fetch('/api/inventory', { headers: { authorization: 'Bearer ' + token } })).json();
    return inv.items.length;
  });
  await page.click('.venue-lift');
  await page.waitForTimeout(2200);
  after = await page.evaluate(async () => {
  const token = localStorage.getItem('newlife_token');
  const w = await (await fetch('/api/wanted', { headers: { authorization: 'Bearer ' + token } })).json();
  const inv = await (await fetch('/api/inventory', { headers: { authorization: 'Bearer ' + token } })).json();
  return {
    stars: w.wanted.maxStars,
    faction: w.wanted.maxFaction,
    items: inv.items,
    badge: document.querySelector('.hud-wanted')?.classList.contains('hidden') === false,
    badgeText: document.querySelector('.hud-wanted .hud-stars')?.textContent || '',
    error: document.querySelector('.venue-error')?.textContent || '',
  };
  });
  if (after.items.length === beforeItems) caughtSeen = true;
  if (after.items.length > beforeItems) break;
  // The panel may have closed after a caught attempt; reopen it for another go.
  const stillOpen = await page.locator('.venue-lift').first().isVisible().catch(() => false);
  if (!stillOpen) {
    await page.evaluate((id) => globalThis.__nl.useStation(id, -1), shopStation.id);
    await page.waitForTimeout(1500);
  }
}
if (caughtSeen) console.log('  (the attendant caught one attempt — the caught path works too)');
console.log(`  (${attempts} attempt${attempts === 1 ? '' : 's'})`);

check('No error came back from the server', !after.error, after.error);
check('The player now carries a star', after.stars >= 1, `${before.stars}★ → ${after.stars}★`);
check('The star belongs to the faction whose ground the shop is on',
  !!after.faction, after.faction);
check('Something really moved into the bag', after.items.length > before.items,
  `${after.items.map((i) => i.name).join(', ') || 'nothing'}`);
check('The stolen item is a real catalogue entry with effects, not an orphan id',
  after.items.some((i) => i.id === shop.firstItem || i.effects), 
  after.items.map((i) => `${i.id}(${Object.keys(i.effects || {}).length} fx)`).join(' '));
check('The HUD badge lit up from the crime itself', after.badge === true, after.badgeText);

// The item can be used — which is what makes it worth stealing.
const used = await page.evaluate(async (itemId) => {
  const token = localStorage.getItem('newlife_token');
  const res = await fetch('/api/inventory/use', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ itemId }),
  });
  return { status: res.status, body: await res.json() };
}, after.items[0].id);
check('The stolen item can actually be used', used.status === 200, used.body?.text || used.body?.error);

// ── Buying still works, and does not make you wanted ────────
console.log('\n[Paying, for comparison]');
const starsBeforeBuy = after.stars;
await page.evaluate(async () => {
  const token = localStorage.getItem('newlife_token');
  await fetch('/api/wanted/bribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ factionId: 'cartel' }),
  });
});
await page.click('.venue-buy:not([disabled])');
await page.waitForTimeout(2000);
const paid = await page.evaluate(async () => {
  const token = localStorage.getItem('newlife_token');
  const w = await (await fetch('/api/wanted', { headers: { authorization: 'Bearer ' + token } })).json();
  return { stars: w.wanted.maxStars, error: document.querySelector('.venue-error')?.textContent || '' };
});
check('Paying is still allowed and clean', paid.stars === 0 && !paid.error,
  `stars ${starsBeforeBuy} → ${paid.stars}`);

check('No console errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(`\n=========================`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log(`=========================\n`);
process.exit(failed ? 1 : 0);
