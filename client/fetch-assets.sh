#!/usr/bin/env bash
# client/fetch-assets.sh
#
# Download the real-world assets this game uses. Everything here is CC0 (public
# domain) — Poly Haven for skies and surface textures, Kenney for models — and
# everything is small on purpose: the whole set is a few megabytes, because a
# browser game that takes a minute to load is a browser game nobody plays.
#
# The game runs without any of this: every loader falls back to the procedural
# primitives it used before. The assets make it look real; they are not a
# dependency for correctness.
#
#   bash client/fetch-assets.sh          # fetch anything missing
#   bash client/fetch-assets.sh --force  # re-fetch everything
#
# CC0 sources
#   skies + textures  https://polyhaven.com          (CC0)
#   models            https://kenney.nl              (CC0)
#   model mirror      https://github.com/shorepine/kenney (organised GLB trees)

set -u
cd "$(dirname "$0")" || exit 1

ROOT="public/assets"
FORCE="${1:-}"
UA="NewLife-asset-fetch/1.0 (+https://github.com/; CC0 assets)"

fetch() {
  local url="$1" out="$2"
  if [ -s "$out" ] && [ "$FORCE" != "--force" ]; then
    printf '  · %-52s cached\n' "$out"
    return 0
  fi
  mkdir -p "$(dirname "$out")"
  local code
  code=$(curl -sS -L --max-time 120 -A "$UA" -o "$out" -w "%{http_code}" "$url" || echo 000)
  if [ "$code" = "200" ] && [ -s "$out" ]; then
    printf '  ✓ %-52s %6s kB\n' "$out" "$(( $(stat -c%s "$out") / 1024 ))"
  else
    rm -f "$out"
    printf '  ✗ %-52s HTTP %s\n' "$out" "$code"
    return 1
  fi
}

poly() { # poly <asset> <kind> <res> <ext> <dest>
  local asset="$1" kind="$2" res="$3" ext="$4" dest="$5"
  local url
  url=$(curl -sS --max-time 30 -A "$UA" "https://api.polyhaven.com/files/$asset" \
    | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
kind, res, ext = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    print(d[kind][res][ext]['url'])
except Exception:
    print('')
" "$kind" "$res" "$ext")
  if [ -z "$url" ]; then
    printf '  ✗ %-52s no %s/%s/%s\n' "$dest" "$kind" "$res" "$ext"
    return 1
  fi
  fetch "$url" "$dest"
}

kenney() { # kenney <kit> <file> <destdir>
  local kit="$1" file="$2" dest="$3"
  fetch "https://raw.githubusercontent.com/shorepine/kenney/master/3d/$kit/$file" "$dest/$file"
}

echo
echo "▸ Skies (Poly Haven, CC0)"
# Chosen by measuring, not by name:
#   · sky_day  — a clear blue zenith. The old pick (kloofendal_48d) measured
#                rgb(162,146,139) at the zenith: a white dome, which is why the
#                daytime sky read as a grey sheet.
#   · sky_dusk — warm low sun.
#   · sky_night— a lit town at night: warm sodium lamps, deep blue-black sky,
#                matching the reference photograph of a Manhattan street.
# The night photograph's lamps are recorded at radiance ~10,000 and are clamped
# at load (see AssetLibrary MAX_RADIANCE), otherwise bloom turns them into fog.
poly autumn_field_puresky hdri 1k hdr "$ROOT/hdri/sky_day.hdr"
poly venice_sunset hdri 1k hdr "$ROOT/hdri/sky_dusk.hdr"
poly viale_giuseppe_garibaldi hdri 1k hdr "$ROOT/hdri/sky_night.hdr"

echo
echo "▸ Surface textures (Poly Haven, CC0 — 1k diffuse)"
poly asphalt_02 Diffuse 1k jpg "$ROOT/textures/asphalt.jpg"
poly rectangular_paving Diffuse 1k jpg "$ROOT/textures/paving.jpg"
poly grass_ground Diffuse 1k jpg "$ROOT/textures/grass.jpg"
poly grey_plaster Diffuse 1k jpg "$ROOT/textures/plaster.jpg"
poly concrete_tile_facade Diffuse 1k jpg "$ROOT/textures/facade.jpg"
poly wood_floor Diffuse 1k jpg "$ROOT/textures/wood.jpg" || true

echo
echo "▸ Vehicles (Kenney Car Kit, CC0)"
for f in sedan.glb van.glb taxi.glb suv.glb truck-flat.glb hatchback-sports.glb police.glb; do
  kenney car "$f" "$ROOT/models/car"
done
kenney car "Textures/colormap.png" "$ROOT/models/car"

echo
echo "▸ Trees and plants (Kenney Nature Kit, CC0)"
for f in tree_default.glb tree_pineDefaultA.glb tree_thin.glb plant_bushLarge.glb; do
  kenney nature "$f" "$ROOT/models/nature"
done

echo
echo "▸ Street furniture (Kenney City Roads Kit, CC0)"
for f in light-square.glb light-curved.glb construction-barrier.glb construction-cone.glb road-bend-barrier.glb; do
  kenney city-roads "$f" "$ROOT/models/street"
done
kenney city-roads "Textures/colormap.png" "$ROOT/models/street"

echo
echo "▸ Furniture (Kenney Furniture Kit, CC0)"
for f in chair.glb chairRounded.glb chairDesk.glb table.glb tableRound.glb desk.glb \
         bedDouble.glb bench.glb bookcaseOpen.glb loungeSofa.glb toilet.glb kitchenSink.glb \
         cabinetBedDrawer.glb kitchenStove.glb; do
  kenney furniture "$f" "$ROOT/models/furniture"
done

echo
TOTAL=$(du -sh "$ROOT" 2>/dev/null | cut -f1)
COUNT=$(find "$ROOT" -type f 2>/dev/null | wc -l)
echo "▸ $COUNT files, $TOTAL on disk"
