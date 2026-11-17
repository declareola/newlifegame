// client/check-syntax.mjs
// No dependency syntax checker: imports every source module in a stubbed DOM so
// that parse errors and bad import paths surface without a browser.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = new URL('./src/', import.meta.url).pathname;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

// ---- minimal DOM stubs so canvas/texture code can run headlessly ----
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
  createElement(tag) {
    if (tag === 'canvas') {
      return {
        width: 256, height: 256, style: {},
        getContext: () => ctxStub,
        toDataURL: () => 'data:image/png;base64,',
        addEventListener() {},
        removeEventListener() {},
      };
    }
    return { style: {}, appendChild() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {} };
  },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: { appendChild() {}, classList: { add() {}, remove() {} } },
  documentElement: { style: { setProperty() {} } },
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, location: { search: '', href: 'http://localhost/' }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
globalThis.self = globalThis.window;
globalThis.navigator = { userAgent: 'node', maxTouchPoints: 0 };
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.HTMLCanvasElement = class {};
globalThis.OffscreenCanvas = class { getContext() { return ctxStub; } };

const files = walk(root);
let failed = 0;
const tmp = mkdtempSync(join(tmpdir(), 'nl-syntax-'));

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // Modules that import CSS cannot be imported by Node. Everything else is
  // really imported (which also proves the import paths resolve); the CSS
  // ones get a parse-only check instead.
  const hasCssImport = /\.css['"]/.test(src);

  if (hasCssImport) {
    const copy = join(tmp, relative(root, f).replace(/[\\/]/g, '__') + '.mjs');
    writeFileSync(copy, src);
    try {
      execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
    } catch (err) {
      failed++;
      console.log(`✗ ${relative(root, f)} (syntax)\n   ${String(err.stderr || err.message).split('\n')[0]}`);
    }
    continue;
  }

  try {
    await import(pathToFileURL(f).href);
  } catch (err) {
    failed++;
    console.log(`✗ ${relative(root, f)}\n   ${err.message}`);
  }
}
console.log(`\nchecked ${files.length} modules, ${failed} failed`);
process.exit(failed ? 1 : 0);
