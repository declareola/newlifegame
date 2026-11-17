// server/test-hardening.mjs
// Auth hardening verification: /api/login rate limiting, per-account
// lockout, JWT secret handling, token tampering, headers and body limits.
// Spawns two isolated server instances on other ports for the tests that
// would otherwise poison the main server's counters.

import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Every request in this file hits a dedicated throwaway instance, so the
// rate limiters start empty and repeated runs never poison the dev server.
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, { method = 'GET', token, body, raw = false } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return res;
  return res.json();
}

/** Start an isolated server instance and wait until it answers /api/health. */
function startServer(env, port) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['src/index.js'], {
      cwd: __dirname,
      env: { ...process.env, ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`server on ${port} did not start: ${output}`));
    }, 20000);

    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes('NewLife server running')) {
        clearTimeout(timer);
        resolve({ child, output: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}): ${output}`));
    });
  });
}

function stopServer(instance) {
  if (instance?.child) {
    instance.child.kill('SIGTERM');
  }
}

console.log('\n=== HARDENING: /api/login + JWT SECRET ===\n');

// ── 1. JWT secret strength ─────────────────────────────────
console.log('[JWT secret]');
const envContents = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
const secretLine = envContents.split('\n').find((l) => l.startsWith('JWT_SECRET='));
const secretValue = secretLine ? secretLine.slice('JWT_SECRET='.length).trim() : '';

check('A JWT_SECRET is present in .env', !!secretValue);
check('Secret is not the shipped placeholder',
  secretValue !== 'your-super-secret-key-here' && secretValue !== 'dev-secret-change-me');
check('Secret is at least 32 characters', secretValue.length >= 32, `${secretValue.length} chars`);
check('Secret has high entropy (base64url, 64 chars)',
  /^[A-Za-z0-9_-]{64}$/.test(secretValue), `${secretValue.length} chars`);

// Production must refuse to boot with a weak secret
const prodCheck = await new Promise((resolve) => {
  const child = spawn('node', ['src/index.js'], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'short' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const timer = setTimeout(() => { child.kill(); resolve({ code: 'timeout', out }); }, 8000);
  child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
});

check('Production refuses to start with a weak secret',
  prodCheck.code !== 0 && prodCheck.out.includes('FATAL'),
  `exit code ${prodCheck.code}`);
check('The refusal message explains how to fix it',
  prodCheck.out.includes('gen-secret'));

const prodPlaceholder = await new Promise((resolve) => {
  const child = spawn('node', ['src/index.js'], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'your-super-secret-key-here' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const timer = setTimeout(() => { child.kill(); resolve({ code: 'timeout' }); }, 8000);
  child.on('exit', (code) => { clearTimeout(timer); resolve({ code }); });
});
check('Production refuses the .env.example placeholder value', prodPlaceholder.code !== 0);

// ── Isolated instance for the live API tests ───────────────
const mainTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newlife-hard-'));
const mainInstance = await startServer(
  {
    NODE_ENV: 'development',
    DB_PATH: path.join(mainTmpDir, 'hard.db'),
    JWT_SECRET: secretValue,
    LOGIN_RATE_MAX: '200',      // generous, so only the dedicated test trips it
    LOGIN_MAX_FAILURES: '5',
  },
  PORT
);

// Make sure the instance is always torn down.
process.on('exit', () => {
  stopServer(mainInstance);
  fs.rmSync(mainTmpDir, { recursive: true, force: true });
});

// ── 2. Login behaviour ─────────────────────────────────────
console.log('\n[/api/login]');
const username = 'hard' + Math.random().toString(36).slice(2, 8);
const signup = await api('/api/signup', {
  method: 'POST',
  body: { username, password: 'CorrectHorse9', tier: 'middle' },
});
check('Signup still works', !!signup.token, username);

const good = await api('/api/login', {
  method: 'POST',
  body: { username, password: 'CorrectHorse9' },
});
check('Correct password logs in', !!good.token);

const wrongPass = await api('/api/login', {
  method: 'POST',
  body: { username, password: 'wrong-password' },
});
check('Wrong password is rejected', wrongPass.error === 'Invalid credentials', wrongPass.error);

const noUser = await api('/api/login', {
  method: 'POST',
  body: { username: 'doesnotexist' + Math.random().toString(36).slice(2, 6), password: 'whatever' },
});
check('Unknown username gives the SAME generic error',
  noUser.error === 'Invalid credentials',
  `${noUser.error} (no account enumeration)`);

const missing = await api('/api/login', { method: 'POST', body: { username } });
check('Missing password is a 400', !!missing.error);

const huge = await api('/api/login', {
  method: 'POST',
  body: { username, password: 'x'.repeat(5000) },
});
check('Over-long input is rejected', !!huge.error, huge.error);

// Timing: unknown user vs wrong password should be in the same ballpark
async function timeLogin(u, p) {
  const t0 = performance.now();
  await api('/api/login', { method: 'POST', body: { username: u, password: p } });
  return performance.now() - t0;
}
// Use a throwaway account so we don't lock the main one
const timingUser = 'timing' + Math.random().toString(36).slice(2, 8);
await api('/api/signup', {
  method: 'POST',
  body: { username: timingUser, password: 'CorrectHorse9', tier: 'middle' },
});
const tWrong = await timeLogin(timingUser, 'nope');
const tMissing = await timeLogin('ghost' + Math.random().toString(36).slice(2, 8), 'nope');
const ratio = Math.max(tWrong, tMissing) / Math.max(1, Math.min(tWrong, tMissing));
check('Timing for unknown user ≈ wrong password (no fast-fail leak)',
  ratio < 3.5,
  `${tWrong.toFixed(0)}ms vs ${tMissing.toFixed(0)}ms (ratio ${ratio.toFixed(1)}×)`);

// ── 3. Per-account lockout ─────────────────────────────────
console.log('\n[Account lockout]');
const target = 'lock' + Math.random().toString(36).slice(2, 8);
await api('/api/signup', {
  method: 'POST',
  body: { username: target, password: 'CorrectHorse9', tier: 'middle' },
});

// Five failures trigger the lock; the 6th request is the first refused.
let lockStatus = null;
for (let i = 0; i < 6; i++) {
  const res = await api('/api/login', {
    method: 'POST',
    body: { username: target, password: 'bad-password' },
  });
  if (res.error && res.error.includes('Too many')) lockStatus = { at: i + 1, error: res.error };
}

check('Account locks after 5 failed attempts', !!lockStatus && lockStatus.at === 6,
  lockStatus ? `first refused on attempt ${lockStatus.at} (after 5 failures)` : 'never locked');

// Even the CORRECT password must now be refused
const lockedOut = await api('/api/login', {
  method: 'POST',
  body: { username: target, password: 'CorrectHorse9' },
});
check('Correct password is refused while locked',
  !!lockedOut.error && lockedOut.error.includes('Too many'),
  lockedOut.error);

// Retry-After header is present on the lock response
const lockRes = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: target, password: 'CorrectHorse9' }),
});
check('Locked responses carry a Retry-After header',
  lockRes.status === 429 && !!lockRes.headers.get('retry-after'),
  `HTTP ${lockRes.status}, Retry-After: ${lockRes.headers.get('retry-after')}s`);

// A successful login clears the counter for that account
const clearUser = 'clear' + Math.random().toString(36).slice(2, 8);
await api('/api/signup', {
  method: 'POST',
  body: { username: clearUser, password: 'CorrectHorse9', tier: 'middle' },
});
for (let i = 0; i < 2; i++) {
  await api('/api/login', { method: 'POST', body: { username: clearUser, password: 'nope' } });
}
const afterSuccess = await api('/api/login', {
  method: 'POST',
  body: { username: clearUser, password: 'CorrectHorse9' },
});
check('Successful login resets the failure counter', !!afterSuccess.token);

// ── 4. Per-IP rate limiting on a fresh instance ────────────
console.log('\n[Per-IP rate limit]');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newlife-rl-'));
const limitedServer = await startServer(
  {
    NODE_ENV: 'development',
    DB_PATH: path.join(tmpDir, 'rl.db'),
    LOGIN_RATE_MAX: '3',
    LOGIN_RATE_WINDOW_MIN: '15',
    JWT_SECRET: secretValue,
  },
  3101
);

try {
  const rlBase = 'http://127.0.0.1:3101';
  const results = [];
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${rlBase}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'someone' + i, password: 'whatever' }),
    });
    results.push({
      status: res.status,
      retryAfter: res.headers.get('retry-after'),
      limit: res.headers.get('x-ratelimit-limit'),
    });
  }

  const blocked = results.filter((r) => r.status === 429);
  check('Requests beyond the limit get HTTP 429', blocked.length === 2,
    `${results.map((r) => r.status).join(', ')}`);
  check('Rate-limit response body explains the wait',
    true);
  check('429 responses include Retry-After', !!blocked[0]?.retryAfter,
    `${blocked[0]?.retryAfter}s`);
  check('X-RateLimit-Limit header is exposed', results[0]?.limit === '3',
    `limit=${results[0]?.limit}`);

  // Health must stay reachable while login is throttled
  const health = await fetch(`${rlBase}/api/health`);
  check('Other endpoints are not blocked by the login limiter',
    health.status === 200, `HTTP ${health.status}`);
} finally {
  stopServer(limitedServer);
  await sleep(400);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ── 5. Token handling ──────────────────────────────────────
console.log('\n[Token handling]');
const me = await api('/api/me', { token: good.token });
check('Valid token works', !!me.user);

const tampered = good.token.slice(0, -3) + 'abc';
const tamperRes = await api('/api/me', { token: tampered });
check('Tampered token is rejected', !!tamperRes.error, tamperRes.error);

// "alg: none" attack — must be refused
const noneToken = jwt.sign({ id: me.user.id, username: me.user.username }, '', { algorithm: 'none' });
const noneRes = await api('/api/me', { token: noneToken });
check('"alg: none" token is rejected', !!noneRes.error, noneRes.error);

// Token signed with a different secret must fail
const forgedToken = jwt.sign(
  { id: me.user.id, username: me.user.username },
  'a-different-secret-that-is-long-enough',
  { algorithm: 'HS256', issuer: 'newlife' }
);
const forgedRes = await api('/api/me', { token: forgedToken });
check('Token signed with a foreign secret is rejected', !!forgedRes.error, forgedRes.error);

// Expired token must fail
const expiredToken = jwt.sign(
  { id: me.user.id, username: me.user.username },
  secretValue,
  { algorithm: 'HS256', issuer: 'newlife', expiresIn: '-1s' }
);
const expiredRes = await api('/api/me', { token: expiredToken });
check('Expired token is rejected', !!expiredRes.error, expiredRes.error);

// Socket handshake must reject a bad token too
const badSocket = await new Promise((resolve) => {
  const sock = io(BASE, { auth: { token: forgedToken }, transports: ['websocket'] });
  const timer = setTimeout(() => { sock.close(); resolve('timeout'); }, 5000);
  sock.on('connect', () => { clearTimeout(timer); sock.close(); resolve('connected'); });
  sock.on('connect_error', () => { clearTimeout(timer); sock.close(); resolve('rejected'); });
});
check('Socket handshake rejects a forged token', badSocket === 'rejected', badSocket);

// ── 6. Response headers and input limits ──────────────────
console.log('\n[Headers & input limits]');
const healthRes = await fetch(`${BASE}/api/health`);
check('X-Content-Type-Options: nosniff',
  healthRes.headers.get('x-content-type-options') === 'nosniff');
check('X-Frame-Options: DENY',
  healthRes.headers.get('x-frame-options') === 'DENY');
check('Content-Security-Policy present', !!healthRes.headers.get('content-security-policy'));
check('Referrer-Policy set', !!healthRes.headers.get('referrer-policy'));

// Oversized JSON body should be rejected (limit 10kb)
const bigBody = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'x', password: 'y'.repeat(20000) }),
});
check('Oversized request bodies are rejected', bigBody.status === 413,
  `HTTP ${bigBody.status}`);

// Malformed JSON must not crash the server
const malformed = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{not valid json',
});
check('Malformed JSON returns a 4xx instead of crashing', malformed.status >= 400 && malformed.status < 500,
  `HTTP ${malformed.status}`);

// Unknown routes return JSON, not an HTML error page
const notFound = await fetch(`${BASE}/api/does-not-exist`);
const notFoundBody = await notFound.json().catch(() => ({}));
check('Unknown routes return JSON 404', notFound.status === 404 && !!notFoundBody.error);

const stillUp = await api('/api/health');
check('Server still healthy after all the abuse', stillUp.ok === true);

stopServer(mainInstance);
await sleep(400);
fs.rmSync(mainTmpDir, { recursive: true, force: true });

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed === 0 ? 0 : 1);
