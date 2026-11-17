# NewLife — 3D Multiplayer Life-Sim (Lagos)

A 3D multiplayer life-sim browser game set in Lagos, Nigeria.

## Backups — "nothing is to be lost"

Two scripts at the top of the repo:

```bash
./backup.sh                                  # → backups/newlife-<stamp>.tar.gz
./restore.sh <archive> --verify-only         # prove it is intact, change nothing
./restore.sh <archive>                       # restore in place
./restore.sh <archive> --into /tmp/elsewhere # restore to a clean directory
```

### What is in a backup

Everything that cannot be regenerated: all source, `server/.env`, the SQLite
database, the downloaded CC0 assets, the screenshots, and `MANIFEST.txt` with a
sha256 of every single file.

`node_modules/`, `client/dist/` and the npm cache are excluded, because
`preview.sh` rebuilds them from `package.json` in about 15 seconds.

### The database rule that matters

The game runs SQLite in **WAL mode**. At the time this was written the main
`newlife.db` was 143 KB while `newlife.db-wal` beside it held 4.1 MB — roughly
97% of the data was in the WAL. Copying `newlife.db` on its own, the obvious
thing to do, would have silently rolled the game back in time.

So the backup uses SQLite's own online backup API
(`server/tools/db-snapshot.mjs`), which takes a consistent snapshot including
the WAL without stopping the server, then runs `PRAGMA integrity_check` on the
copy and compares row counts against the live database. If that check fails,
the backup fails loudly rather than producing a file that looks fine.

### A restore verifies before it touches anything

`restore.sh` checks every sha256 first and refuses on any mismatch. It then
opens the database from inside the archive and runs an integrity check. Only
after both pass does it write anything. In-place restores also stop the running
server first and keep the current database as
`newlife.db.pre-restore.<timestamp>`.

### Proven, not assumed

The whole loop was tested end to end:

1. created a player on the live server with a known password
2. took a backup
3. restored it into a clean directory
4. built and started that restored copy on another port
5. **logged in as that player on the restored server** — 250 other accounts,
   27 homes, 42 vehicles, 41 missions and all utility readings came with it
6. restored in place over the live workspace and confirmed it still runs

Testing the restore is what found two real bugs in the first version: the
archive was missing `client/index.html` and `vite.config.js` (so a restored copy
would not build), and a restore scattered `BACKUP-INFO.txt` into the workspace,
which made every later archive fail checksum verification. The copy step is now
an exclusion list rather than a whitelist, so a file added later is backed up
without anyone remembering to add it.

### Retention and the one thing you have to do

`./backup.sh` keeps the last **2** archives (~36 MB each) and warns if the
folder passes 90 MB. That limit is deliberate: the workspace snapshot that
persists this sandbox is capped near 128 MB, so ten archives would push the
workspace over the cap and endanger *everything*, including the source.

**A backup on the same disk is not a backup.** Download one to your own machine.
`./backup.sh --slim` leaves out the screenshots and produces a ~17 MB archive if
you only want the code and the database.

## Prerequisites

- **Node.js 18+** and **npm**

---

## Setup

The fastest path — one command that installs what is missing, builds the client
and serves the whole game on port 3000:

```bash
./run.sh                    # installs deps, builds, starts
./run.sh --rebuild          # force a fresh client build
NL_TEST_HOOKS=1 ./run.sh    # + the local test seams the browser suites use
```

Real CC0 assets (skies, textures, models) are fetched rather than committed
(`client/.gitignore` excludes `public/assets/`), so a fresh clone looks flatter
until you run:

```bash
bash client/fetch-assets.sh  # idempotent; skips what is already on disk
```

Every loader falls back to procedural geometry, so the game runs without them —
it just looks less like Lagos. See `client/ASSET-CREDITS.md`.

### 1. Server

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

The server runs on `http://localhost:3000`.

- Health check: open `http://localhost:3000/api/health` — you should see `{"ok":true}`.
- **The first run generates a strong random `JWT_SECRET` and writes it into
  `server/.env`.** You'll see `🔐 Generated a new random JWT_SECRET…`.
  To rotate it manually use `npm run gen-secret` (this invalidates all sessions).
- In production (`NODE_ENV=production`) the server **refuses to start** if
  `JWT_SECRET` is missing, shorter than 32 characters, or still a placeholder.

Run the test suite (server must be running):

```bash
cd server
npm test              # 161 functional checks + the red-team suite
npm run test:redteam  # just the attack suite
```

The red-team suite (`test-exploits.mjs`) actively tries to cheat the game and
exfiltrate data — teleporting to shops, opening 25 sockets, flooding the API,
forging tokens. It prints `VULNERABLE: 0` when every attack is stopped, and
CI fails if any exploit lands.

### 2. Client

```bash
cd client
npm install
npm run dev
```

The client runs on `http://localhost:5173`.

Client checks (no browser needed — they import every module headlessly and
inspect the generated world):

```bash
cd client
npm test        # 31 module imports + 10 world-structure checks + interior builds
npm run stats   # print the current scene measurements
```

`verify-world.mjs` is the one worth reading: it asserts that every enterable
door is reachable by a 0.4 m player, that nothing sits below the ground plane,
that the draw-call and triangle budgets hold, and that every interior spawn is
clear of furniture.

### The complete control map (wave 6)

Every binding below is live, and no two features claim the same key. This is not
documentation-by-hope: `client/test-bindings.mjs` reads the source, builds the
binding map and fails if a key is undocumented or claimed by two systems.

| Key | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Walk (drive the vehicle when you are in one) |
| `Shift` | Sprint |
| `Space` | Jump on foot · brake while driving |
| `C` | Crouch |
| `V` | Camera: third person → **first person** → top-down |
| `Q` | Graphics quality: high → medium → low |
| `E` | Interact — doors, ATMs, shops, and people (one dispatch, see below) |
| `F` | Enter / leave the nearest vehicle you own |
| `Tab` | Inventory |
| `M` | World map (click the minimap, or this key) |
| `J` | Mission journal |
| `K` | Job board |
| `G` | Activities |
| `H` | **Go Home** — walk into the home you own or rent |
| `4` | Property / housing market |
| `L` | Leaderboard |
| `I` | Character sheet |
| `Esc` | Pause menu — closes an open panel first, then pauses |
| `F1` | Reopen the controls guide |
| `F2` | Visual tuning panel (exposure, fog, shadows, AO, IBL) |
| `1`–`9`, `0` | Action bar: Jobs, Missions, Activities, Property, Map, Garage, Bag, You, Ranks, Menu |
| Action bar, `Home` | Go Home — the same action, on screen |
| Mouse drag | Look around — or click the world to capture the mouse (free look) |
| `,` / `.` | Turn the camera left / right without the mouse |
| `PgUp` / `PgDn` | Tilt the camera up / down |
| Wheel | Zoom in / out (third person only) |
| `Shift`+`M` | Mute / unmute all sound |
| `Shift`+`R` | Force rain on / off (weather is normally automatic) |
| `T` or `Enter` | Chat |

`E` is shared by three systems on purpose, and `client/src/main.js` decides which
one gets it each frame: an open door beats an ATM, an ATM beats a person. The
guard order is written down in the code, so a shop panel can never open *and*
start a conversation from one press.

The controls guide appears once per account on first login and can be reopened
with `F1`, from the pause menu ("Getting started guide"), or by clicking the
camera badge in the corner of the screen.

Anything the guide lists is real: the guide is generated from the same constants
the systems use, and `test-ui.mjs` asserts that `W A S D / Shift / Space / C / E /
F / Tab / M / J / I / Esc` all appear in it.

### 2b. Real assets (CC0) — one command, optional

The game ships with **no binary assets in git**. One script fetches them:

```bash
bash client/fetch-assets.sh          # idempotent: skips files already on disk
bash client/fetch-assets.sh --force  # re-download everything
```

It writes 41 files (~11 MB) into `client/public/assets/`, which Vite serves at
`/assets/…` and copies into `dist/` on build:

| What | Files | Source | Licence |
|---|---|---|---|
| Sky HDRIs | `hdri/sky_day.hdr`, `sky_dusk.hdr`, `sky_night.hdr` | [Poly Haven](https://polyhaven.com) — *kloofendal 48d partly cloudy*, *venice sunset*, *moonless golf* | CC0 |
| Surface photographs | `textures/{asphalt,paving,grass,plaster,facade,wood}.jpg` | Poly Haven — *asphalt 02*, *rectangular paving*, *grass ground*, *grey plaster*, *concrete tile facade*, *wood floor* | CC0 |
| Cars | `models/car/*.glb` (sedan, van, taxi, suv, flatbed, hatchback, police) | [Kenney](https://kenney.nl) *Car Kit*, via the [shorepine mirror](https://github.com/shorepine/kenney) | CC0 |
| Trees | `models/nature/*.glb` (default, pine, thin, bush) | Kenney *Nature Kit* | CC0 |
| Street furniture | `models/street/*.glb` (lamps, cone, barrier, bend barrier) | Kenney *City Kit (Roads)* | CC0 |
| Interior furniture | `models/furniture/*.glb` (14 pieces) | Kenney *Furniture Kit* | CC0 |

**None of this is required.** Every loader falls back to the primitive it
replaced: delete `client/public/assets/`, or run with no network, and the game
boots in ~20 s and looks exactly like the previous round. `test-assets.mjs`
tests that path, because "works without the download" is the only thing that
keeps an optional asset pipeline safe.

What is real, and what is honestly still generated:

| Real (downloaded CC0) | Generated at runtime (by design) |
|---|---|
| Sky photographs, day / dusk / night, used for the backdrop **and** the image-based lighting | Buildings — Kenney's modular building kits are not in the CC0 mirror; facades are re-skinned with the real facade/plaster photographs |
| Road, pavement, grass, plaster, facade and floor **photographs** | The city layout, street grid, blocks and lots |
| Cars (sedan, SUV, taxi) — only these three kinds; danfo, keke and okada stay procedural because the kit has none and a fake danfo looks worse than an honest box | Characters — the avatar is a procedural rig; rigged CC0 humans need an animation-retarget pipeline this project does not have |
| Trees (broadleaf, pine, thin), street lamps, cones, barriers | Palms — the nature kit has no palm, and Lagos needs palms |
| 14 pieces of interior furniture (chairs, tables, beds, sofas, sinks, toilets, cabinets) | UI, icons, signage text, road paint |

Depth of the integration, in one line each:

- `client/src/assets/AssetLibrary.js` — parallel GLTFLoader/RGBELoader/TextureLoader
  load with a hard timeout, per-material merging (a 5-mesh Kenney car becomes one
  draw call), and `null` on every failure.
- `client/src/assets/installAssets.js` — installs photographs over the generator
  names (`asphalt`, `grass`, `plaster`, …), registers the skies, swaps the
  traffic fleet, and hands the furniture kit to `world/furniture.js`.
- `client/src/world/retile.js` — photographs get **world-space UVs measured in
  metres** (asphalt 5.5 m, paving 2.2 m, plaster 2.5 m), because a photo tiled by
  "repeat: 12" on a 12 × 140 m avenue is a grey smear.
- `client/src/render/SkyEnvironment.js` — `useEquirect()` converts an HDRI to a
  PMREM probe *and* a backdrop; the night photo is backdrop-only, since its moon
  would otherwise light the city like a second sun. The procedural sky remains
  the fallback and the light source at night.

### 3. Production (single process)

Build the client, then run the server — it serves the built game itself, so
there is one process and one origin to deploy.

```bash
cd server
npm run build:client     # builds client/dist
npm run start:prod       # NODE_ENV=production + serves the game at :3000
```

Open **http://localhost:3000** — that is the whole app.

---

## Round 8 — look and feel: sound, weather, poses, and the first screenshots ever

The previous rounds changed the world. This one changes how it *feels* to be in
it — and, for the first time, the project can see itself.

### 0. The screenshot harness (`client/shots.mjs`)

Every claim before this round was geometry maths, state assertions and flood
fills. None of them can see that a room is empty, and that is exactly how the
market shipped empty. So the first thing built this round was eyes:

```
cd client && node shots.mjs              # all 20+ shots
cd client && node shots.mjs 05-street 10-market
npm i -D playwright-core && npx playwright-core install chromium   # once
```

It launches Chromium with **software WebGL** (`--use-angle=swiftshader`), signs a
real account up through the real wizard, walks into venues through their real
doors using the debug hook, forces the time of day and the weather, and writes
PNGs plus a JSON manifest (draw calls, triangles, hour, view) to
`client/screenshots/`. It **fails** on a console error or a missing WebGL
context, because a screenshot of a black canvas is worse than no screenshot.

It also logs what it saw:

```
📸 05-street         132 draws   236748 tris  10:00  Third person
📸 10-market          72 draws    28734 tris  10:30  Interior
📸 10-church          99 draws    35662 tris  10:30  Interior
```

**Five real bugs came out of the first frame:**

1. New characters spawned at the world origin — the server's `pos_x/pos_z`
   default of `0` was treated as a saved position.
2. `applyUserToAvatar` was skipped on sign-up whenever the creator supplied a
   look, which is every sign-up, so the spawn placement never ran at all.
3. Turning the avatar directly did nothing: the controller rewrites
   `avatar.rotation.y` from its own `facing` every frame, so entering a building
   turned you around to stare at the door. `controller.setFacing()` is the fix.
4. The avatar's trim colour was the *complement* of the outfit, so an owambe in
   purple got a lime-green gele. It is a shade of the outfit now.
5. `AuthScreen.show()` did not exist, so `main.js` threw on every page load.

### 1. Audio — the game was silent

`client/src/audio/AudioEngine.js`. There were **no** `AudioContext`, no
`<audio>`, nothing. Every sound is synthesised from oscillators and generated
noise buffers, so it costs no downloads and stays inside the no-assets rule.

* four buses (`master → compressor → sfx/ambience/music`) with saved volumes,
* **footsteps driven by distance walked**, per surface — asphalt, pavement, tile,
  wood, grass — with alternating feet and a small pitch offset,
* **an ambience bed per place**: street traffic, market chatter, indoor hum and a
  50 Hz generator, church room tone, cricket at night, rain,
* one-shots for UI, money, doors, horns, thunder, bells, need warnings,
* `bindUISounds(audio)` gives every button in the game a click, every panel an
  open/close, all from one document-level listener, so panels written later get
  sound for free,
* `Shift+M` mutes anywhere; the pause menu has a slider per bus.

`test-audio.mjs` (48 checks) drives a fake WebAudio context and proves the buses
exist, mute silences everything, footsteps follow distance rather than a timer,
and the ambience changes when you walk into a church.

### 2. Weather that changes the game

`client/src/render/Weather.js`. Rain is a state, not a decal:

* 2 600 instanced streaks in a disc that follows the player, plus splashes and a
  cloud ceiling — three draw calls,
* `DayNight.setWeather()` mixes a grey into the horizon, the sun and the ambient
  fill and thickens the fog, so the whole palette agrees it is raining,
* NPCs speed up by 55 % when it pours, the audio switches to its rain bed, the
  HUD chip turns to a rain cloud, and rain **stops at the door** when you walk
  inside,
* the ground stays wet for minutes after it clears,
* `Shift+R` forces it for a screenshot; otherwise a seeded cycle gives short
  showers and long dry spells.

`test-polish.mjs` proves the ramp, the indoor cut-off, the light and fog response,
and that the same seed produces the same weather.

### 3. Characters that do things

`Avatar` gained a **pose system** — 13 poses (sit, sit upright, work, type, serve,
eat, phone, pray, kneel, wave, dance, crouch-work) blended over the walk/idle base
so entering and leaving a pose is smooth and breathing keeps running underneath.

Every NPC role now holds its own pose while standing still: the priest prays, the
imam prays, the banker types, the chef serves, the mechanic is under a bonnet,
the student sits. Walking releases the pose, so a sitting character can never
slide across the room. `test-polish.mjs` checks every pose for anatomical range —
a knee bending backwards is invisible in a test that only asserts "it moved".

### 4. Onboarding and UI polish

* the creator's step row overflowed and clipped the word "Start"; it wraps now,
  and the panel stacks below 720 px,
* the character designer is fixed at `min(760px, 94vw)` with a live 3D preview,
* the action bar was ~470 px wide with 10 slots of 62 px, so "Menu" wrapped onto
  a second row and stuck out below the pill; it is one row that compresses,
* the pause menu is **tabbed** — Main / Settings / Status — with camera settings,
  a slider per audio bus, and a status pane reading live frame rate, draw calls,
  player count and view from the renderer, never an estimate,
* design tokens (`--nl-*`) for colour, space, radius, type and motion, plus
  `prefers-reduced-motion`, focus-visible rings, and a HUD that wraps on phones,
* chat no longer says "Press Enter to chat" over the sign-up screen, and skips
  stale presence noise when it loads history,
* critically low needs warn **once** — a toast and a sound — and only re-arm
  after the need recovers.

### 5. Two behaviour fixes

* `footprintOnRoad` sampled nine points, which misses a road crossing an edge
  between samples; it is an exact interval test now.
* remote players' interiors-safe look: the server broadcasts the whole look
  (`hairStyle, hairColor, bodyType, outfitId, bottomColor`) and the client
  rebuilds a remote avatar when it changes, so someone who walks into the
  character panel changes clothes on your screen too.

### Tests

```
client npm test            17 suites, all green
                           … + test-audio 48 · test-polish 83 · test-remote-look 53
server/test-world.mjs      36/0, including "another player receives the outfit id"
```

`npm run shots` is not part of `npm test`: it needs a browser and a running
server, and it is a human judgement tool, not an assertion.

## Round 9 — real cars, real sky, real furniture, and a Go Home button

The request was *"can this app use real cars, buildings, furnitures, roads, road
signs, maps, trees, characters, real sky, everything real. Add a button that
takes the character to home"*.

### What "real" turned out to mean

The primitives-only rule that had shaped every earlier round was lifted, so this
round downloads genuine CC0 content instead of synthesising it. The honest split
between what could become real and what could not is tabulated in
[2b. Real assets](#2b-real-assets-cc0--one-command-optional) above. In short:
**cars, trees, street furniture, interior furniture, sky and surface textures are
now real photographs and real models**; **buildings, the city map and characters
are still generated**, because the modular building kits and rigged humans are
not available as CC0 in a form this project can use without an art pipeline.

### 1. The asset pipeline (`client/fetch-assets.sh`)

One idempotent script, two endpoints, 41 files: Poly Haven's file API for HDRIs
and textures, the `shorepine/kenney` GitHub mirror for models. Kenney's own site
is behind Cloudflare for `curl` and its "download" links return an HTML page, so
the mirror is used instead — that dead end is recorded in the script's comments
so nobody retries it.

### 2. Every load has a fallback

`AssetLibrary.load()` never rejects. A missing file lands in `failed`, the
consumer gets `null`, and the code that used to draw the box draws the box. The
load also has a hard timeout: a CDN that accepts the connection and never answers
costs 20 seconds, not the boot.

### 3. World-space UVs, or "why the road was a grey smear"

The first screenshot with photographic asphalt looked *worse* than the procedural
version: a 12 m × 140 m avenue drawn with `repeat: 12` is one tile stretched
lengthways. `world/retile.js` fixes it properly — texture coordinates derived
from each vertex's world position and normal, with one tile pinned to a physical
size. Adjacent road segments built as separate meshes now line up exactly.

### 4. Traffic with real bodies, and the three that stayed boxes

`TrafficSystem.useModels()` swaps sedan, SUV and taxi for Kenney models, merged
into one `InstancedMesh` per material per kind — the whole fleet is a handful of
draw calls. Danfo, keke and okada stay procedural: they are the three most
Lagos-specific vehicles in the game and the car kit has none of them, so a
hatchback painted yellow would read as a mistake. Cars are tinted only a quarter
of the way toward their fleet colour, so a yellow taxi does not come out green.

The instance bookkeeping is the subtle part, and `test-assets.mjs` checks it:
cars with a real model must not also draw a box, and the primitive instances are
compacted so an unused slot cannot silently render a car at the origin.

### 5. Sky photographs tied to the clock

Three HDRIs, three bands of the day: day (05:36–17:24), dusk (17:24–19:24),
night. Each is PMREM'd into the environment map so reflections and ambient light
come from the photograph — except at night, where the moon in the photo is
bright enough to light the street like an overcast noon. The night photo is the
backdrop only, and the procedural sky keeps doing the lighting.

### 6. Go Home — a button, not a decoration

`Go Home` (action bar, or `H`) asks the server what the player actually lives in,
then walks the character into that interior through the same door path as any
other building. The details that make it real:

- **No home → the button is visibly disabled**, with a tooltip that says why, and
  pressing it produces a message instead of silence.
- **Homes now have interiors.** The five housing listings used to be buildings
  you could never enter and a number in a panel. Each now has its own floor plan
  (`world/interiorData.js` → `propertyInteriors`), with the furniture kit inside.
- **The doors are locked.** Any property that is not yours refuses entry and says
  so — `InteriorSystem.setPropertyCheck()` takes the answer from the housing
  state the server returned. The client never decides who lives where.
- The button re-evaluates on every housing response, so renting and then pressing
  it works immediately, with no reload.

`client/test-home.mjs` drives all of that in a real browser: sign up, confirm the
disabled button and its message, rent the hostel bed through the Property panel,
press Home, assert the character is inside `in-prop-hostel-bed`, walk around the
flat, then confirm a stranger's door is locked and their own door still opens.

### Judging it

```bash
bash client/fetch-assets.sh   # once
npm test                      # includes test-assets.mjs
node test-home.mjs            # needs the server up on :3000
node shots.mjs 05-street 10-market
```

## Round 10 — everything real, and everything doable

The complaint that started this round was one sentence: *"i visited a shop and it
was empty, no cart, no isle, no attendant, nothing to purchase."* The shop had
shelves. What it did not have was a single spot where pressing **E** did
anything. So this round's unit of work is the **station**: a place on the floor
with a list of actions, each one a real server call.

### What you can now do in a building

| Place | Stations | What they do |
|---|---|---|
| Your home | 9 | sleep / nap, cook, eat, shower, toilet, laundry, rest, watch TV, call someone, read, work from home, change clothes, open your things, **open the meter cupboard** |
| Supermarket | 3 | shop the aisles, shop the chillers, shop at the till — 17 lines priced by the server |
| Market hall | 2 | haggle at the traders, buy from the fabric stall |
| Airport terminal | 6 | check in, clear security, café, toilets, departure gate, departure board |
| Airport apron | 3 | board the flight, walk back to the terminal, stand on the apron |
| Church / mosque | 2 | pray, light a candle / pray, wash before prayer |
| Hospital / clinic | 2–3 | see a nurse, get treated |
| School, bank, gym, restaurant, police, garage, office, kiosk | 1–2 each | study, deposit, train, order, report, repair, work |

Twenty-eight of those actions are server-authoritative activities with real
timers and real need effects. Buying is server-authoritative too: the panel sends
an item id, and the server decides the price and takes the money. If you are not
standing in the shop that sells it, the server refuses in its own words:

> You have to be inside Surulere Supermarket to buy that

### The home runs on something

A home you can live in needs a meter, so it has one — and it is not decoration:

* **Prepaid electricity**, in kWh, with six appliances at their real wattages
  (fridge 150 W, AC 1,200 W, pump 550 W). Switch the AC on and today's load
  jumps; switch everything off and the meter stops — and then the TV will not
  come on, in the server's words.
* **A 1,000 L water tank** that bathing and laundry draw from. An empty tank
  stops the shower.
* **A 12.5 kg gas bottle** for the hob.
* **Rooftop solar**, ₦420,000, one purchase, 60 % off the grid draw — measured
  at 19.7 → 7.9 kWh/day.

Readings drain on the game clock, so they keep running while you are logged out
(capped at two real hours, so nobody returns to a dead house).

```bash
node server/test-utilities.mjs   # 33 checks: top-ups, switches, empty meter, solar
node client/test-home.mjs        # 26 checks, real browser: opens the cupboard and buys 20 units
```

### The fleet

Danfo, keke and okada are gone. In their place, built part by part in
`client/src/world/vehicleParts.js` and shared between the street traffic and your
garage:

* **Hiace 18-seater** — 5.3 m, 18 seats, roof rack, waist stripe
* **Tricycle (keke NAPEP)** — one wheel forward, cabin, open bench under a canopy
* **Motorbike (okada)** — frame, tank, forks, two wheels

Old saves still say `danfo`, `keke` and `okada`; those ids resolve to the
replacement instead of showing a broken row.

### The airport

Landside terminal → security → concourse → gate → **apron**, which is its own
scene: four aircraft on painted stands, three jetbridges, a baggage train, a fuel
truck, a lit terminal facade, a control tower, and a runway with markings, edge
lights and stand numbers painted on the concrete. Boarding the flight is a 40 s
server activity.

```bash
node client/test-round10.mjs   # 28 checks, real browser: shop → airport → board
node client/airfield-shots.mjs # screenshots of the apron
```

## Round 11 — every room does something, and somebody works there

Round 10 filled the shop and the home. This round went back through the other
nineteen rooms, because "furnished" and "working" turned out to be different
things. Three of the things it fixed were bugs that had been shipped, not gaps
waiting to be filled.

### The bug that mattered most: scenery with a button on it

`venueOnly` in `activityConfig` only *hides* an activity from the general
Activities menu. It does not stop anyone performing it. So "cook a meal",
"watch TV", "study", "get treated" and "nap" could all be triggered from the
middle of a road with no venue reported at all — the server allowed it because
nobody had told it not to. Every one of those is now gated:

- `requiresVenue` — exact interior ids, for one-off places (`in-airfield`)
- `requiresVenueKind` — a *kind* of place, via `server/config/venueKinds.js`,
  because homes are generated per property (`in-prop-*`, `in-home-*`) and a
  fixed id list could never cover them

Standing in the road and pressing "Cook a Meal" now answers
*"Cook a Meal can only be done at your home or the community centre."*

### The bank counter now banks

The bank building had a teller counter you could only *chat* at. Standing at the
counter, you could not deposit a naira. `/api/interactions/bank/deposit` and
`/withdraw` now accept either an outdoor interaction point **or** the indoor
branch, recognised from the venue the client already reports. Refused on the
street and refused in a supermarket; allowed at the teller and at the ATM.

### The planes and the apron

The apron offered `watch_tv` so that it had *something* — a lawn chair on the
tarmac watching a television that was not there. It now has `planespot`, its own
activity, gated to the airfield.

### Two rooms that shared a layout

The tech hub and the community centre are both shelled as `office`, so they were
furnished and staffed identically. Station plans are now looked up by interior
id first and type second, so each has its own.

### Somebody behind every counter

Twenty-one interiors, each with a named attendant who has a role, two lines of
patter and a fixed list of services they will actually perform:

| Room | Who | Will do |
|---|---|---|
| Supermarket | Blessing, till supervisor | chat |
| Market | Mama Nkechi, trader | chat, street food |
| Hospital | Nurse Adaeze, triage nurse | chat, clinic check-up ₦2,500 |
| Clinic | Sister Grace | chat, clinic |
| Bank | Mr Adewale, teller | chat |
| Church / Mosque | Bro. Emeka / Alhaji Musa | chat |
| Airport / Apron | Chidinma / Capt. Bello | chat |
| School | Mr Okonkwo, teacher | chat |
| Gym | Kelvin, trainer | chat |
| Restaurant, Community hall, Kiosk | Yemi / Auntie Bola / Ifeoma | chat, street food |

The service endpoint refuses anything the person there does not offer:
"Blessing does not do that here."

### New things to actually do

Seven new server activities for rooms that only had "socialise":
`worship`, `volunteer`, `exam` (smarts +18, energy −25), `repair`, `meeting`,
`checkup`, `physio`. The hospital, clinic and garage also sell now — a pharmacy
counter (paracetamol, malaria tablets, ORS, first aid) and a parts counter
(engine oil, spare tyre, jump leads).

### By the numbers

| | Before | After |
|---|---|---|
| Stations across all interiors | 37 | **100** |
| Rooms with fewer than 3 stations | 14 | **0** |
| Venues that sell something | 8 | **15** (93 lines) |
| Server activities | 18 | **26** |
| Rooms with a named attendant | 0 | **21** |

### Guards so this cannot come back

`test-venues.mjs` now proves three invariants, not just "the room is not empty":

- every **shop** station points at a venue the server can sell from, with stock
- every **activity** a station offers is legal in that room, by the same rule the
  server applies (this is what caught the apron's phantom television)
- every room with a **staff** station has a real attendant with at least one
  service

```bash
node client/test-venues.mjs     # 105 checks, including the three invariants
node client/stations-report.mjs # the table above, per room
cd server && node test-utilities.mjs   # 34, now reporting a venue like a client
```

## What You Should See

1. Open **http://localhost:5173** in your browser.
   - A loading screen with a **progress bar** appears briefly and fades out.
   - After it hides you see a **lit, sky-blue scene** with a **flat green ground plane** (200 × 200).
   - An **FPS counter** is shown in the top-right corner.
   - An **auth overlay** appears on top — sign up or log in to enter the game.
   - After signing up, the avatar takes your chosen colours and the overlay hides.
   - A **HUD** appears showing your cash, bank balance, clock, and 6 needs bars (hunger, energy, hygiene, bladder, fun, social).
   - Needs decay over time — bars drop and change colour (green → yellow → red).
   - If hunger or energy drops below the warning threshold, movement speed is reduced to half.
   - If energy hits zero, you **pass out** for 10 seconds (controls locked, red toast shown).
   - Refresh the page — you stay logged in (token stored in localStorage) and offline needs catch-up is applied (capped at 8 hours).
   - Press **K** to open the **Job Board** — shows 5 available jobs with hourly rates.
   - Take a job (e.g. Tech Hub Developer at ₦5,000/hr) — your cash increases automatically while working.
   - The HUD shows your current job name next to your cash.
   - Quit a job anytime from the Job Board — income stops immediately.
   - Press **G** to open the **Activity Panel** — shows 6 activities (eat, sleep, shower, toilet, socialise, exercise) with durations and effects.
   - Perform an activity (e.g. Eat to restore hunger) — controls lock during the activity, effects apply when complete.
   - Activities that refill low needs are highlighted as recommended.
   - Cancel an activity mid-way from the Activity Panel.
   - The HUD shows your current activity next to your job.
   - New buildings visible in the city: Food Court (Mushin), Hostel (Mushin), Public Bathroom (Mushin), Gym (Lekki), Community Center (Yaba).
   - Press **H** to open the **Housing** panel — shows your home (or "Homeless") and 5 properties across Lagos with prices, rent, and bonuses.
   - Buy a property with cash (e.g. Hostel Bed for ₦150,000) — the money leaves your cash, the property is marked **Owned**, and you move in automatically.
   - Or rent one — you pay a deposit plus the first period of rent upfront, and rent is then collected automatically every 30 minutes.
   - The HUD shows your home next to your job and activity. Rented homes are shown in amber, owned homes in green.
   - Sleeping and showering give **bigger refills** at home: a Hostel Bed adds +10%, a Waterfront Mansion adds +90%. Sleeping while homeless gives no bonus.
   - A home also slows energy decay (Hostel Bed −5%, Waterfront Mansion −45%).
   - You can only rent one place at a time. Rent is taken from cash first, then your bank balance.
   - If you cannot pay rent, you are **evicted** and become homeless, with a red toast explaining why.
   - New buildings visible in the city: Hostel Bed (Mushin), Yaba Studio Flat (Yaba), VI Apartment (Victoria Island), Lekki Duplex (Lekki), Waterfront Mansion (Lekki waterfront).
   - The jobs, activities and housing panels no longer fight over hotkeys: **K**, **G** and **H** are separate keys, and opening one closes the others so the right-hand slot is never doubled up.
   - **Multiplayer (Step 9):** open a second browser tab (or another browser) and log in as a different player — you see their avatar walk around with a floating name tag. The HUD shows `👥 2 online`.
   - Press **Enter** (or **T**) to type in city chat; press **Enter** again to send, **Esc** to cancel. Messages from other players appear on the left.
   - Join/leave notices appear in chat as system lines, and a new joiner receives the recent chat history.
   - Name tags show a player's current activity icon (🍔 sleeping, 🏃 exercising) and a 😵 when they've passed out.
   - **World interactions (Step 10):** walk up to the green **ATM** near spawn (12, 12) — a prompt appears: `[E] ATM`. Press **E**.
   - The panel shows your cash and bank balance with Deposit / Withdraw buttons and quick amounts. Money moves exactly as the server says — try depositing more than you hold and it's refused.
   - Walk away and the panel closes automatically. Try banking from across the map (edit the request) and the server refuses: *"Too far away"*.
   - The **Mushin Market**, **Food Court** and **Pure Water Kiosk** are shops: buy jollof rice (₦1,500, +35 hunger), suya, water, energy drinks and soap. Buying applies the effect immediately.
   - **Polish (Step 11):** the sky cycles through day → sunset → night over 8 real minutes, driven by the absolute clock, so every player sees the same time of day. The HUD clock shows ☀️/🌙 with the in-game time.
   - Press **L** for the **Leaderboard** — top 10 players by net worth (cash + bank), with your own row highlighted. If you're outside the top 10 your rank is shown separately.
   - **Your position is saved.** Walk somewhere, close the tab, log back in — you spawn where you left off.
   - On a phone/tablet you get touch buttons for Run, **E**, chat, activities, jobs and housing.
   - **Session menu:** click your username in the top bar, or open the pause menu (**Esc**) and choose **Sign out**. From there you can **change your password** (which signs out your other devices but keeps this one) or **log out** — a real logout that revokes your token server-side, so the old token stops working immediately.
   - **Visual overhaul:** the city is no longer flat boxes. Every building has a plinth, storey bands, a grid of recessed windows with sills and lintels, corner pilasters, a parapet or pitched roof, rooftop water tanks, satellite dishes, AC units, ground-floor shopfronts with awnings, and an emissive sign board.
   - Walk up to any glowing cyan ring on the pavement — a prompt appears: `[E] Enter Tech Hub`. Press **E** to go inside.
   - Interiors are real rooms: wood or tiled floors, skirted plaster walls, a ceiling with cornices, windows with daylight coming through, and furniture — sofa, coffee table, rug, TV unit, bookshelves, kitchen with sink, hob, wall cabinets and a fridge, a dining table, a bedroom with a made bed and wardrobe, and a bathroom with WC, basin and a glass shower enclosure. Ceiling fittings cast warm light.
   - Nine places are enterable: Tech Hub (office), Bank, Clinic, Pure Water Kiosk, Market, and one apartment in each of Mushin, Yaba, Victoria Island and Lekki.
   - Press **E** near the door again (or **Esc** is not needed) to leave — you are put back outside where you came from.
   - Press **V** to switch between the follow camera and a steeper, longer isometric-style view. Press **Q** to cycle graphics quality (high → medium → low). **C** is crouch.
   - A **bottom action bar** gives you every panel with icons: Jobs, Missions, Activities, Property, Map, Garage, Bag, You, Ranks, Menu. Keyboard shortcuts **1**–**9** and **0** do the same. The full map (**M**, or click the minimap) lists every destination sorted by distance, with a bearing arrow and a route drawn on both maps.
   - Your character is fully jointed: elbows and knees bend, the shoulders counter-rotate against the hips, the head stabilises while walking, the chest breathes when idle. Hair (short / afro / braids / bald) and hair colour are derived from your username, so players who pick the same skin tone still look different.
   - **Open world (wave 6):**
   - On your first login a **controls guide** covers the screen with every binding, grouped by on-foot / world / panels / driving. Press **F1** any time to bring it back.
   - The **minimap** sits in the top right with your exact position and heading. Press **M** to expand it into the full city map: every district, every enterable building, a legend, and a destination list with live distance. Pick one and the route is drawn on both maps — and recalculated if it can no longer be walked.
   - Walk up to a person and press **E**. They introduce themselves by role (Food Vendor, Bank Clerk, Site Foreman, Police Officer, Nurse, Mechanic, Resident) and offer options that do something: hand you the job board, route you somewhere, sell you street food for ₦1,500, or run a ₦2,500 clinic check-up. The money leaves your cash and the need refill is decided by the server.
   - Press **J** for the **mission journal**. Accept *First Paycheck*, then actually work a shift; when the objectives are met the card turns gold, the HUD objective chip says "Ready to claim", and **Claim** pays out — into the same balance the HUD shows.
   - Press **Tab** for the **inventory**. Anything you bought at a shop is there with a real **Use** button; using it moves the need and consumes the item, because `/api/inventory/use` decided that, not the panel.
   - Press **I** for the **character sheet**: cash, bank, debt, total earned, all six needs, skills, districts discovered, items used, missions, vehicles and your home.
   - **Buy a car.** Open the map, choose the Auto Dealership, buy a keke or a saloon at the **Garage** panel. It spawns beside you. Walk up, press **F**, and drive: the HUD shows real km/h and a fuel bar that drains as you move, **Space** brakes, **F** steps out — and the parking spot is saved on the server, so it is still there after a reload.
   - Districts are discovered by walking into them: Mushin, Yaba, Victoria Island and Lekki land in the character sheet permanently.
   - Press **Esc** for the **pause menu**: resume, **Save progress** (which flushes to disk and reports the timestamp and balance), controls, camera, graphics, sign out. Pausing does not move you, reset your camera, cancel your mission or rewind the world.
   - Close the tab, come back, log in: you spawn where you left off, with the same cash, bag, missions and parked car.
2. Open **http://localhost:3000/api/health** — returns `{"ok":true}`.
3. Open **http://localhost:3000/api/jobs** with a valid JWT — returns the job list.
4. Open **http://localhost:3000/api/activities** with a valid JWT — returns the activity list.
5. Open **http://localhost:3000/api/properties** with a valid JWT — returns the housing market.

---

## Project Structure

```
/
├── README.md
├── client/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js          — Proxies /api and /socket.io to server
│   ├── .gitignore
│   ├── check-syntax.mjs        — Imports every client module headlessly (49 modules)
│   ├── test-bindings.mjs       — Binding audit: every key documented, none conflicting (28 keys)
│   ├── test-ui.mjs             — jsdom runtime tests: panels, NPC dialogue, driving (48)
│   ├── test-nav.mjs            — Navigation grid + A* route legality (11)
│   ├── verify-world.mjs        — Structural world checks: door reachability, budgets (10)
│   ├── test-assets.mjs         — Asset pipeline: load, fallback, retile, fleet swap (51)
│   ├── test-home.mjs           — Go Home end to end in a browser (16) — needs :3000
│   ├── fetch-assets.sh         — Downloads the CC0 models/textures/HDRIs (idempotent)
│   ├── public/assets/          — What fetch-assets.sh writes (git-ignored, optional)
│   ├── interior-stats.mjs      — Builds every interior type and reports the result
│   ├── scene-stats.mjs         — Measures the generated scene (meshes, tris, materials)
│   └── src/
│       ├── main.js              — Scene, auth flow, world systems (NPCs, vehicles, panels), Socket.IO
│       ├── styles.css           — HUD, toast, job/activity/property panels, all UI styling
│       ├── player/
│       │   ├── Avatar.js        — 26-mesh jointed character: elbows, knees, face, 4 hair styles
│       │   └── PlayerController.js  — speedMultiplier/controlsLocked + chase/iso/interior camera rigs
│       ├── assets/
│       │   ├── AssetLibrary.js  — GLTF/RGBE/texture loader, per-material merge, null-safe
│       │   └── installAssets.js — Photographs → generators, skies → SkyEnvironment, fleet, retile
│       ├── render/
│       │   ├── SkyEnvironment.js — Procedural Sky shader + HDRI photographs (PMREM probe)
│       │   └── PostFX.js        — EffectComposer: SSAO + bloom + SMAA + OutputPass, 3 quality tiers
│       ├── ui/
│       │   ├── icons.js         — 30 inline SVG icons (no font, no download)
│       │   ├── ActionBar.js     — Bottom action bar (10 entries) + Places sheet
│       │   ├── MapSystem.js     — Minimap + expandable city map, legend, destinations
│       │   ├── DialogueUI.js    — NPC dialogue box: numbered options, Esc, real callbacks
│       │   ├── ControlsGuide.js — First-run controls guide, reopenable with F1
│       │   ├── PauseMenu.js     — Esc menu: resume, save, controls, camera, graphics, sign out
│       │   ├── CharacterPanel.js— Character sheet (I): stats, needs, skills, progress
│       │   ├── VehiclesPanel.js — Garage / dealership (catalogue, buy, walk to a parked car)
│       │   ├── DriveHUD.js      — Live km/h and fuel bar while driving
│       │   └── Controls.js      — Reference implementation of the control map (not imported)
│       ├── world/
│       │   ├── cityData.js      — Districts, buildings, job kiosks, activity + property buildings, roads, trees
│       │   ├── CityBuilder.js   — Merges districts; textured roads; collision AABBs
│       │   ├── textures.js      — 16 procedural canvas texture generators
│       │   ├── materials.js     — Cached PBR material library over those textures
│       │   ├── BuildingFactory.js — Facades, roofs, rooftop tanks, shopfronts, signage
│       │   ├── furniture.js     — 21 multi-part furniture builders
│       │   ├── InteriorBuilder.js — Room shells with doorways/windows + furniture layout
│       │   ├── interiorData.js  — Which buildings you can enter and what is inside
│       │   ├── InteriorSystem.js — Door prompts, scene swap, interior light rig
│       │   ├── mergeUtils.js    — Static geometry merging (draw-call control)
│       │   ├── retile.js        — World-space UVs for photographs, at a real metres-per-tile
│       │   ├── navGraph.js      — Grid + A* over the real collision data
│       │   ├── poi.js           — Points of interest shared by map, routing and NPCs
│       │   ├── NPCSystem.js     — 10 named NPCs: patrols, dialogue trees, session memory
│       │   ├── VehicleSystem.js — Vehicle meshes from primitives + driving physics + parking
│       │   ├── MiniMap.js       — Obsolete first minimap (superseded by ui/MapSystem.js)
│       │   └── DayNight.js      — Shared day/night sky, sun and fog cycle
│       ├── nav/
│       │   └── NavigationSystem.js — Route guidance, waypoint following, arrival
│       ├── auth/
│       │   ├── api.js           — signup, login, logout, password, all game APIs, token handling
│       │   ├── AuthScreen.js    — Full-screen auth overlay
│       │   └── SessionMenu.js   — Account menu: change password, real logout
│       ├── hud/
│       │   ├── HUD.js           — Top bar, needs bars, job/activity/home/online, game clock
│       │   ├── Leaderboard.js   — Top-10 net worth panel (toggle with L key)
│       │   ├── TouchControls.js — On-screen buttons for touch devices
│       │   └── Toast.js         — Toast notification system
│       ├── inventory/
│       │   └── InventoryPanel.js — Bag: use and drop items (Tab)
│       ├── missions/
│       │   ├── MissionJournal.js — Mission journal: accept and claim (J)
│       │   └── ObjectiveTracker.js — HUD objective chip
│       ├── jobs/
│       │   └── JobBoard.js      — Job board panel (toggle with K key)
│       ├── activities/
│       │   └── ActivityPanel.js — Activity panel (toggle with G key)
│       ├── properties/
│       │   └── PropertyPanel.js — Housing market panel (toggle with H key)
│       ├── multiplayer/
│       │   ├── RemotePlayers.js  — Other players: avatars, name tags, interpolation
│       │   └── Chat.js           — City chat overlay (Enter to type)
│       └── interactions/
│           └── InteractionSystem.js — Walk-up prompts, bank & shop panels (E)
└── server/
    ├── package.json
    ├── .env.example
    ├── .env
    ├── .gitignore
    ├── config/
    │   ├── needsConfig.js      — Needs decay rates, thresholds, timing
    │   ├── jobConfig.js        — Job types, hourly rates, income calculation
    │   ├── activityConfig.js   — Activity types, durations, effects
    │   ├── propertyConfig.js   — Properties, prices, rent, home bonuses
    │   ├── multiplayerConfig.js— Broadcast rate, map bounds, chat limits, speed caps
    │   ├── interactionConfig.js— Bank/shop points, radii, shop items & prices
    │   ├── itemConfig.js       — 7 inventory items: effects, use text, sell price
    │   ├── missionConfig.js    — 8 missions with server-side completion predicates
    │   ├── vehicleConfig.js    — 6 vehicles, fuel price, tank size
    │   └── serviceConfig.js    — NPC services: price, need effects, cooldown
    ├── scripts/
    │   └── gen-secret.mjs      — Generate/rotate the JWT secret (npm run gen-secret)
    ├── test-step9.mjs          — Multiplayer integration tests (28)
    ├── test-step10.mjs         — World interaction tests (28)
    ├── test-step11.mjs         — Polish + regression sweep (24)
    ├── test-hardening.mjs      — Auth hardening tests (37)
    ├── test-session-economy.mjs— Revocation + atomic economy + static serving (44)
    ├── test-exploits.mjs       — Red-team suite: attacks the server, fails CI on any exploit (20)
    ├── test-world.mjs          — Open-world integration: inventory, missions, vehicles, services (31)
    └── src/
        ├── index.js            — Express + Socket.IO; all routes; security middleware
        ├── db.js               — SQLite persistence, migrations, offline decay, all CRUD
        ├── auth.js             — JWT sign/verify, auth middleware, algorithm pinning
        ├── secret.js           — JWT secret resolution/validation/generation
        ├── rateLimit.js        — Per-IP limiter + per-account login lockout
        ├── economy.js          — Atomic wallet/property/shop operations (transactions)
        ├── securityLog.js      — Structured security event logging (redacts secrets)
        ├── gameLoop.js         — Server-authoritative tick, income, rent, activities, persistUser
        ├── multiplayer.js      — Presence, movement sync with vehicle-aware speed cap, chat
        └── worldRoutes.js      — Inventory, missions, vehicles, NPC services, districts, save, character
```

## Realism pass: lighting, atmosphere and shadows

The city used to be lit by `RoomEnvironment` — a virtual *indoor photography
studio*. Every facade, window and car was reflecting a white studio wall instead
of a Lagos sky, and the shadow map covered a 260 m square at 12.7 cm per texel.
Three things were changed, all inside the existing dependency tree.

**1. The sky is now the light source** (`client/src/render/SkyEnvironment.js`)
Three's `Sky` shader generates the visible backdrop *and* is baked into a PMREM
environment map via `PMREMGenerator`. Whenever the sun moves more than 0.02 rad
(and at most every 2 s), the probe is rebuilt, so reflections and ambient light
track the actual time of day. The old probe was disposed of properly, so this
does not leak render targets.

**2. Fog is exponential and tinted from the horizon** (`world/DayNight.js`)
`FogExp2` replaces linear fog, and its colour is copied from the sky's horizon
colour every frame. Density runs from 0.0038 at noon to 0.0092 at night, so
distance reads as distance and the city closes in after dark. Sun elevation,
azimuth, palette and fog all come from one pure module
(`render/atmosphere.js`), so the sun, ambient fill and haze can never disagree
about the time of day.

**3. Shadows are 2.17× sharper and follow the player** (`render/ShadowRig.js`)

```
before:  260 m span / 2048 texels = 12.70 cm per texel, fixed to the map centre
after:   120 m span / 2048 texels =  5.86 cm per texel, re-centred on the player
```

The shadow camera is snapped to the texel grid before it moves; without that the
edges crawl and shimmer as you walk. `normalBias` is set alongside `bias`, which
matters more at higher texel density.

**4. GTAO replaces SSAO** (`render/PostFX.js`)
`GTAOPass` finds contact shadows with fewer halos and no bright rim artefacts.
It is still gated to the `high` quality tier; `medium` and `low` skip AO.

### Judging it — press F2

There is no GPU on the machine this was built on, so **none of the above has been
seen rendered** — it is verified by maths and by construction, not by looking.
To make that honest and reviewable, **F2** opens a live tuning panel: sky mesh on/
off, IBL on/off, turbidity, rayleigh, fog density, shadow half-extent and map
size, a live texel-size readout, GTAO on/off with radius and intensity, exposure,
bloom, and the quality tier. Every effect can be toggled off to see exactly what
it contributes. `Copy diagnostics` puts a JSON snapshot on the clipboard.

`lil-gui` is loaded with a dynamic import, so it is a separate 8 kB gzip chunk
that players who never press F2 never download.

### Tests

`client/test-render.mjs` — 47 checks: sun geometry and phase wrapping, palette
warmth ordering, fog density bounds, the shadow texel maths and snapping, real
construction of `Sky` and `GTAOPass` in Node (they need no GL context to build),
and static assertions that the wiring is in place and the room probe is gone.

## The city: streets, traffic, trees and interiors

A round of corrections after the realism pass, from playing it: the streets did
not read as a city, the sky was not visible, the light was flat, the trees
looked like cones, there were no cars, every interior was the same, and the
furniture blocked the player. What changed, and how each one is verified:

### 1. A real street grid (`client/src/world/streetGrid.js`)

The old city had **two 6 m roads** crossing at the origin, with everything else
dumped on grass. That is why there were no cars: there was nowhere to drive and
nowhere to park.

There is now a Manhattan-style plan, and it is the single source of truth for
the buildings, the road mesh, the map, the trees, the lamps and the traffic:

| | Avenues (N–S) | Streets (E–W) |
|---|---|---|
| Count | 4 | 4 |
| Centres | x = −60, −20, +20, +60 | z = −60, −20, +20, +60 |
| Pitch | 40 m | 40 m |
| Roadway | 12 m | 8 m |
| Pavement | 3 m each side | 3 m each side |
| Junctions | 16 | |

That produces **25 blocks**, each fronted by a 3 m pavement with a kerb, plus
lane paint, crosswalks and stop lines at every one of the 16 junctions. Blocks
are filled with rowhouse-scale buildings (4.5–8 m frontages) in concentric
rings, so a block is solid the way a Manhattan block is, not a single ring of
boxes around an empty car park.

Buildings are placed in this order, which matters:

1. named buildings and fixed landmarks claim their lots first (a saved property
   that moves is a broken save),
2. any of them that lands in a roadway, on a pavement, or on top of one of the
   server's five interaction anchors is slid to the nearest free ground,
3. procedural filler fills whatever is left.

### 2. Blue sky that is actually on screen

The sky was a `Sky` mesh — a 500 m box that had to fit inside the camera far
plane and survive the whole post-processing chain. It is now **baked into a cube
map with a `CubeCamera`** and used as `scene.background`, so it cannot be
clipped, fogged or swallowed by a post pass. `turbidity` went from 8 to 3.2 and
`rayleigh` from 2.4 to 1.8: the old values were so hazy that ACES tone mapping
crushed the zenith to near-white, which is why the sky read as a flat pale sheet.

`DayNight` used to overwrite `scene.background` with a flat colour every frame —
it now leaves the background to whoever owns the sky (`manageBackground: false`).

### 3. A light that behaves like a sun

The sun-to-fill ratio was **1.25 : 0.65** at noon, i.e. the ambient was half as
strong as the sun. Nothing had a lit side; nothing had a shadow side. It is now
**2.90 : 0.46 (6.3 : 1)**, and the flat `AmbientLight` became a `HemisphereLight`
— blue sky above, warm ground bounce below, which is where outdoor fill actually
comes from. `test-render.mjs` asserts the ratio, not just the numbers.

### 4. Trees that look like trees

Four draw calls per row instead of one cone: a tapered trunk, two angled
branches, and a canopy of **five overlapping icosphere lobes** at different
heights with per-blob colour variation. Palms get a leaning trunk and eight
drooping fronds. 52 street trees stand in the pavement band, 37 palms line the
Lekki waterfront.

### 5. Traffic — parked and moving

`client/src/world/TrafficSystem.js`. **54 parked cars** along the kerbs and **22
driving cars**, all instanced: the entire fleet is **3 draw calls**. The fleet is
Lagos-flavoured — danfo minibuses, keke napep, okada, taxis, sedans, SUVs.

The moving cars keep right, keep their distance from the car in front, and obey
the junction signals (13 s green, 2.5 s amber, mutually exclusive phases), easing
to a stop at the stop line rather than driving through a red. Traffic blocks both
the player on foot and the player's own vehicle.

### 6. Interiors that are not all the same

The old builder put a sofa, a kitchen and a bed into *every* interior and then
sprinkled shop shelving on top — so a garage and a market were the same flat with
different clutter. Round 7 replaced the three generic fitting routines with a
venue library: **`world/venueProps.js`** (56 props) and
**`world/interiorLayouts.js`** (one real floor plan per kind of building).

| Where | What is actually inside |
|---|---|
| Market hall (20 × 16) | 18 stalls with tarpaulins and trays of produce, a fabric stall, a fish table on ice, sacks of grain, price boards, trading umbrellas, a tiled aisle |
| Church (14 × 22) | 20 pews either side of a 1.6 m nave, altar on a dais with candles and cross, two pulpits, seven stained-glass windows, font, collection table |
| Mosque (12 × 16) | Mihrab niche, 81 prayer mats facing it, shoe racks at the door, Qur'an shelf, ablution taps, wall clock |
| Hospital (18 × 14) | Reception desk, two waiting rows, six beds with IV stands and curtain rails, a trolley, medicine cabinets, lab bench, wheelchair |
| Airport (24 × 18) | Five check-in desks with baggage belts and scales, a metal-detector arch and an X-ray scanner, 27 lounge seats, departure board, gate desk, baggage carousel, coffee shelf |
| Bank (16 × 12.5) | Four teller counters behind glass with cash trays, queue posts and rope, vault door with wheel and bolts, deposit-box wall, ATM, manager's desk |
| School (16 × 12) | Blackboard, 50 pupil desks facing it, teacher's desk, book shelves, class rug |
| Police station | Front desk, two barred holding cells, locker bank, evidence shelves |
| Restaurant / food court | Hot-food serving counter with warming lamps, dining sets, drinks fridge, menu board |
| Gym | Two treadmills, dumbbell rack, bench press, mat, reception, mirror wall |
| Shop / supermarket | Gondola shelving full of goods, glass-door drinks fridges, two tills, trolleys |
| Garage | Workbench, tyre stacks, oil drums, pegboard of tools |

Offices, kiosks and restaurants pick a **variant from their own id**, and offices
also scale their furniture to the size of the room, so two offices on the same
street are not identical.

The props are checked by what they are, not by eyeballing a screenshot: every
prop group carries its factory name, `InteriorBuilder` turns that into a
manifest, and **`client/test-venues.mjs`** asserts that the market reports
stalls, the church pews, the airport check-in desks, and so on — 82 checks.

### 7. Furniture that no longer blocks you

Two changes: colliders are **inset by 0.18 m** (the bounding box of a sofa is not
the space you walk through), and decor under 0.75 m² — rugs, stools, plants, side
tables — is **no longer solid at all**. Every interior is then flood-filled on a
0.2 m grid from the spawn point to prove the floor is reachable:

```
before:  the three small apartments were 65% reachable — the bedroom wing was
         sealed by a bathroom wall that crossed its doorway
after:   every interior is >= 91.8% reachable (most are 100%)
```

### 8. First person, and a camera you can actually aim

`V` now steps **third person → first person → top-down** (indoors it simply flips
between third and first, because a top-down rig in a 4 m room is useless).

* the camera sits at eye height (1.62 m, 1.05 m crouched) with a small walk bob,
* the avatar is hidden in first person — you see through your own eyes — and
  comes back the moment you leave it,
* look with a **mouse drag**, with **pointer lock** (click to capture, `Esc` to
  release, opt-in from the pause menu), with **touch drag** on the canvas, or
  with `,` `.` and `PgUp` `PgDn` if you have no mouse at all,
* pitch is clamped to ±82° so the view can never flip over the top,
* sensitivity, invert-Y and mouse capture live in the pause menu and are
  remembered between sessions,
* a badge in the corner always names the view you are in, and a crosshair appears
  only in first person. Clicking the badge changes the view, so touch players
  never need a keyboard.

`client/test-camera.mjs` — 36 checks — drives the real controller with a fake DOM
and proves each of those, including the sign of the pitch, the sensitivity
scaling, the invert-Y flip and that the wheel does nothing in first person.

### 9. Characters worth looking at

`player/Avatar.js` grew clothing and a wardrobe (`player/outfits.js`):

* **8 complete outfits** — casual, market trader, office, student, owambe, kaftan,
  modest wear, site worker — each with its own garment silhouette: a dashiki
  tunic, a flared kaba, a waistcoat, an open blazer,
* **headwear** (cap, gele, kufi, hijab), **footwear** (sneakers, loafers,
  sandals), **accessories** (watch, glasses, backpack, satchel), long or short
  sleeves with cuffs,
* 6 skin tones, 5 hair styles, 4 hair colours, 3 builds,
* the model no longer floats 6 cm above the ground, and wear is merged per
  material so a fully dressed character is ~35 draw calls, not 60,
* every NPC role wears its own outfit — the nurse in scrubs, the trader in a
  gele, the foreman in hi-vis and a cap — and remote players show their saved look.

`client/test-avatar.mjs` — 61 checks — builds every outfit, measures the height,
checks the feet are on the floor, swaps outfits ten times to prove nothing leaks,
and confirms the walk/idle animation still moves the joints.

### 10. Onboarding

The old sign-up was one form with two colour swatches. It is now a three-step
wizard with a **live 3D preview** of the character you are about to play:

1. **Account** — username and password, validated before anything is sent.
2. **Character** — skin, hair, build and outfit, with the same `Avatar` class the
   game uses turning slowly in the corner. "Surprise me" rolls a whole look.
3. **Start** — pick Nepo, Middle or Lapo, see a summary of your character, begin.

The look is saved on the account (new `POST /api/appearance`, plus
`hair_style`/`hair_color`/`body_type`/`outfit_id`/`bottom_color` columns with a
migration for existing databases), so signing in on another browser gives you the
same character. It can be changed later in the character panel (`I`) — the panel
edits the avatar you are actually wearing.

A four-card first-run guide follows login (move, camera, interact, needs); it
shows once per account and can be replayed from the pause menu. `test-onboarding.mjs`
— 50 checks — walks the wizard, including the "browser without WebGL" path.

### Judging it

Press **F2**. The panel now also reports parked cars, driving cars and the
number of draw objects the fleet costs. `Sky (baked cubemap)` toggles the sky so
you can see exactly how much of the look it is doing.

### New tests

```
client/test-streets.mjs      49 checks — the grid, the paint, no building in a
                             road, the anchors, traffic on the road and moving,
                             trees not cones
client/test-interiors.mjs    30 checks — flood-filled walkability per interior,
                             and that every layout is distinct
client/test-venues.mjs       82 checks — each venue contains the things it should
                             (stalls, pews, beds, check-in desks, tellers, …),
                             doorway clear, floor reachable
client/test-camera.mjs       36 checks — first person, pitch/yaw limits, mouse,
                             touch, pointer lock, zoom, third-person collision
client/test-avatar.mjs       61 checks — every outfit builds, sizes, no leaks,
                             animation still drives the joints
client/test-onboarding.mjs   50 checks — the creator's steps and validation, the
                             tutorial, the camera badge, the pause-menu settings
```

Both are part of `npm test`, which is green.

## The open world (wave 6)

Steps 1–11 built a city, a job system and multiplayer presence. Wave 6 turns it
into a playable open-world life sim: things you can hold, people you can talk
to, missions that pay, and cars you can actually drive.

### What is genuinely interactive

| System | What the player can do | Where the truth lives |
|---|---|---|
| Inventory | Buy food, water, soap, fuel cans and a phone at a shop; use them to move a need | `server/src/worldRoutes.js` + `config/itemConfig.js` |
| Needs | Six needs decay on game time; items, services and rest move them | `gameLoop.applyNeedDelta` (live session **and** DB) |
| Missions | Eight missions; accept from the journal, progress is derived from your row, reward paid on claim | `config/missionConfig.js` `check(state)` |
| NPCs | Ten named characters with roles, dialogue, memory within a session, and services that cost money | `client/src/world/NPCSystem.js` + `/api/world/service` |
| Vehicles | Six kinds (keke, taxi, saloon, SUV, danfo, okada), bought with real cash, driven with real physics, parked where you leave them | `server/config/vehicleConfig.js` + `client/src/world/VehicleSystem.js` |
| Districts | Walking into Mushin / Yaba / VI / Lekki sets a bitmap on your user row | `POST /api/world/visit` |
| Save | Auto-persist every 30 s, position every 10 s, plus an explicit "Save progress" in the pause menu that flushes and reports a timestamp | `gameLoop.persistUser` |

### Why the numbers can never disagree

Cash, bank balance, needs, inventory, missions and vehicles all read from the
same `users` row and the same tables, and every money movement happens inside
`withTransaction`. The client never computes a reward: it sends an intent
(`use this item`, `claim this mission`, `buy this service`) and re-renders from
the server's answer. If a route refuses, the panel shows the server's own
wording — "Accept the mission first", "You need to be at a shop to buy that",
"Give it 60s before that again" — rather than inventing a friendlier message.

### The anti-teleport rule and vehicles

`player:move` is clamped against `maxSpeed` (18 m/s) with a 1.5 m tolerance. A
vehicle the sender actually owns earns `maxVehicleSpeed` (34 m/s) instead —
ownership is looked up server-side and cached per session, so naming someone
else's vehicle id gets you nothing. Verified by three checks in
`server/test-world.mjs`: a 6 m hop is clamped on foot, accepted in your own car,
and clamped again when you claim a vehicle you do not own.

### Testing

```bash
cd server && npm run clean-db        # dry run: which accounts are test accounts
cd server && npm run clean-db:apply  # delete them (the tests fill the leaderboard otherwise)
cd server && node test-world.mjs     # 31 checks — real HTTP + real sockets
cd client && npm test                # syntax, bindings, world geometry
cd client && npm run test:ui         # 48 checks — panels, NPC dialogue, driving, in jsdom
```

`test-ui.mjs` runs the actual panel classes against the live server inside
jsdom and clicks the real buttons: it accepts a mission through the journal,
is refused when buying away from a shop, opens an NPC dialogue and confirms the
"buy food" option calls the server service, then drives a car forward, steers
it, watches fuel drop, and parks it. Three.js runs headless in Node for
everything except the WebGL renderer, so the vehicle meshes and NPC avatars are
built for real in that test.

## Tech Stack

| Layer    | Tech                                           |
|----------|------------------------------------------------|
| Client   | Vite + Three.js (vanilla JS, ES modules)       |
| Server   | Node.js + Express + Socket.IO + better-sqlite3 |
| Auth     | JWT (jsonwebtoken) + bcrypt                    |

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET  | `/api/health`              | —  | Health check |
| POST | `/api/signup`              | —  | Create an account |
| POST | `/api/login`               | —  | Log in (applies offline decay) |
| GET  | `/api/me`                  | ✓  | Current user (includes the saved character look) |
| POST | `/api/appearance`          | ✓  | Save the character look — validated against a whitelist |
| GET  | `/api/jobs`                | ✓  | List jobs + current job |
| POST | `/api/jobs/take`           | ✓  | Take a job |
| POST | `/api/jobs/quit`           | ✓  | Quit the current job |
| GET  | `/api/activities`          | ✓  | List activities + current one |
| POST | `/api/activities/perform`  | ✓  | Start an activity |
| POST | `/api/activities/cancel`   | ✓  | Cancel the current activity |
| GET  | `/api/properties`          | ✓  | List the housing market with your status |
| POST | `/api/properties/buy`      | ✓  | Buy a property outright |
| POST | `/api/properties/rent`     | ✓  | Rent a property (deposit + first period) |
| POST | `/api/properties/move-in`  | ✓  | Move into a property you own or rent |
| GET  | `/api/interactions`        | ✓  | Bank/shop points + shop stock |
| POST | `/api/interactions/bank/deposit`  | ✓ | Deposit cash (must be at a bank/ATM) |
| POST | `/api/interactions/bank/withdraw` | ✓ | Withdraw cash (must be at a bank/ATM) |
| POST | `/api/interactions/shop/buy`      | ✓ | Buy an item (must be at a shop) |
| GET  | `/api/leaderboard`         | ✓  | Top 10 players by net worth |
| GET  | `/api/inventory`           | ✓  | Your bag + cash + capacity |
| POST | `/api/inventory/buy`       | ✓  | Buy an item (must be at a shop) |
| POST | `/api/inventory/use`       | ✓  | Use an item — need effects resolved server-side |
| POST | `/api/inventory/discard`   | ✓  | Drop one of an item |
| GET  | `/api/missions`            | ✓  | Mission list with live step progress |
| POST | `/api/missions/accept`     | ✓  | Accept a mission |
| POST | `/api/missions/claim`      | ✓  | Claim a reward — completion re-derived server-side |
| GET  | `/api/vehicles`            | ✓  | Catalogue, owned vehicles, cash, fuel price |
| POST | `/api/vehicles/buy`        | ✓  | Buy a vehicle |
| POST | `/api/vehicles/park`       | ✓  | Park it (position clamped to the map) |
| POST | `/api/vehicles/fuel`       | ✓  | Refuel — must be within 8 m of the vehicle |
| POST | `/api/world/service`       | ✓  | NPC service (chat, street food, clinic) — price/effects/cooldown server-side |
| POST | `/api/world/visit`         | ✓  | Mark a district discovered |
| GET  | `/api/character`           | ✓  | Character sheet: stats, counters, districts, home |
| POST | `/api/save`                | ✓  | Flush to disk, returns a timestamp + snapshot |
| POST | `/api/logout`              | ✓  | Revoke every token for this account |
| POST | `/api/password`            | ✓  | Change password; returns a fresh token |

Auth endpoints (`/api/login`, `/api/signup`) are rate limited per IP and
return `429` with a `Retry-After` header when exceeded.

### Socket events

| Event | Direction | Payload |
|-------|-----------|---------|
| `player:update` | server → client | Cash, bank, needs, stats, job, activity, housing (`home`, `homeName`, `rentPaidUntil`, `rentAmount`, `isRentingHome`), `controlsLocked` |
| `home:event`    | server → client | `{ type: 'rent-paid', source: 'cash'\|'bank', amount, propertyName }` or `{ type: 'evicted', amount, propertyName }` |
| `world:init`    | server → client | On join: your socket id, the current player list, and recent chat |
| `world:players` | server → client | Position snapshot of other players, ~10×/second |
| `world:player-joined` / `world:player-left` | server → client | Presence changes |
| `player:move`   | client → server | `{ x, z, rot, moving, vehicle? }` — validated and clamped server-side; `vehicle` only raises the speed cap if you own it |
| `chat:message`  | both ways       | `{ username, text, at, system }`; server sanitises and rate limits |
| `chat:error`    | server → client | Rate-limit notice |

---

## Security

There is a **red-team suite** (`server/test-exploits.mjs`) that actively tries
to break the running server and fails CI if any exploit lands. Current state:

```
VULNERABLE: 0   BLOCKED: 20
```

### What it attacks, and what stops it

| Attack | Defence |
|--------|---------|
| Multiple tabs = duplicate income | One session per account: a second login kicks the first with a `session:replaced` event |
| Opening thousands of sockets (DoS) | Per-IP connection cap (8), checked before any auth work; proxy-aware via `X-Forwarded-For` |
| **Teleporting to a shop to buy remotely** | Server validates every movement packet: distance is capped at `maxSpeed × elapsed` (+1.5 units slack), so impossible movement is clamped, and the proximity check can't be bypassed |
| Speed hacking in multiplayer | Same movement validation — other players never see impossible jumps |
| Flooding the API with a valid token | Blanket limiter: 120 requests/minute/IP across every `/api` route |
| Brute-forcing passwords | 20 attempts/15 min per IP **and** 5 failures locks that account for 15 min regardless of source IP |
| Chat flooding | 1 message per 1.5 s per player, 200-char cap, control characters stripped |
| Reading another player's data | Public projections are **allowlists**. `sanitizeUser()` only emits an explicit field list — adding a DB column can never silently leak it |
| Internal state leaking (`token_version`, `password_hash`, `last_seen`) | Excluded from the allowlist; verified by the red-team suite |
| Token forgery / replay | HS256 pinned, issuer checked, 7-day expiry, `token_version` revocation on both REST and the socket handshake |
| Stealing a session after logout | Logout bumps `token_version`, killing every token for that account instantly |
| Username enumeration | Signup capped at 5/hour/IP. Usernames are already public (leaderboard, name tags), so confirming one exists reveals nothing private |
| SQL injection | All queries are parameterised (`better-sqlite3` prepared statements); verified by the suite |
| XSS via chat / usernames | Chat renders with `textContent`, never `innerHTML`; usernames are `[a-zA-Z0-9]{3,16}` |
| Oversized / malformed requests | 10 kb JSON cap (`413`), central error handler that never leaks stack traces |
| Clickjacking / MIME sniffing | `X-Frame-Options: DENY`, `nosniff`, CSP, `Referrer-Policy`, `Permissions-Policy` |
| Data drift after a crash mid-purchase | Every money+resource operation is one SQLite transaction |
| Weak/leaked signing key | Auto-generated 64-char secret at mode `0600`; production **refuses to boot** with a placeholder |

### What "unhackable" honestly means

No networked game is unhackable, and I won't claim otherwise. What the suite
above establishes is that **the specific classes of attack we can test are
closed**. What remains is a matter of degree, not of a missing lock:

- A player with a modified client can still **optimise within the rules** —
  e.g. spam-walk in a pattern that looks legal. Anti-cheat is a probabilistic
  arms race, not a fix.
- **Timing and behavioural analysis** can still infer things (e.g. whether a
  player is online).
- Anything after a **root compromise of the host** is out of scope.
- **No third-party pentest** has been done. That is the next real step if
  this ever handles real money or real identities.

### No user data leaks — where it stands

Verified by the suite: no other player's cash, bank, position history,
password hash, token version, or internal timestamps are exposed anywhere.
Usernames, net worth (leaderboard), avatar colours, and in-world position are
**public by design** — they are the game.

---

## Graphics: honest comparison with the reference screenshots

> **Status note (added later): this section is the *before* picture.** Every
> row below marked "None" or "9 primitives" has since been rebuilt — see
> [Visual overhaul — what actually changed](#visual-overhaul--what-actually-changed)
> for the measured after-state. This comparison is kept unchanged because it was
> the honest baseline, and because "we closed these specific gaps, and these ones
> are still open" is more useful than a rewritten summary.

You shared 20 screenshots of a shipped Lagos life-sim. I measured my own scene
so this comparison is fact, not impression.

### Measured numbers

| | Reference (from screenshots) | NewLife (measured) |
|---|---|---|
| Camera | Isometric / tilted top-down, whole room or district in frame | Third-person perspective, 60° FOV, 6 units behind the avatar |
| Interior spaces | Fully modelled rooms: walls, tiled floors, doorways, windows | **None.** Every building is a solid box; `enterable` is a flag that does nothing |
| Furniture | Individually modelled props (chair with back + legs, sofas with armrests, bed with mattress/headboard) | **None modelled.** 232 meshes, 13,650 triangles total, of which 0 are furniture |
| Avatar | Articulated low-poly human: elbows, knees, face, ears, sunglasses, hair styles | **9 primitives**, 576 triangles: sphere head, box hair, box torso, 4 limb boxes |
| Character creation | Body type, 7 hairstyles, 5 outfits, 4 fabric types, 10 skin tones, 10 hair colours | Skin colour + outfit colour only |
| Lighting | Soft ambient, contact shadows under objects, cohesive colour grading | 1 directional light + 1 ambient; PCF soft shadows; day/night tint |
| Unique art assets | Hundreds (rooms, props, billboards, vehicles, characters) | 156 geometries, 155 materials, 19 canvas-generated signs |
| Map mode | Dedicated map screen: district labels, clickable POI pins, 3-city switcher, lagoon/coast | 200×200 flat green plane, 4 districts, 106 buildings (87 are random grid filler), 2 roads |
| Navigation UI | Bottom tab bar (Home / Buy / Map / Phone) with full-screen sheets | Floating keyboard-driven panels (J/A/H/L) |
| Onboarding | Animated carousel, progress dots, character preview with drag-to-spin | None — you land straight in the world |
| Cities | Lagos, Port Harcourt, Abuja (switchable) | 1 city, 4 districts |
| Spatially specific content | Airport + flight booking, hospital with services, hotel with amenities, market with 8 shops, billboards, refinery | 5 job kiosks, 5 activity buildings, 5 properties, 1 ATM, 5 shop items |

### The differences that actually matter

**1. You live in rooms; I have no rooms.** This is the biggest gap. Every
interior screenshot (home, buy mode, hospital, hotel, market) shows a modelled
space you walk around inside. My `CityBuilder` produces `BoxGeometry` buildings
with AABB collision. `enterable: true` exists in `cityData.js` and nothing reads
it. Adding interiors is not a styling tweak — it's a new system: interior
scene graphs, doorway transitions, per-room collision, and a camera that
switches between third-person exterior and isometric interior.

**2. Camera language.** The reference is isometric — that's what makes the
rooms read as doll's houses and the city read as a map you can scan. I chose a
third-person chase camera in Step 2 because it's simpler for a large outdoor
world. These are incompatible; supporting both means a camera state machine.

**3. The avatar is the visible quality gap.** Mine is a walking stick figure. 9
primitives is what "build all 3D objects from Three.js primitives" gets you
without a character pipeline. The reference has a properly proportioned figure
with face, hair and clothing variants. I could add ~40 more primitives to
improve it, but it will never look like theirs without sculpted meshes or a
generated character rig.

**4. Art direction vs. systems depth.** Their screenshots show a game with
far more *content* than mine (3 cities, airport, hotel, hospital, market,
billboards). Mine has far more *simulation rigour* than a typical life-sim
prototype: server-authoritative needs decay, offline catch-up, rent collection
with eviction, atomic economy, movement validation, one-session-per-account.
If you put the two side by side, mine loses on looks badly and holds up on
the server. Both are true.

**5. UI polish.** Pills, tab bars, bottom sheets, rarity stars on catalogue
items, drag-to-spin previews, progress dots. My panels are functional dark
rectangles with system fonts and emoji. This is the cheapest gap to close.

### What I would do, in order, to close the gap

1. Isometric camera mode with a toggle (biggest visual payoff per hour).
2. Model interiors for the 5 property buildings + shops (walk in, camera cuts
   to isometric, furniture from primitives).
3. Rebuild the avatar with ~40 primitives: jointed knees/elbows, face, hair
   variants, clothing layers.
4. Replace emoji with a bespoke icon set (inline SVG).
5. Bottom tab bar + sheet UI to replace the keyboard panels.

At the time this was written, none of that was started: steps 1–11 built a
working, secure *simulation*, not a game that looks like the reference.

**All five are now done**, plus a sixth item that was not on the list and turned
out to matter more than any of them: *architecture*. A detailed facade on every
building, procedural PBR textures on every surface, and a post-processing
pipeline changed the read of the city more than the camera or the avatar did.
The measured results and the honest limits of what I could and could not verify
are in the next section.

---

## Visual overhaul — what actually changed

This pass was authorised to treat the reference screenshots as the floor and go
well past them, working every discipline (art direction, 3D, tech art, UI/UX).
It stays inside rule 4: **no downloaded art**. Every surface is a canvas texture
generated at runtime; every model is built from Three.js primitives.

### Measured, not claimed

Produced by `cd client && npm test` (numbers move slightly between runs because
the generated city heights are random per boot).

| Metric | Before this pass | After this pass | How it was measured |
|---|---|---|---|
| City triangles | 13,650 | **~280,000–310,000** | `scene-stats.mjs` |
| City draw calls (regular meshes) | 232 | **~173** | `scene-stats.mjs` |
| Unique materials | 155 | **88** | `scene-stats.mjs` |
| Texture generators | 0 (flat colours + 19 sign canvases) | **16 procedural PBR textures** | `textures.js` |
| Building parts per building | 1 box | **150–400 merged into ~13 meshes** | `BuildingFactory.js` + `mergeUtils.js` |
| Furniture props | 0 | **21 builders, ~120 instances placed indoors** | `furniture.js` |
| Interiors | 0 | **9 enterable rooms, 6 layout types** | `interior-stats.mjs` |
| Interior triangles (per room) | 0 | **4,500–12,600** | `interior-stats.mjs` |
| Avatar meshes / triangles | 9 / 576 | **26 / 4,024** | `scene-stats.mjs` |
| Joints that actually rotate | 4 (shoulder, hip) | **10** (shoulder, elbow, hip, knee ×2 sides) | `Avatar.js` |
| Camera rigs | 1 | **3** (chase, isometric, interior) with eased blending | `PlayerController.js` |
| Post-processing | none | **SSAO + bloom + SMAA + ACES tone mapping + IBL** | `PostFX.js` |
| UI icons | emoji | **30 inline SVG paths** | `icons.js` |
| Automated client checks | 0 | **31 module imports + 10 structural checks** | `npm test` in `client/` |

Note the draw call count did **not** rise even though the geometry got ~21×
denser. That is the whole point of `mergeUtils.js`: a district's worth of
detailed buildings collapses to one mesh per material, so detail costs triangles
(GPU-cheap) rather than draw calls (CPU-expensive).

### The design decisions behind it

1. **Procedural PBR textures.** Grass, asphalt, concrete, plaster, brick, roof
   shingle, rusted zinc, floor tile, wood, carpet, bathroom tile and water are
   all generated into canvases at boot with a seeded xorshift RNG, so the same
   building always looks the same. Textures are cached per `(name, repeat)` key
   and shared across materials.
2. **A material library, not per-mesh materials.** `materials.js` caches one
   `MeshStandardMaterial` per look. Building bodies are tinted from a 10-colour
   palette rather than cloned per building, which is why unique materials went
   *down* from 155 to 88 while visual variety went up.
3. **Architecture instead of boxes.** `BuildingFactory.js` composes: plinth +
   storey bands + a facade grid of recessed windows (reveal, glass, mullion,
   sill, lintel) on all four faces + corner pilasters + parapet/pitched roof with
   gable ends + rooftop water tank / satellite dish / AC / machine room +
   ground-floor shopfront with awning and crates + emissive sign board.
4. **Interiors are a separate scene.** `InteriorSystem` owns a second
   `THREE.Scene` with its own hemisphere/ambient rig, one point light per ceiling
   fitting and a directional "window light" with shadows. Entering swaps the
   scene, the collision set, the movement bounds and the camera rig. This avoids
   the whole city's shadow camera having to cover a room, and lets interiors be
   lit warm while the street outside is at midnight.
5. **Doors are found, not hard-coded.** `interiorData.js` picks one home per
   district from the generated city, then searches around each building's faces
   (front first, sliding along the wall) for a spot a 0.4 m player can actually
   stand in. `verify-world.mjs` asserts all 9 doors are reachable.
6. **Post-processing is tiered.** SSAO + bloom + SMAA on desktop; bloom + SMAA on
   touch; straight render on small or low-DPR phones. Press **Q** to override.

### What is still genuinely missing

- **I cannot see the result.** There is no headless browser in this sandbox
  (Chromium downloads but will not launch — missing system libraries, no root).
  Everything above is measured structurally: counts, budgets, import success,
  reachability, spawn clearance. It is **not** a claim that the frames look
  good. That judgement needs your eyes.
- **No sculpted or hand-authored models**, and no skinned/rigged animation.
  Limbs rotate as rigid cylinders at joint groups — there is no deformation,
  no shoulder twist, no cloth.
- **No baked lightmaps or real-time GI.** SSAO is a screen-space approximation
  and it will show halos on thin geometry.
- **No LOD system and no occluder culling.** A district is one merged blob, so
  it is culled all-or-nothing.
- **Interiors do not match their exteriors.** A 6 × 6 m building can contain a
  9 × 8 m room. Nobody has measured it, but it is true.
- **Nothing is instanced except trees and street lights.** Furniture is merged
  per room and cached, so a room is built once, but each distinct room is its
  own set of meshes.
- **No audio, no weather, no vehicles, no NPCs, no crowd** — unchanged from
  before this pass.

## Fixed: the pause menu that would not close

Reported after login: the pause menu was on screen immediately, and pressing
**Esc** did nothing. There were two independent causes, and only one of them was
in the pause menu.

**1. `.hidden` did nothing on the new components.** Every component written
before wave 6 defined its own `.x.hidden { display: none }` rule. None of the
wave-6 components did — and because `.pause-overlay` sets `display: grid` *later*
in the stylesheet, an element with `class="pause-overlay hidden"` stayed fully
visible. `classList.add('hidden')` was being called correctly and doing nothing.
Fixed with one utility rule, excluding the two overlays that fade out with
`opacity`:

```css
.hidden:not(.auth-overlay):not(#loading-screen) { display: none !important; }
```

**2. The Escape guard tested an element that never carries the class.** The
dialogue's visibility class lives on the wrapper `.dialogue`; the pause menu
checked `.dialogue-panel:not(.hidden)` — an inner node that is *always* present
and never hidden. That selector was permanently true, so `open()` was
unreachable: Escape could never open the menu, and the menu that was visible had
arrived by accident (cause 1). The same wrong selector also silently disabled
the action-bar number keys. Both now test `.dialogue:not(.hidden)`.

Also added while in there:

- **Click outside dismisses** the pause menu and the controls guide (the
  backdrop is the overlay element itself, so a click on a button inside the
  panel does not close it).
- **Escape now closes** the mission journal, character sheet, garage and
  inventory, not just the pause menu.
- **One Escape press, one action.** Several components listen for Escape on
  `window`, so closing a panel and opening the pause menu could happen on the
  same keypress. `ui/escape.js` marks the *event object* (not a timestamp, so
  two quick presses both work) and the pause menu skips a claimed press.

Regression test: `client/test-overlay.mjs` loads the real stylesheet into jsdom
and asserts computed `display` — that each component is genuinely off-screen
after construction, that Escape opens and closes, that a backdrop click
dismisses, that a button click inside does not, and that closing a panel with
Escape does not also open the menu. 25 checks, wired into `npm test`.

## Wave 6: what is still honestly missing

The brief for this wave was large, so here is the unvarnished list of what is
*not* in the build, next to what is:

| Asked for | Status |
|---|---|
| Walk / run / jump / crouch / camera / collision | Done, and unchanged from earlier waves |
| Persistent minimap, expandable full map, legend, destination select, distance, route on both maps | Done (`ui/MapSystem.js` + `nav/NavigationSystem.js`), 11/11 in `test-nav.mjs` |
| A* over the real navigation network, no wall-crossing routes | Done — the grid is rasterised from the same collision AABBs the player walks against; 0 illegal routes in 21 door-to-door tests |
| Doors that open, ATMs, shops, sitting, collecting, property | Done — 21 doors, 3 shop points, ATMs, activities, property market |
| NPCs with names, roles, dialogue, jobs, session memory | Done — 10 NPCs, role-specific trees, services priced server-side. Memory is per-session only, not persisted between logins |
| Inventory + use items that move a need | Done — 7 items, server-resolved effects |
| Missions you can accept and complete | Done — 8 missions, completion derived from your user row, rewards paid once |
| Vehicles you can enter, drive and leave, with a speed HUD | Done for **owned** vehicles. There are **no** traffic vehicles, no taxis you can hail, no bus routes you can ride, and no AI traffic. That was in the brief; it is not in the game |
| Mobile joystick + buttons with input detection | Done (pre-existing `TouchControls` + 10-button action bar), not re-tested on a physical phone from here |
| Save / load with confirmation before overwriting | Save is real (auto-persist + explicit flush + confirmation toast). There are **no save slots**: you have one continuous character, so there is nothing to overwrite and no overwrite prompt |
| Audio | **Not implemented.** There are no sound files in this project and I did not synthesise any. The brief's item 8 ("polish/audio") is only half done |
| Performance instrumentation / LOD | No LOD, no instancing beyond merged static geometry. Quality tiers change the post-processing chain, not geometry |

Two more things worth saying plainly:

- **I cannot see the game.** There is no GPU and no headless browser with WebGL
  in this sandbox, so every visual claim above is reasoned from code and from
  measurements (`scene-stats.mjs`, `test-ui.mjs`), never from looking at a
  frame. What *is* executed here: the whole server, every route, the socket
  protocol, the DOM layer of every panel, the NPC dialogue trees, and the
  vehicle simulation maths with real Three.js objects.
- **Vehicle physics are arcade.** Acceleration, steering grip and wall sliding
  are simple and tuned by hand; there is no suspension, no wheel-ray terrain
  contact and no gearbox. It drives, it collides, it burns fuel, it parks.

## What I could not do in this environment

Being explicit so nothing here is mistaken for finished work:

**Blocked by the sandbox (no root, no package installs):**
- **Postgres + Redis migration** — neither server installs, so no migrated
  code could be run even once. Plan is written up under "Known gaps". Doing it
  blind would mean shipping an untested rewrite of the database layer.
- **Browser screenshot verification** — I installed Chromium, but it needs
  `libnss3`, `libatk`, `libcups`, `libasound` and friends, which require root.
  So I have **never seen my own game rendered**. Everything I know about how it
  looks comes from reading the geometry code and the measured scene statistics
  above. Treat my visual claims as inferred, not observed.
- **Real-device mobile testing** — the touch controls and joystick are written
  and build cleanly, but have not been run on a phone.
- **Third-party security audit / pentest.**

**Not attempted (out of scope for Steps 1–11):**
- Interior spaces (see comparison above)
- Character creation beyond skin/outfit colour
- Onboarding flow
- Audio of any kind
- Animations beyond the procedural walk cycle and idle breathing
- Vehicles, driving, or fast travel
- NPCs — every player you meet is a real human
- Multiple cities
- Weather
- Save-file portability / account deletion
- Localisation

**Known cosmetic shortcuts:**
- Signs are canvas-drawn textures (19 of them), not designed art
- 87 of 106 buildings are procedurally generated filler with random heights
- Trees and street lights are `InstancedMesh` of one shape each
- The minimap is a 140×140 canvas drawn from the same data, not rendered 3D
- `'unsafe-inline'` in the CSP is required because the HUD sets inline styles

## Known gaps

### Why Postgres + Redis is not done

You asked for the Postgres + Redis migration. I could not do it honestly here:
this sandbox has no root, so neither server can be installed, which means
**I could not run a single line of the migrated code**. Shipping an untested
database rewrite of a working app would be worse than leaving it.

Here is exactly what the migration entails, so it can be done in an
environment that has both services:

1. **Schema** — translate `server/src/db.js`. The `users` table maps 1:1.
   `user_properties` gets a real `FOREIGN KEY (user_id) REFERENCES users(id)
   ON DELETE CASCADE` and a `CHECK (tenure IN ('owned','rented'))`.
   Replace the `runMigrations()` `ALTER TABLE` blocks with numbered migration
   files and a `schema_migrations` table.
2. **Queries** — `better-sqlite3` is synchronous, `pg` is async. Every
   function in `db.js` becomes `async`, and `withTransaction()` becomes a
   `BEGIN`/`COMMIT`/`ROLLBACK` wrapper using a checked-out client (not
   `pool.query`, which may use a different connection per call).
3. **Cash** — the in-memory cash cache in `gameLoop` is the single-process
   limitation. Move it to Redis (`cash:{userId}`), with SQLite/Postgres as
   the durable store. That also fixes the 5-second crash window.
4. **Rate limiting** — `rateLimit.js` counters move to Redis with `EXPIRE`,
   so limits survive restarts and are shared across instances.
5. **Sessions** — the lockout map and `Multiplayer.sessions` move to Redis so
   several instances agree on who is online.
6. **Tests** — `test-*.mjs` must run against the configured database; add a
   docker-compose with Postgres + Redis for CI.

The code is already structured for this: every money operation goes through
`economy.js`, every DB access through `db.js`, and every limit through
`rateLimit.js`. Nothing outside those three files needs to change.

### Other known gaps

- **Single process only.** Cash lives in server memory (flushed every 5 s) and
  limit counters are per-process, so two instances would fight over balances.
  This is the main thing blocking scale — see above.
- **SQLite.** Fine to a few hundred concurrent players, then it's the bottleneck.
- **Up to 5 s of income can be lost on a hard crash** between cash flushes.
- **No password reset flow** (needs email delivery).
- **No email verification, 2FA, or account deletion.**
- **HTTPS is assumed to be terminated by a proxy.** HSTS is set only when
  `NODE_ENV=production`.
- **CSP allows `'unsafe-inline'` for styles** because the HUD sets inline style
  attributes.
- **Rate limiting and lockouts are in-memory**, so a restart clears them.
- **No third-party security audit.** The red-team suite covers the classes of
  attack listed above; it is not a substitute for a pentest.
- **Client rendering is unverified.** There is no headless browser in the
  development sandbox, so the visual overhaul is checked structurally
  (module imports, geometry budgets, door reachability, spawn clearance) but
  has never been looked at. Any statement about how it *looks* would be a guess.

## Deployment checklist

Before exposing this to real users:

1. `cd server && npm run gen-secret` — rotate the JWT secret.
2. Set `NODE_ENV=production`, and a real `CLIENT_ORIGIN` (e.g.
   `https://newlife.example.com`).
3. `npm run build:client` so the server serves the game itself.
4. Put it behind a TLS-terminating proxy (nginx, Caddy, Fly, Render) and make
   sure `X-Forwarded-For` is set — the rate limiter uses `req.ip`.
5. Point `DB_PATH` at a persistent volume.
6. Confirm `server/.env` and `server/data/` are **not** in version control
   (the CI job fails the build if they are).
7. Set `API_RATE_MAX=120` and `SIGNUP_RATE_MAX=5` (the secure defaults; the
   dev `.env` deliberately relaxes them so local testing isn't throttled).
8. Run `npm test` — 161 functional checks plus the red-team suite must pass,
   with `VULNERABLE: 0`.
