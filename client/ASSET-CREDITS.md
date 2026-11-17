# Assets and their licences

Every model, texture and sky in this game is CC0 (public domain). Nothing here
needs attribution; it is recorded anyway, because "where did this come from"
should never be a mystery.

Assets are **not committed**. `client/.gitignore` excludes `public/assets/`,
because they are downloads, not source. A fresh clone fetches them:

```bash
bash client/fetch-assets.sh      # only what is missing
bash client/fetch-assets.sh --force
```

The game runs without them: every loader falls back to procedural geometry, so a
missing asset is a downgrade, never a crash.

## Skies — Poly Haven, CC0 (`public/assets/hdri/`)

| File | Poly Haven id | Why this one |
|------|---------------|--------------|
| `sky_day.hdr` | `autumn_field_puresky` | Clear blue zenith (rgb 69,95,125) over a warm horizon band. The previous pick measured **rgb(162,146,139)** at the zenith — a white dome, which is why the daytime sky read as a grey sheet no matter what the tone mapping did. |
| `sky_dusk.hdr` | `venice_sunset` | Warm low sun, the last hour before dark. |
| `sky_night.hdr` | `viale_giuseppe_garibaldi` | A lit town at night: deep blue-black sky, warm sodium lamps, glowing windows — the look of the reference photograph. |

The night photograph records its street lamps at radiance ~10,000. That is a
camera exposure artefact, not scene brightness, and bloom smears it into a beige
fog; `AssetLibrary` clamps HDR radiance to 8 at load.

## Surface textures — Poly Haven, CC0 (`public/assets/textures/`)

`asphalt_02`, `rectangular_paving`, `grass_ground`, `grey_plaster`,
`concrete_tile_facade`, `wood_floor` (1k diffuse).

## Models — Kenney, CC0 (`public/assets/models/`)

Car Kit (sedan, van, taxi, suv, flat truck, hatchback, police), City Kit
(buildings, street furniture), Nature Kit (trees), Furniture Kit (indoors).

The Lagos-specific vehicles — Hiace minibus, keke NAPEP, okada — have no honest
CC0 model, so they are built part by part in `src/world/vehicleParts.js` at real
proportions. That is stated plainly rather than pretending a sedan is a danfo.
