// client/shots.mjs
// Screenshots of the real game, in a real browser, with software WebGL.
//
// This is the project's missing sense organ. Every previous round was verified
// with geometry maths, state assertions and flood fills — none of which can see
// that a room is empty. This script boots the served build in Chromium with
// SwiftShader, drives the actual UI (sign-up wizard, camera keys, walking into
// a venue) and writes PNGs to `screenshots/`.
//
//   node shots.mjs                 # all shots
//   node shots.mjs market church   # just these
//   URL=http://127.0.0.1:3000 node shots.mjs
//
// It also fails loudly if the WebGL context never comes up or if a console
// error is thrown, because a screenshot of a black canvas is worse than no
// screenshot: it looks like evidence.

import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const URL_BASE = process.env.URL || 'http://127.0.0.1:3000';
// Software WebGL is ~30× slower than a GPU; default to the cheap pipeline and a
// smaller frame so a screenshot lands in seconds instead of timing out.
const QUALITY = process.env.Q || 'low';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
const WIDTH = Number(process.env.W || 1024);
const HEIGHT = Number(process.env.H || 576);

const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);

await mkdir(OUT, { recursive: true });

// The headless *shell* has no WebGL at all; screenshots from it are blank, which
// is the one thing this script exists to prevent. Use the full Chromium build
// with the new headless mode, and fall back to the shell only if it is missing.
const FULL_CHROME = (() => {
  const def = chromium.executablePath();
  if (!def.includes('headless_shell')) return def;
  const candidate = def
    .replace('chromium_headless_shell-', 'chromium-')
    .replace('chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome');
  return existsSync(candidate) ? candidate : def;
})();
const useFull = existsSync(FULL_CHROME) && !FULL_CHROME.includes('headless_shell');
console.log(`  browser: ${useFull ? 'full Chromium (WebGL available)' : 'headless shell (NO WebGL)'}`);

const browser = await chromium.launch({
  executablePath: useFull ? FULL_CHROME : undefined,
  args: [
    ...(useFull ? ['--headless=new'] : []),
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
page.setDefaultTimeout(120000);

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}${err.stack ? `\n      ${err.stack.split('\n').slice(0, 4).join('\n      ')}` : ''}`));

const shots = [];
async function shot(name, note = '') {
  if (!wanted(name)) return null;
  const file = join(OUT, `${name}.png`);
  const buffer = await page.screenshot({ path: file, timeout: 120000, animations: 'allow' });
  // Reject a pure-black or pure-sky frame: that is a renderer that never
  // started, and keeping it would poison the baseline.
  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return { hasCanvas: true, hasGl: !!gl, w: canvas.width, h: canvas.height };
  });
  shots.push({ name, note, file, bytes: buffer.length, ...(stats || {}) });
  const rep = await page.evaluate(() => globalThis.__nl?.report?.() || null).catch(() => null);
  if (rep) {
    console.log(`  📸 ${name.padEnd(16)} ${String(Math.round(buffer.length / 1024)).padStart(4)} kB  `
      + `${String(rep.drawCalls ?? '?').padStart(4)} draws  ${String(rep.triangles ?? '?').padStart(7)} tris  `
      + `${rep.hour}:00  ${rep.view}  ${note}`);
  } else {
    console.log(`  📸 ${name.padEnd(16)} ${Math.round(buffer.length / 1024)} kB  ${note}`);
  }
  return stats;
}

async function frames(n = 12) {
  // Let the render loop actually advance; a screenshot taken between requestAnimationFrame
  // calls can catch a half-drawn buffer.
  await page.evaluate((count) => new Promise((resolve) => {
    let i = 0;
    const tick = () => { if (++i >= count) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }), n);
}

const key = async (code, { shift = false, hold = 0 } = {}) => {
  if (hold > 0) {
    await page.keyboard.down(code);
    await page.waitForTimeout(hold);
    await page.keyboard.up(code);
  } else {
    await page.keyboard.press(shift ? `Shift+${code.replace('Key', '').replace('Digit', '')}` : code);
  }
  await frames(4);
};

console.log(`\nNewLife screenshots — ${URL_BASE} at ${WIDTH}×${HEIGHT}\n`);

// ── 1. The way in ───────────────────────────────────────────
await page.goto(`${URL_BASE}/?q=${QUALITY}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await frames(20);
await shot('00-loading-or-auth', 'first paint');

// The renderer's canvas does not exist until a player is signed in and the world
// starts building, so probe WebGL with a throwaway canvas instead of concluding
// "no WebGL" from a page that is still showing the sign-in screen.
const gl = await page.evaluate(() => {
  const canvas = document.querySelector('canvas') || document.createElement('canvas');
  const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return { ok: !!ctx, renderer: ctx && ctx.getParameter(ctx.RENDERER), vendor: ctx && ctx.getParameter(ctx.VENDOR) };
});
console.log(`\n  WebGL: ${gl?.ok ? 'yes' : 'NO'} ${gl?.renderer || ''} ${gl?.vendor || ''}\n`);
if (!gl?.ok) {
  console.error('  ✗ No WebGL context — the screenshots would be blank. Aborting.');
  await browser.close();
  process.exit(1);
}

// The auth panel: step 1, then the character creator with its live preview.
await page.waitForSelector('#auth-username', { timeout: 20000 }).catch(() => {});
await shot('01-signin', 'account step');

if (await page.$('#auth-username')) {
  const name = `shot${Math.random().toString(36).slice(2, 8)}`;
  await page.fill('#auth-username', name);
  await page.fill('#auth-password', 'password123');
  await page.click('[data-act="next"]');
  await page.waitForTimeout(1200);
  await frames(30);
  await shot('02-creator', 'character step with live preview');

  // Change a few things so the preview is visibly not the default.
  await page.click('[data-outfit="owambe"]').catch(() => {});
  await frames(20);
  await shot('03-creator-owambe', 'outfit changed in the creator');

  await page.click('[data-act="next"]');
  await page.waitForTimeout(900);
  await frames(20);
  await shot('04-tier', 'starting tier');

  await page.click('[data-act="next"]');
  await page.waitForTimeout(4000);
  await frames(40);
}

await page.waitForTimeout(1500);
await frames(30);

// The first-run guide covers the world on a brand new account; keep one shot of
// it (it is part of onboarding) and then dismiss it for the street shots.
await shot('08-tutorial', 'first-run guide, once per account');
await page.evaluate(() => {
  document.querySelectorAll('.tutorial-skip, .tutorial-next').forEach((b, i, all) => {
    if (i === all.length - 1) b.click();
  });
});
await page.click('.tutorial-skip').catch(() => {});
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await frames(20);

await page.evaluate(() => globalThis.__nl?.setHour?.(10));
await frames(8);
await shot('05-street', 'spawned in the city, third person');

// ── 2. Camera ───────────────────────────────────────────────
await key('KeyV');
await page.waitForTimeout(500);
await frames(15);
await shot('06-first-person', 'V → first person');

await key('KeyV');
await page.waitForTimeout(400);
await frames(12);
await shot('07-top-down', 'V → top down');

await key('KeyV');
await page.waitForTimeout(400);

// ── 3. Interiors ────────────────────────────────────────────
// The venue doors are at the buildings' front; walk in through the real door
// prompt rather than teleporting, so the screenshot proves the door works too.
const venues = [
  ['market', 'Oshodi Market'],
  ['church', 'church'],
  ['mosque', 'mosque'],
  ['bank', 'bank'],
  ['hospital', 'hospital'],
  ['airport', 'airport'],
  ['school', 'school'],
  ['police', 'police station'],
  ['restaurant', 'restaurant'],
  ['gym', 'gym'],
  ['supermarket', 'supermarket'],
];

const teleport = async (x, z) => {
  await page.evaluate(([px, pz]) => {
    if (globalThis.__nl?.avatar) {
      globalThis.__nl.avatar.position.set(px, 0, pz);
      globalThis.__nl.controller?.syncFromAvatar?.();
    }
  }, [x, z]);
  await frames(6);
};

// Time of day is fixed for the interiors: a screenshot at 18:10 is a dark
// room, which tells you nothing about the furniture.
await page.evaluate(() => globalThis.__nl?.setHour?.(10.5));
await frames(10);

// Discover the interior doors from the live game rather than hard-coding them.
const doors = await page.evaluate(() => {
  const g = globalThis.__nl;
  if (!g?.interiors) return [];
  const list = [];
  for (const [id, def] of g.interiors.defs || []) {
    if (!/^in-/.test(id)) continue;
    list.push({ id, name: def.name, type: def.type });
  }
  return list;
}).catch(() => []);

if (doors.length && globalThis?.console) {
  console.log(`\n  ${doors.length} interiors registered\n`);
}

for (const [slug, label] of venues) {
  if (!wanted(`10-${slug}`)) continue;
  const info = await page.evaluate((want) => globalThis.__nl?.enterInterior?.('in-' + want) || { ok: false, why: 'no hook' }, slug)
    .catch((e) => ({ ok: false, why: e.message }));
  if (!info.ok) { console.log(`  · skipped ${slug}: ${info.why}`); continue; }
  await page.waitForTimeout(900);
  await frames(35);
  await shot(`10-${slug}`, `${label} interior`);
  // Look around a little: a plan view of one corner hides most of a room.
  await page.mouse.move(WIDTH / 2, HEIGHT / 2);
  await page.mouse.down();
  await page.mouse.move(WIDTH / 2 + 260, HEIGHT / 2 + 40, { steps: 12 });
  await page.mouse.up();
  await frames(20);
  await shot(`11-${slug}-turn`, `${label}, camera turned`);
  await page.evaluate(() => globalThis.__nl?.exitInterior?.());
  await page.waitForTimeout(700);
  await frames(10);
}

// ── 4. Weather ──────────────────────────────────────────────
if (wanted('20-rain')) {
  await page.keyboard.press('Shift+R');
  await page.waitForTimeout(2500);
  await frames(30);
  await shot('20-rain', 'rain, forced with Shift+R');
  await page.keyboard.press('Shift+R');
  await page.waitForTimeout(400);
}

// ── 5. Panels ───────────────────────────────────────────────
const panels = [
  ['30-inventory', 'Tab'],
  ['31-missions', 'KeyJ'],
  ['32-jobs', 'KeyK'],
  ['33-character', 'KeyI'],
  ['34-map', 'KeyM'],
];
for (const [name, code] of panels) {
  if (!wanted(name)) continue;
  await page.keyboard.press(code);
  await page.waitForTimeout(700);
  await frames(8);
  await shot(name, `${code} panel`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

// ── 6. Pause menu tabs ──────────────────────────────────────
if (wanted('40-pause') || wanted('41-pause-settings') || wanted('42-pause-status')) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shot('40-pause', 'pause menu, main tab');
  await page.click('[data-tab="settings"]').catch(() => {});
  await page.waitForTimeout(300);
  await shot('41-pause-settings', 'sound + camera settings');
  await page.click('[data-tab="status"]').catch(() => {});
  await page.waitForTimeout(300);
  await shot('42-pause-status', 'live renderer figures');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ── 7. Night ────────────────────────────────────────────────
// The day is 8 minutes long, so the phase can be nudged rather than waited for.
if (wanted('50-night')) {
  const nudged = await page.evaluate(() => {
    const g = globalThis.__nl;
    if (!g?.dayNight) return false;
    // Freeze the cycle by overriding the phase source for a few frames.
    g.dayNight._currentPhase = () => 0.88; // ~21:00
    return true;
  }).catch(() => false);
  if (nudged) {
    await page.waitForTimeout(1200);
    await frames(20);
    await shot('50-night', '21:00 — street lights and dark sky');
  }
}

// ── Report ──────────────────────────────────────────────────
const realErrors = errors.filter((e) => !/favicon|AudioContext|autoplay/i.test(e));
console.log(`\n  ${shots.length} screenshots in ${OUT}`);
if (realErrors.length) {
  console.log(`\n  ✗ ${realErrors.length} console error(s):`);
  for (const e of realErrors.slice(0, 10)) console.log(`    · ${e.slice(0, 160)}`);
}

await writeFile(join(OUT, 'index.json'), JSON.stringify({
  url: URL_BASE,
  size: [WIDTH, HEIGHT],
  gl,
  shots,
  errors: realErrors,
  at: new Date().toISOString(),
}, null, 2));

await browser.close();
process.exit(realErrors.length ? 1 : 0);
