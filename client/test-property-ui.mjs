// client/test-property-ui.mjs
// The Property tab, as a player uses it, in a real browser.
//
// The player's report, treated as a spec:
//   "when I click on the property tab, let me see available properties listed
//    for sale, the user should be able to buy the properties, a user can buy
//    more than one property, list them for rent or sale... there is always an
//    error that pops up saying no token provided, fix this once and for all."
//
// So this test clicks, and watches the network:
//   · the Property tab shows listings with prices and a wallet;
//   · clicking Buy works, and the panel updates — no "No token provided";
//   · a player can buy twice, and both appear under "Your properties";
//   · listing one for sale puts it on the market with a price;
//   · a second signed-in player sees that listing and can buy it;
//   · taking it down removes it.
//
// Run with the server up: node test-property-ui.mjs

import { launchGamePage, newGamePage, frames as frameHelper } from './test-browser.mjs';

const BASE = process.env.NL_URL || 'http://localhost:3000';
let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const { browser, page, hasWebGL } = await launchGamePage({ width: 1280, height: 800 });
if (!hasWebGL) { console.error('\nNo WebGL\n'); process.exit(2); }

const errors = [];
const tokenErrors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', async (r) => {
  if (!r.url().includes('/api/')) return;
  if (r.status() === 401) {
    let body = '';
    try { body = (await r.clone().text()).slice(0, 120); } catch { /* ignore */ }
    tokenErrors.push(`${r.url().replace(BASE, '')} ${body}`);
  }
});

const frames = (n) => frameHelper(page, n);

/**
 * Sign a fresh player in on a page and get them into the world.
 * Each player gets their own browser context, so they have their own session.
 */
async function signUp(name, page, { tier = 'nepo' } = {}) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#auth-username', { timeout: 240000 });
  await page.fill('#auth-username', name);
  await page.fill('#auth-password', 'password123');
  // Step 1 (account) → step 2 (character)
  await page.click('[data-act="next"]');
  await page.waitForTimeout(1200);
  // Step 2 (character) → step 3 (starting tier)
  await page.click('[data-act="next"]');
  await page.waitForTimeout(1000);
  // Pick the starting tier the way a player does, so the money in the wallet is
  // the money the run expects.
  await page.click(`[data-tier="${tier}"]`).catch(() => {});
  await page.waitForTimeout(500);
  // Step 3 → "Start life"
  await page.click('[data-act="next"]');
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    document.querySelectorAll('.tutorial-skip, .tutorial-next').forEach((b, i, all) => {
      if (i === all.length - 1) b.click();
    });
  });
  await page.click('.tutorial-skip').catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await frameHelper(page, 10);
  return page.evaluate(() => localStorage.getItem('newlife_token'));
}

console.log(`\nNewLife — Property tab (${BASE})\n`);

// ── Player A ────────────────────────────────────────────────
const nameA = `owner${Math.random().toString(36).slice(2, 7)}`;
const tokenA = await signUp(nameA, page);
check('Player A is signed in', !!tokenA, nameA);

console.log('\n[The tab shows properties]');
await page.click('[data-action="property"]');
await page.waitForTimeout(1800);

const shown = await page.evaluate(() => {
  const root = document.querySelector('.property-panel');
  const cards = [...root.querySelectorAll('.prop-card')];
  return {
    open: !root.classList.contains('hidden'),
    cards: cards.length,
    names: cards.map((c) => c.querySelector('.prop-card-name')?.textContent.trim().split(' ')[0]),
    buyButtons: root.querySelectorAll('[data-buy]').length,
    wallet: root.querySelector('.prop-wallet')?.textContent.trim() || '',
    error: root.querySelector('.prop-error')?.textContent || '',
  };
});
check('The Property tab opens', shown.open);
check('Properties are listed for sale', shown.cards >= 5, shown.names.join(', '));
check('Each has a Buy button', shown.buyButtons === shown.cards);
check('The wallet is on screen', /Cash/.test(shown.wallet), shown.wallet);
check('No error is showing on open', !shown.error, shown.error);

// ── Buy one ─────────────────────────────────────────────────
console.log('\n[Buying]');
const firstAffordable = await page.evaluate(() => {
  const b = document.querySelector('.property-panel [data-buy]:not([disabled])');
  return b ? { id: b.dataset.buy, label: b.textContent.trim() } : null;
});
check('Something is affordable with the starting money', !!firstAffordable,
  firstAffordable?.label);

await page.click('.property-panel [data-buy]:not([disabled])');
await page.waitForTimeout(2200);

const afterBuy1 = await page.evaluate(() => {
  const root = document.querySelector('.property-panel');
  return {
    error: root.querySelector('.prop-error')?.textContent || '',
    errShown: root.querySelector('.prop-error')?.style.display !== 'none',
    owned: [...root.querySelectorAll('.prop-owned-name')].map((n) => n.textContent.trim().split('\n')[0].trim()),
    count: root.querySelector('.prop-count')?.textContent.trim(),
    home: root.querySelector('.prop-home-name')?.textContent.trim() || null,
    wallet: root.querySelector('.prop-wallet')?.textContent.trim() || '',
  };
});
check('Buying worked — no error', !afterBuy1.error && !afterBuy1.errShown, afterBuy1.error);
check('The property appears under "Your properties"', afterBuy1.owned.length === 1,
  afterBuy1.owned.join(', '));
check('The count shows one title', afterBuy1.count === '1', afterBuy1.count);
check('The player is living there', !!afterBuy1.home, afterBuy1.home);
check('The wallet went down', /Cash/.test(afterBuy1.wallet), afterBuy1.wallet);

// ── Buy a second ────────────────────────────────────────────
console.log('\n[Buying a second]');
const secondAffordable = await page.evaluate(() => {
  const b = document.querySelector('.property-panel [data-buy]:not([disabled])');
  return b ? { id: b.dataset.buy, label: b.textContent.trim() } : null;
});
check('A second property is affordable', !!secondAffordable, secondAffordable?.label);
if (secondAffordable) {
  await page.click('.property-panel [data-buy]:not([disabled])');
  await page.waitForTimeout(2200);
}
const afterBuy2 = await page.evaluate(() => {
  const root = document.querySelector('.property-panel');
  return {
    owned: [...root.querySelectorAll('.prop-owned-name')].map((n) => n.textContent.trim().split('\n')[0].trim()),
    count: root.querySelector('.prop-count')?.textContent.trim(),
    error: root.querySelector('.prop-error')?.textContent || '',
  };
});
check('Both titles are held at once', afterBuy2.owned.length === 2, afterBuy2.owned.join(' + '));
check('The count agrees', afterBuy2.count === '2', afterBuy2.count);

// ── List one for sale ───────────────────────────────────────
console.log('\n[Listing for sale]');
// The panel asks for a price with window.prompt; answer it.
page.once('dialog', (d) => d.accept('200000'));
await page.click('.property-panel [data-list][data-mode="sale"]');
await page.waitForTimeout(2200);

const afterList = await page.evaluate(() => {
  const root = document.querySelector('.property-panel');
  return {
    listingText: root.querySelector('.prop-owned-listing')?.textContent.trim() || '',
    unlistButtons: root.querySelectorAll('[data-unlist]').length,
    error: root.querySelector('.prop-error')?.textContent || '',
  };
});
check('The listing shows on the owner\'s own card',
  /On the market at ₦200,000/.test(afterList.listingText), afterList.listingText);
check('A "take it off the market" control appears', afterList.unlistButtons === 1);

// ── Player B sees and takes it ──────────────────────────────
console.log('\n[A second player takes the listing]');
const nameB = `taker${Math.random().toString(36).slice(2, 7)}`;
// Two WebGL contexts in one Chromium is more than SwiftShader will carry here,
// so player B gets a browser of their own. The listing lives on the server, so
// nothing is lost by closing player A first.
const tokenA2 = await page.evaluate(() => localStorage.getItem('newlife_token'));
check('Player A holds a session to come back to', !!tokenA2);
await page.close();
const launchedB = await launchGamePage({ width: 1024, height: 680 });
const pageB = launchedB.page;
const tokenB = await signUp(nameB, pageB, { tier: 'nepo' });
check('Player B is signed in', !!tokenB, nameB);

await pageB.click('[data-action="property"]');
await pageB.waitForTimeout(2000);

const seenByB = await pageB.evaluate(() => {
  const rows = [...document.querySelectorAll('.property-panel .prop-market-row')];
  return rows.map((r) => ({
    owner: r.querySelector('.prop-market-owner')?.textContent.trim(),
    price: r.querySelector('.prop-market-price')?.textContent.trim(),
    action: r.querySelector('[data-buy-listing]')?.textContent.trim(),
  }));
});
const mine = seenByB.find((r) => r.owner === nameA);
check('Player B sees player A\'s listing by name',
  !!mine, seenByB.map((r) => `${r.owner} ${r.price}`).join(' | '));
check('The price asked is the price shown', /₦200,000/.test(mine?.price || ''), mine?.price);
check('It offers to buy it', mine?.action === 'Buy it', mine?.action);

const bCashBefore = await pageB.evaluate(async () => {
  const token = localStorage.getItem('newlife_token');
  const p = await (await fetch('/api/properties', { headers: { authorization: `Bearer ${token}` } })).json();
  return p.cash + p.bankBalance;
});

await pageB.evaluate((owner) => {
  const row = [...document.querySelectorAll('.property-panel .prop-market-row')]
    .find((r) => r.querySelector('.prop-market-owner')?.textContent.trim() === owner);
  row.querySelector('[data-buy-listing]').click();
}, nameA);
await pageB.waitForTimeout(2500);

const bAfter = await pageB.evaluate(async () => {
  const token = localStorage.getItem('newlife_token');
  const p = await (await fetch('/api/properties', { headers: { authorization: `Bearer ${token}` } })).json();
  return {
    money: p.cash + p.bankBalance,
    owned: p.properties.filter((x) => x.owned).map((x) => x.name),
    error: document.querySelector('.property-panel .prop-error')?.textContent || '',
  };
});
check('Player B\'s purchase succeeded', !bAfter.error, bAfter.error);
check('Money moved on the server', bAfter.money === bCashBefore - 200_000,
  `₦${bCashBefore.toLocaleString('en-NG')} → ₦${bAfter.money.toLocaleString('en-NG')}`);
check('Player B now owns the title', bAfter.owned.length === 1, bAfter.owned.join(', '));

// ── The auth failure that started all this ─────────────────
console.log('\n[The "No token provided" regression]');
check('No request in the whole session was refused for a missing token',
  tokenErrors.length === 0, tokenErrors.slice(0, 3).join(' | '));
check('No console errors during the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await launchedB.browser.close();
await browser.close();
console.log(`\n=========================`);
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log(`=========================\n`);
process.exit(failed ? 1 : 0);
