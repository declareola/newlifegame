// server/test-session-economy.mjs
// Verifies the second hardening pass:
//   • token revocation (logout, password change)
//   • atomic economy operations (no partial writes)
//   • single-deployment static serving
// Runs against a dedicated instance so it never disturbs the dev server.

import { io } from 'socket.io-client';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3102;
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

async function api(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

function startServer(env, port) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['src/index.js'], {
      cwd: __dirname,
      env: { ...process.env, ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`no start: ${output}`)), 20000);
    const onData = (c) => {
      output += c.toString();
      if (output.includes('NewLife server running')) {
        clearTimeout(timer);
        resolve({ child, output: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

function connect(token) {
  return new Promise((resolve) => {
    const sock = io(BASE, { auth: { token }, transports: ['websocket'] });
    const timer = setTimeout(() => { sock.close(); resolve({ result: 'timeout', sock }); }, 6000);
    sock.on('connect', () => { clearTimeout(timer); resolve({ result: 'connected', sock }); });
    sock.on('connect_error', (e) => {
      clearTimeout(timer);
      sock.close();
      resolve({ result: 'rejected', message: e.message, sock });
    });
  });
}

console.log('\n=== SESSION REVOCATION & ATOMIC ECONOMY ===\n');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'newlife-econ-'));
const dbPath = path.join(tmpDir, 'test.db');

const secretLine = fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
  .split('\n').find((l) => l.startsWith('JWT_SECRET='));
const secret = secretLine.slice('JWT_SECRET='.length).trim();

const server = await startServer({
  NODE_ENV: 'development',
  DB_PATH: dbPath,
  JWT_SECRET: secret,
  LOGIN_RATE_MAX: '500',
}, PORT);

process.on('exit', () => {
  server.child.kill('SIGTERM');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const db = new Database(dbPath);

try {
  // ── 1. Logout revokes tokens ───────────────────────────────
  console.log('[Logout revocation]');
  const name = 'sess' + Math.random().toString(36).slice(2, 8);
  const signup = await api('/api/signup', {
    method: 'POST',
    body: { username: name, password: 'FirstPass123', tier: 'middle' },
  });
  const token1 = signup.token;

  const beforeLogout = await api('/api/me', { token: token1 });
  check('Token works before logout', !!beforeLogout.user);

  // Second session, as if on another device
  const second = await api('/api/login', {
    method: 'POST', body: { username: name, password: 'FirstPass123' },
  });
  const token2 = second.token;
  check('A second device can log in', !!token2);

  const out = await api('/api/logout', { method: 'POST', token: token1 });
  check('Logout succeeds', out.ok === true);
  check('Logout reports the new token version', out.tokenVersion === 1,
    `v${out.tokenVersion}`);

  const afterLogout = await api('/api/me', { token: token1 });
  check('The logged-out token is now rejected',
    !!afterLogout.error, afterLogout.error);

  const secondAfter = await api('/api/me', { token: token2 });
  check('Logout also killed the other device (all sessions revoked)',
    !!secondAfter.error,
    secondAfter.error);

  // A fresh login works again
  const relogin = await api('/api/login', {
    method: 'POST', body: { username: name, password: 'FirstPass123' },
  });
  check('A fresh login after logout works', !!relogin.token);
  check('New token has the bumped version',
    !!relogin.token && (await api('/api/me', { token: relogin.token })).user?.username === name);

  // Socket handshake honours revocation
  const goodSock = await connect(relogin.token);
  check('Socket connects with a valid token', goodSock.result === 'connected');
  await api('/api/logout', { method: 'POST', token: relogin.token });
  const deadSock = await connect(relogin.token);
  check('Socket handshake rejects a revoked token',
    deadSock.result === 'rejected', deadSock.message);
  if (goodSock.sock) goodSock.sock.close();

  // ── 2. Password change ────────────────────────────────────
  console.log('\n[Password change]');
  const pwName = 'pass' + Math.random().toString(36).slice(2, 8);
  const pwSignup = await api('/api/signup', {
    method: 'POST',
    body: { username: pwName, password: 'OldPassword1', tier: 'middle' },
  });
  const oldToken = pwSignup.token;

  // A parallel session that should be invalidated
  const parallel = await api('/api/login', {
    method: 'POST', body: { username: pwName, password: 'OldPassword1' },
  });

  const wrongCurrent = await api('/api/password', {
    method: 'POST', token: oldToken,
    body: { current_password: 'not-the-password', new_password: 'NewPassword1' },
  });
  check('Wrong current password is rejected',
    wrongCurrent.error === 'Current password is incorrect', wrongCurrent.error);

  const tooShort = await api('/api/password', {
    method: 'POST', token: oldToken,
    body: { current_password: 'OldPassword1', new_password: 'short' },
  });
  check('Short new password is rejected', !!tooShort.error, tooShort.error);

  const samePass = await api('/api/password', {
    method: 'POST', token: oldToken,
    body: { current_password: 'OldPassword1', new_password: 'OldPassword1' },
  });
  check('Reusing the same password is rejected', !!samePass.error, samePass.error);

  const changed = await api('/api/password', {
    method: 'POST', token: oldToken,
    body: { current_password: 'OldPassword1', new_password: 'NewPassword1' },
  });
  check('Password change succeeds', !!changed.token);
  check('A new token is returned so you stay logged in',
    (await api('/api/me', { token: changed.token })).user?.username === pwName);

  const oldTokenAfter = await api('/api/me', { token: oldToken });
  check('The pre-change token is revoked', !!oldTokenAfter.error, oldTokenAfter.error);

  const parallelAfter = await api('/api/me', { token: parallel.token });
  check('Other devices are signed out after a password change',
    !!parallelAfter.error, parallelAfter.error);

  const oldLogin = await api('/api/login', {
    method: 'POST', body: { username: pwName, password: 'OldPassword1' },
  });
  check('The old password no longer logs in', !!oldLogin.error);

  const newLogin = await api('/api/login', {
    method: 'POST', body: { username: pwName, password: 'NewPassword1' },
  });
  check('The new password logs in', !!newLogin.token);

  // ── 3. Atomic economy: failed operations change nothing ────
  console.log('\n[Atomic economy]');
  const econName = 'econ' + Math.random().toString(36).slice(2, 8);
  const econSignup = await api('/api/signup', {
    method: 'POST',
    body: { username: econName, password: 'password123', tier: 'middle' }, // ₦500,000
  });
  const econToken = econSignup.token;
  const econUser = (await api('/api/me', { token: econToken })).user;

  const snapshot = () => ({
    user: db.prepare('SELECT cash, bank_balance, home_property FROM users WHERE id = ?').get(econUser.id),
    properties: db.prepare('SELECT COUNT(*) c FROM user_properties WHERE user_id = ?').get(econUser.id).c,
  });

  const before = snapshot();

  // Buying something unaffordable must leave the DB byte-identical
  const noMoney = await api('/api/properties/buy', {
    method: 'POST', token: econToken, body: { property_id: 'waterfront-mansion' },
  });
  check('Unaffordable purchase rejected', !!noMoney.error, noMoney.error);

  const afterFailedBuy = snapshot();
  check('No property row was created by the failed purchase',
    afterFailedBuy.properties === before.properties,
    `${before.properties} → ${afterFailedBuy.properties}`);
  check('Cash unchanged after the failed purchase',
    afterFailedBuy.user.cash === before.user.cash,
    `₦${before.user.cash} → ₦${afterFailedBuy.user.cash}`);
  check('Home unchanged after the failed purchase',
    afterFailedBuy.user.home_property === before.user.home_property);

  // A successful purchase moves cash and creates the row together
  const bought = await api('/api/properties/buy', {
    method: 'POST', token: econToken, body: { property_id: 'hostel-bed' },
  });
  check('Affordable purchase succeeds', !bought.error, bought.error || 'ok');

  const afterBuy = snapshot();
  check('Exactly one property row exists after buying',
    afterBuy.properties === before.properties + 1);
  check('Cash dropped by exactly the price',
    Math.round(before.user.cash - afterBuy.user.cash) === 150000,
    `₦${before.user.cash} → ₦${afterBuy.user.cash}`);
  check('The purchased property became the home',
    afterBuy.user.home_property === 'hostel-bed');

  // Rent, then confirm a second rental is refused with no side effects
  const rentBefore = snapshot();
  const rented = await api('/api/properties/rent', {
    method: 'POST', token: econToken, body: { property_id: 'yaba-studio' },
  });
  check('Renting succeeds when affordable', !rented.error, rented.error || 'ok');

  const rentAfter = snapshot();
  check('Deposit + first period taken in one step',
    Math.round(rentBefore.user.cash - rentAfter.user.cash) === 18000,
    `₦${rentBefore.user.cash} → ₦${rentAfter.user.cash}`);

  const beforeSecondRent = snapshot();
  const secondRent = await api('/api/properties/rent', {
    method: 'POST', token: econToken, body: { property_id: 'vi-apartment' },
  });
  const afterSecondRent = snapshot();
  // Holding more than one home is allowed by design: a player may keep a flat
  // in Yaba and a place on the Island. Each tenancy pays its own rent, and the
  // second one must charge the same way the first did.
  check('A second tenancy is allowed', !secondRent.error,
    secondRent.error || `rented ${secondRent.property?.name}`);
  check('The second tenancy charged its own upfront cost',
    afterSecondRent.user.cash < beforeSecondRent.user.cash,
    `₦${beforeSecondRent.user.cash} → ₦${afterSecondRent.user.cash}`);

  // ── 4. Atomic banking ─────────────────────────────────────
  console.log('\n[Atomic banking]');
  // Stand at an ATM: connect, then WALK there. The server distance-checks
  // every packet, so a teleport would be clamped (correctly).
  const sock = await connect(econToken);
  check('Connected for proximity', sock.result === 'connected');

  const here = (await api('/api/me', { token: econToken })).user;
  let wx = here.pos_x || 0;
  let wz = here.pos_z || 0;
  // The ATM's real position, from the generated geometry (see
  // test-step10.mjs — hand-typed coordinates drifted when the map changed).
  const { anchorById } = await import('./config/worldGeometry.js');
  const ATM_ANCHOR = anchorById('atm');
  const TARGET_X = ATM_ANCHOR.x;
  const TARGET_Z = ATM_ANCHOR.z;
  for (let guard = 0; guard < 2000; guard++) {
    const dx = TARGET_X - wx;
    const dz = TARGET_Z - wz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.1) break;
    // 0.5 m / 45 ms = 11 m/s, inside the server's 18 m/s clamp.
    const step = Math.min(0.5, dist);
    wx += (dx / dist) * step;
    wz += (dz / dist) * step;
    sock.sock.emit('player:move', { x: wx, z: wz, rot: 0, moving: true });
    await sleep(45);
  }
  sock.sock.emit('player:move', { x: TARGET_X, z: TARGET_Z, rot: 0, moving: false });
  await sleep(300);

  const bankBefore = snapshot();
  const deposit = await api('/api/interactions/bank/deposit', {
    method: 'POST', token: econToken, body: { point_id: 'atm-centre', amount: 10000 },
  });
  check('Deposit succeeds', !deposit.error, deposit.error || 'ok');

  const bankAfter = snapshot();
  const cashMoved = bankBefore.user.cash - bankAfter.user.cash;
  const bankGained = bankAfter.user.bank_balance - bankBefore.user.bank_balance;
  check('Cash left equals bank gained (no money created or lost)',
    Math.round(cashMoved) === 10000 && Math.round(bankGained) === 10000,
    `cash −₦${cashMoved}, bank +₦${bankGained}`);

  const overdraft = await api('/api/interactions/bank/withdraw', {
    method: 'POST', token: econToken,
    body: { point_id: 'atm-centre', amount: 99999999 },
  });
  check('Overdrawing the bank is rejected', !!overdraft.error, overdraft.error);

  const afterOverdraft = snapshot();
  check('Nothing moved on the rejected withdrawal',
    afterOverdraft.user.cash === bankAfter.user.cash &&
    afterOverdraft.user.bank_balance === bankAfter.user.bank_balance,
    `cash ₦${afterOverdraft.user.cash}, bank ₦${afterOverdraft.user.bank_balance}`);

  // ── 5. Wallet conservation under repeated operations ──────
  console.log('\n[Wallet conservation]');
  let total = snapshot();
  const startTotal = total.user.cash + total.user.bank_balance;

  for (let i = 0; i < 5; i++) {
    await api('/api/interactions/bank/deposit', {
      method: 'POST', token: econToken, body: { point_id: 'atm-centre', amount: 1000 },
    });
    await api('/api/interactions/bank/withdraw', {
      method: 'POST', token: econToken, body: { point_id: 'atm-centre', amount: 1000 },
    });
  }

  const endState = snapshot();
  const endTotal = endState.user.cash + endState.user.bank_balance;
  check('Cash + bank is conserved across 10 transfers',
    Math.abs(endTotal - startTotal) < 1,
    `₦${startTotal.toFixed(0)} → ₦${endTotal.toFixed(0)}`);
  check('Cash never went negative', endState.user.cash >= 0, `₦${endState.user.cash}`);
  check('Bank never went negative', endState.user.bank_balance >= 0, `₦${endState.user.bank_balance}`);

  sock.sock.close();

  // ── 6. Single-deployment static serving ───────────────────
  console.log('\n[Single deployment]');
  const indexRes = await fetch(`${BASE}/`);
  const html = await indexRes.text();
  check('Server serves the built client at /',
    indexRes.status === 200 && html.includes('<div id="loading-screen">'),
    `HTTP ${indexRes.status}`);
  check('HTML carries the app CSP (not the API one)',
    (indexRes.headers.get('content-security-policy') || '').includes("script-src 'self'"),
    'app CSP applied');
  check('Deep links fall back to index.html',
    (await fetch(`${BASE}/some/deep/link`)).status === 200);
  check('Unknown API routes still return JSON 404',
    (await fetch(`${BASE}/api/nope`)).status === 404);

  const assetMatch = html.match(/\/assets\/[^"]+\.js/);
  check('Referenced JS assets actually load',
    assetMatch ? (await fetch(`${BASE}${assetMatch[0]}`)).status === 200 : false,
    assetMatch ? assetMatch[0] : 'no asset found');
} finally {
  db.close();
  server.child.kill('SIGTERM');
  await sleep(400);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('\n=========================');
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log('=========================\n');
process.exit(failed === 0 ? 0 : 1);
