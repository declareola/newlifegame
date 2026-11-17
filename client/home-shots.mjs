// client/home-shots.mjs — the home you can live in, and the meter cupboard.
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
await page.fill('#auth-username', `home${Math.random().toString(36).slice(2, 7)}`);
await page.fill('#auth-password', 'password123');
await page.click('[data-act="next"]'); await page.waitForTimeout(1200);
await page.click('[data-act="next"]'); await page.waitForTimeout(900);
await page.click('[data-act="next"]'); await page.waitForTimeout(6000);
await page.evaluate(() => { document.querySelectorAll('.tutorial-skip, .tutorial-next').forEach((b, i, all) => { if (i === all.length - 1) b.click(); }); });
await page.click('.tutorial-skip').catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

// Rent the hostel bed through the server, then walk in through its door.
const moved = await page.evaluate(async () => {
  const t = localStorage.getItem('newlife_token');
  const props = await fetch('/api/properties', { headers: { Authorization: `Bearer ${t}` } }).then((r) => r.json());
  const list = props.listings || props.properties || [];
  const bed = list.find((p) => (p.propertyId || p.id) === 'hostel-bed') || list[0];
  const r = await fetch('/api/properties/rent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ property_id: bed.propertyId || bed.id }),
  });
  return { status: r.status, body: await r.json() };
});
console.log('  rent:', moved.status, moved.body?.error || 'ok');
await page.evaluate(async () => {
  const nl = globalThis.__nl;
  // The rent above went straight to the API, so the client's housing state has
  // to be re-read before its door will recognise the player.
  await nl.refreshProperties();
  await new Promise((r) => setTimeout(r, 1500));
  const door = nl.interiors.doors.find((d) => d.propertyId === 'hostel-bed');
  nl.avatar.position.set(door.x, 0, door.z);
  nl.interiors.nearbyDoor = door;
  nl.interiors.interact();
});
await page.waitForTimeout(2500);
await frames(20);
await page.evaluate(() => globalThis.__nl.setHour(11));
await frames(10);
await page.screenshot({ path: 'screenshots/50-home.png', timeout: 180000 });

// Stand at the meter, open the cupboard, photograph it.
await page.evaluate(() => {
  const nl = globalThis.__nl;
  const st = nl.stations().find((s) => s.id === 'meter');
  if (st) nl.teleport(st.x, st.z, Math.PI);
});
await frames(10);
await page.screenshot({ path: 'screenshots/51-home-meter-station.png', timeout: 180000 });
await page.evaluate(async () => {
  const nl = globalThis.__nl;
  const st = nl.stations().find((s) => s.id === 'meter');
  await nl.venuePanel.show(st, nl.interiors.activeId);
  await new Promise((r) => setTimeout(r, 400));
  document.querySelector('.venue-act[data-venue-act]')?.click();
});
for (let i = 0; i < 30; i++) {
  if (await page.evaluate(() => globalThis.__nl.utilitiesPanel.data)) break;
  await page.waitForTimeout(250);
}
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/52-meter-cupboard.png', timeout: 180000 });
console.log(errors.length ? `  errors: ${errors.slice(0, 2).join(' | ')}` : '  no console errors');
await browser.close();
