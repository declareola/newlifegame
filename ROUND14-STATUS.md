# NewLife — session report

Server: live on **port 3000** (`./run.sh`, process `newlife-game-45244b6f`). `/` returns 200.

This report covers the four things you raised, plus what broke on the way and how it
was proven fixed. Everything below is implemented and tested — not planned.

---

## 1. "No token provided" — fixed at the root

**What was happening.** The game is served through the preview proxy, which does not
always pass custom request headers through to the server. The browser was sending
`Authorization: Bearer <token>`, the proxy dropped it, and the server answered
`401 No token provided` — so a player with ₦5,000,000 could not buy a bottle of water.
The socket kept working because Socket.IO carries its token *inside the handshake*,
not in a header, which is why you stayed connected while every purchase failed.

**What was done.**

- The server now accepts the session token over **four transports**, cheapest first
  (`server/src/auth.js` → `tokenFromRequest`):
  1. `Authorization: Bearer …`
  2. `X-Auth-Token: …`
  3. the **`nl_token` cookie** (HttpOnly, SameSite=Lax, Secure only over TLS) — set on
     sign-up and sign-in, cleared on logout. A proxy that strips headers cannot strip
     a cookie.
  4. `?token=…` as a last resort.
  Every token is still signature-, issuer- and revocation-checked, so this widens the
  delivery, not the security.
- The client has **one request path** (`client/src/auth/api.js` → `apiFetch`). It
  sends both headers, always carries cookies, and on a 401 whose body says exactly
  "No token provided" it retries once with the token in the query string. Any other
  401 is passed through untouched, so real authorisation errors still read as
  themselves.
- Errors are no longer swallowed: the catch used to replace every failure with
  "Cannot reach server". It now logs the real reason to the console.

**Proven by** `server/test-property-market.mjs` (cookie-only, `X-Auth-Token`-only,
`?token=`-only all authenticate; a forged cookie is still rejected) and
`client/test-property-ui.mjs`, which fails the run if **any** request in a full
session is refused for a missing token.

> While fixing this I broke the client temporarily (a leftover variable in the new
> request helper), which the browser test caught immediately as "cannot sign in".
> It is fixed; the suites below all run green.

---

## 2. The Property tab — listings, buying, owning several, selling and letting

**Before:** five fixed listings, you could buy or rent exactly one home, and there was
no market. **Now:**

- **Available properties are listed for sale**, with price, rent, deposit, sleep and
  comfort bonuses, and district — all from the server.
- **Buying works**, out of cash first and then the bank, atomically.
- **You can own more than one property.** Ownership is per title, not one-per-player:
  the panel has a **"Your properties"** section with a count, and each title offers
  *Live here*, *Sell*, *Let out*.
- **Listing for sale or for rent is player-to-player and real:**
  - `POST /api/properties/list` — you set the price (bounded: no ₦1 gifts, no absurd
    asks), the server checks you actually own the title outright.
  - `POST /api/properties/buy-listing` — another player pays your asking price, the
    money moves between your two accounts in one transaction, and the **title row
    moves from seller to buyer**. The seller is named on the listing.
  - `POST /api/properties/rent-listing` — a renter pays the deposit plus the first
    period to **you**, and the tenancy records you as landlord and the rent you
    asked. Every later period is paid to you by the game loop, not to the city.
  - `POST /api/properties/unlist` — withdraw it; withdrawing twice is refused rather
    than silently "succeeding".
- Owning several homes is now allowed for **rentals** too (it used to be one tenancy
  per player). Each tenancy pays its own rent.

**Proven by** `server/test-property-market.mjs` — **40/40** — including: buy two,
seller paid exactly the ask, buyer's cash down exactly the ask, title moved both ways,
landlord received deposit + first period, tenancy records landlord and rent.
And in a real browser by `client/test-property-ui.mjs` — **27/27** — two separate
players, two separate browsers: player A buys two homes, lists one at ₦200,000,
player B sees "ownery1082 · ₦200,000 to buy", clicks **Buy it**, and the money moves
on the server.

Screenshot: `client/screenshots/20-property-market.png`.

---

## 3. Day length — missions no longer outrun the clock

One in-game day was **8 real minutes**. That is 20 seconds per in-game hour: night fell
while you read a shop list, and any job that says "do this today" expired before you
could finish it.

It is now **60 real minutes per in-game day** — one in-game hour is 2.5 real minutes,
an evening is about a quarter of an hour, and the blueprint's thirty-day act is a
month of play rather than four hours. One constant
(`client/src/render/atmosphere.js` → `DAY_LENGTH_MS`) drives the clock, sun, sky and
HUD; nothing else hard-codes a day length. Measured live: **7.92 in-game minutes per
20 real seconds**, which is exactly the design.

---

## 4. Bugs found and fixed on the way (all verified)

| Bug | Consequence | Fix |
|---|---|---|
| **Players were pinned at x = −95** | The movement clamp still used the old 200 m city's half-extent. Every player walking west hit an invisible wall, so the marina, Victoria Island and most of Eko Basin were **unreachable**. | Clamp to the real `WORLD_BOUNDS` from the generated map. |
| **Crimes indoors raised nothing** | Inside a building the position is room-local, so it fell in no district and "neutral ground" meant a shoplifting spree left you spotless. | `districtForPlayer()` resolves the building behind the interior. |
| **Shoplifted items vanished** | The shop catalogue and the inventory catalogue were separate lists, so a lifted item had no inventory entry and was filtered straight back out. | Venue goods are registered in the inventory catalogue at load; shoplifting now pays in something real that can be used. |
| **Every purchasable home had its door in the lagoon** | `propertyConfig` still carried old-city coordinates and district names that no longer exist. | Placement is generated from the map (`PROPERTY_GEO` in `worldGeometry.js`); `test-geometry.mjs` fails if they ever disagree. |
| **Account-settings click and the wanted badge were dead** | The HUD root is `pointer-events: none`, and the clickable chips never opted back in, so the canvas ate the click. | Chips opt in. |
| **Stale coordinates in the test suites** | Several server tests walked to old-city points, failed with "too far", and looked like game bugs. | Tests read the generated anchors; walkers obey the server's own speed cap. |

---

## Test scores (all against the live server)

**Server — 11 suites, 0 failures:** step9 29 · step10 28 · step11 24 · hardening 37 ·
session-economy 44 · exploits (pass) · world 36 · utilities 34 · geometry 34 ·
wanted 31 · **property-market 40**.

**Client:** check-syntax 77 modules/0 · verify-world 10 · streets 56 · nav 13 ·
interiors 38 · UI 49 · **shoplift 15** · **wanted 26** · **home 26/26** (the three
long-standing electricity failures are gone — they were the movement bug) ·
**property 27**.

---

## What is *not* done yet — stated plainly

- **The blueprint's story content is not built**: Missions 1 & 2 (The Scaffolding
  Sprint), the Third Rail Run, the Bedrock Job, Grid State, Eko Metro lines and
  stations, story rooms and the eight origin paths. The existing eight "missions" are
  life-sim checklists, not blueprint chapters.
- **Banana Island has no district block on the map.** The waterfront mansion stands on
  Banana Island but is attributed to `marina`, because Banana Island has no district
  rectangle to live in. It is honest but not right; it needs a district.
- The vacant city is still the procedural Eko Basin, not yet the hand-modelled
  blueprint street-by-street map.
- Screenshots are taken in a software renderer at 1–2 FPS; that is the test rig, not
  the game on a real GPU.

**Next:** metro and boat travel between the four islands, then Grid State, then the
story missions from Part L of the blueprint.
