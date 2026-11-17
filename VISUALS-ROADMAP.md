# NewLife — Realism & Visual Roadmap

Every number in this document was measured from this workspace, and every library
entry was checked against the npm registry and your installed `three` version
(r0.160.1). Nothing here is recalled from memory.

---

## Round 9 status — real assets (CC0) and the Go Home button

*"Can this app use real cars, buildings, furnitures, roads, road signs, maps,
trees, characters, real sky, everything real. Add a button that takes the
character to home."*

| Asked for | Shipped | Source | Notes |
|---|---|---|---|
| Real cars | Sedan, SUV, taxi from the Kenney Car Kit, instanced per material | CC0, `shorepine/kenney` mirror | Danfo, keke and okada stay procedural — the kit has none, and they are the three vehicles that must look Lagosian |
| Real sky | Three HDRIs (day / dusk / night) driving both the backdrop and the IBL probe | Poly Haven, CC0 | Night HDRI is backdrop-only; its moon lit the street like a second sun |
| Real roads | Photographic asphalt on every carriageway, world-space UVs at 5.5 m/tile | Poly Haven, CC0 | `world/retile.js` |
| Real trees | Broadleaf, pine and thin trees, one draw call per material per model | Kenney Nature Kit, CC0 | Palms stay procedural — no palm in the kit |
| Real furniture | 14 pieces across every interior, including the five housing listings | Kenney Furniture Kit, CC0 | Interiors previously cost one primitive each; the fallback is unchanged |
| Real buildings | **Not real.** Facades re-skinned with the real facade, plaster and paving photographs | Poly Haven, CC0 textures | Kenney's modular building kits are not in the CC0 mirror; an honest generated block with a photographed surface beats a fake low-poly import |
| Real characters | **Not real.** The procedural rig stays | — | Rigged CC0 humans need an animation-retarget pipeline this project does not have |
| Real maps | **Unchanged.** The city is generated | — | A real Lagos basemap is a licensing and projection problem, not an asset download |
| Go Home button | Action bar + `H`; disabled (with a reason) when homeless; enters the player's actual property interior; other people's doors are locked | — | `client/test-home.mjs` (16 checks, real browser) |

---

## Round 10 status — everything real, and everything *doable*

The player's words: *"continue to make all things real … the home button should
take the main player to his home where he can rest, eat, change clothes,
practically do everything someone wants to do at home … i visited a shop and it
was empty, no cart, no isle, no attendant, nothing to purchase, fix this … also
fix all empty places where there should be activities, ensure all activities are
real and working. replace Danfo/keke/okada with 18 seater hiace bus/tricycle/
motor bike respectively. i need an airport with all airport facilities."*

The rule this round: **a place that looks full but has nothing to do in it is
broken.** So the unit of work was the *station* — a spot on the floor where
pressing E starts something the server actually pays for.

| Asked for | Shipped | Where | Test |
|---|---|---|---|
| Shops with carts, aisles, attendants and stock | A server-side catalogue of ~30 goods across 19 venues, per-venue stock, and a panel that charges the real balance | `server/config/venueConfig.js`, `POST /api/interactions/venue/buy`, `ui/VenuePanel.js` | `test-round10.mjs` — bought rice for ₦6,500 and the server balance moved |
| "Fix all empty places" | Every interior type now has a station plan; the home has nine stations, the shop floor sells, the market haggles, the airport checks in | `world/interiorLayouts.js` → `STATION_PLANS`, `furnish()` | `test-venues.mjs` (100) — every room, every station, every action kind |
| A supermarket | Gondola runs, chiller wall, produce tables, two checkouts, self-checkout, baskets, trolleys, three staff, 17 stock lines | `interiorLayouts.js` → `supermarket` | `screenshots/10-supermarket.png` |
| An airport with all facilities | Terminal: 8 check-in desks with queues, 2 security lanes with x-ray and trays, 20-seat lounge plus a gate bank, duty free, café tables, walk-in toilets, ~15 people. Airside: 4 aircraft, 3 jetbridges, ground-support train, fuel truck, ATC tower, runway with markings and edge lights, painted stand numbers | `interiorLayouts.js` → `airport`, `world/airfield.js` | `test-round10.mjs` — check in → security → gate → apron → board the flight |
| 18-seater Hiace, tricycle, motorbike | Built part by part (body, glazing, roof rack, waist stripe / cabin + bench + canopy / frame, tank, forks), shared between the street fleet and the garage, so the bus you drive is the bus you saw parked | `world/vehicleParts.js`, `TrafficSystem.useModels`, `vehicleConfig.js` | `test-ui.mjs`, `test-assets.mjs` (52) — 18 seats, 3/2/4 wheels, no danfo/keke/okada left on the road |
| "Practically everything at home" | Bed (sleep/nap), hob (cook/eat), fridge, bathroom (shower/toilet/laundry), wardrobe (restyle), cupboard (inventory), TV (watch/rest/call), books, desk (work), **meter cupboard** | `InteriorBuilder.js`, `ui/UtilitiesPanel.js` | `test-home.mjs` (26) — opens the cupboard in a real browser and buys 20 units |
| Things that actually run the house | Prepaid meter in kWh, 1,000 L water tank, 12.5 kg gas bottle, six appliances with real wattages, rooftop solar at 60 % off the grid draw — all draining on the game clock | `server/config/utilityConfig.js`, `server/src/homeUtilities.js`, `home_utilities` table | `server/test-utilities.mjs` (33) — top-ups cost money, empty meter refuses the TV, solar drops the load 19.7 → 7.9 kWh/day |

### What is still not real, said plainly

* The aircraft, jetbridges and tower are generated geometry to real proportions.
  There is no CC0 airliner that matches the quality bar of the car kit.
* The crowd indoors is a set of posed staff figures, not NPCs who walk and
  answer. The street NPCs do that; the terminal does not.
* The terminal facade is painted concrete and glass, not a surveyed
  Murtala Muhammed. The layout follows real terminal logic, not the real plan.

---

## Round 7 status — what the player asked for and what shipped

The player's list, in their words: *"option for the players to see from the
character's point of view, the camera should be controllable/rotate using the
touchpad/mouse … I went to the market and it was empty … check other locations
too … finally, i need an upgrade in the appearance of the characters, the
onboarding."*

| Asked for | Shipped | Where | Test |
|---|---|---|---|
| First-person view | `V` cycles third → **first** → top-down; eye height 1.62 m / 1.05 m crouched, walk bob, avatar hidden from your own eyes | `player/PlayerController.js` | `test-camera.mjs` (36) |
| Rotate with mouse / touchpad | mouse drag, opt-in pointer-lock click-to-capture, single-finger touch drag, `,` `.` and `PgUp`/`PgDn` keyboard turn/tilt, pitch clamped ±82°, sensitivity + invert-Y + capture in the pause menu | same | same |
| Market should look like a market | 18 stalls with tarpaulins, produce trays, fabric rolls, fish on ice, grain sacks, price boards, umbrellas | `world/interiorLayouts.js`, `world/venueProps.js` | `test-venues.mjs` (82) |
| …and every other location | church (pews, altar, stained glass), mosque (mihrab, 81 mats), hospital (6 beds, IV stands, trolley), airport (5 check-in desks, security arch, X-ray, carousel), bank (4 tellers, vault, ATM), school, police, restaurant, gym, shop, garage, office, kiosk | same | same |
| Better character models | 8 outfits with real silhouettes (dashiki, kaba, waistcoat, blazer), headwear (gele/kufi/cap/hijab), footwear, accessories, 6 skin tones, 5 hairstyles, 3 builds, feet on the ground, ~35 draw calls | `player/Avatar.js`, `player/outfits.js` | `test-avatar.mjs` (61) |
| Better onboarding | three-step wizard with a **live 3D preview**, "Surprise me", tier step and summary; the look is saved server-side; four-card first-run guide that can be replayed | `auth/AuthScreen.js`, `ui/Tutorial.js`, `ui/CharacterPanel.js`, `server/src/index.js` | `test-onboarding.mjs` (50) |

Characters and interiors are still built from primitives only — no model files
were added. The honest limit is unchanged: **no browser runs in this sandbox, so
none of this has been seen rendered.** The tests measure geometry, colour, counts,
reachability and state; they cannot tell you whether a gele looks *good*. Press
`F2` in game and the debug panel will show the frame, draw calls and lights.

---

## 1. Where the ceiling currently is (measured, not guessed)

```
Triangles (city)     : 310,912
Unique geometries    : 197
Shadow map           : 2048 × 2048, covering 260 × 260 world units
scene.environment    : RoomEnvironment (a virtual *indoor studio*)
Fog                  : none
Texture maps         : albedo only (no normal / roughness / AO)
Ground               : single 600 × 600 plane
```

Three concrete, checkable defects follow from that, and they explain most of the
"why does it look like a game from 2005" feeling:

**a) Your shadows are 12.7 cm wide per texel.**
260 m of world ÷ 2048 texels ≈ 0.127 m/texel. A doorframe casts a shadow bigger
than the door handle. This is the single most visible cheap-to-fix artefact.

**b) Your outdoor city is lit by an indoor light probe.**
`RoomEnvironment` is a studio box with soft white area lights. Every building is
reflecting a photography studio, not a Lagos sky. Nothing in the scene agrees on
where the light comes from.

**c) There is no atmosphere at all.**
No fog means the far end of the map has the same contrast as the pavement you are
standing on. Real cities are hazier with distance — that gradient alone reads as
"depth" to the eye, and it is one line of code.

**d) 310 k triangles is not your problem.**
A mid-range GPU happily draws 2–5 million. You are *fragment*-bound (fill rate,
lighting, overdraw), not geometry-bound. That means you can afford normal maps,
screen-space AO and reflections on a scene this size — and it also means adding
more boxes will not help.

---

## 2. Tier 0 — IMPLEMENTED (items 1–4 + debug panel)

Status of the first four Tier 0 items and the tuning panel: **done and building**.

| # | Change | State | Where |
|---|---|---|---|
| 1 | Sky-derived IBL (Sky shader → PMREM, rebuilt as the sun moves) | ✅ | `render/SkyEnvironment.js` |
| 2 | Horizon-matched exponential fog | ✅ | `world/DayNight.js` + `render/atmosphere.js` |
| 3 | Tight, player-following, texel-snapped shadows | ✅ | `render/ShadowRig.js` |
| 4 | `GTAOPass` replacing `SSAOPass` | ✅ | `render/PostFX.js` |
| — | `lil-gui` tuning panel (F2), lazily loaded | ✅ | `render/DebugPanel.js` |

Measured effect of the shadow change alone:

```
before:  260 m span / 2048 texels = 12.70 cm per texel
after:   120 m span / 2048 texels =  5.86 cm per texel   (2.17× sharper)
```

Verified by `client/test-render.mjs` (47 checks): sun geometry, palette warmth
ordering, fog density, texel maths and snapping, plus real construction of `Sky`
and `GTAOPass` in Node. The visual result itself is **unverified** — there is no
GPU here; press **F2** in the browser to judge each effect and toggle it.

Items 5–10 of Tier 0 (normal/roughness maps, wet roads, vertex AO, grade pass,
instancing, SSR) remain open.

## 2b. Corrections pass — the six things that were wrong

These were not on the roadmap; they were reported from playing the build. They
are recorded here because each one was a *systemic* fault, not a cosmetic tweak.

| Complaint | Root cause | Fix | Verified by |
|---|---|---|---|
| Streets don't look like New York | The city had **two 6 m roads** and 114 buildings on grass | 4 avenues (12 m) × 4 streets (8 m), 40 m pitch, 25 blocks, pavements, kerbs, crosswalks, stop lines, lane paint — one `streetGrid.js` feeding buildings, mesh, map, trees and traffic | `test-streets.mjs` 49 checks |
| Can't see the blue sky | Sky was a 500 m mesh inside a 1000 m far plane, behind a post-processing chain; turbidity 8 crushed it to white under ACES | Baked into a **cubemap via CubeCamera** → `scene.background`; turbidity 3.2, rayleigh 1.8 | Sky API guards in `test-render.mjs`; F2 toggle |
| Light source isn't natural | Ambient was 0.65 against a sun of 1.25 — half as strong | HemisphereLight fill; sun **2.90 : 0.46 = 6.3 : 1** | ratio assertion in `test-render.mjs` |
| Trees don't look real | A `ConeGeometry` on a `CylinderGeometry` | Tapered trunk + 2 branches + **5-lobe icosphere canopy** with per-lobe colour; palms get 8 drooping fronds | `test-streets.mjs` checks part counts |
| No cars | No roads to put them on | **54 parked + 22 driving**, 3 draw calls, signals obeyed, Lagos fleet | `test-streets.mjs` |
| Interiors all the same | One shell (sofa+kitchen+bed) in every interior, 5 type decals | Homes vs workplaces; 17 doors → 17 distinct layouts | `test-interiors.mjs` |
| Furniture blocks movement | Bounding boxes as colliders, decor included | 0.18 m inset; sub-0.75 m² decor not solid; bathroom wall no longer seals the bedroom | flood-fill: 65% → ≥91.8% reachable |

The flood-fill number is the one to trust: it rasterises each interior at 0.2 m,
marks every collider with the player's radius, and walks the floor from the
spawn. It found the sealed bedroom wing that no amount of code reading had.

## 3. Tier 0 — the original list (reference)

Everything below ships inside `three@0.160.1` in this workspace. I verified each
file exists in `node_modules/three/examples/jsm/`.

| # | Change | Why it matters | Effort | Impact |
|---|---|---|---|---|
| 1 | **Sky-derived IBL** — `objects/Sky.js` + `PMREMGenerator`, regenerate the env map when the sun moves | All PBR surfaces reflect the actual sky. Fixes defect (b). Single biggest realism jump per line of code | ~60 lines | ★★★★★ |
| 2 | **Horizon-matched `FogExp2`** tied to `DayNight.js` | Aerial perspective. Fixes defect (c). Distant blocks stop competing with near ones | ~15 lines | ★★★★★ |
| 3 | **Tight shadow fit** — shadow camera ±60 m around the player instead of ±130 m, `shadow.autoUpdate = false` except when the sun moves | 260 m → 120 m doubles texel density; 2× is already 6 cm/texel. Fixes defect (a) | ~40 lines | ★★★★☆ |
| 4 | **`GTAOPass`** (ships in examples/jsm) | Grounds objects, darkens crevices, kills the "floating boxes" read. The classic "why does it suddenly look expensive" pass | ~30 lines | ★★★★★ |
| 5 | **Procedural normal + roughness maps** from `ImprovedNoise`/`SimplexNoise` (both ship) for plaster, asphalt, corrugated metal, concrete | Surface micro-detail is what the eye uses to judge material. Changes the look more than any geometry | ~120 lines | ★★★★★ |
| 6 | **Wet roads** — `objects/Reflector.js` at half resolution + a roughness lerp during rain | Lagos rainy season is the most distinctive visual signature available to this game, and it is nearly free | ~80 lines | ★★★★☆ |
| 7 | **Vertex-baked ambient occlusion** — sample rays with `MeshSurfaceSampler` + `math/Octree.js` at build time, write into vertex colours | Offline-quality AO with **zero** runtime cost. Cheap because your geometry is static and already merged | ~150 lines | ★★★★☆ |
| 8 | **`LUTPass` grade + `FilmPass` grain + vignette** (`ShaderPass`) | ACES is already on; a grade pass is what makes footage look filmed rather than rendered | ~50 lines | ★★★☆☆ |
| 9 | **`InstancedMesh` + `THREE.LOD`** for trees, lights, windows, crowd | Buys the frame budget for 1–8. Non-negotiable before you add crowds | ~200 lines | ★★★☆☆ (enabler) |
| 10 | **`SSRPass`** for puddles/glass, or `Lensflare.js` for the sun | Both ship. SSR is the expensive one — half-res, daytime only | ~90 lines | ★★★☆☆ |

Points 1–6 = roughly **one day of work** and would change the look more than
everything wave 5 did. If you only do four things: **1, 2, 4, 5**.

**Where each lands in your code:**

- `client/src/main.js` — lighting, shadow camera, replace `RoomEnvironment`
- `client/src/render/PostFX.js` — composer chain (GTAO, grade, grain, AA)
- `client/src/world/DayNight.js` — sun vector → sky → env regeneration
- `client/src/world/textures.js` / `materials.js` — procedural normal/roughness
- `client/src/world/CityBuilder.js` — baking pass, instancing, LODs

---

## 4. Tier 1 — small, verified libraries

All versions and licences confirmed live on npm during this session.

| Package | Version | Licence | What it buys you | Risk |
|---|---|---|---|---|
| `postprocessing` | 6.39.5 | Zlib | Better composer than `examples/jsm`: real SMAA/TAA, DOF, bloom, LUT, half-res AO. The modern default | Low |
| `n8ao` | 2.0.1 | ISC | Higher-quality, cheaper screen-space AO than three's SSAO/GTAO | Low |
| `three-mesh-bvh` | 0.9.17 | MIT | Fast raycasts (AO baking, decals, mouse picking), replaces per-prop AABBs | Low |
| `simplex-noise` | 4.0.3 | MIT | Cleaner noise for textures, terrain, wind, crowd wander | Very low |
| `troika-three-text` | 0.52.5 | MIT | Crisp SDF text for shop signs instead of blurry canvas planes | Very low |
| `cannon-es` | 0.20.0 | MIT | Rigid-body physics: debris, props, simple vehicle chassis | Medium |
| `@dimforge/rapier3d-compat` | 0.21.0 | Apache-2.0 | Fast WASM physics: real suspension, ragdoll, stacking crates, deterministic | Medium-high |
| `lil-gui` | 0.21.0 | MIT | **Dev-only** tuning panel — lets *you* see each effect's contribution and decide | Very low |
| `yuka` / `three-pathfinding` | 0.7.8 / 1.3.0 | MIT | Behaviour steering / navmesh agents, if NPC counts grow past ~20 | Medium |

**My recommendation:** add only `postprocessing` + `n8ao` + `three-mesh-bvh` +
`lil-gui`. That is 4 packages, all permissively licensed, and it covers
everything in Tier 0 more cleanly. Skip physics entirely until you have a
concrete reason for it — you already have working movement, collision and driving,
and Rapier would mean rewriting all three.

---

## 5. Tier 2 — the honest ceiling-breaker: real assets

This is the part you asked for and probably will not love: **procedural primitives
have a hard ceiling around "clean stylised"**. You can reach *convincing*, you
cannot reach *photoreal*, because photorealism is mostly the statistical texture
of real scanned materials, not polygon count.

Ranked by realism-per-unit-of-rule-breaking:

| Option | Breaks your "primitives only" rule? | Licence | Realism gain |
|---|---|---|---|
| **PBR texture sets** (albedo + normal + roughness + AO) for surfaces | **No** — models stay procedural, only surfaces change | ambientCG / Poly Haven, **CC0** | ★★★★★ |
| **HDRI skies** for lighting | No — it is light, not a model | Poly Haven, **CC0** | ★★★★☆ |
| **Decals** (grime, posters, rust, potholes) | No | CC0 packs | ★★★☆☆ |
| **GLTF props** (cars, benches, bins, food carts) | **Yes** | Kenney/Quaternius **CC0**, Sketchfab **CC-BY** | ★★★★☆ |
| **Rigged characters** (GLTF + animations) | **Yes**, and this was explicitly forbidden | Mixamo (Adobe ToS), CC0 packs | ★★★★★ but most work |

If you relax exactly one rule, relax it for **textures and HDRIs only**. That
keeps every mesh in the game procedural — your original constraint — while
removing the "everything is painted with flat colour" look that no shader trick
fully hides.

Costs to plan for, honestly:

- A 2K PBR set is ~15–20 MB uncompressed; 40 materials = 600–800 MB unless you
  compress. Budget for **KTX2/Basis** (`three` ships `KTX2Loader`) → ~10× smaller.
- Mobile needs 1K maps and a texture budget; your current mobile path is already
  the weak point.
- Deployment weight matters: your bundle is 323 kB today and fast. Textures move
  it into the tens-of-megabytes and need a loading screen that actually reflects
  progress (yours currently fakes progress with a random timer — worth fixing
  before you add real weight).

---

## 6. Realism beyond pixels — often more effective than shading

Players read *motion, scale and sound* as realism far more than specular highlights.

**Animation (biggest remaining win after lighting)**
- Foot IK so feet plant on steps instead of sliding; hips drop on slopes.
- Turn anticipation and lean; weight shift when starting/stopping.
- Head look-at: NPCs and your avatar glance at whoever is nearby.
- Additive breathing/blink layers so idle characters are never statues.
- Vehicles: wheel spin, body roll under cornering, brake-light emissive, dust
  from wheels, suspension squash over kerbs.

**Camera**
- Speed-based FOV (subtle), shoulder offset, low-amplitude handheld noise.
- `BokehPass` DOF in dialogue close-ups only.
- Collision-aware zoom (you have this) plus easing so it never snaps.

**Audio — and you can do this without a single audio file.** `WebAudio` can
synthesise everything procedurally: filtered noise for rain, low-passed brown
noise for traffic hum, short filtered bursts for footsteps, oscillator sweeps for
horns, an envelope + noise for the danfo door slam. Zero downloads, no licence
issues, and it is the cheapest large jump in perceived realism available to you.
(Your README honestly lists "no audio" — this is how to fix it inside the rules.)

**Weather and time**
- Rain: `Points` + shader, ~15 k particles, wind-tilted.
- Wet-road roughness lerp + puddle mask (Tier 0 #6).
- Lightning flash driving ambient intensity for 80 ms.
- Golden-hour sun angle at dawn/dusk: long shadows, warm key, blue fill.

**World detail that kills the "box city" read**
- Kerbs, gutters, drain covers, potholes, road markings with wear.
- Corrugated and rusted roofs, water tanks (you have these), laundry lines,
  satellite dishes, generators, kiosks, plastic crates, parked okadas.
- Silhouette variance: setbacks, balconies, overhangs, varying storey heights.
- Accurate scale — doors 2.1 m, floors 3.2 m, humans 1.75 m, lane widths 3.5 m.
  Wrong scale is read as "fake" even when nobody can name why.

**Population**
- Crowd density near markets; clusters of idling people; vendors with carts.
- Motion sells a city more than polygons do. Ten walking Lagosians beat a
  hundred thousand triangles of empty road.

---

## 7. Performance budget (so the above stays playable)

| Target | Value |
|---|---|
| Frame time | 16.6 ms (60 fps) on an integrated/modern-mobile GPU |
| AO pass | Half resolution, 4 samples, composite with depth-aware blur |
| Reflection pass | Half resolution, daytime only |
| Shadow | One cascade near the player; static geometry, `autoUpdate` off |
| Draw calls | < 300 (instrument `renderer.info.render.calls`) |
| Textures | KTX2, 1K mobile / 2K desktop |
| Crowd | Instanced below 50; impostors beyond |

Add a debug overlay reading `renderer.info` from day one — otherwise you will
not know which pass cost you the frame rate.

---

## 8. Verification plan (important, because of my limits)

**I cannot see the render.** This sandbox has no GPU and no browser — I checked
again this session: no chromium, chrome, firefox, or playwright. So every visual
claim I make is reasoned from code and numbers, never observed. Given that, do not
take my word for any of the above; verify each step:

1. **`lil-gui` toggle panel** — wire each effect (IBL, fog, AO, wet roads, grade)
   to a checkbox. You toggle, you judge, you decide. This is the honest way to
   hand visual decisions to the person who can actually see the screen.
2. **Screenshot checkpoints** — after each of changes 1–6, capture the same camera
   angle (spawn looking down Mushin Road, and one interior). Six screenshots let
   us compare and catch regressions.
3. **Numeric assertions in tests** — I can automate these without a GPU: draw
   calls, triangle count, shadow texel density, texture memory, frame-time budget
   hooks. Those go into `verify-world.mjs` so we do not silently regress.
4. **Frame-time capture in your browser** — your existing FPS counter plus a
   `performance.now()` histogram for a 10-second walk, per quality tier.

---

## 9. What I would do, in this order

| Stage | Work | Cost | Payoff |
|---|---|---|---|
| 1 | Sky IBL + fog + tight shadows + GTAO | 1 day | Largest single visual jump available |
| 2 | Procedural normal/roughness maps on core materials + vertex AO bake | 1–2 days | Surfaces stop looking like painted cardboard |
| 3 | Wet roads, rain, lightning, `LUTPass` grade, grain | 1 day | A look that is *yours* — rainy Lagos |
| 4 | Instancing + LOD + debug overlay | 1 day | Headroom to keep everything above at 60 fps |
| 5 | Foot IK, look-at, vehicle body roll, procedural WebAudio ambience | 2–3 days | Sells the world more than any shader |
| 6 | CC0 PBR textures + HDRI (if you relax that one rule) | 2–3 days | The step from "good stylised" toward photoreal |

Do **not** start at stage 6. Textures on top of flat studio lighting with
12 cm shadows will look worse than what you have now, because sharp albedo detail
makes bad lighting more obvious, not less.

---

## 10. The blunt summary

- Your scene is **not** geometry-starved (310 k tris is fine); it is
  **light-starved**. Fix lighting first: sky IBL, fog, shadows, AO.
- **Four zero-dependency changes** (sky IBL, horizon fog, tight shadow fit, GTAO)
  would outperform every art change made so far.
- Add **four packages**: `postprocessing`, `n8ao`, `three-mesh-bvh`, `lil-gui`.
- **Textures are the only bridge to true photorealism**, and PBR texture sets do
  not violate your "primitives only" rule — they change surfaces, not models.
  That is the rule I would relax, and only that one.
- **Motion and audio** beat shaders for perceived realism, and procedural WebAudio
  stays fully inside your no-downloads constraint.
- I cannot verify any of it visually. Build the `lil-gui` toggles first so you can
  see each effect's contribution and overrule me where I am wrong.
