const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const config = require('../config');

const ACCESS_TTL = config.jwtAccessTtl;
const REFRESH_TTL = config.jwtRefreshTtl;
const REFRESH_SECRET = config.jwtRefreshSecret;

// Unique jti per issuance: two signings within the same second must yield
// distinct tokens so token-level revocation can never hit a coincident
// re-issued credential (Phase 22B auth hardening).
function _claims(user) {
  return { sub: String(user.id), username: user.username, role: user.role || '', jti: randomUUID() };
}

function signAccessToken(user) {
  return jwt.sign(_claims(user), config.jwtSecret, { expiresIn: ACCESS_TTL });
}

function signRefreshToken(user) {
  return jwt.sign({ ..._claims(user), type: 'refresh' }, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload && payload.sub ? payload : null;
  } catch (_) {
    return null;
  }
}

function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, REFRESH_SECRET);
    return payload && payload.sub && payload.type === 'refresh' ? payload : null;
  } catch (_) {
    return null;
  }
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
