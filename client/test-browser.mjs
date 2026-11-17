// client/test-browser.mjs
// One place that knows how to launch a browser this project can actually use.
//
// Playwright ships two Chromium builds:
//   · chrome-headless-shell — small, fast, and has NO WebGL at all;
//   · chrome (full)         — has WebGL via SwiftShader.
//
// `chromium.launch()` from playwright-core picks whichever the installed
// revision prefers, and if it picks the shell then every WebGL test silently
// hangs waiting for a scene that will never render — which looks like a test
// that "never finishes" rather than a test with no GPU. That cost an hour once;
// this module exists so it cannot happen again.

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

/** Path to a Chromium with WebGL, falling back to whatever is installed. */
export function chromiumWithWebGL() {
  const def = chromium.executablePath();
  if (!def.includes('headless_shell')) return { path: def, webgl: true };

  const candidate = def
    .replace('chromium_headless_shell-', 'chromium-')
    .replace('chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-linux64/chrome');

  if (existsSync(candidate)) return { path: candidate, webgl: true };
  return { path: def, webgl: false };
}

/** Flags that make software WebGL work in a container. */
export const WEBGL_ARGS = [
  '--headless=new',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
];

/**
 * Launch a browser with WebGL and return it with the path it used.
 *
 * @param {object} [opts]
 * @param {number} [opts.width]
 * @param {number} [opts.height]
 * @returns {Promise<{browser, page, hasWebGL, close}>}
 */
export async function launchGamePage({ width = 1024, height = 640 } = {}) {
  const { path, webgl } = chromiumWithWebGL();
  if (!webgl) {
    console.warn('  ⚠ only chrome-headless-shell is installed — WebGL tests will hang.');
    console.warn('    fix: npx playwright-core install chromium');
  }

  const browser = await chromium.launch({ executablePath: path, args: WEBGL_ARGS });
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(120000);

  return {
    browser,
    page,
    hasWebGL: webgl,
    close: () => browser.close(),
  };
}

/**
 * A second, independent browser context in the same browser.
 *
 * Each context has its own localStorage and cookies, so two calls to this give
 * you two players who can see each other on the market — which is the only way
 * to test player-to-player trading honestly. They share one Chromium process,
 * so it stays cheap.
 *
 * @param {import('playwright-core').Browser} browser
 * @param {{width?:number, height?:number}} [opts]
 * @returns {Promise<import('playwright-core').Page>}
 */
export async function newGamePage(browser, { width = 1024, height = 640 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  return page;
}

/** Resolve after `count` animation frames (works while the tab is backgrounded). */
export function frames(page, count) {
  return page.evaluate((n) => new Promise((done) => {
    let i = 0;
    const tick = () => (++i >= n ? done() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), count);
}
