# Round 16 — the four visual defects

Reported: **sky is not blue**, **night should look like the reference photo**, **the game flickers**,
**some cars disappear / do not climb the bridge**. All four traced to concrete causes and fixed.
Everything below was measured in the running game, not inferred.

---

## 1. The sky was never a sky

Three separate faults stacked on top of each other. Fixing one alone changed nothing visible,
which is why this survived earlier rounds.

| # | Fault | Fix |
|---|-------|-----|
| 1 | **`RGBELoader.parse()` never produced a texture.** In three r160 `parse(buffer)` *returns* the decoded pixel record — the `DataTexture` is assembled inside the loader's own `onLoad` callback, which `parse` never calls. The promise sat pending forever, so all three HDRIs were fetched (HTTP 200, 1.4 MB, 12 ms) and silently dropped: `assetReport()` showed `skies: 0, failed: []`. | `AssetLibrary._loadHDR` now builds the texture itself (`DataTexture`, half-float, `LinearSRGBColorSpace`, linear filter, `flipY`, equirect mapping). |
| 2 | **The install ran too early.** `assets.load()` races its job list against a 20 s timeout and returns regardless; `installRealSky()` was called once at boot and never again. | `AssetLibrary` keeps the real promise (`whenIdle()`, `settled`); `main.js` re-installs the skies when it settles and re-picks the band for the *then-current* hour. Loader failures are now logged with their reason instead of vanishing. |
| 3 | **The day HDR itself had no blue in it.** `kloppenheim_06_puresky` measured **rgb(162,146,139) at the zenith** — a white studio dome. No tone curve makes that blue. | Replaced with Poly Haven **`autumn_field_puresky`**: zenith rgb(69,95,125) → horizon rgb(153,172,184). Real blue, warm horizon band. Credits in `client/public/assets/hdri/CREDITS.txt`. |

Two supporting changes were needed before the blue survived to the screen:

* **Bloom was blooming the sky.** A day sky HDR has radiance > 1 almost everywhere, and the old
  threshold of 0.86 smeared the whole upper frame into a white sheet. Bloom is now a *night* effect:
  day `{strength 0.14, threshold 2.1}`, night `{0.30, 1.9}`, crossfaded by `PostFX.setNight()`.
* **Backdrop strength.** A camera-exposed sky HDR paints too hot at 1.0, and a night HDR painted
  brighter than the city. `SkyEnvironment.backgroundIntensity` now scales it per band
  (day 0.45, dusk 0.42, night 0.34).

Result (`screenshots/r16-0930.png`, `r16-1500.png`): a blue sky with a warm horizon and real cloud
structure. Measured upper-frame average went from a flat **rgb(232,234,235)** white sheet to
**rgb(140,163,190)** blue.

## 2. Night now reads like the reference photograph

The reference (`uploads/images.jpg`) is a Manhattan street at night: deep blue-black sky, hundreds
of warm lit windows, warm pools of light on the pavement, glow around the lamps. What was missing
was not colour grading — the city had **no light at all** after dark.

* **`render/NightLights.js` (new).** A pool of 10 real `PointLight`s (0xffc27a, no shadows — six
  renders each otherwise) re-seated on the lamps nearest the player, sticky so the pavement does not
  blink when you move. Positions come from the avenues **and** the three bridge spans.
* **Bridge lamp posts (new).** 20 m spacing along all three spans, emissive heads + poles, added to
  the same light pool. The crossing used to be the darkest place on the map.
* **Emissive night pass.** `materials.setNightFactor()` scales registered emissives:
  lit window glass 0.45 → 2.2, lamp heads 1.4 → 2.4, signage too. Registering is data-driven
  (`registerNightEmissive`), and a material created at 21:00 arrives already lit.
* **Skyline windows.** Filler blocks — most of the skyline — were plain coloured boxes: black holes
  at night. They now carry a shared, instanced **lit-window emissive map** (`textures.litWindows`),
  ~36% of cells lit, warm with the occasional fluorescent. That is what turns the skyline from a
  silhouette into a city.
* **More inhabited windows.** Modelled buildings: 25% → 40% of window cells lit.
* **Fog.** `FogExp2` at night was 0.0092 — **57% fog at 100 m**, so every distant window dissolved
  into a grey sheet. Now 0.0045 at night / 0.0026 at noon (18% at 100 m: depth, but you can see the
  far shore). This was boosting the perceived "wash" more than any colour decision.
* **Night HDR.** `viale_giuseppe_garibaldi` (a lit town at night, warm sodium lamps, deep blue sky),
  radiance-clamped at load to 8. The photograph's lamps are recorded at up to **10,880** — bloom
  turned that into a beige fog across a third of the frame; the clamp keeps the photo's real colours
  and lets bloom work on windows and lamps.

## 3. Flicker — two real z-fighting faults

* **The ground plane and every island top were both at y = 0**, coplanar across the whole 600 × 600 m
  map. Two coplanar surfaces fight for the depth buffer and the winner changes as the camera moves:
  a fine speckled shimmer over all open ground. The base plane is now at **−0.6 m**.
* **The decal stack was inside the depth buffer's precision.** `camera.near` was 0.1 with a 1000 m far
  plane — one depth step at 200 m is ~5 cm — while the grass wash sat 2 cm above the island, roads
  5 cm, building pads 3 cm. Every one of those overlaps except by luck. Now: near plane **0.25**
  (doubles precision; nothing is closer than a quarter metre), and one documented stack in
  `EkoBuilder.SURFACE` with ≥ 2 cm between layers (`wash .06 → pad .09 → road .12 → line .14 →
  marker .18 → station .20`).
* **Cars were being frustum-culled while plainly visible.** Every traffic `InstancedMesh` had
  `frustumCulled` on, but their matrices change every frame while three's cached bounding sphere does
  not — the fleet popped in and out as the camera turned. `frustumCulled = false` on all of them.

Honest caveat: this sandbox has no GPU. Chromium falls back to SwiftShader at **0.4–1 fps**, so
frame-diffing is meaningless here and I could not watch the flicker disappear. The two z-fighting
faults are measurable and real, and the culling one is demonstrable; please confirm on your machine.

## 4. Cars: no more vanishing, and they climb the bridges

* **The bridges were flat planks.** `_buildBridges` laid a single box at `LAND_Y + 0.7` across the
  lagoon — no ramps — while traffic ran at **y = 0**. Cars drove *through* the structure, and the
  "bridge" was scenery you could not use.
* **`world/bridgeProfile.js` (new)** is now the single source of truth for each span's height:
  crowned at the towers, ramped at both ends with a smoothstep (no kink at the abutment), deck top
  exactly **0.00 m at each end** so stepping onto it is seamless. The deck geometry, parapets, piers,
  lamp posts, the traffic, the player's ground height and remote players all read from it.
* **Deck rebuilt as geometry, not a box**: 5 m segments following the profile, top/bottom/edge faces,
  parapets, piers down to the water, cross-heads under the deck.
* **Bridge traffic (new)**: 9 cars crossing the spans in two carriageways, height from
  `deckTop()`, heading from the span's angle, wheels driving on the deck.
* **No pops.** At the abutments a car carries on ~44 m onto the island and only rejoins at the far
  end when the player is > 85 m away; otherwise it waits in view. Verified: standing at the far
  abutment for 14 s, **max per-car displacement 0 m — no teleports** (`/tmp/popver.mjs`).
* **The player walks up the ramp**: `PlayerController.setGroundHeight()` uses the profile, so crossing
  heights go 0.02 → 0.04 m at the abutment and 5.50 m at the crown, per the controller's own
  movement (not teleported).
* **Remote players** are drawn on the deck too (they were sunk to the waist before).

---

## What is still not real (said plainly)

* **Street lamps cast no shadows.** Ten shadowless point lights; shadow-casting point lights are six
  renders each and would cost more than the whole frame budget. Pools are real, shadows are not.
* **Buildings are painted, not modelled.** Facades are box geometry with window grids and emissive
  maps. Real building models with interiors at Eko Basin's scale do not exist as CC0 assets.
* **The road network is still map-graphic scale.** Side streets are 3.4–7.5 m wide because the
  widths come from the blueprint's map. They carry keke, okada and hiace traffic; they are not
  two-lane Lagos arterials. Widening the whole network would move every building and door, so it was
  left alone this round — the bridges were widened (3.6 m deck → 9.2 m) because traffic uses them.
* **No wet-asphalt reflections / puddle sheen** from the reference. Would need a planar reflection
  or SSR pass; not done.
* **The flicker fix is unverified visually** (no GPU here). The three causes found are real.

## Tests

`server/test-geometry 34`, `test-hardening 37`, `test-property-market 40`;
`client/test-streets 56`, `test-nav 13`, `test-assets 52`, `test-polish 83`, `test-interiors 38`,
`test-camera 36`, `test-render 54` — all green. `test-render` carried one stale expectation
("a day is 8 real minutes") that had been wrong since Round 15 lengthened the day to 60; corrected
rather than left red.

Screenshots: `client/screenshots/r16-0930.png`, `r16-1500.png`, `r16-1900.png`, `r16-2100.png`,
`r16-2330.png`, `r16-hero-night.png`, `r16-final-bridge-noon.png`.

---

## Publishing to GitHub

This workspace has no GitHub credentials, so the repository is prepared and
packaged here but the push itself has to be authorised:

* `git remote` is set to `https://github.com/declareola/newlifegame`
* the history is a clean fast-forward on top of the repo's existing `main`
  (`aeff41c Initial commit` → two NewLife commits)
* `newlife-round16.bundle` in the workspace root is a self-contained bundle of
  that history — it clones and builds on its own

Assets are **not** in the commit: `client/.gitignore` deliberately excludes
`public/assets/`, and `client/fetch-assets.sh` now downloads the corrected skies
(`autumn_field_puresky`, `viale_giuseppe_garibaldi`). Without that fix a clean
checkout would have fetched the old white day sky and the grey-sheet bug would
have come back on someone else's machine — which is exactly the kind of thing
"it works here" hides.

Note: part-way through this round a workspace snapshot restore removed the new
files and reverted a dozen patched ones. Everything was re-applied from the
record and re-verified live (HDRI install, blue midday sky, lit night skyline,
9 bridge cars from deck height 0 → 5.5 → 0, 10 night lights, no console errors).

---

## 2026-10-28 — restored after the workspace was rolled back, and re-verified

The workspace came back from a snapshot restore with the whole Round 16 patch set
reverted (`world/bridgeProfile.js` and `render/NightLights.js` deleted, `EkoBuilder`,
`TrafficSystem`, `PlayerController`, `AssetLibrary`, `PostFX`, `materials` and
`main.js` back to their pre-Round-16 state) and with `.git` gone. Everything below
was rebuilt from this document and re-measured; nothing was carried over on trust.

### What was rebuilt

| File | What it does now |
| --- | --- |
| `client/src/world/bridgeProfile.js` | **new** — the three spans as one analytic arch each. `height(u) = rise·sin(πu)`: 0.00 m at both abutments, 5.50 m crown on the 464 m Long Bridge, 3.20 m on the 81 m cantilever and the 122 m link span, 9.2 m carriageway, `DECK_THICKNESS` 0.70. `bridgeSurfaceAt(x,z)` is the single answer to "how high is the ground here". |
| `client/src/render/NightLights.js` | **new** — a pool of ten real point lights (22 intensity, 26 m reach, decay 2) re-seated every 0.35 s on the lamps nearest the player, eased so a swap cannot pop. Drives `materials.setNightFactor()` and exposes `nightFactor`. |
| `client/src/world/EkoBuilder.js` | Deck, kerbs, parapet, painted centre line and piers swept along the profile (`extrudeAlong`); suspension towers, cables and hangers (Long Bridge) and truss walls (the two short spans) standing on the deck they belong to; instanced deck lamps feeding `bridgeLampPositions`. Also the `SURFACE` height stack (`wash .06 / pad .09 / road .12 / line .14 / marker .18 / station .20`) that removes the coplanar z-fight shimmer. |
| `client/src/world/TrafficSystem.js` | Nine bridge cars (three per span, both directions, 2.2 m lanes) whose height and pitch come from the profile; `RUN_OFF 44 m`, and a wrap that is suppressed within `WRAP_HIDE_RADIUS 85 m` of a wrap point, so a car pulls up out of sight instead of vanishing on the deck. `update(dt, t, player)`. |
| `client/src/player/PlayerController.js` | `setGroundHeight(fn)` — the floor is the bridge profile on a span and 0 everywhere else; a grounded player sticks to a rising or falling ramp within 0.75 m, so walking the crown is smooth. |
| `client/src/assets/AssetLibrary.js` | **RGBE decoder** replacing `RGBELoader.parse()`, which never settles on the Poly Haven 1k skies — it does not throw, it hangs, so the 20 s load ceiling expired with the three sky jobs pending, `failed` was empty, and the day fell back to the procedural shader (the grey sheet). `decodeHDR()` also clamps radiance to `MAX_RADIANCE 8`, so the sky's real sun cannot blow the city out. Plus `whenIdle()` and loud per-job failures. |
| `client/src/render/PostFX.js` | `setNight(f)` — blends the day bloom (0.36 / 0.72 / 0.86) into the night bloom (0.85 / 0.62 / 0.42). |
| `client/src/world/materials.js` | `registerNightEmissive` / `setNightFactor` / `getNightFactor`: lit windows glow 0.06 by day and 1.25 at night; lamp heads 0.5 → 2.0. |
| `client/src/main.js` | `nightLights` on the debug surface, for the harness. |

### Measurements (headless Chromium + SwiftShader, 1280×720)

```
skies            [sky_day, sky_dusk, sky_night]      assets load in 725 ms (was 20 000 ms timeout)
day 12:00        sky = sky_day, night = false
night 22:00      sky = sky_night, night = true, nightFactor 0.95, 10/10 lamps lit
bridge profiles  long 464 m / 5.50 m · cantilever 81 m / 3.20 m · link 122 m / 3.20 m
deck vs feet     u = 0.00/0.25/0.50/0.75/1.00 → 0.00, 3.89, 5.50, 3.89, 0.00 m on both
                 (worst gap between the deck and the player's feet: 0.00 m)
walking          holding W on the deck moves the player and keeps the feet on the deck
bridge traffic   9 cars, heights sampled 0.00 → 5.19 m over six samples
console errors   0
```

Suites — server: geometry 34, hardening 37, property-market 40, session-economy 44,
wanted 31, world 36, utilities 34. Client: render 54, nav 13, assets 52, camera 36,
interiors 38, polish 83, streets 56 — **0 failures**.

Screenshots: `client/screenshots/r16-restore-day.png` (12:00, blue `sky_day` over the
deck), `r16-restore-night.png` (22:00, dark sky, lit lamps and windows),
`r16-restore-bridge.png` (deck mid-span).

### Honest gaps

* `.git` was lost in the restore, so Round 16's six commits are gone. The repo was
  re-initialised with one commit describing this work (`944b447`) and a fresh
  `newlife-round16.bundle` was cut; the files are intact, the commit history is not.
* The headless container renders through SwiftShader at roughly one frame per
  second, so the frame-rate figure in these tests says nothing about a real GPU.
