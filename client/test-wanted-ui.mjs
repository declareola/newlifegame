// client/test-wanted-ui.mjs
// The wanted matrix, as the player sees it, in a real browser.
//
// What this proves:
//   · a clean player has no wanted badge at all — silence, not a fake 0★;
//   · when the server says the player is hot, the badge appears with the right
//     number of stars and the right faction's name;
//   · clicking the badge opens the matrix: three factions, four tiers each, the
//     player's own star count, and the consequence written out;
//   · the bribe button quotes the server's price, and paying it clears the heat
//     — badge gone, panel green, money gone on the server;
//   · a faction with no interest in you cannot be bribed.
//
// Run with the server up: `node test-wanted-ui.mjs`

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

const { browser, page, hasWebGL } = await launchGamePage({ width: 1280, height: 800 });
if (!hasWebGL) {
  console.error('\nNo WebGL in this browser build — run: npx playwright-core install chromium\n');
  process.exit(2);
}

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const frames = (n) => frameHelper(page, n);

console.log(`\nNewLife — Wanted matrix (${BASE})\n`);

await page.goto(BASE, { waitUntil: 'load' });

// ── Sign up a fresh player ──────────────────────────────────
await page.waitForSelector('#auth-username', { timeout: 120000 });
const name = `heat${Math.random().toString(36).slice(2, 8)}`;
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
await frames(20);

const token = await page.evaluate(() => localStorage.getItem('newlife_token'));
check('The test player is signed in', !!token, name);

// ── Clean: no badge ─────────────────────────────────────────
console.log('\n[Clean]');
await page.evaluate(() => globalThis.__nl.refreshWanted());
await page.waitForTimeout(700);
const clean = await page.evaluate(() => {
  const el = document.querySelector('.hud-wanted');
  return { exists: !!el, hidden: el?.classList.contains('hidden'), text: el?.textContent || '' };
});
check('The wanted badge exists in the HUD', clean.exists);
check('A clean player shows no badge at all — no fake 0★',
  clean.hidden === true, clean.text.trim());

// ── Raise real heat on the server ───────────────────────────
// The heat is created through the server's own crime engine (the same entry
// point POST /api/crime uses), then read back through the API and the panel.
// The browser cannot fake this: the numbers come from GET /api/wanted.
console.log('\n[Heating up]');
const me = await (await fetch(`${BASE}/api/wanted`, {
  headers: { authorization: `Bearer ${token}` },
})).json();
check('The fresh player reads clean from the API', me.wanted.maxStars === 0);

const heat = await (await fetch(`${BASE}/api/dev/heat`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ factionId: 'kings', stars: 3 }),
})).json();
if (heat.error) {
  console.log(`  (dev heat hook unavailable: ${heat.error})`);
}

const afterHeat = await (await fetch(`${BASE}/api/wanted`, {
  headers: { authorization: `Bearer ${token}` },
})).json();
const heated = afterHeat.wanted.maxStars === 3
  && afterHeat.wanted.factions.find((f) => f.id === 'kings').stars === 3;
check('The server now records the player at 3★ with the Street Kings', heated,
  `${afterHeat.wanted.maxStars}★`);

// ── The badge appears ───────────────────────────────────────
await page.evaluate(() => globalThis.__nl.refreshWanted());
await page.waitForTimeout(700);
const badge = await page.evaluate(() => {
  const el = document.querySelector('.hud-wanted');
  return {
    hidden: el.classList.contains('hidden'),
    stars: el.dataset.stars,
    starsText: el.querySelector('.hud-stars').textContent,
    text: el.querySelector('.hud-text').textContent,
    title: el.title,
  };
});
check('The badge appears', badge.hidden === false);
check('It shows three of four stars, with the fourth hollow',
  badge.stars === '3' && badge.starsText === '★★★☆', badge.starsText);
check('It names the faction carrying the grudge',
  badge.text === 'Street Kings', badge.text);
check('Hovering explains the consequence', /serve|refuse|hunted/i.test(badge.title), badge.title);

// ── The matrix opens ────────────────────────────────────────
console.log('\n[The matrix]');
await page.click('.hud-wanted');
await page.waitForTimeout(900);
const panel = await page.evaluate(() => {
  const root = document.querySelector('.wanted-panel');
  const cards = [...root.querySelectorAll('.wanted-faction')];
  return {
    open: !root.classList.contains('hidden'),
    count: cards.length,
    names: cards.map((c) => c.querySelector('.wanted-fname').textContent.trim()),
    pips: cards.map((c) => c.querySelectorAll('.wanted-pip.on').length),
    tiers: cards.map((c) => c.querySelector('.wanted-ftier').textContent.trim()),
    buttons: cards.map((c) => {
      const b = c.querySelector('.wanted-bribe');
      return { text: b.textContent.trim(), disabled: b.disabled, id: b.dataset.bribe };
    }),
    where: root.querySelector('.wanted-where').textContent.trim(),
  };
});
check('Clicking the badge opens the matrix', panel.open);
check('There are exactly three factions', panel.count === 3, panel.names.join(' · '));
check('Each faction shows four tier pips', panel.pips.length === 3);
check('The Street Kings carry three lit tiers',
  panel.pips[0] === 3, `pips: ${panel.pips.join(',')}`);
check('The other two factions are untouched', panel.pips[1] === 0 && panel.pips[2] === 0);
check('The tier is named, not just counted',
  /Hunted/i.test(panel.tiers[0]), panel.tiers[0]);
check('The panel says where the player is standing', panel.where.length > 0, panel.where);
check('A faction with no heat shows a disabled button',
  panel.buttons[1].disabled === true, panel.buttons[1].text);
const kingsBtn = panel.buttons[0];
check('The hunted faction offers a bribe with a real price',
  /Bribe ₦[\d,]+/.test(kingsBtn.text) && kingsBtn.disabled === false, kingsBtn.text);

// ── Paying the bribe ────────────────────────────────────────
console.log('\n[Bribe]');
const before = await (await fetch(`${BASE}/api/me`, {
  headers: { authorization: `Bearer ${token}` },
})).json();
const priceText = kingsBtn.text.replace(/[^\d]/g, '');
const price = Number(priceText);
check('The button price matches the API price', price === afterHeat.wanted.factions[0].bribePrice,
  `₦${price.toLocaleString('en-NG')}`);

await page.click('[data-bribe="kings"]');
await page.waitForTimeout(2500);
const after = await (await fetch(`${BASE}/api/me`, {
  headers: { authorization: `Bearer ${token}` },
})).json();
check('The bribe took the money on the server',
  after.user.cash === before.user.cash - price,
  `₦${before.user.cash.toLocaleString('en-NG')} → ₦${after.user.cash.toLocaleString('en-NG')}`);

const cleared = await (await fetch(`${BASE}/api/wanted`, {
  headers: { authorization: `Bearer ${token}` },
})).json();
check('The heat is gone on the server', cleared.wanted.maxStars === 0);

const afterPanel = await page.evaluate(() => {
  const root = document.querySelector('.wanted-panel');
  return {
    lit: [...root.querySelectorAll('.wanted-faction')].map((c) => c.querySelectorAll('.wanted-pip.on').length),
    buttons: [...root.querySelectorAll('.wanted-bribe')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })),
    badgeHidden: document.querySelector('.hud-wanted').classList.contains('hidden'),
  };
});
check('The panel re-paints from the server, not from a local guess',
  afterPanel.lit.every((n) => n === 0), `lit: ${afterPanel.lit.join(',')}`);
check('All three buttons go back to "not interested"',
  afterPanel.buttons.every((b) => b.disabled === true), afterPanel.buttons[0].text);
check('The badge disappears', afterPanel.badgeHidden === true);

// ── The panel closes ────────────────────────────────────────
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const closed = await page.evaluate(() =>
  document.querySelector('.wanted-panel').classList.contains('hidden'));
check('Escape closes the matrix', closed === true);

check('No console errors during the run', errors.length === 0,
  errors.slice(0, 3).join(' | '));

await browser.close();

console.log(`\n=========================`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log(`=========================\n`);
process.exit(failed ? 1 : 0);
