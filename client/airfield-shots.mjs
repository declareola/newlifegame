// client/airfield-shots.mjs
// Screenshots of the airside scene: the apron you actually walk onto.
//   node airfield-shots.mjs
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
await page.fill('#auth-username', `air${Math.random().toString(36).slice(2, 7)}`);
await page.fill('#auth-password', 'password123');
await page.click('[data-act="next"]'); await page.waitForTimeout(1200);
await page.click('[data-act="next"]'); await page.waitForTimeout(900);
await page.click('[data-act="next"]'); await page.waitForTimeout(6000);
await page.evaluate(() => { document.querySelectorAll('.tutorial-skip, .tutorial-next').forEach((b, i, all) => { if (i === all.length - 1) b.click(); }); });
await page.click('.tutorial-skip').catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

// Into the terminal, then through the gate, the way a player does it.
await page.evaluate(async () => {
  const nl = globalThis.__nl;
  nl.enterInterior('in-airport');
  await new Promise((r) => setTimeout(r, 1200));
  const gate = nl.stations().find((s) => s.id === 'gate');
  nl.useStation('gate', gate.actions.findIndex((a) => a.kind === 'enter'));
});
await page.waitForTimeout(4000);
await frames(30);
const where = await page.evaluate(() => ({ id: globalThis.__nl.interiors.activeId, manifest: { ...(globalThis.__nl.interiors.active?.manifest || {}) } }));
console.log('  scene:', where.id, JSON.stringify(where.manifest));

await page.screenshot({ path: 'screenshots/30-airfield.png', timeout: 180000 });
// Look towards the aircraft.
await page.mouse.move(640, 360); await page.mouse.down();
await page.mouse.move(640 + 220, 360, { steps: 12 }); await page.mouse.up();
await frames(20);
await page.screenshot({ path: 'screenshots/31-airfield-turn.png', timeout: 180000 });

// A plan view of the whole apron and runway.
await page.evaluate(() => {
  const nl = globalThis.__nl;
  const b = nl.interiors.active?.bounds;
  const cx = ((b?.minX ?? -6) + (b?.maxX ?? 20)) / 2;
  const cz = ((b?.minZ ?? -60) + (b?.maxZ ?? 34)) / 2;
  if (!nl.controller.__orig) nl.controller.__orig = nl.controller.update;
  nl.controller.update = () => {};
  nl.camera.position.set(cx, 210, cz + 1);
  nl.camera.lookAt(cx, 0, cz);
  nl.camera.fov = 60; nl.camera.updateProjectionMatrix();
});
await frames(8);
await page.screenshot({ path: 'screenshots/32-airfield-plan.png', timeout: 180000 });

console.log(errors.length ? `  errors: ${errors.slice(0, 3).join(' | ')}` : '  no console errors');
await browser.close();
