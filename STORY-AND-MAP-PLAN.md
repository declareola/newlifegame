# Story and a new map — what to use, what to avoid

Researched against how NewLife is actually built (Vite + Three.js vanilla, server-
authoritative, SQLite, procedural city, `missionConfig` predicates). Every repo
below was checked for licence, maintenance and fit — not just "it exists".

---

## 1. The short list

| Repo | Licence | What it gives you | Verdict |
|---|---|---|---|
| **inkle/ink** + **y-lohse/inkjs** | MIT | Narrative scripting language; JS runtime with zero dependencies, runs in Node *and* the browser | **Take it.** The single best fit on this list |
| **gboeing/osmnx** | MIT | Real Lagos road graph + building footprints + POIs as data | **Take it** for the new map |
| **isaac-mason/recast-navigation-js** | MIT | NavMesh + DetourCrowd, WASM, three.js helpers | Take it when the map gets dense |
| **isaac-mason/navcat** | MIT | Pure-JS navmesh, no WASM | Alternative if WASM is a hassle |
| **gkjohnson/three-mesh-bvh** | MIT | BVH raycast/spatial queries | Take it when collision gets slow |
| **donmccurdy/three-pathfinding** | MIT | Simple navmesh A* | Fine for small static interiors |
| **protectwise/troika** (`troika-three-text`) | MIT | Crisp world-space text | Nice-to-have; you have no in-world text today |
| **Mugen87/yuka** | MIT | Steering, FSM, perception, navmesh | Good API, **last release 2022** — read it, don't hinge on it |
| **nikkorn/mistreevous** | MIT | Behaviour trees for NPCs | Solid if you want NPC schedules |

**Deliberately not recommended:** OSMBuildings (dead since 2021), any Unity/Godot
narrative plugin, Ren'Py, physics engines, and ECS rewrites. Reasons in §6.

---

## 2. Story: ink, run on the server

### Why ink specifically

- **MIT, zero dependencies, v2.4.0, ~33k weekly downloads** — maintained, not a toy.
  Community-maintained JS port of inkle's engine (the one behind *Heaven's Vault*).
- **Runs identically in Node and the browser.** This is the decisive point: every
  other narrative tool assumes it owns the client frame loop.
- **Authoring is pleasant.** The free *Inky* editor compiles `.ink` → `.json`
  offline, with a live preview. Writers do not touch your codebase.

### Why it fits NewLife's architecture

Your game is server-authoritative: the server owns cash, needs, activities,
property and mission progress. So the *story must live on the server too*, or
you reintroduce the exact class of bug I spent round 11 removing — state the
client can invent.

```
client                          server (Node)
  │  player talks to a station      │
  │ ──────────────────────────────► │  ink story instance for THIS user
  │                                 │  story.ChooseChoiceIndex(n)
  │ ◄────────────────────────────── │  { line, choices, tags }
  │  render lines + choices         │  story state serialised → SQLite
```

- The `.ink.json` file is loaded once, server-side.
- Per-user story state is a single string (`story.state.ToJson()`), stored in a
  new `story_state` table. That is your save file for the plot, and it is
  already covered by `./backup.sh`.
- The client only ever receives lines and choices — it never holds story logic.

**Sketch** (`server/src/story.js`):

```js
import { Story } from 'inkjs';
import json from '../content/main.ink.json' with { type: 'json' };

export function beginTurn(userId) {
  const state = db.getStoryState(userId);          // string or null
  const story = new Story(json);
  if (state) story.state.LoadJson(state);
  return story;
}

export function advance(story, choiceIndex) {
  if (choiceIndex != null) story.ChooseChoiceIndex(choiceIndex);
  const lines = [];
  while (story.canContinue) lines.push(story.Continue().trim());
  return { lines, choices: story.currentChoices.map(c => c.text) };
}
```

### The pattern that matters: storylets, not a linear script

You already have predicate-based missions (`missionConfig` — each step is a
`check(s) => s.cash >= 50000`). That is 80% of a *quality-based narrative*, and it
is the right base for a life sim. What is missing is **characters and branching**,
not objectives.

So: keep `missionConfig` for objectives, add ink for the people.

- A **storylet** is a small scene that becomes available when a quality matches —
  "you are broke and it is raining" unlocks the okada rider's offer.
- Your needs, job, home, vehicle and cash are the *qualities*.
- Ink handles the scene, the dialogue and the branching; `missionConfig` handles
  "you must earn ₦20,000" and the server still validates it.

That combination means writers can add story without touching either the mission
validator or the client.

### Things to be honest about

- ink has a real learning curve (vars, knots, stitches, weave). Budget a day for
  the first scene; it is not Markdown.
- Story needs a schema change: `story_state` + a `story_flags` view. One migration,
  covered by the existing backup.
- ink does **not** give you quest UI, journal, or map markers. Those stay yours —
  but you already have a missions panel to hang them on.

**Alternative if you dislike ink's syntax:** `YarnSpinnerTool/YarnSpinner-TypeScript`
(WASM, used by try.yarnspinner.dev). Good, but the ecosystem is engine-first and
the JS runtime is the least-supported target of the three they ship.

---

## 3. The new map: pull real Lagos geometry, don't adopt a renderer

Your city is generated from code (`cityData.js`, `streetGrid.js`, `retile.js`).
A new map therefore needs **data**, not another 3D city library. This is the
biggest honest win available: a real Lagos.

### OSMnx (Python, MIT)

```python
import osmnx as ox

# Streets: returns a NetworkX graph with geometry, road class, name, oneway
G = ox.graph_from_bbox((6.44, 3.38, 6.46, 3.41), network_type="drive")

# Buildings, places of worship, markets, banks, hospitals — all as GeoDataFrame
tags = {"building": True, "amenity": True, "shop": True}
pois = ox.features_from_bbox((6.44, 3.38, 6.46, 3.41), tags)
```

Export to plain JSON, commit it under `client/src/world/maps/lagos-island.json`,
and feed it to your existing `CityBuilder`. **Zero runtime dependency** — the
browser never talks to OSM, so there is no new failure mode and no API key.

### The insight worth the whole exercise

OSM POIs map almost one-to-one onto the venue types you already built:

| OSM tag | Your existing system |
|---|---|
| `amenity=place_of_worship` + `religion` | `in-church`, `in-mosque` |
| `shop=supermarket` | `in-supermarket` (17 lines of stock) |
| `amenity=marketplace` | `in-market` (Oga, Balogun, Computer Village) |
| `amenity=bank` | `in-bank` (teller + ATM, now that they work) |
| `amenity=hospital` / `clinic` | `in-hospital`, `in-clinic` |
| `amenity=fuel` | `in-fuel` |
| `amenity=school` | `in-school` |
| `aeroway=aerodrome` | your airport + apron |

So one import gives you a **populated** map with real Lagos names and positions,
instead of a new empty grid you have to furnish by hand.

### Licence — this is a real obligation, not a footnote

OpenStreetMap data is **ODbL 1.1**:

- You **must** credit "© OpenStreetMap contributors" wherever the map is shown.
- If you distribute a **derived database** (your extracted JSON), it must stay
  ODbL — share-alike applies to the database, *not* to your game code.
- Safest practical route: keep the exported map JSON under `maps/` with an
  `ATTRIBUTION.md`, state ODbL on those files, and leave the rest of the game
  under your own licence. Get this right before shipping, not after.

### What I could not verify from this sandbox

I tried to measure Lagos OSM coverage directly and **Overpass is blocked here**
(406 / connection refused; Nominatim answered 200). So I will not claim Lagos is
well-mapped. Check it yourself in one minute:

```bash
python -c "import osmnx as ox; G=ox.graph_from_point((6.45,3.39),dist=800); print(len(G))"
```

Known shape of the data, from public mapping stats: **major roads are good**;
**individual building footprints are patchy** outside the core and newer
districts. Plan for that: import roads first (that alone transforms the map),
and use buildings where they exist, falling back to your procedural generator
where they don't.

---

## 4. Making a denser map work: navigation

Your `navGraph.js` is a hand-built graph — fine for the current city, brittle for
a real street network with thousands of nodes.

- **`recast-navigation-js`** (MIT, WASM) is the default answer for web navmesh:
  bake a navmesh from the level, `Crowd` for many agents, tile cache for dynamic
  obstacles. It ships a three.js integration. With Vite you must opt out of
  pre-bundling: `optimizeDeps: { exclude: ['recast-navigation'] }`.
- **`navcat`** if you would rather avoid WASM in the bundle.
- **`three-pathfinding`** (1.4k★, MIT) if you only need A* over a static mesh.

Start with recast only when NPC count and map density actually demand it. Do not
rewrite navigation speculatively.

---

## 5. Cheap upgrades worth taking

- **`three-mesh-bvh`** — actively maintained (235 dependents). Your collision is
  bespoke AABBs; on a real street network, spatial queries and raycasts will want
  a BVH. Drop-in: `computeBoundsTree` + `acceleratedRaycast`.
- **`troika-three-text`** — you have zero in-world text. Shop signs, street names,
  "Balogun Market" painted on a gate, and story prompts floating at a station are
  all one library away. Cheap, high perceived quality.

---

## 6. Traps — things that look like improvements and are not

1. **OSMBuildings** — the obvious Google hit. Last commit **April 2021**; a
   community post notes it is effectively gone. Do not build on it.
2. **New OSM→Three.js generators** (`YusufEminoglu/osm2threejs`, `osm_3d_model`)
   — interesting and MIT, but v0.1.0 single-author projects. Read for ideas;
   do not make them a dependency of a game you intend to maintain.
3. **Unity/Godot narrative plugins** (Yarn for Unity, Fungus, Naninovel) — not
   usable from Vite/ES modules at all.
4. **Ren'Py** — Python runtime, wrong engine.
5. **ECS rewrites** (`bitECS`, `miniplex`) — genuinely good libraries, genuinely
   the wrong move here: it is a rewrite of a working game, not an upgrade.
6. **Physics engines** (`cannon-es`, `rapier`) — Courier City and Open City use
   them because they started there. Bolt-on physics for a character controller
   is a classic month-long detour; your collision already works.
7. **"GTA in Three.js" starter repos** (`shubhransh-gupta/courier-city`,
   `chaitanya1111111/open-city`) — worth reading for structure, but they are
   client-only toys without server authority, economy or persistence. You are
   ahead of them, not behind.

---

## 7. What I would do, in order

1. **ink on the server** + one real scene (a character with branching dialogue at
   the market). Schema: `story_state`. ~1–2 days, and it is the thing that turns
   the city into a story.
2. **Storylet layer** over `missionConfig` — story becomes available based on
   state you already track, no new game systems.
3. **OSMnx: roads for one Lagos bbox** — validate the data really is good enough
   before promising a whole city. Attribution file at the same time.
4. **POIs → venues** — auto-place the shops, banks, churches and markets onto the
   real street layout. This is where it starts to feel like Lagos.
5. **recast navmesh** once NPC density justifies it.
6. **three-mesh-bvh + troika text** as the map grows.

Steps 1–2 are story. Steps 3–4 are the map. They are independent — you can do
either first.
