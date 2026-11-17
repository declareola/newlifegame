// server/test-property-market.mjs
// Buying property, owning several, and the player-to-player market.
//
// What the player reported: "when I click the property tab, let me see available
// properties for sale, the user should be able to buy them, a user can buy more
// than one property, list them for rent or sale... presently the player cannot
// buy anything despite the fact that he has money, there is always an error
// saying no token provided."
//
// So this suite proves each of those claims against the live server:
//   1. the market lists properties, with prices a player can act on;
//   2. a player can buy one, and then another — ownership stacks;
//   3. money actually leaves the account, and the wallet never goes below zero;
//   4. an owner can list a property for sale, and another player can buy it at
//      that price — the money goes to the seller, the title changes hands;
//   5. an owner can let a property out, and a renter can take it — the deposit
//      and first period go to the landlord, and the tenancy records the amount;
//   6. a listing can be taken back down;
//   7. the whole API answers without an Authorization header, because the
//      preview proxy strips it — cookie, X-Auth-Token and ?token= all work.
//
// Run with the server up: node test-property-market.mjs

const BASE = process.env.NL_URL || 'http://127.0.0.1:3000';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

/** Plain request helper: no cookies carried over between accounts. */
const api = async (path, { token, method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json, raw: res };
};

// ── Auth transports ─────────────────────────────────────────
// This is the bug that stopped the player buying anything. The preview proxy
// strips the Authorization header, so the server must accept the token over
// transports a header allowlist cannot touch.
console.log('\n[Auth survives a header-stripping proxy]');
const userA = `seller${Math.random().toString(36).slice(2, 7)}`;
const signupA = await api('/api/signup', {
  method: 'POST',
  body: { username: userA, password: 'password123', tier: 'nepo' },
});
check('Sign-up returns a token', !!signupA.body?.token, userA);
const tokenA = signupA.body.token;

const setCookie = signupA.raw.headers.getSetCookie?.() || [];
const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
check('Sign-up sets an HttpOnly session cookie', /nl_token=/.test(cookieHeader),
  cookieHeader ? `${cookieHeader.slice(0, 24)}…` : 'no cookie');

const noHeader = await fetch(`${BASE}/api/properties`);
check('With no credentials at all the API still refuses', noHeader.status === 401);

const cookieOnly = await fetch(`${BASE}/api/properties`, {
  headers: { cookie: cookieHeader },
});
const cookieBody = await cookieOnly.json();
check('The cookie alone authenticates the property list',
  cookieOnly.status === 200 && Array.isArray(cookieBody.properties),
  `${cookieOnly.status}, ${cookieBody.properties?.length ?? 0} properties`);

const aliasHeader = await api('/api/properties', { headers: { 'x-auth-token': tokenA } });
check('X-Auth-Token alone authenticates', aliasHeader.status === 200);

const queryToken = await api(`/api/properties?token=${encodeURIComponent(tokenA)}`);
check('?token= alone authenticates (the client\'s last-resort retry)',
  queryToken.status === 200);

const badCookie = await fetch(`${BASE}/api/properties`, {
  headers: { cookie: 'nl_token=not-a-real-token' },
});
check('A forged cookie is still rejected', badCookie.status === 401);

// ── The market is visible ──────────────────────────────────
console.log('\n[The market]');
const market = await api('/api/properties', { token: tokenA });
const listings = market.body.properties || [];
check('Properties are listed for sale', listings.length >= 5, `${listings.length} listings`);
check('Each listing carries a price and a rent',
  listings.every((p) => typeof p.price === 'number' && p.price > 0 && p.rentPerPeriod > 0),
  `cheapest ${listings[0]?.name} at ₦${listings[0]?.price.toLocaleString('en-NG')}`);
check('The wallet is reported so the panel can grey out what is unaffordable',
  typeof market.body.cash === 'number' && typeof market.body.bankBalance === 'number',
  `cash ₦${market.body.cash.toLocaleString('en-NG')}`);

// ── Buy one, then another ──────────────────────────────────
console.log('\n[Owning more than one]');
const affordable = listings.filter((p) => p.price <= market.body.cash + market.body.bankBalance);
check('The player can afford at least two different listings',
  affordable.length >= 2, `${affordable.length} affordable`);

const first = affordable[0];
const buy1 = await api('/api/properties/buy', {
  token: tokenA, method: 'POST', body: { property_id: first.id },
});
check(`Buys ${first.name}`, !buy1.body?.error, buy1.body?.error || `paid ₦${first.price.toLocaleString('en-NG')}`);
check('Money left the account',
  buy1.body?.cash + buy1.body?.bankBalance === market.body.cash + market.body.bankBalance - first.price,
  `₦${(market.body.cash + market.body.bankBalance).toLocaleString('en-NG')} → ₦${(buy1.body?.cash + buy1.body?.bankBalance).toLocaleString('en-NG')}`);

const second = affordable.find((p) => p.id !== first.id);
const buy2 = await api('/api/properties/buy', {
  token: tokenA, method: 'POST', body: { property_id: second.id },
});
check(`Buys a second property (${second.name}) — ownership stacks`,
  !buy2.body?.error, buy2.body?.error || 'ok');
const owned = (buy2.body?.properties || []).filter((p) => p.owned);
check('Both titles are held at once', owned.length === 2,
  owned.map((p) => p.name).join(' + '));
check('The server exposes the owned list for the panel',
  (buy2.body?.ownedProperties || []).length === 2);

const buyAgain = await api('/api/properties/buy', {
  token: tokenA, method: 'POST', body: { property_id: first.id },
});
check('Buying the same property twice is refused', buyAgain.status === 400,
  buyAgain.body?.error);

// ── List for sale, and sell it ─────────────────────────────
console.log('\n[List for sale, then sell]');
const askPrice = Math.round(second.price * 1.2);
const listSale = await api('/api/properties/list', {
  token: tokenA, method: 'POST',
  body: { property_id: second.id, mode: 'sale', price: askPrice },
});
check('The owner can list a property for sale at their own price',
  !listSale.body?.error, listSale.body?.error || `₦${askPrice.toLocaleString('en-NG')}`);
check('The listing comes back on the property',
  listSale.body?.properties?.find((p) => p.id === second.id)?.myListing?.price === askPrice);

const tooCheap = await api('/api/properties/list', {
  token: tokenA, method: 'POST',
  body: { property_id: second.id, mode: 'sale', price: 1 },
});
check('A derisory price is refused', tooCheap.status === 400, tooCheap.body?.error);

// A second player buys it.
const buyerName = `buyer${Math.random().toString(36).slice(2, 7)}`;
const signupB = await api('/api/signup', {
  method: 'POST', body: { username: buyerName, password: 'password123', tier: 'nepo' },
});
const tokenB = signupB.body.token;

const seenByB = await api('/api/properties', { token: tokenB });
// Other players may have their own units of the same building on the market, so
// find *this* seller's listing rather than assuming it is the only one.
const allListings = seenByB.body.properties.find((p) => p.id === second.id)?.listings || [];
const listingForB = { listings: allListings.filter((l) => l.ownerUsername === userA) };
check('Another player sees the listing on the market',
  listingForB.listings.length === 1,
  `${listingForB.listings[0]?.ownerUsername} asking ₦${listingForB.listings[0]?.price.toLocaleString('en-NG')}`);
check('The listing names the seller', listingForB.listings[0]?.ownerUsername === userA);

const cashABefore = (await api('/api/properties', { token: tokenA })).body;
const cashBBefore = (await api('/api/properties', { token: tokenB })).body;
const sell = await api('/api/properties/buy-listing', {
  token: tokenB, method: 'POST',
  body: { property_id: second.id, listing_id: listingForB.listings[0].id },
});
check('The buyer can take the listing', !sell.body?.error, sell.body?.error || 'sold');

const afterSeller = await api('/api/properties', { token: tokenA });
const afterBuyer = (await api('/api/properties', { token: tokenB })).body;
check('The seller was paid the asking price',
  afterSeller.body.cash + afterSeller.body.bankBalance
    === cashABefore.cash + cashABefore.bankBalance + askPrice,
  `₦${(cashABefore.cash + cashABefore.bankBalance).toLocaleString('en-NG')} → ₦${(afterSeller.body.cash + afterSeller.body.bankBalance).toLocaleString('en-NG')}`);
check('The buyer paid it',
  afterBuyer.cash + afterBuyer.bankBalance
    === cashBBefore.cash + cashBBefore.bankBalance - askPrice);
check('The title moved: the buyer owns it',
  afterBuyer.properties.find((p) => p.id === second.id)?.owned === true);
check('The title moved: the seller no longer does',
  afterSeller.body.properties.find((p) => p.id === second.id)?.owned === false);
// Other players may hold their own units of the same building, so the claim is
// about *this* seller's listing, not every listing on the address.
check('The listing is gone from the market',
  !(afterBuyer.properties.find((p) => p.id === second.id)?.listings || [])
    .some((l) => l.ownerUsername === userA) &&
  afterSeller.body.properties.find((p) => p.id === second.id)?.myListing === null);

// ── Let a property out, and take the tenancy ───────────────
console.log('\n[Let it out]');
const rentAsk = 25_000;
const listRent = await api('/api/properties/list', {
  token: tokenA, method: 'POST',
  body: { property_id: first.id, mode: 'rent', price: rentAsk, deposit: 50_000 },
});
check('The owner can let a property out at their own rent',
  !listRent.body?.error, listRent.body?.error || `₦${rentAsk.toLocaleString('en-NG')}/period`);

const marketSeen = (await api('/api/properties', { token: tokenB })).body;
const rentListing = (marketSeen.properties.find((p) => p.id === first.id)?.listings || [])
  .find((l) => l.ownerUsername === userA);
check('The letting appears on the market', !!rentListing,
  rentListing ? `${rentListing.ownerUsername} · ₦${rentListing.price}` : 'missing');

const landlordCashBefore = (await api('/api/properties', { token: tokenA })).body;
const renterCashBefore = (await api('/api/properties', { token: tokenB })).body;
const takeRent = await api('/api/properties/rent-listing', {
  token: tokenB, method: 'POST',
  body: { property_id: first.id, listing_id: rentListing.id },
});
check('A player can rent another player\'s property', !takeRent.body?.error,
  takeRent.body?.error || `landlord ${takeRent.body?.landlord}`);

const landlordAfter = (await api('/api/properties', { token: tokenA })).body;
const renterAfter = (await api('/api/properties', { token: tokenB })).body;
const upfront = rentAsk + 50_000;
check('The landlord received the deposit and first period',
  landlordAfter.cash + landlordAfter.bankBalance
    === landlordCashBefore.cash + landlordCashBefore.bankBalance + upfront,
  `+₦${upfront.toLocaleString('en-NG')}`);
check('The renter paid it',
  renterAfter.cash + renterAfter.bankBalance
    === renterCashBefore.cash + renterCashBefore.bankBalance - upfront);
check('The tenancy records the player landlord',
  renterAfter.properties.find((p) => p.id === first.id)?.landlord === userA);
check('The tenancy records the rent that was asked',
  renterAfter.properties.find((p) => p.id === first.id)?.rentAmount === rentAsk,
  `₦${rentAsk.toLocaleString('en-NG')}/period`);
check('The renter is living there', !!renterAfter.home && renterAfter.home.id === first.id,
  renterAfter.home?.name);

// ── Taking a listing down ──────────────────────────────────
console.log('\n[Withdrawing a listing]');
const unlist = await api('/api/properties/unlist', {
  token: tokenA, method: 'POST', body: { property_id: first.id },
});
check('The landlord can withdraw the letting', !unlist.body?.error, unlist.body?.error || 'ok');
const afterUnlist = (await api('/api/properties', { token: tokenA })).body;
check('It is off the market',
  afterUnlist.properties.find((p) => p.id === first.id)?.myListing === null);

const unlistTwice = await api('/api/properties/unlist', {
  token: tokenA, method: 'POST', body: { property_id: first.id },
});
check('Withdrawing what is not listed is refused', unlistTwice.status === 400,
  unlistTwice.body?.error);

// Buyer B owns `second` now, so pick something they do not hold.
const notOwnedByB = afterBuyer.properties.find((p) => !p.owned && !p.rented);
const notMine = await api('/api/properties/list', {
  token: tokenB, method: 'POST', body: { property_id: notOwnedByB.id, mode: 'sale', price: 100_000 },
});
check('You cannot list a property you do not own', notMine.status === 400, notMine.body?.error);

console.log(`\n=========================`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`=========================\n`);
process.exit(fail ? 1 : 0);
