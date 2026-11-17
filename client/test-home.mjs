// client/test-home.mjs
// "Add a button that takes the character to home" — end to end, in a browser.
//
// The rule this file enforces is the one that matters: a control on screen must
// do what it says. So it drives the real UI:
//
//   1. a brand-new player is homeless, and the Home button says so — disabled,
//      with a tooltip that explains it, and pressing it produces a message
//      rather than nothing;
//   2. the player rents the hostel bed through the Property panel (the real
//      purchase path, server-authoritative);
//   3. the Home button becomes live, and pressing it puts the character inside
//      their own flat, through the same door-entry path as any other interior;
//   4. the flat is walkable, and leaving puts them back on the street;
//   5. the door is locked for a property the player does not live in.
//
// Run with the server up: `node test-home.mjs` (uses http://localhost:3000).

import { launchGamePage, frames as frameHelper } from './test-browser.mjs';

const BASE = process.env.NL_URL || 'http://localhost:3000';
const results = [];
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) { passed++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// Full Chromium, not the headless shell: the shell has no WebGL, so the 3D
// world never renders and the test would sit waiting for a canvas forever.
const { browser, page, hasWebGL } = await launchGamePage({ width: 1024, height: 640 });
if (!hasWebGL) {
  console.error('\nNo WebGL in this browser build — run: npx playwright-core install chromium\n');
  process.exit(2);
}

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const frames = (n) => frameHelper(page, n);

console.log(`\nNewLife — Go Home (${BASE})\n`);

await page.goto(BASE, { waitUntil: 'load' });

// ── Sign up a fresh player ──────────────────────────────────
await page.waitForSelector('#auth-username', { timeout: 120000 });
const name = `home${Math.random().toString(36).slice(2, 8)}`;
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

console.log('[A new player has nowhere to live]');
const initial = await page.evaluate(() => {
  const btn = document.querySelector('[data-action="home"]');
  return {
    exists: !!btn,
    label: btn?.querySelector('.action-label')?.textContent || '',
    disabled: btn?.classList.contains('disabled') || false,
    aria: btn?.getAttribute('aria-disabled'),
    title: btn?.title || '',
    hasToken: !!globalThis.__nl?.report,
  };
});
check('The Home button is on the action bar', initial.exists && initial.label === 'Home', initial.label);
check('It is visibly disabled while the player is homeless', initial.disabled === true && initial.aria === 'true');
check('The tooltip explains why', /no home yet/i.test(initial.title), initial.title);

const homeless = await page.evaluate(() => globalThis.__nl.goHome({ silent: false }));
check('Pressing it reports the situation instead of doing nothing',
  homeless.ok === false && homeless.why === 'no-home', JSON.stringify(homeless));

// ── Rent a home through the real panel ──────────────────────
console.log('\n[Renting the hostel bed through the Property panel]');
await page.click('[data-action="property"]');
await page.waitForSelector('.property-panel:not(.hidden)', { timeout: 20000 });
await page.waitForTimeout(1200);
const rentBtn = await page.$('[data-rent="hostel-bed"]');
check('The cheapest listing offers a Rent button', !!rentBtn);
if (rentBtn) await rentBtn.click();
// The purchase is a round trip; wait for the state rather than for a sleep.
// (A loaded machine can take a few seconds to answer, and a fixed sleep here
// made this test flaky in exactly the way a user would notice.)
const homed = await page
  .waitForFunction(() => !!globalThis.__nl?.propertyHome?.(), null, { timeout: 20000 })
  .catch(() => null);
if (!homed) {
  // One retry: the first click can land while the panel is still wiring up.
  const again = await page.$('[data-rent="hostel-bed"]');
  if (again) await again.click();
  await page.waitForFunction(() => !!globalThis.__nl?.propertyHome?.(), null, { timeout: 20000 }).catch(() => null);
}
await page.waitForTimeout(600);

const rented = await page.evaluate(() => ({
  panelError: document.querySelector('.prop-error, .prop-msg')?.textContent || '',
  toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '),
  home: globalThis.__nl?.propertyHome?.() ?? null,
  button: (() => {
    const btn = document.querySelector('[data-action="home"]');
    return {
      disabled: btn?.classList.contains('disabled'),
      title: btn?.title || '',
    };
  })(),
}));
check('The player now lives somewhere', !!rented.home,
  rented.home?.name || `no home — ${rented.panelError || rented.toasts || 'no message'}`);
check('The Home button comes alive', rented.button.disabled === false);
check('And names the destination', /Go home to/i.test(rented.button.title), rented.button.title);

await page.click('[data-action="property"]');    // close the panel
await page.waitForTimeout(500);

// ── Go home ─────────────────────────────────────────────────
console.log('\n[Go Home]');
await page.click('[data-action="home"]');
await page.waitForTimeout(2500);
await frames(10);

const atHome = await page.evaluate(() => {
  const nl = globalThis.__nl;
  return {
    inside: nl.interiors.isInside,
    activeId: nl.interiors.activeId,
    place: nl.report().place,
    pos: nl.report().position,
  };
});
check('The character is inside their own home', atHome.inside === true, atHome.activeId);
check('It is the interior for the listing they rent',
  atHome.activeId === 'in-prop-hostel-bed', atHome.activeId);

// Walk around the flat: the point of a home is that you can use it.
// Software WebGL renders at 1–2 FPS, so a fixed 900 ms hold can land inside a
// single frame and move nobody. Walk in frames instead, with a cap, and take
// the best distance from up to two attempts.
const before = await page.evaluate(() => ({ ...globalThis.__nl.report().position }));
let moved = 0;
for (let attempt = 0; attempt < 2 && moved <= 0.15; attempt++) {
  await page.keyboard.down('KeyW');
  await frames(12);
  await page.keyboard.up('KeyW');
  await frames(4);
  const after = await page.evaluate(() => ({ ...globalThis.__nl.report().position }));
  moved = Math.hypot(after.x - before.x, after.z - before.z);
}
check('The flat is walkable', moved > 0.15, `${moved.toFixed(2)} m`);

// ── The door is not a free-for-all ──────────────────────────
console.log('\n[Door permissions]');
await page.evaluate(() => globalThis.__nl.exitInterior());
await page.waitForTimeout(800);
const locked = await page.evaluate(() => {
  const nl = globalThis.__nl;
  const door = nl.interiors.doors.find((d) => d.propertyId === 'waterfront-mansion');
  if (!door) return { found: false };
  nl.avatar.position.set(door.x, 0, door.z);
  nl.interiors.nearbyDoor = door;
  const canEnter = nl.interiors.canEnterDoor(door);
  const opened = nl.interiors.interact();
  return { found: true, canEnter, opened, inside: nl.interiors.isInside };
});
check('A property the player does not rent has a door', locked.found === true);
check('It refuses entry', locked.canEnter === false && locked.opened === false);
check('And the player stays outside', locked.inside === false);

// Their own door, by contrast, opens.
const ownDoor = await page.evaluate(() => {
  const nl = globalThis.__nl;
  const door = nl.interiors.doors.find((d) => d.propertyId === 'hostel-bed');
  nl.avatar.position.set(door.x, 0, door.z);
  nl.interiors.nearbyDoor = door;
  const opened = nl.interiors.interact();
  return { opened, inside: nl.interiors.isInside, activeId: nl.interiors.activeId };
});
check('Their own front door opens', ownDoor.opened === true && ownDoor.inside === true, ownDoor.activeId);

// ── The home runs on something ──────────────────────────────
// A home you can live in needs a meter. This walks to the meter station, opens
// the cupboard through the real panel, and checks the readings are real and the
// top-up actually moves them.
console.log('\n[The meter cupboard]');
await page.evaluate(() => {
  const nl = globalThis.__nl;
  if (!nl.interiors.isInside) {
    const door = nl.interiors.doors.find((d) => d.propertyId === 'hostel-bed');
    nl.avatar.position.set(door.x, 0, door.z);
    nl.interiors.nearbyDoor = door;
    nl.interiors.interact();
  }
});
await page.waitForTimeout(900);

const meterStation = await page.evaluate(() => {
  const nl = globalThis.__nl;
  const st = (nl.stations() || []).find((s) => s.id === 'meter');
  if (!st) return null;
  nl.teleport(st.x, st.z);
  return st;
});
check('The home has a meter station', !!meterStation, meterStation ? meterStation.id : 'missing');

// Press E at the meter, and give the render loop room to notice: on software
// WebGL a frame can be a third of a second, so the prompt for the station may
// not exist yet when the key arrives. Retry once rather than flake.
async function openMeterCupboard() {
  for (let attempt = 0; attempt < 3; attempt++) {
    await frames(8);
    await page.keyboard.press('KeyE');
    for (let i = 0; i < 20; i++) {
      const open = await page.evaluate(() => !!document.querySelector('.venue-act[data-venue-act]'));
      if (open) break;
      await page.waitForTimeout(250);
    }
    const opened = await page.evaluate(() => {
      const action = document.querySelector('.venue-act[data-venue-act]');
      if (!action) return null;
      action.click();
      return true;
    });
    if (opened) break;
    await page.evaluate((id) => {
      const nl = globalThis.__nl;
      const st = (nl.stations() || []).find((x) => x.id === id);
      if (st) nl.teleport(st.x, st.z);
    }, 'meter');
  }
}
await openMeterCupboard();
for (let i = 0; i < 24 && !(await page.evaluate(() => globalThis.__nl.utilitiesPanel.open)); i++) {
  await page.waitForTimeout(250);
}
const cupboardOpened = await page.evaluate(() => ({
  panelOpen: globalThis.__nl.utilitiesPanel.open,
  station: globalThis.__nl.venuePanel.station?.id,
}));
await page.waitForTimeout(1200);
const readings = await page.evaluate(() => ({
  open: globalThis.__nl.utilitiesPanel.open,
  data: globalThis.__nl.utilitiesPanel.data,
  meters: [...document.querySelectorAll('.util-meter b')].map((b) => b.textContent),
  switches: document.querySelectorAll('.util-switch').length,
  hasTopUps: document.querySelectorAll('.util-buy').length,
}));
check('E at the meter opens the cupboard', cupboardOpened.station === 'meter' && readings.open === true);
check('The cupboard shows real readings', readings.meters.length === 3, readings.meters.join(' · '));
check('The readings are the server\u2019s numbers, not zeros',
  (readings.data?.powerKwh || 0) > 0 && (readings.data?.waterLitres || 0) > 0,
  `${readings.data?.powerKwh} kWh, ${readings.data?.waterLitres} L`);
check('There are appliances to switch', readings.switches >= 4, `${readings.switches} switches`);
check('There are top-ups to buy', readings.hasTopUps >= 3, `${readings.hasTopUps} bundles`);

const beforeTopUp = await page.evaluate(() => ({
  power: globalThis.__nl.utilitiesPanel.data?.powerKwh ?? null,
  cash: globalThis.__nl.utilitiesPanel.cash ?? null,
}));
await page.evaluate(() => document.querySelector('[data-util-topup]')?.click());
await page.waitForTimeout(2000);
const afterTopUp = await page.evaluate(() => ({
  power: globalThis.__nl.utilitiesPanel.data?.powerKwh ?? null,
  cash: globalThis.__nl.utilitiesPanel.cash,
  toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '),
}));
check('Topping up the meter adds units',
  typeof afterTopUp.power === 'number' && afterTopUp.power > beforeTopUp.power,
  `${beforeTopUp.power} → ${afterTopUp.power} kWh`);
check('And costs money',
  typeof afterTopUp.cash === 'number' && afterTopUp.cash < beforeTopUp.cash,
  `₦${beforeTopUp.cash} → ₦${afterTopUp.cash}`);
check('The top-up is confirmed on screen', /topped up/i.test(afterTopUp.toasts), afterTopUp.toasts.slice(-70));

// Switch something off and watch the daily load change.
// Flip the fridge and wait on the panel's own busy flag — the toggle is a
// round trip, and on software WebGL a guessed sleep is not long enough.
const toggled = await page.evaluate(async () => {
  const nl = globalThis.__nl;
  const before = nl.utilitiesPanel.data.dailyKwh;
  document.querySelector('[data-util-appliance="fridge"]')?.click();
  const started = Date.now();
  while (nl.utilitiesPanel.busy && Date.now() - started < 20000) {
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 300));
  return { before, after: nl.utilitiesPanel.data.dailyKwh, fridge: nl.utilitiesPanel.data.appliances.fridge };
});
check('Switching an appliance changes today\u2019s load',
  toggled.after !== toggled.before,
  `fridge ${toggled.fridge ? 'on' : 'off'}: ${toggled.before} → ${toggled.after} kWh/day`);
await page.evaluate(() => {
  const nl = globalThis.__nl;
  if (!nl.utilitiesPanel.data.appliances.fridge) document.querySelector('[data-util-appliance="fridge"]')?.click();
  nl.utilitiesPanel.hide();
});

// ── No console errors ───────────────────────────────────────
const realErrors = errors.filter((e) => !/favicon|WebGL|GL Driver/i.test(e));
check('No console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');

await browser.close();
process.exit(failed === 0 ? 0 : 1);
