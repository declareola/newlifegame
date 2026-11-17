import jwt from 'jsonwebtoken';
import { getUserById, updateLastSeen } from './db.js';
import { resolveJwtSecret } from './secret.js';

// Resolved lazily on first use. ES module imports are evaluated before the
// importing module's body runs, so calling this at import time would read
// process.env before dotenv has populated it. Resolving lazily (and caching)
// guarantees .env values are already loaded.
let cachedSecret = null;

export function getJwtSecret() {
  if (cachedSecret === null) {
    cachedSecret = resolveJwtSecret().secret;
  }
  return cachedSecret;
}

/** @deprecated prefer getJwtSecret(); kept for compatibility. */
export const JWT_SECRET = { toString: () => getJwtSecret() };

const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      // Revocation handle: if this no longer matches the stored value the
      // token is dead (logout, password change, forced sign-out).
      v: user.token_version || 0,
    },
    getJwtSecret(),
    {
      expiresIn: EXPIRES_IN,
      algorithm: 'HS256',
      issuer: 'newlife',
    }
  );
}

/** Throws if the token's version is older than the user's current version. */
function assertTokenCurrent(decoded, user) {
  const presented = decoded.v ?? 0;
  const current = user.token_version ?? 0;
  if (presented !== current) {
    const err = new Error('Token revoked');
    err.code = 'TOKEN_REVOKED';
    throw err;
  }
}

/**
 * The session token, whichever way it arrived.
 *
 * The game is played through a preview proxy that does not always pass custom
 * request headers through to the origin. When the `Authorization` header is
 * stripped in transit, every authenticated call fails with "No token provided"
 * even though the player is signed in and their socket is connected (the socket
 * carries its token inside the Socket.IO handshake, not in a header) — which is
 * exactly the symptom of being unable to buy anything while holding money.
 *
 * So the token is accepted over four transports, cheapest first:
 *   1. `Authorization: Bearer <token>`  — the normal API path
 *   2. `X-Auth-Token: <token>`          — some proxies pass this where they
 *                                          strip Authorization
 *   3. the `nl_token` cookie            — set on sign-in, rides along with the
 *                                          request and cannot be stripped by a
 *                                          header allowlist
 *   4. `?token=<token>`                 — last resort; the client only uses it
 *                                          to retry a request that came back
 *                                          "No token provided"
 *
 * A token is only ever trusted after signature, issuer and revocation checks,
 * so accepting it over more transports does not weaken authorisation.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
export function tokenFromRequest(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const t = header.slice(7).trim();
    if (t) return t;
  }

  const aliased = req.headers['x-auth-token'];
  if (typeof aliased === 'string' && aliased.trim()) return aliased.trim();

  const cookie = parseCookie(req.headers.cookie, AUTH_COOKIE);
  if (cookie) return cookie;

  const q = req.query && req.query.token;
  if (typeof q === 'string' && q.trim()) return q.trim();

  return null;
}

/** The name of the cookie that carries the session. */
export const AUTH_COOKIE = 'nl_token';

/**
 * Read one cookie out of a Cookie header without pulling in a dependency.
 * @param {string|undefined} header
 * @param {string} name
 * @returns {string|null}
 */
function parseCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Give the browser a session cookie alongside the token in the response body.
 *
 * HttpOnly, so page scripts cannot read it; SameSite=Lax, so another site
 * cannot post to the API with it and have it count as the player (the JSON
 * content type adds a preflight on top of that). Secure is set only when the
 * request actually arrived over TLS, so local http development still works.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} token
 */
export function setAuthCookie(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** Clear the session cookie (logout). */
export function clearAuthCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${AUTH_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/**
 * Express middleware that verifies the JWT in the Authorization header
 * and attaches the full user record to req.user.
 */
export function authMiddleware(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'], // pin the algorithm — blocks "alg: none" and RS/HS confusion
      issuer: 'newlife',
    });
    const user = getUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    assertTokenCurrent(decoded, user);
    req.user = user;
    updateLastSeen(user.id);
    next();
  } catch (err) {
    if (err.code === 'TOKEN_REVOKED') {
      return res.status(401).json({ error: 'Session ended — please log in again' });
    }
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Verify a token for the socket handshake.
 * Throws if the signature is bad, it has expired, or it has been revoked.
 */
export function verifyToken(token) {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ['HS256'],
    issuer: 'newlife',
  });
  const user = getUserById(decoded.id);
  if (!user) {
    const err = new Error('User not found');
    err.code = 'TOKEN_REVOKED';
    throw err;
  }
  assertTokenCurrent(decoded, user);
  return decoded;
}
