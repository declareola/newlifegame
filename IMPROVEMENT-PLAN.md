# NewLife — what to do next to improve it massively

Written against the code as it stands today (62 client modules / 18.6k lines,
~4.5k lines of server, 38 HTTP routes, 5 SQLite tables, 15 client test suites +
one server integration suite, all green).

The plan is ordered by **impact per hour of work**, not by how impressive it
sounds. Every item says what it is, why it matters *for this game specifically*,
which files it touches, and how you will know it worked.

---

## 0. First: get eyes on it — ✅ DONE this round

*Status: `client/shots.mjs` exists, runs Chromium on software WebGL, drives the
real UI and writes PNGs + a JSON manifest. It found five bugs in the first
frame that no test in the project could see, including "every new character
spawns at the world origin" and "the game throws on page load".*
*Still open: nothing diffs the PNGs against a baseline yet — that is the next
half-day.*

## 0b. The original argument

**The single biggest problem with this project is not the code — it is that no
frame has ever been seen.** Every claim so far is geometry, state and flood-fill
maths. That is why the market shipped empty once already: nothing in the pipeline
could see an empty room.

What to do:

1. Add a screenshot harness: `npm i -D playwright`, then a script that boots the
   server, opens Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader`
   (software WebGL works headless), signs up, walks to a fixed list of POIs and
   writes PNGs to `screenshots/`.
2. Keep a `visual-baseline/` folder of those PNGs. Any round that changes the
   city or the avatar regenerates them and you *look* at the diff.
3. Add a "camera bookmark" debug key that teleports + aims the camera at each
   venue, so a shot is reproducible frame-for-frame.

**Definition of done:** `npm run shots` produces 12+ PNGs (street, market,
church, hospital, airport, bank, office, first-person view, creator, HUD,
night, rain) and they render.

Effort: 4–8 h. Value: it retro-actively validates every round so far and stops
the next "the room was empty" bug.

---

## Tier 1 — Feel: the five things players notice in the first 60 seconds

### 1.1 Audio (there is currently zero)
Grep the whole client: no `AudioContext`, no `<audio>`, nothing. A Lagos street
sim with no sound will always feel like a tech demo.

- **Footsteps** on 4 surfaces (asphalt, pavement, tile interior, wood floor),
  tempo tied to walk/sprint, with a small random pitch offset.
- **City ambience bed**: distant traffic, danfo horns (sparse, ~1 per 20 s),
  generator hum near shops, market chatter near the market, birds at dawn.
- **Interior reverb-ish change** — a cheap low-pass + gain change when inside.
- **UI**: click, panel open/close, need-warning, cash register, phone.
- **Positional audio** for NPC voices (one or two "barks" per role, recorded
  later — until then use the ambience bed so nothing is fake).
- All of it synthesised with WebAudio oscillators/noise buffers, or tiny
  generated WAVs — **no asset files required**, consistent with the
  primitives-only rule. One `AudioEngine` module with a master bus, a
  music/ambience/sfx split, and a mute toggle in the pause menu.

Files: new `client/src/audio/AudioEngine.js` (+ `surface.js` footstep synth),
hooks in `PlayerController`, `InteractionSystem`, `HUD`, `PauseMenu` (volume
sliders). Verify: a unit test that asserts every UI action emits exactly one
event and that mute persists; plus a "sound budget" check (never more than N
concurrent one-shots).

Effort: 2–3 days. **The biggest perceived-quality jump available.**

### 1.2 Character animation that is not a puppet
Avatars are primitives on a joint hierarchy animated by hand (`Avatar.js`,
948 lines). Today they idle-bob and swing arms. What reads as "cheap" is:

- no blending — the walk snap-starts and snap-stops,
- feet slide (no step-matching against speed),
- nothing to *do*: no sit, eat, sleep, work, dance, talk, wave, phone-call.

Do this:

- Keep primitives, add a tiny **pose system**: named poses (idle/walk/run/sit/
  sleep/eat/work/dance/phone/talk) as joint-angle tables, blended with a
  weighted sum over 150–250 ms. `Avatar.setPose(name, {blend})` already has a
  natural home next to `setLook`.
- **Step-match**: scale stride angle by actual speed, so feet stop sliding.
- **Sit on real furniture**: when the player interacts with a chair/pew/bed,
  the avatar sits *on it* rather than on the floor point. The venue props now
  know their own seat positions — publish seat anchors in the manifest.
- NPCs use the same poses (praying in the mosque, serving at the counter,
  typing in the office). That is how a room stops looking like a diorama.

Files: `player/Avatar.js` (poses + blend), `world/NPCSystem.js`,
`world/venueProps.js` (seat anchors), `interactions/InteractionSystem.js`
(sit/use).

Verify: a `test-animation.mjs` that samples every pose at 4 phases and asserts
(a) no joint exceeds its anatomical range, (b) feet stay within 2 cm of the
ground while walking at any speed, (c) blends settle to the target pose.

Effort: 4–6 days.

### 1.3 Weather + a real day/night cycle
`DayNight.js` exists; `atmosphere.js` exists. Push them:

- **Rain**: the defining Lagos weather. GPU-light approach: a cylinder of
  scrolling instanced streaks around the camera, wet-asphalt roughness drop,
  puddle patches in low ground, splash decals, thunder with a 0.4 s delay,
  and NPCs switching to run/umbrella poses. Rain also slows traffic and empties
  the market stalls — *weather that changes gameplay*, not just pixels.
- **Time-of-day gameplay**: shop shutters close at night, street lights and
  shop signs switch on (emissive + a couple of point lights per block, budget
  capped), the market is busiest at 09:00–17:00, the owambe/party district
  comes alive at 20:00. Jobs that only run at night (night bus, security).
- A **clock in the HUD** and a `/api/time` echo so the client and server agree
  on the hour — the needs decay already runs on the server, so time must not be
  client-local.

Files: `render/atmosphere.js`, `world/DayNight.js`, new `render/Weather.js`,
`server/src/gameLoop.js` (authoritative clock), `hud/HUD.js`.

Verify: a headless test that simulates 24 h of game time and asserts shutters,
lights, spawn tables and needs decay all change at the documented hours.

Effort: 3–5 days (rain) + 2 days (schedule).

### 1.4 Traffic and street life that responds to you
Traffic currently drives a loop. Make the street *react*:

- cars stop for the player and for each other at junctions (there is already a
  lane/junction model in `streetGrid.js` — add a stop-line check),
- horns when you stand in the road for > 2 s,
- danfos pull over and wait if you are near a bus stop, okada riders weave,
- parked cars get owners who walk up and drive off,
- a "traffic" skill/risk: driving badly raises police attention.

Files: `world/TrafficSystem.js`, `world/VehicleSystem.js`, `world/streetGrid.js`.

Effort: 2–3 days.

### 1.5 Camera and control juice
The camera was just rebuilt (first person, pointer lock, touch). Add the feel:

- FOV +8° while sprinting, tiny landing dip, small camera shake on a car crash,
- gamepad support (left stick move, right stick look) — same code path as touch,
- a proper **mobile layout**: thumbstick left, look-drag right, contextual action
  button that shows what `E` would do right now,
- rebindable keys with a settings panel that writes to localStorage.

Files: `player/PlayerController.js`, `hud/TouchControls.js`, new
`ui/SettingsPanel.js`.

Effort: 2–3 days.

---

## Tier 2 — Depth: turn systems into a game

### 2.1 Business ownership (the killer feature for a Lagos life sim)
You can take a job; you cannot *own the hustle*. This is the loop that makes the
economy interesting and it fits the existing server-authoritative economy:

1. Rent a stall (market already has 18 stalls, each with a position).
2. Stock it from suppliers (`itemConfig` already has wholesale/retail prices).
3. Set a price; NPC customers buy at a rate driven by price, stock and district
   footfall; the server ticks sales in `gameLoop` and credits cash.
4. Hire an NPC manager (daily wage, theft risk if you never visit), upgrade the
   stall → shop → supermarket → plaza.
5. Fail states: overpriced stock rots, staff steal, a fire shuts you down until
   you pay repairs — everything server-computed so it cannot be faked.

Files: new `config/businessConfig.js`, `server/src/business.js`, tables
`businesses`, `business_sales`; client `ui/BusinessPanel.js`, stall ownership
markers in `world/venueProps.js`.

Verify: extend `test-world.mjs` — buy a stall, stock it, fast-forward the loop,
assert cash rises by exactly the computed amount and that a client POST cannot
set its own price above the cap.

Effort: 5–7 days. **Highest gameplay value on the list.**

### 2.2 Jobs and missions with a hook
10 jobs / 9-ish missions are currently "press E, wait, get paid". Make three of
them *mini-games* that reuse the 3D world:

- **Danfo driver**: a route with stops and a time budget, passengers scored on
  smoothness (reuse the vehicle system + traffic).
- **Market trader**: haggling — a short haggling exchange with an NPC where the
  price depends on your charisma and the NPC's mood (dialogue UI exists).
- **Dispatch rider**: GPS-style delivery on the bike, with a map marker.
- Mission chains with a story: 5 acts, each gated on money/needs/skill, so a
  new player has a spine to follow for the first two hours.

Files: `jobs/JobBoard.js`, new `jobs/minigames/*`, `config/jobConfig.js`,
`config/missionConfig.js`, `server/src/gameLoop.js` for timers.

Effort: 4–6 days per minigame, so pick two.

### 2.3 Skills → consequences
`smarts / charisma / fitness` exist as numbers that barely do anything. Give each
three concrete effects (job pay multiplier, haggling margin, sprint stamina,
crime success, NPC reaction), train them by *doing* (study at school, preach at
the church? argue at the market) and show progress in the character panel.

Effort: 2 days.

### 2.4 Property that you furnish
You can buy/rent and move in; the interior is fixed and randomly furnished. Let
the player place furniture from a small catalogue (the 957-line `venueProps.js`
is *already* a furniture library — expose it). Drag on the floor grid, rotate,
save the arrangement server-side, price each item.

Files: `ui/FurnishPanel.js`, `server/src/worldRoutes.js` (save layout),
`world/InteriorBuilder.js` (apply a saved layout instead of a generated one).

Effort: 4 days. Big "this is my place" payoff.

---

## Tier 3 — Multiplayer that people return to

- **Presence inside interiors.** Today interiors are their own scene; you cannot
  see the other person in the bank with you. Broadcast an `interiorId` and show
  remote avatars there too — this alone makes the world feel populated.
- **Trading**: two players face to face, both confirm, server swaps items/cash
  atomically (idempotency key to stop double-spend).
- **Co-op jobs** and a shared "owambe" party event: hire a hall, invite players,
  music, dance poses, a cash gift mechanic.
- **Chat that fits**: local/global/DM channels, quick-chat wheel on mobile,
  profanity filter server-side, rate limit already exists.
- **Seasons**: 4-week leaderboards with resets and cosmetic rewards (no pay-to-win
  — it is a life sim about the hustle, not a shop).
- **Anti-cheat depth**: today the server clamps movement; move to full
  server-side *intent* handling for economy actions with replay-safe tokens.

Effort: presence 2 days, trading 3 days, parties 4 days.

---

## Tier 4 — Scale and correctness

- **Postgres + Redis** (documented as a known gap). Migrate `better-sqlite3` →
  `pg` behind a thin repository layer, keep SQLite for dev. Redis for session/
  presence/pub-sub so multiplayer can run on more than one node.
- **Save versioning**: a `schema_version` column and forward migrations; a save
  that cannot be migrated must fail loudly, never silently reset.
- **Reconnect and resync**: resume position, current activity, and open
  interactions after a dropped socket.
- **Idempotency** on every money-moving endpoint (`Idempotency-Key` header),
  because the contract is server-authoritative economy.
- **Load test**: 200 bots connecting/moving/chatting; measure tick time, broadcast
  bytes, and the 5 s game-loop budget. Publish the numbers in the README.
- **Observability**: structured logs already exist — add `/api/metrics` (tick
  duration, players, cash minted/burned per hour) so inflation is visible.

Effort: 1–2 weeks, mostly mechanical.

---

## Tier 5 — Performance and code health

- **Draw calls**: the city merges per district; interiors do not. Extend
  `mergeUtils.js` to merge static interior furniture per material, and use
  `InstancedMesh` for the repeated props (81 prayer mats, 50 school desks,
  20 pews, 18 stalls). Target: < 250 draw calls in any interior.
- **Frame budget HUD** (already have `DebugPanel`): show ms/frame split and the
  worst 1 % frame, so regressions are caught in game.
- **LOD**: buildings beyond 60 m drop to a single box with a baked colour.
- **CI**: run all 15 client suites + the server suite on every commit; add
  `tsc --checkJs` with JSDoc types on the server (it is the money code).
- **Dead-code sweep**: `main.js` is 1,064 lines and knows about everything;
  split it into `bootstrap/`, `systems/`, `wire/`.

Effort: 1 week, continuous.

---

## Tier 6 — Presentation

- **UI pass**: one type scale, one spacing scale, one border radius, dark/light,
  and a real pause menu with tabs. Right now panels are individually styled.
- **Onboarding polish**: the three-step creator is good; add a 60-second
  playable prologue (you wake up, pay rent, take a first job) instead of a
  text-only tutorial card.
- **Accessibility**: remappable keys, colourblind-safe need bars, text scaling,
  subtitles for barks, a reduce-motion toggle (no bob, no shake, no rain streak).
- **Localisation**: Nigerian English / Pidgin / Yorùbá / Igbo / Hausa. The
  dialogue strings are already centralised — this is a strings table, not a
  rewrite.
- **Photo mode**: freeze time, hide HUD, free camera, PNG export. Cheap, and it
  is free marketing for a game that looks better than its reputation.

---

## What I would actually do, in order

| # | Item | Effort | Why now |
|---|---|---|---|
| 1 | ~~Screenshot harness (software WebGL)~~ | ✅ done | Found 5 real bugs in the first frame |
| 2 | ~~Audio engine + footsteps + ambience~~ | ✅ done | `audio/AudioEngine.js` + `test-audio` |
| 3 | ~~Pose/blend animation~~ | ✅ partly | 13 poses + NPC jobs; sit-on-furniture still open |
| 4 | ~~Rain~~ (time-of-day gameplay still open) | ✅ partly | `render/Weather.js` + `test-polish` |
| 5 | Business ownership loop | 5–7 d | The feature that makes it a *life sim*, not a walking demo |
| 6 | Presence in interiors + trading | 5 d | Multiplayer stops being "ghosts in the street" |
| 7 | Two job minigames | 6 d | Gives the first two hours a spine |
| 8 | Instancing/LOD + CI + checkJs | 5 d | Keeps all of the above affordable |

**What not to do:** don't drop the primitives-only constraint to import models —
that is a different game and it breaks the "no external assets" rule that makes
this project honest; don't add a UI framework for 8 panels; don't rewrite the
renderer before you have a screenshot pipeline to tell you if it helped.

---

## The honest caveats

- No browser has ever rendered this game. Tier 0 (the screenshot harness) is not
  optional polish, it is the missing sense organ for the whole project.
- The multiplayer tests exercise one client at a time plus one watcher; there is
  no soak test with 20+ players.
- The economy has been verified arithmetically, not by playing a two-hour
  session — no human has ever played long enough to find the boring parts.
- Every number in this document about "what exists" was read from the code
  today; every number about effort is an estimate.
