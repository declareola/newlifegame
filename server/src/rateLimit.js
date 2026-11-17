// server/src/rateLimit.js
// Small, dependency-free rate limiting for the auth endpoints.
//
// Two layers:
//   1. per-IP request limiting — stops a single host hammering /api/login
//   2. per-account failed-attempt lockout — stops a distributed attack
//      against one username from many IPs
//
// Everything is in memory. That is deliberate: it matches the single-process
// architecture and needs no extra service. If you run multiple instances,
// move these counters into Redis.

import { logEvent } from './securityLog.js';

/** Sliding-window counter keyed by an arbitrary string. */
class WindowCounter {
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map(); // key -> array of timestamps
    this.lastSweep = Date.now();

    // Periodic cleanup so the map cannot grow without bound.
    this.sweepInterval = setInterval(() => this.sweep(), Math.max(windowMs, 60_000));
    if (this.sweepInterval.unref) this.sweepInterval.unref();
  }

  _prune(key, now) {
    const timestamps = this.hits.get(key);
    if (!timestamps) return [];
    const cutoff = now - this.windowMs;
    const kept = timestamps.filter((t) => t > cutoff);
    if (kept.length) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  /** Record a hit. @returns {{ allowed, remaining, retryAfterMs }} */
  hit(key) {
    const now = Date.now();
    const timestamps = this._prune(key, now);

    if (timestamps.length >= this.max) {
      const oldest = timestamps[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, this.windowMs - (now - oldest)),
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return {
      allowed: true,
      remaining: this.max - timestamps.length,
      retryAfterMs: 0,
    };
  }

  /** Peek without consuming. */
  check(key) {
    const now = Date.now();
    const timestamps = this._prune(key, now);
    if (timestamps.length < this.max) {
      return { allowed: true, remaining: this.max - timestamps.length, retryAfterMs: 0 };
    }
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, this.windowMs - (now - timestamps[0])),
    };
  }

  reset(key) {
    this.hits.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const key of [...this.hits.keys()]) this._prune(key, now);
  }
}

/**
 * Express middleware: max `limit` requests per `windowMs` per client IP.
 * @param {object} opts
 * @param {number} opts.windowMs
 * @param {number} opts.max
 * @param {string} opts.name - used in logs
 */
export function rateLimit({ windowMs, max, name }) {
  const counter = new WindowCounter(windowMs, max);

  return function rateLimitMiddleware(req, res, next) {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const result = counter.hit(key);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      logEvent('rate_limit_blocked', {
        limiter: name,
        ip: key,
        path: req.path,
        retryAfterSec,
      });
      return res.status(429).json({
        error: `Too many attempts. Try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
      });
    }

    next();
  };
}

/**
 * Failed-login lockout, tracked per username rather than per IP.
 * A successful login clears the counter for that username.
 */
export class LoginLockout {
  constructor({ maxFailures = 5, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000 } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.lockMs = lockMs;
    this.failures = new Map(); // usernameLower -> { count, firstAt, lockedUntil }
  }

  _key(username) {
    return String(username || '').trim().toLowerCase();
  }

  /** @returns {{ locked: boolean, retryAfterMs: number, remaining: number }} */
  status(username) {
    const key = this._key(username);
    const record = this.failures.get(key);
    if (!record) return { locked: false, retryAfterMs: 0, remaining: this.maxFailures };

    const now = Date.now();
    if (record.lockedUntil > now) {
      return {
        locked: true,
        retryAfterMs: record.lockedUntil - now,
        remaining: 0,
      };
    }

    // Window expired — start fresh
    if (now - record.firstAt > this.windowMs) {
      this.failures.delete(key);
      return { locked: false, retryAfterMs: 0, remaining: this.maxFailures };
    }

    return {
      locked: false,
      retryAfterMs: 0,
      remaining: Math.max(0, this.maxFailures - record.count),
    };
  }

  recordFailure(username) {
    const key = this._key(username);
    const now = Date.now();
    const record = this.failures.get(key) || { count: 0, firstAt: now, lockedUntil: 0 };

    if (now - record.firstAt > this.windowMs) {
      record.count = 0;
      record.firstAt = now;
    }

    record.count += 1;

    if (record.count >= this.maxFailures) {
      record.lockedUntil = now + this.lockMs;
      logEvent('account_locked', {
        username: key,
        failures: record.count,
        lockMinutes: Math.round(this.lockMs / 60000),
      });
    }

    this.failures.set(key, record);
    return this.status(username);
  }

  recordSuccess(username) {
    this.failures.delete(this._key(username));
  }

  /** Test/maintenance helper. */
  clear() {
    this.failures.clear();
  }
}
