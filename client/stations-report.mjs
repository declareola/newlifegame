// client/stations-report.mjs — what every interior offers, in one table.
// Run: node stations-report.mjs
const ctxStub = new Proxy({}, {
  get(_, prop) {
    if (prop === 'canvas') return { width: 256, height: 256 };
    if (prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') {
      return () => ({ addColorStop() {} });
    }
    if (prop === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (prop === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set() { return true; },
});
globalThis.document = {
  createElement: () => ({ width: 256, height: 256, style: {}, getContext: () => ctxStub, toDataURL: () => 'data:,' }),
};

const { buildInterior } = await import('./src/world/InteriorBuilder.js');
const { buildAirfield } = await import('./src/world/airfield.js');
const { namedInteriors } = await import('./src/world/interiorData.js');
const { getVenueShop } = await import('../server/config/venueConfig.js');

const rows = [];
for (const def of namedInteriors) {
  const built = def.custom === 'airfield' ? buildAirfield(def) : buildInterior(def);
  const st = built.stations || [];
  const kinds = new Set();
  const acts = new Set();
  for (const s of st) for (const a of s.actions) { kinds.add(a.kind); if (a.kind === 'activity') acts.add(a.id); }
  const sells = getVenueShop(def.id) ? getVenueShop(def.id).stock.length : 0;
  rows.push({ id: def.id, name: def.name, stations: st.length, acts: [...acts], kinds: [...kinds], sells });
}
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('interior', 22) + pad('stations', 9) + pad('acts', 6) + pad('sells', 6) + 'kinds');
for (const r of rows) {
  console.log(pad(r.id, 22) + pad(r.stations, 9) + pad(r.acts.length, 6) + pad(r.sells || '-', 6) + r.kinds.join('+'));
}
const noShop = rows.filter((r) => !r.sells);
console.log(`\n${rows.length} interiors · ${rows.reduce((n, r) => n + r.stations, 0)} stations · ${rows.filter((r) => r.sells).length} sell something`);
console.log('no stock:', noShop.map((r) => r.id).join(', '));
