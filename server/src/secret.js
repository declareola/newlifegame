// server/src/secret.js
// Resolves the JWT signing secret.
//
// Security rule: a JWT secret must be long, random, and never committed.
//   • In production, a missing or placeholder secret is a fatal error — the
//     server refuses to start rather than run with a secret anyone can guess.
//   • In development, a strong random secret is generated on first run and
//     written to .env so your sessions survive restarts.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

// Values that ship in example files and must never be used for real.
const WEAK_SECRETS = new Set([
  '',
  'your-super-secret-key-here',
  'dev-secret-change-me',
  'secret',
  'changeme',
  'test',
]);

const MIN_SECRET_LENGTH = 32;

export function generateSecret() {
  // 48 random bytes → 64 base64url characters of entropy.
  return crypto.randomBytes(48).toString('base64url');
}

function isWeak(secret) {
  if (!secret) return true;
  if (WEAK_SECRETS.has(secret)) return true;
  if (secret.length < MIN_SECRET_LENGTH) return true;
  return false;
}

/**
 * Persist a new secret into server/.env, replacing any existing entry.
 * Non-secret variables (PORT, CLIENT_ORIGIN) are preserved.
 */
function persistSecretToEnv(secret) {
  let contents = '';
  try {
    contents = fs.readFileSync(ENV_PATH, 'utf8');
  } catch {
    contents = '';
  }

  const lines = contents
    .split('\n')
    .filter((line) => !line.trim().startsWith('JWT_SECRET='));

  lines.push(`JWT_SECRET=${secret}`);

  // Trim trailing blank lines, keep a final newline
  const cleaned = lines.filter((l, i) => l.trim() !== '' || i < lines.length - 1);
  fs.writeFileSync(ENV_PATH, `${cleaned.join('\n').replace(/\n+$/, '')}\n`, {
    mode: 0o600,
  });
  try {
    fs.chmodSync(ENV_PATH, 0o600);
  } catch {
    /* best effort — some filesystems don't support chmod */
  }
}

/**
 * @returns {{ secret: string, generated: boolean }}
 */
export function resolveJwtSecret() {
  const fromEnv = process.env.JWT_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isWeak(fromEnv)) {
    return { secret: fromEnv, generated: false };
  }

  if (isProduction) {
    console.error(
      '\n✖ FATAL: JWT_SECRET is missing, too short (min ' +
      `${MIN_SECRET_LENGTH} chars), or still a placeholder.\n` +
      '  Refusing to start in production with a guessable secret.\n' +
      '  Generate one with:  npm run gen-secret\n' +
      '  Then set JWT_SECRET in your environment.\n'
    );
    process.exit(1);
  }

  const secret = generateSecret();
  try {
    persistSecretToEnv(secret);
    console.log(
      '🔐 Generated a new random JWT_SECRET and saved it to server/.env'
    );
  } catch (err) {
    console.warn(
      '🔐 Generated a temporary JWT_SECRET (could not write .env: ' +
      `${err.message}). Sessions will reset on restart.`
    );
  }

  process.env.JWT_SECRET = secret;
  return { secret, generated: true };
}
