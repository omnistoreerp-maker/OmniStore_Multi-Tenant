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

// Universal Google Login — INTERMEDIATE CHALLENGE credential.
//
// A challenge is NOT a session credential. It is signed with a dedicated key
// derived from the access secret with its own suffix, carries its own audience
// and its own type, and contains no `role` and no `username`. Consequences:
//
//   * `verifyAccessToken` / `verifyRefreshToken` reject it (wrong key), so
//     `authMiddleware` can never authenticate a challenge as a session;
//   * it authorizes exactly one step of the login flow, and only for the
//     `purpose` it was minted for;
//   * it is additionally burned once, through the durable SQLite challenge
//     store, so replay is impossible even before the JWT expires.
//
// Purposes used by the Google Login flow:
//   'google_mfa'                — user must complete a TOTP verification
//   'google_tenant_selection'   — user must choose one of their tenants
const CHALLENGE_SECRET = config.jwtSecret + ':login-challenge';
// P6.67 — the TTL comes from config so the signed expiration and the durable
// challenge row expiration are derived from ONE configured value.
const CHALLENGE_TTL = config.loginChallengeTtl;
const CHALLENGE_AUDIENCE = 'login-challenge';

/**
 * Mint an intermediate challenge credential.
 *
 * @param {{id: string|number}} user  the authenticated user (only the id is used)
 * @param {string} purpose            one of the CHALLENGE_PURPOSES below
 * @param {object} [extra]            optional additional bound claims (e.g. tenantId)
 * @returns {string} signed challenge JWT
 */
function signChallengeToken(user, purpose, extra) {
  if (!purpose || typeof purpose !== 'string') {
    throw new Error('challenge purpose is required');
  }
  const claims = {
    sub: String(user.id),
    purpose,
    type: 'challenge',
    jti: randomUUID()
  };
  if (extra && typeof extra === 'object') {
    if (extra.tenantId !== undefined && extra.tenantId !== null && String(extra.tenantId) !== '') {
      claims.tenantId = String(extra.tenantId);
    }
  }
  return jwt.sign(claims, CHALLENGE_SECRET, {
    expiresIn: CHALLENGE_TTL,
    audience: CHALLENGE_AUDIENCE
  });
}

/**
 * Verify a challenge credential.
 *
 * Returns null for anything that is not a well-formed challenge of the expected
 * purpose — including session tokens, which are signed with a different key.
 *
 * @param {string} token
 * @param {string} [expectedPurpose]
 * @returns {object|null}
 */
function verifyChallengeToken(token, expectedPurpose) {
  if (!token || typeof token !== 'string') return null;
  let payload;
  try {
    payload = jwt.verify(token, CHALLENGE_SECRET, { audience: CHALLENGE_AUDIENCE });
  } catch (_) {
    return null;
  }
  if (!payload || payload.type !== 'challenge' || !payload.sub || !payload.purpose) return null;
  if (expectedPurpose && payload.purpose !== expectedPurpose) return null;
  // A challenge must never carry session authority.
  if (payload.role !== undefined || payload.username !== undefined) return null;
  return payload;
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

module.exports = {
  signAccessToken,
  signRefreshToken,
  signChallengeToken,
  verifyChallengeToken,
  verifyAccessToken,
  verifyRefreshToken,
  CHALLENGE_PURPOSES: Object.freeze({
    GOOGLE_MFA: 'google_mfa',
    GOOGLE_TENANT_SELECTION: 'google_tenant_selection'
  })
};
