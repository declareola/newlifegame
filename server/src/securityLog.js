// server/src/securityLog.js
// Structured, single-line security logging.
//
// Deliberately never logs passwords, tokens, or full request bodies.
// One JSON object per line so it can be shipped to any log collector.

const REDACT_KEYS = new Set([
  'password',
  'password_hash',
  'passwordHash',
  'token',
  'authorization',
  'jwt',
]);

function redact(value, depth = 0) {
  if (depth > 3) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => redact(v, depth + 1));

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = REDACT_KEYS.has(key) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

/**
 * Emit one structured security event.
 * @param {string} event - e.g. 'login_failed'
 * @param {object} meta  - extra context (never secrets — they are redacted anyway)
 */
export function logEvent(event, meta = {}) {
  const line = {
    ts: new Date().toISOString(),
    level: 'security',
    event,
    ...redact(meta),
  };
  // Single line JSON keeps logs greppable and easy to parse.
  console.log(JSON.stringify(line));
}
