const crypto = require('crypto');
const config = require('../config');

// Signed, single-use, short-TTL state for the Platform Master Google
// sign-in flow. The payload (mode / returnTo / nonce / PKCE verifier /
// bound username) is integrity-protected with an HMAC derived from the
// server's JWT secret, so a client can never mint or tamper with one.
// Replay is blocked by a single-use jti registry with lazy expiry; a
// state is good for one callback only.
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_TOKEN_LEN = 4096;
const usedJti = new Map(); // jti -> expiry epoch ms

function _macKey() {
  return crypto.createHash('sha256').update(String(config.jwtSecret) + '|oauth-master-state').digest();
}

function _prune() {
  const now = Date.now();
  for (const [jti, exp] of usedJti) {
    if (exp <= now) usedJti.delete(jti);
  }
}

function issue(payload) {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({
    ...(payload && typeof payload === 'object' ? payload : {}),
    jti: crypto.randomBytes(16).toString('hex'),
    iat: now,
    exp: now + STATE_TTL_MS
  })).toString('base64url');
  const mac = crypto.createHmac('sha256', _macKey()).update(body).digest('base64url');
  return body + '.' + mac;
}

// Signature + TTL + shape check WITHOUT touching the single-use registry.
// Used where verification must be retryable (MFA challenge attempts) before
// the one-shot consume happens at the moment of success.
function verifyOnly(token) {
  try {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LEN) return null;
    const dot = token.lastIndexOf('.');
    if (dot < 1) return null;
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', _macKey()).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (_) {
      return null;
    }
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
    if (typeof payload.jti !== 'string' || !payload.jti) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

// Verifies signature, TTL and single use. Returns the payload on first
// valid consumption, or null for anything else (tampered, expired,
// replayed, malformed). Never throws on hostile input.
function consume(token) {
  try {
    const payload = verifyOnly(token);
    if (!payload) return null;
    _prune();
    if (usedJti.has(payload.jti)) return null; // replay
    usedJti.set(payload.jti, payload.exp);
    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = { issue, consume, verifyOnly, STATE_TTL_MS };
