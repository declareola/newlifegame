// client/src/world/airfield.js
// The airside of Murtala Muhammed: apron, jetbridges, aircraft, runway, tower.
//
// This is the one "interior" that is not a room. It is built as a scene of its
// own with the same contract as buildInterior() — group, collisions, spawn,
// bounds, lights, stations — so everything downstream (doors, camera, prompt,
// stations) works without special cases. The only difference is that it is
// reached through the terminal's gate rather than from the street, so it has no
// world door of its own.
//
// Scale, for reference: a 737 is ~38 m long and the runway here is 260 m, which
// is short for a real airport and long enough to read as one. The player is kept
// on the apron: walking onto an active runway is not a feature.

import * as THREE from 'three';
import { materials } from './materials.js';
import { mergeByMaterial } from './mergeUtils.js';
import { makeStation, createStationMarker } from './stations.js';

const _dummy = new THREE.Object3D();

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Painted tarmac text (stand numbers, taxiway letters).
 *
 * A real apron is legible from the cockpit window: big white stand numbers in
 * boxes, yellow lead-in lines, red safety borders. Making them canvas textures
 * costs one small texture each, and they survive the geometry merge because
 * they are their own material.
 */
function groundText(text, { size = 64, colour = '#f4f7f8', boxed = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  if (boxed) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 112, 112);
  }
  ctx.fillStyle = colour;
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** A decal lying flat on the tarmac. */
function groundDecal(text, { x, z, width = 6, height = 6, rot = 0, boxed = true }) {
  const mat = new THREE.MeshStandardMaterial({
    map: groundText(text, { boxed }),
    transparent: true,
    roughness: 0.9,
    metalness: 0,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rot;
  mesh.position.set(x, 0.05, z);
  mesh.renderOrder = 2;
  return mesh;
}

/** A narrow-body airliner, nose pointing +Z. ~34 m long, 32 m span. */
export function aircraft({ livery = 0xf4f6f6, accent = 0x1b6ca8, scale = 1 } = {}) {
  const g = new THREE.Group();
  const body = materials.paint(livery);
  const stripe = materials.paint(accent);
  const glassMat = materials.glass();
  const dark = materials.matte(0x22282e);
  const metal = materials.chrome();

  // Fuselage: tapered cylinder, 30 m long, 3.8 m across.
  const fus = cyl(1.7, 1.7, 26, body, 0, 4.1, 0, 20);
  fus.rotation.x = Math.PI / 2;
  g.add(fus);
  // Nose and tail cones
  const nose = cyl(1.7, 0.55, 4.2, body, 0, 4.1, 15.1, 20);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);
  const tailCone = cyl(1.7, 0.9, 5.0, body, 0, 4.25, -15.4, 20);
  tailCone.rotation.x = Math.PI / 2;
  g.add(tailCone);

  // Cockpit glass
  g.add(box(1.7, 0.7, 0.12, glassMat, 0, 4.6, 16.4));

  // Livery stripe and cabin window band
  for (const side of [-1, 1]) {
    g.add(box(0.06, 0.42, 22, stripe, side * 1.72, 4.05, 0.4));
    g.add(box(0.03, 0.26, 20, glassMat, side * 1.73, 4.95, 0.8));
  }

  // Wings: swept, with a slight dihedral, plus winglets.
  for (const side of [-1, 1]) {
    const wing = box(15.5, 0.34, 3.6, body, side * 8.2, 3.6, -0.4);
    wing.rotation.z = side * 0.06;
    wing.rotation.y = side * -0.34;
    g.add(wing);
    g.add(box(0.3, 1.5, 2.0, stripe, side * 15.6, 4.2, -2.6));
    // Engine under the wing
    const eng = cyl(0.95, 0.85, 3.4, metal, side * 6.0, 2.7, 2.2, 14);
    eng.rotation.x = Math.PI / 2;
    g.add(eng);
    g.add(cyl(0.98, 0.98, 0.3, dark, side * 6.0, 2.7, 3.95, 14).rotateX(Math.PI / 2));
  }

  // Tail fin + stabilisers
  const fin = box(0.4, 5.2, 3.4, body, 0, 7.2, -14.2);
  fin.rotation.x = -0.22;
  g.add(fin);
  g.add(box(0.42, 1.2, 3.2, stripe, 0, 8.6, -14.9));
  for (const side of [-1, 1]) {
    g.add(box(5.4, 0.24, 2.0, body, side * 2.7, 5.6, -14.6));
  }

  // Landing gear
  for (const [x, z] of [[0, 13.5], [-2.4, -1.5], [2.4, -1.5]]) {
    g.add(cyl(0.12, 0.12, 2.6, metal, x, 1.5, z, 8));
    for (const side of [-1, 1]) {
      const wheel = cyl(0.5, 0.5, 0.36, dark, x + side * 0.4, 0.5, z, 12);
      wheel.rotation.z = Math.PI / 2;
      g.add(wheel);
    }
  }

  // Passenger door (so boarding has something to aim at)
  g.add(box(0.08, 1.9, 0.9, materials.matte(0xb9c2c8), -1.7, 4.2, 12.6));

  g.scale.setScalar(scale);
  g.name = 'aircraft';
  return g;
}

/** A glass jetbridge reaching from the terminal to an aircraft door. */
function jetbridge(length = 18) {
  const g = new THREE.Group();
  const glassMat = materials.glass();
  const frame = materials.matte(0xb7c2c8);
  g.add(box(2.6, 0.2, length, frame, 0, 3.6, length / 2));
  g.add(box(2.6, 0.2, length, frame, 0, 6.2, length / 2));
  for (const side of [-1, 1]) {
    g.add(box(0.14, 2.6, length, glassMat, side * 1.28, 4.9, length / 2));
    for (let i = 0; i <= 4; i++) {
      g.add(box(0.18, 2.7, 0.18, frame, side * 1.28, 4.9, (length * i) / 4));
    }
  }
  // Rotunda at the terminal end
  g.add(cyl(2.0, 2.0, 5.0, frame, 0, 2.5, 0, 14));
  // Cab at the aircraft end
  g.add(box(3.0, 3.0, 2.2, frame, 0, 4.7, length - 0.9));
  // Support legs
  for (const z of [length * 0.45, length * 0.8]) {
    g.add(cyl(0.16, 0.16, 3.6, frame, 0, 1.8, z, 8));
  }
  g.name = 'jetbridge';
  return g;
}

/** Ground support: a baggage tug with two carts. */
function groundTug() {
  const g = new THREE.Group();
  const body = materials.paint(0xf2c200);
  g.add(box(1.6, 0.9, 2.4, body, 0, 0.75, 0));
  g.add(box(1.5, 0.7, 1.0, materials.matte(0x2b2f36), 0, 1.45, -0.5));
  for (const [x, z] of [[-0.8, 0.8], [0.8, 0.8], [-0.8, -0.8], [0.8, -0.8]]) {
    const w = cyl(0.34, 0.34, 0.24, materials.matte(0x14161a), x, 0.34, z, 10);
    w.rotation.z = Math.PI / 2;
    g.add(w);
  }
  // Baggage carts behind
  for (let i = 1; i <= 2; i++) {
    const cart = new THREE.Group();
    cart.add(box(1.5, 0.5, 2.0, materials.matte(0x8d99ae), 0, 0.62, 0));
    cart.add(box(1.4, 0.18, 1.8, materials.paint(0x3d5a80), 0, 0.95, 0));
    for (const [x, z] of [[-0.7, 0.7], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]]) {
      const w = cyl(0.24, 0.24, 0.18, materials.matte(0x14161a), x, 0.24, z, 8);
      w.rotation.z = Math.PI / 2;
      cart.add(w);
    }
    cart.position.set(0, 0, -2.6 * i);
    g.add(cart);
  }
  g.name = 'groundTug';
  return g;
}

/** Air traffic control tower: shaft, cab, radar, beacon. */
function atcTower() {
  const g = new THREE.Group();
  const concrete = materials.matte(0xd7dde2);
  g.add(cyl(2.0, 2.6, 26, concrete, 0, 13, 0, 14));
  // Cab
  g.add(cyl(3.4, 3.0, 3.2, materials.glass(), 0, 27.6, 0, 14));
  g.add(cyl(3.6, 3.6, 0.3, concrete, 0, 29.4, 0, 14));
  g.add(cyl(3.5, 3.5, 0.4, concrete, 0, 25.9, 0, 14));
  // Radar dome + mast
  g.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 14, 10), materials.matte(0xeceff1)).translateY(31.2));
  g.add(cyl(0.1, 0.1, 3.0, materials.metalDark(), 0, 32.8, 0, 6));
  // Beacon
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), materials.glow(0xff4d4d));
  beacon.position.set(0, 34.5, 0);
  g.add(beacon);
  // Base block with windows
  g.add(box(9, 6, 9, concrete, 0, 3, 0));
  g.add(box(9.1, 1.1, 9.1, materials.glass(), 0, 5.2, 0));
  g.name = 'atcTower';
  return g;
}

/**
 * Build the airside scene.
 * @param {object} def interior definition
 * @returns {{group, collisions, spawn, bounds, lights, stations, exitZ, manifest, update}}
 */
export function buildAirfield(def = {}) {
  const group = new THREE.Group();
  const collisions = [];
  const lights = [];
  const stations = [];
  const dynamic = [];          // things that move after the merge
  const W = 150;
  const D = 300;               // apron + runway run north–south

  // ── Ground ────────────────────────────────────────────────
  // Apron concrete (the area the player may walk on).
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(70, 120), materials.concreteGround());
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0, -30);
  apron.receiveShadow = true;
  group.add(apron);

  // Runway: 45 m wide, 260 m long, with a shoulder either side.
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(45, 260), materials.asphalt());
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(-70, 0.02, -20);
  runway.receiveShadow = true;
  group.add(runway);

  // Taxiway linking the apron to the runway.
  const taxiway = new THREE.Mesh(new THREE.PlaneGeometry(70, 22), materials.asphalt());
  taxiway.rotation.x = -Math.PI / 2;
  taxiway.position.set(-35, 0.015, 5);
  taxiway.receiveShadow = true;
  group.add(taxiway);

  // Runway markings: centreline, threshold bars, aiming points, numbers.
  const paint = materials.matte(0xf2f4f5);
  for (let z = -140; z <= 100; z += 12) {
    group.add(box(0.9, 0.02, 7, paint, -70, 0.04, z));
  }
  for (const zEnd of [-148, 108]) {
    for (let i = -5; i <= 5; i++) {
      group.add(box(2.2, 0.02, 12, paint, -70 + i * 3.6, 0.04, zEnd));
    }
    // Piano-key threshold markings
    for (let i = -4; i <= 4; i++) {
      group.add(box(1.6, 0.02, 8, paint, -70 + i * 5.0, 0.04, zEnd + (zEnd < 0 ? 16 : -16)));
    }
  }
  // Taxiway centreline (yellow)
  for (let x = -66; x <= 4; x += 8) {
    group.add(box(6, 0.02, 0.5, materials.matte(0xf0c419), x, 0.04, 5));
  }
  // ── Apron markings ────────────────────────────────────────
  // Concrete is poured in bays, and an apron that has never seen a float is
  // the giveaway that a scene is painted rather than built. Joint lines run
  // the length of the slab; the stands get lead-in lines, a stop bar and a
  // number in a box, and the whole working area gets a red safety border.
  const joint = materials.matte(0x9c9c96);
  for (let z = -88; z <= 28; z += 12) {
    group.add(box(68, 0.012, 0.16, joint, -1, 0.03, z));
  }
  for (let x = -33; x <= 32; x += 12) {
    group.add(box(0.16, 0.012, 116, joint, x, 0.03, -30));
  }
  const standYellow = materials.matte(0xf0c419);
  const standRed = materials.matte(0xc0392b);
  for (const [i, z] of [10, -20, -50].entries()) {
    // Lead-in line from the taxi lane to the nose wheel
    group.add(box(26, 0.02, 0.4, standYellow, 8, 0.045, z));
    // Stop bar across the nose wheel mark
    group.add(box(6, 0.02, 0.5, standYellow, 15, 0.045, z));
    // Stand number, painted where the marshaller stands
    group.add(groundDecal(String(i + 1), { x: 12, z: z + 7.5, width: 5, height: 5 }));
    // Safety border round the stand: two long lines either side of the aircraft
    for (const dz of [11, -11]) {
      group.add(box(30, 0.015, 0.16, standRed, 4, 0.045, z + dz));
    }
    group.add(box(0.16, 0.015, 22, standRed, -11, 0.045, z));
  }
  // Apron boundary and a "no entry" band along the terminal face.
  group.add(box(0.4, 0.02, 118, standYellow, -34, 0.045, -30));
  group.add(box(1.2, 0.02, 118, standRed, 18.4, 0.045, -30));

  // Runway edge lights and centreline lights (emissive, no real lighting cost).
  const lampMat = materials.glow(0xfff3c4);
  const edgeMat = materials.glow(0x4dff88);
  for (let z = -145; z <= 105; z += 10) {
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), lampMat).translateX(-92.5).translateY(0.25).translateZ(z));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), lampMat).translateX(-47.5).translateY(0.25).translateZ(z));
    group.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), edgeMat).translateX(-70).translateY(0.15).translateZ(z));
  }

  // Perimeter fence between the apron and the runway — the reason the player
  // cannot wander onto an active runway, and a real thing airfields have.
  for (const z of [-90, -30, 30]) {
    const fence = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 12), materials.glass());
    fence.position.set(-30, 1.4, z);
    fence.rotation.y = Math.PI / 2;
    group.add(fence);
  }
  for (let z = -95; z <= 35; z += 5) {
    group.add(cyl(0.06, 0.06, 2.6, materials.metalDark(), -30, 1.3, z, 5));
  }
  for (let z = -95; z <= 35; z += 5) {
    group.add(box(2.4, 0.06, 0.06, materials.metalDark(), -30, 2.6, z));
  }

  // ── Terminal facade with three gates ──────────────────────
  // The landside face you would see from the forecourt: a glazed curtain wall
  // behind a concrete frame, a canopy over the drop-off, and the gates cut into
  // it. Indoors it is a wall; from the apron it reads as a terminal.
  const facade = materials.matte(0xdde3e8);
  group.add(box(6, 12, 90, facade, 22, 6, -20));
  // Curtain wall: mullions every 6 m, glazing between.
  for (let z = -64; z <= 24; z += 6) {
    group.add(box(0.5, 11.4, 0.5, materials.matte(0xb9c3ca), 18.9, 5.7, z));
  }
  group.add(box(0.3, 3.2, 88, materials.glass(), 18.8, 8.4, -20));
  group.add(box(0.3, 3.2, 88, materials.glass(), 18.8, 3.6, -20));
  // Roof slab and parapet
  group.add(box(8, 0.7, 92, materials.matte(0xc3ccd2), 21, 12.4, -20));
  // Canopy over the arrivals kerb
  group.add(box(6, 0.4, 88, materials.matte(0xe7edf1), 15.5, 6.4, -20));
  for (let z = -60; z <= 20; z += 10) {
    group.add(cyl(0.22, 0.22, 6.2, materials.metalDark(), 12.8, 3.1, z, 8));
  }
  // Gate doors and their jetbridge mouths
  for (const z of [10, -20, -50]) {
    group.add(box(6.4, 3.4, 4.0, materials.matte(0x1c2833), 22, 1.7, z));
    group.add(box(0.4, 0.5, 4.4, materials.matte(0x8d99ae), 18.8, 3.9, z));
  }
  // Terminal name across the apron face (canvas text, like the stand numbers)
  const nameSign = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 3),
    new THREE.MeshStandardMaterial({ map: groundText('MMIA', { size: 54, boxed: false }), transparent: true }),
  );
  nameSign.position.set(18.74, 10.4, -20);
  nameSign.rotation.y = Math.PI / 2;
  group.add(nameSign);

  // ── Aircraft on three stands, plus one taxiing ────────────
  const liveries = [
    { livery: 0xf4f6f6, accent: 0x1b6ca8 },
    { livery: 0xe8eef2, accent: 0x0f7b45 },
    { livery: 0xf7f3e8, accent: 0xc0392b },
  ];
  const standZ = [10, -20, -50];
  standZ.forEach((z, i) => {
    const plane = aircraft(liveries[i]);
    plane.position.set(2, 0, z);
    plane.rotation.y = Math.PI / 2;
    dynamic.push(plane);
    group.add(plane);
    // Jetbridge from the facade to the aircraft door
    const bridge = jetbridge(17);
    bridge.position.set(19, 0, z - 13);
    bridge.rotation.y = -Math.PI / 2;
    group.add(bridge);
    // Ground tug + carts beside the aircraft
    const tug = groundTug();
    tug.position.set(9, 0, z - 9);
    tug.rotation.y = 0.4;
    group.add(tug);
  });

  // The plane that actually moves: it taxis down the runway and comes back.
  const taxi = aircraft({ livery: 0xf4f6f6, accent: 0xf39c12 });
  taxi.position.set(-70, 0, 60);
  taxi.rotation.y = 0;
  group.add(taxi);

  // ── Control tower and technical blocks ────────────────────
  const tower = atcTower();
  tower.position.set(40, 0, 40);
  group.add(tower);

  // Hangar on the far side of the apron
  group.add(box(34, 14, 26, materials.matte(0xc8d0d6), 45, 7, -80));
  group.add(box(34.2, 3, 26.2, materials.matte(0x8d99ae), 45, 13, -80));
  group.add(box(20, 10, 0.4, materials.matte(0x6b7785), 45, 5, -67));

  // Ground support equipment you would actually see on a stand: baggage carts
  // in a train behind a tug, a fuel truck, a catering lift and chocks.
  for (const [z, rot] of [[2, 0.3], [-28, -0.4]]) {
    const train = new THREE.Group();
    train.add(groundTug());
    for (let i = 0; i < 3; i++) {
      const cart = box(1.6, 1.1, 2.4, materials.matte(0x7f8c8d), 0, 0.65, -2.0 - i * 2.8);
      train.add(cart);
      const lip = box(1.5, 0.12, 2.3, materials.matte(0x2c3e50), 0, 1.25, -2.0 - i * 2.8);
      train.add(lip);
    }
    train.position.set(10.5, 0, z);
    train.rotation.y = rot;
    group.add(train);
  }
  const fuelTruck = new THREE.Group();
  fuelTruck.add(box(2.4, 2.2, 6.4, materials.matte(0xe8eaec), 0, 1.4, 0));
  fuelTruck.add(box(2.5, 0.9, 6.5, materials.matte(0xc0392b), 0, 1.1, 0));
  fuelTruck.add(box(2.2, 1.4, 1.8, materials.matte(0x34495e), 0, 1.5, 3.9));
  for (const [x, z] of [[-1.05, 2.4], [1.05, 2.4], [-1.05, -2.2], [1.05, -2.2]]) {
    const w = cyl(0.5, 0.5, 0.34, materials.matte(0x14161a), x, 0.5, z, 12);
    w.rotation.z = Math.PI / 2;
    fuelTruck.add(w);
  }
  fuelTruck.position.set(12, 0, -38);
  fuelTruck.rotation.y = 0.15;
  group.add(fuelTruck);

  // Fuel farm: two tanks, a pump house
  for (const z of [-100, -110]) {
    group.add(cyl(3.2, 3.2, 6, materials.matte(0xeceff1), 8, 3, z, 16));
    group.add(cyl(3.3, 3.3, 0.3, materials.matte(0x8d99ae), 8, 6.2, z, 16));
  }
  group.add(box(6, 3, 5, materials.matte(0xb7c2c8), 16, 1.5, -105));

  // Windsock
  group.add(cyl(0.08, 0.08, 6, materials.metalDark(), -30, 3, -100, 6));
  const sock = cyl(0.9, 0.45, 3.0, materials.paint(0xe67e22), -30, 5.4, -100, 8);
  sock.rotation.z = Math.PI / 2;
  group.add(sock);

  // ── Stations ──────────────────────────────────────────────
  const gate = makeStation({
    id: 'boarding', label: 'Board the aircraft', icon: '✈️', x: 14, z: -20, radius: 3.2,
    actions: [
      { kind: 'activity', id: 'flight', label: 'Take the flight to Abuja', hint: '40 s in the air — fun, charisma, and nothing left in your stomach' },
    ],
  });
  if (gate) {
    stations.push(gate);
    group.add(createStationMarker(gate));
  }

  const back = makeStation({
    id: 'back-to-terminal', label: 'Back to the terminal', icon: '🚪', x: 16, z: 10, radius: 2.6,
    actions: [{ kind: 'enter', interiorId: 'in-airport', label: 'Return to the terminal', hint: 'Walk back through the gate' }],
  });
  if (back) {
    stations.push(back);
    group.add(createStationMarker(back));
  }

  const captain = makeStation({
    id: 'captain', label: 'The captain', icon: '🧑‍✈️', x: 12, z: -14, radius: 2.8,
    actions: [{ kind: 'staff', label: 'Talk to the captain', hint: 'He flies this one' }],
  });
  if (captain) {
    stations.push(captain);
    group.add(createStationMarker(captain));
  }

  const apronView = makeStation({
    id: 'apron', label: 'Watch the apron', icon: '🛬', x: 6, z: 26, radius: 3.0,
    actions: [
      { kind: 'activity', id: 'planespot', label: 'Plane-spot for a while', hint: 'Fun +25 — it is a hobby, it counts' },
    ],
  });
  if (apronView) {
    stations.push(apronView);
    group.add(createStationMarker(apronView));
  }

  // ── Lights ────────────────────────────────────────────────
  for (const [x, z] of [[0, -10], [0, -45], [0, 20], [10, 30], [-10, 0]]) {
    lights.push({ x, y: 9, z });
  }

  // ── Merge the static world, keep the aircraft separate ───
  // The planes and the tug are removed before merging so they can move, then
  // re-added: merging them would freeze them in place forever.
  for (const obj of dynamic) group.remove(obj);
  const merged = mergeByMaterial(group, { bakeWorld: true });
  for (const obj of dynamic) merged.add(obj);

  // ── Movement: the taxiing aircraft ────────────────────────
  let taxiZ = 60;
  let taxiDir = -1;
  const update = (dt) => {
    taxiZ += taxiDir * 9 * dt;
    if (taxiZ < -140) taxiDir = 1;
    if (taxiZ > 90) taxiDir = -1;
    taxi.position.z = taxiZ;
    taxi.position.y = Math.abs(Math.sin(taxiZ * 0.02)) * 0.05;
  };

  return {
    group: merged,
    collisions,
    spawn: { x: 16, z: 14, rotY: Math.PI },
    exitZ: 14,
    // The player is kept on the apron. The runway is scenery, not a walkway.
    bounds: { minX: -6, maxX: 20, minZ: -60, maxZ: 34 },
    lights,
    stations,
    manifest: { aircraft: 4, jetbridge: 3, groundTug: 3, atcTower: 1 },
    update,
  };
}
