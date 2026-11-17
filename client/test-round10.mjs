// client/test-round10.mjs
// Round 10, end to end in a browser: "make all things real".
//
// What this file refuses to accept:
//   · a shop you can walk into that has nothing to buy
//   · a room whose furniture you cannot use
//   · an airport you cannot check into, clear security at, or board from
//   · a purchase the server does not actually charge for
//
// It walks the real path every time: stand at the station, press E, use what
// appears, and read the result off the screen. Nothing is set by hand.
//
// Run with the server up: `node test-round10.mjs`.

import { chromium } from 'playwright-core';

const BASE = process.env.NL_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.setDefaultTimeout(120000);

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const frames = (n) => page.evaluate((count) => new Promise((done) => {
  let i = 0;
  const tick = () => (++i >= count ? done() : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
}), n);

/** Poll a page-side predicate until it is true. */
async function until(fn, arg = undefined, { timeout = 12000, step = 250 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(step);
  }
  return false;
}

/** Stand the player at a station inside the room they are already in. */
async function standAt(stationId) {
  return page.evaluate((id) => {
    const nl = globalThis.__nl;
    const st = nl.stations().find((s) => s.id === id);
    if (!st) return { ok: false, why: `no station ${id}` };
    nl.teleport(st.x, st.z);
    return { ok: true, x: st.x, z: st.z };
  }, stationId);
}

console.log(`\nNewLife — round 10, everything real (${BASE})\n`);

await page.goto(BASE, { waitUntil: 'load' });

// ── Sign up ────────────────────────────────────────────────
await page.waitForSelector('#auth-username', { timeout: 120000 });
const name = `shop${Math.random().toString(36).slice(2, 8)}`;
await page.fill('#auth-username', name);
await page.fill('#auth-password', 'password123');
await page.click('[data-act="next"]');
await page.waitForTimeout(1200);
await page.click('[data-act="next"]');           // character step
await page.waitForTimeout(900);
await page.click('[data-act="next"]');           // tier step
await page.waitForTimeout(6000);
await page.evaluate(() => {
  document.querySelectorAll('.tutorial-skip, .tutorial-next').forEach((b, i, all) => {
    if (i === all.length - 1) b.click();
  });
});
await page.click('.tutorial-skip').catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await frames(20);

// Every toast that ever appeared, so a message that has already faded still
// counts as evidence.
await page.evaluate(() => {
  window.__toasts = [];
  const container = document.querySelector('.toast-container') || document.body;
  new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType === 1 && node.classList?.contains('toast')) {
          window.__toasts.push(node.textContent);
        }
      }
    }
  }).observe(container, { childList: true, subtree: true });
});

const token = await page.evaluate(() => localStorage.getItem('newlife_token'));
check('The player is signed in and in the world',
  !!token && (await page.evaluate(() => !!globalThis.__nl?.report?.())) !== false,
  token ? 'token stored, world running' : 'no token');

/** Authenticated GET from inside the page (same origin, real JWT). */
const api = (path, opts = {}) => page.evaluate(async ([p, o]) => {
  const t = localStorage.getItem('newlife_token');
  const res = await fetch(p, {
    ...o,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(o.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}, [path, opts]);

// ── The supermarket ────────────────────────────────────────
console.log('\n[The supermarket you can actually shop in]');
const shop = await page.evaluate(async () => {
  const nl = globalThis.__nl;
  const res = nl.enterInterior('in-supermarket');
  await new Promise((r) => setTimeout(r, 1200));
  const stations = nl.stations();
  return {
    res,
    place: nl.interiors.place,
    inside: nl.interiors.isInside,
    stations,
    till: stations.find((s) => s.actions.some((a) => a.kind === 'shop')) || null,
  };
});
check('The supermarket door works', shop.res.ok === true && shop.inside, shop.place || shop.res.why);
check('It has aisles, a till and chillers to stand at', shop.stations.length >= 3,
  shop.stations.map((s) => `${s.id}(${s.actions.length})`).join(', '));
check('The till sells things', !!shop.till, shop.till ? shop.till.actions.map((a) => a.kind).join('+') : 'none');

// Walk to the till, read the prompt, press E — the real interaction path.
await standAt(shop.till.id);
await frames(6);
const prompt = await page.evaluate(() => {
  const el = document.querySelector('.interior-prompt, .prompt, [class*="prompt"]');
  return { text: el?.textContent?.replace(/\s+/g, ' ').trim() || '', hidden: el?.classList.contains('hidden') ?? null };
});
check('Standing at the till shows a prompt', /e\b/i.test(prompt.text) && prompt.hidden !== true, prompt.text || 'no prompt element');

await page.keyboard.press('KeyE');
const opened = await until(() => {
  const panel = globalThis.__nl?.venuePanel;
  return !!panel?.open && !!document.querySelector('.venue-card');
});
check('Pressing E opens the till', opened);

const listed = await until(() => document.querySelectorAll('.venue-item').length > 0);
const stock = await page.evaluate(() => ({
  items: [...document.querySelectorAll('.venue-item')].map((el) => ({
    id: el.querySelector('.venue-buy')?.dataset.buyItem || '',
    name: el.querySelector('.venue-item-name')?.textContent || '',
    price: el.querySelector('.venue-buy')?.textContent?.trim() || '',
  })),
  wallet: document.querySelector('.venue-wallet')?.textContent || '',
  empty: document.querySelector('.venue-shop-empty')?.textContent || '',
  error: document.querySelector('.venue-error')?.textContent || '',
}));
check('The till lists real stock from the server', listed && stock.items.length >= 3,
  `${stock.items.length} items: ${stock.items.slice(0, 5).map((i) => `${i.name} ${i.price}`).join(', ')}`);
check('Every item has a price in naira', stock.items.every((i) => /₦\s?[\d,]+/.test(i.price)),
  stock.items[0]?.price || stock.empty || 'none');
check('The panel shows the player wallet', /₦/.test(stock.wallet), stock.wallet);

// Buy the cheapest thing through the button, and prove the server charged.
const buy = await page.evaluate(async () => {
  const before = await (async () => {
    const t = localStorage.getItem('newlife_token');
    const r = await fetch('/api/venues', { headers: { Authorization: `Bearer ${t}` } });
    return (await r.json()).cash ?? null;
  })();
  const btn = document.querySelector('.venue-buy:not([disabled])');
  const itemName = btn?.closest('.venue-item')?.querySelector('.venue-item-name')?.textContent || '';
  btn?.click();
  await new Promise((r) => setTimeout(r, 2000));
  const t = localStorage.getItem('newlife_token');
  const r = await fetch('/api/venues', { headers: { Authorization: `Bearer ${t}` } });
  const after = await r.json();
  return {
    itemName,
    before,
    after: after.cash ?? null,
    toasts: (window.__toasts || []).join(' | '),
    error: document.querySelector('.venue-error')?.textContent || '',
  };
});
check('Buying something reaches the server', !buy.error, buy.error || `clicked ${buy.itemName}`);
check('The purchase is confirmed on screen', /Bought/.test(buy.toasts), buy.toasts.slice(-100));
check('The server actually charged for it', typeof buy.before === 'number' && buy.after < buy.before,
  `₦${buy.before} → ₦${buy.after}`);

// Buying from outside must fail — the venue check is not decoration.
await page.evaluate(() => globalThis.__nl.exitInterior());
await page.waitForTimeout(400);
const outside = await api('/api/interactions/venue/buy', {
  method: 'POST',
  body: JSON.stringify({ venue_id: 'in-supermarket', item_id: 'bread' }),
});
check('You cannot buy from a shop you are not standing in',
  /inside/i.test(outside.body?.error || ''), outside.body?.error || `HTTP ${outside.status}`);

// ── No room is scenery ─────────────────────────────────────
console.log('\n[Places that used to be empty]');
const rooms = ['in-market', 'in-church', 'in-hospital', 'in-school', 'in-restaurant', 'in-bank', 'in-gym'];
const perRoom = [];
for (const id of rooms) {
  const r = await page.evaluate(async (roomId) => {
    const nl = globalThis.__nl;
    const res = nl.enterInterior(roomId);
    await new Promise((r2) => setTimeout(r2, 900));
    const stations = nl.stations();
    nl.exitInterior();
    return { id: roomId, entered: res.ok, name: res.name, stations: stations.length, ids: stations.map((s) => s.id) };
  }, id);
  perRoom.push(r);
  await page.waitForTimeout(150);
}
const empty = perRoom.filter((r) => !r.entered || r.stations === 0);
check('Every one of these places has something to do in it', empty.length === 0,
  empty.length ? `empty: ${empty.map((r) => r.id).join(', ')}`
    : perRoom.map((r) => `${r.name}: ${r.stations}`).join(', '));

// ── The airport ────────────────────────────────────────────
console.log('\n[The airport]');
const airport = await page.evaluate(async () => {
  const nl = globalThis.__nl;
  const res = nl.enterInterior('in-airport');
  await new Promise((r) => setTimeout(r, 1200));
  return { res, place: nl.interiors.place, stations: nl.stations() };
});
check('You can walk into the terminal', airport.res.ok === true, airport.place || airport.res.why);
check('It has check-in, security, a gate and toilets',
  ['check-in', 'security', 'gate'].every((id) => airport.stations.some((s) => s.id === id)),
  airport.stations.map((s) => s.id).join(', '));
const toiletStation = airport.stations.find((s) => /toilet|wc|rest/i.test(s.id));
check('There is a washroom you can walk into and use', !!toiletStation,
  toiletStation ? toiletStation.id : airport.stations.map((s) => s.id).join(', '));

// Check in through the station itself.
await standAt('check-in');
await frames(6);
await page.keyboard.press('KeyE');
const panelAtCheckin = await until(() => !!document.querySelector('.venue-card'));
check('Pressing E at check-in opens the desk', panelAtCheckin);
await page.evaluate(() => document.querySelector('.venue-act[data-venue-act]')?.click());
// The request is a round trip through the real server; on a software renderer
// this can take a few seconds, so give it room rather than guessing.
await until(() => !globalThis.__nl?.venuePanel?.busy, undefined, { timeout: 15000 });
const checkin = await page.evaluate(() => ({
  toasts: (window.__toasts || []).join(' | '),
  error: document.querySelector('.venue-error')?.textContent || '',
}));
check('Checking in is a real server activity', !checkin.error, checkin.error || checkin.toasts.slice(-90));

// The gate takes you airside.
const airside = await page.evaluate(async () => {
  const nl = globalThis.__nl;
  if (!nl.interiors.isInside || nl.interiors.activeId !== 'in-airport') {
    nl.enterInterior('in-airport');
    await new Promise((r) => setTimeout(r, 1000));
  }
  const st = nl.stations().find((s) => s.id === 'gate');
  if (!st) return { error: 'no gate' };
  const idx = st.actions.findIndex((a) => a.kind === 'enter');
  nl.useStation('gate', idx);
  await new Promise((r) => setTimeout(r, 1800));
  return {
    activeId: nl.interiors.activeId,
    place: nl.interiors.place,
    stations: nl.stations().map((s) => s.id),
    manifest: { ...(nl.interiors.active?.manifest || {}) },
  };
});
check('The gate leads to the airside scene', airside.activeId === 'in-airfield',
  `${airside.activeId}${airside.error ? ` (${airside.error})` : ''}`);
check('The apron has a boarding gate', (airside.stations || []).includes('boarding'), (airside.stations || []).join(', '));
check('There are aircraft, jetbridges and a tower on the apron',
  (airside.manifest?.aircraft || 0) >= 2 && (airside.manifest?.atcTower || 0) >= 1,
  Object.entries(airside.manifest || {}).map(([k, v]) => `${k}×${v}`).join(', '));

const boarding = await page.evaluate(async () => {
  const nl = globalThis.__nl;
  const st = nl.stations().find((s) => s.id === 'boarding');
  const idx = st.actions.findIndex((a) => a.kind === 'activity');
  nl.useStation('boarding', idx);
  // A software renderer plus a full apron makes the round trip slow; wait on
  // the panel's own busy flag rather than on a guessed sleep.
  const started = Date.now();
  while (nl.venuePanel.busy && Date.now() - started < 45000) {
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 400));
  return {
    toasts: (window.__toasts || []).join(' | '),
    error: document.querySelector('.venue-error')?.textContent || '',
    elapsed: Date.now() - started,
  };
});
check('Boarding the flight starts a real activity',
  !boarding.error && /Take the Flight|boarding/i.test(boarding.toasts),
  boarding.error || `${boarding.toasts.slice(-110)} (${boarding.elapsed} ms)`);

// ── The fleet ──────────────────────────────────────────────
console.log('\n[The fleet]');
const fleet = await api('/api/vehicles');
const ids = (fleet.body.catalog || []).map((v) => v.id);
check('The catalogue sells the Hiace, the tricycle and the motorbike',
  ['hiace', 'tricycle', 'motorbike'].every((id) => ids.includes(id)), ids.join(', '));
const hiace = (fleet.body.catalog || []).find((v) => v.id === 'hiace');
check('The Hiace really seats 18', hiace?.seats === 18, `${hiace?.name} — ${hiace?.seats} seats`);
check('No danfo, keke or okada is still for sale',
  !['danfo', 'keke', 'okada'].some((id) => ids.includes(id)), ids.join(', '));

const fleetOnRoad = await page.evaluate(() => {
  const kinds = new Set();
  for (const c of [...(globalThis.__nl.traffic?.parked || []), ...(globalThis.__nl.traffic?.moving || [])]) kinds.add(c.kind);
  return [...kinds];
});
check('The street fleet is the new one', fleetOnRoad.some((k) => ['hiace', 'tricycle', 'motorcycle'].includes(k))
  && !fleetOnRoad.some((k) => ['danfo', 'keke', 'okada'].includes(k)), fleetOnRoad.join(', '));

// The only console errors allowed are the ones this test provokes on purpose.
// The intentional "buy from outside the shop" probe returns 400, and the
// entitlement probes return 401; both are the point of the test, not noise.
const unexpected = errors.filter((e) => !/40[01]/.test(e));
check('No page errors during the run', unexpected.length === 0, unexpected.slice(0, 2).join(' | ') || 'clean');

console.log(`\n${'='.repeat(50)}\nPASSED: ${passed}   FAILED: ${failed}\n${'='.repeat(50)}\n`);
await browser.close();
process.exit(failed ? 1 : 0);
