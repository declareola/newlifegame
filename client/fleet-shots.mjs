// client/fleet-shots.mjs
// Buy each of the three Lagos vehicles through the real server, park it in
// front of the player, and photograph it. Also reports the mesh facts the
// driving code depends on: wheel count, length, seat count.
//   node fleet-shots.mjs
import { chromium } from 'playwright-core';
const BASE = process.env.URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--ignore-gpu-blocklist','--enable-webgl','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const frames = (n) => page.evaluate((c) => new Promise((d) => { let i = 0; const t = () => (++i >= c ? d() : requestAnimationFrame(t)); requestAnimationFrame(t); }), n);

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#auth-username');
await page.fill('#auth-username', `fleet${Math.random().toString(36).slice(2, 7)}`);
await page.fill('#auth-password', 'password123');
await page.click('[data-act="next"]'); await page.waitForTimeout(1200);
await page.click('[data-act="next"]'); await page.waitForTimeout(900);
// Start rich: the three vehicles together are ₦1.75m.
await page.click('[data-tier="nepo"]').catch(() => {});
await page.waitForTimeout(300);
await page.click('[data-act="next"]'); await page.waitForTimeout(6000);
await page.evaluate(() => { document.querySelectorAll('.tutorial-skip, .tutorial-next').forEach((b, i, all) => { if (i === all.length - 1) b.click(); }); });
await page.click('.tutorial-skip').catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

const bought = await page.evaluate(async () => {
  const nl = globalThis.__nl;
  const t = localStorage.getItem('newlife_token');
  const out = [];
  for (const id of ['tricycle', 'motorbike', 'hiace']) {
    const r = await fetch('/api/vehicles/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({ vehicleId: id }),
    });
    const body = await r.json();
    out.push({ id, ok: r.ok, error: body.error || null, seats: body.vehicle?.def?.seats ?? null });
  }
  await nl.vehicles?.load?.();
  const meshes = [];
  for (const [rowId, mesh] of nl.vehicles.meshes) {
    meshes.push({
      rowId,
      kind: mesh.userData.kind,
      wheels: mesh.userData.wheels?.length ?? 0,
      length: mesh.userData.length ?? null,
      width: mesh.userData.width ?? null,
      parts: mesh.children.length,
    });
  }
  return { out, meshes };
});
console.log('  bought:', JSON.stringify(bought.out));
console.log('  meshes:', JSON.stringify(bought.meshes));

// Daylight, so the paint and glazing are actually visible.
await page.evaluate(() => { globalThis.__nl.setHour(10.5); });
await page.waitForTimeout(600);

/** Freeze the camera and look at a point — the only reliable way to frame a shot. */
async function look(cx, cy, cz, tx, ty, tz) {
  await page.evaluate(([a, b, c, d, e, f]) => {
    const nl = globalThis.__nl;
    if (!nl.controller.__orig) nl.controller.__orig = nl.controller.update;
    nl.controller.update = () => {};
    nl.camera.fov = 45;
    nl.camera.position.set(a, b, c);
    nl.camera.lookAt(d, e, f);
    nl.camera.updateProjectionMatrix();
  }, [cx, cy, cz, tx, ty, tz]);
  await frames(10);
}

// Park the three side by side on an open stretch of road.
const parked = await page.evaluate(() => {
  const nl = globalThis.__nl;
  const order = ['tricycle', 'motorcycle', 'hiace'];
  // The spawn street: known open roadway with a clear camera line.
  const baseX = 24.0;
  const baseZ = 2.0;
  const spots = [];
  order.forEach((k, i) => {
    const entry = [...nl.vehicles.meshes.values()].find((m) => m.userData.kind === k);
    if (entry) {
      entry.position.set(baseX + i * 2.6, 0, baseZ);
      entry.rotation.y = Math.PI;
      spots.push({ kind: k, x: entry.position.x, z: entry.position.z });
    }
  });
  nl.avatar.visible = false;
  return spots;
});
console.log('  parked:', JSON.stringify(parked));
await look(26.6, 3.4, -6.0, 26.6, 1.0, 2.0);
await page.screenshot({ path: 'screenshots/60-fleet.png', timeout: 180000 });

// A closer pass on the bus, which is the one that replaced the danfo.
await look(29.2 + 5.4, 2.4, -4.4, 29.2, 1.2, 2.0);
await page.screenshot({ path: 'screenshots/61-hiace.png', timeout: 180000 });
await look(22.0 + 3.4, 1.8, -2.6, 22.0, 0.9, 2.0);
await page.screenshot({ path: 'screenshots/62-tricycle.png', timeout: 180000 });
await page.evaluate(() => {
  const nl = globalThis.__nl;
  nl.avatar.visible = true;
  if (nl.controller.__orig) { nl.controller.update = nl.controller.__orig; delete nl.controller.__orig; }
});

// Drive the bus: does an 18-seater actually drive, and does the camera cope?
const drive = await page.evaluate(async () => {
  const nl = globalThis.__nl;
  const bus = nl.vehicles.owned.find((v) => v.def?.id === 'hiace') || nl.vehicles.owned.find((v) => v.def?.kind === 'hiace');
  if (!bus) return { error: 'no hiace in the garage' };
  // Park the player next to the bus and get in the way a player does.
  bus.pos_x = nl.avatar.position.x + 1.2;
  bus.pos_z = nl.avatar.position.z + 1.2;
  const mesh = nl.vehicles.meshes.get(bus.id);
  if (mesh) mesh.position.set(bus.pos_x, 0, bus.pos_z);
  const gotIn = nl.vehicles.enter(bus);
  await new Promise((r) => setTimeout(r, 400));
  const before = { ...nl.avatar.position };
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  await new Promise((r) => setTimeout(r, 1500));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  const after = { ...nl.avatar.position };
  return {
    gotIn,
    driving: !!nl.vehicles.driving,
    moved: Math.hypot(after.x - before.x, after.z - before.z),
    seats: nl.vehicles.driving?.def?.seats ?? null,
    cameraY: nl.camera.position.y,
    cameraDist: Math.hypot(nl.camera.position.x - after.x, nl.camera.position.z - after.z),
  };
});
console.log('  drive:', JSON.stringify(drive));
await page.screenshot({ path: 'screenshots/63-driving-hiace.png', timeout: 180000 });
console.log(errors.length ? `  errors: ${errors.slice(0, 3).join(' | ')}` : '  no console errors');
await browser.close();
