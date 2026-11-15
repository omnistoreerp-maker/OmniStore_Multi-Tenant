const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { ipKeyGenerator } = require('express-rate-limit');
const { error: errorResponse } = require('../utils/apiResponse');

// Recursively remove dangerous keys from parsed JSON bodies:
// prototype-pollution vectors (__proto__/constructor/prototype)
// and operator-injection-style keys ($where, $gt, ...).
function _deepSanitize(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = _deepSanitize(value[i]);
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || key.startsWith('$')) {
        delete value[key];
      } else {
        value[key] = _deepSanitize(value[key]);
      }
    }
  }
  return value;
}

function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') _deepSanitize(req.body);
  next();
}

// Turns body-parser JSON syntax errors into a consistent 400 response
// instead of a leaked 500.
function jsonParseErrorHandler(err, req, res, next) {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    const status = err.type === 'entity.too.large' ? 413 : 400;
    const msg = err.type === 'entity.too.large' ? 'Payload too large' : 'Malformed JSON payload';
    return errorResponse(res, msg, status);
  }
  next(err);
}

// Generous defaults — throttles abuse without changing normal behavior.
function apiRateLimiter(max) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: max || 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later', data: null }
  });
}

// Phase 22B: strict login limiter to slow credential-stuffing/brute force
// without affecting normal business routes. Keyed per IP + username so many
// users are never locked out by one another.
function loginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      // Use the library's ipKeyGenerator helper (normalizes IPv6 subnets and
      // satisfies express-rate-limit v8's keyGeneratorIpFallback validation).
      const ip = ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
      const username = (req.body && req.body.username) ? String(req.body.username).toLowerCase() : '';
      return `${ip}:${username}`;
    },
    message: { success: false, message: 'Too many login attempts, please try again later', data: null }
  });
}

// Google Login rate limiter. Public endpoint with no username before
// authentication, so keyed by IP only. Quota matches loginRateLimiter.
// Never includes the raw ID token in the key.
function googleLoginRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      return ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
    },
    message: { success: false, message: 'Too many login attempts, please try again later', data: null }
  });
}

// Bucket key for a login challenge.
//
// The digest covers the COMPLETE temporary token. The previous key used the
// first 16 characters of the JWT, which are the base64url of the shared
// HS256 header — so every challenge in the deployment landed in one bucket
// and ten attempts anywhere locked out every user (P6.66 H-2). Only the
// digest is handed to the limiter: no raw challenge token ever enters
// limiter state, metrics or logs.
function challengeTokenBucketKey(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

// MFA challenge and tenant-selection rate limiter.
//
// Two INDEPENDENT quotas are enforced and a request must satisfy both:
//   1. per challenge (digest of the complete token) — repeated guesses
//      against one challenge are capped;
//   2. per client IP — an attacker cannot obtain unlimited attempts by
//      rotating through freshly issued challenges, and a shared NAT cannot
//      be starved by a single other tenant.
// A missing or non-string token falls back to the IP bucket, so malformed
// traffic cannot dodge throttling by omitting the field.
function googleLoginChallengeRateLimiter() {
  const perChallenge = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      const raw = req.body && typeof req.body.tempToken === 'string' ? req.body.tempToken : '';
      if (raw.trim() === '') {
        return 'challenge-invalid:' + ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
      }
      return 'challenge:' + challengeTokenBucketKey(raw);
    },
    message: { success: false, message: 'Too many attempts, please try again later', data: null }
  });

  const perIp = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    // Headers are emitted by the per-challenge limiter only, so the two
    // quotas never produce conflicting RateLimit headers.
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator(req) {
      return 'challenge-ip:' + ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
    },
    message: { success: false, message: 'Too many attempts, please try again later', data: null }
  });

  // Chain: per-challenge first, then per-IP. Each limiter either answers 429
  // itself or calls the next step; on pass-through the final handler runs.
  return function googleLoginChallengeLimiter(req, res, next) {
    perChallenge(req, res, (err) => {
      if (err) return next(err);
      return perIp(req, res, next);
    });
  };
}

// Account-linking limiter. Linking is a rare, security-sensitive action, so
// the quota is intentionally small. Keyed by authenticated user (falling back
// to IP for unauthenticated attempts) so one user cannot exhaust another's
// quota, and so a shared NAT does not lock out real users after a few links.
function linkRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      if (req.user && req.user.id) return 'user:' + String(req.user.id);
      return ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
    },
    message: { success: false, message: 'Too many account-linking attempts, please try again later', data: null }
  });
}

// Per-API-key rate limiter. Keyed by the API key ID so each key gets its own
// quota. Falls back to IP if no key is present (should not happen in practice).
function apiKeyRateLimiter(max) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: max || 500,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
      return (req.apiKey && req.apiKey.id) ? req.apiKey.id : ipKeyGenerator(req.ip || 'unknown');
    },
    message: { success: false, message: 'API key rate limit exceeded, please try again later', data: null }
  });
}

module.exports = { sanitizeBody, jsonParseErrorHandler, apiRateLimiter, loginRateLimiter, googleLoginRateLimiter, googleLoginChallengeRateLimiter, linkRateLimiter, apiKeyRateLimiter, challengeTokenBucketKey };
