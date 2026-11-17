// client/src/world/EkoBuilder.js
// Draws Eko Basin: four landmasses, three bridges, the Eko Metro, the city on
// top, faction turf, POIs and the campaign pins.
//
// Geometry only. Every position, height and colour it draws comes from
// ekoBasin.js / ekoWorld.js, so the picture can never drift from the data the
// gameplay and the server use.

import * as THREE from 'three';
import { materials } from './materials.js';
import { buildBuilding } from './BuildingFactory.js';
import { mergeByMaterial } from './mergeUtils.js';
import {
  ISLANDS, BRIDGES, METRO_LINES, METRO_STATIONS, METRO_AMBUSHES,
  FACTIONS, HEIST_TARGET, SAFEHOUSES, MISSION_PINS,
  islandPolygon, toWorld, factionForIsland,
} from './ekoBasin.js';
import { buildings, roads, districts } from './ekoWorld.js';
import {
  BRIDGE_PATHS, DECK_THICKNESS, deckHeightAt, deckPoint, deckSlopeAt,
} from './bridgeProfile.js';

/** Water sits this far below the quay. */
const WATER_Y = -1.1;
/** Island top surface. */
const LAND_Y = 0;

/**
 * How high every flat surface sits above the land.
 *
 * These used to be 2, 3 and 5 cm, which is inside the depth buffer's precision at
 * two hundred metres: the island top, the ground wash and the road fought for the
 * same pixels and the winner changed as the camera moved, giving the whole map a
 * speckled shimmer that read as the game flickering. The stack below keeps every
 * pair of coplanar surfaces at least 3 cm apart, and the important ones 6–9 cm,
 * which is far cheaper than the alternative (a logarithmic depth buffer, which
 * wrecks the sky dome's depth test).
 */
export const SURFACE = {
  land: 0,
  wash: 0.06,     // inset grass/ground wash on each island
  pad: 0.09,      // asphalt pads: motor park, docks yard
  road: 0.12,     // asphalt, over the wash
  line: 0.14,     // painted markings, over the asphalt
  marker: 0.18,   // ambush and objective rings
  station: 0.20,  // metro station rings
};

function islandShape(points) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => (i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z)));
  shape.closePath();
  return shape;
}

/** A soft canvas texture for the water, so the lagoon is not flat colour. */
function waterTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#0b2038';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const a = 0.02 + Math.random() * 0.05;
    g.fillStyle = `rgba(120,190,230,${a})`;
    g.fillRect(x, y, 2 + Math.random() * 22, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 40);
  return tex;
}

/**
 * Sweep a closed 2D cross-section along a bridge span.
 *
 * The section is a list of `[lateralOffset, dy]` pairs in metres: lateral across
 * the deck (negative toward abutment A's left), dy relative to the deck surface at
 * that point. Because every ring is placed at `deckHeightAt(u) + dy`, the swept
 * surface follows the arch exactly.
 *
 * @param {object} path bridge path from world/bridgeProfile.js
 * @param {number[][]} section closed loop, counter-clockwise in (lateral, dy)
 * @param {{segments?:number, lateral?:number}} [o]
 * @returns {THREE.BufferGeometry}
 */
function extrudeAlong(path, section, { segments = 48, lateralOffset = 0 } = {}) {
  const rings = segments + 1;
  const n = section.length;
  const positions = [];
  const indices = [];

  for (let i = 0; i < rings; i++) {
    const u = i / segments;
    const h = deckHeightAt(path, u);
    const cx = path.ax + path.ux * path.length * u;
    const cz = path.az + path.uz * path.length * u;
    for (let j = 0; j < n; j++) {
      const [lat, dy] = section[j];
      const l = lat + lateralOffset;
      positions.push(cx + path.rx * l, h + dy, cz + path.rz * l);
    }
  }

  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      const a = i * n + j;
      const b = i * n + j2;
      const c = (i + 1) * n + j;
      const d = (i + 1) * n + j2;
      indices.push(a, c, b, b, c, d);
    }
  }

  // End caps, so the slab is solid at both abutments rather than a hollow shell.
  for (const [ring, flip] of [[0, false], [segments, true]]) {
    const base = ring * n;
    for (let j = 1; j < n - 1; j++) {
      if (flip) indices.push(base, base + j + 1, base + j);
      else indices.push(base, base + j, base + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class EkoBuilder {
  constructor({ assets = null } = {}) {
    this.assets = assets;
    this.group = new THREE.Group();
    this.group.name = 'eko-basin';
    this.landGroup = new THREE.Group();
    this.roadGroup = new THREE.Group();
    this.buildingGroup = new THREE.Group();
    this.bridgeGroup = new THREE.Group();
    this.metroGroup = new THREE.Group();
    this.turfGroup = new THREE.Group();
    this.poiGroup = new THREE.Group();
    this.group.add(this.turfGroup, this.landGroup, this.roadGroup, this.buildingGroup, this.bridgeGroup, this.metroGroup, this.poiGroup);
    this.labels = [];
    this.stats = null;
  }

  build() {
    this._buildWater();
    this._buildIslands();
    this._buildTurf();
    this._buildRoads();
    this._buildBuildings();
    this._buildBridges();
    this._buildMetro();
    this._buildPoi();
    this._buildLabels();

    this.stats = {
      islands: ISLANDS.length,
      bridges: BRIDGES.length,
      roads: roads.length,
      buildings: buildings.length,
      detailedBuildings: this.buildingStats?.detailed ?? 0,
      districts: districts.length,
      metroStations: METRO_STATIONS.length,
      missionPins: MISSION_PINS.length,
    };
    return this;
  }

  // ── Water ──────────────────────────────────────────────────
  _buildWater() {
    const geo = new THREE.PlaneGeometry(2600, 1600, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0b2038,
      map: waterTexture(),
      roughness: 0.28,
      metalness: 0.45,
      transparent: true,
      opacity: 0.96,
    });
    mat.map.repeat.set(30, 20);
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    water.name = 'lagoon';
    this.group.add(water);
    this.water = water;
  }

  // ── Islands ────────────────────────────────────────────────
  _buildIslands() {
    for (const island of ISLANDS) {
      const pts = islandPolygon(island);
      const shape = islandShape(pts);

      // The landmass itself: extruded down from the quay line.
      const depth = 3;
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, LAND_Y - depth, 0);

      const top = new THREE.Mesh(geo, materials.concreteGround());
      top.receiveShadow = true;
      top.name = `island-${island.id}`;
      top.userData.island = island.id;
      this.landGroup.add(top);

      // A slightly inset grass/ground wash so the island reads as land, not a
      // slab: the outline is scaled 0.985 toward its centroid.
      let cx = 0; let cz = 0;
      for (const p of pts) { cx += p.x; cz += p.z; }
      cx /= pts.length; cz /= pts.length;
      const inner = pts.map((p) => new THREE.Vector2(cx + (p.x - cx) * 0.985, -(cz + (p.z - cz) * 0.985)));
      const innerShape = new THREE.Shape(inner);
      const innerGeo = new THREE.ShapeGeometry(innerShape);
      innerGeo.rotateX(-Math.PI / 2);
      const wash = new THREE.Mesh(innerGeo, materials.grass());
      wash.position.y = LAND_Y + SURFACE.wash;
      wash.receiveShadow = true;
      this.landGroup.add(wash);

      // Seawall: a thin bright line on the waterline, so the coast reads at
      // night and from the bridges.
      const wallPts = pts.map((p) => new THREE.Vector3(p.x, LAND_Y - 0.1, p.z));
      const wallGeo = new THREE.BufferGeometry().setFromPoints([...wallPts, wallPts[0]]);
      const wall = new THREE.Line(wallGeo, new THREE.LineBasicMaterial({ color: 0x8fa6bb }));
      this.landGroup.add(wall);
    }
  }

  // ── Faction turf ───────────────────────────────────────────
  // Thin coloured outlines along each held island, matching the map legend.
  _buildTurf() {
    for (const island of ISLANDS) {
      const factionId = factionForIsland(island.id);
      const faction = FACTIONS.find((f) => f.id === factionId);
      if (!faction) continue;
      const pts = islandPolygon(island).map((p) => new THREE.Vector3(p.x, LAND_Y + SURFACE.wash, p.z));
      const geo = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]);
      this.turfGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: faction.colour })));
    }
  }

  // ── Roads ──────────────────────────────────────────────────
  _buildRoads() {
    const asphalt = materials.asphalt();
    const geos = [];
    for (const r of roads) {
      const geo = new THREE.PlaneGeometry(r.w, r.d);
      geo.rotateX(-Math.PI / 2);
      if (r.rotY) geo.rotateY(r.rotY);
      geo.translate(r.x, LAND_Y + SURFACE.road, r.z);
      geos.push(geo);
    }
    if (!geos.length) return;
    // One merged mesh: 89 strips as separate meshes would be 89 draw calls for
    // the least interesting thing on screen.
    const merged = mergeGeometries(geos);
    const mesh = new THREE.Mesh(merged, asphalt);
    mesh.receiveShadow = true;
    mesh.name = 'eko-roads';
    this.roadGroup.add(mesh);
  }

  // ── Buildings ──────────────────────────────────────────────
  _buildBuildings() {
    // Two paths on purpose.
    //
    // The 33 buildings players actually enter or interact with get the full
    // facade generator: body, plinth, storey bands, recessed windows, roof
    // tank, shopfront. The 234 filler blocks between them are plain volummes —
    // nobody ever walks into them, and drawing each one in detail would cost
    // more than the whole frame budget.
    let detailed = 0;
    let instanced = 0;

    const detailedGroup = new THREE.Group();
    detailedGroup.name = 'eko-key-buildings';

    for (const b of buildings) {
      if (b.size.h < 0.5) continue; // flat pads are drawn as asphalt pads below
      if (!b.key) continue;
      const raw = buildBuilding(b);
      raw.position.set(b.position.x, LAND_Y, b.position.z);
      raw.name = `building-${b.id}`;
      detailedGroup.add(raw);
      detailed++;
    }
    // Merge the detailed facades by material. Thirty-two buildings of about
    // forty meshes each is 1,300 draw calls; merged, it is a dozen — and they
    // are static, so nothing is lost.
    const merged = mergeByMaterial(detailedGroup, { bakeWorld: true });
    merged.name = 'eko-key-facades';
    this.buildingGroup.add(merged);

    // Flat pads: the motor park, the docks yard.
    const padMat = materials.concreteGround();
    for (const b of buildings) {
      if (b.size.h >= 0.5) continue;
      // Bake the rotation into the geometry rather than the mesh: a pad whose
      // geometry still stands upright reports a bounding box nine metres deep
      // and trips the "nothing is sunk below the ground" check.
      const padGeo = new THREE.PlaneGeometry(b.size.w, b.size.d);
      padGeo.rotateX(-Math.PI / 2);
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(b.position.x, LAND_Y + SURFACE.pad, b.position.z);
      pad.receiveShadow = true;
      this.buildingGroup.add(pad);
    }

    // Filler blocks, instanced per colour.
    const byColour = new Map();
    for (const b of buildings) {
      if (b.size.h < 0.5 || b.key) continue;
      if (!byColour.has(b.colour)) byColour.set(b.colour, []);
      byColour.get(b.colour).push(b);
    }
    const o = new THREE.Object3D();
    for (const [colour, list] of byColour) {
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 }),
        list.length,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      list.forEach((b, i) => {
        o.position.set(b.position.x, LAND_Y + b.size.h / 2, b.position.z);
        o.scale.set(b.size.w, b.size.h, b.size.d);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = 'eko-filler-blocks';
      this.buildingGroup.add(mesh);
      instanced += list.length;
    }

    this.buildingStats = { detailed, instanced };
  }

  // ── Bridges ────────────────────────────────────────────────
  /**
   * The three spans, built as ramps the player and the traffic can actually use.
   *
   * The deck is a swept cross-section along the profile in world/bridgeProfile.js,
   * so its surface *is* `deckHeightAt(u)` at every point — the height the player
   * controller stands on and the height the cars drive at come from the same
   * function, and cannot drift apart. The deck meets both islands at 0.00 m, which
   * is what lets a walker step on without a lip.
   *
   * The towers, cables and trusses ride on top of the deck height rather than on a
   * fixed y, so the Long Bridge's suspension towers stand on its 5.50 m crown
   * instead of floating over a flat plank.
   */
  _buildBridges() {
    /** Lamp heads handed to render/NightLights.js, so a crossing is lit. */
    this.bridgeLampPositions = [];

    const deckMat = new THREE.MeshStandardMaterial({
      map: materials.asphalt().map,
      color: 0x9aa0a6,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xc3c9d1, roughness: 0.45, metalness: 0.55, side: THREE.DoubleSide,
    });
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xf4f2ea,
      roughness: 0.8,
      side: THREE.DoubleSide,
      // Painted over the asphalt: a polygon offset, not a gap, so the line cannot
      // z-fight the deck at two hundred metres.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: 0.55, metalness: 0.5 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9a021, roughness: 0.5, metalness: 0.4 });
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x8f949b, roughness: 0.95 });
    const cableMat = new THREE.LineBasicMaterial({ color: 0xe5e7eb });

    // Lamp posts on the decks, collected across all three spans and instanced.
    const lampSpots = [];
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6);
    const headGeo = new THREE.SphereGeometry(0.27, 8, 8);
    const headMat = materials.glow(0xffe9b8);
    const dummy = new THREE.Object3D();

    for (const path of BRIDGE_PATHS) {
      const half = path.width / 2;

      // ── Deck: asphalt slab swept along the arch ──
      const deckGeo = extrudeAlong(path, [
        [-half, 0], [half, 0], [half, -DECK_THICKNESS], [-half, -DECK_THICKNESS],
      ], { segments: path.length > 200 ? 96 : 40 });
      const deck = new THREE.Mesh(deckGeo, deckMat);
      deck.name = `bridge-deck-${path.id}`;
      deck.castShadow = true;
      deck.receiveShadow = true;
      this.bridgeGroup.add(deck);

      // ── Kerb and parapet, both sides ──
      for (const side of [-1, 1]) {
        const kerbGeo = extrudeAlong(path, [
          [-0.16, 0], [0.16, 0], [0.16, 0.16], [-0.16, 0.16],
        ], { segments: 48, lateralOffset: side * (half - 0.28) });
        const kerb = new THREE.Mesh(kerbGeo, railMat);
        kerb.name = `bridge-kerb-${path.id}-${side > 0 ? 'r' : 'l'}`;
        kerb.receiveShadow = true;
        this.bridgeGroup.add(kerb);

        const parapetGeo = extrudeAlong(path, [
          [-0.07, 0.16], [0.07, 0.16], [0.07, 1.05], [-0.07, 1.05],
        ], { segments: 48, lateralOffset: side * (half - 0.28) });
        const parapet = new THREE.Mesh(parapetGeo, railMat);
        parapet.name = `bridge-parapet-${path.id}-${side > 0 ? 'r' : 'l'}`;
        parapet.castShadow = true;
        this.bridgeGroup.add(parapet);
      }

      // ── Centre line: one painted strip down the middle of the deck ──
      const lineGeo = extrudeAlong(path, [
        [-0.11, 0.03], [0.11, 0.03], [0.11, 0.005], [-0.11, 0.005],
      ], { segments: 40 });
      this.bridgeGroup.add(new THREE.Mesh(lineGeo, lineMat));

      // ── Piers, from the lagoon floor up to the underside of the deck ──
      const pierFractions = path.length > 200
        ? [0.16, 0.32, 0.5, 0.68, 0.84]
        : [0.3, 0.5, 0.7];
      for (const u of pierFractions) {
        const h = deckHeightAt(path, u);
        const height = h - DECK_THICKNESS - WATER_Y;
        if (height < 0.8) continue;
        const p = deckPoint(path, u, 0);
        for (const side of [-1, 1]) {
          const pier = new THREE.Mesh(
            new THREE.CylinderGeometry(0.62, 0.86, height, 10),
            concreteMat,
          );
          pier.position.set(
            p.x + path.rx * side * half * 0.5,
            WATER_Y + height / 2,
            p.z + path.rz * side * half * 0.5,
          );
          pier.castShadow = true;
          pier.receiveShadow = true;
          this.bridgeGroup.add(pier);
        }
      }

      // ── Superstructure, standing on the deck it belongs to ──
      if (path.style === 'suspension') {
        const towerH = 9.5;
        const tops = [];
        for (const u of path.towers) {
          const deckY = deckHeightAt(path, u);
          const p = deckPoint(path, u, 0);
          for (const side of [-1, 1]) {
            const tower = new THREE.Mesh(new THREE.BoxGeometry(0.9, towerH, 0.9), steelMat);
            tower.position.set(
              p.x + path.rx * side * (half + 0.1),
              deckY + towerH / 2,
              p.z + path.rz * side * (half + 0.1),
            );
            tower.castShadow = true;
            this.bridgeGroup.add(tower);
          }
          // Cross beam between the legs, and the saddles the cables sit on.
          const cross = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, path.width + 1.2), steelMat);
          cross.position.set(p.x, deckY + towerH, p.z);
          cross.rotation.y = -Math.atan2(path.uz, path.ux) + Math.PI / 2;
          this.bridgeGroup.add(cross);
          tops.push({ u, y: deckY + towerH });
        }

        // Main cables: abutment → tower top → sag across the main span → tower top
        // → abutment. Drawn per side, with hangers down to the deck.
        if (tops.length >= 2) {
          const [t1, t2] = tops;
          for (const side of [-1, 1]) {
            const lat = side * (half + 0.1);
            const pts = [];
            const push = (u, y) => {
              const q = deckPoint(path, u, lat);
              pts.push(new THREE.Vector3(q.x, y, q.z));
            };
            // Back stays.
            push(0, deckHeightAt(path, 0) + 0.8);
            push(t1.u, t1.y);
            // Main span, sagging toward mid-span.
            const MID_DROP = 2.4;
            for (let i = 1; i < 12; i++) {
              const f = i / 12;
              const u = t1.u + (t2.u - t1.u) * f;
              const topY = t1.y + (t2.y - t1.y) * f;
              push(u, topY - Math.sin(f * Math.PI) * MID_DROP);
            }
            push(t2.u, t2.y);
            push(1, deckHeightAt(path, 1) + 0.8);
            this.bridgeGroup.add(new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              cableMat,
            ));

            // Hangers.
            for (let i = 1; i < 11; i++) {
              const f = i / 11;
              const u = t1.u + (t2.u - t1.u) * f;
              const topY = t1.y + (t2.y - t1.y) * f - Math.sin(f * Math.PI) * MID_DROP;
              const deckY = deckHeightAt(path, u);
              const h = topY - deckY;
              if (h < 0.6) continue;
              const hang = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), steelMat);
              const q = deckPoint(path, u, lat);
              hang.position.set(q.x, deckY + h / 2, q.z);
              this.bridgeGroup.add(hang);
            }
          }
        }
      } else {
        // Truss / cantilever: a braced wall along each edge of the carriageway.
        const trussH = 2.9;
        for (const side of [-1, 1]) {
          const lat = side * (half - 0.1);
          // Top chord.
          const chordGeo = extrudeAlong(path, [
            [-0.09, trussH], [0.09, trussH], [0.09, trussH + 0.2], [-0.09, trussH + 0.2],
          ], { segments: 40, lateralOffset: lat });
          this.bridgeGroup.add(new THREE.Mesh(chordGeo, goldMat));

          // Posts and diagonals.
          const bays = Math.max(4, Math.round(path.length / 9));
          for (let i = 0; i <= bays; i++) {
            const u = i / bays;
            const deckY = deckHeightAt(path, u);
            const q = deckPoint(path, u, lat);
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, trussH, 0.16), goldMat);
            post.position.set(q.x, deckY + trussH / 2, q.z);
            post.castShadow = true;
            this.bridgeGroup.add(post);

            if (i < bays) {
              const a = { u, y: deckY + (i % 2 ? trussH : 0) };
              const b = { u: (i + 1) / bays, y: deckHeightAt(path, (i + 1) / bays) + (i % 2 ? 0 : trussH) };
              const pa = deckPoint(path, a.u, lat);
              const pb = deckPoint(path, b.u, lat);
              this.bridgeGroup.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([
                  new THREE.Vector3(pa.x, a.y, pa.z),
                  new THREE.Vector3(pb.x, b.y, pb.z),
                ]),
                new THREE.LineBasicMaterial({ color: 0xd9a021 }),
              ));
            }
          }
        }
      }

      // ── Deck lamps: alternating sides, one every ~22 m ──
      const lampCount = Math.max(2, Math.round(path.length / 22));
      for (let i = 1; i < lampCount; i++) {
        const u = i / lampCount;
        const side = i % 2 ? 1 : -1;
        const p = deckPoint(path, u, side * (half - 0.5));
        lampSpots.push(p);
        // The head is where the light comes from — 4.6 m above the deck, so the
        // ramp rising behind the player is lit rather than silhouetted.
        this.bridgeLampPositions.push({ x: p.x, y: p.y + 4.35, z: p.z });
      }
    }

    // One instanced mesh for every pole, one for every glowing head.
    if (lampSpots.length) {
      const poleMesh = new THREE.InstancedMesh(poleGeo, steelMat, lampSpots.length);
      const headMesh = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
      poleMesh.name = 'bridge-lamp-poles';
      headMesh.name = 'bridge-lamp-heads';
      poleMesh.castShadow = true;
      lampSpots.forEach((p, i) => {
        dummy.position.set(p.x, p.y + 2.3, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poleMesh.setMatrixAt(i, dummy.matrix);

        dummy.position.set(p.x, p.y + 4.5, p.z);
        dummy.updateMatrix();
        headMesh.setMatrixAt(i, dummy.matrix);
      });
      poleMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
      this.bridgeGroup.add(poleMesh, headMesh);
    }

    this.bridgeStats = {
      spans: BRIDGE_PATHS.length,
      lamps: lampSpots.length,
      rises: BRIDGE_PATHS.map((p) => ({ id: p.id, length: Math.round(p.length), rise: p.rise })),
    };
  }

  // ── Eko Metro ──────────────────────────────────────────────
  _buildMetro() {
    const y = LAND_Y - 3.2; // underground
    for (const line of METRO_LINES) {
      const pts = line.pixels.map(([px, py]) => {
        const p = toWorld(px, py);
        return new THREE.Vector3(p.x, y, p.z);
      });
      const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
      const spaced = curve.getSpacedPoints(260);

      // Rails: two parallel lines.
      for (const side of [-1, 1]) {
        const off = spaced.map((p, i) => {
          const q = spaced[Math.min(i + 1, spaced.length - 1)];
          const prev = spaced[Math.max(i - 1, 0)];
          const dx = q.x - prev.x; const dz = q.z - prev.z;
          const l = Math.hypot(dx, dz) || 1;
          return new THREE.Vector3(p.x - (dz / l) * side * 0.75, y, p.z + (dx / l) * side * 0.75);
        });
        this.metroGroup.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(off),
          new THREE.LineBasicMaterial({ color: line.colour }),
        ));
      }

      // A tunnel mouth where the line meets each island shore, so the metro is
      // discoverable from the street rather than only on the map.
      for (const p of spaced) {
        if (Math.random() < 0.985) continue;
        const mouth = new THREE.Mesh(
          new THREE.BoxGeometry(2.6, 3.4, 2.6),
          new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 1 }),
        );
        mouth.position.set(p.x, y + 1.7, p.z);
        this.metroGroup.add(mouth);
      }

      // Ambush markers.
      for (const amb of METRO_AMBUSHES.filter((a) => a.line === line.id)) {
        const p = curve.getPoint(amb.at);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(1.1, 1.9, 24),
          new THREE.MeshBasicMaterial({ color: 0xff3b3b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p.x, LAND_Y + SURFACE.marker, p.z);
        this.poiGroup.add(ring);
      }
    }

    // Stations: a ring on the surface plus a shaft down to the platform.
    for (const st of METRO_STATIONS) {
      const p = toWorld(st.pixels[0], st.pixels[1]);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.6, 2.6, 28),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, LAND_Y + SURFACE.station, p.z);
      this.poiGroup.add(ring);

      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 3.2, 8),
        new THREE.MeshBasicMaterial({ color: 0xff9a9a }),
      );
      shaft.position.set(p.x, LAND_Y - 1.6, p.z);
      this.metroGroup.add(shaft);
    }
  }

  // ── POIs ───────────────────────────────────────────────────
  _buildPoi() {
    // The Federal Gold Vault, hanging over Marina as the map draws it.
    const v = toWorld(HEIST_TARGET.pixels[0], HEIST_TARGET.pixels[1]);
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(3.4),
      new THREE.MeshStandardMaterial({ color: 0x7ff3ff, emissive: 0x1aa6c8, roughness: 0.2 }),
    );
    diamond.position.set(v.x, 24, v.z);
    this.poiGroup.add(diamond);
    this.poiGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(v.x, 22, v.z), new THREE.Vector3(v.x, LAND_Y, v.z),
      ]),
      new THREE.LineBasicMaterial({ color: 0x7ff3ff }),
    ));
    const vaultPad = new THREE.Mesh(
      new THREE.BoxGeometry(7, 1.6, 5),
      new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0x6b4b00 }),
    );
    vaultPad.position.set(v.x, LAND_Y + 0.8, v.z);
    this.poiGroup.add(vaultPad);
    this.heistPad = vaultPad;

    // Starting safehouses: green blocks with a roof.
    for (const sh of SAFEHOUSES) {
      const p = toWorld(sh.pixels[0], sh.pixels[1]);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2.4, 1.6, 2.4),
        new THREE.MeshStandardMaterial({ color: 0x3ddc84, emissive: 0x0d4d2a }),
      );
      box.position.set(p.x, LAND_Y + 0.8, p.z);
      this.poiGroup.add(box);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.2, 1.4, 4),
        new THREE.MeshStandardMaterial({ color: 0x2fb36a, emissive: 0x0d4d2a }),
      );
      roof.position.set(p.x, LAND_Y + 2.3, p.z);
      roof.rotation.y = Math.PI / 4;
      this.poiGroup.add(roof);
    }

    // Campaign pins: a slim column with a glowing head, colour-coded purple as
    // on the reference map.
    for (const pin of MISSION_PINS) {
      const p = toWorld(pin.pixels[0], pin.pixels[1]);
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 9, 6),
        new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.55 }),
      );
      column.position.set(p.x, LAND_Y + 4.5, p.z);
      this.poiGroup.add(column);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.85, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xa78bfa }),
      );
      head.position.set(p.x, LAND_Y + 9.2, p.z);
      this.poiGroup.add(head);
    }
  }

  // ── Labels ─────────────────────────────────────────────────
  // Canvas sprites, same technique the reference map uses.
  _label(text, x, y, z, colour, width) {
    const canvas = document.createElement('canvas');
    canvas.width = 768; canvas.height = 96;
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(8,16,36,0.82)';
    g.strokeStyle = colour;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(14, 6);
    g.arcTo(canvas.width - 6, 6, canvas.width - 6, canvas.height - 6, 16);
    g.arcTo(canvas.width - 6, canvas.height - 6, 6, canvas.height - 6, 16);
    g.arcTo(6, canvas.height - 6, 6, 6, 16);
    g.arcTo(6, 6, canvas.width - 6, 6, 16);
    g.closePath();
    g.fill(); g.stroke();
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    let size = 44;
    do { g.font = `700 ${size}px "Segoe UI",system-ui,sans-serif`; size--; } while (g.measureText(text).width > 720 && size > 12);
    g.fillText(text, canvas.width / 2, 64);

    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sprite.scale.set(width, width * (canvas.height / canvas.width), 1);
    sprite.position.set(x, y, z);
    sprite.renderOrder = 10;
    this.labels.push(sprite);
    return sprite;
  }

  _buildLabels() {
    const group = new THREE.Group();
    group.name = 'eko-labels';
    // District names only. Faction banners and mission names would turn the
    // skyline into a wall of text; those live in the HUD and the map screen.
    for (const d of districts) {
      const label = this._label(d.name, d.x, 26, d.z, '#9fb0d0', 20);
      group.add(label);
    }
    // The three bridges.
    for (const b of BRIDGES) {
      const a = toWorld(b.a[0], b.a[1]);
      const c = toWorld(b.b[0], b.b[1]);
      const label = this._label(
        b.name,
        (a.x + c.x) / 2, b.height + 9, (a.z + c.z) / 2,
        '#e5e7eb', 18,
      );
      group.add(label);
    }
    this.group.add(group);
    this.labelGroup = group;
  }

  getCollisionBoxes() {
    // Imported lazily so this module has no cycle with ekoWorld.
    const boxes = [];
    for (const b of buildings) {
      if (b.size.h < 0.5) continue;
      boxes.push({
        minX: b.position.x - b.size.w / 2,
        maxX: b.position.x + b.size.w / 2,
        minZ: b.position.z - b.size.d / 2,
        maxZ: b.position.z + b.size.d / 2,
        id: b.id,
      });
    }
    return boxes;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
}

/** Minimal geometry merge — positions + normals + uv + index. */
function mergeGeometries(geos) {
  let vCount = 0; let iCount = 0;
  for (const g of geos) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0; let io = 0;
  for (const g of geos) {
    const p = g.attributes.position; const n = g.attributes.normal; const u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nor.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

export { mergeGeometries };
