// client/src/world/interiorLayouts.js
// What is actually inside each kind of building.
//
// Before this file there were three fitting routines — "shop", "office",
// "clinic" — so a market, a garage and a bank were the same room with different
// clutter, and the market was empty enough that the player walked into it and
// complained. Every venue now gets its own floor plan: stalls, pews, beds,
// check-in desks, teller counters, prayer mats.
//
// Each layout receives a context from InteriorBuilder and places props through
// `place()`, which registers collision. The rules every layout follows:
//   · the doorway is at z = +hd, x ≈ 0 — nothing may block it or the 2 m of
//     floor behind it
//   · every aisle the player is meant to walk down is at least 0.9 m clear
//   · the room is filled, but a player can always reach the far wall

import * as V from './venueProps.js';

// ── Shared helpers ──────────────────────────────────────────────

/** Place a prop and give it a collision footprint. */
function put(ctx, prop, x, z, rotY = 0, fp = null, y = 0) {
  return ctx.place(ctx.group, ctx.collisions, prop, x, z, rotY, fp, y);
}

/** True if (x,z) is clear of the entrance corridor (x≈0, z from hd-2.6 to hd). */
function inDoorway(ctx, x, z, pad = 1.0) {
  return Math.abs(x) < pad && z > ctx.hd - 3.0;
}

/** Stop a layout from ever parking something in front of the door. */
function putSafe(ctx, prop, x, z, rotY = 0, fp = null, y = 0) {
  if (inDoorway(ctx, x, z)) return null;
  // …or in front of any doorway the builder cut into a partition, which is how
  // an office back room ended up sealed behind a desk screen.
  for (const r of ctx.reserved || []) {
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return null;
  }
  return put(ctx, prop, x, z, rotY, fp, y);
}

/** A raised platform (church dais, stage, baggage belt plinth). */
function dais(ctx, w, d, h, x, z, color = 0x8a6540) {
  ctx.group.add(ctx.box(w, h, d, ctx.materials.wood(color), x, h / 2, z));
}

/** A fabric curtain divider, the kind hospitals use between beds. */
function curtain(ctx, x, z, len, alongX = true) {
  const g = ctx.group;
  g.add(ctx.box(alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, ctx.materials.metalLight(), x, 2.3, z));
  const cloth = alongX
    ? ctx.box(len, 1.9, 0.04, ctx.materials.fabric(0xbfe3ea), x, 1.35, z)
    : ctx.box(0.04, 1.9, len, ctx.materials.fabric(0xbfe3ea), x, 1.35, z);
  g.add(cloth);
}

const rug = (ctx, x, z, w, d, color) => ctx.group.add(ctx.plate(w, d, ctx.materials.fabric(color), x, 0.02, z));

// ══════════════════════════════════════════════════════════════
// LAYOUTS
// ══════════════════════════════════════════════════════════════

export const LAYOUTS = {
  /**
   * A Lagos market hall: two side rows of stalls facing a central aisle, two
   * island rows in the middle, a fabric section, a fish table and sacks of
   * grain at the back. This is the room the player said was empty.
   */
  market(ctx) {
    const { W, D, hw, hd, rng } = ctx;
    const palettes = [0xc0392b, 0x2e86de, 0xf39c12, 0x27ae60, 0x8e44ad, 0xe67e22];
    let n = 0;

    // ── Side rows: stalls against both long walls, facing the aisle ──
    const stallW = 2.8;
    const stallD = 1.5;
    const rowsZ = hd - 2.4;
    const rowsCount = Math.max(3, Math.floor((D - 4.6) / 2.1));
    for (const side of [-1, 1]) {
      for (let i = 0; i < rowsCount; i++) {
        const z = rowsZ - i * 2.1;
        if (z < -hd + 2.0) break;
        const goods = (n % 3 === 0) ? 'fabric' : 'produce';
        putSafe(ctx, V.marketStall({
          w: stallW, d: stallD, palette: palettes[n % palettes.length], goods, rng,
        }), side * (hw - 1.1), z, side > 0 ? -Math.PI / 2 : Math.PI / 2,
        { w: stallW, d: stallD });
        n++;
      }
    }

    // ── Island rows down the middle, back to back with a 2 m walking gap ──
    const islandX = [-4.2, 4.2];
    for (const ix of islandX) {
      for (let i = 0; i < rowsCount - 1; i++) {
        const z = rowsZ - 1.6 - i * 2.3;
        if (z < -hd + 2.4) break;
        putSafe(ctx, V.marketStall({
          w: 2.6, d: 1.4, palette: palettes[(n + 3) % palettes.length],
          goods: n % 4 === 0 ? 'fabric' : 'produce', rng,
        }), ix, z, 0, { w: 2.6, d: 1.4 });
        n++;
      }
    }

    // ── Back of the hall: the wet and dry goods zone ──
    putSafe(ctx, V.fishTable(), -hw + 2.2, -hd + 1.4, Math.PI / 2, { w: 1.6, d: 0.8 });
    putSafe(ctx, V.sackStack(0xd8cba8), -hw + 4.4, -hd + 1.0, 0, { w: 0.9, d: 0.4 });
    putSafe(ctx, V.sackStack(0x8d6e63), -hw + 5.4, -hd + 1.0, 0, { w: 0.9, d: 0.4 });
    putSafe(ctx, V.sackStack(0xd8cba8), -hw + 4.4, -hd + 1.5, 0, null);
    putSafe(ctx, V.priceBoard(), -2.0, -hd + 1.2, 0, { w: 0.6, d: 0.3 });
    putSafe(ctx, V.priceBoard(), 2.0, -hd + 1.2, 0, { w: 0.6, d: 0.3 });

    // ── Umbrellas over the open floor, and baskets of goods under them ──
    for (const [ux, uz, col] of [[-7.6, 1.5, 0x2e86de], [7.6, 1.5, 0xc0392b], [-7.6, -5.0, 0x27ae60]]) {
      if (Math.abs(ux) > hw - 1.4 || uz < -hd + 1.4) continue;
      const u = V.marketUmbrella(col);
      ctx.group.add(u);
      u.position.set(ux, 0, uz);
      putSafe(ctx, V.sackStack(0xd8cba8), ux + 0.5, uz - 0.5, 0, { w: 0.9, d: 0.4 });
    }

    // A tiled strip down the middle of the hall — markets are concrete, the
    // aisle is where the traders sweep.
    ctx.floorPatch(ctx.group, 0, 0, Math.min(3.4, W * 0.22), D - 0.6,
      ctx.materials.floorTile(), 0.012);

    // Ceiling: bare bulbs on a wire run, plus the signage over the door.
    for (let i = 0; i < 4; i++) {
      ctx.addCeilingLamp(ctx.group, ctx.lights, -hw * 0.55, -hd + 3 + i * ((D - 6) / 3), ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, hw * 0.55, -hd + 3 + i * ((D - 6) / 3), ctx.H);
    }
    ctx.group.add(ctx.box(3.0, 0.04, 0.04, ctx.materials.metalDark(), 0, ctx.H - 0.12, 0));
    const sign = V.wallSign(2.6, 0.45, 0xffd166);
    sign.position.set(0, ctx.H - 0.9, hd - 0.16);
    sign.rotation.y = Math.PI;
    ctx.group.add(sign);
    ctx.station({
      id: 'greeter', label: 'Talk to the trader', icon: '🧺', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the trader', hint: 'She is calling customers in' }],
    });

  },

  /** Church: altar on a dais, two banks of pews, stained glass, pulpit, font. */
  church(ctx) {
    const { W, D, hw, hd } = ctx;

    // Dais + altar at the far end.
    dais(ctx, Math.min(W - 1.2, 9), 3.2, 0.22, 0, -hd + 2.0, 0x6b4f33);
    put(ctx, V.altar(), 0, -hd + 2.2, 0, { w: 2.0, d: 0.75 }, 0.22);
    put(ctx, V.pulpit(), hw - 2.6, -hd + 1.6, Math.PI * 0.15, { w: 0.9, d: 0.6 }, 0.22);
    put(ctx, V.pulpit(), -hw + 2.4, -hd + 1.6, -Math.PI * 0.15, { w: 0.9, d: 0.6 }, 0.22);

    // Choir stalls facing the altar.
    for (let i = 0; i < 2; i++) {
      putSafe(ctx, V.pew(2.4), -2.6 + i * 0.0 - 1.4, -hd + 4.6 + i * 1.4, Math.PI, { w: 2.4, d: 0.5 });
      putSafe(ctx, V.pew(2.4), 1.4, -hd + 4.6 + i * 1.4, Math.PI, { w: 2.4, d: 0.5 });
    }

    // The nave: two blocks of pews either side of a 1.6 m central aisle.
    const pewLen = Math.min(3.4, hw - 2.2);
    const rows = Math.max(4, Math.floor((D - 9.5) / 1.5));
    for (let i = 0; i < rows; i++) {
      const z = hd - 4.2 - i * 1.5;
      if (z < -hd + 6.2) break;
      ctx.place(ctx.group, ctx.collisions, V.pew(pewLen), -(hw - 1.4 - pewLen / 2), z, 0, { w: pewLen, d: 0.5 });
      ctx.place(ctx.group, ctx.collisions, V.pew(pewLen), (hw - 1.4 - pewLen / 2), z, 0, { w: pewLen, d: 0.5 });
    }

    // Stained glass: three panels behind the altar, two down each side wall.
    for (const [x, wpanel] of [[-2.4, 1.5], [0, 1.9], [2.4, 1.5]]) {
      const win = V.stainedGlass(wpanel, 3.4);
      win.position.set(x, 1.5, -hd + 0.12);
      ctx.group.add(win);
    }
    for (const side of [-1, 1]) {
      for (const z of [-hd * 0.35, hd * 0.25]) {
        const win = V.stainedGlass(1.3, 3.0);
        win.position.set(side * (hw - 0.14), 1.5, z);
        win.rotation.y = -side * Math.PI / 2;
        ctx.group.add(win);
      }
    }

    // Font, collection table and a lectern by the door.
    put(ctx, V.pulpit(), -hw + 1.5, hd - 2.0, Math.PI, { w: 0.9, d: 0.6 });
    ctx.group.add(ctx.cyl(0.32, 0.85, ctx.materials.matte(0xd8c9a8), hw - 1.6, 0.42, hd - 2.2, 12));
    ctx.collisions.push(ctx.rotatedAabb(hw - 1.6, hd - 2.2, 0.64, 0.64, 0));
    ctx.group.add(ctx.cyl(0.34, 0.06, ctx.materials.glass(), hw - 1.6, 0.88, hd - 2.2, 12));

    rug(ctx, 0, -hd + 4.0, Math.min(W - 1.4, 9), 3.0, 0x7b1e24);

    // Hanging lamps down the nave.
    for (let i = 0; i < 3; i++) {
      const z = hd - 5.5 - i * ((D - 8) / 2);
      ctx.addCeilingLamp(ctx.group, ctx.lights, 0, z, ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, -hw * 0.6, z, ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, hw * 0.6, z, ctx.H);
    }
    ctx.station({
      id: 'usher', label: 'The usher', icon: '🙏', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the usher', hint: 'He works here' }],
    });

  },

  /** Mosque: mihrab, rows of prayer mats, shoe rack, ablution corner. */
  mosque(ctx) {
    const { W, D, hw, hd } = ctx;
    ctx.floorPatch(ctx.group, 0, 0, W - 0.4, D - 0.4, ctx.materials.carpet(), 0.012);

    // Mihrab on the back wall, centred.
    put(ctx, V.mihrab(), 0, -hd + 0.2, 0, { w: 1.8, d: 0.2 });

    // Rows of prayer mats, five abreast, facing the mihrab.
    const cols = Math.max(3, Math.floor((W - 2.2) / 1.0));
    const rows = Math.max(3, Math.floor((D - 3.4) / 1.3));
    const colors = [0x2e6b5e, 0x35586b, 0x4a3f6b, 0x2e6b5e];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -((cols - 1) / 2) * 1.0 + c * 1.0;
        const z = -hd + 2.2 + r * 1.3;
        if (z > hd - 2.2) continue;
        const mat = V.prayerMat(colors[(r + c) % colors.length]);
        mat.position.set(x, 0, z);
        ctx.group.add(mat);
      }
    }

    // Shoe rack by the door, a low table for copies of the Qur'an, a clock.
    put(ctx, V.shoeRack(), -hw + 1.0, hd - 0.8, Math.PI / 2, { w: 1.6, d: 0.32 });
    put(ctx, V.shoeRack(), hw - 1.0, hd - 0.8, -Math.PI / 2, { w: 1.6, d: 0.32 });
    putSafe(ctx, ctx.bookshelfProp(1.2, 0.9, 0.4), -hw + 0.6, -hd + 3.0, Math.PI / 2, { w: 1.2, d: 0.4 });
    ctx.group.add(ctx.box(0.5, 0.5, 0.06, ctx.materials.matte(0xe8eef2), hw - 0.14, 2.4, -hd + 2.4));

    // Ablution taps along one wall.
    for (let i = 0; i < 3; i++) {
      ctx.group.add(ctx.box(0.5, 0.12, 0.4, ctx.materials.matte(0xdfe6ea), hw - 0.4, 0.9, -hd + 5.2 + i * 1.1));
      ctx.group.add(ctx.cyl(0.02, 0.16, ctx.materials.chrome(), hw - 0.28, 1.0, -hd + 5.2 + i * 1.1, 6));
    }
    ctx.station({
      id: 'imam', label: 'The muezzin', icon: '🕌', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the muezzin', hint: 'He is on his way to the minaret' }],
    });

  },

  /** Hospital: reception, waiting area, a ward of beds with curtains, trolley. */
  hospital(ctx) {
    const { W, D, hw, hd, pal } = ctx;

    putSafe(ctx, V.receptionCounter(3.2), hw - 2.0, hd - 2.4, Math.PI, { w: 3.2, d: 0.62 });
    putSafe(ctx, V.waitingRow(4, pal.accent), -hw + 2.0, hd - 2.2, 0, { w: 2.2, d: 0.5 });
    putSafe(ctx, V.waitingRow(4, pal.accent), -hw + 4.4, hd - 2.2, 0, { w: 2.2, d: 0.5 });
    putSafe(ctx, V.wheelchair(), hw - 0.9, hd - 4.4, -Math.PI / 2, null);

    // ── Ward: two rows of beds against the side walls ──
    const bedRows = Math.max(2, Math.floor((D - 5.0) / 2.6));
    for (let i = 0; i < bedRows; i++) {
      const z = hd - 4.6 - i * 2.6;
      if (z < -hd + 1.6) break;
      for (const side of [-1, 1]) {
        const x = side * (hw - 1.1);
        putSafe(ctx, V.hospitalBed(i % 2 ? 0xdff0f6 : 0xe8f4ef), x, z, side > 0 ? Math.PI / 2 : -Math.PI / 2,
          { w: 0.95, d: 2.0 });
        putSafe(ctx, V.ivStand(), x - side * 0.9, z - 0.5, 0, null);
        // Curtain rail between beds, not across the aisle.
        if (i < bedRows - 1) curtain(ctx, x - side * 1.1, z - 1.3, 1.6, false);
      }
    }

    // Trolley and supply cabinets at the back, lab bench on the other side.
    putSafe(ctx, V.trolley(), 0, -hd + 1.4, 0, { w: 0.7, d: 1.9 });
    putSafe(ctx, V.medicalCabinet(1.0, 1.9), -2.6, -hd + 0.5, 0, { w: 1.0, d: 0.42 });
    putSafe(ctx, V.medicalCabinet(1.0, 1.9), 2.6, -hd + 0.5, 0, { w: 1.0, d: 0.42 });
    putSafe(ctx, V.labBench(1.6), hw - 1.2, -hd + 4.0, -Math.PI / 2, { w: 1.6, d: 0.7 });

    // Signs above the doors and the ward divider.
    const sign = V.wallSign(1.8, 0.34, 0xff6b6b);
    sign.position.set(0, 2.6, hd - 0.14);
    sign.rotation.y = Math.PI;
    ctx.group.add(sign);
    ctx.wallRun(ctx.group, ctx.collisions, {
      x1: -hw + 0.2, z1: -hd + 3.3, x2: hw * 0.45, z2: -hd + 3.3,
      height: 2.6, thickness: 0.08, door: { at: 1.2, width: 1.2, height: 2.1 },
    });

    for (let i = 0; i < 3; i++) {
      ctx.addCeilingLamp(ctx.group, ctx.lights, -hw * 0.45, hd - 2 - i * ((D - 4) / 2), ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, hw * 0.45, hd - 2 - i * ((D - 4) / 2), ctx.H);
    }
    ctx.station({
      id: 'nurse-station', label: 'Nurse station', icon: '👩‍⚕️', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the nurse', hint: 'She works here' }],
    });

  },

  /** Small clinic: exam couch, reception, waiting chairs, supply cabinet. */
  clinic(ctx) {
    const { hw, hd, pal } = ctx;
    putSafe(ctx, V.receptionCounter(2.2, 0xeef2f4), hw - 1.6, hd - 2.2, Math.PI, { w: 2.2, d: 0.62 });
    putSafe(ctx, V.waitingRow(3, pal.accent), -hw + 1.6, hd - 2.0, 0, { w: 1.7, d: 0.5 });
    putSafe(ctx, V.hospitalBed(0xdff0f6), -hw + 1.2, -hd + 3.2, Math.PI / 2, { w: 0.95, d: 2.0 });
    putSafe(ctx, V.ivStand(), -hw + 2.2, -hd + 2.4, 0, null);
    putSafe(ctx, V.medicalCabinet(0.9, 1.8), hw - 0.6, -hd + 1.2, -Math.PI / 2, { w: 0.9, d: 0.42 });
    putSafe(ctx, V.labBench(1.3), 0, -hd + 0.7, 0, { w: 1.3, d: 0.7 });
    putSafe(ctx, V.wheelchair(), hw - 0.8, hd - 3.6, -Math.PI / 2, null);
    putSafe(ctx, ctx.bookshelfProp(1.0, 1.4, 0.34), -hw + 0.4, -hd + 0.9, Math.PI / 2, { w: 1.0, d: 0.34 });
    ctx.station({
      id: 'nurse-station', label: 'Nurse station', icon: '👩‍⚕️', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the nurse', hint: 'She works here' }],
    });

  },

  /** Airport terminal: check-in, security, departure lounge, baggage claim. */
  airport(ctx) {
    const { W, D, hw, hd } = ctx;

    // ── Check-in row along the left wall ──
    // Eight desks' worth of frontage in a 22 m hall: desk, overhead number,
    // and a roped queue so the row reads as a queue and not as three tables.
    const desks = Math.max(2, Math.floor((D - 5) / 2.6));
    for (let i = 0; i < desks; i++) {
      const z = hd - 3.2 - i * 2.6;
      if (z < -hd + 3.0) break;
      putSafe(ctx, V.checkInDesk(0x24425a), -hw + 1.3, z, -Math.PI / 2, { w: 2.4, d: 0.8 });
      for (const qz of [z + 1.0, z - 1.0]) {
        putSafe(ctx, V.stanchion(), -hw + 2.9, qz, 0, null);
        putSafe(ctx, V.stanchion(), -hw + 4.2, qz, 0, null);
      }
      // A queue lane divider, and one dropped bag per desk.
      ctx.group.add(ctx.box(0.03, 0.03, 2.0, ctx.materials.fabric(0x1c2833), -hw + 3.55, 0.9, z));
      putSafe(ctx, ctx.box(0.5, 0.36, 0.34, ctx.materials.matte(0x37474f), -hw + 4.9, 0.18, z + 0.5), -hw + 4.9, z + 0.5, 0, null);
      // Desk staff, facing the queue.
      putSafe(ctx, V.staffFigure({ role: 'cashier', shirt: 0x1b6ca8, skin: i % 2 ? 0x8d5524 : 0x6b4226 }),
        -hw + 1.55, z - 0.9, Math.PI / 2, null);
    }
    // Overhead hall sign, the way every terminal has one.
    const hallSign = V.wallSign(3.6, 0.5, 0x1e5f8a);
    hallSign.position.set(-hw + 4.0, 3.2, hd - 0.16);
    ctx.group.add(hallSign);

    // ── Security channel across the middle of the hall ──
    // Two lanes, each with a walk-through detector, an x-ray machine, a tray
    // table and rope either side. You can see which lane you are in.
    const secZ = 1.0;
    for (const lane of [-1, 1]) {
      const lx = lane * 3.2;
      putSafe(ctx, V.securityGate(), lx, secZ, 0, { w: 1.3, d: 0.3 });
      putSafe(ctx, V.xrayScanner(), lx + lane * 2.4, secZ, 0, { w: 2.6, d: 1.0 });
      for (const px of [lx - 2.6, lx + 4.6]) putSafe(ctx, V.stanchion(), px, secZ, 0, null);
      for (const px of [lx - 2.6, lx + 4.6]) putSafe(ctx, V.stanchion(), px, secZ - 2.4, 0, null);
      ctx.group.add(ctx.box(0.03, 0.03, 2.4, ctx.materials.fabric(0x1c2833), lx - 2.6, 0.9, secZ - 1.2));
      ctx.group.add(ctx.box(0.03, 0.03, 2.4, ctx.materials.fabric(0x1c2833), lx + 4.6, 0.9, secZ - 1.2));
      // Tray table beside each machine.
      putSafe(ctx, ctx.box(1.0, 0.82, 0.5, ctx.materials.matte(0x546e7a), lx + lane * 0.9, 0.41, secZ + 1.1),
        lx + lane * 0.9, secZ + 1.1, 0, null);
      putSafe(ctx, V.staffFigure({ role: 'guard', shirt: 0x2b2f36, skin: 0x6b4226 }),
        lx + lane * 1.9, secZ + 1.7, Math.PI, null);
    }

    // Departure board on the wall above security.
    const board = V.departureBoard(3.4);
    board.position.set(0, 0.2, secZ - 1.6);
    board.rotation.y = 0;
    ctx.group.add(board);

    // ── Departure lounge: seat rows facing the board ──
    // Two banks of seating, because a terminal's waiting area is where people
    // actually spend the hour before a flight.
    const loungeZ = -2.6;
    for (let r = 0; r < 4; r++) {
      for (let c = -2; c <= 2; c++) {
        const x = c * 2.9;
        const z = loungeZ - r * 1.7;
        if (z < -hd + 2.0 || Math.abs(x) > hw - 1.6) continue;
        putSafe(ctx, V.airportSeatRow(3, 0x24425a), x, z, Math.PI, { w: 1.9, d: 0.6 });
      }
    }
    // A second waiting area at the gate, facing the apron, with charging posts.
    for (let c = -1; c <= 1; c++) {
      putSafe(ctx, V.airportSeatRow(3, 0x24425a), hw - 2.6, -hd + 6.2 + c * 1.6, -Math.PI / 2, { w: 1.9, d: 0.6 });
    }
    for (const [px, pz] of [[hw - 3.8, -hd + 4.2], [hw - 3.8, -hd + 8.2]]) {
      putSafe(ctx, ctx.box(0.28, 0.9, 0.28, ctx.materials.matte(0x2c3e50), px, 0.45, pz), px, pz, 0, null);
    }
    // Signage over the seating, and the café's own sign.
    const loungeSign = V.wallSign(2.8, 0.44, 0x2c3e50);
    loungeSign.position.set(0, 3.0, -hd + 0.16);
    ctx.group.add(loungeSign);
    const cafeSign = V.wallSign(1.8, 0.4, 0xc0392b);
    cafeSign.position.set(hw - 0.16, 2.8, hd - 4.6);
    cafeSign.rotation.y = -Math.PI / 2;
    ctx.group.add(cafeSign);

    // ── Duty free: a small shop by the gate, shelves and a till ──
    putSafe(ctx, V.shopShelf(2.4, 11), -hw + 1.2, -hd + 5.0, Math.PI / 2, { w: 2.4, d: 0.9 });
    putSafe(ctx, V.shopShelf(2.4, 12), -hw + 1.2, -hd + 7.8, Math.PI / 2, { w: 2.4, d: 0.9 });
    putSafe(ctx, V.checkout(), -hw + 1.0, -hd + 10.6, Math.PI / 2, { w: 2.0, d: 0.9 });
    putSafe(ctx, V.fridgeCase(1.2, 2.0), -hw + 1.1, -hd + 12.6, Math.PI / 2, { w: 1.2, d: 0.8 });

    // ── Café tables: somewhere to sit with the coffee ──
    for (const [tx, tz] of [[hw - 4.6, hd - 6.4], [hw - 6.6, hd - 6.4], [hw - 4.6, hd - 8.4], [hw - 6.6, hd - 8.4]]) {
      putSafe(ctx, V.diningSet(0x2c3e50), tx, tz, 0, { w: 1.4, d: 1.4 });
    }
    // Baggage trolleys, the universal airport furniture.
    for (const [bx, bz] of [[3.0, hd - 3.0], [4.2, hd - 3.0], [-4.0, -hd + 5.0]]) {
      putSafe(ctx, V.shoppingTrolley(), bx, bz, 0.4, { w: 0.7, d: 1.0 });
    }

    // Gate desk and baggage carousel at the back.
    putSafe(ctx, V.checkInDesk(0x2c3e50), hw - 1.4, -hd + 2.4, -Math.PI / 2, { w: 2.4, d: 0.8 });
    putSafe(ctx, V.carousel(Math.min(1.7, hw * 0.2)), 0, -hd + 2.6, 0, { w: 3.2, d: 3.2 });

    // A coffee kiosk and a kiosk sign in the corner.
    putSafe(ctx, V.shopShelf(1.8, 3), hw - 1.0, hd - 2.6, -Math.PI / 2, { w: 1.8, d: 0.9 });

    // ── Toilets: a real washroom in the corner, not just a sign ──
    // Two cubicles and a basin, walled off with a doorway, because "the airport
    // has toilets" should mean you can walk into them.
    const washX = hw - 3.2;
    const washZ = -hd + 3.4;
    ctx.wallRun(ctx.group, ctx.collisions, {
      x1: hw - 6.4, z1: washZ, x2: hw - 0.2, z2: washZ,
      height: 2.5, thickness: 0.08, door: { at: 1.0, width: 1.0, height: 2.1 },
    });
    ctx.wallRun(ctx.group, ctx.collisions, {
      x1: hw - 6.4, z1: -hd + 0.2, x2: hw - 6.4, z2: washZ,
      height: 2.5, thickness: 0.08,
    });
    ctx.wallRun(ctx.group, ctx.collisions, {
      x1: hw - 3.6, z1: -hd + 0.2, x2: hw - 3.6, z2: washZ - 1.6,
      height: 2.0, thickness: 0.07,
    });
    putSafe(ctx, ctx.toiletProp(), hw - 1.0, -hd + 0.9, Math.PI, null);
    putSafe(ctx, ctx.toiletProp(), hw - 2.6, -hd + 0.9, Math.PI, null);
    putSafe(ctx, ctx.basinProp(), hw - 5.4, -hd + 1.0, Math.PI / 2, null);
    void washX;

    // ── People: this is an airport, there are people in it ──
    putSafe(ctx, V.staffFigure({ role: 'cashier', shirt: 0x1b6ca8, skin: 0x8d5524 }), -hw + 1.2, hd - 5.0, Math.PI / 2, null);
    putSafe(ctx, V.staffFigure({ role: 'guard', shirt: 0x2b2f36, skin: 0x6b4226 }), 0.2, secZ + 1.2, 0, null);
    putSafe(ctx, V.staffFigure({ role: 'pilot', skin: 0x8d5524 }), -2.0, hd - 4.0, 0.4, null);
    putSafe(ctx, V.staffFigure({ role: 'passenger', shirt: 0x27ae60, skin: 0x8d5524 }), 2.6, hd - 3.2, -0.5, null);
    putSafe(ctx, V.staffFigure({ role: 'passenger', shirt: 0x8e44ad, skin: 0x6b4226 }), 1.0, -hd + 6.0, Math.PI, null);
    putSafe(ctx, V.staffFigure({ role: 'nurse', skin: 0x8d5524 }), -hw + 2.4, -hd + 4.0, 0, null);
    // A terminal is mostly people waiting. Seated travellers, staff on the
    // floor, someone at the café counter.
    for (const [px, pz, rot, shirt, skin] of [
      [-2.9, -4.3, 0, 0xc0392b, 0x8d5524],
      [0.0, -4.3, 0, 0x2980b9, 0x6b4226],
      [2.9, -6.0, 0, 0xf39c12, 0x8d5524],
      [-5.8, -7.7, 0, 0x8e44ad, 0x6b4226],
      [5.8, -4.3, 0, 0x16a085, 0x8d5524],
      [hw - 5.6, hd - 7.4, -Math.PI / 2, 0xe67e22, 0x6b4226],
      [-hw + 3.2, -hd + 8.6, Math.PI / 2, 0x7f8c8d, 0x8d5524],
      [6.4, 3.4, Math.PI, 0x34495e, 0x6b4226],
      [-6.2, 4.2, Math.PI, 0x95a5a6, 0x8d5524],
    ]) {
      putSafe(ctx, V.staffFigure({ role: 'passenger', shirt, skin }), px, pz, rot, null);
    }
    // Cabin crew walking through, and a cleaner at work.
    putSafe(ctx, V.staffFigure({ role: 'pilot', skin: 0x6b4226 }), 1.8, -hd + 3.4, Math.PI, null);
    putSafe(ctx, V.staffFigure({ role: 'nurse', shirt: 0x1b6ca8, skin: 0x8d5524 }), -hw + 2.2, hd - 12.0, 0, null);
    putSafe(ctx, V.staffFigure({ role: 'guard', shirt: 0x1b6ca8, skin: 0x6b4226 }), hw - 2.0, -hd + 2.0, -Math.PI / 2, null);
    // Pushchairs and luggage make the lounge read as occupied.
    for (const [lx, lz] of [[-1.2, -hd + 4.2], [3.4, hd - 5.4]]) {
      putSafe(ctx, ctx.box(0.6, 0.4, 0.4, ctx.materials.matte(0x6d4c41), lx, 0.2, lz), lx, lz, 0, null);
    }
    const gateSign = V.wallSign(2.2, 0.4, 0x54e08a);
    gateSign.position.set(-hw + 1.6, 2.5, -hd + 0.14);
    ctx.group.add(gateSign);

    for (let i = 0; i < 3; i++) {
      ctx.addCeilingLamp(ctx.group, ctx.lights, -hw * 0.5, hd - 2 - i * ((D - 4) / 2), ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, hw * 0.5, hd - 2 - i * ((D - 4) / 2), ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, 0, hd - 2 - i * ((D - 4) / 2), ctx.H);
    }
    ctx.station({
      id: 'agent', label: 'Airline agent', icon: '🧑‍✈️', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the agent', hint: 'She is at the counter' }],
    });

  },

  /** Bank: teller counters behind a rope, vault, deposit boxes, ATM. */
  bank(ctx) {
    const { W, D, hw, hd, pal } = ctx;

    // Teller line along the back wall.
    const tellers = Math.max(2, Math.floor((W - 2.0) / 3.0));
    for (let i = 0; i < tellers; i++) {
      const x = -((tellers - 1) / 2) * 3.0 + i * 3.0;
      put(ctx, V.tellerCounter(2.6, 0x1c2833), x, -hd + 1.0, 0, { w: 2.6, d: 0.7 });
    }
    // Queue between the ropes, facing the tellers.
    putSafe(ctx, V.queuePosters(5, Math.min(W - 3.0, 8.0)), 0, -hd + 3.4, 0, null);
    for (let i = 0; i < 3; i++) {
      putSafe(ctx, V.waitingRow(3, pal.accent), -hw + 2.4 + i * 2.6, hd - 2.6, 0, { w: 1.7, d: 0.5 });
    }

    // ATM by the door and the vault on the side wall.
    putSafe(ctx, V.atmMachine(), hw - 1.2, hd - 1.6, -Math.PI / 2, { w: 0.9, d: 0.6 });
    put(ctx, V.vaultDoor(), hw - 0.2, -hd + 5.6, -Math.PI / 2, { w: 2.6, d: 0.3 });
    putSafe(ctx, V.depositBoxes(2.2, 1.8), hw - 0.35, -hd + 2.8, -Math.PI / 2, { w: 2.2, d: 0.45 });

    // Manager's desk and a partition.
    putSafe(ctx, ctx.officeDeskProp(), -hw + 2.4, 0.5, Math.PI / 2, { w: 1.5, d: 0.75 });
    putSafe(ctx, V.cubiclePanel(2.4, 1.4, 0x9aa7b8), -hw + 4.0, 0.5, Math.PI / 2, { w: 2.4, d: 0.1 });

    const sign = V.wallSign(2.4, 0.4, 0x54e08a);
    sign.position.set(0, 2.8, hd - 0.14);
    sign.rotation.y = Math.PI;
    ctx.group.add(sign);

    for (let i = 0; i < 2; i++) {
      for (const sx of [-1, 1]) {
        ctx.addCeilingLamp(ctx.group, ctx.lights, sx * hw * 0.45, hd - 3 - i * (D - 6), ctx.H);
      }
    }
    ctx.station({
      id: 'manager', label: 'Mr Adewale, the teller', icon: '🧑‍💼', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the teller', hint: 'He works here' }],
    });

  },

  /** Office: cubicle grid, whiteboard, cabinets, meeting corner. */
  office(ctx) {
    const { W, D, hw, hd, pal } = ctx;
    const cols = Math.max(2, Math.floor((W - 2.4) / 3.0));
    const rows = Math.max(1, Math.floor((D - 5.0) / 3.2));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -((cols - 1) / 2) * 3.0 + c * 3.0;
        const z = -hd + 3.2 + r * 3.2;
        if (z > hd - 3.4) continue;
        putSafe(ctx, V.officeDesk(0x9c7b52), x, z, 0, { w: 1.5, d: 0.75 });
        // A short screen at the back of each desk, not between desks: panels in
        // the gaps turned the floor into a maze and the player could not reach
        // the far corner.
        putSafe(ctx, V.cubiclePanel(1.2, 1.3, 0xb9c6cf), x, z - 1.05, 0, { w: 1.2, d: 0.1 });
      }
    }

    // Meeting table in the front corner, whiteboard behind it.
    putSafe(ctx, ctx.tableProp(2.0, 1.0, 0x7a5c3e), hw - 2.4, hd - 2.8, 0, { w: 2.0, d: 1.0 });
    for (const [ox, oz] of [[-1.2, 0], [1.2, 0], [0, -0.9], [0, 0.9]]) {
      putSafe(ctx, ctx.stoolProp(pal.accent), hw - 2.4 + ox, hd - 2.8 + oz, 0, { w: 0.42, d: 0.42 });
    }
    const wb = V.whiteboard(2.2, 1.2);
    wb.position.set(hw - 2.6, 0, hd - 1.2);
    wb.rotation.y = Math.PI;
    ctx.group.add(wb);

    putSafe(ctx, V.filingCabinet(1.3), -hw + 0.55, hd - 2.4, -Math.PI / 2, { w: 0.5, d: 0.45 });
    putSafe(ctx, V.filingCabinet(1.3), -hw + 0.55, hd - 3.6, -Math.PI / 2, { w: 0.5, d: 0.45 });
    putSafe(ctx, V.waterDispenser(), -hw + 0.5, -hd + 1.4, -Math.PI / 2, { w: 0.4, d: 0.4 });
    putSafe(ctx, ctx.plantProp(), hw - 0.8, -hd + 1.0, 0, { w: 0.5, d: 0.5 });

    // Extras are driven by the size of the room and its variant, so two offices
    // of the same type still differ: a bigger building gets a reception bench
    // and lockers, a corner block gets a meeting corner.
    if (W >= 14) {
      putSafe(ctx, V.waitingRow(3, pal.accent), -hw + 2.6, -hd + 1.2, 0, { w: 1.7, d: 0.5 });
    }
    if (W >= 15) {
      putSafe(ctx, V.lockerBank(3, 1.8), hw - 0.6, hd - 4.6, -Math.PI / 2, { w: 1.3, d: 0.45 });
    }
    if (D >= 11) {
      putSafe(ctx, V.waterDispenser(), hw - 0.5, hd - 3.6, -Math.PI / 2, { w: 0.4, d: 0.4 });
    }
    if (ctx.variant === 0) {
      putSafe(ctx, V.filingCabinet(1.3), -hw + 0.55, hd - 4.8, -Math.PI / 2, { w: 0.5, d: 0.45 });
    } else if (ctx.variant === 1) {
      putSafe(ctx, V.cubiclePanel(2.0, 1.4, 0xb9c6cf), 0, hd - 3.2, 0, { w: 2.0, d: 0.1 });
    } else {
      putSafe(ctx, V.waterDispenser(), -hw + 0.5, -hd + 1.4, -Math.PI / 2, { w: 0.4, d: 0.4 });
      putSafe(ctx, V.filingCabinet(1.3), -hw + 0.55, -hd + 2.6, -Math.PI / 2, { w: 0.5, d: 0.45 });
    }

    ctx.addPicture(ctx.group, 0, hd - 0.13, 1.9, Math.PI, pal.accent);
    ctx.station({
      id: 'front-desk', label: 'Front desk', icon: '🛎️', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the receptionist', hint: 'She is at the front desk' }],
    });

  },

  /** General shop / supermarket: gondola rows, fridges, tills. */
  shop(ctx) {
    const { W, D, hw, hd, pal } = ctx;
    const rows = Math.max(2, Math.floor((D - 5.0) / 2.6));
    const len = Math.min(W - 5.0, 8.0);

    // Gondola shelving, one row per 2.6 m of depth, with a 1.4 m aisle.
    for (let i = 0; i < rows; i++) {
      const z = hd - 4.6 - i * 2.6;
      if (z < -hd + 3.0) break;
      putSafe(ctx, V.shopShelf(len, i + 1), 0.6, z, 0, { w: len, d: 0.9 });
    }

    // Fridges along the back wall.
    const fridges = Math.max(2, Math.floor((W - 2.0) / 1.4));
    for (let i = 0; i < fridges; i++) {
      const x = -((fridges - 1) / 2) * 1.4 + i * 1.4;
      put(ctx, V.fridgeCase(1.2, 2.0), x, -hd + 0.45, 0, { w: 1.2, d: 0.65 });
    }

    // Tills facing the door, trolleys parked beside them.
    putSafe(ctx, V.checkout(), -hw + 1.6, hd - 2.8, Math.PI / 2, { w: 2.2, d: 0.9 });
    putSafe(ctx, V.checkout(), hw - 1.6, hd - 2.8, -Math.PI / 2, { w: 2.2, d: 0.9 });
    putSafe(ctx, V.shoppingTrolley(), -hw + 0.9, hd - 1.4, 0, { w: 0.5, d: 0.8 });
    putSafe(ctx, V.shoppingTrolley(), -hw + 1.6, hd - 1.4, 0, null);

    ctx.addPicture(ctx.group, 0, hd - 0.13, 2.0, Math.PI, pal.accent);
    const sign = V.wallSign(2.0, 0.36, 0x54e08a);
    sign.position.set(0, 2.5, hd - 0.14);
    sign.rotation.y = Math.PI;
    ctx.group.add(sign);
    ctx.station({
      id: 'salesman', label: 'The salesman', icon: '🤝', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the salesman', hint: 'He is by the cars' }],
    });

  },

  /** Restaurant: serving counter with hot trays, tables, menu board. */
  restaurant(ctx) {
    const { W, D, hw, hd, pal } = ctx;
    put(ctx, V.servingCounter(Math.min(W - 2.0, 4.4)), 0, -hd + 0.75, 0, { w: Math.min(W - 2.0, 4.4), d: 0.7 });
    const menu = V.wallSign(2.0, 0.5, 0xffd166);
    menu.position.set(0, 2.3, -hd + 0.14);
    ctx.group.add(menu);

    const sets = Math.max(2, Math.floor((D - 4.2) / 2.4));
    for (let i = 0; i < sets; i++) {
      const z = hd - 3.0 - i * 2.4;
      if (z < -hd + 3.0) break;
      for (const side of [-1, 1]) {
        const x = side * (hw - 2.0);
        if (Math.abs(x) > hw - 1.2) continue;
        putSafe(ctx, V.diningSet(pal.accent), x, z, 0, { w: 0.9, d: 0.9 });
      }
    }
    putSafe(ctx, V.fridgeCase(1.0, 1.8), -hw + 0.6, -hd + 2.2, Math.PI / 2, { w: 1.0, d: 0.65 });
    if (ctx.variant === 0) {
      putSafe(ctx, V.waitingRow(3, pal.accent), -hw + 2.6, hd - 2.2, 0, { w: 1.7, d: 0.5 });
    } else if (ctx.variant === 1) {
      putSafe(ctx, V.priceBoard(), hw - 1.4, hd - 2.0, 0, { w: 0.6, d: 0.3 });
      putSafe(ctx, V.checkout(), hw - 1.6, -hd + 2.6, -Math.PI / 2, { w: 2.2, d: 0.9 });
    } else {
      putSafe(ctx, V.shopShelf(1.6, 4), hw - 0.8, -2.0, -Math.PI / 2, { w: 1.6, d: 0.9 });
    }
    ctx.addPicture(ctx.group, -hw + 0.13, 0.6, 1.9, Math.PI / 2, pal.living);
    ctx.station({
      id: 'waiter', label: 'The waiter', icon: '🧑‍🍳', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the waiter', hint: 'They work here' }],
    });

  },

  /** Police station: front desk, holding cells, lockers, evidence shelf. */
  police(ctx) {
    const { W, D, hw, hd, pal } = ctx;
    putSafe(ctx, V.policeDesk(Math.min(W - 2.4, 3.4)), 0, -hd + 1.2, 0, { w: 3.4, d: 0.7 });
    putSafe(ctx, V.waitingRow(4, pal.accent), -hw + 2.0, hd - 2.2, 0, { w: 2.2, d: 0.5 });

    // Two holding cells along the right wall.
    const cells = Math.max(1, Math.floor((D - 3.0) / 3.4));
    for (let i = 0; i < cells; i++) {
      const z = hd - 3.2 - i * 3.4;
      if (z < -hd + 2.4) break;
      ctx.wallRun(ctx.group, ctx.collisions, {
        x1: hw - 3.2, z1: z, x2: hw - 0.1, z2: z, height: 2.6, thickness: 0.09,
      });
      const cell = V.holdingCell(3.0, 2.5);
      cell.position.set(hw - 1.9, 0, z - 1.7);
      cell.rotation.y = Math.PI / 2;
      ctx.group.add(cell);
    }

    putSafe(ctx, V.lockerBank(4, 1.9), -hw + 0.9, -hd + 3.2, Math.PI / 2, { w: 1.7, d: 0.45 });
    putSafe(ctx, ctx.bookshelfProp(1.4, 1.6, 0.34), -hw + 1.4, -hd + 1.0, Math.PI / 2, { w: 1.4, d: 0.34 });
    put(ctx, ctx.officeDeskProp(), -hw + 2.6, -hd + 1.0, 0, { w: 1.5, d: 0.75 });

    const sign = V.wallSign(2.0, 0.36, 0x3f7bf5);
    sign.position.set(0, 2.6, hd - 0.14);
    sign.rotation.y = Math.PI;
    ctx.group.add(sign);
    ctx.station({
      id: 'sergeant', label: 'The desk sergeant', icon: '👮', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the sergeant', hint: 'He is at the charge desk' }],
    });

  },

  /** School classroom: desks in rows facing the board, teacher's desk. */
  school(ctx) {
    const { W, D, hw, hd } = ctx;
    const board = V.blackboard(Math.min(W - 2.0, 4.4), 1.5);
    board.position.set(0, 0.9, -hd + 0.16);
    ctx.group.add(board);

    const cols = Math.max(3, Math.floor((W - 2.4) / 1.3));
    const rows = Math.max(3, Math.floor((D - 4.0) / 1.4));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = -hw + 1.4 + c * 1.3 + 0.45;
        const z = -hd + 3.2 + r * 1.4;
        if (z > hd - 2.6 || x > hw - 1.0) continue;
        putSafe(ctx, V.schoolDesk(), x, z, 0, { w: 0.9, d: 0.55 });
      }
    }

    putSafe(ctx, ctx.officeDeskProp(), hw - 2.2, -hd + 1.6, Math.PI / 2, { w: 1.5, d: 0.75 });
    putSafe(ctx, ctx.bookshelfProp(1.4, 1.8, 0.34), -hw + 0.4, hd - 3.0, Math.PI / 2, { w: 1.4, d: 0.34 });
    putSafe(ctx, ctx.bookshelfProp(1.4, 1.8, 0.34), -hw + 0.4, hd - 4.6, Math.PI / 2, { w: 1.4, d: 0.34 });
    const classRug = ctx.rugProp(2.2, 1.4, 0x8e4b3a);
    classRug.position.set(0, 0.02, hd - 4.2);
    ctx.group.add(classRug);
    ctx.station({
      id: 'teachers-desk', label: 'The teacher', icon: '👨‍🏫', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the teacher', hint: 'He is marking papers' }],
    });

  },

  /** Gym: cardio row, weight rack, bench press, mirrors, reception. */
  gym(ctx) {
    const { W, D, hw, hd, pal } = ctx;
    const cardio = Math.max(2, Math.floor((D - 4.0) / 2.4));
    for (let i = 0; i < cardio; i++) {
      const z = hd - 3.4 - i * 2.4;
      if (z < -hd + 2.0) break;
      putSafe(ctx, V.treadmill(), -hw + 1.2, z, -Math.PI / 2, { w: 1.5, d: 0.7 });
    }
    putSafe(ctx, V.weightRack(Math.min(W - 4.0, 2.0)), hw - 1.6, -hd + 3.6, -Math.PI / 2, { w: 2.0, d: 0.5 });
    putSafe(ctx, V.benchPress(), hw - 1.6, -hd + 1.6, -Math.PI / 2, { w: 1.8, d: 1.3 });
    putSafe(ctx, ctx.rugProp(2.4, 1.8, 0x2c3e50), 0.5, -1.0, 0, null);
    putSafe(ctx, V.receptionCounter(2.2, 0x546e7a), hw - 1.4, hd - 2.2, Math.PI, { w: 2.2, d: 0.62 });
    putSafe(ctx, V.waterDispenser(), -hw + 0.5, -hd + 0.8, -Math.PI / 2, { w: 0.4, d: 0.4 });
    // Mirror wall: a flat reflective-looking panel, not a real reflection.
    ctx.group.add(ctx.box(0.04, 2.0, Math.min(D - 2.0, 5.0), ctx.materials.glass(), -hw + 0.14, 1.2, -hd + 3.4));
    ctx.addPicture(ctx.group, 0, -hd + 0.13, 2.0, 0, pal.accent);
    ctx.station({
      id: 'front-desk', label: 'The front desk', icon: '🛎️', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the front desk', hint: 'They work here' }],
    });

  },

  /** Kiosk: counter, drinks fridge, snack rack, sacks, stool. */
  kiosk(ctx) {
    const { W, hw, hd } = ctx;
    put(ctx, V.servingCounter(Math.min(W - 1.6, 2.6)), 0, -hd + 0.75, 0, { w: Math.min(W - 1.6, 2.6), d: 0.7 });
    putSafe(ctx, V.shopShelf(Math.min(W - 2.0, 1.8), 2), -hw + 0.75, 0.4, Math.PI / 2, { w: 1.8, d: 0.9 });
    putSafe(ctx, V.fridgeCase(0.9, 1.8), hw - 0.6, 0.4, -Math.PI / 2, { w: 0.9, d: 0.65 });
    const rack = V.snackRack(1.0, 1.5);
    rack.position.set(-hw + 0.14, 0, -hd + 2.6);
    rack.rotation.y = Math.PI / 2;
    ctx.group.add(rack);
    putSafe(ctx, V.sackStack(0xd8cba8), hw - 1.0, -hd + 1.2, 0, { w: 0.9, d: 0.4 });
    if (ctx.variant === 0) {
      // Water seller
      putSafe(ctx, V.waterDispenser(), hw - 1.0, -hd + 2.6, 0, { w: 0.4, d: 0.4 });
      putSafe(ctx, V.priceBoard(), -1.2, hd - 1.6, 0, { w: 0.6, d: 0.3 });
    } else if (ctx.variant === 1) {
      // Fuel station shop sells the odd spare part
      putSafe(ctx, V.oilDrum(0x2b5d8a), hw - 1.1, -hd + 2.2, 0, { w: 0.6, d: 0.6 });
      putSafe(ctx, V.tyreStack(2), hw - 1.1, -hd + 1.2, 0, { w: 0.7, d: 0.7 });
    } else {
      putSafe(ctx, V.checkout(), 1.3, -hd + 1.4, 0, { w: 2.2, d: 0.9 });
    }
    putSafe(ctx, ctx.stoolProp(0x8b5a2b), 0, -hd + 1.5, 0, null);
    ctx.addPicture(ctx.group, 0, -hd + 0.13, 1.8, 0, 0xc0392b);
    const sign = V.wallSign(1.6, 0.3, 0x54e08a);
    sign.position.set(0, 2.2, hd - 0.14);
    sign.rotation.y = Math.PI;
    ctx.group.add(sign);
    ctx.station({
      id: 'owner', label: 'The kiosk owner', icon: '🙋', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the owner', hint: 'She is behind the counter' }],
    });

  },

  /** Garage: workbench, tyres, oil drums, tool board, pit. */
  garage(ctx) {
    const { W, D, hw, hd } = ctx;
    put(ctx, V.servingCounter(Math.min(W - 2.0, 3.6)), 0, -hd + 0.8, 0, { w: Math.min(W - 2.0, 3.6), d: 0.7 });

    // Tyre stacks down both side walls, with a walking lane between them.
    const bays = Math.max(2, Math.floor((D - 3.0) / 2.0));
    for (let i = 0; i < bays; i++) {
      const z = hd - 2.6 - i * 2.0;
      if (z < -hd + 2.2) break;
      for (const side of [-1, 1]) {
        putSafe(ctx, V.tyreStack(3), side * (hw - 0.8), z, 0, { w: 0.7, d: 0.7 });
      }
    }

    putSafe(ctx, V.oilDrum(0x2b5d8a), -2.0, 1.2, 0, { w: 0.6, d: 0.6 });
    putSafe(ctx, V.oilDrum(0xc0392b), -2.0, 2.0, 0, { w: 0.6, d: 0.6 });
    putSafe(ctx, V.oilDrum(0x2b5d8a), -2.6, 1.6, 0, { w: 0.6, d: 0.6 });

    // Tool board on the side wall, plus a bench and a parts shelf.
    const tb = V.toolBoard(Math.min(D - 2.0, 2.2), 1.0);
    tb.position.set(hw - 0.18, 0, 1.4);
    tb.rotation.y = -Math.PI / 2;
    ctx.group.add(tb);
    putSafe(ctx, ctx.bookshelfProp(1.4, 1.4, 0.34), -hw + 0.6, -hd + 2.4, Math.PI / 2, { w: 1.4, d: 0.34 });
    putSafe(ctx, V.oilDrum(0x5f6b74), hw - 1.0, -hd + 1.6, 0, { w: 0.6, d: 0.6 });
    ctx.station({
      id: 'foreman', label: 'The foreman', icon: '🧑‍🔧', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the foreman', hint: 'He is under a car' }],
    });

  },


  /**
   * Supermarket: the room the player walked into and found empty.
   *
   * Laid out the way a supermarket actually is — perimeter fresh food, a grid of
   * centre aisles, a front end with tills — because that layout is also what
   * makes it walkable and legible: two long runs with a wide aisle between them,
   * a checkout row across the front, and a staffed till.
   */
  supermarket(ctx) {
    const { W, D, hw, hd } = ctx;
    const glassTile = ctx.materials.floorTile();
    // Polished tile strips down the aisles.
    for (const x of [-hw * 0.42, hw * 0.42]) {
      ctx.floorPatch(ctx.group, x, -1.0, W * 0.2, D - 6.0, glassTile, 0.014);
    }

    // ── Centre aisles: four gondola runs, back to back, north–south ──
    const aisleLen = Math.min(D - 8.5, 11);
    const runs = [-hw * 0.45, hw * 0.45];
    let seed = 7;
    for (const x of runs) {
      for (let i = 0; i < 2; i++) {
        const z = hd - 6.0 - i * (aisleLen + 1.6);
        if (z - aisleLen / 2 < -hd + 2.4) break;
        putSafe(ctx, V.gondola(aisleLen, { seed: seed++ }), x, z, 0, { w: 1.0, d: aisleLen });
      }
    }
    // Aisle signs above the runs.
    for (const [x, label] of [[-hw * 0.45, 'AISLE 1 · STAPLES'], [hw * 0.45, 'AISLE 2 · DRINKS']]) {
      const sign = V.aisleSign(label, 0x24425a);
      sign.position.set(x, ctx.H - 1.5, hd - 6.0);
      ctx.group.add(sign);
    }

    // ── Perimeter: chillers on the right wall, produce on the left ──
    const wallRuns = Math.max(2, Math.floor((D - 6) / 2.8));
    for (let i = 0; i < wallRuns; i++) {
      const z = hd - 4.0 - i * 2.8;
      if (z < -hd + 3.0) break;
      putSafe(ctx, V.chillerCase(2.4, 2.1), hw - 0.5, z, -Math.PI / 2, { w: 2.4, d: 0.7 });
    }
    for (let i = 0; i < wallRuns; i++) {
      const z = hd - 3.6 - i * 3.2;
      if (z < -hd + 3.0) break;
      putSafe(ctx, V.produceTable(2.6), -hw + 0.8, z, Math.PI / 2, { w: 2.6, d: 1.0 });
    }

    // ── Front end: checkouts, self-checkout pods, baskets, cart bay ──
    const tillZ = hd - 1.6;
    putSafe(ctx, V.checkout(), -hw * 0.34, tillZ, 0, { w: 2.2, d: 0.9 });
    putSafe(ctx, V.checkout(), hw * 0.34, tillZ, 0, { w: 2.2, d: 0.9 });
    putSafe(ctx, V.selfCheckout(), 0, tillZ - 0.4, 0, { w: 1.2, d: 1.4 });
    putSafe(ctx, V.basketStack(5), -hw + 1.4, hd - 0.9, 0, { w: 0.6, d: 0.5 });
    putSafe(ctx, V.shoppingTrolley(), hw - 1.6, hd - 1.1, 0, { w: 0.7, d: 1.0 });
    putSafe(ctx, V.shoppingTrolley(), hw - 2.4, hd - 1.1, 0, { w: 0.7, d: 1.0 });

    // ── Staff behind the tills, and a shopper in the aisle ──
    putSafe(ctx, V.staffFigure({ role: 'cashier', shirt: 0x2c6fbb }), -hw * 0.34, tillZ - 1.1, 0, null);
    putSafe(ctx, V.staffFigure({ role: 'trader', shirt: 0xc0392b, skin: 0x6b4226 }), hw * 0.34, tillZ - 1.1, 0, null);
    putSafe(ctx, V.staffFigure({ role: 'passenger', shirt: 0x27ae60 }), -hw * 0.45, -1.0, 0.6, null);

    // ── Back: stockroom door, promotions endcap, mop station ──
    putSafe(ctx, V.shopShelf(2.0, 4), 0, -hd + 1.0, 0, { w: 2.0, d: 0.9 });
    const promoScreen = V.wallSign(2.4, 0.5, 0xe67e22);
    promoScreen.position.set(0, 2.5, -hd + 0.14);
    ctx.group.add(promoScreen);
    putSafe(ctx, V.snackRack(1.2, 1.6), hw - 3.6, -hd + 1.2, 0, null);

    for (let i = 0; i < 4; i++) {
      const z = hd - 2.5 - i * ((D - 5) / 3);
      ctx.addCeilingLamp(ctx.group, ctx.lights, -hw * 0.45, z, ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, hw * 0.45, z, ctx.H);
      ctx.addCeilingLamp(ctx.group, ctx.lights, 0, z, ctx.H);
    }
    ctx.station({
      id: 'info-desk', label: 'The customer service desk', icon: '🛎️', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to the supervisor', hint: 'She works here' }],
    });

  },

  /** Default: a plain trading floor, used only if a type is unknown. */
  default(ctx) {
    const { hw, hd, pal } = ctx;
    putSafe(ctx, V.shopShelf(Math.min(ctx.W - 3.0, 3.0), 1), -hw + 1.0, 0, Math.PI / 2, { w: 3.0, d: 0.9 });
    putSafe(ctx, V.officeDesk(0x9c7b52), hw - 2.0, -hd + 2.0, -Math.PI / 2, { w: 1.5, d: 0.75 });
    putSafe(ctx, V.waitingRow(3, pal.accent), -hw + 2.0, hd - 2.2, 0, { w: 1.7, d: 0.5 });
  },
};


// ── Stations: what you can do in each kind of room ────────────
//
// One plan per layout, written against the same geometry the layout uses. A
// station is the point where a room stops being scenery: the counter in a shop,
// the desk in a classroom, the gate at an airport, the hob in a kitchen.
//
// Positions are room-local. +Z is the door side, -Z the back wall, so "behind
// the counter" is always around -hd.
const STATION_PLANS = {
  /** Market hall: the traders will sell you their goods. */
  market(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'traders', label: 'Buy from the traders', icon: '🧺',
      x: -hw * 0.35, z: -hd + 3.0, radius: 3.4,
      actions: [
        { kind: 'shop', venue: 'in-market', label: 'Haggle for groceries', hint: 'Yam, garri, palm oil, smoked fish' },
      ],
    });
    ctx.station({
      id: 'fabric', label: 'Look at the fabric', icon: '🧵',
      x: hw * 0.45, z: 0.5, radius: 2.4,
      actions: [
        { kind: 'shop', venue: 'in-market', label: 'Buy from the stall', hint: 'Same traders, the other aisle' },
      ],
    });
    ctx.station({
      id: 'produce', label: 'The produce line', icon: '🍅',
      x: hw * 0.5, z: -hd + 3.2, radius: 2.6,
      actions: [{ kind: 'shop', venue: 'in-market', label: 'Pick your tomatoes', hint: 'Tatashe, rodo, plantain' }],
    });
    ctx.station({
      id: 'chop-bar', label: 'The chop bar', icon: '🍲',
      x: -hw * 0.55, z: hd - 3.4, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'social', label: 'Sit and eat with the traders', hint: 'Social +40, fun +10' },
        { kind: 'activity', id: 'rest', label: 'Rest your legs a moment', hint: 'Energy +30' },
      ],
    });
  },

  supermarket(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'tills', label: 'Go to the tills', icon: '🛒',
      x: 0, z: hd - 2.6, radius: 3.2,
      actions: [
        { kind: 'shop', venue: 'in-supermarket', label: 'Shop the aisles', hint: 'Rice, beans, bread, drinks, gas, airtime' },
      ],
    });
    ctx.station({
      id: 'aisle-1', label: 'Pick from Aisle 1', icon: '🥫',
      x: -hw * 0.45, z: -1.0, radius: 2.6,
      actions: [{ kind: 'shop', venue: 'in-supermarket', label: 'Shop the staples', hint: 'Groceries and household goods' }],
    });
    ctx.station({
      id: 'chillers', label: 'Open the chiller', icon: '🧊',
      x: hw - 1.6, z: -2.0, radius: 2.6,
      actions: [{ kind: 'shop', venue: 'in-supermarket', label: 'Cold drinks and dairy', hint: 'Chilled goods' }],
    });
  },

  // ── The chapel ─────────────────────────────────────────────
  // Was: two stations, both of which gave you the generic "socialise". A church
  // where every pew and the altar do the same thing is a room with one button.
  church(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'pew', label: 'Sit in a pew', icon: '⛪', x: -hw * 0.5, z: hd - 6.0, radius: 2.6,
      actions: [
        { kind: 'activity', id: 'worship', label: 'Join the service', hint: 'Social +22, fun +12' },
        { kind: 'activity', id: 'read_book', label: 'Read the readings', hint: 'Smarts +8, fun +14' },
      ],
    });
    ctx.station({
      id: 'altar', label: 'Pray at the altar', icon: '🕯️', x: 0, z: -hd + 3.4, radius: 2.8,
      actions: [
        { kind: 'activity', id: 'worship', label: 'Say a prayer', hint: 'Social +22, charisma +2' },
        { kind: 'activity', id: 'social', label: 'Greet the congregation', hint: 'Social +40, fun +10' },
      ],
    });
    ctx.station({
      id: 'choir', label: 'The choir stand', icon: '🎼', x: hw * 0.55, z: -hd + 4.2, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'worship', label: 'Sing with the choir', hint: 'Fun +12, charisma +2' },
      ],
    });
    ctx.station({
      id: 'notice', label: 'The notice board', icon: '📌', x: hw - 1.6, z: hd - 3.4, radius: 2.2,
      actions: [
        { kind: 'activity', id: 'read_book', label: 'Read the announcements', hint: 'Smarts +8, fun +14' },
        { kind: 'activity', id: 'volunteer', label: 'Sign up to help', hint: 'Charisma +5, social +20' },
      ],
    });
  },

  // ── The mosque ─────────────────────────────────────────────
  mosque(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'prayer', label: 'Prayer hall', icon: '🕌', x: 0, z: -hd + 5.5, radius: 3.4,
      actions: [
        { kind: 'activity', id: 'worship', label: 'Join the prayer', hint: 'Social +22, fun +12' },
        { kind: 'activity', id: 'read_book', label: 'Read from the shelf', hint: 'Smarts +8' },
      ],
    });
    ctx.station({
      id: 'ablution', label: 'Ablution area', icon: '🚰', x: -hw + 2.4, z: hd - 3.2, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'shower', label: 'Perform wudu', hint: 'Hygiene +50' },
      ],
    });
    ctx.station({
      id: 'courtyard', label: 'The courtyard', icon: '🌴', x: hw - 2.6, z: hd - 2.8, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'social', label: 'Greet the men outside', hint: 'Social +40' },
      ],
    });
  },

  // ── The hospital ───────────────────────────────────────────
  // Reception, the ward, triage and a pharmacy counter that sells medicine the
  // check-up does not give you.
  hospital(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'reception', label: 'Reception desk', icon: '🏥', x: hw - 4.4, z: hd - 3.6, radius: 2.6,
      actions: [
        { kind: 'activity', id: 'checkup', label: 'Book a full check-up', hint: 'Energy +28, hygiene +14' },
        { kind: 'activity', id: 'treatment', label: 'Get treated', hint: 'Energy +20, hygiene +10' },
      ],
    });
    ctx.station({
      id: 'ward', label: 'A ward bed', icon: '🛏️', x: -hw + 3.0, z: hd - 8.0, radius: 2.6,
      actions: [{ kind: 'activity', id: 'rest', label: 'Lie down', hint: 'Energy +30' }],
    });
    ctx.station({
      id: 'pharmacy', label: 'Hospital pharmacy', icon: '💊', x: hw - 2.2, z: -hd + 3.6, radius: 2.4,
      actions: [{ kind: 'shop', venue: 'in-hospital', label: 'Buy medicine', hint: 'Paracetamol, malaria tablets, first aid' }],
    });
    ctx.station({
      id: 'waiting', label: 'The waiting area', icon: '🪑', x: -hw + 2.4, z: hd - 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'nap', label: 'Wait and doze', hint: 'Energy +25' },
        { kind: 'activity', id: 'social', label: 'Talk to the other patients', hint: 'Social +40' },
      ],
    });
  },

  clinic(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'exam', label: 'Exam couch', icon: '🩺', x: -hw + 3.0, z: -hd + 4.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'treatment', label: 'See the nurse', hint: 'Energy +20, hygiene +10' },
        { kind: 'activity', id: 'physio', label: 'Ask for physiotherapy', hint: 'Fitness +6, energy +12' },
      ],
    });
    ctx.station({
      id: 'pharmacy', label: 'Dispensary', icon: '💊', x: hw - 2.2, z: -hd + 3.0, radius: 2.4,
      actions: [{ kind: 'shop', venue: 'in-clinic', label: 'Collect medicine', hint: 'Paracetamol, ORS, malaria tablets' }],
    });
    ctx.station({
      id: 'waiting', label: 'The plastic chairs', icon: '🪑', x: 0, z: hd - 2.6, radius: 2.4,
      actions: [{ kind: 'activity', id: 'nap', label: 'Wait your turn', hint: 'Energy +25' }],
    });
  },

  // ── The bank ───────────────────────────────────────────────
  // The teller and the ATM both move real money. Before this the only thing you
  // could do at the counter was "chat with the teller".
  bank(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'teller', label: 'Teller counter', icon: '🏦', x: hw - 2.4, z: -hd + 2.6, radius: 2.6,
      actions: [
        { kind: 'bank', label: 'Deposit or withdraw at the counter', hint: 'Moves money between your pocket and the bank' },
      ],
    });
    ctx.station({
      id: 'atm', label: 'The ATM', icon: '💳', x: -hw + 2.0, z: hd - 2.6, radius: 2.2,
      actions: [
        { kind: 'bank', label: 'Use the ATM', hint: 'Quick deposit or withdrawal' },
      ],
    });
    ctx.station({
      id: 'customer-service', label: 'Customer service', icon: '🗂️', x: 0, z: -hd + 2.4, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'social', label: 'Ask about an account', hint: 'Social +40' },
        { kind: 'activity', id: 'meeting', label: 'See the account officer', hint: 'Charisma +6, smarts +5' },
      ],
    });
  },

  // ── The school ─────────────────────────────────────────────
  school(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'classroom', label: 'A school desk', icon: '📚', x: -hw + 2.6, z: -hd + 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'study', label: 'Sit in on a lesson', hint: 'Smarts +12' },
        { kind: 'activity', id: 'read_book', label: 'Read a book', hint: 'Fun +14, smarts +8' },
      ],
    });
    ctx.station({
      id: 'library', label: 'The library shelves', icon: '📖', x: hw - 2.4, z: -hd + 3.4, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'study', label: 'Study in the quiet', hint: 'Smarts +12, energy −8' },
        { kind: 'activity', id: 'read_book', label: 'Read something for fun', hint: 'Fun +14' },
      ],
    });
    ctx.station({
      id: 'exam-hall', label: 'The exam hall', icon: '📝', x: 0, z: -hd + 5.0, radius: 2.8,
      actions: [
        { kind: 'activity', id: 'exam', label: 'Sit the exam', hint: 'Smarts +18, energy −25' },
      ],
    });
  },

  // ── The gym ────────────────────────────────────────────────
  gym(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'weights', label: 'Weights bench', icon: '🏋️', x: -hw + 3.0, z: -hd + 3.5, radius: 2.6,
      actions: [{ kind: 'activity', id: 'exercise', label: 'Lift', hint: 'Fitness +5, fun +10' }],
    });
    ctx.station({
      id: 'treadmill', label: 'Treadmill', icon: '🏃', x: hw - 3.0, z: -hd + 3.5, radius: 2.6,
      actions: [{ kind: 'activity', id: 'exercise', label: 'Run', hint: 'Fitness +5, fun +10' }],
    });
    ctx.station({
      id: 'changing', label: 'Changing room', icon: '🚿', x: hw - 2.0, z: hd - 2.8, radius: 2.4,
      actions: [{ kind: 'activity', id: 'shower', label: 'Shower after the workout', hint: 'Hygiene +50' }],
    });
    ctx.station({
      id: 'lockers', label: 'The lockers', icon: '🎒', x: -hw + 2.0, z: hd - 2.8, radius: 2.2,
      actions: [{ kind: 'inventory', label: 'Check your bag', hint: 'Open the inventory' }],
    });
  },

  // ── The police station ─────────────────────────────────────
  police(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'front-desk', label: 'Front desk', icon: '🚔', x: 0, z: -hd + 2.4, radius: 2.6,
      actions: [
        { kind: 'activity', id: 'social', label: 'File a report', hint: 'Social +40' },
        { kind: 'activity', id: 'volunteer', label: 'Offer to help out', hint: 'Charisma +5, fitness +2' },
      ],
    });
    ctx.station({
      id: 'lost-property', label: 'Lost property', icon: '📦', x: hw - 2.2, z: hd - 3.0, radius: 2.2,
      actions: [{ kind: 'inventory', label: 'Check your belongings', hint: 'Open the inventory' }],
    });
    ctx.station({
      id: 'noticeboard', label: 'The notice board', icon: '📌', x: -hw + 2.2, z: hd - 3.0, radius: 2.2,
      actions: [{ kind: 'activity', id: 'read_book', label: 'Read the public notices', hint: 'Smarts +8' }],
    });
  },

  // ── The garage ─────────────────────────────────────────────
  garage(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'bay', label: 'A service bay', icon: '🔧', x: 0, z: -hd + 2.4, radius: 3.0,
      actions: [
        { kind: 'activity', id: 'repair', label: 'Work the bay', hint: 'Smarts +9, fitness +4' },
        { kind: 'activity', id: 'home_work', label: 'Help with the paperwork', hint: 'Smarts +10, energy −18' },
      ],
    });
    ctx.station({
      id: 'parts', label: 'Parts counter', icon: '⚙️', x: hw - 2.4, z: hd - 3.0, radius: 2.4,
      actions: [{ kind: 'shop', venue: 'in-garage', label: 'Buy parts', hint: 'Engine oil, spare tyre, jump leads' }],
    });
    ctx.station({
      id: 'waiting', label: 'The waiting bench', icon: '🪑', x: -hw + 2.4, z: hd - 3.0, radius: 2.4,
      actions: [{ kind: 'activity', id: 'nap', label: 'Wait for the car', hint: 'Energy +25' }],
    });
  },

  // ── Offices ────────────────────────────────────────────────
  office(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'desk', label: 'An empty desk', icon: '💻', x: -hw + 3.4, z: -hd + 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'home_work', label: 'Work at the desk', hint: 'Smarts +10, energy −18' },
        { kind: 'activity', id: 'read_book', label: 'Read the files', hint: 'Fun +14, smarts +8' },
      ],
    });
    ctx.station({
      id: 'meeting-room', label: 'The meeting room', icon: '🧑‍💼', x: hw - 3.0, z: -hd + 3.6, radius: 2.6,
      actions: [{ kind: 'activity', id: 'meeting', label: 'Sit in on the meeting', hint: 'Charisma +6, smarts +5' }],
    });
    ctx.station({
      id: 'reception', label: 'Reception', icon: '🛎️', x: 0, z: hd - 2.6, radius: 2.4,
      actions: [{ kind: 'activity', id: 'social', label: 'Ask who is in today', hint: 'Social +40' }],
    });
  },

  restaurant(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'counter', label: 'The counter', icon: '🍲', x: -hw + 2.6, z: -hd + 1.6, radius: 2.8,
      actions: [{ kind: 'shop', venue: 'in-food-court', label: 'Order food', hint: 'Jollof, suya, puff-puff' }],
    });
    ctx.station({
      id: 'table', label: 'A table', icon: '🍽️', x: hw * 0.2, z: 1.2, radius: 2.2,
      actions: [{ kind: 'activity', id: 'social', label: 'Eat with friends', hint: 'Social +40, fun +10' }],
    });
    ctx.station({
      id: 'kitchen', label: 'The kitchen door', icon: '👨‍🍳', x: -hw + 2.2, z: -hd + 4.4, radius: 2.2,
      actions: [
        { kind: 'activity', id: 'cook', label: 'Help the cook', hint: 'Hunger +45, energy −8' },
        { kind: 'activity', id: 'repair', label: 'Fix the burners', hint: 'Smarts +9' },
      ],
    });
    ctx.station({
      id: 'washroom', label: 'Wash your hands', icon: '🚰', x: hw - 1.8, z: -hd + 2.4, radius: 2.0,
      actions: [{ kind: 'activity', id: 'shower', label: 'Clean up', hint: 'Hygiene +50' }],
    });
  },

  kiosk(ctx) {
    const { hd } = ctx;
    ctx.station({
      id: 'counter', label: 'The kiosk counter', icon: '🏪', x: 0, z: -hd + 2.0, radius: 2.6,
      actions: [{ kind: 'shop', venue: 'in-kiosk', label: 'Buy at the kiosk', hint: 'Water, bread, airtime' }],
    });
  },

  shop(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'floor', label: 'Browse the shop', icon: '🛍️', x: 0, z: -hd + 2.6, radius: 3.0,
      actions: [{ kind: 'shop', venue: 'in-supermarket', label: 'Buy something', hint: 'Goods from the shelf' }],
    });
    ctx.station({
      id: 'sales-desk', label: 'The sales desk', icon: '🗝️', x: hw - 2.2, z: hd - 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'social', label: 'Ask about a test drive', hint: 'Social +40' },
      ],
    });
  },

  /** Terminal: check in, clear security, buy something, use the toilets, gate. */
  airport(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'check-in', label: 'Check-in desk', icon: '🎫', x: -hw + 3.0, z: hd - 6.0, radius: 3.0,
      actions: [
        { kind: 'activity', id: 'check_in', label: 'Check in and drop your bag', hint: 'Boarding pass.' },
      ],
    });
    ctx.station({
      id: 'security', label: 'Security lane', icon: '🛂', x: 0.5, z: 2.2, radius: 2.6,
      actions: [{ kind: 'activity', id: 'security', label: 'Clear security', hint: 'Shoes off, laptop out' }],
    });
    ctx.station({
      id: 'cafe', label: 'Café', icon: '☕', x: hw - 2.4, z: hd - 3.4, radius: 2.4,
      actions: [{ kind: 'shop', venue: 'in-airport', label: 'Buy something at the café', hint: 'Espresso, meat pie, water' }],
    });
    // Duty free, by the gate — 7 lines of stock that existed on the server but
    // had no counter to sell them from.
    ctx.station({
      id: 'duty-free', label: 'Duty free', icon: '🛍️', x: -hw + 1.6, z: -hd + 6.4, radius: 2.4,
      actions: [{
        kind: 'shop', venue: 'in-airport-concourse',
        label: 'Shop duty free', hint: 'Perfume, chocolate, travel pillow',
      }],
    });
    ctx.station({
      id: 'toilets', label: 'Toilets', icon: '🚻', x: hw - 2.0, z: -hd + 2.2, radius: 2.2,
      actions: [{ kind: 'activity', id: 'toilet', label: 'Use the toilet', hint: 'Bladder +50' }],
    });
    ctx.station({
      id: 'gate', label: 'Departure gate', icon: '🚪', x: hw - 3.2, z: -hd + 3.0, radius: 3.0,
      actions: [
        { kind: 'enter', interiorId: 'in-airfield', label: 'Walk through to the gate', hint: 'Out onto the apron' },
      ],
    });
    // Boarding board as a station too, so the player can read the gate number.
    ctx.station({
      id: 'board', label: 'Departure board', icon: '🖥️', x: 0, z: 0.4, radius: 2.2,
      actions: [{ kind: 'activity', id: 'check_in', label: 'Check your flight', hint: 'Confirm the gate' }],
    });
  },

  default(ctx) {
    const { hd } = ctx;
    ctx.station({
      id: 'counter', label: 'The counter', icon: '✋', x: 0, z: -hd + 2.0, radius: 2.4,
      actions: [{ kind: 'activity', id: 'social', label: 'Talk to whoever is here', hint: 'Social +40' }],
    });
  },

  // ── Per-interior plans ─────────────────────────────────────
  // Four rooms share a `type` with another, unrelated room: the water depot
  // and the filling station are both `kiosk`, the car dealership is a `shop`,
  // the restaurant and the food court are both `restaurant`. Furnished and
  // staffed from the shared plan they were indistinguishable, so each gets its
  // own below.

  'in-pure-water'(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'counter', label: 'The depot counter', icon: '🚰', x: 0, z: -hd + 2.2, radius: 2.6,
      actions: [{ kind: 'shop', venue: 'in-pure-water', label: 'Buy pure water', hint: 'Bags of sachet water, bottles' }],
    });
    ctx.station({
      id: 'truck', label: 'The delivery truck', icon: '🚚', x: -hw + 2.4, z: hd - 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'volunteer', label: 'Help load the truck', hint: 'Fitness +2, energy −15' },
        { kind: 'activity', id: 'social', label: 'Talk to the driver', hint: 'Social +40' },
      ],
    });
    ctx.station({
      id: 'bench', label: 'The bench outside', icon: '🪑', x: hw - 2.4, z: hd - 3.0, radius: 2.2,
      actions: [{ kind: 'activity', id: 'nap', label: 'Rest in the shade', hint: 'Energy +25' }],
    });
    ctx.station({
      id: 'owner', label: 'The depot owner', icon: '🙋', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to whoever is at the counter', hint: 'They work here' }],
    });

  },

  'in-fuel'(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'shop', label: 'The forecourt shop', icon: '🏪', x: 0, z: -hd + 2.2, radius: 2.8,
      actions: [{ kind: 'shop', venue: 'in-fuel', label: 'Buy something cold', hint: 'Drinks, meat pie, airtime' }],
    });
    ctx.station({
      id: 'attendant', label: 'The pump attendant', icon: '⛽', x: -hw + 2.4, z: hd - 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'social', label: 'Talk to the attendant', hint: 'Social +40' },
        { kind: 'activity', id: 'volunteer', label: 'Help out on the forecourt', hint: 'Charisma +5, fitness +2' },
      ],
    });
    ctx.station({
      id: 'toilets', label: 'The toilets', icon: '🚻', x: hw - 2.2, z: hd - 3.0, radius: 2.2,
      actions: [
        { kind: 'activity', id: 'toilet', label: 'Use the toilet', hint: 'Bladder +50' },
        { kind: 'activity', id: 'shower', label: 'Wash up', hint: 'Hygiene +50' },
      ],
    });
    ctx.station({
      id: 'attendant-counter', label: 'The attendant', icon: '🙋', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to whoever is at the counter', hint: 'They work here' }],
    });

  },

  'in-dealership'(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'floor', label: 'Walk the showroom', icon: '🚗', x: 0, z: -hd + 3.0, radius: 3.0,
      actions: [{ kind: 'shop', venue: 'in-dealership', label: 'Ask about a car', hint: 'Airtime, drinks, bits and pieces' }],
    });
    ctx.station({
      id: 'sales-desk', label: 'The sales desk', icon: '🗝️', x: hw - 2.4, z: hd - 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'social', label: 'Ask about a test drive', hint: 'Social +40' },
        { kind: 'activity', id: 'meeting', label: 'Talk finance', hint: 'Charisma +6, smarts +5' },
      ],
    });
    ctx.station({
      id: 'service-desk', label: 'The service desk', icon: '🔧', x: -hw + 2.4, z: hd - 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'repair', label: 'Book a service', hint: 'Smarts +9, fitness +4' },
      ],
    });
    ctx.station({
      id: 'salesman', label: 'The salesman', icon: '🤝', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to whoever is at the counter', hint: 'They work here' }],
    });

  },

  'in-food-court'(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'counter', label: 'The food counter', icon: '🍲', x: -hw + 2.6, z: -hd + 2.0, radius: 2.8,
      actions: [{ kind: 'shop', venue: 'in-food-court', label: 'Order food', hint: 'Jollof, suya, puff-puff' }],
    });
    ctx.station({
      id: 'drinks', label: 'The drinks stand', icon: '🥤', x: hw - 2.6, z: -hd + 2.0, radius: 2.4,
      actions: [{ kind: 'shop', venue: 'in-food-court', label: 'Buy a drink', hint: 'Cold soft drink, water' }],
    });
    ctx.station({
      id: 'table', label: 'Find a table', icon: '🍽️', x: 0, z: 1.0, radius: 2.6,
      actions: [
        { kind: 'activity', id: 'social', label: 'Eat with friends', hint: 'Social +40, fun +10' },
        { kind: 'activity', id: 'rest', label: 'Sit for a minute', hint: 'Energy +30' },
      ],
    });
    ctx.station({
      id: 'washroom', label: 'The washroom', icon: '🚻', x: hw - 1.8, z: hd - 2.6, radius: 2.2,
      actions: [{ kind: 'activity', id: 'toilet', label: 'Use the toilet', hint: 'Bladder +50' }],
    });
    ctx.station({
      id: 'server', label: 'The server', icon: '🧑‍🍳', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to whoever is at the counter', hint: 'They work here' }],
    });

  },


  // Two rooms can share a `type` and still be different places. The tech hub
  // and the community centre are both shelled as `office`, so without their own
  // plans they were furnished and staffed identically — the same bug the
  // vehicle switch was meant to fix, in furniture form. Interior id wins over
  // type in `furnish()`.
  'in-tech-hub'(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'workstation', label: 'A free workstation', icon: '🖥️', x: -hw + 3.0, z: -hd + 3.0, radius: 2.4,
      actions: [
        { kind: 'activity', id: 'home_work', label: 'Ship some code', hint: 'Smarts +10, energy −18' },
        { kind: 'activity', id: 'study', label: 'Work through a tutorial', hint: 'Smarts +12' },
      ],
    });
    ctx.station({
      id: 'pitch-room', label: 'The pitch room', icon: '🧑‍💼', x: hw - 3.0, z: -hd + 3.4, radius: 2.6,
      actions: [{ kind: 'activity', id: 'meeting', label: 'Sit in on a pitch', hint: 'Charisma +6, smarts +5' }],
    });
    ctx.station({
      id: 'coffee', label: 'The coffee counter', icon: '☕', x: 0, z: hd - 2.6, radius: 2.2,
      actions: [
        { kind: 'activity', id: 'social', label: 'Network by the coffee', hint: 'Social +40, charisma +2' },
        { kind: 'activity', id: 'read_book', label: 'Read the whiteboard', hint: 'Smarts +8' },
      ],
    });
    ctx.station({
      id: 'front-desk', label: 'The front desk', icon: '🛎️', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to whoever is at the counter', hint: 'They work here' }],
    });

  },

  'in-community'(ctx) {
    const { hw, hd } = ctx;
    ctx.station({
      id: 'hall', label: 'The main hall', icon: '🎪', x: 0, z: -hd + 4.0, radius: 3.0,
      actions: [
        { kind: 'activity', id: 'social', label: 'Join whatever is on', hint: 'Social +40, fun +10' },
        { kind: 'activity', id: 'volunteer', label: 'Volunteer for the event', hint: 'Charisma +5, social +20' },
      ],
    });
    ctx.station({
      id: 'notice', label: 'Community notice board', icon: '📌', x: -hw + 2.2, z: hd - 3.0, radius: 2.2,
      actions: [
        { kind: 'activity', id: 'read_book', label: 'Read the notices', hint: 'Smarts +8' },
        { kind: 'activity', id: 'volunteer', label: 'Sign up to help', hint: 'Charisma +5' },
      ],
    });
    ctx.station({
      id: 'kitchen', label: 'The hall kitchen', icon: '🍲', x: hw - 2.4, z: hd - 3.0, radius: 2.4,
      actions: [{ kind: 'activity', id: 'cook', label: 'Help cook for the hall', hint: 'Hunger +45, social +2' }],
    });
    ctx.station({
      id: 'caretaker', label: 'Auntie Bola', icon: '🙋', x: hw * 0.0, z: hd - 3.6, radius: 2.6,
      actions: [{ kind: 'staff', label: 'Talk to whoever is at the counter', hint: 'They work here' }],
    });

  },
};

/** Which layout a type uses. */
export function layoutFor(type) {
  const layout = LAYOUTS[type] || LAYOUTS.default;
  return layout;
}

/**
 * Run the layout *and* its station plan.
 *
 * Kept separate from LAYOUTS so a room's furniture and its interaction points
 * stay readable: the layout is geometry, the plan is what you can do there.
 * @param {string} type
 * @param {object} ctx
 */
export function furnish(ctx) {
  const layout = LAYOUTS[ctx.type] || LAYOUTS.default;
  layout(ctx);
  // A specific interior's plan wins over the generic one for its type, so the
  // tech hub is not the community centre with a different sign over the door.
  const plan = STATION_PLANS[ctx.id] || STATION_PLANS[ctx.type] || STATION_PLANS.default;
  try {
    plan(ctx);
  } catch (err) {
    // A missing station must never cost the player a room. Log and carry on;
    // the room still builds, it just has nothing to press E on.
    console.warn(`[interiorLayouts] station plan failed for "${ctx.type}"`, err);
  }
}
