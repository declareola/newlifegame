// server/scripts/gen-secret.mjs
// Generate a strong JWT secret and write it into server/.env.
// Usage: npm run gen-secret
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSecret } from '../src/secret.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

const secret = generateSecret();

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

const cleaned = lines.filter((l, i) => l.trim() !== '' || i < lines.length - 1);
fs.writeFileSync(ENV_PATH, `${cleaned.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
try { fs.chmodSync(ENV_PATH, 0o600); } catch { /* best effort */ }

console.log('✔ New JWT_SECRET written to server/.env');
console.log(`  ${secret.slice(0, 12)}… (${secret.length} chars)`);
console.log('  Restart the server for it to take effect. All existing sessions will be invalidated.');
