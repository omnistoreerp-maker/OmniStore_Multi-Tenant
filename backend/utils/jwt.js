const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const config = require('../config');

const ACCESS_TTL = config.jwtAccessTtl;
const REFRESH_TTL = config.jwtRefreshTtl;
const REFRESH_SECRET = config.jwtRefreshSecret;

// Unique jti per issuance: two signings within the same second must yield
// distinct tokens so token-level revocation can never hit a coincident
// re-issued credential (Phase 22B auth hardening).
//
// Optional tenantId carry (Phase 19): when the signed user object carries a
// `tenantId` (the securely selected company), that single claim is embedded in
// the token. It is OPTIONAL and backward compatible: the claim simply does not
// exist when a user has no bound tenant, so pre-Phase-19 tokens (and any token
// minted without tenant carry) verify exactly as before. `jsonwebtoken` ignores
// unknown claims, so existing verification is unchanged.
function _claims(user) {
  const claims = { sub: String(user.id), username: user.username, role: user.role || '', jti: randomUUID() };
  if (user.tenantId !== undefined && user.tenantId !== null && String(user.tenantId) !== '') {
    claims.tenantId = String(user.tenantId);
  }
  // Phase D — token version. Optional and additive: `ver` is only embedded when
  // the signed user carries a tokenVersion, so pre-Phase-D tokens behave
  // byte-for-byte the same and stay valid for users whose version is still 0.
  if (user.tokenVersion !== undefined && user.tokenVersion !== null) {
    claims.ver = Number(user.tokenVersion);
  }
  return claims;
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
